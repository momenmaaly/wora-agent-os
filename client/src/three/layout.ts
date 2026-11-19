import { OFFICE_ROOMS, ROOM_BY_ID, ROOM_SPOTS } from '../office/layout.ts';
import type { OfficeRoom, RoomSpot } from '../office/layout.ts';
import type { AgentParticipant, SharedWorkspaceEntry } from '../types.ts';

/** World-space constants for the procedural WebGL cutaway. */
export const OFFICE_WORLD = {
  slabWidth: 23.6,
  slabDepth: 16.6,
  slabThickness: 0.42,
  lobbyRadius: 2.55,
  northZ: -5.25,
  southZ: 5.25,
  northDepth: 4.15,
  southDepth: 4.65,
  glassHeight: 2.15,
} as const;

export type OfficeRow = 'north' | 'south';
export type RobotVisualState =
  | 'working' | 'thinking' | 'communicating' | 'idle' | 'reviewing'
  | 'blocked' | 'completed' | 'waiting' | 'offline';

export interface Room3DLayout {
  id: string;
  nameEn: string;
  nameAr: string;
  code: string;
  kind: OfficeRoom['kind'];
  accent: string;
  row: OfficeRow;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  signY: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

const WORLD_X_SCALE = 0.01;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rowFor(room: OfficeRoom): OfficeRow {
  return room.y < 400 ? 'north' : 'south';
}

/** Converts the existing 2D office plan into a 3D ring of departments around a central lobby. */
export function buildRoomLayouts(): Room3DLayout[] {
  return OFFICE_ROOMS.map((room) => {
    const row = rowFor(room);
    const width = room.width * WORLD_X_SCALE;
    const depth = row === 'north' ? OFFICE_WORLD.northDepth : OFFICE_WORLD.southDepth;
    return {
      id: room.id,
      nameEn: room.nameEn,
      nameAr: room.nameAr,
      code: room.code,
      kind: room.kind,
      accent: room.accent,
      row,
      centerX: (room.x + room.width / 2 - 1000) * WORLD_X_SCALE,
      centerZ: row === 'north' ? OFFICE_WORLD.northZ : OFFICE_WORLD.southZ,
      width,
      depth,
      signY: 2.55,
    };
  });
}

export const ROOM_3D_LAYOUTS = buildRoomLayouts();
export const ROOM_3D_BY_ID: Record<string, Room3DLayout> = Object.fromEntries(
  ROOM_3D_LAYOUTS.map((room) => [room.id, room]),
);

/** Maps a preserved office workstation spot into world coordinates inside its room. */
export function spotToWorld(spot: RoomSpot): WorldPoint {
  const planRoom = ROOM_BY_ID[spot.roomId];
  const room = ROOM_3D_BY_ID[spot.roomId];
  if (!planRoom || !room) return { x: 0, z: 0 };
  const localX = clamp(
    (spot.x - (planRoom.x + planRoom.width / 2)) * WORLD_X_SCALE,
    -room.width / 2 + 0.48,
    room.width / 2 - 0.48,
  );
  const localZ = clamp(
    ((spot.y - (planRoom.y + planRoom.height / 2)) / planRoom.height) * room.depth,
    -room.depth / 2 + 0.62,
    room.depth / 2 - 0.62,
  );
  return { x: room.centerX + localX, z: room.centerZ + localZ };
}

export function roomSpots(roomId: string): RoomSpot[] {
  return ROOM_SPOTS.filter((spot) => spot.roomId === roomId);
}

/** Deterministic overflow positions when a department has more real agents than workstation spots. */
export function overflowSpot(roomId: string, index: number): WorldPoint {
  const room = ROOM_3D_BY_ID[roomId];
  if (!room) return { x: 0, z: 0 };
  const column = index % 3;
  const line = Math.floor(index / 3) % 2;
  return {
    x: room.centerX + (column - 1) * Math.min(0.82, room.width / 3.4),
    z: room.centerZ + (line === 0 ? -0.92 : 0.92),
  };
}

/** Chooses a workstation/collaboration spot for an actual persistent agent record. */
export function agentSpot(agentId: string, roomId: string, occupied: ReadonlySet<string>): { point: WorldPoint; spotId: string | null } {
  const preferred = roomSpots(roomId).filter((spot) => spot.role === 'desk' || spot.role === 'desk-alt' || spot.role === 'collab' || spot.role === 'board');
  const fallback = roomSpots(roomId);
  for (const spot of [...preferred, ...fallback]) {
    if (!occupied.has(spot.id)) return { point: spotToWorld(spot), spotId: spot.id };
  }
  const index = [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  return { point: overflowSpot(roomId, index), spotId: null };
}

/** Derives a robot animation only from real participant lifecycle and recorded task state. */
export function agentVisualState(agent: AgentParticipant, tasks: readonly SharedWorkspaceEntry[]): RobotVisualState {
  const lifecycle = String(agent.lifecycleState ?? '');
  const status = String(agent.status ?? '');
  const current = tasks.find((task) => task.targetAgentId === agent.id && !task.payload?.sample);
  if (status === 'OFFLINE') return 'offline';
  if (lifecycle === 'ERROR') return 'blocked';
  if (status === 'AWAY') return 'waiting';
  if (lifecycle === 'RESPONDING' || String(agent.avatarState ?? '') === 'talking') return 'communicating';
  if (lifecycle === 'THINKING' || lifecycle === 'REFINING') return 'thinking';
  if (current?.status === 'review_pending') return 'reviewing';
  if (current?.status === 'approved' || current?.status === 'done') return 'completed';
  if (lifecycle === 'EXECUTING' || lifecycle === 'EXECUTING_TOOL' || status === 'BUSY' || agent.activeTasks > 0) return 'working';
  if (current && (current.status === 'open' || current.status === 'in_progress')) return 'working';
  return 'idle';
}

export function agentCurrentTask(agentId: string, tasks: readonly SharedWorkspaceEntry[]): SharedWorkspaceEntry | undefined {
  return tasks.find((task) => task.targetAgentId === agentId && !task.payload?.sample);
}

export const ROBOT_STATE_LABELS: Record<RobotVisualState, string> = {
  working: 'يُنفّذ مهمة مسجّلة',
  thinking: 'يفكّر / يحلّل',
  communicating: 'يرسل ردًا',
  idle: 'متاح',
  reviewing: 'بانتظار المراجعة',
  blocked: 'حالة خطأ مسجّلة',
  completed: 'آخر مهمة مكتملة',
  waiting: 'غير متاح مؤقتًا',
  offline: 'غير متصل',
};
