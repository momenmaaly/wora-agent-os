import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Box, ClipboardList, Footprints, Layers3, Map, MapPin, Maximize2, Minimize2,
  Radio, UsersRound, X,
} from 'lucide-react';
import { locatePoint, OFFICE_ROOMS, ROOM_BY_ID } from '../office/layout.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { TOUR_STOPS } from '../office/visits.js';
import { DIRECTOR_ROOM_ID, isBusyAgent, isOpenTask, localTime, officeTasks, taskStage } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { ConnectionBadge, OfficePeople } from './OfficePeople.js';
import { OfficeFloorplan } from './OfficeFloorplan.js';
import { SpatialOffice } from './SpatialOffice.js';
import { supportsWebGL } from '../three/webgl.js';

const Office3D = lazy(() => import('./Office3D.js').then((module) => ({ default: module.Office3D })));

type Drawer = 'team' | 'activity' | null;

function TourBar({ index, onVisit, onDirector }: { index: number; onVisit: (id: string | null, tour?: boolean) => void; onDirector: () => void }) {
  const next = TOUR_STOPS[index + 1];
  const previous = TOUR_STOPS[index - 1];
  return <section className="campus-tour" aria-label="جولة الأقسام">
    <span aria-live="polite">جولة الأقسام <bdi>{index + 1} / {TOUR_STOPS.length}</bdi></span>
    {TOUR_STOPS[index] === DIRECTOR_ROOM_ID && <button type="button" className="button small ghost" onClick={onDirector}>فتح مكتب المدير</button>}
    <button type="button" className="button small ghost" disabled={!previous} onClick={() => previous && onVisit(previous, true)}><ArrowRight size={14} aria-hidden="true" />السابق</button>
    <button type="button" className="button small" onClick={() => onVisit(next ?? null, Boolean(next))}>{next ? 'التالي' : 'إنهاء'}<ArrowLeft size={14} aria-hidden="true" /></button>
  </section>;
}

function HandoffTool({ agentIds }: { agentIds: string[] }) {
  const agents = useWoraStore((state) => state.agents);
  const triggerHandoff = useWoraStore((state) => state.triggerHandoff);
  const [from, setFrom] = useState(agentIds[0] ?? '');
  const [to, setTo] = useState(agentIds[1] ?? '');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!agentIds.includes(from)) setFrom(agentIds[0] ?? '');
    if (!agentIds.includes(to)) setTo(agentIds[1] ?? agentIds[0] ?? '');
  }, [agentIds, from, to]);

  const valid = Boolean(from && to && from !== to && agents[from] && agents[to]);
  return <section className="campus-tool-card" aria-labelledby="campus-handoff-heading">
    <h3 id="campus-handoff-heading">أمر تحويل بين الوكلاء</h3>
    <p>يُصدر أمر حركة مسجّلًا عبر الممرات إلى قسم الوكيل المستقبل. لا يغيّر سجل المهام ولا ينشئ تقدّمًا.</p>
    <div className="campus-handoff-fields">
      <label className="label">من<select className="field" value={from} onChange={(event) => setFrom(event.target.value)}>
        {agentIds.map((id) => <option key={id} value={id}>{agents[id]?.displayName ?? id}</option>)}
      </select></label>
      <label className="label">إلى<select className="field" value={to} onChange={(event) => setTo(event.target.value)}>
        {agentIds.map((id) => <option key={id} value={id}>{agents[id]?.displayName ?? id}</option>)}
      </select></label>
    </div>
    <button
      type="button"
      className="button small"
      data-testid="office-handoff-button"
      disabled={!valid}
      onClick={() => {
        triggerHandoff(from, to);
        setNotice(`تم تسجيل أمر التحويل: ${agents[from]?.displayName ?? from} → ${agents[to]?.displayName ?? to}`);
      }}
    >تنفيذ التحويل</button>
    {notice && <p className="campus-tool-notice" role="status">{notice}</p>}
  </section>;
}

export function Campus({ roomId, tourIndex, onVisit, onAssign, onDirector }: {
  roomId: string | null; tourIndex: number | null; onVisit: (id: string | null, tour?: boolean) => void; onAssign: () => void; onDirector: () => void;
}) {
  const [view, setView] = useState<'3d' | 'space' | 'plan'>(() => supportsWebGL() ? '3d' : 'space');
  const [whole, setWhole] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reset3D, setReset3D] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const room = roomId ? ROOM_BY_ID[roomId] : undefined;
  const visiting = useOfficeMotion((state) => Boolean(state.player.targetRoomId));
  const place = useOfficeMotion((state) => locatePoint(state.player).areaId);
  const travelTo = useOfficeMotion((state) => state.visitRoom);
  const command = useWoraStore((state) => state.officeCommand);
  const following = useWoraStore((state) => state.followAgentId);
  const agents = useWoraStore((state) => state.agents);
  const workspaces = useWoraStore((state) => state.workspaces);
  const activityLog = useWoraStore((state) => state.activityLog);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const agentIds = useMemo(() => Object.keys(agents), [agents]);
  const { focusAgentCamera, focusRoomCamera, resetCamera, toggleWorkspaceHUD, toggleChat, callTeamStandup, returnAllToDesks } = useWoraStore.getState();
  const wide = whole && !following && command?.kind !== 'focus-agent';
  const working = Object.values(agents).filter(isBusyAgent).length;
  const openCount = tasks.filter((task) => (!roomId || task.zoneId === roomId) && isOpenTask(task)).length;
  const focused = !wide && (Boolean(following) || command?.kind === 'focus-agent' || (Boolean(room) && (view === '3d' || view === 'space' || command?.kind === 'focus-room')));
  const panMode = expanded && view === 'space' ? (focused ? 'room' : 'office') : null;
  const placeName = place === 'zone-lounge' && !roomId ? 'الاستقبال' : ROOM_DISPLAY[place]?.label ?? 'الممر';

  useEffect(() => {
    travelTo(roomId);
    setWhole(false);
  }, [roomId, travelTo]);
  useEffect(() => { if (view === 'plan' && roomId) focusRoomCamera(roomId); }, [view, roomId, focusRoomCamera]);
  useEffect(() => {
    if (!expanded) return;
    document.getElementById('main-content')?.scrollTo({ top: 0 });
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        setExpanded(false);
        expandButton.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [expanded]);

  useLayoutEffect(() => {
    const viewport = scene.current;
    if (panMode && viewport) viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
  }, [panMode, roomId]);

  const chooseRoom = useCallback((id: string | null) => {
    if (!id) {
      setWhole(true);
      setDrawer(null);
      onVisit(null);
      resetCamera();
      return;
    }
    setWhole(false);
    setDrawer('team');
    if (id === roomId) {
      travelTo(id);
      if (view === 'plan') focusRoomCamera(id);
    } else onVisit(id);
  }, [onVisit, roomId, travelTo, view, focusRoomCamera, resetCamera]);

  function fit() {
    if (!focused && room && view === 'plan') focusRoomCamera(room.id); else resetCamera();
    if (view === '3d') setReset3D((value) => value + 1);
    setWhole(focused);
  }

  function openTasks(nextRoomId: string | null = roomId) {
    toggleWorkspaceHUD(true, nextRoomId);
  }

  function openTeam(nextRoomId: string) {
    if (nextRoomId !== roomId) chooseRoom(nextRoomId);
    else setDrawer('team');
  }

  return <div className={`campus-workbench${expanded ? ' is-expanded' : ''}${view === '3d' ? ' is-3d' : ''}`}>
    <header className="campus-header">
      <div className="campus-heading">
        <span className="campus-kicker">WORA OPERATIONS</span>
        <div><h1>ساحة العمل</h1><ConnectionBadge /></div>
      </div>
      <div className="campus-header-actions">
        <button type="button" className="button small ghost" data-testid="campus-team-button" aria-expanded={drawer === 'team'} onClick={() => setDrawer((current) => current === 'team' ? null : 'team')}><UsersRound size={15} aria-hidden="true" />الفريق</button>
        <button type="button" className="button small ghost" data-testid="campus-activity-button" aria-expanded={drawer === 'activity'} onClick={() => setDrawer((current) => current === 'activity' ? null : 'activity')}><Radio size={15} aria-hidden="true" />النشاط</button>
        <button type="button" className="button small primary" onClick={onAssign}>إسناد مهمة</button>
      </div>
    </header>
    {!expanded && tourIndex !== null && <TourBar index={tourIndex} onVisit={onVisit} onDirector={onDirector} />}

    <section className="campus-stage" aria-label="بيئة مكتب الشركة التفاعلية">
      <div className="campus-toolbar">
        <div className="workspace-view" role="group" aria-label="طريقة عرض الساحة">
          <button type="button" className="is-3d" aria-pressed={view === '3d'} onClick={() => setView('3d')}><Box size={15} aria-hidden="true" />3D</button>
          <button type="button" aria-pressed={view === 'space'} onClick={() => setView('space')}><Layers3 size={15} aria-hidden="true" />مجسّم</button>
          <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><Map size={15} aria-hidden="true" />مخطط</button>
        </div>
        <label className="workspace-room-picker"><MapPin size={15} aria-hidden="true" /><select id="office-department-picker" aria-label="القسم" title="اختيار قسم" className="field" value={roomId ?? ''} onChange={(event) => {
          const id = event.target.value;
          if (id) chooseRoom(id); else { setDrawer(null); resetCamera(); onVisit(null); }
        }}><option value="">كل الأقسام</option>{OFFICE_ROOMS.map((item) => <option key={item.id} value={item.id}>{ROOM_DISPLAY[item.id]?.label ?? item.nameAr}</option>)}</select></label>
        <div className="campus-toolbar-actions">
          {(room || focused) && <button type="button" className="button small ghost canvas-fit" onClick={fit}>{focused ? 'عرض كامل' : 'تركيز القسم'}</button>}
          <button type="button" className="button small workspace-expand" ref={expandButton} aria-keyshortcuts={expanded ? 'Escape' : undefined} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}{expanded ? 'رجوع' : 'تكبير'}</button>
        </div>
      </div>

      <div className="campus-viewport">
        {view === '3d' ? <Suspense fallback={<div className="office3d-loading" role="status">جارٍ تحميل مكتب الشركة ثلاثي الأبعاد…</div>}>
          <Office3D
            roomId={roomId}
            resetSignal={reset3D}
            onRoom={chooseRoom}
            onAgent={focusAgentCamera}
            onViewChange={(next) => setView(next)}
            onOpenTasks={(nextRoomId) => openTasks(nextRoomId)}
            onTeam={openTeam}
            onAssign={onAssign}
          />
        </Suspense> : view === 'space' ? <div ref={scene} className="spatial-stage" data-pan={panMode ?? undefined} dir="ltr" tabIndex={panMode ? 0 : undefined} role={panMode ? 'region' : undefined} aria-label={panMode ? 'مجسّم الساحة' : undefined}><SpatialOffice room={room} wide={wide} onRoom={chooseRoom} onAgent={focusAgentCamera} /></div>
          : <OfficeFloorplan selectedRoomId={roomId} onRoom={chooseRoom} onAgent={focusAgentCamera} />}

        {drawer && <aside className="campus-drawer" data-testid="campus-drawer" aria-label={drawer === 'team' ? 'فريق القسم' : 'نشاط الجلسة'}>
          <header><strong>{drawer === 'team' ? 'الفريق وأوامر الحركة' : 'سجل النشاط المسجّل'}</strong><button type="button" className="icon-button" aria-label="إغلاق اللوحة" onClick={() => setDrawer(null)}><X size={16} aria-hidden="true" /></button></header>
          <div className="campus-drawer-body">
            {drawer === 'team' ? <>
              <section className="campus-tool-card">
                <div className="campus-tool-actions">
                  <button type="button" className="button small ghost" onClick={callTeamStandup}><UsersRound size={14} aria-hidden="true" />اجتماع الفريق</button>
                  <button type="button" className="button small ghost" onClick={returnAllToDesks}><Footprints size={14} aria-hidden="true" />عودة للمكاتب</button>
                  <button type="button" className="button small ghost" onClick={() => toggleChat(true)}>فتح المحادثة</button>
                </div>
                <p>الأوامر تُسجّل في سجل النشاط وتحرك الوكلاء عبر ممرات المكتب.</p>
              </section>
              <HandoffTool agentIds={agentIds} />
              <OfficePeople zoneId={roomId} tasks={tasks} onChat={() => toggleChat(true)} />
            </> : <section className="campus-activity-list" aria-labelledby="activity-heading">
              <h2 id="activity-heading">أحداث مسجّلة</h2>
              {activityLog.length ? <ul>{activityLog.slice(0, 12).map((event) => <li key={event.id}>
                <p dir="auto">{event.text}</p><small>{event.scope === 'session' || event.scope === 'local' ? 'محلي · ' : event.scope === 'preview' ? 'معاينة · ' : ''}<time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small>
              </li>)}</ul> : <p className="campus-empty">لا توجد أحداث مسجّلة في هذه الجلسة بعد.</p>}
              {tasks.length > 0 && <div className="campus-recorded-tasks"><h3>مهام مسجّلة</h3>{tasks.slice(0, 5).map((task) => <button type="button" key={task.id} onClick={() => openTasks(task.zoneId)}><span dir="auto">{task.title}</span><small>{taskStage(task)}</small></button>)}</div>}
            </section>}
          </div>
        </aside>}
      </div>

      <footer className="campus-footer">
        <span className="workspace-location" role="status"><MapPin size={14} aria-hidden="true" />{visiting ? `إلى ${room ? ROOM_DISPLAY[room.id]?.label : 'الاستقبال'}` : placeName}</span>
        {working > 0 && <span className="workspace-load"><span className="status-dot" /> <bdi>{working}</bdi> مشغولون الآن</span>}
        {panMode && <span className="workspace-pan-hint">مرّر يمين أو شمال</span>}
        <button type="button" className="text-link canvas-tasks" onClick={() => openTasks()}><ClipboardList size={15} aria-hidden="true" />{room ? 'مهام القسم' : 'مهام الأقسام'} <bdi>{openCount}</bdi></button>
      </footer>
    </section>
  </div>;
}
