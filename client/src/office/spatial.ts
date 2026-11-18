import type { OfficeRoom, Point2D } from './layout.js';

/** An oblique camera with a shallow angle, keeping the ten rooms legible in one frame. */
export const SCENE_FRAME = { width: 2660, height: 1070 };

export function project(x: number, y: number, z = 0): Point2D {
  return { x: 566 + x - 0.45 * y, y: 166 + 0.115 * x + 0.565 * y - z };
}

export function outline(x: number, y: number, w: number, d: number, z = 0) {
  return [project(x, y, z), project(x + w, y, z), project(x + w, y + d, z), project(x, y + d, z)] as const;
}

export function points(coords: readonly Point2D[]) {
  return coords.map(({ x, y }) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`).join(' ');
}

export function roomCamera(room: OfficeRoom) {
  const center = project(room.x + room.width / 2, room.y + room.height / 2, 34);
  const bounds = room.height * 0.565 + room.width * 0.115 + 115;
  return { center, scale: Math.min(3.28, 940 / bounds) };
}
