import { Bot, BrainCircuit, Building2, Boxes, CreditCard, FolderKanban, Home, Plug2, Puzzle, ServerCog, Settings, Cpu, Workflow, Sparkles, LayoutGrid, BriefcaseBusiness } from 'lucide-react';
import { ROOM_BY_ID } from './office/layout.js';
import { TOUR_STOPS } from './office/visits.js';
import { DIRECTOR_ROOM_ID } from './office/work.js';

/**
 * WORA — final navigation (2026-11-23 product reset).
 * Three entry paths, one product. Primary areas are task-first, not workspace-first.
 * Labels live in the i18n dictionaries (`nav.<id>`); no hardcoded strings here.
 */
export const NAV_ITEMS = [
  { id: 'home', icon: Home },
  { id: 'execution', icon: Workflow },
  { id: 'agents', icon: Bot },
  { id: 'projects', icon: FolderKanban },
  { id: 'organizations', icon: Building2 },
  { id: 'intelligence', icon: BrainCircuit },
  { id: 'extensions', icon: Puzzle },
  { id: 'workspaces', icon: Boxes },
  { id: 'system', icon: ServerCog },
] as const;

export const SETTINGS_ITEMS = [
  { id: 'settings', icon: Settings },
  { id: 'models', icon: Cpu },
  { id: 'integrations', icon: Plug2 },
  { id: 'pricing', icon: CreditCard },
] as const;

/** Kept reachable (hash-routable, documented in the audit) but deliberately outside primary nav. */
export const LEGACY_ITEMS = [
  { id: 'campus', icon: LayoutGrid },
  { id: 'director', icon: BriefcaseBusiness },
  { id: 'studio', icon: Sparkles },
] as const;

export const PAGES = [...NAV_ITEMS, ...SETTINGS_ITEMS, ...LEGACY_ITEMS] as const;
export type PageId = (typeof PAGES)[number]['id'];
export type SettingsPage = (typeof SETTINGS_ITEMS)[number]['id'];
export function isSettingsPage(page: PageId): page is SettingsPage { return SETTINGS_ITEMS.some((item) => item.id === page); }

export function workspaceRoute(hash: string): { page: PageId; roomId: string | null; tourIndex: number | null } {
  const [name, section, stop, ...extra] = hash.slice(1).split('/');
  const page = PAGES.find((item) => item.id === name)?.id ?? 'home';
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
