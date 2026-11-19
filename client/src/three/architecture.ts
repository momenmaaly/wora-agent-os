import { OrthographicCamera, Vector3 } from 'three';
import { OFFICE_WORLD, ROOM_3D_LAYOUTS, type Room3DLayout } from './layout.ts';

/**
 * Fixed architectural view. The camera angle never changes: room navigation
 * only tweens the target and orthographic zoom. No free orbit/pan/rotate input.
 */
export const ARCHITECTURAL_FRUSTUM_HEIGHT = 18;
export const ARCHITECTURAL_OFFSET = new Vector3(18, 27, 20);
export const ARCHITECTURAL_BASE_TARGET = new Vector3(0, 0.7, 0);

export interface ArchitecturalFrame {
  aspect: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: number;
  target: Vector3;
  position: Vector3;
  roomZoom: number;
  agentZoom: number;
  spotZoom: number;
}

/** Short, readable room names shown as real DOM text—not baked into WebGL textures. */
export const ROOM_ARCHITECTURE_LABELS: Record<string, { en: string; ar: string }> = {
  'zone-product': { en: 'Product Lab', ar: 'المنتج' },
  'zone-planning': { en: 'Research & Planning', ar: 'التخطيط' },
  'zone-boardroom': { en: 'Executive Office', ar: 'مكتب المدير' },
  'zone-engineering': { en: 'Engineering', ar: 'الهندسة' },
  'zone-design': { en: 'Creative Studio', ar: 'التصميم' },
  'zone-review': { en: 'QA & Security', ar: 'الجودة' },
  'zone-lounge': { en: 'Meeting Room', ar: 'الاجتماعات' },
  'zone-marketing': { en: 'Marketing', ar: 'التسويق' },
  'zone-sales': { en: 'Operations', ar: 'العمليات' },
  'zone-analytics': { en: 'Analytics', ar: 'البيانات' },
};

export function roomArchitectureLabel(room: Room3DLayout): { en: string; ar: string } {
  return ROOM_ARCHITECTURE_LABELS[room.id] ?? { en: room.nameEn, ar: room.nameAr };
}

/** Labels are anchored above the corridor-facing glass line, clear of furniture. */
export function roomLabelAnchor(room: Room3DLayout): Vector3 {
  const frontZ = room.row === 'north'
    ? room.centerZ + room.depth / 2 + 0.34
    : room.centerZ - room.depth / 2 - 0.34;
  return new Vector3(room.centerX, 3.55, frontZ);
}

export function roomLabelSpan(room: Room3DLayout): { left: Vector3; right: Vector3 } {
  const anchor = roomLabelAnchor(room);
  return {
    left: new Vector3(room.centerX - room.width * 0.42, anchor.y, anchor.z),
    right: new Vector3(room.centerX + room.width * 0.42, anchor.y, anchor.z),
  };
}

/**
 * Fits the complete office footprint tightly to the viewport at a fixed angle.
 * The bounding box includes room labels and wall height, so no detached island
 * or decorative empty margin is needed around the environment.
 */
export function computeArchitecturalFrame(aspect: number): ArchitecturalFrame {
  const safeAspect = Math.max(0.4, Math.min(4, aspect));
  const camera = new OrthographicCamera(
    -ARCHITECTURAL_FRUSTUM_HEIGHT * safeAspect / 2,
    ARCHITECTURAL_FRUSTUM_HEIGHT * safeAspect / 2,
    ARCHITECTURAL_FRUSTUM_HEIGHT / 2,
    -ARCHITECTURAL_FRUSTUM_HEIGHT / 2,
    0.1,
    160,
  );
  camera.position.copy(ARCHITECTURAL_BASE_TARGET).add(ARCHITECTURAL_OFFSET);
  camera.lookAt(ARCHITECTURAL_BASE_TARGET);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const halfWidth = OFFICE_WORLD.slabWidth / 2;
  const halfDepth = OFFICE_WORLD.slabDepth / 2;
  const corners: Vector3[] = [];
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [0, 4.1]) {
      for (const z of [-halfDepth, halfDepth]) corners.push(new Vector3(x, y, z));
    }
  }
  for (const room of ROOM_3D_LAYOUTS) {
    corners.push(roomLabelAnchor(room));
    const span = roomLabelSpan(room);
    corners.push(span.left, span.right);
  }
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const corner of corners) {
    const cameraSpace = corner.clone().applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, cameraSpace.x);
    maxX = Math.max(maxX, cameraSpace.x);
    minY = Math.min(minY, cameraSpace.y);
    maxY = Math.max(maxY, cameraSpace.y);
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const target = ARCHITECTURAL_BASE_TARGET.clone()
    .add(right.multiplyScalar(centerX))
    .add(up.multiplyScalar(centerY));
  const position = target.clone().add(ARCHITECTURAL_OFFSET);
  const neededWidth = (maxX - minX) * 1.035;
  const neededHeight = (maxY - minY) * 1.045;
  const visibleHeight = Math.max(neededHeight, neededWidth / safeAspect);
  const zoom = Math.max(0.45, Math.min(1.8, ARCHITECTURAL_FRUSTUM_HEIGHT / visibleHeight));

  return {
    aspect: safeAspect,
    left: -ARCHITECTURAL_FRUSTUM_HEIGHT * safeAspect / 2,
    right: ARCHITECTURAL_FRUSTUM_HEIGHT * safeAspect / 2,
    top: ARCHITECTURAL_FRUSTUM_HEIGHT / 2,
    bottom: -ARCHITECTURAL_FRUSTUM_HEIGHT / 2,
    zoom,
    target,
    position,
    roomZoom: Math.min(3.7, zoom * 2.3),
    agentZoom: Math.min(4.1, zoom * 2.75),
    spotZoom: Math.min(4, zoom * 2.6),
  };
}

export function applyArchitecturalFrame(camera: OrthographicCamera, frame: ArchitecturalFrame): void {
  camera.left = frame.left;
  camera.right = frame.right;
  camera.top = frame.top;
  camera.bottom = frame.bottom;
  camera.position.copy(frame.position);
  camera.lookAt(frame.target);
  camera.zoom = frame.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Projection helper for tests and DOM label placement. */
export function makeArchitecturalCamera(frame: ArchitecturalFrame): OrthographicCamera {
  const camera = new OrthographicCamera(frame.left, frame.right, frame.top, frame.bottom, 0.1, 160);
  applyArchitecturalFrame(camera, frame);
  return camera;
}

export interface ViewportRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Axis-aligned viewport overlap test used to keep real-text nameplates clear. */
export function rectanglesOverlap(a: ViewportRect, b: ViewportRect, margin = 0): boolean {
  return a.left < b.right + margin
    && a.right + margin > b.left
    && a.top < b.bottom + margin
    && a.bottom + margin > b.top;
}

export function projectToViewport(point: Vector3, camera: OrthographicCamera, width: number, height: number): Vector3 {
  const projected = point.clone().project(camera);
  return new Vector3((projected.x + 1) * width / 2, (1 - projected.y) * height / 2, projected.z);
}
