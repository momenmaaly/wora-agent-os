import { AudioLines, Building2, Cpu, CreditCard, FolderKanban, LayoutGrid, Plug2, Sparkles } from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutGrid, group: 'workspace' },
  { id: 'campus', label: 'المقر التفاعلي', icon: Building2, group: 'workspace' },
  { id: 'projects', label: 'المشاريع', icon: FolderKanban, group: 'workspace' },
  { id: 'studio', label: 'استوديو المنتج', icon: Sparkles, group: 'workspace' },
  { id: 'models', label: 'النماذج', icon: Cpu, group: 'management' },
  { id: 'integrations', label: 'التكاملات', icon: Plug2, group: 'management' },
  { id: 'pricing', label: 'الخطط', icon: CreditCard, group: 'management' },
] as const;

export type PageId = (typeof NAV_ITEMS)[number]['id'];

export const WORKSPACE_ICON = AudioLines;

export function currentPage(): PageId {
  return NAV_ITEMS.find((item) => `#${item.id}` === window.location.hash)?.id ?? 'overview';
}
