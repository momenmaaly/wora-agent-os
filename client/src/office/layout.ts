/**
 * layout.ts — Wora HQ Architectural Blueprint, Corridor Graph & Company Roster
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the complete corporate headquarters floorplan:
 *   • 6 furnished rooms (Planning, Boardroom, Engineering, Security & QA,
 *     Reception & Café Lounge, Data & Analytics)
 *   • 3 interconnected corridors (Main Central Avenue, West Hallway, East Hallway)
 *   • Exact doorway thresholds & Dijkstra shortest-path navigation so agents and
 *     visitors always walk naturally along corridors and through open doorways
 *     without ever crossing walls or furniture.
 */

import {
  AgentLifecycleState,
  AgentOrigin,
  AvatarAnimState,
  BrainProvider,
  ParticipantStatus,
} from '../types.js';
import type {
  AgentParticipant,
  SharedWorkspaceEntry,
  SharedWorkspaceState,
  WorkspaceZone,
} from '../types.js';

export const WORLD_WIDTH  = 1600;
export const WORLD_HEIGHT = 960;

export interface Point2D {
  x: number;
  y: number;
}

export type RoomKind =
  | 'planning'
  | 'boardroom'
  | 'engineering'
  | 'review'
  | 'lounge'
  | 'analytics';

export interface DoorwayDef {
  id:   string;
  wall: 'north' | 'south' | 'east' | 'west';
  /** Start offset (absolute world x for north/south walls, world y for east/west) */
  from: number;
  /** End offset (absolute world x for north/south walls, world y for east/west) */
  to:   number;
  isDouble?: boolean;
}

export interface RoomSpot {
  id:       string;
  roomId:   string;
  role:     'desk' | 'desk-alt' | 'board' | 'collab' | 'meeting' | 'coffee' | 'lounge' | 'reception';
  labelAr:  string;
  x:        number;
  y:        number;
  facing:   'up' | 'down' | 'left' | 'right';
}

export interface OfficeRoom {
  id:          string;
  code:        string;
  kind:        RoomKind;
  nameAr:      string;
  nameEn:      string;
  subtitleAr:  string;
  accent:      string;
  floorTintLight: string;
  floorTintDark:  string;
  rugLight:       string;
  rugDark:        string;
  x:           number;
  y:           number;
  width:       number;
  height:      number;
  doors:       DoorwayDef[];
  /** Syncs with backend zoneId when applicable */
  isBackendZone: boolean;
}

/* ─── CORRIDOR GEOMETRY ─────────────────────────────────── */
export const CORRIDORS = {
  main: {
    id:     'corridor-main',
    nameAr: 'الممر الرئيسي',
    nameEn: 'MAIN CORRIDOR',
    x:      48,
    y:      384,
    width:  1504,
    height: 152,
    centerY: 460,
  },
  west: {
    id:     'corridor-west',
    nameAr: 'الممر الغربي',
    nameEn: 'WEST HALL',
    x:      468,
    y:      48,
    width:  100,
    height: 864,
    centerX: 518,
  },
  east: {
    id:     'corridor-east',
    nameAr: 'الممر الشرقي',
    nameEn: 'EAST HALL',
    x:      1032,
    y:      48,
    width:  100,
    height: 864,
    centerX: 1082,
  },
} as const;

/* ─── 6 ARCHITECTURAL COMPANY ROOMS ─────────────────────── */
export const OFFICE_ROOMS: readonly OfficeRoom[] = [
  {
    id:             'zone-planning',
    code:           'R-101',
    kind:           'planning',
    nameAr:         'قسم التخطيط والاستراتيجية',
    nameEn:         'Planning Suite',
    subtitleAr:     'خارطة الطريق وهندسة المنتجات',
    accent:         '#4f46e5',
    floorTintLight: '#f6f7fc',
    floorTintDark:  '#171c2b',
    rugLight:       '#eaedfb',
    rugDark:        '#1f2640',
    x:              48,
    y:              48,
    width:          420,
    height:         336,
    isBackendZone:  true,
    doors: [
      { id: 'd-plan-s', wall: 'south', from: 222, to: 294 },
      { id: 'd-plan-e', wall: 'east',  from: 204, to: 268 },
    ],
  },
  {
    id:             'zone-boardroom',
    code:           'R-102',
    kind:           'boardroom',
    nameAr:         'قاعة الاجتماعات التنفيذية',
    nameEn:         'Executive Boardroom',
    subtitleAr:     'الاجتماعات المشتركة ومزامنة الفرق',
    accent:         '#7c3aed',
    floorTintLight: '#f9f7fc',
    floorTintDark:  '#1a1929',
    rugLight:       '#efeafa',
    rugDark:        '#24203b',
    x:              568,
    y:              48,
    width:          464,
    height:         336,
    isBackendZone:  false,
    doors: [
      { id: 'd-board-s', wall: 'south', from: 752, to: 848, isDouble: true },
      { id: 'd-board-w', wall: 'west',  from: 204, to: 268 },
      { id: 'd-board-e', wall: 'east',  from: 204, to: 268 },
    ],
  },
  {
    id:             'zone-engineering',
    code:           'R-103',
    kind:           'engineering',
    nameAr:         'مختبر الهندسة والتطوير',
    nameEn:         'Engineering Lab',
    subtitleAr:     'بناء الأنظمة والكود والبنية التحتية',
    accent:         '#0284c7',
    floorTintLight: '#f4f8fb',
    floorTintDark:  '#151e2b',
    rugLight:       '#e4f1fa',
    rugDark:        '#1a293d',
    x:              1132,
    y:              48,
    width:          420,
    height:         336,
    isBackendZone:  true,
    doors: [
      { id: 'd-eng-s', wall: 'south', from: 1306, to: 1378 },
      { id: 'd-eng-w', wall: 'west',  from: 204,  to: 268 },
    ],
  },
  {
    id:             'zone-review',
    code:           'R-104',
    kind:           'review',
    nameAr:         'غرفة المراجعة والأمان',
    nameEn:         'Security & QA',
    subtitleAr:     'فحص الكود والأمن السيبراني والجودة',
    accent:         '#d97706',
    floorTintLight: '#fcf9f4',
    floorTintDark:  '#211d18',
    rugLight:       '#f8eedc',
    rugDark:        '#2d251b',
    x:              48,
    y:              536,
    width:          420,
    height:         376,
    isBackendZone:  true,
    doors: [
      { id: 'd-rev-n', wall: 'north', from: 222, to: 294 },
      { id: 'd-rev-e', wall: 'east',  from: 668, to: 732 },
    ],
  },
  {
    id:             'zone-lounge',
    code:           'R-105',
    kind:           'lounge',
    nameAr:         'الاستقبال واستراحة الموظفين',
    nameEn:         'Reception & Café',
    subtitleAr:     'المدخل الرئيسي وركن القهوة والنقاشات',
    accent:         '#0d9488',
    floorTintLight: '#f5faf9',
    floorTintDark:  '#162123',
    rugLight:       '#e3f4f1',
    rugDark:        '#1c2e30',
    x:              568,
    y:              536,
    width:          464,
    height:         376,
    isBackendZone:  false,
    doors: [
      { id: 'd-lng-n', wall: 'north', from: 752, to: 848, isDouble: true },
      { id: 'd-lng-w', wall: 'west',  from: 668, to: 732 },
      { id: 'd-lng-e', wall: 'east',  from: 668, to: 732 },
    ],
  },
  {
    id:             'zone-analytics',
    code:           'R-106',
    kind:           'analytics',
    nameAr:         'مركز البيانات والتحليلات',
    nameEn:         'Analytics Center',
    subtitleAr:     'قياس الأداء والبيانات واقتصاديات النماذج',
    accent:         '#059669',
    floorTintLight: '#f4faf7',
    floorTintDark:  '#15211d',
    rugLight:       '#e2f5ec',
    rugDark:        '#1b2f27',
    x:              1132,
    y:              536,
    width:          420,
    height:         376,
    isBackendZone:  true,
    doors: [
      { id: 'd-ana-n', wall: 'north', from: 1306, to: 1378 },
      { id: 'd-ana-w', wall: 'west',  from: 668,  to: 732 },
    ],
  },
];

export const ROOM_BY_ID: Record<string, OfficeRoom> = Object.fromEntries(
  OFFICE_ROOMS.map((r) => [r.id, r]),
);

/* ─── ROOM SPOTS (DESKS, BOARDS, SEATS, LOUNGE) ─────────── */
export const ROOM_SPOTS: readonly RoomSpot[] = [
  // Planning Suite (R-101)
  { id: 'plan-desk',   roomId: 'zone-planning', role: 'desk',     labelAr: 'مكتب التخطيط الرئيسي', x: 168, y: 174, facing: 'up' },
  { id: 'plan-desk2',  roomId: 'zone-planning', role: 'desk-alt', labelAr: 'مكتب التخطيط المساند', x: 356, y: 174, facing: 'up' },
  { id: 'plan-board',  roomId: 'zone-planning', role: 'board',    labelAr: 'لوحة خارطة الطريق',    x: 134, y: 294, facing: 'left' },
  { id: 'plan-collab', roomId: 'zone-planning', role: 'collab',   labelAr: 'طاولة عصف ذهني',       x: 356, y: 296, facing: 'down' },

  // Executive Boardroom (R-102)
  { id: 'board-seat-1', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 1', x: 716, y: 146, facing: 'down' },
  { id: 'board-seat-2', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 2', x: 800, y: 146, facing: 'down' },
  { id: 'board-seat-3', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 3', x: 884, y: 146, facing: 'down' },
  { id: 'board-seat-4', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 4', x: 716, y: 296, facing: 'up' },
  { id: 'board-seat-5', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 5', x: 800, y: 296, facing: 'up' },
  { id: 'board-seat-6', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد اجتماعات 6', x: 884, y: 296, facing: 'up' },

  // Engineering Lab (R-103)
  { id: 'eng-desk',   roomId: 'zone-engineering', role: 'desk',     labelAr: 'محطة التطوير الرئيسية', x: 1252, y: 174, facing: 'up' },
  { id: 'eng-desk2',  roomId: 'zone-engineering', role: 'desk-alt', labelAr: 'محطة التطوير الثانية',  x: 1432, y: 174, facing: 'up' },
  { id: 'eng-board',  roomId: 'zone-engineering', role: 'board',    labelAr: 'وحدة الخوادم والبنية',  x: 1462, y: 296, facing: 'right' },
  { id: 'eng-collab', roomId: 'zone-engineering', role: 'collab',   labelAr: 'ركن البرمجة الثنائية',  x: 1236, y: 296, facing: 'down' },

  // Security & QA (R-104)
  { id: 'rev-desk',   roomId: 'zone-review', role: 'desk',     labelAr: 'محطة فحص الأمان',      x: 168, y: 780, facing: 'down' },
  { id: 'rev-desk2',  roomId: 'zone-review', role: 'desk-alt', labelAr: 'محطة اختبار الجودة',   x: 356, y: 780, facing: 'down' },
  { id: 'rev-board',  roomId: 'zone-review', role: 'board',    labelAr: 'شاشة مراقبة التهديدات', x: 136, y: 636, facing: 'left' },
  { id: 'rev-collab', roomId: 'zone-review', role: 'collab',   labelAr: 'مكتب مراجعة الكود',     x: 356, y: 636, facing: 'up' },

  // Reception & Café Lounge (R-105)
  { id: 'lng-coffee',    roomId: 'zone-lounge', role: 'coffee',    labelAr: 'ركن القهوة والإسبريسو', x: 942, y: 636, facing: 'right' },
  { id: 'lng-sofa1',     roomId: 'zone-lounge', role: 'lounge',    labelAr: 'جلسة الاستراحة 1',     x: 658, y: 642, facing: 'right' },
  { id: 'lng-sofa2',     roomId: 'zone-lounge', role: 'lounge',    labelAr: 'جلسة الاستراحة 2',     x: 658, y: 752, facing: 'right' },
  { id: 'lng-reception', roomId: 'zone-lounge', role: 'reception', labelAr: 'بهو الاستقبال الرئيسي', x: 800, y: 774, facing: 'down' },

  // Analytics Center (R-106)
  { id: 'ana-desk',   roomId: 'zone-analytics', role: 'desk',     labelAr: 'مكتب تحليل البيانات',   x: 1252, y: 780, facing: 'down' },
  { id: 'ana-desk2',  roomId: 'zone-analytics', role: 'desk-alt', labelAr: 'مكتب النمذجة والقياس',  x: 1432, y: 780, facing: 'down' },
  { id: 'ana-board',  roomId: 'zone-analytics', role: 'board',    labelAr: 'لوحة مؤشرات الأداء',    x: 1460, y: 636, facing: 'right' },
  { id: 'ana-collab', roomId: 'zone-analytics', role: 'collab',   labelAr: 'طاولة مراجعة المقاييس', x: 1236, y: 636, facing: 'up' },
];

export const SPOT_BY_ID: Record<string, RoomSpot> = Object.fromEntries(
  ROOM_SPOTS.map((s) => [s.id, s]),
);

export function getRoomSpots(roomId: string, role?: RoomSpot['role']): RoomSpot[] {
  return ROOM_SPOTS.filter((s) => s.roomId === roomId && (!role || s.role === role));
}

/* ─── CORRIDOR & DOORWAY NAVIGATION GRAPH (DIJKSTRA) ────── */
interface NavNode {
  id: string;
  x:  number;
  y:  number;
}

const NAV_NODES: readonly NavNode[] = [
  // Main Central Corridor spine (y = 460)
  { id: 'c-w-end',   x: 130,  y: 460 },
  { id: 'c-plan-s',  x: 258,  y: 460 },
  { id: 'c-west-x',  x: 518,  y: 460 },
  { id: 'c-mid-w',   x: 660,  y: 460 },
  { id: 'c-center',  x: 800,  y: 460 },
  { id: 'c-mid-e',   x: 940,  y: 460 },
  { id: 'c-east-x',  x: 1082, y: 460 },
  { id: 'c-eng-s',   x: 1342, y: 460 },
  { id: 'c-e-end',   x: 1470, y: 460 },

  // West Hallway spine (x = 518)
  { id: 'cw-north',  x: 518,  y: 120 },
  { id: 'cw-upper',  x: 518,  y: 236 },
  { id: 'cw-lower',  x: 518,  y: 700 },
  { id: 'cw-south',  x: 518,  y: 836 },

  // East Hallway spine (x = 1082)
  { id: 'ce-north',  x: 1082, y: 120 },
  { id: 'ce-upper',  x: 1082, y: 236 },
  { id: 'ce-lower',  x: 1082, y: 700 },
  { id: 'ce-south',  x: 1082, y: 836 },

  // Planning doorways & interior hub
  { id: 'dp-s-in',   x: 258,  y: 350 },
  { id: 'dp-e-in',   x: 432,  y: 236 },
  { id: 'p-hub',     x: 258,  y: 236 },

  // Boardroom doorways & perimeter ring (avoids walking across conference table)
  { id: 'db-s-in',   x: 800,  y: 352 },
  { id: 'db-w-in',   x: 604,  y: 236 },
  { id: 'db-e-in',   x: 996,  y: 236 },
  { id: 'b-nw',      x: 626,  y: 146 },
  { id: 'b-ne',      x: 974,  y: 146 },
  { id: 'b-sw',      x: 626,  y: 320 },
  { id: 'b-se',      x: 974,  y: 320 },

  // Engineering doorways & interior hub
  { id: 'de-s-in',   x: 1342, y: 350 },
  { id: 'de-w-in',   x: 1168, y: 236 },
  { id: 'e-hub',     x: 1342, y: 236 },

  // Security & QA doorways & interior hub
  { id: 'dr-n-in',   x: 258,  y: 572 },
  { id: 'dr-e-in',   x: 432,  y: 700 },
  { id: 'r-hub',     x: 258,  y: 700 },

  // Reception & Lounge doorways & interior hub
  { id: 'dl-n-in',   x: 800,  y: 572 },
  { id: 'dl-w-in',   x: 604,  y: 700 },
  { id: 'dl-e-in',   x: 996,  y: 700 },
  { id: 'l-hub',     x: 800,  y: 700 },

  // Analytics doorways & interior hub
  { id: 'da-n-in',   x: 1342, y: 572 },
  { id: 'da-w-in',   x: 1168, y: 700 },
  { id: 'a-hub',     x: 1342, y: 700 },

  // Append every named RoomSpot as a routable node
  ...ROOM_SPOTS.map((s) => ({ id: s.id, x: s.x, y: s.y })),
];

const NAV_EDGES: ReadonlyArray<readonly [string, string]> = [
  // Main Corridor spine
  ['c-w-end',  'c-plan-s'],
  ['c-plan-s', 'c-west-x'],
  ['c-west-x', 'c-mid-w'],
  ['c-mid-w',  'c-center'],
  ['c-center', 'c-mid-e'],
  ['c-mid-e',  'c-east-x'],
  ['c-east-x', 'c-eng-s'],
  ['c-eng-s',  'c-e-end'],

  // West Hallway spine
  ['cw-north', 'cw-upper'],
  ['cw-upper', 'c-west-x'],
  ['c-west-x', 'cw-lower'],
  ['cw-lower', 'cw-south'],

  // East Hallway spine
  ['ce-north', 'ce-upper'],
  ['ce-upper', 'c-east-x'],
  ['c-east-x', 'ce-lower'],
  ['ce-lower', 'ce-south'],

  // Planning Suite connections
  ['c-plan-s', 'dp-s-in'],
  ['dp-s-in',  'p-hub'],
  ['cw-upper', 'dp-e-in'],
  ['dp-e-in',  'p-hub'],
  ['p-hub',    'plan-desk'],
  ['p-hub',    'plan-desk2'],
  ['p-hub',    'plan-board'],
  ['p-hub',    'plan-collab'],
  ['dp-s-in',  'plan-board'],
  ['dp-s-in',  'plan-collab'],
  ['dp-e-in',  'plan-desk2'],
  ['dp-e-in',  'plan-collab'],

  // Boardroom connections (clean perimeter around conference table)
  ['c-center',     'db-s-in'],
  ['cw-upper',     'db-w-in'],
  ['ce-upper',     'db-e-in'],
  ['db-s-in',      'b-sw'],
  ['db-s-in',      'b-se'],
  ['db-s-in',      'board-seat-4'],
  ['db-s-in',      'board-seat-5'],
  ['db-s-in',      'board-seat-6'],
  ['db-w-in',      'b-nw'],
  ['db-w-in',      'b-sw'],
  ['db-e-in',      'b-ne'],
  ['db-e-in',      'b-se'],
  ['b-sw',         'board-seat-4'],
  ['b-se',         'board-seat-6'],
  ['board-seat-4', 'board-seat-5'],
  ['board-seat-5', 'board-seat-6'],
  ['b-nw',         'board-seat-1'],
  ['board-seat-1', 'board-seat-2'],
  ['board-seat-2', 'board-seat-3'],
  ['board-seat-3', 'b-ne'],

  // Engineering Lab connections
  ['c-eng-s',  'de-s-in'],
  ['de-s-in',  'e-hub'],
  ['ce-upper', 'de-w-in'],
  ['de-w-in',  'e-hub'],
  ['e-hub',    'eng-desk'],
  ['e-hub',    'eng-desk2'],
  ['e-hub',    'eng-board'],
  ['e-hub',    'eng-collab'],
  ['de-s-in',  'eng-board'],
  ['de-s-in',  'eng-collab'],
  ['de-w-in',  'eng-desk'],
  ['de-w-in',  'eng-collab'],

  // Security & QA connections
  ['c-plan-s', 'dr-n-in'],
  ['dr-n-in',  'r-hub'],
  ['cw-lower', 'dr-e-in'],
  ['dr-e-in',  'r-hub'],
  ['r-hub',    'rev-desk'],
  ['r-hub',    'rev-desk2'],
  ['r-hub',    'rev-board'],
  ['r-hub',    'rev-collab'],
  ['dr-n-in',  'rev-board'],
  ['dr-n-in',  'rev-collab'],
  ['dr-e-in',  'rev-desk2'],
  ['dr-e-in',  'rev-collab'],

  // Reception & Café Lounge connections
  ['c-center', 'dl-n-in'],
  ['dl-n-in',  'l-hub'],
  ['cw-lower', 'dl-w-in'],
  ['dl-w-in',  'l-hub'],
  ['ce-lower', 'dl-e-in'],
  ['dl-e-in',  'l-hub'],
  ['l-hub',    'lng-coffee'],
  ['l-hub',    'lng-sofa1'],
  ['l-hub',    'lng-sofa2'],
  ['l-hub',    'lng-reception'],
  ['dl-n-in',  'lng-coffee'],
  ['dl-n-in',  'lng-sofa1'],
  ['dl-w-in',  'lng-sofa1'],
  ['dl-w-in',  'lng-sofa2'],
  ['dl-e-in',  'lng-coffee'],

  // Analytics Center connections
  ['c-eng-s',  'da-n-in'],
  ['da-n-in',  'a-hub'],
  ['ce-lower', 'da-w-in'],
  ['da-w-in',  'a-hub'],
  ['a-hub',    'ana-desk'],
  ['a-hub',    'ana-desk2'],
  ['a-hub',    'ana-board'],
  ['a-hub',    'ana-collab'],
  ['da-n-in',  'ana-board'],
  ['da-n-in',  'ana-collab'],
  ['da-w-in',  'ana-desk'],
  ['da-w-in',  'ana-collab'],
];

const NODE_MAP = new Map<string, NavNode>(NAV_NODES.map((n) => [n.id, n]));
const ADJACENCY = new Map<string, Array<{ id: string; cost: number }>>();

for (const n of NAV_NODES) ADJACENCY.set(n.id, []);
for (const [a, b] of NAV_EDGES) {
  const na = NODE_MAP.get(a);
  const nb = NODE_MAP.get(b);
  if (!na || !nb) continue;
  const cost = Math.hypot(na.x - nb.x, na.y - nb.y);
  ADJACENCY.get(a)?.push({ id: b, cost });
  ADJACENCY.get(b)?.push({ id: a, cost });
}

/** Identifies the room or corridor containing a world coordinate */
export function locatePoint(p: Point2D): {
  areaId:   string;
  nameAr:   string;
  nameEn:   string;
  isRoom:   boolean;
  room:     OfficeRoom | null;
} {
  for (const r of OFFICE_ROOMS) {
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
      return { areaId: r.id, nameAr: r.nameAr, nameEn: r.nameEn, isRoom: true, room: r };
    }
  }
  if (
    p.x >= CORRIDORS.main.x &&
    p.x <= CORRIDORS.main.x + CORRIDORS.main.width &&
    p.y >= CORRIDORS.main.y &&
    p.y <= CORRIDORS.main.y + CORRIDORS.main.height
  ) {
    return {
      areaId: CORRIDORS.main.id,
      nameAr: CORRIDORS.main.nameAr,
      nameEn: CORRIDORS.main.nameEn,
      isRoom: false,
      room:   null,
    };
  }
  if (
    p.x >= CORRIDORS.west.x &&
    p.x <= CORRIDORS.west.x + CORRIDORS.west.width &&
    p.y >= CORRIDORS.west.y &&
    p.y <= CORRIDORS.west.y + CORRIDORS.west.height
  ) {
    return {
      areaId: CORRIDORS.west.id,
      nameAr: CORRIDORS.west.nameAr,
      nameEn: CORRIDORS.west.nameEn,
      isRoom: false,
      room:   null,
    };
  }
  if (
    p.x >= CORRIDORS.east.x &&
    p.x <= CORRIDORS.east.x + CORRIDORS.east.width &&
    p.y >= CORRIDORS.east.y &&
    p.y <= CORRIDORS.east.y + CORRIDORS.east.height
  ) {
    return {
      areaId: CORRIDORS.east.id,
      nameAr: CORRIDORS.east.nameAr,
      nameEn: CORRIDORS.east.nameEn,
      isRoom: false,
      room:   null,
    };
  }
  return { areaId: 'campus', nameAr: 'ساحة المقر', nameEn: 'HQ Floor', isRoom: false, room: null };
}

/** Finds nearest navigation node strictly inside the same room/corridor (prevents wall jumping) */
function findNearestNavNode(p: Point2D): NavNode {
  const loc = locatePoint(p);
  let bestSameArea: NavNode | null = null;
  let bestSameDist = Infinity;
  let bestAny: NavNode = NAV_NODES[0]!;
  let bestAnyDist = Infinity;

  for (const node of NAV_NODES) {
    const d = Math.hypot(node.x - p.x, node.y - p.y);
    if (d < bestAnyDist) {
      bestAnyDist = d;
      bestAny = node;
    }
    const nLoc = locatePoint(node);
    const sameContext = loc.isRoom ? nLoc.areaId === loc.areaId : !nLoc.isRoom;
    if (sameContext && d < bestSameDist) {
      bestSameDist = d;
      bestSameArea = node;
    }
  }

  return bestSameArea ?? bestAny;
}

/**
 * Computes an exact obstacle-free path through doorways and corridors from `start`
 * to a target `spotId` (or world coordinate).
 */
export function computeOfficePath(start: Point2D, target: string | Point2D): Point2D[] {
  const startNode = findNearestNavNode(start);
  const goalNode =
    typeof target === 'string'
      ? (NODE_MAP.get(target) ?? findNearestNavNode(start))
      : findNearestNavNode(target);

  if (startNode.id === goalNode.id) {
    if (typeof target !== 'string') {
      const sLoc = locatePoint(start);
      const tLoc = locatePoint(target);
      if (sLoc.areaId === tLoc.areaId && sLoc.areaId !== 'campus') {
        return [{ x: target.x, y: target.y }];
      }
    }
    return [{ x: goalNode.x, y: goalNode.y }];
  }

  // Standard Dijkstra shortest path over nav graph
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(startNode.id, 0);

  while (true) {
    let currentId: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        currentId = id;
      }
    }
    if (!currentId || currentId === goalNode.id) break;
    visited.add(currentId);

    for (const edge of ADJACENCY.get(currentId) ?? []) {
      if (visited.has(edge.id)) continue;
      const cand = best + edge.cost;
      if (cand < (dist.get(edge.id) ?? Infinity)) {
        dist.set(edge.id, cand);
        prev.set(edge.id, currentId);
      }
    }
  }

  const chain: Point2D[] = [];
  let cursor: string | undefined = goalNode.id;
  while (cursor) {
    const n = NODE_MAP.get(cursor);
    if (n) chain.push({ x: n.x, y: n.y });
    cursor = prev.get(cursor);
  }
  chain.reverse();

  // Drop the first waypoint if we're already practically standing on it
  if (chain.length > 1 && Math.hypot(chain[0]!.x - start.x, chain[0]!.y - start.y) < 12) {
    chain.shift();
  }

  // If clicking freely inside a corridor, finish cleanly at clamped corridor point
  if (typeof target !== 'string') {
    const tLoc = locatePoint(target);
    if (!tLoc.isRoom && tLoc.areaId !== 'campus') {
      chain.push({ x: target.x, y: target.y });
    }
  }

  return chain;
}

/* ─── PROVIDER BRAND METADATA (FOR MODEL BADGES) ────────── */
export interface ProviderVisual {
  shortLabel: string;
  fullLabel:  string;
  color:      string;
  bgLight:    string;
  bgDark:     string;
  border:     string;
}

export const PROVIDER_VISUALS: Record<BrainProvider, ProviderVisual> = {
  [BrainProvider.Google]: {
    shortLabel: 'Gemini',
    fullLabel:  'Google Gemini',
    color:      '#2563eb',
    bgLight:    'rgba(37, 99, 235, 0.10)',
    bgDark:     'rgba(59, 130, 246, 0.18)',
    border:     'rgba(37, 99, 235, 0.30)',
  },
  [BrainProvider.Anthropic]: {
    shortLabel: 'Claude',
    fullLabel:  'Anthropic Claude',
    color:      '#c2410c',
    bgLight:    'rgba(194, 65, 12, 0.10)',
    bgDark:     'rgba(251, 146, 60, 0.18)',
    border:     'rgba(194, 65, 12, 0.30)',
  },
  [BrainProvider.OpenAI]: {
    shortLabel: 'OpenAI',
    fullLabel:  'OpenAI GPT',
    color:      '#059669',
    bgLight:    'rgba(5, 150, 105, 0.10)',
    bgDark:     'rgba(16, 185, 129, 0.18)',
    border:     'rgba(5, 150, 105, 0.30)',
  },
  [BrainProvider.Groq]: {
    shortLabel: 'Groq',
    fullLabel:  'Groq LPU',
    color:      '#7c3aed',
    bgLight:    'rgba(124, 58, 237, 0.10)',
    bgDark:     'rgba(167, 139, 250, 0.18)',
    border:     'rgba(124, 58, 237, 0.30)',
  },
};

export function formatShortModel(model: string): string {
  // Strip verbose org prefix like `meta-llama/` for clean badge display while keeping model ID unmistakable
  return model.includes('/') ? (model.split('/').pop() ?? model) : model;
}

/* ─── ROLE TRANSLATIONS FOR ARABIC CORPORATE UI ─────────── */
export const AGENT_ROLE_AR: Record<string, string> = {
  'agent-planner-01':  'مديرة التخطيط والاستراتيجية',
  'agent-coder-01':    'كبير مهندسي البرمجيات',
  'agent-reviewer-01': 'مسؤول مراجعة الكود والأمان',
  'agent-analyst-01':  'محللة البيانات والأداء',
};

export function getAgentHomeSpot(agent: AgentParticipant, index = 0): RoomSpot {
  const roomId = agent.zoneId && ROOM_BY_ID[agent.zoneId] ? agent.zoneId : 'zone-planning';
  const primary = ROOM_SPOTS.find((s) => s.roomId === roomId && s.role === 'desk');
  const alt     = ROOM_SPOTS.find((s) => s.roomId === roomId && s.role === 'desk-alt');
  // Core 4 agents take primary desk; newly hired teammates take secondary desk in that room
  const isCore = ['agent-planner-01', 'agent-coder-01', 'agent-reviewer-01', 'agent-analyst-01'].includes(agent.id);
  if (!isCore && alt) return alt;
  if (primary) return primary;
  return ROOM_SPOTS[index % ROOM_SPOTS.length]!;
}

/* ─── DEFAULT COMPANY ROSTER (INSTANT LOAD ON VERCEL & LIVE) ── */
const BOOT_ISO = '2026-01-01T09:00:00.000Z';

export const DEFAULT_COMPANY_ZONES: WorkspaceZone[] = OFFICE_ROOMS.filter((r) => r.isBackendZone).map((r) => ({
  id:               r.id,
  name:             r.nameEn,
  themeColor:       r.accent,
  position:         { x: r.x, z: r.y },
  radius:           4,
  assignedAgentIds: [],
  maxCapacity:      8,
  description:      r.subtitleAr,
  createdAt:        BOOT_ISO,
  createdBy:        'system',
}));

export const DEFAULT_COMPANY_AGENTS: AgentParticipant[] = [
  {
    id:              'agent-planner-01',
    displayName:     'Aria',
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    zoneId:          'zone-planning',
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: [],
    modelId:         'gemini-2.5-flash',
    activeTasks:     1,
    brainConfig: {
      provider:    BrainProvider.Google,
      model:       'gemini-2.5-flash',
      maxTokens:   2048,
      temperature: 0.6,
    },
    avatarState:   AvatarAnimState.Idle,
    locale:        'ar',
    createdAt:     BOOT_ISO,
    lastSeenAt:    BOOT_ISO,
    status:        ParticipantStatus.Online,
    activeRoomIds: [],
    profile: {
      customRole:  'مديرة التخطيط والاستراتيجية',
      tone:        'Analytical',
      avatarColor: '#4f46e5',
      tagline:     'تحويل الأهداف الكبرى إلى خطط تنفيذية ومهام واضحة للأقسام.',
      specialty:   'تخطيط المنتجات، المعمارية الهندسية، وتوزيع السبرنتات',
      skills:      ['خارطة الطريق', 'معمارية الأنظمة', 'تقسيم المهام', 'تحليل المخاطر'],
    },
  },
  {
    id:              'agent-coder-01',
    displayName:     'Atlas',
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    zoneId:          'zone-engineering',
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: [],
    modelId:         'claude-sonnet-4-5',
    activeTasks:     2,
    brainConfig: {
      provider:    BrainProvider.Anthropic,
      model:       'claude-sonnet-4-5',
      maxTokens:   4096,
      temperature: 0.4,
    },
    avatarState:   AvatarAnimState.Idle,
    locale:        'ar',
    createdAt:     BOOT_ISO,
    lastSeenAt:    BOOT_ISO,
    status:        ParticipantStatus.Online,
    activeRoomIds: [],
    profile: {
      customRole:  'كبير مهندسي البرمجيات',
      tone:        'Concise',
      avatarColor: '#0284c7',
      tagline:     'بناء كود إنتاجي نظيف وعالي الاعتمادية بدون تعقيد زائد.',
      specialty:   'TypeScript, React, Node.js, Redis والأنظمة الفورية',
      skills:      ['TypeScript', 'React', 'Node.js & Redis', 'Docker & CI/CD'],
    },
  },
  {
    id:              'agent-reviewer-01',
    displayName:     'Sentinel',
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    zoneId:          'zone-review',
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: [],
    modelId:         'gpt-4.1',
    activeTasks:     1,
    brainConfig: {
      provider:    BrainProvider.OpenAI,
      model:       'gpt-4.1',
      maxTokens:   2048,
      temperature: 0.3,
    },
    avatarState:   AvatarAnimState.Idle,
    locale:        'ar',
    createdAt:     BOOT_ISO,
    lastSeenAt:    BOOT_ISO,
    status:        ParticipantStatus.Online,
    activeRoomIds: [],
    profile: {
      customRole:  'مسؤول مراجعة الكود والأمان',
      tone:        'Formal',
      avatarColor: '#d97706',
      tagline:     'اكتشاف الثغرات ومشاكل التزامن قبل وصولها إلى بيئة الإنتاج.',
      specialty:   'أمن التطبيقات (OWASP)، مراجعة الكود، واختبارات الجودة',
      skills:      ['التدقيق الأمني', 'مراجعة الكود', 'تحليل التهديدات', 'ضمان الجودة'],
    },
  },
  {
    id:              'agent-analyst-01',
    displayName:     'Nova',
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    zoneId:          'zone-analytics',
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: [],
    modelId:         'llama-3.3-70b-versatile',
    activeTasks:     1,
    brainConfig: {
      provider:    BrainProvider.Groq,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   2048,
      temperature: 0.5,
    },
    avatarState:   AvatarAnimState.Idle,
    locale:        'ar',
    createdAt:     BOOT_ISO,
    lastSeenAt:    BOOT_ISO,
    status:        ParticipantStatus.Online,
    activeRoomIds: [],
    profile: {
      customRole:  'محللة البيانات والأداء',
      tone:        'Analytical',
      avatarColor: '#059669',
      tagline:     'تحسين زمن الاستجابة وتكلفة التوكنات ومؤشرات الأداء الحية.',
      specialty:   'المراقبة، فهرسة البيانات، وتقليل تكلفة نماذج الذكاء الاصطناعي',
      skills:      ['تحسين الأداء', 'اقتصاديات التوكنات', 'مؤشرات SLO', 'تحليل البيانات'],
    },
  },
];

export function buildDefaultWorkspaces(roomId: string): Record<string, SharedWorkspaceState> {
  const mk = (
    id: string,
    zoneId: string,
    type: SharedWorkspaceEntry['type'],
    status: SharedWorkspaceEntry['status'],
    authorAgentId: string,
    title: string,
    payload: Record<string, unknown>,
  ): SharedWorkspaceEntry => ({
    id,
    zoneId,
    roomId,
    type,
    status,
    authorAgentId,
    title,
    payload,
    createdAt: BOOT_ISO,
    updatedAt: BOOT_ISO,
    chainIds:  [],
  });

  const planEntries: SharedWorkspaceEntry[] = [
    mk('init-p1', 'zone-planning', 'task', 'in_progress', 'agent-planner-01', 'خطة إطلاق الإصدار المؤسسي للشركة', {
      sprint: 'Q4-2026',
      owner:  'Aria (gemini-2.5-flash)',
    }),
    mk('init-p2', 'zone-planning', 'handoff', 'approved', 'agent-planner-01', 'تسليم مواصفات الواجهة إلى قسم الهندسة', {
      to: 'Atlas — مختبر الهندسة',
    }),
  ];
  const engEntries: SharedWorkspaceEntry[] = [
    mk('init-e1', 'zone-engineering', 'artifact', 'approved', 'agent-coder-01', 'عزل غرف Redis وتجميع استعلامات MGET', {
      latency: 'O(1) batched read',
      owner:   'Atlas (claude-sonnet-4-5)',
    }),
  ];
  const revEntries: SharedWorkspaceEntry[] = [
    mk('init-r1', 'zone-review', 'review', 'approved', 'agent-reviewer-01', 'مراجعة التحقق عبر Zod وحماية مفاتيح النماذج', {
      severity: '0 ثغرات حرجة',
      reviewer: 'Sentinel (gpt-4.1)',
    }),
  ];
  const anaEntries: SharedWorkspaceEntry[] = [
    mk('init-a1', 'zone-analytics', 'signal', 'open', 'agent-analyst-01', 'تقرير كفاءة وسرعة استجابة الموديلات الأربعة', {
      p95LatencyMs: 175,
      analyst:      'Nova (llama-3.3-70b-versatile)',
    }),
  ];

  return {
    'zone-planning':    { zoneId: 'zone-planning',    roomId, entries: planEntries, lastWriteAt: BOOT_ISO, lastWrittenBy: 'agent-planner-01' },
    'zone-engineering': { zoneId: 'zone-engineering', roomId, entries: engEntries,  lastWriteAt: BOOT_ISO, lastWrittenBy: 'agent-coder-01' },
    'zone-review':      { zoneId: 'zone-review',      roomId, entries: revEntries,  lastWriteAt: BOOT_ISO, lastWrittenBy: 'agent-reviewer-01' },
    'zone-analytics':   { zoneId: 'zone-analytics',   roomId, entries: anaEntries,  lastWriteAt: BOOT_ISO, lastWrittenBy: 'agent-analyst-01' },
  };
}
