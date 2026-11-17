import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Crosshair, LockKeyhole, Minus, Plus } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { isRoomLockedForPlan, type PlanId } from '../billing/plans.js';
import { CORRIDORS, OFFICE_ROOMS, ROOM_BY_ID, ROOM_SPOTS, WORLD_HEIGHT, WORLD_WIDTH, type Point2D } from '../office/layout.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { agentInitials, FALLBACK_ROOM_DISPLAY, ROOM_DISPLAY } from '../office/presentation.js';
import { IconButton } from './ui.js';

const CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
const FRAME = { width: WORLD_WIDTH + 120, height: WORLD_HEIGHT + 65 };

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
}

const MapTerrain = memo(function MapTerrain({ plan, selectedRoomId, onRoom, zoomed }: { plan: PlanId; selectedRoomId: string | null; onRoom: (id: string) => void; zoomed: boolean }) {
  return (
    <>
      <g className="map-corridors" aria-hidden="true">
        {Object.values(CORRIDORS).map((lane) => <rect key={lane.id} x={lane.x + 12} y={lane.y + 8} width={lane.width - 24} height={lane.height - 16} rx={13} />)}
      </g>
      <g className="map-lanes" aria-hidden="true">
        <path d="M 67 440 H 1933 M 473 57 V 1016 M 873 57 V 1016 M 1273 57 V 1016 M 1673 57 V 1016" />
        {[473, 873, 1273, 1673].map((x) => <circle key={x} cx={x} cy={440} r={12} />)}
      </g>
      {OFFICE_ROOMS.map((room) => {
        const display = ROOM_DISPLAY[room.id] ?? FALLBACK_ROOM_DISPLAY;
        const Icon = display.icon;
        const locked = isRoomLockedForPlan(room.id, plan);
        const chosen = room.id === selectedRoomId;
        return (
          <g key={room.id} role="button" tabIndex={zoomed ? -1 : 0} aria-pressed={chosen} aria-label={`${room.nameAr}${locked ? ' — Pro' : ''}`} data-map-target
            className={`map-room tone-${display.tone}${chosen ? ' is-chosen' : ''}${locked ? ' is-locked' : ''}`}
            onClick={(event) => { event.stopPropagation(); onRoom(room.id); }} onKeyDown={(event) => activate(event, () => onRoom(room.id))}>
            <rect className="room-shadow" x={room.x + 4} y={room.y + 6} width={room.width - 8} height={room.height - 8} rx={22} />
            <rect className="room-floor" x={room.x} y={room.y} width={room.width} height={room.height} rx={21} />
            <path className="room-divider" d={`M ${room.x + 16} ${room.y + 95} H ${room.x + room.width - 16}`} />
            <rect className="room-icon-bg" x={room.x + room.width - 73} y={room.y + 22} width={52} height={52} rx={14} />
            <Icon x={room.x + room.width - 62} y={room.y + 33} width={30} height={30} className="room-icon" strokeWidth={1.65} />
            <text className="room-label" x={room.x + room.width - 86} y={room.y + 61} textAnchor="start" direction="rtl">{display.label}</text>
            <text className="room-code" x={room.x + 20} y={room.y + room.height - 22}>{room.code.replace('R-', '0')}</text>
            {locked && <LockKeyhole x={room.x + 20} y={room.y + 34} width={26} height={26} className="room-lock" />}
            <g aria-hidden="true" className="room-furniture">
              {ROOM_SPOTS.filter((spot) => spot.roomId === room.id).map((spot) => (
                <g key={spot.id} transform={`translate(${spot.x} ${spot.y})`}>
                  {spot.role === 'desk' || spot.role === 'desk-alt' ? <>
                    <rect x={-35} y={-18} width={70} height={36} rx={7} />
                    <path d="M -19 -6 H 19 M -19 7 H 7" />
                    <rect x={-12} y={21} width={24} height={14} rx={5} />
                  </> : spot.role === 'meeting' || spot.role === 'lounge' ? <>
                    <circle r={18} /><path d="M -30 -8 V 8 M 30 -8 V 8" />
                  </> : <>
                    <rect x={-26} y={-15} width={52} height={30} rx={7} /><path d="M -15 0 H 15" />
                  </>}
                </g>
              ))}
              {room.y > 500 && <path d={`M ${room.x + 22} ${room.y + room.height - 82} h ${room.width - 44} M ${room.x + 22} ${room.y + room.height - 66} h ${Math.min(room.width - 44, 88)}`} />}
            </g>
            {room.doors.map((door) => {
              const horizontal = door.wall === 'north' || door.wall === 'south';
              const wall = horizontal ? (door.wall === 'north' ? room.y : room.y + room.height) : (door.wall === 'west' ? room.x : room.x + room.width);
              return <line key={door.id} className="room-door" x1={horizontal ? door.from : wall} x2={horizontal ? door.to : wall} y1={horizontal ? wall : door.from} y2={horizontal ? wall : door.to} />;
            })}
          </g>
        );
      })}
    </>
  );
});

export function OfficeFloorplan({ expanded, selectedRoomId, onRoom, onAgent }: { expanded?: boolean; selectedRoomId: string | null; onRoom: (id: string) => void; onAgent: (id: string) => void }) {
  const id = useId();
  const agents = useWoraStore((s) => s.agents);
  const selectedAgentId = useWoraStore((s) => s.selectedAgentId);
  const followId = useWoraStore((s) => s.followAgentId);
  const command = useWoraStore((s) => s.officeCommand);
  const reset = useWoraStore((s) => s.resetCamera);
  const setFollow = useWoraStore((s) => s.setFollowAgent);
  const plan = useBillingStore((s) => s.plan);
  const { markers, player, movePlayer } = useOfficeMotion();
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point2D>(CENTER);
  const drag = useRef<{ x: number; y: number; center: Point2D; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const activeCenter = followId ? markers[followId] ?? center : center;
  const zoomed = zoom > 1;
  const width = FRAME.width / zoom;
  const height = FRAME.height / zoom;
  const viewBox = `${activeCenter.x - width / 2} ${activeCenter.y - height / 2} ${width} ${height}`;

  useEffect(() => {
    if (!followId) return;
    setZoom((value) => Math.max(1.65, value));
  }, [followId]);

  useEffect(() => {
    if (!command) return;
    if (command.kind === 'reset-camera') { setZoom(1); setCenter(CENTER); }
    if (!expanded) return;
    if (command.kind === 'focus-room') {
      const room = ROOM_BY_ID[command.roomId];
      if (room) { setCenter({ x: room.x + room.width / 2, y: room.y + room.height / 2 }); setZoom(1.8); }
    } else if (command.kind === 'focus-agent') {
      const marker = useOfficeMotion.getState().markers[command.agentId];
      if (marker) { setCenter({ x: marker.x, y: marker.y }); setZoom(1.55); }
    }
  }, [command, expanded]);

  function beginPan(event: PointerEvent<SVGSVGElement>) {
    suppressClick.current = false;
    const onTarget = (event.target as Element).closest('[data-map-target]');
    if (!event.shiftKey && event.button !== 1 && !(zoom > 1 && !onTarget)) return;
    drag.current = { x: event.clientX, y: event.clientY, center: { x: activeCenter.x, y: activeCenter.y }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) return;
    const delta = { x: event.clientX - start.x, y: event.clientY - start.y };
    if (!start.moved && Math.hypot(delta.x, delta.y) < 4) return;
    const matrix = event.currentTarget.getScreenCTM();
    start.moved = true;
    suppressClick.current = true;
    if (followId) setFollow(null);
    setCenter({ x: Math.max(50, Math.min(WORLD_WIDTH - 50, start.center.x - delta.x / (matrix?.a || 1))), y: Math.max(25, Math.min(WORLD_HEIGHT - 25, start.center.y - delta.y / (matrix?.d || 1))) });
  }

  return (
    <div className={`map-canvas${expanded ? ' map-canvas-expanded' : ''}`}>
      <div className="map-coordinate" dir="ltr"><span>WORA HQ</span><i /> FLOOR 01</div>
      <div className="map-controls" aria-label="تحكم الخريطة">
        <IconButton icon={Plus} label="تكبير الخريطة" disabled={zoom >= 2.65} onClick={() => setZoom((value) => Math.min(2.65, value * 1.22))} />
        <IconButton icon={Minus} label="تصغير الخريطة" disabled={zoom <= 1} onClick={() => { const next = Math.max(1, zoom / 1.22); setZoom(next); if (next === 1) { setFollow(null); setCenter(CENTER); } }} />
        <IconButton icon={Crosshair} label="توسيط الخريطة" onClick={reset} />
      </div>
      <svg className="map-diagram" viewBox={viewBox} preserveAspectRatio={expanded ? 'xMidYMid meet' : 'none'} aria-labelledby={`${id}-title`} style={{ direction: 'ltr', touchAction: zoom > 1 ? 'none' : 'pan-y' }}
        onPointerDown={beginPan} onPointerMove={pan} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onClick={(event) => {
          if (!expanded || suppressClick.current) return;
          const frame = event.currentTarget.getScreenCTM()?.inverse();
          if (!frame) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(frame);
          movePlayer(point);
        }}>
        <title id={`${id}-title`}>خريطة مقر Wora — عشرة أقسام مترابطة</title>
        <MapTerrain plan={plan} selectedRoomId={selectedRoomId} onRoom={onRoom} zoomed={zoomed} />
        {Object.entries(markers).filter(([agentId, marker]) => !!agents[agentId] && marker.path.length).map(([agentId, marker]) => (
          <polyline key={agentId} className="map-route" points={[marker, ...marker.path].map((point) => `${point.x},${point.y}`).join(' ')} aria-hidden="true" />
        ))}
        {expanded && <g className="player-marker" transform={`translate(${player.x} ${player.y})`} aria-hidden="true"><circle r={22} /><circle r={8} /><text x={0} y={-32} textAnchor="middle">أنت</text></g>}
        {Object.values(agents).map((agent) => {
          const marker = markers[agent.id];
          if (!marker) return null;
          const isSelected = selectedAgentId === agent.id;
          const label = agent.displayName.length > 14 ? `${agent.displayName.slice(0, 13)}…` : agent.displayName;
          const labelWidth = Math.max(99, 20 + label.length * 16);
          return (
            <g className={`agent-marker${isSelected ? ' marker-selected' : ''}`} key={agent.id} transform={`translate(${marker.x} ${marker.y + 24})${expanded ? '' : ' scale(1 1.17)'}`}
              role="button" tabIndex={zoomed ? -1 : 0} aria-pressed={isSelected} aria-label={`تحديد ${agent.displayName}`} data-map-target
              style={{ '--agent-color': agent.profile.avatarColor } as React.CSSProperties}
              onClick={(event) => { event.stopPropagation(); onAgent(agent.id); }} onKeyDown={(event) => activate(event, () => onAgent(agent.id))}>
              <circle className="marker-halo" r={35} />
              <circle className="marker-center" r={27} />
              <text className="marker-initials" y={8} textAnchor="middle" direction="ltr">{agentInitials(agent)}</text>
              <g transform="translate(0 39)">
                <rect className="marker-name-bg" x={-labelWidth / 2} y={0} width={labelWidth} height={38} rx={10} />
                <text className="marker-name" y={26} textAnchor="middle" direction="ltr">{label}</text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
