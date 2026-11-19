import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import type { ScreenVariant } from './materials.ts';

/** The exact reference is 1672 × 941; all composition points are normalized against it. */
export const REFERENCE_VIEWPORT = { width: 1672, height: 941 } as const;
export const REFERENCE_CAMERA_POSITION = new Vector3(18, 24, 20);
export const REFERENCE_CAMERA_TARGET = new Vector3(0, 0.5, 0);
export const REFERENCE_CAMERA_OFFSET = REFERENCE_CAMERA_POSITION.clone().sub(REFERENCE_CAMERA_TARGET);
export const REFERENCE_FOV = 38;
export const REFERENCE_LABEL_HEIGHT = 3.15;
export const REFERENCE_FLOOR_Y = 0.03;

export type ReferenceIcon = 'megaphone' | 'crown' | 'code' | 'palette' | 'flask' | 'bars' | 'shield';
export type ReferenceFloor = 'marble' | 'wood';
export type ScreenPoint = readonly [number, number];

export interface ReferenceRoomDefinition {
  id: string;
  label: string;
  labelAr: string;
  icon: ReferenceIcon;
  accent: string;
  primaryLogicalRoomId: string;
  displayVariant: ScreenVariant;
  floor: ReferenceFloor;
  furniture: 'marketing' | 'executive' | 'engineering' | 'creative' | 'management' | 'research' | 'qa';
  screenPolygon: readonly ScreenPoint[];
  screenLabel: ScreenPoint;
  labelWidth: number;
  labelRotation: number;
}

export interface ReferenceRoomWorld {
  definition: ReferenceRoomDefinition;
  points: Vector3[];
  center: Vector3;
  labelPoint: Vector3;
  width: number;
  depth: number;
  rotation: number;
  right: Vector3;
  forward: Vector3;
}

/**
 * Seven visible glass-partitioned rooms from the exact reference. The ten logical
 * business departments are preserved separately and mapped onto these visual rooms.
 */
export const REFERENCE_ROOMS: readonly ReferenceRoomDefinition[] = [
  {
    id: 'marketing', label: 'Marketing', labelAr: 'التسويق', icon: 'megaphone', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-marketing', displayVariant: 'analytics', floor: 'marble', furniture: 'marketing',
    screenPolygon: [[260, 285], [520, 145], [650, 285], [300, 420]],
    screenLabel: [355, 205], labelWidth: 158, labelRotation: -16,
  },
  {
    id: 'executive', label: 'Executive Office', labelAr: 'مكتب المدير', icon: 'crown', accent: '#f0c24a',
    primaryLogicalRoomId: 'zone-boardroom', displayVariant: 'plan', floor: 'wood', furniture: 'executive',
    screenPolygon: [[650, 135], [1040, 135], [1060, 305], [670, 305]],
    screenLabel: [880, 155], labelWidth: 252, labelRotation: 0,
  },
  {
    id: 'engineering', label: 'Engineering', labelAr: 'الهندسة', icon: 'code', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-engineering', displayVariant: 'code', floor: 'marble', furniture: 'engineering',
    screenPolygon: [[1060, 145], [1330, 280], [1400, 400], [1090, 390]],
    screenLabel: [1310, 215], labelWidth: 220, labelRotation: 16,
  },
  {
    id: 'creative', label: 'Creative Studio', labelAr: 'الإبداع', icon: 'palette', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-design', displayVariant: 'creative', floor: 'marble', furniture: 'creative',
    screenPolygon: [[250, 450], [520, 420], [640, 560], [300, 650]],
    screenLabel: [340, 490], labelWidth: 214, labelRotation: -16,
  },
  {
    id: 'management', label: 'Management', labelAr: 'الإدارة', icon: 'bars', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-sales', displayVariant: 'analytics', floor: 'wood', furniture: 'management',
    screenPolygon: [[1320, 400], [1600, 420], [1650, 620], [1350, 660]],
    screenLabel: [1500, 445], labelWidth: 198, labelRotation: 16,
  },
  {
    id: 'research', label: 'Research', labelAr: 'البحث', icon: 'flask', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-planning', displayVariant: 'world', floor: 'marble', furniture: 'research',
    screenPolygon: [[520, 560], [780, 590], [860, 750], [550, 800]] as const,
    screenLabel: [590, 590], labelWidth: 166, labelRotation: 18,
  },
  {
    id: 'qa', label: 'QA & Testing', labelAr: 'الجودة', icon: 'shield', accent: '#2bd5ec',
    primaryLogicalRoomId: 'zone-review', displayVariant: 'qa', floor: 'marble', furniture: 'qa',
    screenPolygon: [[970, 570], [1240, 560], [1320, 740], [1000, 800]] as const,
    screenLabel: [1170, 590], labelWidth: 204, labelRotation: 18,
  },
] as const;

export const LOGICAL_TO_VISUAL_ROOM: Record<string, string> = {
  'zone-marketing': 'marketing',
  'zone-boardroom': 'executive',
  'zone-engineering': 'engineering',
  'zone-design': 'creative',
  'zone-sales': 'management',
  'zone-product': 'management',
  'zone-planning': 'research',
  'zone-analytics': 'research',
  'zone-review': 'qa',
  'zone-lounge': 'lobby',
};

export const REFERENCE_FEATURE_POINTS = {
  medallion: [900, 510],
  planter: [770, 370],
  sofaLeft: [670, 420],
  sofaRight: [990, 410],
  receptionLeft: [650, 415],
  receptionRight: [1070, 405],
  exteriorTopLeft: [300, 0],
  exteriorTopRight: [1400, 0],
  exteriorBottomLeft: [300, 900],
  exteriorBottomRight: [1600, 900],
} as const;

/** Workstation centers transcribed from the exact reference at 1672 × 941. */
export const REFERENCE_DESK_POINTS: Record<string, readonly ScreenPoint[]> = {
  marketing: [[355, 310], [455, 285], [405, 360], [510, 335]],
  executive: [[870, 245]],
  engineering: [[1160, 285], [1260, 300], [1190, 350], [1300, 360]],
  creative: [[340, 560], [450, 545], [380, 610], [480, 590]],
  management: [[1480, 550]],
  research: [[620, 680], [720, 670], [650, 730], [750, 720]],
  qa: [[1040, 650], [1130, 650], [1080, 710], [1190, 710]],
};

/** Large wall displays, shelves, server racks, and whiteboards from the reference. */
export const REFERENCE_DISPLAY_POINTS: Record<string, readonly ScreenPoint[]> = {
  marketing: [[390, 245], [555, 245]],
  executive: [[870, 190]],
  engineering: [[1245, 290]],
  creative: [[385, 505], [585, 505]],
  management: [[1450, 485], [1380, 495]],
  research: [[650, 625]],
  qa: [[1140, 610]],
};

/** Visible robots including corridor/lobby agents; real workspace records drive their info and motion. */
export const REFERENCE_ROBOT_POINTS: Record<string, readonly ScreenPoint[]> = {
  marketing: [[325, 315], [430, 275], [475, 330], [370, 355], [525, 335], [425, 320]],
  executive: [[870, 210]],
  engineering: [[1140, 255], [1230, 270], [1180, 330], [1290, 330], [1120, 340], [1340, 350]],
  creative: [[320, 555], [440, 535], [480, 575], [370, 610]],
  management: [[1390, 520], [1450, 520], [1510, 560], [1550, 580], [1450, 600]],
  research: [[590, 670], [680, 650], [730, 700], [650, 750]],
  qa: [[1020, 620], [1110, 620], [1160, 680], [1080, 720]],
  lobby: [[620, 370], [710, 425], [900, 370], [1070, 400], [1070, 500], [1320, 430], [1380, 620], [640, 440]],
};

export const REFERENCE_PLANT_POINTS: readonly ScreenPoint[] = [
  [250, 310], [600, 315], [520, 390], [1060, 330], [1350, 430], [1620, 610],
  [280, 620], [520, 620], [850, 730], [1320, 700], [970, 690], [400, 735],
];

export const REFERENCE_RAIL_POINTS: readonly ScreenPoint[] = [
  [610, 440], [700, 355], [900, 330], [1070, 400], [1190, 475],
];

export function makeReferenceCamera(aspect: number): PerspectiveCamera {
  const referenceAspect = REFERENCE_VIEWPORT.width / REFERENCE_VIEWPORT.height;
  const verticalFov = 2 * Math.atan(Math.tan((REFERENCE_FOV * Math.PI) / 360) * (referenceAspect / aspect)) * 180 / Math.PI;
  const camera = new PerspectiveCamera(verticalFov, aspect, 0.1, 260);
  camera.position.copy(REFERENCE_CAMERA_POSITION);
  camera.lookAt(REFERENCE_CAMERA_TARGET);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

export function updateReferenceCameraFov(camera: PerspectiveCamera, aspect: number): void {
  const referenceAspect = REFERENCE_VIEWPORT.width / REFERENCE_VIEWPORT.height;
  camera.aspect = aspect;
  camera.fov = 2 * Math.atan(Math.tan((REFERENCE_FOV * Math.PI) / 360) * (referenceAspect / aspect)) * 180 / Math.PI;
  camera.updateProjectionMatrix();
}

export function applyReferenceCamera(camera: PerspectiveCamera, target: Vector3, scale = 1): void {
  camera.position.copy(target).add(REFERENCE_CAMERA_OFFSET.clone().multiplyScalar(scale));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function screenToPlane(
  point: ScreenPoint,
  planeY: number,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): Vector3 {
  const x = (point[0] / REFERENCE_VIEWPORT.width) * width;
  const y = (point[1] / REFERENCE_VIEWPORT.height) * height;
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2), camera);
  const result = new Vector3();
  const plane = new Plane(new Vector3(0, 1, 0), -planeY);
  if (!raycaster.ray.intersectPlane(plane, result)) {
    result.set(0, planeY, 0);
  }
  return result;
}

export function screenToFloor(
  point: ScreenPoint, camera: PerspectiveCamera, width: number, height: number,
): Vector3 {
  return screenToPlane(point, REFERENCE_FLOOR_Y, camera, width, height);
}

export function screenToLabel(
  point: ScreenPoint, camera: PerspectiveCamera, width: number, height: number,
): Vector3 {
  return screenToPlane(point, REFERENCE_LABEL_HEIGHT, camera, width, height);
}

export function worldUnitsPerPixel(camera: PerspectiveCamera, width: number, height: number): number {
  const center: ScreenPoint = [REFERENCE_VIEWPORT.width / 2, REFERENCE_VIEWPORT.height / 2];
  const a = screenToFloor(center, camera, width, height);
  const b = screenToFloor([center[0] + 1, center[1]], camera, width, height);
  return a.distanceTo(b);
}

export function buildReferenceRooms(camera: PerspectiveCamera, width: number, height: number): ReferenceRoomWorld[] {
  return REFERENCE_ROOMS.map((definition) => {
    const points = definition.screenPolygon.map((point) => screenToFloor(point, camera, width, height));
    const center = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length);
    const edgeA = points[1]!.clone().sub(points[0]!);
    const edgeB = points[3]!.clone().sub(points[0]!);
    const right = edgeA.clone().setY(0).normalize();
    const forward = new Vector3(-right.z, 0, right.x).normalize();
    if (forward.dot(edgeB) < 0) forward.negate();
    const opposite = points[2]!.clone().sub(points[3]!);
    const widthWorld = (edgeA.length() + opposite.length()) / 2;
    const depthWorld = (edgeB.length() + points[2]!.clone().sub(points[1]!).length()) / 2;
    const rotation = Math.atan2(-right.z, right.x);
    return {
      definition,
      points,
      center,
      labelPoint: screenToLabel(definition.screenLabel, camera, width, height),
      width: widthWorld,
      depth: depthWorld,
      rotation,
      right,
      forward,
    };
  });
}

export function visualRoomForLogical(logicalRoomId: string | null): string | null {
  if (!logicalRoomId) return null;
  return LOGICAL_TO_VISUAL_ROOM[logicalRoomId] ?? null;
}

export function logicalRoomsForVisual(visualRoomId: string): string[] {
  return Object.entries(LOGICAL_TO_VISUAL_ROOM)
    .filter(([, visual]) => visual === visualRoomId)
    .map(([logical]) => logical);
}

export function setRoomGroupTransform(group: Object3D, room: ReferenceRoomWorld): void {
  group.position.copy(room.center);
  group.rotation.set(0, room.rotation, 0);
}
