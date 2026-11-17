import { useMemo } from 'react';
import {
  Activity, ArrowLeft, ArrowUpLeft, Bot, Building2, Check, ClipboardList, Compass, Cpu, DoorOpen, Eye,
  FolderKanban, Map, MapPin, MessageCircle, UsersRound,
} from 'lucide-react';
import receptionArt from '../assets/hq-reception.webp';
import { OFFICE_ROOMS } from '../office/layout.js';
import { officeHash } from '../pages.js';
import { DEPARTMENT_GUIDE } from '../office/visits.js';
import { agentInitials, orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { useProjectStore } from '../store/useProjectStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { ParticipantStatus, type AgentParticipant } from '../types.js';
import { EmptyState, IconTile } from './ui.js';

export function ConnectionBadge() {
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

export function TeamCard({ expanded, onOpenAll, onOpenAgent }: { expanded?: boolean; onOpenAll?: () => void; onOpenAgent: (id: string) => void }) {
  const agents = useWoraStore((s) => s.agents);
  const selectedId = useWoraStore((s) => s.selectedAgentId);
  const list = useMemo(() => orderedAgents(agents), [agents]);
  return (
    <section className={`panel team-card${expanded ? ' team-expanded' : ''}`} id={expanded ? 'campus-team' : undefined} tabIndex={expanded ? -1 : undefined}>
      <CardHead icon={UsersRound} title="فريق الوكلاء" text={`${list.length} وكلاء في مساحة العمل`}
        action={onOpenAll && <button type="button" className="text-link team-header-link" onClick={onOpenAll}>عرض الفريق <ArrowLeft size={13} aria-hidden="true" /></button>} />
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

export function RecentActivity() {
  const events = useWoraStore((s) => s.activityLog);
  return <section className="panel activity-card">
    <CardHead icon={Activity} title="آخر النشاط" text="التغييرات التي حصلت في المقر خلال هذه الجلسة" />
    <ul>{events.slice(0, 4).map((event) => <li key={event.id}><span className="activity-marker"><Check size={13} /></span><span>{event.text}</span><time>{event.timestamp}</time></li>)}</ul>
  </section>;
}

function DepartmentDirectory({ onVisit }: { onVisit: (id: string) => void }) {
  return <section className="reception-directory" aria-labelledby="reception-directory-title">
    <div className="section-bar reception-directory-title"><div>
      <div className="hq-kicker"><span aria-hidden="true" /> دليلك داخل الشركة</div>
      <h2 id="reception-directory-title">أي قسم تحب تزوره؟</h2>
      <p>اختَر غرفة وادخل مباشرة، أو ابدأ الجولة من الاستقبال.</p>
    </div><bdi className="floor-count mono" dir="ltr">01 FLOOR <i /> {OFFICE_ROOMS.length.toString().padStart(2, '0')} ROOMS</bdi></div>
    <div className="reception-departments">
      {OFFICE_ROOMS.map((room) => {
        const { icon: Icon, label, tone } = ROOM_DISPLAY[room.id]!;
        return <a key={room.id} href={officeHash(room.id)} className={`panel directory-door space-${tone}`} onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onVisit(room.id);
        }} aria-label={`دخول ${room.nameAr}`}>
          <div className="directory-door-top"><span className="department-icon"><Icon size={20} aria-hidden="true" /></span><bdi className="mono">{room.code.slice(2)}</bdi></div>
          <div className="directory-door-name"><strong>{label}</strong><ArrowUpLeft size={15} aria-hidden="true" /></div>
          <p>{DEPARTMENT_GUIDE[room.id]?.outputs}</p>
        </a>;
      })}
    </div>
  </section>;
}

export function Dashboard({ onCampus, onTour, onVisit, onTeam, onProjects, onAgent }: {
  onCampus: () => void; onTour: () => void; onVisit: (id: string) => void; onTeam: () => void; onProjects: () => void; onAgent: (id: string) => void;
}) {
  const openTasks = useWoraStore((s) => s.toggleWorkspaceHUD);
  const openChat = () => {
    useWoraStore.getState().selectAgent(null);
    useWoraStore.getState().toggleChat(true);
  };
  return <>
    <section className="reception-hero" aria-labelledby="overview-title">
      <img className="reception-photo" src={receptionArt} width={1376} height={768} alt="" />
      <div className="reception-shade" aria-hidden="true" />
      <div className="reception-meta"><span className="reception-position"><MapPin size={15} aria-hidden="true" /> أنت الآن في الاستقبال</span><ConnectionBadge /></div>
      <div className="reception-copy">
        <bdi className="reception-edition mono" dir="ltr">WORA HQ <i /> VISITOR ACCESS</bdi>
        <h1 id="overview-title">أهلاً بك في <span>مقرّ <bdi>Wora.</bdi></span></h1>
        <p>ادخل مقرّ شركتك. اتعرّف على الفريق وتجوّل بين الأقسام، من أول فكرة لحد ما المنتج يوصل للعملاء.</p>
        <div className="reception-actions">
          <button type="button" className="button primary" onClick={onCampus}><DoorOpen size={18} aria-hidden="true" />ادخل المقر <ArrowLeft size={17} aria-hidden="true" /></button>
          <button type="button" className="button reception-tour" onClick={onTour}><Compass size={17} aria-hidden="true" />ابدأ جولة مع الدليل</button>
        </div>
      </div>
      <div className="reception-plaque" aria-hidden="true"><span className="reception-plaque-num mono">01</span><span><strong>الاستقبال</strong><bdi className="mono" dir="ltr">MAIN LOBBY</bdi></span></div>
    </section>
    <DepartmentDirectory onVisit={onVisit} />
    <Metrics onTeam={onTeam} onRooms={onCampus} onTasks={() => openTasks(true)} onProjects={onProjects} />
    <div className="reception-quick-tools"><button type="button" className="text-link" onClick={openChat}><MessageCircle size={16} aria-hidden="true" />محادثة الفريق</button></div>
    <div className="dashboard-layout reception-operations"><TeamCard onOpenAll={onTeam} onOpenAgent={onAgent} /><RecentActivity /></div>
  </>;
}
