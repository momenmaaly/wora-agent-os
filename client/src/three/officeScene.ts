import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, CircleGeometry, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, IcosahedronGeometry, MathUtils,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PCFSoftShadowMap,
  PlaneGeometry, PointLight, Raycaster, Scene, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer,
  type BufferGeometry, type Material,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentParticipant, SharedWorkspaceEntry } from '../types.js';
import {
  OFFICE_WORLD, ROOM_3D_BY_ID, ROOM_3D_LAYOUTS, ROOM_SPOTS, agentSpot, agentVisualState,
  roomSpots, spotToWorld, type AgentMotionSnapshot, type Room3DLayout, type WorldPoint,
} from './layout.js';
import { createOfficePalette, type OfficePalette, type ScreenVariant } from './materials.js';
import { createRobotFactory, type RobotRecord } from './robot.js';

const FLOOR_Y = 0.25;
const FRUSTUM_HEIGHT = 18;
const DEFAULT_OFFSET = new Vector3(21, 23, 25);

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
  circle(r: number) { return this.get(`ci:${r}`, () => new CircleGeometry(r, 48)); }
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

function screenVariantFor(room: Room3DLayout): ScreenVariant {
  if (room.id === 'zone-engineering' || room.id === 'zone-product') return 'code';
  if (room.id === 'zone-planning' || room.id === 'zone-boardroom') return 'plan';
  if (room.id === 'zone-design' || room.id === 'zone-marketing') return 'creative';
  if (room.id === 'zone-review') return 'qa';
  if (room.id === 'zone-analytics') return 'analytics';
  return 'ops';
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
  fromPosition: Vector3;
  toPosition: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromZoom: number;
  toZoom: number;
  startedAt: number;
  duration: number;
}

export function createOfficeScene(options: OfficeSceneOptions): OfficeSceneController {
  const {
    container, quality, reducedMotion, onRoom, onAgent,
    onInspect = () => {},
  } = options;
  const cache = new GeometryCache();
  const palette: OfficePalette = createOfficePalette();
  const extraMaterials: Material[] = [];
  const extraMaterial = <T extends Material>(material: T): T => { extraMaterials.push(material); return material; };
  const warmStrip = extraMaterial(new MeshBasicMaterial({ color: '#f3c987' }));
  const outdoorGround = extraMaterial(new MeshStandardMaterial({ color: '#1b342e', roughness: 1 }));
  const corridorFloor = extraMaterial(new MeshStandardMaterial({ color: '#dfe5e3', roughness: 0.52, metalness: 0.03 }));
  const corridorLine = extraMaterial(new MeshStandardMaterial({ color: '#8fa9ad', roughness: 0.6, metalness: 0.15 }));
  const corridorPath = extraMaterial(new MeshBasicMaterial({ color: '#2e7f8d', transparent: true, opacity: 0.55, depthWrite: false }));
  const selectionRingMaterial = extraMaterial(new MeshBasicMaterial({ color: '#7eeaff', transparent: true, opacity: 0.86, side: DoubleSide, depthWrite: false }));

  const renderer = new WebGLRenderer({ antialias: quality === 'high', alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.7 : 1.1));
  renderer.setClearColor(new Color('#101b26'), 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'application');
  renderer.domElement.setAttribute('aria-label', 'WORA interactive 3D company office');
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color('#101b26');
  scene.fog = new Fog('#172633', 38, 76);

  let baseZoom = 1;
  const camera = new OrthographicCamera(-12, 12, 9, -9, 0.1, 160);
  camera.position.copy(DEFAULT_OFFSET);
  camera.lookAt(0, 0.5, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = Math.PI / 5.2;
  controls.maxPolarAngle = Math.PI / 2.65;
  controls.minZoom = 0.45;
  controls.maxZoom = 3.4;
  controls.listenToKeyEvents(renderer.domElement);

  const roomLayer = new Group();
  const robotLayer = new Group();
  scene.add(roomLayer, robotLayer);

  const roomHighlights = new Map<string, Mesh>();
  const billboards: Mesh[] = [];
  const robots = new Map<string, RobotRecord>();
  const robotAgents = new Map<string, AgentParticipant>();
  const robotLocations = new Map<string, AgentMotionSnapshot>();
  const manualPositions = new Map<string, WorldPoint>();
  const manualRotations = new Map<string, number>();
  const factory = createRobotFactory(palette);
  let selectedRoomId: string | null = options.selectedRoomId;
  let selectedAgentId: string | null = options.focusedAgentId;
  let currentAgents = options.agents;
  let currentTasks = options.tasks;
  let currentCommandAgentIds: ReadonlySet<string> = options.commandAgentIds ?? new Set<string>();
  let movementActiveIds: ReadonlySet<string> = new Set<string>();
  let tween: CameraTween | null = null;
  let destroyed = false;

  function plant(parent: Object3D, x: number, z: number, scale = 1): void {
    const group = new Group();
    group.position.set(x, FLOOR_Y, z);
    group.scale.setScalar(scale);
    add(group, cache.cylinder(0.31, 0.39, 0.42, 20), palette.woodDark, { y: 0.21 });
    add(group, cache.circle(0.3), palette.soil, { y: 0.425, rx: -Math.PI / 2, cast: false });
    add(group, cache.cylinder(0.055, 0.085, 1.05, 10), palette.woodDark, { y: 0.92 });
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2;
      const leaf = add(
        group, cache.ico(0.42, 1), i % 2 ? palette.leaf : palette.leafDark,
        { x: Math.cos(angle) * 0.38, y: 1.35 + (i % 3) * 0.18, z: Math.sin(angle) * 0.38 },
      );
      leaf.scale.set(1, 0.78, 1);
    }
    add(group, cache.ico(0.52, 1), palette.leaf, { y: 1.78 }).scale.set(1.1, 0.9, 1.1);
    parent.add(group);
  }

  function chair(parent: Object3D, x: number, z: number): void {
    const group = new Group();
    group.position.set(x, 0, z);
    add(group, cache.rounded(0.48, 0.1, 0.48, 0.05), palette.dark, { y: 0.52 });
    const back = add(group, cache.rounded(0.46, 0.62, 0.09, 0.07), palette.dark, { y: 0.86, z: 0.24 });
    back.rotation.x = -0.12;
    add(group, cache.cylinder(0.055, 0.07, 0.35, 12), palette.metal, { y: 0.26 });
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      const spoke = add(group, cache.box(0.34, 0.035, 0.035), palette.metal, {
        x: Math.cos(angle) * 0.16, y: 0.1, z: Math.sin(angle) * 0.16, ry: -angle, rz: Math.PI / 2,
      });
      spoke.castShadow = quality === 'high';
      add(group, cache.sphere(0.045, 10), palette.dark, { x: Math.cos(angle) * 0.34, y: 0.055, z: Math.sin(angle) * 0.34 });
    }
    parent.add(group);
  }

  function desk(
    parent: Object3D,
    room: Room3DLayout,
    x: number,
    z: number,
    rotation: number,
    scale: number,
    variant: ScreenVariant,
    workstationId: string,
    workstationLabel: string,
  ): void {
    const group = new Group();
    group.position.set(x, FLOOR_Y, z);
    group.rotation.y = rotation;
    group.scale.setScalar(scale);
    group.userData.workstationId = workstationId;
    group.userData.workstationLabel = workstationLabel;
    group.userData.roomId = room.id;
    add(group, cache.rounded(1.42, 0.09, 0.72, 0.05), palette.wood, { y: 0.72 });
    for (const dx of [-0.61, 0.61]) for (const dz of [-0.27, 0.27]) {
      add(group, cache.box(0.055, 0.68, 0.055), palette.metal, { x: dx, y: 0.36, z: dz });
    }
    add(group, cache.rounded(0.34, 0.48, 0.52, 0.04), palette.white, { x: 0.52, y: 0.45, z: 0.04 });
    add(group, cache.box(0.3, 0.025, 0.02), palette.metal, { x: 0.52, y: 0.62, z: -0.23 });
    add(group, cache.box(0.5, 0.05, 0.36), palette.screenFrame, { y: 1.15, z: -0.26 });
    add(group, cache.box(0.07, 0.22, 0.07), palette.metal, { y: 0.9, z: -0.26 });
    const screen = add(group, cache.plane(0.68, 0.42), palette.screenMaterial(variant), {
      y: 1.15, z: -0.22, cast: false, receive: false, renderOrder: 1,
    });
    screen.userData.screenId = `${workstationId}-screen`;
    screen.userData.screenLabel = `${workstationLabel} display`;
    add(group, cache.rounded(0.48, 0.025, 0.14, 0.02), palette.dark, { y: 0.775, z: 0.12 });
    add(group, cache.rounded(0.08, 0.035, 0.12, 0.03), palette.dark, { x: 0.36, y: 0.78, z: 0.12 });
    add(group, cache.cylinder(0.055, 0.045, 0.1, 14), palette.white, { x: -0.49, y: 0.82, z: 0.15 });
    add(group, cache.rounded(0.22, 0.012, 0.3, 0.01), palette.paper, { x: -0.4, y: 0.775, z: -0.1, rz: 0.08 });
    chair(group, 0, 0.74);
    parent.add(group);
  }

  function shelf(parent: Object3D, room: Room3DLayout): void {
    const backZ = room.row === 'north' ? -room.depth / 2 + 0.12 : room.depth / 2 - 0.12;
    const face = room.row === 'north' ? 1 : -1;
    add(parent, cache.box(room.width * 0.92, 1.85, 0.12), palette.woodDark, { y: FLOOR_Y + 1.15, z: backZ });
    for (let i = 0; i < 13; i += 1) {
      add(parent, cache.box(0.045, 1.75, 0.055), palette.wood, {
        x: -room.width * 0.44 + i * (room.width * 0.88 / 12), y: FLOOR_Y + 1.15, z: backZ + face * 0.075,
      });
    }
    for (let level = 0; level < 3; level += 1) {
      add(parent, cache.box(room.width * 0.88, 0.045, 0.22), palette.wood, { y: FLOOR_Y + 0.62 + level * 0.55, z: backZ + face * 0.14 });
      for (let i = 0; i < 4; i += 1) {
        add(parent, cache.box(0.1 + (i % 2) * 0.05, 0.28, 0.12), i % 2 ? palette.paper : palette.white, {
          x: -room.width * 0.32 + i * 0.22, y: FLOOR_Y + 0.79 + level * 0.55, z: backZ + face * 0.14,
        });
      }
    }
  }

  function display(parent: Object3D, room: Room3DLayout, variant: ScreenVariant): void {
    const backZ = room.row === 'north' ? -room.depth / 2 + 0.19 : room.depth / 2 - 0.19;
    const face = room.row === 'north' ? 1 : -1;
    const width = Math.min(2.1, room.width * 0.66);
    add(parent, cache.rounded(width + 0.12, 1.02, 0.09, 0.05), palette.screenFrame, { y: FLOOR_Y + 1.48, z: backZ + face * 0.02 });
    add(parent, cache.plane(width, 0.86), palette.screenMaterial(variant), {
      y: FLOOR_Y + 1.48, z: backZ + face * 0.07, ry: room.row === 'north' ? 0 : Math.PI, cast: false, receive: false, renderOrder: 1,
    });
  }

  function serverRack(parent: Object3D, room: Room3DLayout): void {
    const x = room.width / 2 - 0.34;
    add(parent, cache.rounded(0.48, 1.68, 0.48, 0.06), palette.dark, { x, y: FLOOR_Y + 0.84, z: 0 });
    for (let i = 0; i < 7; i += 1) {
      add(parent, cache.box(0.34, 0.12, 0.03), palette.metal, { x, y: FLOOR_Y + 0.36 + i * 0.2, z: 0.26 });
      add(parent, cache.box(0.055, 0.035, 0.02), palette.cyanGlow, { x: x - 0.11, y: FLOOR_Y + 0.36 + i * 0.2, z: 0.285, cast: false });
    }
  }

  function lounge(parent: Object3D, room: Room3DLayout): void {
    const group = new Group();
    group.userData.meetingId = `${room.id}-meeting`;
    group.userData.meetingLabel = room.nameEn;
    group.userData.roomId = room.id;
    add(group, cache.cylinder(0.58, 0.58, 0.09, 32), palette.wood, { y: FLOOR_Y + 0.34, z: 0 });
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + 0.3;
      const arc = add(group, cache.torus(1.15, 0.19, Math.PI * 0.62), palette.sofa, {
        x: Math.cos(angle) * 1.15, y: FLOOR_Y + 0.4, z: Math.sin(angle) * 1.15,
        rx: Math.PI / 2, ry: -angle,
      });
      arc.castShadow = quality === 'high';
      add(group, cache.rounded(0.34, 0.12, 0.22, 0.06), palette.paper, {
        x: Math.cos(angle) * 1.75, y: FLOOR_Y + 0.48, z: Math.sin(angle) * 1.75, ry: -angle,
      });
    }
    plant(group, -room.width / 2 + 0.55, -room.depth / 2 + 0.65, 0.8);
    parent.add(group);
  }

  function executiveDesk(parent: Object3D, room: Room3DLayout): void {
    const group = new Group();
    group.position.set(0, FLOOR_Y, room.row === 'north' ? -0.2 : 0.2);
    group.rotation.y = room.row === 'north' ? 0 : Math.PI;
    group.userData.meetingId = `${room.id}-meeting`;
    group.userData.meetingLabel = room.nameEn;
    group.userData.roomId = room.id;
    add(group, cache.rounded(1.9, 0.12, 0.92, 0.07), palette.wood, { y: 0.74 });
    for (const dx of [-0.82, 0.82]) for (const dz of [-0.36, 0.36]) add(group, cache.box(0.07, 0.7, 0.07), palette.metal, { x: dx, y: 0.36, z: dz });
    add(group, cache.box(0.58, 0.05, 0.4), palette.screenFrame, { y: 1.2, z: -0.3 });
    add(group, cache.plane(0.78, 0.48), palette.screenMaterial('plan'), { y: 1.2, z: -0.26, cast: false, receive: false });
    add(group, cache.rounded(0.5, 0.03, 0.16, 0.02), palette.dark, { y: 0.8, z: 0.16 });
    add(group, cache.cylinder(0.06, 0.05, 0.12, 14), palette.white, { x: -0.68, y: 0.86, z: 0.18 });
    chair(group, 0, 0.86);
    for (const x of [-0.85, -0.28, 0.28, 0.85]) add(group, cache.rounded(0.32, 0.5, 0.36, 0.07), palette.sofa, { x, y: 0.52, z: 1.18 });
    parent.add(group);
  }

  function glassWall(parent: Object3D, room: Room3DLayout): void {
    const frontZ = room.row === 'north' ? room.depth / 2 : -room.depth / 2;
    const face = room.row === 'north' ? 1 : -1;
    const h = OFFICE_WORLD.glassHeight;
    const door = Math.min(1.05, room.width * 0.28);
    const panel = (room.width - door) / 2;
    for (const side of [-1, 1]) {
      const x = side * (door / 2 + panel / 2);
      add(parent, cache.box(panel, h, 0.055), palette.glass, { x, y: FLOOR_Y + h / 2, z: frontZ, cast: false, receive: false });
      add(parent, cache.box(panel, 0.055, 0.075), palette.frame, { x, y: FLOOR_Y + h, z: frontZ });
      add(parent, cache.box(panel, 0.055, 0.075), palette.frame, { x, y: FLOOR_Y + 0.03, z: frontZ });
    }
    for (const x of [-room.width / 2, -door / 2, door / 2, room.width / 2]) {
      add(parent, cache.box(0.06, h, 0.085), palette.frame, { x, y: FLOOR_Y + h / 2, z: frontZ });
    }
    add(parent, cache.box(room.width, 0.06, 0.085), palette.frame, { y: FLOOR_Y + h, z: frontZ });
    add(parent, cache.box(door, 0.035, 0.12), warmStrip, { y: FLOOR_Y + 0.03, z: frontZ + face * 0.03, cast: false });
    for (const side of [-1, 1]) {
      const x = side * room.width / 2;
      add(parent, cache.box(0.055, h, room.depth * 0.86), palette.glass, { x, y: FLOOR_Y + h / 2, z: 0, cast: false, receive: false });
      for (const z of [-room.depth * 0.43, 0, room.depth * 0.43]) add(parent, cache.box(0.075, h, 0.06), palette.frame, { x, y: FLOOR_Y + h / 2, z });
      add(parent, cache.box(0.075, 0.06, room.depth * 0.86), palette.frame, { x, y: FLOOR_Y + h, z: 0 });
    }
  }

  function roomFloor(parent: Object3D, room: Room3DLayout): Mesh {
    add(parent, cache.rounded(room.width, 0.07, room.depth, 0.12), palette.roomFloor(room.accent), { y: FLOOR_Y - 0.01 });
    for (const x of [-room.width * 0.25, room.width * 0.25]) {
      add(parent, cache.box(0.018, 0.012, room.depth * 0.9), palette.metal, { x, y: FLOOR_Y + 0.04, z: 0, cast: false });
    }
    const highlight = extraMaterial(new MeshBasicMaterial({ color: new Color(room.accent), transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }));
    const selection = add(parent, cache.plane(room.width * 0.98, room.depth * 0.96), highlight, {
      y: FLOOR_Y + 0.055, rx: -Math.PI / 2, cast: false, receive: false, renderOrder: 2,
    });
    selection.visible = false;
    return selection;
  }

  function createRoom(room: Room3DLayout): void {
    const group = new Group();
    group.name = `department-${room.id}`;
    group.userData.roomId = room.id;
    group.position.set(room.centerX, 0, room.centerZ);
    roomLayer.add(group);
    roomHighlights.set(room.id, roomFloor(group, room));
    glassWall(group, room);
    shelf(group, room);
    display(group, room, screenVariantFor(room));
    if (room.id === 'zone-engineering') serverRack(group, room);
    if (room.id === 'zone-lounge') lounge(group, room);
    else if (room.id === 'zone-boardroom') executiveDesk(group, room);
    else {
      const scale = Math.min(1, room.width / 3.1);
      const rotation = room.row === 'north' ? 0 : Math.PI;
      const spots = roomSpots(room.id).filter((spot) => spot.role === 'desk' || spot.role === 'desk-alt' || spot.role === 'collab' || spot.role === 'board');
      const first = spots[0];
      const second = spots[1];
      desk(group, room, -room.width * 0.23, -0.1, rotation, scale, screenVariantFor(room),
        first?.id ?? `${room.id}-desk-1`, first?.labelAr ?? `${room.nameAr} workstation 1`);
      desk(group, room, room.width * 0.23, -0.1, rotation, scale, screenVariantFor(room),
        second?.id ?? `${room.id}-desk-2`, second?.labelAr ?? `${room.nameAr} workstation 2`);
    }
    const frontZ = room.row === 'north' ? room.depth / 2 : -room.depth / 2;
    const face = room.row === 'north' ? 1 : -1;
    const sign = add(group, cache.plane(Math.min(2.9, room.width * 0.82), 0.66),
      palette.signMaterial(room.nameEn, room.code, room.accent, room.id === 'zone-boardroom'), {
        y: room.signY, z: frontZ + face * 0.11, cast: false, receive: false, renderOrder: 8,
      });
    billboards.push(sign);
    plant(group, -room.width / 2 + 0.48, room.row === 'north' ? -room.depth / 2 + 0.58 : room.depth / 2 - 0.58, 0.72);
    add(group, cache.box(room.width * 0.78, 0.025, 0.08), warmStrip, {
      y: FLOOR_Y + 0.04, z: frontZ - face * 0.12, cast: false,
    });
  }

  function createSlab(): void {
    add(scene, cache.plane(58, 42), outdoorGround, { y: -0.3, rx: -Math.PI / 2, cast: false, receive: quality === 'high' });
    add(scene, cache.rounded(OFFICE_WORLD.slabWidth, OFFICE_WORLD.slabThickness, OFFICE_WORLD.slabDepth, 0.28), palette.marble, { y: 0 });
    add(scene, cache.rounded(OFFICE_WORLD.slabWidth + 0.18, 0.12, OFFICE_WORLD.slabDepth + 0.18, 0.25), palette.floorEdge, { y: -0.16 });
    for (const z of [-OFFICE_WORLD.slabDepth / 2, OFFICE_WORLD.slabDepth / 2]) {
      add(scene, cache.box(OFFICE_WORLD.slabWidth, 0.035, 0.07), warmStrip, { y: FLOOR_Y - 0.18, z, cast: false });
    }
    for (const x of [-OFFICE_WORLD.slabWidth / 2, OFFICE_WORLD.slabWidth / 2]) {
      add(scene, cache.box(0.07, 0.035, OFFICE_WORLD.slabDepth), warmStrip, { y: FLOOR_Y - 0.18, x, cast: false });
    }
    const glassH = 1.5;
    for (const z of [-OFFICE_WORLD.slabDepth / 2 - 0.05, OFFICE_WORLD.slabDepth / 2 + 0.05]) {
      add(scene, cache.box(OFFICE_WORLD.slabWidth, glassH, 0.05), palette.glass, { y: FLOOR_Y + glassH / 2, z, cast: false, receive: false });
      add(scene, cache.box(OFFICE_WORLD.slabWidth, 0.055, 0.08), palette.frame, { y: FLOOR_Y + glassH, z });
      for (let i = 0; i <= 8; i += 1) add(scene, cache.box(0.055, glassH, 0.08), palette.frame, { x: -OFFICE_WORLD.slabWidth / 2 + i * OFFICE_WORLD.slabWidth / 8, y: FLOOR_Y + glassH / 2, z });
    }
    for (const x of [-OFFICE_WORLD.slabWidth / 2 - 0.05, OFFICE_WORLD.slabWidth / 2 + 0.05]) {
      add(scene, cache.box(0.05, glassH, OFFICE_WORLD.slabDepth), palette.glass, { y: FLOOR_Y + glassH / 2, x, cast: false, receive: false });
      add(scene, cache.box(0.08, 0.055, OFFICE_WORLD.slabDepth), palette.frame, { y: FLOOR_Y + glassH, x });
    }
    for (const [x, z] of [[-10.7, -7.4], [10.7, -7.4], [-10.7, 7.4], [10.7, 7.4]] as const) plant(scene, x, z, 0.95);
  }

  function dashedCorridorPath(parent: Object3D, from: WorldPoint, to: WorldPoint): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.1) return;
    const steps = Math.max(2, Math.ceil(length / 0.42));
    const angle = Math.atan2(-dz, dx);
    for (let i = 0; i < steps; i += 2) {
      const t = (i + 0.5) / steps;
      add(parent, cache.box(0.22, 0.012, 0.045), corridorPath, {
        x: from.x + dx * t,
        y: FLOOR_Y + 0.07,
        z: from.z + dz * t,
        ry: angle,
        cast: false,
        receive: false,
        renderOrder: 2,
      });
    }
  }

  /** Continuous circulation spine and door-to-lobby routes make the departments one connected office. */
  function createCorridors(): void {
    const group = new Group();
    group.name = 'connected-corridors';
    scene.add(group);
    const corridorDepth = OFFICE_WORLD.corridorSouthZ - OFFICE_WORLD.corridorNorthZ + 0.42;
    const corridorCenterZ = (OFFICE_WORLD.corridorNorthZ + OFFICE_WORLD.corridorSouthZ) / 2;
    add(group, cache.box(OFFICE_WORLD.slabWidth - 0.65, 0.035, corridorDepth), corridorFloor, {
      y: FLOOR_Y + 0.006, z: corridorCenterZ, cast: false, receive: true,
    });
    for (let x = -10; x <= 10; x += 2) {
      add(group, cache.box(0.014, 0.012, corridorDepth - 0.15), corridorLine, {
        x, y: FLOOR_Y + 0.032, z: corridorCenterZ, cast: false,
      });
    }
    for (const z of [OFFICE_WORLD.corridorNorthZ, 0, OFFICE_WORLD.corridorSouthZ]) {
      add(group, cache.box(OFFICE_WORLD.slabWidth - 0.7, 0.012, 0.025), corridorLine, {
        y: FLOOR_Y + 0.034, z, cast: false,
      });
    }
    add(group, cache.box(1.65, 0.018, corridorDepth - 0.2), corridorLine, {
      y: FLOOR_Y + 0.038, z: corridorCenterZ, cast: false,
    });
    for (const room of ROOM_3D_LAYOUTS) {
      const frontZ = room.row === 'north' ? room.centerZ + room.depth / 2 : room.centerZ - room.depth / 2;
      const door: WorldPoint = { x: room.centerX, z: frontZ };
      const mid: WorldPoint = { x: room.centerX * 0.48, z: 0 };
      const lobby: WorldPoint = { x: 0, z: 0 };
      dashedCorridorPath(group, door, mid);
      dashedCorridorPath(group, mid, lobby);
    }
    for (const x of [-7.4, 7.4]) {
      add(group, cache.rounded(1.25, 0.12, 0.34, 0.06), palette.sofa, {
        x, y: FLOOR_Y + 0.28, z: -1.1,
      });
      add(group, cache.rounded(1.25, 0.12, 0.34, 0.06), palette.sofa, {
        x, y: FLOOR_Y + 0.28, z: 1.1,
      });
    }
    for (const [x, z] of [[-8.8, 0], [8.8, 0]] as const) plant(group, x, z, 0.72);
  }

  function createLobby(): void {
    const group = new Group();
    group.name = 'central-lobby';
    scene.add(group);
    add(group, cache.cylinder(OFFICE_WORLD.lobbyRadius + 0.12, OFFICE_WORLD.lobbyRadius + 0.12, 0.11, 64), palette.marble, { y: FLOOR_Y + 0.01 });
    add(group, cache.plane(4.3, 4.3), palette.logoMaterial(), { y: FLOOR_Y + 0.075, rx: -Math.PI / 2, cast: false, receive: false, renderOrder: 3 });
    add(group, cache.torus(OFFICE_WORLD.lobbyRadius + 0.18, 0.045, Math.PI * 2), palette.metal, { y: FLOOR_Y + 0.12, rx: Math.PI / 2 });
    add(group, cache.cylinder(0.82, 0.94, 0.38, 40), palette.white, { y: FLOOR_Y + 0.2 });
    add(group, cache.circle(0.78), palette.soil, { y: FLOOR_Y + 0.4, rx: -Math.PI / 2, cast: false });
    add(group, cache.cylinder(0.09, 0.14, 1.35, 12), palette.woodDark, { y: FLOOR_Y + 1.02 });
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2;
      const leaf = add(group, cache.ico(0.55, 1), i % 2 ? palette.leaf : palette.leafDark, {
        x: Math.cos(angle) * 0.72, y: FLOOR_Y + 1.72 + (i % 3) * 0.2, z: Math.sin(angle) * 0.72,
      });
      leaf.scale.set(1.15, 0.9, 1.15);
    }
    add(group, cache.ico(0.8, 1), palette.leaf, { y: FLOOR_Y + 2.25 }).scale.set(1.2, 0.95, 1.2);
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + 0.45;
      add(group, cache.torus(1.55, 0.22, Math.PI * 0.58), palette.sofa, {
        x: Math.cos(angle) * 1.62, y: FLOOR_Y + 0.42, z: Math.sin(angle) * 1.62,
        rx: Math.PI / 2, ry: -angle,
      });
      add(group, cache.rounded(0.34, 0.13, 0.24, 0.06), palette.paper, {
        x: Math.cos(angle) * 2.12, y: FLOOR_Y + 0.52, z: Math.sin(angle) * 2.12, ry: -angle,
      });
    }
    const railRadius = 3.15;
    add(group, cache.torus(railRadius, 0.035, Math.PI * 2), palette.frame, { y: FLOOR_Y + 0.72, rx: Math.PI / 2 });
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const x = Math.cos(angle) * railRadius;
      const z = Math.sin(angle) * railRadius;
      add(group, cache.cylinder(0.025, 0.025, 0.72, 8), palette.frame, { x, y: FLOOR_Y + 0.36, z });
      const panel = add(group, cache.box(0.05, 0.58, railRadius * 0.5), palette.glass, {
        x: Math.cos(angle + Math.PI / 12) * railRadius, y: FLOOR_Y + 0.36, z: Math.sin(angle + Math.PI / 12) * railRadius,
        ry: -angle - Math.PI / 12, cast: false, receive: false,
      });
      panel.scale.z = 1.02;
    }
  }

  function createLights(): void {
    scene.add(new HemisphereLight(0xe8f6ff, 0x46595a, 1.35));
    scene.add(new AmbientLight(0xffffff, 0.34));
    const sun = new DirectionalLight(0xfff2dc, 2.25);
    sun.position.set(-9, 19, 12);
    sun.castShadow = quality === 'high';
    if (quality === 'high') {
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -18;
      sun.shadow.camera.right = 18;
      sun.shadow.camera.top = 16;
      sun.shadow.camera.bottom = -16;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 55;
      sun.shadow.bias = -0.0004;
    }
    scene.add(sun);
    for (const [x, z] of [[-9, -6], [9, -6], [-9, 6], [9, 6]] as const) {
      const light = new PointLight(0xffca83, 8, 11, 2);
      light.position.set(x, 3.2, z);
      scene.add(light);
    }
    const lobbyLight = new PointLight(0x6bdcf2, 6, 9, 2);
    lobbyLight.position.set(0, 3.6, 0);
    scene.add(lobbyLight);
  }

  createSlab();
  createCorridors();
  createLobby();
  for (const room of ROOM_3D_LAYOUTS) createRoom(room);
  createLights();

  const agentRing = add(scene, cache.torus(0.46, 0.025, Math.PI * 2), selectionRingMaterial, {
    y: FLOOR_Y + 0.055, rx: Math.PI / 2, cast: false, receive: false, renderOrder: 5,
  });
  agentRing.visible = false;

  function setSelectedAgent(agentId: string | null): void {
    selectedAgentId = agentId && robots.has(agentId) ? agentId : null;
    agentRing.visible = Boolean(selectedAgentId);
  }

  function setSelectedRoom(roomId: string | null): void {
    selectedRoomId = roomId && roomHighlights.has(roomId) ? roomId : null;
    for (const [id, highlight] of roomHighlights) highlight.visible = id === selectedRoomId;
  }

  function moveCamera(toTarget: Vector3, toPosition: Vector3, toZoom: number, immediate = false): void {
    if (immediate || reducedMotion) {
      camera.position.copy(toPosition);
      controls.target.copy(toTarget);
      camera.zoom = toZoom;
      camera.updateProjectionMatrix();
      controls.update();
      tween = null;
      controls.enabled = true;
      return;
    }
    tween = {
      fromPosition: camera.position.clone(),
      toPosition,
      fromTarget: controls.target.clone(),
      toTarget,
      fromZoom: camera.zoom,
      toZoom,
      startedAt: performance.now(),
      duration: 820,
    };
    controls.enabled = false;
  }

  function resetCamera(): void {
    const target = new Vector3(0, 0.45, 0);
    moveCamera(target, target.clone().add(DEFAULT_OFFSET), baseZoom);
  }

  function focusRoom(roomId: string | null): void {
    setSelectedRoom(roomId);
    if (!roomId) { resetCamera(); return; }
    const room = ROOM_3D_BY_ID[roomId];
    if (!room) { resetCamera(); return; }
    const target = new Vector3(room.centerX, 0.6, room.centerZ + (room.row === 'north' ? 0.8 : -0.8));
    const offset = DEFAULT_OFFSET.clone().multiplyScalar(0.82);
    moveCamera(target, target.clone().add(offset), Math.min(baseZoom * 1.78, 2.7));
  }

  function focusAgent(agentId: string | null): void {
    setSelectedAgent(agentId);
    if (!agentId) { setSelectedRoom(null); return; }
    const record = robots.get(agentId);
    if (!record) return;
    setSelectedRoom(record.roomId);
    const target = record.group.position.clone().add(new Vector3(0, 0.65, 0));
    const offset = DEFAULT_OFFSET.clone().multiplyScalar(0.58);
    moveCamera(target, target.clone().add(offset), Math.min(baseZoom * 2.2, 3.2));
  }

  function focusSpot(spotId: string): void {
    const spot = ROOM_SPOTS.find((candidate) => candidate.id === spotId);
    if (!spot) return;
    const point = spotToWorld(spot);
    const target = new Vector3(point.x, 0.65, point.z);
    setSelectedRoom(spot.roomId);
    moveCamera(target, target.clone().add(DEFAULT_OFFSET.clone().multiplyScalar(0.62)), Math.min(baseZoom * 2.05, 3.05));
  }

  function effectiveState(agent: AgentParticipant): ReturnType<typeof agentVisualState> {
    return agentVisualState(agent, currentTasks, {
      location: robotLocations.get(agent.id),
      locationAuthorized: currentCommandAgentIds.has(agent.id),
      movementActive: movementActiveIds.has(agent.id),
    });
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
    const seen = new Set<string>();
    const occupied = new Set<string>();
    for (const agent of nextAgents) {
      const roomId = agent.zoneId && ROOM_3D_BY_ID[agent.zoneId] ? agent.zoneId : 'zone-planning';
      const room = ROOM_3D_BY_ID[roomId] ?? ROOM_3D_BY_ID['zone-planning'];
      const spot = agentSpot(agent.id, roomId, occupied);
      if (spot.spotId) occupied.add(spot.spotId);
      const state = effectiveState(agent);
      const facing = (room?.row === 'south' ? Math.PI : 0) + ((agent.id.length % 3) - 1) * 0.08;
      robotAgents.set(agent.id, agent);
      let record = robots.get(agent.id);
      if (!record) {
        record = factory.create(agent, state, spot.point.x, spot.point.z, facing);
        robots.set(agent.id, record);
        robotLayer.add(record.group);
      } else if (!manualPositions.has(agent.id)) {
        record.group.position.set(spot.point.x, 0.25, spot.point.z);
        record.group.rotation.y = manualRotations.get(agent.id) ?? facing;
        record.group.userData.roomId = roomId;
        record.roomId = roomId;
      }
      factory.update(record, state, performance.now() / 1000, reducedMotion);
      seen.add(agent.id);
    }
    for (const [id, record] of robots) {
      if (!seen.has(id)) {
        record.dispose();
        robots.delete(id);
        robotAgents.delete(id);
        manualPositions.delete(id);
        manualRotations.delete(id);
      }
    }
    if (selectedAgentId && !robots.has(selectedAgentId)) setSelectedAgent(null);
  }

  /** Receives only real, authorized office-command positions; never an autonomous roaming generator. */
  function setRobotPositions(positions: Record<string, WorldPoint>): void {
    for (const [agentId, point] of Object.entries(positions)) {
      const record = robots.get(agentId);
      if (!record) continue;
      const previous = manualPositions.get(agentId) ?? record.group.position.clone();
      manualPositions.set(agentId, point);
      const dx = point.x - previous.x;
      const dz = point.z - previous.z;
      if (Math.hypot(dx, dz) > 0.008) manualRotations.set(agentId, Math.atan2(dx, dz));
      record.group.position.set(point.x, 0.25, point.z);
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

  function computeBaseZoom(aspect: number): number {
    if (aspect >= 1.5) return 1;
    if (aspect >= 1.15) return 0.88;
    if (aspect >= 0.85) return 0.68;
    return 0.56;
  }

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const nextBase = computeBaseZoom(aspect);
    const ratio = nextBase / baseZoom;
    baseZoom = nextBase;
    renderer.setSize(width, height, false);
    camera.left = -FRUSTUM_HEIGHT * aspect / 2;
    camera.right = FRUSTUM_HEIGHT * aspect / 2;
    camera.top = FRUSTUM_HEIGHT / 2;
    camera.bottom = -FRUSTUM_HEIGHT / 2;
    camera.zoom = MathUtils.clamp(camera.zoom * ratio, baseZoom * 0.6, baseZoom * 3.4);
    camera.updateProjectionMatrix();
    controls.minZoom = baseZoom * 0.6;
    controls.maxZoom = baseZoom * 3.4;
  }

  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let pointerStart: { x: number; y: number; id: number } | null = null;
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
      let node: Object3D | null = hit.object;
      let fallbackRoomId: string | null = null;
      while (node) {
        const agentId = node.userData.agentId;
        if (typeof agentId === 'string' && robots.has(agentId)) {
          focusAgent(agentId);
          onAgent(agentId);
          onInspect({ kind: 'robot', id: agentId, roomId: robots.get(agentId)?.roomId ?? '' });
          return;
        }
        const workstationId = node.userData.workstationId;
        if (typeof workstationId === 'string') {
          const roomId = String(node.userData.roomId ?? '');
          focusSpot(workstationId);
          onInspect({
            kind: 'workstation', id: workstationId, roomId,
            label: String(node.userData.workstationLabel ?? workstationId),
          });
          return;
        }
        const screenId = node.userData.screenId;
        if (typeof screenId === 'string') {
          const roomId = String(node.parent?.userData.roomId ?? '');
          onInspect({
            kind: 'screen', id: screenId, roomId,
            label: String(node.userData.screenLabel ?? screenId),
          });
          return;
        }
        const meetingId = node.userData.meetingId;
        if (typeof meetingId === 'string') {
          const roomId = String(node.userData.roomId ?? '');
          focusRoom(roomId);
          onInspect({
            kind: 'meeting', id: meetingId, roomId,
            label: String(node.userData.meetingLabel ?? meetingId),
          });
          return;
        }
        const roomId = node.userData.roomId;
        if (!fallbackRoomId && typeof roomId === 'string' && roomHighlights.has(roomId)) fallbackRoomId = roomId;
        node = node.parent;
      }
      if (fallbackRoomId) {
        focusRoom(fallbackRoomId);
        onRoom(fallbackRoomId);
        onInspect({ kind: 'department', id: fallbackRoomId, roomId: fallbackRoomId });
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
      camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      camera.zoom = MathUtils.lerp(tween.fromZoom, tween.toZoom, eased);
      camera.updateProjectionMatrix();
      if (progress >= 1) { tween = null; controls.enabled = true; }
    }
    controls.update();
    for (const record of robots.values()) {
      const agent = robotAgents.get(record.agentId);
      if (agent) factory.update(record, effectiveState(agent), elapsed, reducedMotion);
    }
    for (const billboard of billboards) billboard.quaternion.copy(camera.quaternion);
    if (selectedAgentId) {
      const record = robots.get(selectedAgentId);
      if (record) {
        agentRing.position.set(record.group.position.x, FLOOR_Y + 0.055, record.group.position.z);
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
      controls.dispose();
      for (const record of robots.values()) record.dispose();
      robots.clear();
      factory.dispose();
      cache.dispose();
      for (const material of extraMaterials) material.dispose();
      palette.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      scene.clear();
    },
  };
}
