import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpLeft, ClipboardList, Maximize2, MessageCircle, Minimize2, Plus } from 'lucide-react';
import { CHANNELS, CHANNEL_BY_ID, TOUR_STOPS } from '../office/channels.js';
import { orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { DIRECTOR_ROOM_ID, isBusyAgent, isOpenTask, localTime, officeTasks, taskCountByAgent } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { AgentSidebar, ConnectionBadge } from './AgentSidebar.js';
import { CommandGlyph } from './CommandGlyph.js';
import { SignalMesh } from './SignalMesh.js';
import { IconButton } from './ui.js';

function TourBar({ index, onVisit, onDirector }: { index: number; onVisit: (id: string | null, tour?: boolean) => void; onDirector: () => void }) {
  const next = TOUR_STOPS[index + 1];
  const previous = TOUR_STOPS[index - 1];
  return <section className="hud-panel command-tour" aria-label="جولة القنوات">
    <span aria-live="polite">الجولة <bdi>{index + 1} / {TOUR_STOPS.length}</bdi></span>
    {TOUR_STOPS[index] === DIRECTOR_ROOM_ID && <button type="button" className="button small ghost" onClick={onDirector}>فتح المدير</button>}
    <button type="button" className="button small ghost" disabled={!previous} onClick={() => previous && onVisit(previous, true)}><ArrowRight size={14} aria-hidden="true" />السابق</button>
    <button type="button" className="button small" onClick={() => onVisit(next ?? null, Boolean(next))}>{next ? 'التالي' : 'إنهاء'}<ArrowLeft size={14} aria-hidden="true" /></button>
  </section>;
}

function SessionActivity() {
  const events = useWoraStore((s) => s.activityLog);
  if (!events.length) return null;
  return <section className="hud-panel command-activity" aria-labelledby="activity-heading">
    <div className="hud-header"><div className="hud-heading"><span className="hud-icon"><CommandGlyph kind="pulse" size={19} /></span><div><span className="hud-label" dir="ltr">04 / EVENT LOG</span><h2 id="activity-heading">نشاط الجلسة</h2></div></div></div>
    <ul>{events.slice(0, 4).map((event) => <li key={event.id}><p dir="auto">{event.text}</p><small>{event.scope === 'session' || event.scope === 'local' ? 'محلي · ' : event.scope === 'preview' ? 'معاينة · ' : ''}<time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small></li>)}</ul>
  </section>;
}

export function CommandCenter({ roomId, tourIndex, onVisit, onAssign, onDirector }: {
  roomId: string | null; tourIndex: number | null; onVisit: (id: string | null, tour?: boolean) => void; onAssign: () => void; onDirector: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const selectedId = useWoraStore((s) => s.selectedAgentId);
  const agents = useWoraStore((s) => s.agents);
  const workspaces = useWoraStore((s) => s.workspaces);
  const ordered = useMemo(() => orderedAgents(agents), [agents]);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const counts = useMemo(() => taskCountByAgent(tasks), [tasks]);
  const channel = roomId ? CHANNEL_BY_ID[roomId] : undefined;
  const shown = channel ? ordered.filter((agent) => agent.zoneId === roomId) : ordered;
  const selected = shown.find((agent) => agent.id === selectedId) ?? shown[0];
  const busy = shown.filter(isBusyAgent).length;
  const skills = shown.reduce((total, agent) => total + (agent.skillSnapshot?.activeNames.length ?? 0), 0);
  const open = tasks.filter((task) => isOpenTask(task) && (!channel || task.zoneId === roomId)).length;
  const { selectAgent, toggleChat, toggleWorkspaceHUD } = useWoraStore.getState();

  useEffect(() => {
    if (!expanded) return;
    document.getElementById('main-content')?.scrollTo({ top: 0 });
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        setExpanded(false);
        expandButton.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [expanded]);

  const stats = [
    { kind: 'agents', label: 'وكلاء القناة', code: 'AGENTS', value: shown.length, tone: 'cyan' },
    { kind: 'pulse', label: 'قيد المعالجة', code: 'PROCESSING', value: busy, tone: 'violet' },
    { kind: 'skill', label: 'مهارات مفعّلة', code: 'SKILLS', value: skills, tone: 'mint' },
    { kind: 'task', label: 'مهام مفتوحة', code: 'OPEN TASKS', value: open, tone: 'gold' },
  ] as const;

  return <div className={`command-center${expanded ? ' is-expanded' : ''}`}>
    {!expanded && <>
      <header className="command-titlebar">
        <div><div className="command-kicker"><span className="kicker-bars" aria-hidden="true" /><span dir="ltr">CONTROL PLANE / 01</span><ConnectionBadge /></div><h1>شبكة القيادة</h1><p>راقب تدفّق العمل، وجّه الوكلاء، وأضف مهارات جديدة لفريقك.</p></div>
        <button type="button" className="button primary command-assign" onClick={onAssign}><Plus size={18} aria-hidden="true" />إسناد مهمة</button>
      </header>
      {tourIndex !== null && <TourBar index={tourIndex} onVisit={onVisit} onDirector={onDirector} />}
      <ul className="command-metrics" aria-label="مؤشرات القناة الحالية">{stats.map(({ kind, label, code, value, tone }) => <li key={kind} className={`hud-panel metric-tile tone-${tone}`}>
        <span className="metric-icon"><CommandGlyph kind={kind} size={23} /></span><span className="metric-copy"><span dir="ltr" className="hud-label">{code}</span><span>{label}</span></span><bdi className="metric-value">{String(value).padStart(2, '0')}</bdi>
      </li>)}</ul>
    </>}
    <div className="command-grid">
      <section className="hud-panel mesh-panel" aria-labelledby="mesh-title">
        <header className="hud-header mesh-header">
          <div className="hud-heading"><span className="hud-icon"><CommandGlyph kind="mesh" size={19} /></span><div><span className="hud-label" dir="ltr">01 / SIGNAL MESH</span><h2 id="mesh-title">{channel ? `قناة ${channel.nameAr}` : 'شبكة الإشارات'}</h2></div></div>
          <div className="mesh-controls">
            <label className="mesh-picker"><select className="field" aria-label="قناة العمل" value={roomId ?? ''} onChange={(event) => onVisit(event.target.value || null)}><option value="">كل القنوات</option>{CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
            <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'استعادة الشبكة' : 'تكبير الشبكة'} aria-keyshortcuts={expanded ? 'Escape' : undefined}
              ref={expandButton} onClick={() => setExpanded((value) => !value)} />
          </div>
        </header>
        <SignalMesh agents={shown} selected={selected?.id} onSelect={selectAgent} />
        <footer className="mesh-footer">
          <span className={`mesh-context${selected && !expanded ? ' has-mobile-target' : ''}`}><span className="mesh-port" aria-hidden="true" />{channel?.subtitleAr ?? (shown.length > 4 ? 'اختر عقدة أو وكيلاً من القائمة' : 'اختر عقدة لإدارة الوكيل')}</span>
          {selected && !expanded && <button type="button" className="text-link mesh-mobile-inspect" onClick={() => document.getElementById('team-hud-title')?.focus()}><CommandGlyph kind="agents" size={14} />إدارة <bdi>{selected.displayName}</bdi></button>}
          <div className="mesh-footer-actions">
            <button className="button small ghost" onClick={() => { selectAgent(null); toggleChat(true); }} aria-haspopup="dialog"><MessageCircle size={15} aria-hidden="true" />المحادثة</button>
            <button className="button small ghost" onClick={() => toggleWorkspaceHUD(true, roomId)} aria-haspopup="dialog"><ClipboardList size={15} aria-hidden="true" />لوحة المهام</button>
          </div>
        </footer>
      </section>
      {!expanded && <AgentSidebar agents={shown} selected={selected} openTasks={selected ? counts.get(selected.id) ?? 0 : 0} />}
    </div>
    {!expanded && <>
      <section className="command-channels" aria-labelledby="channels-title">
        <header><div><span dir="ltr" className="hud-label">03 / WORK CHANNELS</span><h2 id="channels-title">قنوات العمل</h2></div>{channel ? <button type="button" className="text-link" onClick={() => onVisit(null)}>كل القنوات<ArrowLeft size={15} aria-hidden="true" /></button> : <span className="hud-label" dir="ltr">10 / CHANNELS</span>}</header>
        <ul>{CHANNELS.map((item) => {
          const Icon = ROOM_DISPLAY[item.id]!.icon;
          return <li key={item.id}><button className={`hud-panel channel-tile tone-${item.tone}`} type="button" aria-pressed={roomId === item.id} onClick={() => onVisit(item.id)}>
            <span className="channel-icon"><Icon size={17} aria-hidden="true" /></span><span><small dir="ltr">CH/{item.code}</small><strong>{item.nameAr}</strong></span><ArrowUpLeft size={14} aria-hidden="true" />
          </button></li>;
        })}</ul>
      </section>
      <SessionActivity />
    </>}
  </div>;
}
