import { useCallback, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowUpLeft, Bot, Building2, Check, ClipboardList, Cpu, Eye, Footprints,
  FolderKanban, Layers3, LockKeyhole, Map, MapPin, Maximize2, MessageCircle, Radio, Route, UsersRound,
} from 'lucide-react';
import hqArt from '../assets/wora-hq-art.webp';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { ROOM_BY_ID, OFFICE_ROOMS } from '../office/layout.js';
import { agentInitials, orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useProjectStore } from '../store/useProjectStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { ParticipantStatus, type AgentParticipant } from '../types.js';
import { OfficeFloorplan } from './OfficeFloorplan.js';
import { EmptyState, IconTile, PageHeader } from './ui.js';

function ConnectionBadge() {
  const connected = useWoraStore((s) => s.connected);
  const demo = useWoraStore((s) => s.demoMode);
  const label = connected ? 'متصل بالمقر' : demo ? 'وضع المعاينة' : 'جارٍ الاتصال';
  return <span className={`connection-badge ${connected || demo ? 'is-ready' : ''}`} role="status"><span className="status-dot" />{label}</span>;
}

export function AgentAvatar({ agent, className = '' }: { agent: AgentParticipant; className?: string }) {
  return <span aria-hidden="true" className={`agent-avatar ${className}`} style={{ '--agent-color': agent.profile.avatarColor } as React.CSSProperties}><bdi>{agentInitials(agent)}</bdi></span>;
}

function AgentStatus({ agent }: { agent: AgentParticipant }) {
  const loc = useWoraStore((s) => s.agentLocations[agent.id]);
  const busy = agent.lifecycleState === 'RESPONDING' || agent.lifecycleState === 'THINKING';
  const label = agent.lifecycleState === 'RESPONDING' ? 'يردّ' : agent.lifecycleState === 'THINKING' ? 'يفكّر' : loc?.isWalking ? 'في الطريق' : loc?.activity === 'meeting' ? 'في اجتماع' : agent.status === ParticipantStatus.Offline ? 'غير متصل' : 'متاح';
  return <span className={`agent-status ${busy ? 'tone-gold' : loc?.isWalking ? 'tone-cyan' : agent.status === ParticipantStatus.Offline ? '' : 'tone-mint'}`}><span className="status-dot" />{label}</span>;
}

function CardHead({ icon, title, text, action }: { icon: typeof Map; title: string; text?: string; action?: React.ReactNode }) {
  return <div className="card-heading"><IconTile icon={icon} /><div className="card-heading-copy"><h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>;
}

function TeamCard({ expanded, onOpenAll, onOpenAgent }: { expanded?: boolean; onOpenAll?: () => void; onOpenAgent: (id: string) => void }) {
  const agents = useWoraStore((s) => s.agents);
  const selectedId = useWoraStore((s) => s.selectedAgentId);
  const list = useMemo(() => orderedAgents(agents), [agents]);
  return (
    <section className={`panel team-card${expanded ? ' team-expanded' : ''}`} id={expanded ? 'campus-team' : undefined} tabIndex={expanded ? -1 : undefined}>
      <CardHead icon={UsersRound} title="فريق الوكلاء" text={`${list.length} وكلاء في مساحة العمل`}
        action={onOpenAll && <button type="button" className="text-link team-header-link" onClick={onOpenAll}>عرض الفريق <ArrowLeft size={13} /></button>} />
      {list.length ? <ul className="team-list hq-scroll">
        {(expanded ? list : list.slice(0, 4)).map((agent) => (
          <li key={agent.id}>
            <button className="team-row" type="button" onClick={() => onOpenAgent(agent.id)} aria-pressed={expanded ? selectedId === agent.id : undefined}>
              <AgentAvatar agent={agent} />
              <span className="agent-copy"><bdi>{agent.displayName}</bdi><small>{agent.profile.customRole}</small></span>
              <AgentStatus agent={agent} />
            </button>
          </li>
        ))}
      </ul> : <div className="team-empty"><EmptyState icon={Bot} title="لا يوجد وكلاء بعد">اضغط «وكيل جديد» لإضافة أول عضو إلى الفريق.</EmptyState></div>}
      {expanded ? <AgentDetails agent={selectedId ? agents[selectedId] : undefined} /> : <div className="team-foot"><UsersRound size={14} aria-hidden="true" /><span>اختَر وكيلاً لعرض تفاصيله أو مراسلته.</span></div>}
    </section>
  );
}

function AgentDetails({ agent }: { agent?: AgentParticipant }) {
  const location = useWoraStore((s) => agent ? s.agentLocations[agent.id] : undefined);
  const followId = useWoraStore((s) => s.followAgentId);
  const openChat = useWoraStore((s) => s.toggleChat);
  const openModel = useWoraStore((s) => s.openModelSwap);
  const follow = useWoraStore((s) => s.setFollowAgent);
  if (!agent) return <div className="agent-details subtle">اختَر وكيلاً من القائمة أو الخريطة للتحكم فيه.</div>;
  const following = followId === agent.id;
  return <div className="agent-details">
    <div className="agent-detail-line"><MapPin size={15} /><span>{location?.statusTextAr ?? 'على المكتب'}</span><small>{location?.areaNameAr}</small></div>
    <div className="agent-detail-line"><Cpu size={15} /><bdi className="mono">{agent.brainConfig?.model ?? agent.modelId}</bdi></div>
    <div className="agent-detail-actions">
      <button type="button" className="button primary small" onClick={() => openChat(true)}><MessageCircle size={14} />محادثة</button>
      <button type="button" className="button small" onClick={() => openModel(agent.id)}><Cpu size={14} />تبديل النموذج</button>
      <button type="button" className="button small" aria-pressed={following} onClick={() => follow(following ? null : agent.id)}><Eye size={14} />{following ? 'إيقاف المتابعة' : 'متابعة'}</button>
    </div>
  </div>;
}

function MapCard({ expanded, onExpand, onUpgrade, onAgent }: { expanded?: boolean; onExpand?: () => void; onUpgrade?: () => void; onAgent: (id: string) => void }) {
  const [roomId, setRoom] = useState<string | null>(null);
  const plan = useBillingStore((s) => s.plan);
  const agent = useWoraStore((s) => s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined);
  const focusRoom = useWoraStore((s) => s.focusRoomCamera);
  const dispatch = useWoraStore((s) => s.dispatchAgentToRoom);
  const openTasks = useWoraStore((s) => s.toggleWorkspaceHUD);
  const room = roomId ? ROOM_BY_ID[roomId] : undefined;
  const locked = room && isRoomLockedForPlan(room.id, plan);
  const selectRoom = useCallback((id: string) => setRoom((value) => value === id ? null : id), []);

  return (
    <section className="panel map-card">
      <CardHead icon={Map} title={expanded ? 'خريطة المقر' : 'المقر التفاعلي'} text="مخطط حيّ لمساحات عمل الفريق" action={
        expanded ? <span className="badge tint"><Radio size={13} />عرض حيّ</span> : <button type="button" className="button ghost small map-expand" onClick={onExpand}><Maximize2 size={14} /><span>عرض كامل</span></button>
      } />
      <div className="map-inset">
        <OfficeFloorplan expanded={expanded} selectedRoomId={roomId} onRoom={selectRoom} onAgent={onAgent} />
        <div className="map-caption" aria-label="مفتاح الخريطة">
          <div><span className="map-key tone-violet"><i />وكيل</span><span className="map-key tone-cyan"><i />قسم عمل</span><span className="map-key"><LockKeyhole size={12} />قسم <bdi>Pro</bdi></span></div>
          <button type="button" onClick={() => openTasks(true, roomId)} className="text-link"><ClipboardList size={14} />مهام الأقسام</button>
        </div>
      </div>
      <div className={`room-inspector${expanded || room ? '' : ' hidden'}`}>
        {expanded && <label className="room-picker"><MapPin size={15} /><select aria-label="اختيار قسم على الخريطة" className="field" value={roomId ?? ''} onChange={(event) => setRoom(event.target.value || null)}>
          <option value="">انتقل إلى قسم...</option>{OFFICE_ROOMS.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
        </select></label>}
        {room ? <div className="room-info">
          <div><strong>{room.nameAr}</strong><p>{room.subtitleAr}</p></div>
          <div className="room-actions">
            {expanded && <button type="button" className="button small" onClick={() => focusRoom(room.id)}><Maximize2 size={14} />تركيز</button>}
            {locked ? <button type="button" className="button small" onClick={onUpgrade}><LockKeyhole size={14} />عرض الخطة</button> : agent ? <button type="button" className="button primary small" onClick={() => dispatch(agent.id, room.id)}><Route size={14} />إرسال <bdi>{agent.displayName}</bdi></button> : expanded ? <small className="subtle">اختَر وكيلاً لإرساله إلى هذا القسم.</small> : null}
          </div>
        </div> : expanded ? <p>اختَر قسماً، أو اضغط على الممر لتتحرك داخله.</p> : null}
      </div>
    </section>
  );
}

function Metrics({ onTeam, onRooms, onTasks, onProjects }: { onTeam: () => void; onRooms: () => void; onTasks: () => void; onProjects: () => void }) {
  const agentCount = useWoraStore((s) => Object.keys(s.agents).length);
  const workspaces = useWoraStore((s) => s.workspaces);
  const projectCount = useProjectStore((s) => s.projects.length);
  const open = Object.values(workspaces).reduce((total, ws) => total + ws.entries.filter((entry) => entry.type !== 'artifact' && (entry.status === 'open' || entry.status === 'in_progress')).length, 0);
  const metrics = [
    { icon: UsersRound, tone: 'violet', title: 'وكلاء الفريق', value: agentCount, context: 'أعضاء في مساحة العمل', onClick: onTeam },
    { icon: Building2, tone: 'cyan', title: 'أقسام المقر', value: OFFICE_ROOMS.length, context: 'مساحات عمل متخصصة', onClick: onRooms },
    { icon: ClipboardList, tone: 'gold', title: 'مهام الأقسام', value: open, context: 'مفتوحة أو قيد التنفيذ', onClick: onTasks },
    { icon: FolderKanban, tone: 'mint', title: 'المشاريع', value: projectCount, context: 'ضمن مساحة العمل', onClick: onProjects },
  ] as const;
  return <section className="metrics-grid" aria-label="ملخص مساحة العمل">
    {metrics.map((metric) => <button key={metric.title} type="button" className={`panel metric-card tone-${metric.tone}`} onClick={metric.onClick}>
      <IconTile icon={metric.icon} tone={metric.tone} />
      <div className="metric-copy"><span>{metric.title}</span><strong dir="ltr">{String(metric.value).padStart(2, '0')}</strong><small>{metric.context}</small></div>
      <ArrowUpLeft className="metric-arrow" size={14} aria-hidden="true" />
    </button>)}
  </section>;
}

function RecentActivity() {
  const events = useWoraStore((s) => s.activityLog);
  return <section className="panel activity-card">
    <CardHead icon={Activity} title="آخر النشاط" text="التغييرات التي حصلت في المقر خلال هذه الجلسة" />
    <ul>{events.slice(0, 4).map((event) => <li key={event.id}><span className="activity-marker"><Check size={13} /></span><span>{event.text}</span><time>{event.timestamp}</time></li>)}</ul>
  </section>;
}

export function Dashboard({ onCampus, onTeam, onProjects, onAgent, onUpgrade }: { onCampus: () => void; onTeam: () => void; onProjects: () => void; onAgent: (id: string) => void; onUpgrade: () => void }) {
  const openChat = useWoraStore((s) => s.toggleChat);
  const openTasks = useWoraStore((s) => s.toggleWorkspaceHUD);
  const selectAgent = useWoraStore((s) => s.selectAgent);
  return (
    <>
      <section className="hq-hero" aria-labelledby="overview-title">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-visual" aria-hidden="true">
          <img src={hqArt} width="1080" height="703" alt="" />
          <div className="hero-visual-caption" dir="ltr"><span /><span>WORA HQ</span><i /> OPERATIONS</div>
        </div>
        <ConnectionBadge />
        <div className="hero-copy">
          <div className="hero-eyebrow"><Layers3 size={15} strokeWidth={1.75} /> مركز عمليات <bdi>Wora</bdi></div>
          <h1 id="overview-title">فريقك الذكي،{' '}<br /><span>في مكان واحد.</span></h1>
          <p>تابع وكلاءك، وزّع المهام، وأدر مشاريعك من مقرّ واحد.</p>
          <div className="hero-actions">
            <button type="button" className="button primary" onClick={onCampus}>استكشف المقر <ArrowLeft size={17} /></button>
            <button type="button" className="button hero-secondary" onClick={() => { selectAgent(null); openChat(true); }}><MessageCircle size={16} />محادثة الفريق</button>
          </div>
        </div>
      </section>
      <Metrics onTeam={onTeam} onRooms={onCampus} onTasks={() => openTasks(true)} onProjects={onProjects} />
      <div className="dashboard-layout">
        <MapCard onExpand={onCampus} onUpgrade={onUpgrade} onAgent={onAgent} />
        <TeamCard onOpenAll={onTeam} onOpenAgent={onAgent} />
      </div>
      <RecentActivity />
    </>
  );
}

export function Campus({ onUpgrade }: { onUpgrade: () => void }) {
  const select = useWoraStore((s) => s.selectAgent);
  const toggleRoam = useWoraStore((s) => s.toggleAutoRoam);
  const openChat = useWoraStore((s) => s.toggleChat);
  const roaming = useWoraStore((s) => s.ui.autoRoam);
  const standup = useWoraStore((s) => s.callTeamStandup);
  const returnDesks = useWoraStore((s) => s.returnAllToDesks);
  return (
    <>
      <PageHeader icon={Building2} eyebrow="مقرّ Wora" title="المقر التفاعلي" description="تنقّل بين الأقسام وتابع وكلاءك وهم ينتقلون من مكتب لمكتب."
        action={<><button type="button" className="button" onClick={returnDesks}><Footprints size={16} />عودة للمكاتب</button><button type="button" className="button primary" onClick={standup}><UsersRound size={16} />اجتماع الفريق</button></>} />
      <div className="campus-tools"><ConnectionBadge /><button type="button" className="filter-chip" aria-pressed={roaming} onClick={toggleRoam}><Route size={15} />الجولات التلقائية <span className="status-dot" /></button><button type="button" className="filter-chip campus-chat" onClick={() => { select(null); openChat(true); }}><MessageCircle size={16} />محادثة الفريق</button></div>
      <div className="dashboard-layout campus-layout"><MapCard expanded onAgent={select} onUpgrade={onUpgrade} /><TeamCard expanded onOpenAgent={select} /></div>
      <RecentActivity />
    </>
  );
}
