import { OFFICE_ROOMS, ROOM_BY_ID, ROOM_SPOTS as OFFICE_SPOTS } from '../office/layout.ts';
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
  corridorNorthZ: -3.18,
  corridorSouthZ: 2.93,
} as const;

export type OfficeRow = 'north' | 'south';
export type RobotVisualState =
  | 'working' | 'thinking' | 'communicating' | 'idle' | 'reviewing'
  | 'blocked' | 'completed' | 'waiting' | 'offline' | 'walking' | 'meeting';

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

/** Structural subset of the persisted agent-location snapshot. */
export interface AgentMotionSnapshot {
  areaId?: string;
  areaNameAr?: string;
  targetRoomId?: string | null;
  isWalking?: boolean;
  activity?: string;
  statusTextAr?: string;
}

export interface RobotStateOptions {
  location?: AgentMotionSnapshot;
  /** True only when the location was produced by an authorized office command, not local auto-roam. */
  locationAuthorized?: boolean;
  /** True while a real dispatch/handoff/meeting movement path is being published. */
  movementActive?: boolean;
}

const WORLD_X_SCALE = 0.01;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rowFor(room: OfficeRoom): OfficeRow {
  return room.y < 400 ? 'north' : 'south';
}

/** Converts the existing 2D office plan into a 3D connected office around a central lobby. */
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

/**
 * Maps any point from the preserved 2D office navigation plan into the connected 3D world.
 * Room interiors follow their room transform; hallway points flow through the central corridor.
 */
export function planPointToWorld(x: number, y: number): WorldPoint {
  const planRoom = OFFICE_ROOMS.find((room) =>
    x >= room.x - 4 && x <= room.x + room.width + 4 && y >= room.y - 4 && y <= room.y + room.height + 4,
  );
  if (planRoom) {
    const room = ROOM_3D_BY_ID[planRoom.id];
    if (room) {
      const localX = clamp(
        (x - (planRoom.x + planRoom.width / 2)) * WORLD_X_SCALE,
        -room.width / 2 + 0.18,
        room.width / 2 - 0.18,
      );
      const localZ = clamp(
        ((y - (planRoom.y + planRoom.height / 2)) / planRoom.height) * room.depth,
        -room.depth / 2 + 0.18,
        room.depth / 2 - 0.18,
      );
      return { x: room.centerX + localX, z: room.centerZ + localZ };
    }
  }
  const worldX = clamp((x - 1000) * WORLD_X_SCALE, -OFFICE_WORLD.slabWidth / 2 + 0.4, OFFICE_WORLD.slabWidth / 2 - 0.4);
  const corridorT = clamp((y - 360) / 160, 0, 1);
  return {
    x: worldX,
    z: OFFICE_WORLD.corridorNorthZ + corridorT * (OFFICE_WORLD.corridorSouthZ - OFFICE_WORLD.corridorNorthZ),
  };
}

/** Re-export the preserved office plan so the WebGL scene can focus exact workstation spots. */
export const ROOM_SPOTS = OFFICE_SPOTS;

export function roomSpots(roomId: string): RoomSpot[] {
  return OFFICE_SPOTS.filter((spot) => spot.roomId === roomId);
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

/**
 * Derives a robot animation only from real participant lifecycle, recorded task state,
 * and authorized office commands. A stale activeTasks counter alone never shows work.
 */
export function agentVisualState(
  agent: AgentParticipant,
  tasks: readonly SharedWorkspaceEntry[],
  options: RobotStateOptions = {},
): RobotVisualState {
  const lifecycle = String(agent.lifecycleState ?? '');
  const status = String(agent.status ?? '');
  const current = tasks.find((task) => task.targetAgentId === agent.id && !task.payload?.sample);
  const location = options.locationAuthorized ? options.location : undefined;
  const activity = String(location?.activity ?? '');

  if (status === 'OFFLINE') return 'offline';
  if (lifecycle === 'ERROR') return 'blocked';
  if (options.movementActive) return 'walking';
  if (lifecycle === 'RESPONDING' || String(agent.avatarState ?? '') === 'talking' || activity === 'responding') return 'communicating';
  if (activity === 'meeting') return 'meeting';
  if (lifecycle === 'THINKING' || lifecycle === 'REFINING' || activity === 'thinking') return 'thinking';
  if (activity === 'board' || current?.status === 'review_pending') return 'reviewing';
  if (current?.status === 'approved' || current?.status === 'done') return 'completed';
  if (lifecycle === 'EXECUTING' || lifecycle === 'EXECUTING_TOOL') return 'working';
  if (current && (current.status === 'open' || current.status === 'in_progress' || current.status === 'claimed')) return 'working';
  if (activity === 'collab') return 'communicating';
  if (status === 'AWAY') return 'waiting';
  return 'idle';
}

export function agentCurrentTask(agentId: string, tasks: readonly SharedWorkspaceEntry[]): SharedWorkspaceEntry | undefined {
  return tasks.find((task) => task.targetAgentId === agentId && !task.payload?.sample);
}

export const ROBOT_STATE_LABELS: Record<RobotVisualState, string> = {
  working: 'يُنفّذ مهمة مسجّلة',
  thinking: 'يفكّر / يحلّل',
  communicating: 'يتواصل مع الفريق',
  idle: 'متاح',
  reviewing: 'يراجع عملًا مسجّلًا',
  blocked: 'حالة خطأ مسجّلة',
  completed: 'آخر مهمة مكتملة',
  waiting: 'غير متاح مؤقتًا',
  offline: 'غير متصل',
  walking: 'يتحرك بأمر مسجّل',
  meeting: 'في اجتماع مسجّل',
};
