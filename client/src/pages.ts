import {
  Activity, Bot, BookOpen, Boxes, BrainCircuit, Building2, CreditCard, Cpu, FolderKanban, GitBranch, History,
  LayoutDashboard, Package, Plug2, Puzzle, ServerCog, Settings, Shield, ShieldCheck, Terminal, Workflow, PenLine,
} from 'lucide-react';
import { ROOM_BY_ID } from './office/layout.js';
import { TOUR_STOPS } from './office/visits.js';
import { DIRECTOR_ROOM_ID } from './office/work.js';

/**
 * WORA — technical workspace navigation.
 * Primary areas are grouped by intent; labels live in `nav.<id>`.
 */
export const NAV_GROUPS = [
  {
    id: 'operate',
    label: 'nav.groupOperate',
    items: [
      { id: 'brief', icon: PenLine },
      { id: 'run', icon: Workflow },
      { id: 'library', icon: BookOpen },
      { id: 'capabilities', icon: Puzzle },
      { id: 'system', icon: ServerCog },
    ],
  },
] as const;

type NavGroupItem = (typeof NAV_GROUPS)[number]['items'][number];
export const NAV_ITEMS = NAV_GROUPS.reduce<NavGroupItem[]>((items, group) => [...items, ...group.items], []);

export const SETTINGS_ITEMS = [
  { id: 'settings', icon: Settings },
  { id: 'security', icon: Shield },
  { id: 'models', icon: Cpu },
  { id: 'pricing', icon: CreditCard },
] as const;

/** Hash-routable areas kept outside the primary navigation. */
export const LEGACY_ITEMS = [
  { id: 'home', icon: LayoutDashboard },
  { id: 'execution', icon: Workflow },
  { id: 'agents', icon: Bot },
  { id: 'workflows', icon: GitBranch },
  { id: 'projects', icon: FolderKanban },
  { id: 'terminal', icon: Terminal },
  { id: 'artifacts', icon: Package },
  { id: 'integrations', icon: Plug2 },
  { id: 'extensions', icon: Puzzle },
  { id: 'knowledge', icon: BookOpen },
  { id: 'approvals', icon: ShieldCheck },
  { id: 'activity', icon: Activity },
  { id: 'history', icon: History },
  { id: 'organizations', icon: Building2 },
  { id: 'intelligence', icon: BrainCircuit },
  { id: 'workspaces', icon: Boxes },
  { id: 'campus', icon: LayoutDashboard },
  { id: 'director', icon: Workflow },
  { id: 'studio', icon: Package },
] as const;

export const PAGES = [...NAV_ITEMS, ...SETTINGS_ITEMS, ...LEGACY_ITEMS] as const;
export type PageId = (typeof PAGES)[number]['id'];
export type SettingsPage = (typeof SETTINGS_ITEMS)[number]['id'];
export function isSettingsPage(page: PageId): page is SettingsPage { return SETTINGS_ITEMS.some((item) => item.id === page); }

export function workspaceRoute(hash: string): { page: PageId; roomId: string | null; tourIndex: number | null } {
  const [name, section, stop, ...extra] = hash.slice(1).split('/');
  const page = PAGES.find((item) => item.id === name)?.id ?? 'brief';
  if (page === 'director') return { page, roomId: DIRECTOR_ROOM_ID, tourIndex: null };
  if (page !== 'campus') return { page, roomId: null, tourIndex: null };
  if (section === 'tour' && !extra.length) {
    const tourIndex = TOUR_STOPS.findIndex((id) => id === (stop ?? TOUR_STOPS[0]));
    if (tourIndex !== -1) return { page, roomId: TOUR_STOPS[tourIndex]!, tourIndex };
  }
  const roomId = !stop && section && Object.hasOwn(ROOM_BY_ID, section) ? section : null;
  return { page: roomId === DIRECTOR_ROOM_ID ? 'director' : page, roomId, tourIndex: null };
}

export function officeHash(roomId?: string | null, tour = false) {
  if (!tour && roomId === DIRECTOR_ROOM_ID) return '#director';
  return `#campus${tour ? '/tour' : ''}${roomId ? `/${roomId}` : ''}`;
}
