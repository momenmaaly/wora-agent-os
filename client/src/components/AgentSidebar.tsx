import { Cpu, Github, MessageCircle, Plus } from 'lucide-react';
import { CHANNEL_BY_ID } from '../office/channels.js';
import { useWoraStore } from '../store/useWoraStore.js';
import type { AgentParticipant } from '../types.js';
import { AgentAvatar, AgentSignal } from './AgentAvatar.js';
import { CommandGlyph } from './CommandGlyph.js';
import { IconButton } from './ui.js';

export function ConnectionBadge() {
  const connected = useWoraStore((s) => s.connected);
  const demo = useWoraStore((s) => s.demoMode);
  const mode = useWoraStore((s) => s.serverMode);
  const label = connected ? mode === 'preview' ? 'خادم المعاينة' : 'متصل بالخادم' : mode ? 'غير متصل' : demo ? 'معاينة محلية' : 'جارٍ الاتصال';
  return <span className={`connection-badge${connected ? ' is-ready' : ''}`} role="status"><span className="status-dot" />{label}</span>;
}

export function AgentSidebar({ agents, selected, openTasks }: { agents: readonly AgentParticipant[]; selected?: AgentParticipant; openTasks: number }) {
  const { selectAgent, toggleChat, openModelSwap, openAgentSkills, setShowHireModal } = useWoraStore.getState();
  const active = selected?.skillSnapshot?.activeNames.length ?? 0;
  const local = selected?.id.startsWith('agent-custom-');
  return <aside className="hud-panel agent-sidebar" aria-labelledby="team-hud-title">
    <header className="hud-header">
      <div className="hud-heading"><span className="hud-icon"><CommandGlyph kind="agents" size={19} /></span><div><span className="hud-label" dir="ltr">02 / AGENT ROSTER</span><h2 id="team-hud-title" tabIndex={-1}>الوكلاء</h2></div></div>
      <IconButton icon={Plus} label="وكيل جديد" onClick={() => setShowHireModal(true)} aria-haspopup="dialog" />
    </header>
    <div className="agent-list hq-scroll" tabIndex={agents.length > 4 ? 0 : undefined} role={agents.length > 4 ? 'region' : undefined} aria-label={agents.length > 4 ? 'قائمة الوكلاء' : undefined}>
      {agents.length ? <ul>{agents.map((agent) => <li key={agent.id}>
        <button type="button" className="agent-row" aria-pressed={selected?.id === agent.id} data-agent-id={agent.id} onClick={() => selectAgent(agent.id)}>
          <AgentAvatar agent={agent} />
          <span className="agent-row-name"><bdi>{agent.displayName}</bdi><small dir="auto">{agent.profile.customRole}</small></span>
          <AgentSignal agent={agent} />
        </button>
      </li>)}</ul> : <p className="hud-empty">لا يوجد وكلاء في هذه القناة.</p>}
    </div>
    {selected && <div className="agent-inspector" aria-label={`إدارة ${selected.displayName}`}>
      <div className="agent-inspector-title"><span className="hud-label" dir="ltr">INSPECT /</span><strong><bdi>{selected.displayName}</bdi></strong><span>{local ? 'جلسة محلية' : CHANNEL_BY_ID[selected.zoneId ?? '']?.nameAr ?? 'الفريق'}</span></div>
      <div className="agent-info">
        <div className="agent-model-line"><Cpu size={14} aria-hidden="true" /><bdi title={selected.modelId}>{selected.modelId}</bdi><span><bdi>{openTasks}</bdi> مهام</span></div>
        <IconButton icon={MessageCircle} label={`محادثة ${selected.displayName}`} aria-haspopup="dialog" onClick={() => { selectAgent(selected.id); toggleChat(true); }} />
        <IconButton icon={Cpu} label="تبديل النموذج" aria-haspopup="dialog" onClick={() => openModelSwap(selected.id)} />
      </div>
      <div className="agent-inspector-actions">
        <button type="button" className="button small skill-import-trigger" onClick={() => openAgentSkills(selected.id, 'import')} aria-haspopup="dialog"><Github size={15} aria-hidden="true" />استيراد مهارة</button>
        <button type="button" className="button small ghost skill-catalog-trigger" onClick={() => openAgentSkills(selected.id)} aria-haspopup="dialog"><CommandGlyph kind="skill" size={16} />المهارات <span className="hud-count">{active}</span></button>

      </div>
    </div>}
    {!selected && <div className="agent-inspector"><button className="button small" type="button" onClick={() => { selectAgent(null); toggleChat(true); }}><MessageCircle size={15} aria-hidden="true" />محادثة الفريق</button></div>}
  </aside>;
}
