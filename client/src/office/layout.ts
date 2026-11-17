/**
 * layout.ts — Wora HQ v6.0 Full Company Campus Blueprint
 * ────────────────────────────────────────────────────────
 * 10 غرف متخصصة + 5 ممرات مترابطة + مخطط Dijkstra محدث
 * يغطي دورة حياة المشروع كاملة: فكرة → منتج → هندسة → تصميم → تسويق → مبيعات → تحليلات
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

export const WORLD_WIDTH  = 2000;
export const WORLD_HEIGHT = 1080;

export interface Point2D { x: number; y: number; }

export type RoomKind =
  | 'product'
  | 'planning'
  | 'boardroom'
  | 'engineering'
  | 'design'
  | 'review'
  | 'marketing'
  | 'sales'
  | 'analytics'
  | 'lounge';

export interface DoorwayDef {
  id:   string;
  wall: 'north' | 'south' | 'east' | 'west';
  from: number;
  to:   number;
  isDouble?: boolean;
}
export interface RoomSpot {
  id:      string;
  roomId:  string;
  role:    'desk' | 'desk-alt' | 'board' | 'collab' | 'meeting' | 'coffee' | 'lounge' | 'reception' | 'showcase' | 'stage';
  labelAr: string;
  x:       number;
  y:       number;
  facing:  'up' | 'down' | 'left' | 'right';
}
export interface OfficeRoom {
  id:             string;
  code:           string;
  kind:           RoomKind;
  nameAr:         string;
  nameEn:         string;
  subtitleAr:     string;
  accent:         string;
  floorTintLight: string;
  floorTintDark:  string;
  rugLight:       string;
  rugDark:        string;
  x:              number;
  y:              number;
  width:          number;
  height:         number;
  doors:          DoorwayDef[];
  isBackendZone:  boolean;
  departmentId:   string;
}

/* ─── الممرات الخمسة ─────────────────────────────────────── */
export const CORRIDORS = {
  main: {
    id: 'corridor-main', nameAr: 'الممر المركزي الرئيسي', nameEn: 'CENTRAL AVENUE',
    x: 48, y: 360, width: 1904, height: 160, centerY: 440,
  },
  v1: {
    id: 'corridor-v1', nameAr: 'الممر الغربي A', nameEn: 'WEST A',
    x: 428, y: 48, width: 90, height: 984, centerX: 473,
  },
  v2: {
    id: 'corridor-v2', nameAr: 'الممر الغربي B', nameEn: 'WEST B',
    x: 828, y: 48, width: 90, height: 984, centerX: 873,
  },
  v3: {
    id: 'corridor-v3', nameAr: 'الممر الشرقي A', nameEn: 'EAST A',
    x: 1228, y: 48, width: 90, height: 984, centerX: 1273,
  },
  v4: {
    id: 'corridor-v4', nameAr: 'الممر الشرقي B', nameEn: 'EAST B',
    x: 1628, y: 48, width: 90, height: 984, centerX: 1673,
  },
} as const;

/* ─── 10 غرف الشركة المتكاملة ──────────────────────────────── */
export const OFFICE_ROOMS: readonly OfficeRoom[] = [
  // ── الصف العلوي (y 48 h300) ──
  {
    id: 'zone-product', code: 'R-101', kind: 'product',
    nameAr: 'مختبر المنتج والابتكار', nameEn: 'Product & Innovation Lab',
    subtitleAr: 'من الفكرة إلى PRD والنماذج الأولية',
    accent: '#f59e0b', floorTintLight: '#fffbf0', floorTintDark: '#241d12', rugLight: '#fef3c7', rugDark: '#332616',
    x: 48, y: 48, width: 380, height: 312, isBackendZone: true, departmentId: 'product',
    doors: [
      { id: 'd-prod-s', wall: 'south', from: 190, to: 262 },
      { id: 'd-prod-e', wall: 'east',  from: 140, to: 204 },
    ],
  },
  {
    id: 'zone-planning', code: 'R-102', kind: 'planning',
    nameAr: 'قسم التخطيط والاستراتيجية', nameEn: 'Planning Suite',
    subtitleAr: 'خارطة الطريق وهندسة السبرنتات',
    accent: '#4f46e5', floorTintLight: '#f6f7fc', floorTintDark: '#171c2b', rugLight: '#eaedfb', rugDark: '#1f2640',
    x: 518, y: 48, width: 310, height: 312, isBackendZone: true, departmentId: 'planning',
    doors: [
      { id: 'd-plan-s', wall: 'south', from: 610, to: 682 },
      { id: 'd-plan-w', wall: 'west',  from: 140, to: 204 },
      { id: 'd-plan-e', wall: 'east',  from: 140, to: 204 },
    ],
  },
  {
    id: 'zone-boardroom', code: 'R-103', kind: 'boardroom',
    nameAr: 'مركز قيادة المشروع', nameEn: 'Project Command Center',
    subtitleAr: 'إدارة المشروع والاجتماعات التنفيذية',
    accent: '#7c3aed', floorTintLight: '#f9f7fc', floorTintDark: '#1a1929', rugLight: '#efeafa', rugDark: '#24203b',
    x: 918, y: 48, width: 310, height: 312, isBackendZone: true, departmentId: 'planning',
    doors: [
      { id: 'd-board-s', wall: 'south', from: 1008, to: 1104, isDouble: true },
      { id: 'd-board-w', wall: 'west',  from: 140, to: 204 },
      { id: 'd-board-e', wall: 'east',  from: 140, to: 204 },
    ],
  },
  {
    id: 'zone-engineering', code: 'R-104', kind: 'engineering',
    nameAr: 'مختبر الهندسة والتطوير', nameEn: 'Engineering Lab',
    subtitleAr: 'بناء الكود والبنية التحتية',
    accent: '#0284c7', floorTintLight: '#f4f8fb', floorTintDark: '#151e2b', rugLight: '#e4f1fa', rugDark: '#1a293d',
    x: 1318, y: 48, width: 310, height: 312, isBackendZone: true, departmentId: 'engineering',
    doors: [
      { id: 'd-eng-s', wall: 'south', from: 1408, to: 1480 },
      { id: 'd-eng-w', wall: 'west',  from: 140, to: 204 },
      { id: 'd-eng-e', wall: 'east',  from: 140, to: 204 },
    ],
  },
  {
    id: 'zone-design', code: 'R-105', kind: 'design',
    nameAr: 'استوديو التصميم والهوية', nameEn: 'Design Studio',
    subtitleAr: 'UX/UI والهوية البصرية',
    accent: '#ec4899', floorTintLight: '#fdf2f8', floorTintDark: '#22131d', rugLight: '#fce7f3', rugDark: '#331b2a',
    x: 1718, y: 48, width: 234, height: 312, isBackendZone: true, departmentId: 'design',
    doors: [
      { id: 'd-design-s', wall: 'south', from: 1780, to: 1852 },
      { id: 'd-design-w', wall: 'west',  from: 140, to: 204 },
    ],
  },
  // ── الصف السفلي (y 520 h470) ──
  {
    id: 'zone-review', code: 'R-106', kind: 'review',
    nameAr: 'غرفة الجودة والأمان', nameEn: 'QA & Security',
    subtitleAr: 'اختبار الكود والتدقيق الأمني',
    accent: '#d97706', floorTintLight: '#fcf9f4', floorTintDark: '#211d18', rugLight: '#f8eedc', rugDark: '#2d251b',
    x: 48, y: 520, width: 380, height: 512, isBackendZone: true, departmentId: 'qa',
    doors: [
      { id: 'd-rev-n', wall: 'north', from: 190, to: 262 },
      { id: 'd-rev-e', wall: 'east',  from: 680, to: 744 },
    ],
  },
  {
    id: 'zone-lounge', code: 'R-107', kind: 'lounge',
    nameAr: 'الاستراحة والثقافة', nameEn: 'Culture & Lounge',
    subtitleAr: 'قهوة وفعاليات وثقافة الشركة',
    accent: '#0d9488', floorTintLight: '#f5faf9', floorTintDark: '#162123', rugLight: '#e3f4f1', rugDark: '#1c2e30',
    x: 518, y: 520, width: 310, height: 512, isBackendZone: true, departmentId: 'lounge',
    doors: [
      { id: 'd-lng-n', wall: 'north', from: 610, to: 682 },
      { id: 'd-lng-w', wall: 'west',  from: 680, to: 744 },
      { id: 'd-lng-e', wall: 'east',  from: 680, to: 744 },
    ],
  },
  {
    id: 'zone-marketing', code: 'R-108', kind: 'marketing',
    nameAr: 'مركز التسويق والنمو', nameEn: 'Marketing & Growth Hub',
    subtitleAr: 'محتوى، SEO، سوشيال، إعلانات',
    accent: '#0891b2', floorTintLight: '#f0fdfa', floorTintDark: '#132225', rugLight: '#ccfbf1', rugDark: '#1a3333',
    x: 918, y: 520, width: 310, height: 512, isBackendZone: true, departmentId: 'marketing',
    doors: [
      { id: 'd-mkt-n', wall: 'north', from: 1008, to: 1104, isDouble: true },
      { id: 'd-mkt-w', wall: 'west',  from: 680, to: 744 },
      { id: 'd-mkt-e', wall: 'east',  from: 680, to: 744 },
    ],
  },
  {
    id: 'zone-sales', code: 'R-109', kind: 'sales',
    nameAr: 'جناح المبيعات والدعم', nameEn: 'Sales & Support',
    subtitleAr: 'إغلاق الصفقات ورعاية العملاء',
    accent: '#7c3aed', floorTintLight: '#f5f3ff', floorTintDark: '#1c182b', rugLight: '#ede9fe', rugDark: '#261f3d',
    x: 1318, y: 520, width: 310, height: 512, isBackendZone: true, departmentId: 'sales',
    doors: [
      { id: 'd-sales-n', wall: 'north', from: 1408, to: 1480 },
      { id: 'd-sales-w', wall: 'west',  from: 680, to: 744 },
      { id: 'd-sales-e', wall: 'east',  from: 680, to: 744 },
    ],
  },
  {
    id: 'zone-analytics', code: 'R-110', kind: 'analytics',
    nameAr: 'مركز البيانات والتحليلات', nameEn: 'Analytics & Finance Center',
    subtitleAr: 'بيانات، مالية، عمليات، قياس النمو',
    accent: '#059669', floorTintLight: '#f4faf7', floorTintDark: '#15211d', rugLight: '#e2f5ec', rugDark: '#1b2f27',
    x: 1718, y: 520, width: 234, height: 512, isBackendZone: true, departmentId: 'analytics',
    doors: [
      { id: 'd-ana-n', wall: 'north', from: 1780, to: 1852 },
      { id: 'd-ana-w', wall: 'west',  from: 680, to: 744 },
    ],
  },
];

export const ROOM_BY_ID: Record<string, OfficeRoom> = Object.fromEntries(OFFICE_ROOMS.map(r => [r.id, r]));

/* ─── نقاط العمل داخل الغرف (4 نقاط لكل غرفة تقريباً) ────────────────── */
export const ROOM_SPOTS: readonly RoomSpot[] = [
  // R-101 Product Lab
  { id: 'prod-desk',    roomId: 'zone-product',   role: 'desk',     labelAr: 'مكتب مدير المنتج',      x: 170, y: 160, facing: 'up' },
  { id: 'prod-board',   roomId: 'zone-product',   role: 'board',    labelAr: 'لوحة الأفكار والـ PRD', x: 320, y: 180, facing: 'right' },
  { id: 'prod-showcase',roomId: 'zone-product',   role: 'showcase', labelAr: 'منصة عرض النماذج',       x: 110, y: 260, facing: 'down' },
  { id: 'prod-collab',  roomId: 'zone-product',   role: 'collab',   labelAr: 'طاولة العصف الذهني',     x: 280, y: 270, facing: 'down' },

  // R-102 Planning
  { id: 'plan-desk',   roomId: 'zone-planning', role: 'desk',     labelAr: 'مكتب التخطيط الرئيسي', x: 640, y: 160, facing: 'up' },
  { id: 'plan-desk2',  roomId: 'zone-planning', role: 'desk-alt', labelAr: 'مكتب Scrum Master',   x: 760, y: 160, facing: 'up' },
  { id: 'plan-board',  roomId: 'zone-planning', role: 'board',    labelAr: 'لوحة خارطة الطريق',    x: 580, y: 260, facing: 'left' },
  { id: 'plan-collab', roomId: 'zone-planning', role: 'collab',   labelAr: 'طاولة التقسيم',        x: 750, y: 270, facing: 'down' },

  // R-103 Command Center
  { id: 'board-seat-1', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 1', x: 1000, y: 140, facing: 'down' },
  { id: 'board-seat-2', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 2', x: 1073, y: 140, facing: 'down' },
  { id: 'board-seat-3', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 3', x: 1146, y: 140, facing: 'down' },
  { id: 'board-seat-4', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 4', x: 1000, y: 270, facing: 'up' },
  { id: 'board-seat-5', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 5', x: 1073, y: 270, facing: 'up' },
  { id: 'board-seat-6', roomId: 'zone-boardroom', role: 'meeting', labelAr: 'مقعد قيادة 6', x: 1146, y: 270, facing: 'up' },

  // R-104 Engineering
  { id: 'eng-desk',   roomId: 'zone-engineering', role: 'desk',     labelAr: 'محطة التطوير الرئيسية', x: 1420, y: 160, facing: 'up' },
  { id: 'eng-desk2',  roomId: 'zone-engineering', role: 'desk-alt', labelAr: 'محطة التطوير الثانية',  x: 1540, y: 160, facing: 'up' },
  { id: 'eng-board',  roomId: 'zone-engineering', role: 'board',    labelAr: 'وحدة الخوادم',          x: 1590, y: 260, facing: 'right' },
  { id: 'eng-collab', roomId: 'zone-engineering', role: 'collab',   labelAr: 'ركن البرمجة الثنائية',  x: 1380, y: 270, facing: 'down' },

  // R-105 Design Studio
  { id: 'design-desk',   roomId: 'zone-design', role: 'desk',     labelAr: 'مكتب مصمم UX',       x: 1790, y: 160, facing: 'up' },
  { id: 'design-desk2',  roomId: 'zone-design', role: 'desk-alt', labelAr: 'مكتب مصمم UI',       x: 1880, y: 160, facing: 'up' },
  { id: 'design-board',  roomId: 'zone-design', role: 'board',    labelAr: 'لوحة Moodboard',     x: 1900, y: 250, facing: 'right' },
  { id: 'design-collab', roomId: 'zone-design', role: 'collab',   labelAr: 'طاولة المراجعة البصرية', x: 1780, y: 270, facing: 'down' },

  // R-106 QA & Security
  { id: 'rev-desk',   roomId: 'zone-review', role: 'desk',     labelAr: 'محطة فحص الأمان',      x: 170, y: 820, facing: 'down' },
  { id: 'rev-desk2',  roomId: 'zone-review', role: 'desk-alt', labelAr: 'محطة اختبار الجودة',   x: 300, y: 820, facing: 'down' },
  { id: 'rev-board',  roomId: 'zone-review', role: 'board',    labelAr: 'شاشة المراقبة',        x: 110, y: 640, facing: 'left' },
  { id: 'rev-collab', roomId: 'zone-review', role: 'collab',   labelAr: 'مكتب المراجعة',        x: 300, y: 650, facing: 'up' },

  // R-107 Lounge
  { id: 'lng-coffee',    roomId: 'zone-lounge', role: 'coffee',    labelAr: 'ركن القهوة',           x: 750, y: 640, facing: 'right' },
  { id: 'lng-sofa1',     roomId: 'zone-lounge', role: 'lounge',    labelAr: 'جلسة 1',              x: 590, y: 650, facing: 'right' },
  { id: 'lng-sofa2',     roomId: 'zone-lounge', role: 'lounge',    labelAr: 'جلسة 2',              x: 590, y: 780, facing: 'right' },
  { id: 'lng-reception', roomId: 'zone-lounge', role: 'reception', labelAr: 'الاستقبال',            x: 673, y: 850, facing: 'down' },
  { id: 'lng-stage',     roomId: 'zone-lounge', role: 'stage',     labelAr: 'منصة الفعاليات',       x: 760, y: 900, facing: 'down' },

  // R-108 Marketing Hub
  { id: 'mkt-desk',   roomId: 'zone-marketing', role: 'desk',     labelAr: 'مكتب كاتب المحتوى',   x: 1000, y: 680, facing: 'up' },
  { id: 'mkt-desk2',  roomId: 'zone-marketing', role: 'desk-alt', labelAr: 'مكتب خبير SEO',       x: 1140, y: 680, facing: 'up' },
  { id: 'mkt-board',  roomId: 'zone-marketing', role: 'board',    labelAr: 'لوحة الحملات',        x: 980, y: 850, facing: 'left' },
  { id: 'mkt-collab', roomId: 'zone-marketing', role: 'collab',   labelAr: 'استوديو التصوير',      x: 1140, y: 850, facing: 'down' },
  { id: 'mkt-showcase',roomId: 'zone-marketing', role: 'showcase', labelAr: 'منصة الإطلاق',        x: 1073, y: 760, facing: 'up' },

  // R-109 Sales
  { id: 'sales-desk',   roomId: 'zone-sales', role: 'desk',     labelAr: 'مكتب المبيعات',        x: 1420, y: 680, facing: 'up' },
  { id: 'sales-desk2',  roomId: 'zone-sales', role: 'desk-alt', labelAr: 'مكتب الدعم',           x: 1540, y: 680, facing: 'up' },
  { id: 'sales-board',  roomId: 'zone-sales', role: 'board',    labelAr: 'لوحة الصفقات',         x: 1590, y: 850, facing: 'right' },
  { id: 'sales-collab', roomId: 'zone-sales', role: 'collab',   labelAr: 'غرفة مكالمات العملاء', x: 1380, y: 850, facing: 'down' },

  // R-110 Analytics
  { id: 'ana-desk',   roomId: 'zone-analytics', role: 'desk',     labelAr: 'مكتب التحليلات',      x: 1790, y: 820, facing: 'down' },
  { id: 'ana-desk2',  roomId: 'zone-analytics', role: 'desk-alt', labelAr: 'مكتب المالية',        x: 1880, y: 820, facing: 'down' },
  { id: 'ana-board',  roomId: 'zone-analytics', role: 'board',    labelAr: 'شاشة المؤشرات',       x: 1900, y: 640, facing: 'right' },
  { id: 'ana-collab', roomId: 'zone-analytics', role: 'collab',   labelAr: 'طاولة العمليات',      x: 1780, y: 680, facing: 'up' },
];

export const SPOT_BY_ID: Record<string, RoomSpot> = Object.fromEntries(ROOM_SPOTS.map(s => [s.id, s]));
export function getRoomSpots(roomId: string, role?: RoomSpot['role']): RoomSpot[] {
  return ROOM_SPOTS.filter(s => s.roomId === roomId && (!role || s.role === role));
}

/* ─── Dijkstra Graph ──────────────────────────────────────── */
interface NavNode { id: string; x: number; y: number; }

const NAV_NODES: readonly NavNode[] = [
  // Main corridor spine y=440
  { id: 'c-p-prod',   x: 238,  y: 440 },
  { id: 'c-v1',       x: 473,  y: 440 },
  { id: 'c-p-plan',   x: 673,  y: 440 },
  { id: 'c-v2',       x: 873,  y: 440 },
  { id: 'c-p-board',  x: 1073, y: 440 },
  { id: 'c-v3',       x: 1273, y: 440 },
  { id: 'c-p-eng',    x: 1473, y: 440 },
  { id: 'c-v4',       x: 1673, y: 440 },
  { id: 'c-p-design', x: 1835, y: 440 },
  // vertical spines
  { id: 'v1-n', x: 473, y: 200 }, { id: 'v1-s', x: 473, y: 800 },
  { id: 'v2-n', x: 873, y: 200 }, { id: 'v2-s', x: 873, y: 800 },
  { id: 'v3-n', x: 1273, y: 200 }, { id: 'v3-s', x: 1273, y: 800 },
  { id: 'v4-n', x: 1673, y: 200 }, { id: 'v4-s', x: 1673, y: 800 },
  // doorway interiors + hubs
  { id: 'dp-s-in', x: 238, y: 340 }, { id: 'dp-e-in', x: 408, y: 200 }, { id: 'p-prod-hub', x: 238, y: 200 },
  { id: 'dplan-s-in', x: 673, y: 340 }, { id: 'dplan-w-in', x: 538, y: 200 }, { id: 'dplan-e-in', x: 808, y: 200 }, { id: 'p-plan-hub', x: 673, y: 200 },
  { id: 'dboard-s-in', x: 1073, y: 340 }, { id: 'dboard-w-in', x: 938, y: 200 }, { id: 'dboard-e-in', x: 1208, y: 200 },
  { id: 'b-nw', x: 980, y: 140 }, { id: 'b-ne', x: 1166, y: 140 }, { id: 'b-sw', x: 980, y: 280 }, { id: 'b-se', x: 1166, y: 280 },
  { id: 'deng-s-in', x: 1473, y: 340 }, { id: 'deng-w-in', x: 1338, y: 200 }, { id: 'deng-e-in', x: 1598, y: 200 }, { id: 'p-eng-hub', x: 1473, y: 200 },
  { id: 'ddesign-s-in', x: 1835, y: 340 }, { id: 'ddesign-w-in', x: 1738, y: 200 }, { id: 'p-design-hub', x: 1835, y: 200 },
  // bottom
  { id: 'drev-n-in', x: 238, y: 540 }, { id: 'drev-e-in', x: 408, y: 750 }, { id: 'p-rev-hub', x: 238, y: 750 },
  { id: 'dlng-n-in', x: 673, y: 540 }, { id: 'dlng-w-in', x: 538, y: 750 }, { id: 'dlng-e-in', x: 808, y: 750 }, { id: 'p-lng-hub', x: 673, y: 750 },
  { id: 'dmkt-n-in', x: 1073, y: 540 }, { id: 'dmkt-w-in', x: 938, y: 750 }, { id: 'dmkt-e-in', x: 1208, y: 750 }, { id: 'p-mkt-hub', x: 1073, y: 750 },
  { id: 'dsales-n-in', x: 1473, y: 540 }, { id: 'dsales-w-in', x: 1338, y: 750 }, { id: 'dsales-e-in', x: 1598, y: 750 }, { id: 'p-sales-hub', x: 1473, y: 750 },
  { id: 'dana-n-in', x: 1835, y: 540 }, { id: 'dana-w-in', x: 1738, y: 750 }, { id: 'p-ana-hub', x: 1835, y: 750 },
  ...ROOM_SPOTS.map(s => ({ id: s.id, x: s.x, y: s.y })),
];

const NAV_EDGES: ReadonlyArray<readonly [string, string]> = [
  // main spine
  ['c-p-prod','c-v1'], ['c-v1','c-p-plan'], ['c-p-plan','c-v2'], ['c-v2','c-p-board'], ['c-p-board','c-v3'], ['c-v3','c-p-eng'], ['c-p-eng','c-v4'], ['c-v4','c-p-design'],
  // verticals
  ['v1-n','c-v1'], ['c-v1','v1-s'], ['v2-n','c-v2'], ['c-v2','v2-s'], ['v3-n','c-v3'], ['c-v3','v3-s'], ['v4-n','c-v4'], ['c-v4','v4-s'],
  // product
  ['c-p-prod','dp-s-in'], ['dp-s-in','p-prod-hub'], ['v1-n','dp-e-in'], ['dp-e-in','p-prod-hub'],
  ['p-prod-hub','prod-desk'], ['p-prod-hub','prod-board'], ['p-prod-hub','prod-showcase'], ['p-prod-hub','prod-collab'],
  // planning
  ['c-p-plan','dplan-s-in'], ['dplan-s-in','p-plan-hub'], ['v1-n','dplan-w-in'], ['dplan-w-in','p-plan-hub'], ['v2-n','dplan-e-in'], ['dplan-e-in','p-plan-hub'],
  ['p-plan-hub','plan-desk'], ['p-plan-hub','plan-desk2'], ['p-plan-hub','plan-board'], ['p-plan-hub','plan-collab'],
  // boardroom
  ['c-p-board','dboard-s-in'], ['v2-n','dboard-w-in'], ['v3-n','dboard-e-in'],
  ['dboard-s-in','b-sw'], ['dboard-s-in','b-se'], ['dboard-s-in','board-seat-4'], ['dboard-s-in','board-seat-5'], ['dboard-s-in','board-seat-6'],
  ['dboard-w-in','b-nw'], ['dboard-w-in','b-sw'], ['dboard-e-in','b-ne'], ['dboard-e-in','b-se'],
  ['b-sw','board-seat-4'], ['b-se','board-seat-6'], ['board-seat-4','board-seat-5'], ['board-seat-5','board-seat-6'],
  ['b-nw','board-seat-1'], ['board-seat-1','board-seat-2'], ['board-seat-2','board-seat-3'], ['board-seat-3','b-ne'],
  // engineering
  ['c-p-eng','deng-s-in'], ['deng-s-in','p-eng-hub'], ['v3-n','deng-w-in'], ['deng-w-in','p-eng-hub'], ['v4-n','deng-e-in'], ['deng-e-in','p-eng-hub'],
  ['p-eng-hub','eng-desk'], ['p-eng-hub','eng-desk2'], ['p-eng-hub','eng-board'], ['p-eng-hub','eng-collab'],
  // design
  ['c-p-design','ddesign-s-in'], ['ddesign-s-in','p-design-hub'], ['v4-n','ddesign-w-in'], ['ddesign-w-in','p-design-hub'],
  ['p-design-hub','design-desk'], ['p-design-hub','design-desk2'], ['p-design-hub','design-board'], ['p-design-hub','design-collab'],
  // qa
  ['c-p-prod','drev-n-in'], ['drev-n-in','p-rev-hub'], ['v1-s','drev-e-in'], ['drev-e-in','p-rev-hub'],
  ['p-rev-hub','rev-desk'], ['p-rev-hub','rev-desk2'], ['p-rev-hub','rev-board'], ['p-rev-hub','rev-collab'],
  // lounge
  ['c-p-plan','dlng-n-in'], ['dlng-n-in','p-lng-hub'], ['v1-s','dlng-w-in'], ['dlng-w-in','p-lng-hub'], ['v2-s','dlng-e-in'], ['dlng-e-in','p-lng-hub'],
  ['p-lng-hub','lng-coffee'], ['p-lng-hub','lng-sofa1'], ['p-lng-hub','lng-sofa2'], ['p-lng-hub','lng-reception'], ['p-lng-hub','lng-stage'],
  // marketing
  ['c-p-board','dmkt-n-in'], ['dmkt-n-in','p-mkt-hub'], ['v2-s','dmkt-w-in'], ['dmkt-w-in','p-mkt-hub'], ['v3-s','dmkt-e-in'], ['dmkt-e-in','p-mkt-hub'],
  ['p-mkt-hub','mkt-desk'], ['p-mkt-hub','mkt-desk2'], ['p-mkt-hub','mkt-board'], ['p-mkt-hub','mkt-collab'], ['p-mkt-hub','mkt-showcase'],
  // sales
  ['c-p-eng','dsales-n-in'], ['dsales-n-in','p-sales-hub'], ['v3-s','dsales-w-in'], ['dsales-w-in','p-sales-hub'], ['v4-s','dsales-e-in'], ['dsales-e-in','p-sales-hub'],
  ['p-sales-hub','sales-desk'], ['p-sales-hub','sales-desk2'], ['p-sales-hub','sales-board'], ['p-sales-hub','sales-collab'],
  // analytics
  ['c-p-design','dana-n-in'], ['dana-n-in','p-ana-hub'], ['v4-s','dana-w-in'], ['dana-w-in','p-ana-hub'],
  ['p-ana-hub','ana-desk'], ['p-ana-hub','ana-desk2'], ['p-ana-hub','ana-board'], ['p-ana-hub','ana-collab'],
];

const NODE_MAP = new Map<string, NavNode>(NAV_NODES.map(n => [n.id, n]));
const ADJACENCY = new Map<string, Array<{id:string;cost:number}>>();
for (const n of NAV_NODES) ADJACENCY.set(n.id, []);
for (const [a,b] of NAV_EDGES) {
  const na=NODE_MAP.get(a), nb=NODE_MAP.get(b);
  if (!na||!nb) continue;
  const cost=Math.hypot(na.x-nb.x, na.y-nb.y);
  ADJACENCY.get(a)?.push({id:b,cost}); ADJACENCY.get(b)?.push({id:a,cost});
}

export function locatePoint(p: Point2D): { areaId:string; nameAr:string; nameEn:string; isRoom:boolean; room:OfficeRoom|null } {
  for (const r of OFFICE_ROOMS) if (p.x>=r.x && p.x<=r.x+r.width && p.y>=r.y && p.y<=r.y+r.height) return { areaId:r.id, nameAr:r.nameAr, nameEn:r.nameEn, isRoom:true, room:r };
  for (const c of Object.values(CORRIDORS)) if (p.x>=c.x && p.x<=c.x+c.width && p.y>=c.y && p.y<=c.y+c.height) return { areaId:c.id, nameAr:c.nameAr, nameEn:c.nameEn, isRoom:false, room:null };
  return { areaId:'campus', nameAr:'ساحة المقر', nameEn:'HQ Campus', isRoom:false, room:null };
}
function findNearestNavNode(p: Point2D): NavNode {
  const loc=locatePoint(p);
  let bestSame: NavNode|null=null, bestSameDist=Infinity, bestAny=NAV_NODES[0]!, bestAnyDist=Infinity;
  for (const node of NAV_NODES) {
    const d=Math.hypot(node.x-p.x, node.y-p.y);
    if (d<bestAnyDist){bestAnyDist=d;bestAny=node;}
    const nLoc=locatePoint(node);
    const same=loc.isRoom ? nLoc.areaId===loc.areaId : !nLoc.isRoom;
    if (same && d<bestSameDist){bestSameDist=d;bestSame=node;}
  }
  return bestSame ?? bestAny;
}
export function computeOfficePath(start: Point2D, target: string|Point2D): Point2D[] {
  const startNode=findNearestNavNode(start);
  const goalNode=typeof target==='string' ? (NODE_MAP.get(target) ?? findNearestNavNode(start)) : findNearestNavNode(target);
  if (startNode.id===goalNode.id) {
    if (typeof target!=='string'){ const sL=locatePoint(start), tL=locatePoint(target); if (sL.areaId===tL.areaId && sL.areaId!=='campus') return [{x:target.x,y:target.y}]; }
    return [{x:goalNode.x,y:goalNode.y}];
  }
  const dist=new Map<string,number>(), prev=new Map<string,string>(), visited=new Set<string>();
  dist.set(startNode.id,0);
  while(true){
    let cur:string|null=null, best=Infinity;
    for(const [id,d] of dist) if(!visited.has(id) && d<best){best=d;cur=id;}
    if(!cur || cur===goalNode.id) break;
    visited.add(cur);
    for(const e of ADJACENCY.get(cur) ?? []) if(!visited.has(e.id)){
      const cand=best+e.cost;
      if(cand<(dist.get(e.id)??Infinity)){dist.set(e.id,cand);prev.set(e.id,cur);}
    }
  }
  const chain: Point2D[]=[]; let cursor:string|undefined=goalNode.id;
  while(cursor){ const n=NODE_MAP.get(cursor); if(n) chain.push({x:n.x,y:n.y}); cursor=prev.get(cursor); }
  chain.reverse();
  if(chain.length>1 && Math.hypot(chain[0]!.x-start.x, chain[0]!.y-start.y)<12) chain.shift();
  if(typeof target!=='string'){ const tL=locatePoint(target); if(!tL.isRoom && tL.areaId!=='campus') chain.push({x:target.x,y:target.y}); }
  return chain;
}

/* ─── Brand visuals ────────────────────────────────────────── */
export interface ProviderVisual { shortLabel:string; fullLabel:string; color:string; bgLight:string; bgDark:string; border:string; }
export const PROVIDER_VISUALS: Record<string, ProviderVisual> = {
  [BrainProvider.Google]:    { shortLabel:'Gemini',  fullLabel:'Google Gemini', color:'#2563eb', bgLight:'rgba(37,99,235,0.10)', bgDark:'rgba(59,130,246,0.18)', border:'rgba(37,99,235,0.30)' },
  [BrainProvider.Anthropic]: { shortLabel:'Claude',  fullLabel:'Anthropic Claude', color:'#c2410c', bgLight:'rgba(194,65,12,0.10)', bgDark:'rgba(251,146,60,0.18)', border:'rgba(194,65,12,0.30)' },
  [BrainProvider.OpenAI]:    { shortLabel:'OpenAI',  fullLabel:'OpenAI GPT', color:'#059669', bgLight:'rgba(5,150,105,0.10)', bgDark:'rgba(16,185,129,0.18)', border:'rgba(5,150,105,0.30)' },
  [BrainProvider.Groq]:      { shortLabel:'Groq',    fullLabel:'Groq LPU', color:'#7c3aed', bgLight:'rgba(124,58,237,0.10)', bgDark:'rgba(167,139,250,0.18)', border:'rgba(124,58,237,0.30)' },
  ['mistral']:    { shortLabel:'Mistral', fullLabel:'Mistral AI', color:'#0ea5e9', bgLight:'rgba(14,165,233,0.10)', bgDark:'rgba(14,165,233,0.18)', border:'rgba(14,165,233,0.30)' },
  ['cohere']:     { shortLabel:'Cohere',  fullLabel:'Cohere', color:'#9333ea', bgLight:'rgba(147,51,234,0.10)', bgDark:'rgba(147,51,234,0.18)', border:'rgba(147,51,234,0.30)' },
  ['deepseek']:   { shortLabel:'DeepSeek',fullLabel:'DeepSeek', color:'#1e40af', bgLight:'rgba(30,64,175,0.10)', bgDark:'rgba(30,64,175,0.18)', border:'rgba(30,64,175,0.30)' },
  ['qwen']:       { shortLabel:'Qwen',    fullLabel:'Alibaba Qwen', color:'#dc2626', bgLight:'rgba(220,38,38,0.08)', bgDark:'rgba(220,38,38,0.16)', border:'rgba(220,38,38,0.28)' },
  ['xai']:        { shortLabel:'Grok',    fullLabel:'xAI Grok', color:'#111827', bgLight:'rgba(17,24,39,0.06)', bgDark:'rgba(17,24,39,0.14)', border:'rgba(17,24,39,0.22)' },
  ['perplexity']: { shortLabel:'Pplx',    fullLabel:'Perplexity', color:'#0891b2', bgLight:'rgba(8,145,178,0.10)', bgDark:'rgba(8,145,178,0.18)', border:'rgba(8,145,178,0.30)' },
};
export function formatShortModel(model: string): string { return model.includes('/') ? (model.split('/').pop() ?? model) : model; }

/* ─── Role labels ─────────────────────────────────────────── */
export const AGENT_ROLE_AR: Record<string,string> = {
  'agent-planner-01':'مديرة التخطيط','agent-coder-01':'كبير المهندسين','agent-reviewer-01':'مسؤول الجودة والأمان','agent-analyst-01':'محللة البيانات',
  'agent-product-01':'مدير المنتج والابتكار','agent-design-01':'مصمم تجربة المستخدم','agent-marketing-01':'مدير التسويق والنمو','agent-sales-01':'مدير المبيعات',
  'agent-finance-01':'محلل مالي وعمليات',
};
export function getAgentHomeSpot(agent: AgentParticipant, _idx=0): RoomSpot {
  const roomId=agent.zoneId && ROOM_BY_ID[agent.zoneId] ? agent.zoneId : 'zone-planning';
  const primary=ROOM_SPOTS.find(s=>s.roomId===roomId && s.role==='desk');
  const alt=ROOM_SPOTS.find(s=>s.roomId===roomId && s.role==='desk-alt');
  const isCore=['agent-planner-01','agent-coder-01','agent-reviewer-01','agent-analyst-01'].includes(agent.id);
  if(!isCore && alt) return alt;
  if(primary) return primary;
  const fallback=ROOM_SPOTS.find(s=>s.roomId===roomId);
  return fallback ?? ROOM_SPOTS[0]!;
}

/* ─── Default Zones & Agents (10 departments) ──────────────── */
const BOOT_ISO='2026-01-01T09:00:00.000Z';
export const DEFAULT_COMPANY_ZONES: WorkspaceZone[] = OFFICE_ROOMS.map(r=>({
  id:r.id, name:r.nameEn, themeColor:r.accent, position:{x:r.x,z:r.y}, radius:4, assignedAgentIds:[], maxCapacity:8, description:r.subtitleAr, createdAt:BOOT_ISO, createdBy:'system',
}));

export const DEFAULT_COMPANY_AGENTS: AgentParticipant[] = [
  // Planning
  { id:'agent-planner-01', displayName:'Aria', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-planning', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'gemini-2.5-flash', activeTasks:1, brainConfig:{provider:BrainProvider.Google,model:'gemini-2.5-flash',maxTokens:2048,temperature:0.6}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مديرة التخطيط والاستراتيجية', tone:'Analytical', avatarColor:'#4f46e5', tagline:'تحويل الأهداف لخطط تنفيذية', specialty:'خارطة الطريق، السبرنتات', skills:['Roadmap','Sprint','Risk']} },
  // Product
  { id:'agent-product-01', displayName:'Lina', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-product', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'claude-opus-4-5', activeTasks:1, brainConfig:{provider:BrainProvider.Anthropic,model:'claude-opus-4-5',maxTokens:4096,temperature:0.7}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مديرة المنتج والابتكار', tone:'Creative', avatarColor:'#f59e0b', tagline:'اكتشاف الفرص وتحويلها لمنتجات تحبها السوق', specialty:'PRD، اكتشاف العملاء، النماذج', skills:['PRD','Discovery','Prototype']} },
  // Engineering
  { id:'agent-coder-01', displayName:'Atlas', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-engineering', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'claude-sonnet-4-5', activeTasks:2, brainConfig:{provider:BrainProvider.Anthropic,model:'claude-sonnet-4-5',maxTokens:4096,temperature:0.4}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'كبير مهندسي البرمجيات', tone:'Concise', avatarColor:'#0284c7', tagline:'كود إنتاجي نظيف وموثوق', specialty:'TS/React/Node/Redis', skills:['TypeScript','React','Node']} },
  { id:'agent-eng-02', displayName:'Kian', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-engineering', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'deepseek-coder', activeTasks:1, brainConfig:{provider:'deepseek' as unknown as BrainProvider,model:'deepseek-coder',maxTokens:4096,temperature:0.3}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مهندس الخوارزميات', tone:'Analytical', avatarColor:'#1e40af', tagline:'تحسين الأداء والخوارزميات', specialty:'Algorithms, AI/ML, Performance', skills:['Python','ML','Perf']} },
  // Design
  { id:'agent-design-01', displayName:'Maya', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-design', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'gpt-4o', activeTasks:1, brainConfig:{provider:BrainProvider.OpenAI,model:'gpt-4o',maxTokens:2048,temperature:0.8}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مصممة تجربة المستخدم', tone:'Creative', avatarColor:'#ec4899', tagline:'تصميم يجعل المنتج محبوباً', specialty:'UX Research, UI, Design System', skills:['Figma','UX','UI']} },
  // QA
  { id:'agent-reviewer-01', displayName:'Sentinel', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-review', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'gpt-4.1', activeTasks:1, brainConfig:{provider:BrainProvider.OpenAI,model:'gpt-4.1',maxTokens:2048,temperature:0.3}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مسؤول الجودة والأمان', tone:'Formal', avatarColor:'#d97706', tagline:'لا شيء يمر دون تدقيق', specialty:'OWASP, QA, PenTest', skills:['Security','QA','Audit']} },
  // Marketing
  { id:'agent-marketing-01', displayName:'Zayn', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-marketing', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'gpt-4o', activeTasks:2, brainConfig:{provider:BrainProvider.OpenAI,model:'gpt-4o',maxTokens:3000,temperature:0.9}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مدير التسويق والنمو', tone:'Creative', avatarColor:'#0891b2', tagline:'نمو مركب عبر محتوى يبيع', specialty:'Content, SEO, Ads, Social', skills:['SEO','Content','Ads']} },
  { id:'agent-marketing-02', displayName:'Sora', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-marketing', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'sonar-pro', activeTasks:1, brainConfig:{provider:'perplexity' as unknown as BrainProvider,model:'sonar-pro',maxTokens:2048,temperature:0.6}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'باحثة السوق والمحتوى', tone:'Analytical', avatarColor:'#0d9488', tagline:'محتوى مبني على بحث حي من الويب', specialty:'Research, Trends, Copy', skills:['Research','Trends','Copy']} },
  // Sales
  { id:'agent-sales-01', displayName:'Omar', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-sales', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'claude-haiku-4-5', activeTasks:1, brainConfig:{provider:BrainProvider.Anthropic,model:'claude-haiku-4-5',maxTokens:2048,temperature:0.5}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مدير المبيعات والدعم', tone:'Casual', avatarColor:'#7c3aed', tagline:'نحوّل الاهتمام لعملاء سعداء', specialty:'Closing, Support, CRM', skills:['Sales','CRM','Support']} },
  // Analytics
  { id:'agent-analyst-01', displayName:'Nova', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-analytics', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'llama-3.3-70b-versatile', activeTasks:1, brainConfig:{provider:BrainProvider.Groq,model:'llama-3.3-70b-versatile',maxTokens:2048,temperature:0.5}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'محللة البيانات والنمو', tone:'Analytical', avatarColor:'#059669', tagline:'أرقام تحكي وقرارات تنمو', specialty:'SLO, LTV, CAC, Churn', skills:['Analytics','Growth','Finance']} },
  { id:'agent-finance-01', displayName:'Rami', isHuman:false, isAgent:true, origin:AgentOrigin.Internal, zoneId:'zone-analytics', lifecycleState:AgentLifecycleState.Idle, socketId:null, assignedRoomIds:[], modelId:'gpt-4.1', activeTasks:1, brainConfig:{provider:BrainProvider.OpenAI,model:'gpt-4.1',maxTokens:2048,temperature:0.3}, avatarState:AvatarAnimState.Idle, locale:'ar', createdAt:BOOT_ISO, lastSeenAt:BOOT_ISO, status:ParticipantStatus.Online, activeRoomIds:[], profile:{customRole:'مدير المالية والعمليات', tone:'Formal', avatarColor:'#475569', tagline:'كل جنيه محسوب ونمو مستدام', specialty:'Budget, Ops, Unit Economics', skills:['Finance','Ops','Legal']} },
];

export function buildDefaultWorkspaces(roomId: string): Record<string, SharedWorkspaceState> {
  const mk=(id:string,zoneId:string,type:SharedWorkspaceEntry['type'],status:SharedWorkspaceEntry['status'],authorAgentId:string,title:string,payload:Record<string,unknown>): SharedWorkspaceEntry=>({id,zoneId,roomId,type,status,authorAgentId,title,payload,createdAt:BOOT_ISO,updatedAt:BOOT_ISO,chainIds:[]});
  return {
    'zone-product':     { zoneId:'zone-product',     roomId, entries:[ mk('init-prod-1','zone-product','task','in_progress','agent-product-01','صياغة PRD: متجر إلكتروني ذكي للمنتجات الحرفية',{stage:'discovery'}), mk('init-prod-2','zone-product','artifact','open','agent-product-01','لوحة أفكار: 12 فكرة منتج جديدة',{votes:34}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-product-01' },
    'zone-planning':    { zoneId:'zone-planning',    roomId, entries:[ mk('init-p1','zone-planning','task','in_progress','agent-planner-01','خطة إطلاق Q1-2027: من الفكرة للإيراد',{sprint:'Sprint 1'}), mk('init-p2','zone-planning','handoff','approved','agent-planner-01','تسليم خارطة الطريق للهندسة',{to:'Atlas'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-planner-01' },
    'zone-boardroom':   { zoneId:'zone-boardroom',   roomId, entries:[ mk('init-b1','zone-boardroom','signal','open','agent-planner-01','اجتماع الإطلاق: كل الأقسام مدعوة',{time:'10:00'} ) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-planner-01' },
    'zone-engineering': { zoneId:'zone-engineering', roomId, entries:[ mk('init-e1','zone-engineering','artifact','approved','agent-coder-01','إعداد monorepo + CI/CD + Redis',{stack:'Next+Node'}), mk('init-e2','zone-engineering','task','in_progress','agent-eng-02','بناء محرك التوصيات بالذكاء الاصطناعي',{model:'deepseek-coder'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-coder-01' },
    'zone-design':      { zoneId:'zone-design',      roomId, entries:[ mk('init-d1','zone-design','artifact','open','agent-design-01','تصميم هوية بصرية + UI Kit',{tool:'Figma'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-design-01' },
    'zone-review':      { zoneId:'zone-review',      roomId, entries:[ mk('init-r1','zone-review','review','approved','agent-reviewer-01','تدقيق أمان + اختبارات E2E',{severity:'0 حرجة'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-reviewer-01' },
    'zone-marketing':   { zoneId:'zone-marketing',   roomId, entries:[ mk('init-m1','zone-marketing','signal','open','agent-marketing-01','حملة إطلاق: 7 محتويات + 3 إعلانات',{budget:'$2k'}), mk('init-m2','zone-marketing','task','in_progress','agent-marketing-02','بحث كلمات مفتاحية: 40 كلمة',{volume:'120K'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-marketing-01' },
    'zone-sales':       { zoneId:'zone-sales',       roomId, entries:[ mk('init-s1','zone-sales','signal','open','agent-sales-01','إعداد CRM + نصوص البيع',{crm:'HubSpot'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-sales-01' },
    'zone-analytics':   { zoneId:'zone-analytics',   roomId, entries:[ mk('init-a1','zone-analytics','signal','open','agent-analyst-01','لوحة تحليلات: CAC/LTV/Churn',{p95:175}), mk('init-a2','zone-analytics','task','open','agent-finance-01','نموذج تسعير وتوقعات 12 شهر',{mrr:'$50k'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-analyst-01' },
    'zone-lounge':      { zoneId:'zone-lounge',      roomId, entries:[ mk('init-l1','zone-lounge','signal','open','agent-planner-01','فعالية ثقافية: عرض المنتج الأول',{time:'الخميس 4PM'}) ], lastWriteAt:BOOT_ISO, lastWrittenBy:'agent-planner-01' },
  };
}
