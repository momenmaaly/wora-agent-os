import { BriefcaseBusiness, Cpu, CreditCard, FolderKanban, Workflow, Plug2, Settings, Sparkles } from 'lucide-react';
import { CHANNEL_BY_ID, TOUR_STOPS } from './office/channels.js';
import { DIRECTOR_ROOM_ID } from './office/work.js';

export const NAV_ITEMS = [
  { id: 'campus', label: 'شبكة القيادة', icon: Workflow },
  { id: 'director', label: 'لوحة المدير', icon: BriefcaseBusiness },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban },
  { id: 'studio', label: 'استوديو المنتج', icon: Sparkles },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
] as const;

export const SETTINGS_ITEMS = [
  { id: 'models', label: 'النماذج', icon: Cpu },
  { id: 'integrations', label: 'التكاملات', icon: Plug2 },
  { id: 'pricing', label: 'الخطة', icon: CreditCard },
] as const;

export const PAGES = [...NAV_ITEMS, ...SETTINGS_ITEMS] as const;
export type PageId = (typeof PAGES)[number]['id'];
export type SettingsPage = (typeof SETTINGS_ITEMS)[number]['id'];
export function isSettingsPage(page: PageId): page is SettingsPage { return SETTINGS_ITEMS.some((item) => item.id === page); }

export function workspaceRoute(hash: string): { page: PageId; roomId: string | null; tourIndex: number | null } {
  const [name, section, stop, ...extra] = hash.slice(1).split('/');
  const page = PAGES.find((item) => item.id === name)?.id ?? 'campus';
  if (page === 'director') return { page, roomId: DIRECTOR_ROOM_ID, tourIndex: null };
  if (page !== 'campus') return { page, roomId: null, tourIndex: null };
  if (section === 'tour' && !extra.length) {
    const tourIndex = TOUR_STOPS.findIndex((id) => id === (stop ?? TOUR_STOPS[0]));
    if (tourIndex !== -1) return { page, roomId: TOUR_STOPS[tourIndex]!, tourIndex };
  }
  const roomId = !stop && section && Object.hasOwn(CHANNEL_BY_ID, section) ? section : null;
  return { page: roomId === DIRECTOR_ROOM_ID ? 'director' : page, roomId, tourIndex: null };
}

export function commandHash(roomId?: string | null, tour = false) {
  if (!tour && roomId === DIRECTOR_ROOM_ID) return '#director';
  return `#campus${tour ? '/tour' : ''}${roomId ? `/${roomId}` : ''}`;
}
