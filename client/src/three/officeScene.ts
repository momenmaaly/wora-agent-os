import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  IcosahedronGeometry, MathUtils, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Raycaster, Scene,
  SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer,
  type Material, type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentParticipant, SharedWorkspaceEntry } from '../types.js';
import {
  ROOM_3D_BY_ID, ROOM_3D_LAYOUTS, ROOM_SPOTS, agentVisualState,
  type AgentMotionSnapshot, type WorldPoint,
} from './layout.js';
import { createOfficePalette, type OfficePalette, type ScreenVariant } from './materials.js';
import { createRobotFactory, type RobotRecord } from './robot.js';
import {
  REFERENCE_CAMERA_TARGET, REFERENCE_DESK_POINTS, REFERENCE_DISPLAY_POINTS, REFERENCE_FEATURE_POINTS,
  REFERENCE_PLANT_POINTS, REFERENCE_RAIL_POINTS, REFERENCE_ROBOT_POINTS, REFERENCE_ROOMS,
  REFERENCE_VIEWPORT, REFERENCE_FLOOR_Y, REFERENCE_LABEL_HEIGHT,
  applyReferenceCamera, buildReferenceRooms, logicalRoomsForVisual, makeReferenceCamera,
  screenToFloor, updateReferenceCameraFov, visualRoomForLogical, worldUnitsPerPixel,
  type ReferenceIcon, type ReferenceRoomWorld, type ScreenPoint,
} from './referenceLayout.js';
import { projectToViewport, rectanglesOverlap } from './architecture.js';

const FLOOR_Y = REFERENCE_FLOOR_Y;

interface Placement {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  cast?: boolean; receive?: boolean; renderOrder?: number;
}

export type OfficeSelection =
  | { kind: 'robot'; id: string; roomId: string; label?: string }
  | { kind: 'department'; id: string; roomId: string; label?: string }
  | { kind: 'workstation'; id: string; roomId: string; label?: string }
  | { kind: 'screen'; id: string; roomId: string; label?: string }
  | { kind: 'meeting'; id: string; roomId: string; label?: string };

class GeometryCache {
  private readonly geometries = new Map<string, BufferGeometry>();
  private get<T extends BufferGeometry>(key: string, create: () => T): T {
    const found = this.geometries.get(key);
    if (found) return found as T;
    const geometry = create();
    this.geometries.set(key, geometry);
    return geometry;
  }
  box(w: number, h: number, d: number) { return this.get(`b:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d)); }
  rounded(w: number, h: number, d: number, r: number) { return this.get(`r:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 4, r)); }
  cylinder(rt: number, rb: number, h: number, segments = 20) { return this.get(`c:${rt}:${rb}:${h}:${segments}`, () => new CylinderGeometry(rt, rb, h, segments)); }
  sphere(r: number, segments = 14) { return this.get(`s:${r}:${segments}`, () => new SphereGeometry(r, segments, Math.max(8, Math.floor(segments * 0.7)))); }
  ico(r: number, detail = 1) { return this.get(`i:${r}:${detail}`, () => new IcosahedronGeometry(r, detail)); }
  torus(r: number, tube: number, arc = Math.PI * 2) { return this.get(`t:${r}:${tube}:${arc}`, () => new TorusGeometry(r, tube, 10, 48, arc)); }
  plane(w: number, h: number) { return this.get(`p:${w}:${h}`, () => new PlaneGeometry(w, h)); }
  circle(r: number) { return this.get(`ci:${r}`, () => new CircleGeometry(r, 64)); }
  dispose() { for (const geometry of this.geometries.values()) geometry.dispose(); this.geometries.clear(); }
}

function add(
  parent: Object3D,
  geometry: BufferGeometry,
  material: Material,
  placement: Placement = {},
  shadows = true,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(placement.x ?? 0, placement.y ?? 0, placement.z ?? 0);
  mesh.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
  mesh.castShadow = shadows && (placement.cast ?? true);
  mesh.receiveShadow = placement.receive ?? true;
  mesh.renderOrder = placement.renderOrder ?? 0;
  parent.add(mesh);
  return mesh;
}

function iconSvg(icon: ReferenceIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'office3d-label-icon');
  const paths: Record<ReferenceIcon, string> = {
    megaphone: '<path d="M3 11v2a2 2 0 0 0 2 2h2l7 4V5L7 9H5a2 2 0 0 0-2 2Z" fill="currentColor"/><path d="m16 9 4-2v10l-4-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 15v4h3v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    crown: '<path d="m3 8 4 4 5-7 5 7 4-4-2 10H5L3 8Z" fill="currentColor"/><rect x="5" y="19" width="14" height="2" rx="1" fill="currentColor"/>',
    code: '<path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.6 1.6 0 0 1 1.2-2.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" fill="currentColor"/><circle cx="7.5" cy="11" r="1.4" fill="#173440"/><circle cx="10" cy="7.5" r="1.4" fill="#173440"/><circle cx="15" cy="8" r="1.4" fill="#173440"/><circle cx="17" cy="12" r="1.4" fill="#173440"/>',
    flask: '<path d="M9 3h6M10 3v6L5 19a1 1 0 0 0 .9 1.5h12.2a1 1 0 0 0 .9-1.5L14 9V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 15h9l1.5 3.5a1 1 0 0 1-.9 1.5H7a1 1 0 0 1-.9-1.5L7.5 15Z" fill="currentColor"/>',
    bars: '<rect x="3" y="14" width="4" height="7" rx="1" fill="currentColor"/><rect x="10" y="9" width="4" height="12" rx="1" fill="currentColor"/><rect x="17" y="4" width="4" height="17" rx="1" fill="currentColor"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Z" fill="currentColor"/><path d="m8.5 12 2.5 2.5 5-5.5" fill="none" stroke="#173440" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  svg.innerHTML = paths[icon];
  return svg;
}

export interface OfficeSceneOptions {
  container: HTMLElement;
  agents: AgentParticipant[];
  tasks: SharedWorkspaceEntry[];
  locations?: Record<string, AgentMotionSnapshot>;
  commandAgentIds?: ReadonlySet<string>;
  selectedRoomId: string | null;
  focusedAgentId: string | null;
  quality: 'low' | 'high';
  reducedMotion: boolean;
  onRoom: (roomId: string) => void;
  onAgent: (agentId: string) => void;
  onInspect?: (selection: OfficeSelection) => void;
}

export interface OfficeSceneController {
  focusRoom: (roomId: string | null) => void;
  focusAgent: (agentId: string | null) => void;
  focusSpot: (spotId: string) => void;
  resetCamera: () => void;
  setAgents: (
    agents: AgentParticipant[],
    tasks: SharedWorkspaceEntry[],
    locations?: Record<string, AgentMotionSnapshot>,
    commandAgentIds?: ReadonlySet<string>,
  ) => void;
  setRobotPositions: (positions: Record<string, WorldPoint>) => void;
  setMovementActive: (agentIds: ReadonlySet<string>) => void;
  setSelectedRoom: (roomId: string | null) => void;
  destroy: () => void;
}

interface CameraTween {
  fromTarget: Vector3;
  toTarget: Vector3;
  fromScale: number;
  toScale: number;
  startedAt: number;
  duration: number;
}

interface RoomLabel {
  visualId: string;
  logicalRoomId: string;
  definition: (typeof REFERENCE_ROOMS)[number];
  element: HTMLButtonElement;
  anchor: Vector3;
  onSelect: () => void;
}

interface RobotVisual {
  visualId: string;
  agentId: string;
  record: RobotRecord;
  logicalRoomId: string;
}

interface RobotPoint {
  visualId: string;
  logicalRoomId: string;
  screen: ScreenPoint;
  index: number;
}

function makeFloorGeometry(room: ReferenceRoomWorld): BufferGeometry {
  const local = room.points.map((point) => {
    const delta = point.clone().sub(room.center);
    return { u: delta.dot(room.right), v: delta.dot(room.forward) };
  });
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = local[index]!;
    vertices.push(point.u, 0, point.v);
    normals.push(0, 1, 0);
    uvs.push(point.u / Math.max(room.width, 0.001) + 0.5, point.v / Math.max(room.depth, 0.001) + 0.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createOfficeScene(options: OfficeSceneOptions): OfficeSceneController {
  const {
    container, quality, reducedMotion, onRoom, onAgent,
    onInspect = () => {},
  } = options;
  const cache = new GeometryCache();
  const customGeometries: BufferGeometry[] = [];
  const palette: OfficePalette = createOfficePalette();
  const extraMaterials: Material[] = [];
  const extraTextures: Texture[] = [];
  const extraMaterial = <T extends Material>(material: T): T => { extraMaterials.push(material); return material; };
  const warmStrip = extraMaterial(new MeshBasicMaterial({ color: '#ffe4ae', toneMapped: false }));
  const corridorLine = extraMaterial(new MeshStandardMaterial({ color: '#8fa9ad', roughness: 0.6, metalness: 0.15 }));
  const selectionRingMaterial = extraMaterial(new MeshBasicMaterial({ color: '#7eeaff', transparent: true, opacity: 0.86, side: DoubleSide, depthWrite: false }));
  const railMaterial = extraMaterial(new MeshStandardMaterial({ color: '#718a96', roughness: 0.25, metalness: 0.82 }));
  const groundMap = palette.marble.map?.clone();
  if (groundMap) {
    groundMap.repeat.set(8, 8);
    groundMap.needsUpdate = true;
    extraTextures.push(groundMap);
  }
  const groundMaterial = extraMaterial(new MeshPhysicalMaterial({
    map: groundMap, color: '#d3c4c7', roughness: 0.3, metalness: 0.02, clearcoat: 0.7, clearcoatRoughness: 0.2,
  }));
  const roomMap = groundMap?.clone();
  if (roomMap) {
    roomMap.repeat.set(3, 3);
    roomMap.needsUpdate = true;
    extraTextures.push(roomMap);
  }
  const roomMarbleMaterial = extraMaterial(new MeshPhysicalMaterial({
    map: roomMap, color: '#c8b8bd', roughness: 0.32, metalness: 0.02, clearcoat: 0.62, clearcoatRoughness: 0.22,
  }));
  const lowerWallMaterial = extraMaterial(new MeshStandardMaterial({ color: '#c8c8c9', roughness: 0.68, metalness: 0.02 }));
  const accentWallMaterial = extraMaterial(new MeshStandardMaterial({ color: '#60717e', roughness: 0.5, metalness: 0.16 }));
  const displayWallMaterial = extraMaterial(new MeshStandardMaterial({ color: '#27394d', roughness: 0.48, metalness: 0.2 }));
  const glassBaseMaterial = extraMaterial(new MeshStandardMaterial({
    color: '#8da5b0', transparent: true, opacity: 0.24, roughness: 0.55, side: DoubleSide, depthWrite: false,
  }));
  const contactShadow = extraMaterial(new MeshBasicMaterial({
    color: '#26313a', transparent: true, opacity: 0.11, side: DoubleSide, depthWrite: false,
  }));
  const medallionGlow = extraMaterial(new MeshBasicMaterial({
    color: '#fff1d2', transparent: true, opacity: 0.92, toneMapped: false,
  }));

  const renderer = new WebGLRenderer({ antialias: quality === 'high', alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
  renderer.setClearColor(new Color('#d9e2e6'), 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'application');
  renderer.domElement.setAttribute('aria-label', 'WORA exact-reference interactive 3D company office');
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color('#d9e2e6');

  const initialWidth = Math.max(1, container.clientWidth);
  const initialHeight = Math.max(1, container.clientHeight);
  const initialAspect = initialWidth / initialHeight;
  const camera = makeReferenceCamera(initialAspect);
  const worldPerPixel = worldUnitsPerPixel(camera, initialWidth, initialHeight);
  const unit = (pixels: number): number => pixels * worldPerPixel;
  const wallHeight = unit(104);
  const robotScale = unit(74) / 1.78;
  const deskScale = unit(76) / 1.42;
  const plantScale = unit(46) / 2;
  const screenWidth = unit(124);
  const screenHeight = unit(70);

  let cameraTarget = REFERENCE_CAMERA_TARGET.clone();
  let cameraScale = 1;
  let viewMode: 'full' | 'room' | 'agent' | 'spot' = 'full';
  function setCamera(target: Vector3, scale: number): void {
    cameraTarget.copy(target);
    cameraScale = MathUtils.clamp(scale, 0.36, 1.18);
    applyReferenceCamera(camera, cameraTarget, cameraScale);
  }

  const labelLayer = document.createElement('div');
  labelLayer.className = 'office3d-labels';
  labelLayer.setAttribute('aria-label', 'Exact-reference office room labels');
  const medallionLabel = document.createElement('div');
  medallionLabel.className = 'office3d-medallion-label';
  medallionLabel.dir = 'ltr';
  medallionLabel.setAttribute('aria-hidden', 'true');
  medallionLabel.innerHTML = '<svg viewBox="0 0 120 58" aria-hidden="true"><path d="M8 17c17-18 35-16 48 0 11-10 22-10 31 0 8 9 5 22-5 28-12 7-24 1-33-8-10 11-23 15-35 7-10-7-13-20-6-27Z" fill="#1fc3e0"/><path d="M60 17c-13-16-31-18-48 0-7 8-4 20 6 27 12 8 25 4 35-7 9 9 21 15 33 8 10-6 13-19 5-28-9-10-20-10-31 0Z" fill="#168bd7" opacity=".42"/></svg><strong>WORA</strong>';
  labelLayer.appendChild(medallionLabel);

  const referenceRooms = buildReferenceRooms(camera, initialWidth, initialHeight);
  const visualRooms = new Map(referenceRooms.map((room) => [room.definition.id, room] as const));
  const roomLabels: RoomLabel[] = referenceRooms.map((room) => {
    const definition = room.definition;
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'office3d-room-label';
    element.dataset.roomId = definition.id;
    element.dataset.logicalRoomId = definition.primaryLogicalRoomId;
    element.dir = 'ltr';
    element.style.width = `${definition.labelWidth}px`;
    element.style.setProperty('--label-rotation', `${definition.labelRotation}deg`);
    element.setAttribute('aria-label', `${definition.label} — ${definition.labelAr}`);
    const title = document.createElement('strong');
    title.textContent = definition.label;
    const subtitle = document.createElement('small');
    subtitle.dir = 'rtl';
    subtitle.setAttribute('aria-hidden', 'true');
    subtitle.textContent = definition.labelAr;
    element.append(iconSvg(definition.icon), title, subtitle);
    const onSelect = () => {
      focusRoom(definition.primaryLogicalRoomId);
      onRoom(definition.primaryLogicalRoomId);
      onInspect({
        kind: 'department', id: definition.primaryLogicalRoomId,
        roomId: definition.primaryLogicalRoomId, label: definition.label,
      });
    };
    element.addEventListener('click', onSelect);
    labelLayer.appendChild(element);
    return {
      visualId: definition.id,
      logicalRoomId: definition.primaryLogicalRoomId,
      definition,
      element,
      anchor: room.labelPoint,
      onSelect,
    };
  });
  container.appendChild(labelLayer);

  const environmentLayer = new Group();
  const roomLayer = new Group();
  const robotLayer = new Group();
  environmentLayer.name = 'grounded-reference-environment';
  environmentLayer.userData.ignoreRaycast = true;
  scene.add(environmentLayer, roomLayer, robotLayer);

  const roomHighlights = new Map<string, Mesh>();
  const spotPositions = new Map<string, Vector3>();
  const spotRoomIds = new Map<string, string>();
  const robots = new Map<string, RobotVisual>();
  const primaryRobots = new Map<string, RobotRecord>();
  const robotAgents = new Map<string, AgentParticipant>();
  const visualAgentIds = new Map<string, string>();
  const visualRecordsByAgent = new Map<string, string[]>();
  const robotLocations = new Map<string, AgentMotionSnapshot>();
  const manualPositions = new Map<string, WorldPoint>();
  const manualRotations = new Map<string, number>();
  const factory = createRobotFactory(palette);
  let selectedRoomId: string | null = options.selectedRoomId;
  let selectedVisualRoomId: string | null = null;
  let selectedAgentId: string | null = options.focusedAgentId;
  let currentAgents = options.agents;
  let currentTasks = options.tasks;
  let currentCommandAgentIds: ReadonlySet<string> = options.commandAgentIds ?? new Set<string>();
  let movementActiveIds: ReadonlySet<string> = new Set<string>();
  let agentSignature = '';
  let tween: CameraTween | null = null;
  let destroyed = false;

  function atScreen(point: ScreenPoint): Vector3 {
    return screenToFloor(point, camera, initialWidth, initialHeight);
  }
  function facingCamera(point: Vector3): number {
    return Math.atan2(camera.position.x - point.x, camera.position.z - point.z);
  }
  function edgePlacement(a: Vector3, b: Vector3): { x: number; z: number; length: number; ry: number; direction: Vector3 } {
    const delta = b.clone().sub(a);
    return {
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      length: Math.max(0.001, Math.hypot(delta.x, delta.z)),
      ry: Math.atan2(-delta.z, delta.x),
      direction: delta.setY(0).normalize(),
    };
  }
  function edgeBox(
    parent: Object3D, a: Vector3, b: Vector3, width: number, height: number, depth: number,
    material: Material, yOffset: number, shadows = true,
  ): Mesh {
    const edge = edgePlacement(a, b);
    return add(parent, cache.box(edge.length * width, height, depth), material, {
      x: edge.x, y: FLOOR_Y + yOffset, z: edge.z, ry: edge.ry,
    }, shadows);
  }

  function plant(parent: Object3D, point: Vector3, scale = plantScale): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y, point.z);
    group.scale.setScalar(scale);
    add(group, cache.cylinder(0.31, 0.39, 0.42, 20), palette.woodDark, { y: 0.21 });
    add(group, cache.circle(0.3), palette.soil, { y: 0.425, rx: -Math.PI / 2, cast: false });
    add(group, cache.cylinder(0.055, 0.085, 1.05, 10), palette.woodDark, { y: 0.92 });
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const leaf = add(group, cache.ico(0.42, 1), i % 2 ? palette.leaf : palette.leafDark, {
        x: Math.cos(angle) * 0.38, y: 1.35 + (i % 3) * 0.18, z: Math.sin(angle) * 0.38,
      });
      leaf.scale.set(1, 0.78, 1);
    }
    add(group, cache.ico(0.52, 1), palette.leaf, { y: 1.78 }).scale.set(1.1, 0.9, 1.1);
    parent.add(group);
  }

  function chair(parent: Object3D, x: number, z: number): void {
    const group = new Group();
    group.position.set(x, 0, z);
    add(group, cache.rounded(0.48, 0.1, 0.48, 0.05), palette.robotDark, { y: 0.52 });
    const back = add(group, cache.rounded(0.46, 0.62, 0.09, 0.07), palette.robotDark, { y: 0.86, z: 0.24 });
    back.rotation.x = -0.12;
    add(group, cache.cylinder(0.055, 0.07, 0.35, 12), palette.metal, { y: 0.26 });
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      add(group, cache.box(0.34, 0.035, 0.035), palette.metal, {
        x: Math.cos(angle) * 0.16, y: 0.1, z: Math.sin(angle) * 0.16, ry: -angle, rz: Math.PI / 2, cast: false,
      });
      add(group, cache.sphere(0.045, 10), palette.robotDark, { x: Math.cos(angle) * 0.34, y: 0.055, z: Math.sin(angle) * 0.34 });
    }
    parent.add(group);
  }

  function monitor(group: Group, x: number, z: number, variant: ScreenVariant, workstationId: string, index: number): void {
    const screen = new Group();
    screen.position.set(x, 0, z);
    screen.userData.workstationId = workstationId;
    screen.userData.roomId = group.userData.roomId ?? '';
    add(screen, cache.box(0.5, 0.05, 0.36), palette.screenFrame, { y: 1.15, z: -0.26 });
    add(screen, cache.box(0.07, 0.22, 0.07), palette.metal, { y: 0.9, z: -0.26 });
    const display = add(screen, cache.plane(0.68, 0.42), palette.screenMaterial(variant), {
      y: 1.15, z: -0.22, cast: false, receive: false, renderOrder: 1,
    });
    display.userData.screenId = `${workstationId}-screen-${index}`;
    display.userData.screenLabel = `${String(group.userData.workstationLabel ?? 'Workstation')} display`;
    screen.userData.screenId = display.userData.screenId;
    screen.userData.screenLabel = display.userData.screenLabel;
    group.add(screen);
  }

  function desk(
    parent: Object3D,
    point: Vector3,
    rotation: number,
    variant: ScreenVariant,
    workstationId: string,
    workstationLabel: string,
    logicalRoomId: string,
  ): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y, point.z);
    group.rotation.y = rotation;
    group.scale.setScalar(deskScale);
    group.userData.workstationId = workstationId;
    group.userData.workstationLabel = workstationLabel;
    group.userData.roomId = logicalRoomId;
    group.userData.visualRoomId = visualRoomForLogical(logicalRoomId) ?? '';
    const shadowDisc = add(group, cache.circle(1.05), contactShadow, {
      y: 0.012, rx: -Math.PI / 2, cast: false, receive: false, renderOrder: 1,
    });
    shadowDisc.scale.set(1.15, 0.82, 1);
    add(group, cache.rounded(1.42, 0.09, 0.72, 0.05), palette.wood, { y: 0.72 });
    for (const dx of [-0.61, 0.61]) for (const dz of [-0.27, 0.27]) {
      add(group, cache.box(0.055, 0.68, 0.055), palette.metal, { x: dx, y: 0.36, z: dz });
    }
    add(group, cache.rounded(0.34, 0.48, 0.52, 0.04), palette.white, { x: 0.52, y: 0.45, z: 0.04 });
    add(group, cache.box(0.3, 0.025, 0.02), palette.metal, { x: 0.52, y: 0.62, z: -0.23 });
    monitor(group, -0.22, -0.14, variant, workstationId, 1);
    monitor(group, 0.24, -0.12, variant, workstationId, 2);
    add(group, cache.rounded(0.48, 0.025, 0.14, 0.02), palette.robotDark, { y: 0.775, z: 0.12 });
    add(group, cache.rounded(0.08, 0.035, 0.12, 0.03), palette.robotDark, { x: 0.36, y: 0.78, z: 0.12 });
    add(group, cache.cylinder(0.055, 0.045, 0.1, 14), palette.white, { x: -0.49, y: 0.82, z: 0.15 });
    add(group, cache.rounded(0.22, 0.012, 0.3, 0.01), palette.paper, { x: -0.4, y: 0.775, z: -0.1, rz: 0.08 });
    chair(group, 0, 0.74);
    parent.add(group);
    spotPositions.set(workstationId, point.clone());
    spotRoomIds.set(workstationId, logicalRoomId);
  }

  function screenBoard(
    parent: Object3D, point: Vector3, variant: ScreenVariant,
    workstationId: string, logicalRoomId: string, width = screenWidth, height = screenHeight,
  ): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y + unit(58), point.z);
    group.rotation.y = facingCamera(point);
    group.userData.roomId = logicalRoomId;
    group.userData.visualRoomId = visualRoomForLogical(logicalRoomId) ?? '';
    add(group, cache.rounded(width + unit(8), height + unit(8), unit(4), unit(2)), palette.screenFrame, { z: -unit(2) });
    const display = add(group, cache.plane(width, height), palette.screenMaterial(variant), {
      z: unit(1), cast: false, receive: false, renderOrder: 2,
    });
    display.userData.screenId = `${workstationId}-screen`;
    display.userData.screenLabel = `${workstationId} wall display`;
    add(group, cache.box(width * 0.5, unit(3), unit(3)), palette.metal, { y: -height / 2 - unit(4) });
    parent.add(group);
    spotPositions.set(workstationId, point.clone());
    spotRoomIds.set(workstationId, logicalRoomId);
  }

  function shelf(parent: Object3D, a: Vector3, b: Vector3): void {
    const edge = edgePlacement(a, b);
    const group = new Group();
    group.position.set(edge.x, FLOOR_Y, edge.z);
    group.rotation.y = edge.ry;
    const width = Math.min(unit(78), edge.length * 0.52);
    add(group, cache.box(width, unit(66), unit(4)), palette.woodDark, { y: unit(35) });
    for (let level = 0; level < 3; level += 1) {
      add(group, cache.box(width * 0.94, unit(2), unit(7)), palette.wood, { y: unit(20 + level * 20), z: unit(3) });
      for (let i = 0; i < 7; i += 1) {
        add(group, cache.box(unit(5), unit(15), unit(5)), i % 2 ? palette.paper : palette.white, {
          x: -width * 0.4 + i * (width * 0.8 / 6), y: unit(27 + level * 20), z: unit(4),
        });
      }
    }
    parent.add(group);
  }

  function serverRack(parent: Object3D, point: Vector3, rotation: number): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y, point.z);
    group.rotation.y = rotation;
    add(group, cache.rounded(unit(34), unit(100), unit(30), unit(3)), palette.robotDark, { y: unit(50) });
    for (let i = 0; i < 9; i += 1) {
      add(group, cache.box(unit(26), unit(5), unit(2)), palette.metal, { y: unit(14 + i * 9), z: unit(16), cast: false });
      add(group, cache.box(unit(5), unit(2), unit(1)), palette.cyanGlow, { x: -unit(9), y: unit(14 + i * 9), z: unit(17), cast: false });
    }
    parent.add(group);
  }

  function conferenceTable(parent: Object3D, point: Vector3, rotation: number, logicalRoomId: string): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y, point.z);
    group.rotation.y = rotation;
    group.userData.meetingId = `${logicalRoomId}-meeting`;
    group.userData.meetingLabel = 'Management';
    group.userData.roomId = logicalRoomId;
    group.userData.visualRoomId = 'management';
    add(group, cache.rounded(unit(185), unit(7), unit(76), unit(4)), palette.wood, { y: unit(42) });
    for (const x of [-unit(70), unit(70)]) for (const z of [-unit(25), unit(25)]) {
      add(group, cache.box(unit(4), unit(40), unit(4)), palette.metal, { x, y: unit(20), z });
    }
    for (const x of [-unit(60), -unit(20), unit(20), unit(60)]) {
      for (const z of [-unit(58), unit(58)]) chair(group, x, z);
      add(group, cache.rounded(unit(14), unit(2), unit(7), unit(1)), palette.paper, { x, y: unit(46), z: -unit(12) });
    }
    parent.add(group);
    spotPositions.set(`${logicalRoomId}-meeting`, point.clone());
    spotRoomIds.set(`${logicalRoomId}-meeting`, logicalRoomId);
  }

  function executiveDesk(parent: Object3D, point: Vector3, rotation: number, logicalRoomId: string): void {
    const group = new Group();
    group.position.set(point.x, FLOOR_Y, point.z);
    group.rotation.y = rotation;
    group.userData.meetingId = `${logicalRoomId}-meeting`;
    group.userData.meetingLabel = 'Executive Office';
    group.userData.roomId = logicalRoomId;
    group.userData.visualRoomId = 'executive';
    add(group, cache.rounded(unit(150), unit(9), unit(72), unit(5)), palette.wood, { y: unit(43) });
    for (const x of [-unit(60), unit(60)]) for (const z of [-unit(26), unit(26)]) {
      add(group, cache.box(unit(5), unit(40), unit(5)), palette.metal, { x, y: unit(20), z });
    }
    add(group, cache.circle(unit(95)), palette.rug, { y: unit(1), rx: -Math.PI / 2, cast: false });
    add(group, cache.box(unit(46), unit(4), unit(30)), palette.screenFrame, { y: unit(70), z: -unit(18) });
    add(group, cache.plane(unit(54), unit(34)), palette.screenMaterial('plan'), { y: unit(70), z: -unit(15), cast: false, receive: false });
    chair(group, 0, unit(58));
    for (const x of [-unit(62), unit(62)]) add(group, cache.rounded(unit(22), unit(34), unit(26), unit(3)), palette.sofa, { x, y: unit(26), z: unit(88) });
    parent.add(group);
    spotPositions.set(`${logicalRoomId}-meeting`, point.clone());
    spotRoomIds.set(`${logicalRoomId}-meeting`, logicalRoomId);
  }

  function accentBackEdge(parent: Object3D, a: Vector3, b: Vector3, roomId: string): void {
    const edge = edgePlacement(a, b);
    const lowerHeight = wallHeight * 0.72;
    const upperHeight = wallHeight * 0.28;
    const wooden = roomId === 'executive';
    const wallMaterial = wooden ? palette.woodSlat
      : roomId === 'creative' || roomId === 'research' ? lowerWallMaterial
        : roomId === 'qa' ? displayWallMaterial : accentWallMaterial;
    add(parent, cache.box(edge.length, lowerHeight, unit(3)), wallMaterial, {
      x: edge.x, y: FLOOR_Y + lowerHeight / 2, z: edge.z, ry: edge.ry, cast: false, receive: true,
    });
    add(parent, cache.box(edge.length, upperHeight, unit(2)), palette.glass, {
      x: edge.x, y: FLOOR_Y + lowerHeight + upperHeight / 2, z: edge.z, ry: edge.ry,
      cast: false, receive: false,
    });
    edgeBox(parent, a, b, 1, unit(1.5), unit(3), palette.frame, wallHeight, false);
    edgeBox(parent, a, b, 1, unit(1.5), unit(3), palette.frame, lowerHeight, false);
    edgeBox(parent, a, b, 1, unit(2.2), unit(4), warmStrip, unit(2), false);
    for (let i = 1; i <= 3; i += 1) {
      const t = i / 4;
      const p = a.clone().lerp(b, t);
      add(parent, cache.box(unit(1.5), lowerHeight * 0.82, unit(1.5)), warmStrip, {
        x: p.x, y: FLOOR_Y + lowerHeight * 0.45, z: p.z, ry: edge.ry, cast: false, receive: false,
      });
    }
    if (wooden) {
      const slatCount = Math.max(6, Math.floor(edge.length / unit(18)));
      for (let i = 1; i < slatCount; i += 1) {
        const t = i / slatCount;
        const p = a.clone().lerp(b, t);
        add(parent, cache.box(unit(1.5), lowerHeight * 0.9, unit(2)), palette.wood, {
          x: p.x, y: FLOOR_Y + lowerHeight * 0.45, z: p.z, ry: edge.ry,
        });
      }
    }
  }

  function glassEdge(parent: Object3D, a: Vector3, b: Vector3, withDoor: boolean): void {
    const edge = edgePlacement(a, b);
    const gap = withDoor ? Math.min(unit(55), edge.length * 0.22) : 0;
    const panelLength = (edge.length - gap) / 2;
    const center = new Vector3(edge.x, 0, edge.z);
    const direction = edge.direction;
    for (const side of [-1, 1]) {
      const panelCenter = center.clone().add(direction.clone().multiplyScalar(side * (gap / 2 + panelLength / 2)));
      const panelA = panelCenter.clone().add(direction.clone().multiplyScalar(-panelLength / 2));
      const panelB = panelCenter.clone().add(direction.clone().multiplyScalar(panelLength / 2));
      edgeBox(parent, panelA, panelB, 1, wallHeight * 0.76, unit(2), palette.glass, wallHeight * 0.5, false);
      edgeBox(parent, panelA, panelB, 1, unit(1.5), unit(3), palette.frame, wallHeight, false);
      edgeBox(parent, panelA, panelB, 1, unit(1.5), unit(3), palette.frame, unit(3), false);
      edgeBox(parent, panelA, panelB, 1, unit(1.2), unit(2), palette.frame, wallHeight * 0.5, false);
      edgeBox(parent, panelA, panelB, 1, wallHeight * 0.12, unit(3), glassBaseMaterial, wallHeight * 0.06, false);
    }
    const posts = withDoor
      ? [0, -gap / 2 - panelLength, gap / 2 + panelLength, edge.length / 2, -edge.length / 2]
      : [-edge.length / 2, -edge.length / 4, 0, edge.length / 4, edge.length / 2];
    for (const offset of posts) {
      const p = center.clone().add(direction.clone().multiplyScalar(offset));
      add(parent, cache.box(unit(1.5), wallHeight, unit(1.5)), palette.frame, {
        x: p.x, y: FLOOR_Y + wallHeight / 2, z: p.z, ry: edge.ry, cast: false,
      });
    }
    edgeBox(parent, a, b, 1, unit(2.2), unit(4), warmStrip, unit(1), false);
  }

  function roomFloor(parent: Group, room: ReferenceRoomWorld): Mesh {
    const geometry = makeFloorGeometry(room);
    customGeometries.push(geometry);
    const material = room.definition.floor === 'wood' ? palette.floorWood : roomMarbleMaterial;
    add(parent, geometry, material, { y: FLOOR_Y, cast: false, receive: true });
    const highlightMaterial = extraMaterial(new MeshBasicMaterial({
      color: new Color(room.definition.accent), transparent: true, opacity: 0.17, side: DoubleSide, depthWrite: false,
    }));
    const selection = add(parent, geometry, highlightMaterial, { y: FLOOR_Y + unit(2), cast: false, receive: false, renderOrder: 2 });
    selection.userData.ignoreRaycast = true;
    selection.visible = false;
    roomHighlights.set(room.definition.id, selection);
    return selection;
  }

  function createRoom(room: ReferenceRoomWorld): void {
    const definition = room.definition;
    const group = new Group();
    group.name = `reference-room-${definition.id}`;
    group.userData.roomId = definition.primaryLogicalRoomId;
    group.userData.visualRoomId = definition.id;
    group.position.copy(room.center);
    group.rotation.set(0, room.rotation, 0);
    roomLayer.add(group);
    roomFloor(group, room);

    const [p0, p1, p2, p3] = room.points as [Vector3, Vector3, Vector3, Vector3];
    const walls = new Group();
    walls.name = 'non-pickable-glass-partitions';
    walls.userData.ignoreRaycast = true;
    roomLayer.add(walls);
    accentBackEdge(walls, p0, p1, definition.id);
    accentBackEdge(walls, p1, p2, definition.id);
    glassEdge(walls, p2, p3, true);
    glassEdge(walls, p3, p0, true);

    const logicalRoomIds = logicalRoomsForVisual(definition.id);
    const workstationSpots = ROOM_SPOTS.filter((spot) => logicalRoomIds.includes(spot.roomId));
    const deskPoints = REFERENCE_DESK_POINTS[definition.id] ?? [];
    if (definition.furniture === 'management') {
      conferenceTable(roomLayer, atScreen(deskPoints[0] ?? [1480, 550]), room.rotation, definition.primaryLogicalRoomId);
    } else if (definition.furniture === 'executive') {
      executiveDesk(roomLayer, atScreen(deskPoints[0] ?? [870, 245]), room.rotation, definition.primaryLogicalRoomId);
    } else {
      deskPoints.forEach((screenPoint, index) => {
        const spot = workstationSpots[index];
        const workstationId = spot?.id ?? `${definition.id}-desk-${index + 1}`;
        desk(
          roomLayer, atScreen(screenPoint), room.rotation, definition.displayVariant,
          workstationId, spot?.labelAr ?? `${definition.label} workstation ${index + 1}`,
          spot?.roomId ?? definition.primaryLogicalRoomId,
        );
      });
    }
    (REFERENCE_DISPLAY_POINTS[definition.id] ?? []).forEach((screenPoint, index) => {
      const point = atScreen(screenPoint);
      screenBoard(
        roomLayer, point, index % 2 === 1 ? 'plan' : definition.displayVariant,
        `${definition.id}-display-${index + 1}`, definition.primaryLogicalRoomId,
        definition.furniture === 'executive' ? unit(70) : screenWidth,
        definition.furniture === 'executive' ? unit(44) : screenHeight,
      );
    });
    shelf(roomLayer, p0, p1);
    if (definition.id === 'qa') {
      const backCenter = p0.clone().lerp(p1, 0.5);
      serverRack(roomLayer, p1.clone().lerp(p2, 0.22), room.rotation);
      serverRack(roomLayer, p1.clone().lerp(p2, 0.72), room.rotation);
      void backCenter;
    }
    if (definition.id === 'engineering') {
      const backCenter = p1.clone().lerp(p2, 0.78);
      serverRack(roomLayer, backCenter, room.rotation);
    }
  }

  /** Grounded full-bleed floor and perimeter glazing; the office is not a floating island. */
  function createGround(): void {
    add(environmentLayer, cache.plane(120, 120), groundMaterial, {
      y: FLOOR_Y - unit(3), rx: -Math.PI / 2, cast: false, receive: true,
    });
    // The floor and exterior planting continue beyond the frame; there is no floating island.
    for (const point of [[280, 70], [420, 35], [1370, 70], [1510, 95], [280, 860], [1590, 850], [240, 750], [1640, 760]] as ScreenPoint[]) {
      plant(environmentLayer, atScreen(point), plantScale * 1.25);
    }
  }

  /** Continuous warm corridor edges and lobby railing from the reference. */
  function createCorridors(): void {
    const railPoints = REFERENCE_RAIL_POINTS.map((point) => atScreen(point));
    for (let i = 0; i < railPoints.length - 1; i += 1) {
      const a = railPoints[i]!;
      const b = railPoints[i + 1]!;
      edgeBox(environmentLayer, a, b, 1, unit(1), unit(1), railMaterial, unit(34), false);
      edgeBox(environmentLayer, a, b, 1, unit(1), unit(1), warmStrip, unit(2), false);
      add(environmentLayer, cache.cylinder(unit(1.2), unit(1.2), unit(38), 10), railMaterial, {
        x: a.x, y: FLOOR_Y + unit(19), z: a.z, cast: false,
      });
    }
    for (const room of referenceRooms) {
      const a = room.points[3]!;
      const b = room.points[2]!;
      edgeBox(environmentLayer, a, b, 1, unit(2.6), unit(3), warmStrip, unit(1), false);
      edgeBox(environmentLayer, a, b, 1, unit(1), unit(1), corridorLine, unit(3), false);
    }
  }

  function createLobby(): void {
    const medallion = atScreen(REFERENCE_FEATURE_POINTS.medallion);
    medallion.y = FLOOR_Y + unit(1);
    add(environmentLayer, cache.circle(unit(190)), roomMarbleMaterial, {
      x: medallion.x, y: FLOOR_Y + unit(1), z: medallion.z, rx: -Math.PI / 2, cast: false, receive: true,
    });
    add(environmentLayer, cache.torus(unit(190), unit(6)), warmStrip, {
      x: medallion.x, y: FLOOR_Y + unit(2), z: medallion.z, rx: Math.PI / 2, cast: false, receive: false,
    });
    add(environmentLayer, cache.torus(unit(197), unit(2)), medallionGlow, {
      x: medallion.x, y: FLOOR_Y + unit(2.4), z: medallion.z, rx: Math.PI / 2, cast: false, receive: false,
    });
    add(environmentLayer, cache.torus(unit(180), unit(1)), palette.cyanGlow, {
      x: medallion.x, y: FLOOR_Y + unit(2.2), z: medallion.z, rx: Math.PI / 2, cast: false, receive: false,
    });

    const planter = atScreen(REFERENCE_FEATURE_POINTS.planter);
    add(environmentLayer, cache.cylinder(unit(55), unit(58), unit(28), 40), palette.white, {
      x: planter.x, y: FLOOR_Y + unit(14), z: planter.z,
    });
    add(environmentLayer, cache.circle(unit(53)), palette.leaf, {
      x: planter.x, y: FLOOR_Y + unit(29), z: planter.z, rx: -Math.PI / 2, cast: false,
    });
    add(environmentLayer, cache.cylinder(unit(6), unit(9), unit(54), 12), palette.woodDark, {
      x: planter.x, y: FLOOR_Y + unit(50), z: planter.z,
    });
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      add(environmentLayer, cache.ico(unit(5), 1), i % 2 ? palette.leaf : palette.leafDark, {
        x: planter.x + Math.cos(angle) * unit(32),
        y: FLOOR_Y + unit(31),
        z: planter.z + Math.sin(angle) * unit(32),
      });
    }
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      add(environmentLayer, cache.cylinder(unit(2), unit(4), unit(38), 8), palette.woodDark, {
        x: planter.x + Math.cos(angle) * unit(16),
        y: FLOOR_Y + unit(58),
        z: planter.z + Math.sin(angle) * unit(16),
        rz: Math.PI / 2,
        ry: angle,
      });
    }
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2;
      const radius = unit(16 + (i % 5) * 13);
      const leaf = add(environmentLayer, cache.ico(unit(17), 1), i % 4 === 0 ? palette.leafDark : palette.leaf, {
        x: planter.x + Math.cos(angle) * radius,
        y: FLOOR_Y + unit(62 + (i % 4) * 7),
        z: planter.z + Math.sin(angle) * radius,
      });
      leaf.scale.set(1.4, 0.72, 1.4);
    }

    for (const [screenPoint, arc] of [[REFERENCE_FEATURE_POINTS.sofaLeft, Math.PI * 1.15], [REFERENCE_FEATURE_POINTS.sofaRight, Math.PI * 1.1]] as const) {
      const point = atScreen(screenPoint);
      const sofa = add(environmentLayer, cache.torus(unit(58), unit(11), arc), screenPoint[0] === REFERENCE_FEATURE_POINTS.sofaLeft[0] ? palette.sofaBrown : palette.sofa, {
        x: point.x, y: FLOOR_Y + unit(20), z: point.z, rx: Math.PI / 2, ry: facingCamera(point),
      });
      sofa.scale.set(1, 1, 0.62);
    }
    const leftSofa = atScreen(REFERENCE_FEATURE_POINTS.sofaLeft);
    add(environmentLayer, cache.circle(unit(52)), palette.sofa, {
      x: leftSofa.x, y: FLOOR_Y + unit(1), z: leftSofa.z, rx: -Math.PI / 2, cast: false, receive: true,
    }).scale.set(1.25, 0.72, 1);
    for (const screenPoint of REFERENCE_PLANT_POINTS) plant(environmentLayer, atScreen(screenPoint), plantScale * 0.82);
  }

  function createLights(): void {
    scene.add(new HemisphereLight(0xe8f6ff, 0x46595a, 1.25));
    scene.add(new AmbientLight(0xffffff, 0.42));
    const sun = new DirectionalLight(0xfff2dc, 1.85);
    sun.position.set(-16, 34, 22);
    sun.castShadow = quality === 'high';
    if (quality === 'high') {
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -38;
      sun.shadow.camera.right = 38;
      sun.shadow.camera.top = 34;
      sun.shadow.camera.bottom = -34;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 100;
      sun.shadow.bias = -0.0004;
    }
    scene.add(sun);
    for (const [x, z] of [[-18, -16], [12, -20], [-18, 10], [18, 6]] as const) {
      const light = new PointLight(0xffca83, 7, 18, 2);
      light.position.set(x, unit(150), z);
      scene.add(light);
    }
    const lobbyLight = new PointLight(0x6bdcf2, 6, 18, 2);
    lobbyLight.position.set(0, unit(160), 0);
    scene.add(lobbyLight);
  }

  createGround();
  createCorridors();
  createLobby();
  for (const room of referenceRooms) createRoom(room);
  createLights();

  const agentRing = add(scene, cache.torus(unit(22), unit(2)), selectionRingMaterial, {
    y: FLOOR_Y + unit(2), rx: Math.PI / 2, cast: false, receive: false, renderOrder: 5,
  });
  agentRing.visible = false;

  function setSelectedAgent(agentId: string | null): void {
    selectedAgentId = agentId && primaryRobots.has(agentId) ? agentId : null;
    agentRing.visible = Boolean(selectedAgentId);
  }

  function setSelectedRoom(roomId: string | null): void {
    selectedRoomId = roomId;
    selectedVisualRoomId = visualRoomForLogical(roomId);
    for (const [id, highlight] of roomHighlights) highlight.visible = id === selectedVisualRoomId;
    for (const label of roomLabels) label.element.classList.toggle('is-selected', label.visualId === selectedVisualRoomId);
  }

  function updateLabels(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const visibleRects: { left: number; right: number; top: number; bottom: number }[] = [];
    camera.updateMatrixWorld();
    const viewportScale = width < 1600 ? MathUtils.clamp(width / REFERENCE_VIEWPORT.width, 0.76, 1) : 1;
    const labelScale = MathUtils.clamp(viewportScale / cameraScale, 0.76, 1.65);
    const sidebarSafe = width <= 1500 ? 190 : 217;
    for (const label of roomLabels) {
      const anchor = projectToViewport(label.anchor, camera, width, height);
      const labelWidth = label.definition.labelWidth * labelScale;
      const labelHeight = (label.element.offsetHeight || 44) * labelScale;
      const displayX = width < 1600
        ? MathUtils.clamp(anchor.x, sidebarSafe + labelWidth / 2 + 4, width - 12 - labelWidth / 2)
        : anchor.x;
      const displayY = width < 1600 ? MathUtils.clamp(anchor.y, 145, height - 100) : anchor.y;
      const inView = anchor.z >= -1 && anchor.z <= 1
        && anchor.x >= -80 && anchor.x <= width + 80
        && anchor.y >= 15 && anchor.y <= height + 80;
      const hiddenByFocus = viewMode !== 'full' && Boolean(selectedVisualRoomId) && label.visualId !== selectedVisualRoomId;
      label.element.hidden = !inView || hiddenByFocus;
      label.element.style.width = `${label.definition.labelWidth}px`;
      label.element.style.left = `${displayX}px`;
      label.element.style.top = `${displayY}px`;
      label.element.style.transform = `translate(-50%, -50%) rotate(${label.definition.labelRotation}deg) scale(${labelScale})`;
      if (!label.element.hidden) {
        visibleRects.push({
          left: displayX - labelWidth / 2, right: displayX + labelWidth / 2,
          top: displayY - labelHeight, bottom: displayY,
        });
      }
    }
    const medallion = projectToViewport(atScreen(REFERENCE_FEATURE_POINTS.medallion), camera, width, height);
    const medallionWidth = 230 * labelScale;
    const medallionHeight = 90 * labelScale;
    const medallionRect = {
      left: medallion.x - medallionWidth / 2, right: medallion.x + medallionWidth / 2,
      top: medallion.y - medallionHeight / 2, bottom: medallion.y + medallionHeight / 2,
    };
    const overlapsRoomLabel = visibleRects.some((rect) => rectanglesOverlap(medallionRect, rect, 3));
    medallionLabel.hidden = viewMode !== 'full' || overlapsRoomLabel || medallion.z < -1 || medallion.z > 1
      || medallionRect.left < 0 || medallionRect.right > width || medallionRect.top < 0 || medallionRect.bottom > height;
    if (!medallionLabel.hidden) {
      medallionLabel.style.left = `${medallion.x}px`;
      medallionLabel.style.top = `${medallion.y}px`;
      medallionLabel.style.transform = `translate(-50%, -50%) scale(${labelScale})`;
    }
  }

  function moveCamera(
    toTarget: Vector3,
    toScale: number,
    mode: 'full' | 'room' | 'agent' | 'spot',
    immediate = false,
  ): void {
    viewMode = mode;
    if (immediate || reducedMotion) {
      setCamera(toTarget, toScale);
      tween = null;
      return;
    }
    tween = {
      fromTarget: cameraTarget.clone(),
      toTarget: toTarget.clone(),
      fromScale: cameraScale,
      toScale,
      startedAt: performance.now(),
      duration: 760,
    };
  }

  function resetCamera(): void {
    setSelectedRoom(null);
    moveCamera(REFERENCE_CAMERA_TARGET.clone(), 1, 'full');
  }

  function focusRoom(roomId: string | null): void {
    setSelectedRoom(roomId);
    if (!roomId) { resetCamera(); return; }
    const visualId = visualRoomForLogical(roomId);
    const room = visualId ? visualRooms.get(visualId) : undefined;
    if (!room) { resetCamera(); return; }
    const target = room.center.clone().setY(REFERENCE_LABEL_HEIGHT * 0.45);
    moveCamera(target, 0.58, 'room');
  }

  function focusAgent(agentId: string | null): void {
    setSelectedAgent(agentId);
    if (!agentId) { setSelectedRoom(null); return; }
    const record = primaryRobots.get(agentId);
    if (!record) return;
    setSelectedRoom(record.roomId);
    const target = record.group.position.clone().add(new Vector3(0, unit(42), 0));
    moveCamera(target, 0.42, 'agent');
  }

  function focusSpot(spotId: string): void {
    const point = spotPositions.get(spotId);
    if (!point) return;
    setSelectedRoom(spotRoomIds.get(spotId) ?? null);
    moveCamera(point.clone().add(new Vector3(0, unit(34), 0)), 0.5, 'spot');
  }

  function effectiveState(agent: AgentParticipant) {
    return agentVisualState(agent, currentTasks, {
      location: robotLocations.get(agent.id),
      locationAuthorized: currentCommandAgentIds.has(agent.id),
      movementActive: movementActiveIds.has(agent.id),
    });
  }

  function robotPoints(): RobotPoint[] {
    const result: RobotPoint[] = [];
    for (const [visualId, points] of Object.entries(REFERENCE_ROBOT_POINTS)) {
      const logicalRoomId = visualId === 'lobby'
        ? 'zone-lounge'
        : REFERENCE_ROOMS.find((room) => room.id === visualId)?.primaryLogicalRoomId ?? 'zone-lounge';
      for (const screen of points) result.push({ visualId, logicalRoomId, screen, index: result.length });
    }
    return result;
  }

  function createRobotVisual(
    agent: AgentParticipant, point: RobotPoint, primary: boolean, visualId: string,
  ): void {
    const world = atScreen(point.screen);
    const record = factory.create(
      agent, effectiveState(agent), world.x, world.z, facingCamera(world), robotScale,
    );
    record.group.userData.agentId = agent.id;
    record.group.userData.roomId = point.logicalRoomId;
    record.group.userData.visualRoomId = point.visualId;
    record.group.userData.primaryRobot = primary;
    record.roomId = point.logicalRoomId;
    robots.set(visualId, { visualId, agentId: agent.id, record, logicalRoomId: point.logicalRoomId });
    robotAgents.set(visualId, agent);
    visualAgentIds.set(visualId, agent.id);
    const existing = visualRecordsByAgent.get(agent.id) ?? [];
    existing.push(visualId);
    visualRecordsByAgent.set(agent.id, existing);
    if (primary) {
      primaryRobots.set(agent.id, record);
      const manual = manualPositions.get(agent.id);
      if (manual) {
        record.group.position.set(manual.x, FLOOR_Y, manual.z);
        record.group.rotation.y = manualRotations.get(agent.id) ?? record.group.rotation.y;
      }
    }
    robotLayer.add(record.group);
  }

  function rebuildRobots(agents: AgentParticipant[]): void {
    for (const visual of robots.values()) visual.record.dispose();
    robots.clear();
    primaryRobots.clear();
    robotAgents.clear();
    visualAgentIds.clear();
    visualRecordsByAgent.clear();
    if (!agents.length) return;
    const points = robotPoints();
    const used = new Set<number>();
    for (const agent of agents) {
      const preferredVisual = visualRoomForLogical(agent.zoneId ?? null) ?? 'lobby';
      const candidate = points.find((point) => !used.has(point.index)
        && (point.visualId === preferredVisual || point.visualId === 'lobby'));
      const chosen = candidate ?? points.find((point) => !used.has(point.index));
      if (!chosen) break;
      used.add(chosen.index);
      createRobotVisual(agent, chosen, true, `robot-primary-${agent.id}`);
    }
    let duplicate = 0;
    for (const point of points) {
      if (used.has(point.index)) continue;
      const agent = agents[duplicate % agents.length]!;
      createRobotVisual(agent, point, false, `robot-visual-${duplicate}`);
      duplicate += 1;
      used.add(point.index);
    }
  }

  function setAgents(
    nextAgents: AgentParticipant[],
    nextTasks: SharedWorkspaceEntry[],
    nextLocations?: Record<string, AgentMotionSnapshot>,
    nextCommandAgentIds?: ReadonlySet<string>,
  ): void {
    currentAgents = nextAgents;
    currentTasks = nextTasks;
    if (nextLocations) {
      robotLocations.clear();
      for (const [id, location] of Object.entries(nextLocations)) robotLocations.set(id, location);
    }
    if (nextCommandAgentIds) currentCommandAgentIds = nextCommandAgentIds;
    const signature = nextAgents.map((agent) => agent.id).join('|');
    if (signature !== agentSignature) {
      agentSignature = signature;
      rebuildRobots(nextAgents);
    } else {
      for (const [visualId, agentId] of visualAgentIds) {
        const agent = nextAgents.find((candidate) => candidate.id === agentId);
        if (agent) robotAgents.set(visualId, agent);
      }
    }
    for (const [visualId, visual] of robots) {
      const agent = robotAgents.get(visualId);
      if (agent) factory.update(visual.record, effectiveState(agent), performance.now() / 1000, reducedMotion);
    }
    if (selectedAgentId && !primaryRobots.has(selectedAgentId)) setSelectedAgent(null);
  }

  function mapLegacyWorldToReference(point: WorldPoint, targetRoomId?: string | null): WorldPoint {
    const targetVisual = visualRoomForLogical(targetRoomId ?? null);
    let nearest = ROOM_3D_LAYOUTS[0];
    let nearestDistance = Infinity;
    for (const room of ROOM_3D_LAYOUTS) {
      const distance = Math.hypot(point.x - room.centerX, point.z - room.centerZ);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = room; }
    }
    const visualId = targetVisual ?? (nearest ? visualRoomForLogical(nearest.id) : null) ?? 'lobby';
    const visualRoom = visualRooms.get(visualId);
    if (nearest && visualRoom) {
      const scaleX = Math.min(2.4, visualRoom.width / Math.max(nearest.width, 0.001));
      const scaleZ = Math.min(2.4, visualRoom.depth / Math.max(nearest.depth, 0.001));
      const localX = (point.x - nearest.centerX) * scaleX;
      const localZ = (point.z - nearest.centerZ) * scaleZ;
      const mapped = visualRoom.center.clone()
        .add(visualRoom.right.clone().multiplyScalar(localX))
        .add(visualRoom.forward.clone().multiplyScalar(localZ));
      return { x: mapped.x, z: mapped.z };
    }
    const lobby = atScreen(REFERENCE_FEATURE_POINTS.medallion);
    return { x: lobby.x + point.x * unit(22), z: lobby.z + point.z * unit(22) };
  }

  /** Receives only real, authorized office-command positions; never an autonomous roaming generator. */
  function setRobotPositions(positions: Record<string, WorldPoint>): void {
    for (const [agentId, point] of Object.entries(positions)) {
      const record = primaryRobots.get(agentId);
      if (!record) continue;
      const target = mapLegacyWorldToReference(point, robotLocations.get(agentId)?.targetRoomId);
      const previous = manualPositions.get(agentId) ?? { x: record.group.position.x, z: record.group.position.z };
      manualPositions.set(agentId, target);
      const dx = target.x - previous.x;
      const dz = target.z - previous.z;
      if (Math.hypot(dx, dz) > 0.008) manualRotations.set(agentId, Math.atan2(dx, dz));
      record.group.position.set(target.x, FLOOR_Y, target.z);
      record.group.rotation.y = manualRotations.get(agentId) ?? record.group.rotation.y;
      const location = robotLocations.get(agentId);
      if (location?.targetRoomId && ROOM_3D_BY_ID[location.targetRoomId]) {
        record.group.userData.roomId = location.targetRoomId;
        record.roomId = location.targetRoomId;
      }
    }
  }

  function setMovementActive(agentIds: ReadonlySet<string>): void {
    movementActiveIds = agentIds;
  }

  setSelectedRoom(selectedRoomId);
  setAgents(currentAgents, currentTasks, options.locations, options.commandAgentIds);

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    updateReferenceCameraFov(camera, aspect);
    renderer.setSize(width, height, false);
    setCamera(cameraTarget, cameraScale);
    updateLabels();
  }

  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let pointerStart: { x: number; y: number; id: number } | null = null;
  function isIgnoredForPicking(object: Object3D): boolean {
    let node: Object3D | null = object;
    while (node) {
      if (node.userData.ignoreRaycast === true) return true;
      node = node.parent;
    }
    return false;
  }
  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function onPointerUp(event: PointerEvent): void {
    const start = pointerStart;
    pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if (isIgnoredForPicking(hit.object)) continue;
      let node: Object3D | null = hit.object;
      let fallback: { visualId: string; logicalRoomId: string; label: string } | null = null;
      while (node) {
        const agentId = node.userData.agentId;
        if (typeof agentId === 'string' && primaryRobots.has(agentId)) {
          focusAgent(agentId);
          onAgent(agentId);
          onInspect({ kind: 'robot', id: agentId, roomId: primaryRobots.get(agentId)?.roomId ?? '' });
          return;
        }
        const workstationId = node.userData.workstationId;
        if (typeof workstationId === 'string') {
          const logicalRoomId = String(node.userData.roomId ?? spotRoomIds.get(workstationId) ?? '');
          focusSpot(workstationId);
          onInspect({
            kind: 'workstation', id: workstationId, roomId: logicalRoomId,
            label: String(node.userData.workstationLabel ?? workstationId),
          });
          return;
        }
        const screenId = node.userData.screenId;
        if (typeof screenId === 'string') {
          const logicalRoomId = String(node.userData.roomId ?? node.parent?.userData.roomId ?? '');
          onInspect({
            kind: 'screen', id: screenId, roomId: logicalRoomId,
            label: String(node.userData.screenLabel ?? screenId),
          });
          return;
        }
        const meetingId = node.userData.meetingId;
        if (typeof meetingId === 'string') {
          const logicalRoomId = String(node.userData.roomId ?? '');
          focusRoom(logicalRoomId);
          onInspect({
            kind: 'meeting', id: meetingId, roomId: logicalRoomId,
            label: String(node.userData.meetingLabel ?? meetingId),
          });
          return;
        }
        const visualId = node.userData.visualRoomId;
        if (!fallback && typeof visualId === 'string' && roomHighlights.has(visualId)) {
          const definition = REFERENCE_ROOMS.find((room) => room.id === visualId);
          fallback = {
            visualId,
            logicalRoomId: String(node.userData.roomId ?? definition?.primaryLogicalRoomId ?? ''),
            label: definition?.label ?? '',
          };
        }
        node = node.parent;
      }
      if (fallback) {
        focusRoom(fallback.logicalRoomId);
        onRoom(fallback.logicalRoomId);
        onInspect({
          kind: 'department', id: fallback.logicalRoomId, roomId: fallback.logicalRoomId,
          label: fallback.label,
        });
        return;
      }
    }
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  let raf = 0;
  const startedAt = performance.now();
  function frame(now: number): void {
    if (destroyed) return;
    const elapsed = (now - startedAt) / 1000;
    if (tween) {
      const progress = MathUtils.clamp((now - tween.startedAt) / tween.duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const target = new Vector3().lerpVectors(tween.fromTarget, tween.toTarget, eased);
      setCamera(target, MathUtils.lerp(tween.fromScale, tween.toScale, eased));
      if (progress >= 1) tween = null;
    }
    camera.updateMatrixWorld();
    updateLabels();
    for (const [visualId, visual] of robots) {
      const agent = robotAgents.get(visualId);
      if (agent) factory.update(visual.record, effectiveState(agent), elapsed, reducedMotion);
    }
    if (selectedAgentId) {
      const record = primaryRobots.get(selectedAgentId);
      if (record) {
        agentRing.position.set(record.group.position.x, FLOOR_Y + unit(2), record.group.position.z);
        agentRing.rotation.z = elapsed * 0.55;
      }
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  if (options.focusedAgentId) focusAgent(options.focusedAgentId);
  else if (options.selectedRoomId) focusRoom(options.selectedRoomId);

  return {
    focusRoom,
    focusAgent,
    focusSpot,
    resetCamera,
    setAgents,
    setRobotPositions,
    setMovementActive,
    setSelectedRoom,
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      for (const label of roomLabels) label.element.removeEventListener('click', label.onSelect);
      labelLayer.remove();
      for (const visual of robots.values()) visual.record.dispose();
      robots.clear();
      primaryRobots.clear();
      factory.dispose();
      cache.dispose();
      for (const geometry of customGeometries) geometry.dispose();
      for (const material of extraMaterials) material.dispose();
      for (const texture of extraTextures) texture.dispose();
      palette.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      scene.clear();
    },
  };
}
