import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpLeft, ChevronLeft, ClipboardList, Compass, DoorOpen, Footprints,
  Layers3, LockKeyhole, Map, MapPin, MessageCircle, Route, UsersRound,
} from 'lucide-react';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { locatePoint, OFFICE_ROOMS, ROOM_BY_ID, type OfficeRoom } from '../office/layout.js';
import { orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { DEPARTMENT_GUIDE, TOUR_STOPS, type WorkArea } from '../office/visits.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useWoraStore, workspaceEntryLabel } from '../store/useWoraStore.js';
import { AgentAvatar, ConnectionBadge, RecentActivity, TeamCard } from './Dashboard.js';
import { OfficeFloorplan } from './OfficeFloorplan.js';
import { SpatialOffice } from './SpatialOffice.js';

function focusControl(selector: string) {
  window.requestAnimationFrame(() => {
    const control = document.querySelector<HTMLElement>(selector);
    control?.scrollIntoView({ block: 'nearest' });
    control?.focus({ preventScroll: true });
  });
}

function TourBar({ index, onVisit }: { index: number; onVisit: (id: string | null, tour?: boolean) => void }) {
  const next = TOUR_STOPS[index + 1];
  const previous = TOUR_STOPS[index - 1];
  function exit(keepRoom: boolean) {
    onVisit(keepRoom ? TOUR_STOPS[index] ?? null : null);
    focusControl('#office-department-picker');
  }
  return <section className="panel tour-bar" aria-label="الجولة الإرشادية">
    <div className="tour-mark"><Compass size={23} aria-hidden="true" /></div>
    <div className="tour-copy" aria-live="polite" aria-atomic="true">
      <strong>جولة أقسام الشركة</strong>
      <span>المحطّة <bdi>{index + 1}</bdi> من <bdi>{TOUR_STOPS.length}</bdi>{next ? <> · التالية: {ROOM_DISPLAY[next]?.label}</> : ' · المحطّة الأخيرة'}</span>
      <progress aria-label="تقدّم الجولة" max={TOUR_STOPS.length} value={index + 1} />
    </div>
    <div className="tour-actions">
      <button type="button" className="button small ghost" disabled={!previous} onClick={() => {
        if (!previous) return;
        onVisit(previous, true);
        if (index === 1) focusControl('.tour-next');
      }}><ArrowRight size={15} aria-hidden="true" />السابق</button>
      <button type="button" className="button primary tour-next" onClick={() => next ? onVisit(next, true) : exit(false)}>{next ? 'المحطّة التالية' : 'إنهاء الجولة'}<ArrowLeft size={15} aria-hidden="true" /></button>
      {next && <button type="button" className="text-link" onClick={() => exit(true)}>خروج من الجولة</button>}
    </div>
  </section>;
}

function DepartmentPanel({ room, onTour, onUpgrade, onWorkArea }: { room?: OfficeRoom; onTour?: () => void; onUpgrade: () => void; onWorkArea: (page: WorkArea) => void }) {
  const agents = useWoraStore((state) => state.agents);
  const locations = useWoraStore((state) => state.agentLocations);
  const selected = useWoraStore((state) => state.selectedAgentId ? state.agents[state.selectedAgentId] : undefined);
  const sessionOnly = useWoraStore((state) => state.connected && room != null && !state.zones.some((zone) => zone.id === room.id));
  const plan = useBillingStore((state) => state.plan);
  const workspace = useWoraStore((state) => room ? state.workspaces[room.id] : undefined);
  const list = useMemo(() => orderedAgents(agents), [agents]);
  const here = room ? list.filter((agent) => locations[agent.id]?.areaId === room.id && !locations[agent.id]?.isWalking) : [];
  const people = here.length ? here : room ? list.filter((agent) => agent.zoneId === room.id) : [];
  const task = workspace?.entries.slice().reverse().find((entry) => entry.type !== 'artifact' && (entry.status === 'open' || entry.status === 'in_progress'));
  const guide = room && DEPARTMENT_GUIDE[room.id];
  const display = room && ROOM_DISPLAY[room.id];
  const locked = room && isRoomLockedForPlan(room.id, plan);
  const { selectAgent, toggleChat, toggleWorkspaceHUD, dispatchAgentToRoom } = useWoraStore.getState();

  if (!room || !guide || !display) return <aside className="panel department-panel department-welcome" aria-labelledby="department-heading">
    <div className="department-sign scene-sign-welcome" aria-hidden="true"><Compass size={34} strokeWidth={1.3} /><bdi className="mono" dir="ltr">FRONT DESK</bdi></div>
    <div className="hq-kicker"><span /> بطاقة الزائر</div>
    <h2 id="department-heading">تحب تروح فين؟</h2>
    <p>كل الأقسام مفتوحة للزيارة. اختَر غرفة من المجسّم أو من قائمة الأقسام لتمشي لها وتتعرّف على شغل الفريق.</p>
    {onTour && <button className="button primary" type="button" onClick={onTour}><Compass size={17} aria-hidden="true" />ابدأ الجولة</button>}
    <span className="department-hint"><MapPin size={15} aria-hidden="true" /> العلامة الذهبية بتدلّك على مكانك.</span>
  </aside>;
  const Icon = display.icon;
  const shortcut = guide.shortcut;
  return <aside className={`panel department-panel space-${display.tone}`} aria-labelledby="department-heading">
    <div className="department-sign" aria-hidden="true"><Icon size={28} strokeWidth={1.45} /><bdi className="mono" dir="ltr">{guide.sign}</bdi><span className="mono">{room.code.slice(2)}</span></div>
    <h2 id="department-heading">{room.nameAr}</h2>
    <p>{guide.purpose}</p>
    <div className="department-occupants">
      <h3><UsersRound size={16} aria-hidden="true" />{here.length ? 'موجودون في القسم' : 'فريق القسم'}</h3>
      {people.length ? <ul>{people.slice(0, 3).map((agent) => <li key={agent.id}>
        <button type="button" className="department-person" onClick={() => { selectAgent(agent.id); toggleChat(true); }} aria-label={`محادثة ${agent.displayName}`}>
          <AgentAvatar agent={agent} /><span><bdi>{agent.displayName}</bdi><small>{agent.profile.customRole}{agent.id.startsWith('agent-custom-') && ' · محلي'}</small></span><MessageCircle size={16} aria-hidden="true" />
        </button>
      </li>)}</ul> : <p className="field-note">لا يوجد وكلاء في هذه الغرفة الآن.</p>}
    </div>
    {task && <button type="button" className="department-task" onClick={() => toggleWorkspaceHUD(true, room.id)}>
      <ClipboardList size={17} aria-hidden="true" /><span><small>{workspaceEntryLabel(task.id) ?? 'على لوحة القسم'}</small><strong dir="auto">{task.title}</strong></span><ArrowLeft size={14} aria-hidden="true" />
    </button>}
    {sessionOnly && <p className="department-local">المهام الجديدة في هذا القسم محلية لهذه الجلسة.</p>}
    <div className="department-actions">
      <button type="button" className="button primary" onClick={() => toggleWorkspaceHUD(true, room.id)}><ClipboardList size={16} aria-hidden="true" />مهام القسم</button>
      {locked ? <button type="button" className="button ghost" onClick={onUpgrade}><LockKeyhole size={15} aria-hidden="true" />إسناد المهام مع <bdi>Pro</bdi></button> : selected && <button type="button" className="button ghost" onClick={() => dispatchAgentToRoom(selected.id, room.id)}><Route size={15} aria-hidden="true" />إرسال <bdi>{selected.displayName}</bdi></button>}
    </div>
    {shortcut && <button type="button" className="text-link department-shortcut" onClick={() => onWorkArea(shortcut.page)}>{shortcut.label}<ArrowUpLeft size={14} aria-hidden="true" /></button>}
  </aside>;
}

export function Campus({ roomId, tourIndex, onVisit, onReception, onUpgrade, onWorkArea, showTeam, onTeamShown }: {
  roomId: string | null; tourIndex: number | null; onVisit: (id: string | null, tour?: boolean) => void; onReception: () => void; onUpgrade: () => void;
  onWorkArea: (page: WorkArea) => void; showTeam: boolean; onTeamShown: () => void;
}) {
  const [view, setView] = useState<'space' | 'plan'>('space');
  const [whole, setWhole] = useState(false);
  const room = roomId ? ROOM_BY_ID[roomId] : undefined;
  const walking = useOfficeMotion((state) => state.player.path.length > 0);
  const visiting = useOfficeMotion((state) => Boolean(state.player.targetRoomId));
  const place = useOfficeMotion((state) => locatePoint(state.player).areaId);
  const placeName = place === 'zone-lounge' && roomId === null ? 'الاستقبال' : ROOM_DISPLAY[place]?.label ?? 'الممر';
  const travelTo = useOfficeMotion((state) => state.visitRoom);
  const select = useWoraStore((state) => state.selectAgent);
  const focusRoom = useWoraStore((state) => state.focusRoomCamera);
  const reset = useWoraStore((state) => state.resetCamera);
  const command = useWoraStore((state) => state.officeCommand);
  const following = useWoraStore((state) => state.followAgentId);
  const roaming = useWoraStore((state) => state.ui.autoRoam);
  const { toggleWorkspaceHUD, toggleChat, callTeamStandup, returnAllToDesks, toggleAutoRoam } = useWoraStore.getState();
  const wide = whole && !following && command?.kind !== 'focus-agent';
  const startTour = () => {
    onVisit(TOUR_STOPS[0], true);
    focusControl('.tour-next');
  };

  useEffect(() => {
    travelTo(roomId);
    setWhole(false);
  }, [roomId, travelTo]);

  useEffect(() => {
    if (!showTeam) return;
    const roster = document.getElementById('campus-team');
    roster?.scrollIntoView({ block: 'nearest' });
    roster?.focus({ preventScroll: true });
    onTeamShown();
  }, [showTeam, onTeamShown]);

  const chooseRoom = useCallback((id: string) => {
    setWhole(false);
    if (id === roomId) travelTo(id);
    onVisit(id);
  }, [onVisit, roomId, travelTo]);

  return <>
    <header className="campus-heading">
      <div>
        <div className="campus-crumb"><button type="button" className="text-link" onClick={onReception}><DoorOpen size={16} aria-hidden="true" />الاستقبال</button><ChevronLeft size={13} aria-hidden="true" /><span>الطابق الأول</span></div>
        <h1>المقر التفاعلي</h1>
        <p>تنقّل بين مكاتب الشركة وتابع الفريق وهو يشتغل.</p>
      </div>
      <div className="campus-heading-actions"><ConnectionBadge />{tourIndex === null && <button type="button" className="button" onClick={startTour}><Compass size={17} aria-hidden="true" />جولة مع الدليل</button>}</div>
    </header>
    {tourIndex !== null && <TourBar index={tourIndex} onVisit={onVisit} />}
    <div className="office-layout">
      <section className="panel office-scene" aria-labelledby="office-map-heading">
        <div className="office-scene-head">
          <div><div className="hq-kicker"><span /> المقر الرئيسي</div><h2 id="office-map-heading">الطابق الأول</h2></div>
          <div className="office-view-switch" role="group" aria-label="طريقة عرض المقر">
            <button type="button" aria-pressed={view === 'space'} onClick={() => setView('space')}><Layers3 size={16} aria-hidden="true" />مجسّم</button>
            <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><Map size={16} aria-hidden="true" />مخطط</button>
          </div>
        </div>
        <div className="office-wayfinding">
          <label className="room-picker"><MapPin size={16} aria-hidden="true" /><select id="office-department-picker" aria-label="اختيار قسم على الخريطة" className="field" value={roomId ?? ''} onChange={(event) => {
            const id = event.target.value;
            if (id) chooseRoom(id); else onVisit(null);
          }}>
            <option value="">الاستقبال · اختَر قسمًا</option>{OFFICE_ROOMS.map((item) => <option value={item.id} key={item.id}>{item.nameAr}</option>)}
          </select></label>
          {room && view === 'space' && <button type="button" className="button small ghost office-fit" onClick={() => { reset(); setWhole(!wide); }}><Layers3 size={15} aria-hidden="true" />{wide ? 'ركّز على القسم' : 'المقر بالكامل'}</button>}
          {room && view === 'plan' && <button type="button" className="button small ghost office-fit" onClick={() => focusRoom(room.id)}><MapPin size={15} aria-hidden="true" />تركيز</button>}
          {!room && view === 'space' && (command?.kind === 'focus-agent' || following) && <button type="button" className="button small ghost" onClick={reset}>المقر بالكامل</button>}
        </div>
        {view === 'space' ? <div className="spatial-stage">
          <div className="spatial-mark mono" dir="ltr" aria-hidden="true"><i /> WORA HQ <span /> LEVEL 01</div>
          <SpatialOffice room={room} wide={wide} onRoom={chooseRoom} onAgent={select} />
        </div> : <OfficeFloorplan selectedRoomId={roomId} onRoom={chooseRoom} onAgent={select} />}
        <div className="office-scene-foot map-caption">
          <span className="visitor-location" role="status"><span className="status-dot" />{visiting ? `في الطريق إلى ${room ? ROOM_DISPLAY[room.id]?.label : 'الاستقبال'}` : walking ? 'بتتجوّل في الممرات' : `مكانك الآن · ${placeName}`}</span>
          <button type="button" className="text-link" onClick={() => toggleWorkspaceHUD(true, roomId)}><ClipboardList size={15} aria-hidden="true" />مهام الأقسام</button>
        </div>
      </section>
      <DepartmentPanel room={room} onTour={tourIndex === null ? startTour : undefined} onUpgrade={onUpgrade} onWorkArea={onWorkArea} />
    </div>
    <div className="campus-tools">
      <button type="button" className="filter-chip" onClick={callTeamStandup}><UsersRound size={16} aria-hidden="true" />اجتماع الفريق</button>
      <button type="button" className="filter-chip" onClick={returnAllToDesks}><Footprints size={16} aria-hidden="true" />عودة للمكاتب</button>
      <button type="button" className="filter-chip" aria-pressed={roaming} onClick={toggleAutoRoam}><Route size={15} aria-hidden="true" />تحرّك الوكلاء تلقائياً</button>
      <button type="button" className="filter-chip campus-chat" onClick={() => { select(null); toggleChat(true); }}><MessageCircle size={16} aria-hidden="true" />محادثة الفريق</button>
    </div>
    <div className="dashboard-layout campus-operations"><TeamCard expanded onOpenAgent={select} /><RecentActivity /></div>
  </>;
}
