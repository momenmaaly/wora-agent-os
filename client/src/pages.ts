import { AudioLines, Building2, Cpu, CreditCard, DoorOpen, FolderKanban, Plug2, Sparkles } from 'lucide-react';
import { ROOM_BY_ID } from './office/layout.js';
import { TOUR_STOPS } from './office/visits.js';

export const NAV_ITEMS = [
  { id: 'overview', label: 'الاستقبال', icon: DoorOpen, group: 'workspace' },
  { id: 'campus', label: 'المقر التفاعلي', icon: Building2, group: 'workspace' },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban, group: 'workspace' },
  { id: 'studio', label: 'استوديو المنتج', icon: Sparkles, group: 'workspace' },
  { id: 'models', label: 'النماذج', icon: Cpu, group: 'management' },
  { id: 'integrations', label: 'التكاملات', icon: Plug2, group: 'management' },
  { id: 'pricing', label: 'الخطط', icon: CreditCard, group: 'management' },
] as const;

export type PageId = (typeof NAV_ITEMS)[number]['id'];

export const WORKSPACE_ICON = AudioLines;

export function workspaceRoute(hash: string) {
  const [name, section, stop, ...extra] = hash.slice(1).split('/');
  const page: PageId = NAV_ITEMS.find((item) => item.id === name)?.id ?? 'overview';
  if (page !== 'campus') return { page, roomId: null, tourIndex: null };
  if (section === 'tour' && !extra.length) {
    const tourIndex = TOUR_STOPS.findIndex((id) => id === (stop ?? TOUR_STOPS[0]));
    if (tourIndex !== -1) return { page, roomId: TOUR_STOPS[tourIndex]!, tourIndex };
  }
  return { page, roomId: !stop && section && Object.hasOwn(ROOM_BY_ID, section) ? section : null, tourIndex: null };
}

export function officeHash(roomId?: string | null, tour = false) {
  return `#campus${tour ? '/tour' : ''}${roomId ? `/${roomId}` : ''}`;
}
