import { Bot, ChevronLeft, Cpu, Eye, MessageCircle, Plus, UsersRound } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { agentInitials, orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { canTakeTask, isBusyAgent, taskCountByAgent } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';
import type { AgentParticipant, SharedWorkspaceEntry } from '../types.js';
import { IconButton } from './ui.js';

export function ConnectionBadge() {
  const connected = useWoraStore((s) => s.connected);
  const demo = useWoraStore((s) => s.demoMode);
  const mode = useWoraStore((s) => s.serverMode);
  const label = connected ? mode === 'preview' ? 'خادم المعاينة' : 'متصل بالمقر' : mode ? 'غير متصل' : demo ? 'معاينة محلية' : 'جارٍ الاتصال';
  return <span className={`connection-badge${connected ? ' is-ready' : ''}`} role="status"><span className="status-dot" />{label}</span>;
}

export function AgentAvatar({ agent, className = '' }: { agent: AgentParticipant; className?: string }) {
  return <span aria-hidden="true" className={`agent-avatar ${className}`} style={{ '--agent-color': agent.profile.avatarColor } as CSSProperties}><bdi>{agentInitials(agent)}</bdi></span>;
}

export function OfficePeople({ zoneId, tasks, onChat }: { zoneId: string | null; tasks: SharedWorkspaceEntry[]; onChat: () => void }) {
  const agents = useWoraStore((s) => s.agents);
  const selectedId = useWoraStore((s) => s.selectedAgentId);
  const followId = useWoraStore((s) => s.followAgentId);
  const locations = useWoraStore((s) => s.agentLocations);
  const { selectAgent, setFollowAgent, focusAgentCamera, openModelSwap, setShowHireModal } = useWoraStore.getState();
  const counts = useMemo(() => taskCountByAgent(tasks), [tasks]);
  const list = useMemo(() => orderedAgents(agents), [agents]);
  const shown = zoneId ? list.filter((agent) => agent.zoneId === zoneId || locations[agent.id]?.areaId === zoneId) : list;
  const selected = selectedId ? shown.find((agent) => agent.id === selectedId) : undefined;
  const location = selected && locations[selected.id];
  const here = zoneId && ROOM_DISPLAY[zoneId]?.label;

  return <section className="panel workspace-people" aria-labelledby="workspace-team-title">
    <div className="workspace-panel-heading"><div><UsersRound size={17} aria-hidden="true" /><h2 id="workspace-team-title">{here ? `فريق ${here}` : 'الفريق'}</h2><bdi>{shown.length}</bdi></div><IconButton icon={Plus} label="وكيل جديد" onClick={() => setShowHireModal(true)} /></div>
    <div className="workspace-people-list hq-scroll">
      {!shown.length && <p className="workspace-empty"><Bot size={17} aria-hidden="true" />{here ? 'لا يوجد وكلاء في هذا القسم.' : 'الفريق فارغ.'}</p>}
      {shown.length > 0 && <ul>{shown.map((agent) => {
        const walking = locations[agent.id]?.isWalking;
        const busy = isBusyAgent(agent);
        const available = canTakeTask(agent);
        const label = walking ? 'يتنقّل' : !available ? 'غير متاح' : busy ? 'يعمل' : 'متاح';
        return <li key={agent.id}><button type="button" className="workspace-person" aria-pressed={selectedId === agent.id} onClick={() => selectedId === agent.id ? selectAgent(null) : focusAgentCamera(agent.id)}>
          <AgentAvatar agent={agent} /><span className="workspace-person-name"><bdi>{agent.displayName}</bdi><small>{agent.profile.customRole}{agent.id.startsWith('agent-custom-') ? ' · محلي' : ''}</small></span>
          <span className={`workspace-presence${busy || walking ? ' is-busy' : available ? ' is-available' : ''}`}><i aria-hidden="true" />{label}</span>
        </button></li>;
      })}</ul>}
    </div>
    {selected && <div className="workspace-person-detail">
      <div><bdi>{selected.displayName}</bdi><span>{location?.statusTextAr ?? 'في المقر'} · <bdi>{counts.get(selected.id) ?? 0}</bdi> مهمة مفتوحة</span></div>
      <div className="workspace-person-actions">
        <button type="button" className="button small" onClick={onChat}><MessageCircle size={15} aria-hidden="true" />محادثة</button>
        <IconButton icon={Eye} label={followId === selected.id ? 'إيقاف المتابعة' : 'متابعة الوكيل'} aria-pressed={followId === selected.id} onClick={() => setFollowAgent(followId === selected.id ? null : selected.id)} />
        <IconButton icon={Cpu} label="تبديل النموذج" onClick={() => openModelSwap(selected.id)} />
      </div>
    </div>}
    {!selected && <button type="button" className="workspace-team-chat" onClick={onChat}><MessageCircle size={16} aria-hidden="true" />محادثة الفريق<ChevronLeft size={15} aria-hidden="true" /></button>}
  </section>;
}
