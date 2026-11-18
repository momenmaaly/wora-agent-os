import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ClipboardList, Footprints, Layers3, Map, MapPin, Maximize2, Minimize2,
  MoreHorizontal, Plus, UsersRound,
} from 'lucide-react';
import { locatePoint, OFFICE_ROOMS, ROOM_BY_ID } from '../office/layout.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { TOUR_STOPS } from '../office/visits.js';
import { DIRECTOR_ROOM_ID, isBusyAgent, isOpenTask, localTime, officeTasks } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { ConnectionBadge, OfficePeople } from './OfficePeople.js';
import { OfficeFloorplan } from './OfficeFloorplan.js';
import { SpatialOffice } from './SpatialOffice.js';

function TourBar({ index, onVisit, onDirector }: { index: number; onVisit: (id: string | null, tour?: boolean) => void; onDirector: () => void }) {
  const next = TOUR_STOPS[index + 1];
  const previous = TOUR_STOPS[index - 1];
  return <section className="panel workspace-tour" aria-label="جولة الأقسام">
    <span aria-live="polite">الجولة <bdi>{index + 1} / {TOUR_STOPS.length}</bdi></span>
    {TOUR_STOPS[index] === DIRECTOR_ROOM_ID && <button type="button" className="button small ghost" onClick={onDirector}>فتح مكتب المدير</button>}
    <button type="button" className="button small ghost" disabled={!previous} onClick={() => previous && onVisit(previous, true)}><ArrowRight size={14} aria-hidden="true" />السابق</button>
    <button type="button" className="button small" onClick={() => onVisit(next ?? null, Boolean(next))}>{next ? 'التالي' : 'إنهاء'}<ArrowLeft size={14} aria-hidden="true" /></button>
  </section>;
}

function OfficeActivity() {
  const events = useWoraStore((state) => state.activityLog);
  if (!events.length) return null;
  return <section className="panel workspace-activity" aria-labelledby="activity-heading">
    <div className="workspace-panel-heading"><h2 id="activity-heading">نشاط الجلسة</h2></div>
    <ul>{events.slice(0, 3).map((event) => <li key={event.id}><p dir="auto">{event.text}</p><small>{event.scope === 'session' || event.scope === 'local' ? 'محلي · ' : event.scope === 'preview' ? 'معاينة · ' : ''}<time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small></li>)}</ul>
  </section>;
}

export function Campus({ roomId, tourIndex, onVisit, onAssign, onDirector }: {
  roomId: string | null; tourIndex: number | null; onVisit: (id: string | null, tour?: boolean) => void; onAssign: () => void; onDirector: () => void;
}) {
  const [view, setView] = useState<'space' | 'plan'>('space');
  const [whole, setWhole] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const { focusAgentCamera, focusRoomCamera, resetCamera, toggleWorkspaceHUD, toggleChat, callTeamStandup, returnAllToDesks } = useWoraStore.getState();
  const wide = whole && !following && command?.kind !== 'focus-agent';
  const working = Object.values(agents).filter(isBusyAgent).length;
  const openCount = tasks.filter((task) => (!roomId || task.zoneId === roomId) && isOpenTask(task)).length;
  const focused = !wide && (Boolean(following) || command?.kind === 'focus-agent' || (Boolean(room) && (view === 'space' || command?.kind === 'focus-room')));
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

  const chooseRoom = useCallback((id: string) => {
    setWhole(false);
    if (id === roomId) { travelTo(id); if (view === 'plan') focusRoomCamera(id); }
    else onVisit(id);
  }, [onVisit, roomId, travelTo, view, focusRoomCamera]);
  function fit() {
    if (!focused && room && view === 'plan') focusRoomCamera(room.id); else resetCamera();
    setWhole(focused);
  }

  return <div className={`workbench${expanded ? ' is-expanded' : ''}`}>
    <header className="workbench-header">
      <div className="workbench-title"><h1>ساحة العمل</h1><ConnectionBadge /></div>
      <button type="button" className="button primary workspace-assign" onClick={onAssign}><Plus size={17} aria-hidden="true" />إسناد مهمة</button>
    </header>
    {!expanded && tourIndex !== null && <TourBar index={tourIndex} onVisit={onVisit} onDirector={onDirector} />}
    <div className="workbench-grid">
      <section className="panel workspace-canvas" aria-label="خريطة ساحة العمل">
        <div className="workspace-toolbar">
          <div className="workspace-view" role="group" aria-label="طريقة عرض الساحة">
            <button type="button" aria-pressed={view === 'space'} onClick={() => setView('space')}><Layers3 size={16} aria-hidden="true" />مجسّم</button>
            <button type="button" aria-pressed={view === 'plan'} onClick={() => setView('plan')}><Map size={16} aria-hidden="true" />مخطط</button>
          </div>
          <label className="workspace-room-picker"><MapPin size={16} aria-hidden="true" /><select id="office-department-picker" aria-label="القسم" title="اختيار قسم" className="field" value={roomId ?? ''} onChange={(event) => {
            const id = event.target.value;
            if (id) chooseRoom(id); else { resetCamera(); onVisit(null); }
          }}><option value="">كل الأقسام</option>{OFFICE_ROOMS.map((item) => <option key={item.id} value={item.id}>{ROOM_DISPLAY[item.id]?.label ?? item.nameAr}</option>)}</select></label>
          <div className="workspace-canvas-controls">
            {(room || focused) && <button type="button" className="button small ghost canvas-fit" onClick={fit}>{focused ? 'عرض كامل' : 'تركيز القسم'}</button>}
            <button type="button" className="button small workspace-expand" ref={expandButton} aria-keyshortcuts={expanded ? 'Escape' : undefined} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}{expanded ? 'رجوع للحجم العادي' : 'تكبير الساحة'}</button>
          </div>
        </div>
        <div className="workspace-map">
          {view === 'space' ? <div ref={scene} className="spatial-stage" data-pan={panMode ?? undefined} dir="ltr" tabIndex={panMode ? 0 : undefined} role={panMode ? 'region' : undefined} aria-label={panMode ? 'مجسّم الساحة' : undefined}><SpatialOffice room={room} wide={wide} onRoom={chooseRoom} onAgent={focusAgentCamera} /></div>
            : <OfficeFloorplan selectedRoomId={roomId} onRoom={chooseRoom} onAgent={focusAgentCamera} />}
        </div>
        <footer className="workspace-canvas-footer">
          <span className="workspace-location" role="status"><MapPin size={15} aria-hidden="true" />{visiting ? `إلى ${room ? ROOM_DISPLAY[room.id]?.label : 'الاستقبال'}` : placeName}</span>
          {working > 0 && <span className="workspace-load"><span className="status-dot" /> <bdi>{working}</bdi> مشغولون الآن</span>}
          {panMode && <span className="workspace-pan-hint">مرّر يمين أو شمال</span>}
          <button type="button" className="text-link canvas-tasks" onClick={() => toggleWorkspaceHUD(true, roomId)}><ClipboardList size={16} aria-hidden="true" />{room ? 'مهام القسم' : 'مهام الأقسام'} <bdi>{openCount}</bdi></button>
        </footer>
      </section>
      {!expanded && <aside className="workbench-rail" aria-label="الفريق والنشاط">
        <OfficePeople zoneId={roomId} tasks={tasks} onChat={() => toggleChat(true)} />
        <details className="workspace-tools"><summary><MoreHorizontal size={17} aria-hidden="true" />أدوات الفريق</summary><div>
          <button type="button" className="button small ghost" onClick={callTeamStandup}><UsersRound size={15} aria-hidden="true" />اجتماع الفريق</button>
          <button type="button" className="button small ghost" onClick={returnAllToDesks}><Footprints size={15} aria-hidden="true" />عودة للمكاتب</button>
        </div></details>
        <OfficeActivity />
      </aside>}
    </div>
  </div>;
}
