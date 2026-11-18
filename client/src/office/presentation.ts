import { BarChart3, Code2, Network, Layers3, Lightbulb, Megaphone, PenTool, ShieldCheck, ShoppingBag, UsersRound, type LucideIcon } from 'lucide-react';
import type { AgentParticipant } from '../types.js';

export const ROOM_DISPLAY: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  'zone-product': { label: 'المنتج', icon: Lightbulb, tone: 'gold' },
  'zone-planning': { label: 'التخطيط', icon: Layers3, tone: 'violet' },
  'zone-boardroom': { label: 'المدير', icon: UsersRound, tone: 'violet' },
  'zone-engineering': { label: 'الهندسة', icon: Code2, tone: 'cyan' },
  'zone-design': { label: 'التصميم', icon: PenTool, tone: 'pink' },
  'zone-review': { label: 'الجودة', icon: ShieldCheck, tone: 'gold' },
  'zone-lounge': { label: 'التنسيق', icon: Network, tone: 'mint' },
  'zone-marketing': { label: 'التسويق', icon: Megaphone, tone: 'cyan' },
  'zone-sales': { label: 'المبيعات', icon: ShoppingBag, tone: 'pink' },
  'zone-analytics': { label: 'البيانات', icon: BarChart3, tone: 'mint' },
};

const coreIds = ['agent-planner-01', 'agent-coder-01', 'agent-reviewer-01', 'agent-analyst-01'];

export function orderedAgents(agents: Record<string, AgentParticipant>) {
  const order = (id: string) => coreIds.includes(id) ? coreIds.indexOf(id) : coreIds.length;
  return Object.values(agents).sort((a, b) => order(a.id) - order(b.id) || a.displayName.localeCompare(b.displayName));
}
