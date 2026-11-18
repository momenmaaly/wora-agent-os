import { memo, useId, type CSSProperties, type KeyboardEvent } from 'react';
import { CORRIDORS, locatePoint, OFFICE_ROOMS, ROOM_SPOTS, WORLD_HEIGHT, WORLD_WIDTH, type OfficeRoom, type Point2D, type RoomSpot } from '../office/layout.js';
import { agentInitials, ROOM_DISPLAY } from '../office/presentation.js';
import { outline, points, project, roomCamera, SCENE_FRAME } from '../office/spatial.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { useWoraStore } from '../store/useWoraStore.js';

const MATERIALS = {
  stone: ['#3d4d55', '#27363d', '#303e47'],
  wall: ['#556670', '#3a4b53', '#4c5d66'],
  glass: ['#7a9298', '#374e56', '#5a747c'],
  oak: ['#b58b6e', '#694f54', '#856060'],
  device: ['#4a5964', '#23333b', '#394950'],
  textile: ['var(--spatial-tint)', 'var(--spatial-side)', 'var(--spatial-fabric)'],
} as const;

function Solid({ x, y, w, d, h, z = 0, material = 'stone' }: { x: number; y: number; w: number; d: number; h: number; z?: number; material?: keyof typeof MATERIALS }) {
  const [, b, c, e] = outline(x, y, w, d, z);
  const [A, B, C, E] = outline(x, y, w, d, z + h);
  const [top, side, front] = MATERIALS[material];
  return <g>
    <polygon points={points([B, b, c, C])} fill={side} />
    <polygon points={points([E, C, c, e])} fill={front} />
    <polygon points={points([A, B, C, E])} fill={top} className="spatial-top-edge" />
  </g>;
}

function Surface({ x, y, w, d, z = 0, fill, className }: { x: number; y: number; w: number; d: number; z?: number; fill?: string; className?: string }) {
  return <polygon points={points(outline(x, y, w, d, z))} fill={fill} className={className} />;
}

function Rail({ x, y, toX, toY, z = 0, className }: { x: number; y: number; toX: number; toY: number; z?: number; className: string }) {
  const a = project(x, y, z), b = project(toX, toY, z);
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={className} />;
}

function Plant({ x, y }: { x: number; y: number }) {
  const p = project(x, y, 28);
  return <g>
    <Solid x={x - 13} y={y - 13} w={26} d={26} h={22} material="device" />
    <g transform={`translate(${p.x} ${p.y})`}>
      <path d="M0 5 Q-2 -24 -8 -36 M0 -2 Q13 -14 17 -28" stroke="#a29378" strokeWidth={2} fill="none" />
      <path d="M-5 -16 Q-28 -14 -25 -33 Q-9 -36 -5 -16 M-4 -29 Q-19 -39 -13 -50 Q4 -48 -4 -29 M0 -17 Q3 -43 18 -39 Q24 -24 0 -17 M4 -10 Q10 -28 25 -24 Q27 -11 4 -10" fill="#6baa90" stroke="#345449" strokeWidth={1.9} />
    </g>
  </g>;
}

function Screen({ x, y, w, z, h, kind }: { x: number; y: number; w: number; z: number; h: number; kind: OfficeRoom['kind'] }) {
  const face = (left: number, bottom: number, width: number, height: number, fill: string, key?: number) => <polygon key={key} fill={fill} points={points([
    project(x + left, y + 11, z + bottom), project(x + left + width, y + 11, z + bottom),
    project(x + left + width, y + 11, z + bottom + height), project(x + left, y + 11, z + bottom + height),
  ])} />;
  return <g>
    <Solid x={x} y={y} w={w} d={10} h={h} z={z} material="device" />
    {face(5, 5, w - 10, h - 9, '#1b2033')}
    {kind === 'analytics' ? [6, 11, 15, 12, 21].map((bar, i) => face(9 + (w - 18) * i / 5, 9, (w - 19) / 6.5, bar, i === 4 ? '#e0c9fa' : '#88d0ba', i))
      : kind === 'design' ? <>{face(9, 10, w * .33, h - 22, '#b691e0')}{face(w * .56, 10, w * .24, 6, '#e6b59e')}{face(w * .56, 19, w * .31, 6, '#ecb2d8')}</>
        : (kind === 'planning' || kind === 'marketing') && w > 50 ? ['#d9bd92', '#9c8ad8', '#85beb0', '#e1a8c9'].map((color, i) => face(10 + (i % 2) * 24, 11 + Math.floor(i / 2) * 16, 19, 11, color, i))
          : ['var(--spatial-accent)', '#9a8ee0', '#92c7b9'].map((color, i) => face(11, h - 11 - i * 7, w * (i === 1 ? .42 : .59), 2.7, color, i))}
  </g>;
}

function Seat({ x, y, facingUp = false, wide = false }: { x: number; y: number; facingUp?: boolean; wide?: boolean }) {
  const w = wide ? 68 : 30;
  return <g>
    <Solid x={x - w / 2} y={y - 16} w={w} d={32} h={19} material="textile" />
    <Solid x={x - w / 2} y={y + (facingUp ? 9 : -16)} w={w} d={8} h={20} z={19} material="textile" />
  </g>;
}

function Workstation({ spot, room }: { spot: RoomSpot; room: OfficeRoom }) {
  const { x, y, facing } = spot;
  const up = facing !== 'down';
  return <g>
    {!up && <Seat x={x} y={y - 39} />}
    <Solid x={x - 39} y={y - 24} w={78} d={49} h={22} material="oak" />
    <Screen x={x - 24} y={y - 16} w={48} z={25} h={34} kind={room.kind} />
    <Surface x={x - 17} y={y + 4} w={35} d={12} z={23} fill="#d1c5dd" />
    <Solid x={x + 26} y={y + 10} w={8} d={8} h={9} z={23} material="textile" />
    {up && <Seat x={x} y={y + 42} facingUp />}
  </g>;
}

function Furnishing({ spot, room }: { spot: RoomSpot; room: OfficeRoom }) {
  const { x, y, role } = spot;
  if (role === 'desk' || role === 'desk-alt') return <Workstation spot={spot} room={room} />;
  if (role === 'meeting') return <Seat x={x} y={y} facingUp={spot.facing === 'up'} />;
  if (role === 'lounge') return <Seat x={x} y={y} wide facingUp={y > 700} />;
  if (role === 'board') return room.kind === 'engineering' ? <g>
    <Solid x={x - 23} y={y - 18} w={45} d={36} h={74} material="device" />
    {[12, 24, 36, 48, 60].map((z) => <Rail key={z} x={x - 15} y={y + 19} toX={x + 14} toY={y + 19} z={z} className="spatial-screen-led" />)}
  </g> : <g>
    <Solid x={x - 39} y={y - 17} w={78} d={28} h={10} material="wall" />
    <Screen x={x - 35} y={y - 10} w={70} z={12} h={48} kind={room.kind} />
  </g>;
  if (role === 'reception' || role === 'coffee') return <g>
    <Solid x={x + (role === 'reception' ? 12 : -35)} y={y - 19} w={role === 'reception' ? 115 : 70} d={43} h={37} material="oak" />
    <Solid x={x + 24} y={y - 6} w={15} d={18} h={15} z={37} material="device" />
    {role === 'reception' && <Rail x={x + 19} y={y + 25} toX={x + 118} toY={y + 25} z={7} className="spatial-lamp" />}
  </g>;
  if (role === 'showcase' || role === 'stage') return <g>
    <Solid x={x - 35} y={y - 25} w={70} d={52} h={15} material="textile" />
    <Solid x={x - 21} y={y - 8} w={18} d={23} h={22} z={15} material="oak" />
    <Solid x={x + 7} y={y - 10} w={19} d={17} h={31} z={15} material="device" />
  </g>;
  return <g>
    <Solid x={x - 37} y={y - 25} w={74} d={44} h={24} material="oak" />
    <Surface x={x - 22} y={y - 10} w={26} d={20} z={25} fill="#f8dfbf" />
    <Surface x={x + 9} y={y - 7} w={17} d={18} z={25} fill="var(--spatial-accent)" />
  </g>;
}

function wallParts(room: OfficeRoom, wall: 'north' | 'west') {
  const doors = room.doors.filter((door) => door.wall === wall).sort((a, b) => a.from - b.from);
  const origin = wall === 'north' ? room.x : room.y;
  const end = origin + (wall === 'north' ? room.width : room.height);
  return [...doors.map((door, i) => [i === 0 ? origin : doors[i - 1]!.to, door.from] as const), [doors.at(-1)?.to ?? origin, end] as const].filter(([from, to]) => to - from > 8);
}

function Interior({ room }: { room: OfficeRoom }) {
  const { x, y, width: w, height: d } = room;
  const spots = ROOM_SPOTS.filter((spot) => spot.roomId === room.id).sort((a, b) => project(a.x, a.y).y - project(b.x, b.y).y);
  return <g aria-hidden="true">
    <Solid x={x} y={y} w={w} d={d} h={9} z={-9} />
    <Surface x={x + 2} y={y + 2} w={w - 4} d={d - 4} className="spatial-room-floor" />
    {Array.from({ length: Math.floor(d / 27) }, (_, i) => <Rail key={i} x={x + 3} y={y + 25 + i * 27} toX={x + w - 3} toY={y + 25 + i * 27} className="spatial-floor-seam" />)}
    <Surface x={x + 34} y={y + 62} w={w - 68} d={room.kind === 'lounge' ? 295 : d - 126} className="spatial-rug" />
    {wallParts(room, 'north').map(([from, to]) => <g key={from}>
      <Solid x={from} y={y} w={to - from} d={13} h={76} material="wall" />
      {to - from > 32 && <Rail x={from + 14} y={y + 14} toX={to - 14} toY={y + 14} z={60} className="spatial-lamp" />}
      {Array.from({ length: Math.floor((to - from) / 48) }, (_, k) => <Solid key={k} x={from + 9 + k * 48} y={y + 10} w={32} d={5} h={37} z={14} material="glass" />)}
    </g>)}
    {wallParts(room, 'west').map(([from, to]) => <Solid key={from} x={x} y={from} w={11} d={to - from} h={37} material="glass" />)}
    {room.doors.map((door) => {
      const horizontal = door.wall === 'north' || door.wall === 'south';
      const edge = horizontal ? y + (door.wall === 'south' ? d : 0) : x + (door.wall === 'east' ? w : 0);
      return horizontal ? <Rail key={door.id} x={door.from} y={edge} toX={door.to} toY={edge} className="spatial-threshold" /> : <Rail key={door.id} x={edge} y={door.from} toX={edge} toY={door.to} className="spatial-threshold" />;
    })}
    <Plant x={x + w - 27} y={y + 55} />
    {room.kind === 'boardroom' && <Solid x={x + 48} y={y + 117} w={w - 96} d={77} h={28} material="oak" />}
    {spots.map((spot) => <Furnishing key={spot.id} spot={spot} room={room} />)}
    {room.kind === 'lounge' && <Plant x={x + 36} y={y + d - 36} />}
    <Rail x={x + 4} y={y + d - 2} toX={x + w - 4} toY={y + d - 2} className="spatial-room-edge" />
  </g>;
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
}

const Terrain = memo(function Terrain({ selectedId, close, onRoom }: { selectedId: string | null; close: boolean; onRoom: (id: string) => void }) {
  return <>
    <g aria-hidden="true">
      <Surface x={-13} y={13} w={WORLD_WIDTH + 44} d={WORLD_HEIGHT + 43} z={-37} className="spatial-ground-shadow" />
      <Solid x={0} y={0} w={WORLD_WIDTH} d={WORLD_HEIGHT} h={36} z={-37} />
      <Surface x={0} y={0} w={WORLD_WIDTH} d={WORLD_HEIGHT} fill="#33454e" />
      {Object.values(CORRIDORS).map((corridor) => <Surface key={corridor.id} {...corridor} w={corridor.width} d={corridor.height} fill="#475860" />)}
      <Rail x={48} y={440} toX={1952} toY={440} className="spatial-hall-line" />
      {[473, 873, 1273, 1673].map((x) => <Rail key={x} x={x} y={54} toX={x} toY={1028} className="spatial-hall-line" />)}
      {[96, 470, 874, 1274, 1674, 1917].map((x) => <Surface key={x} x={x} y={495} w={35} d={7} fill="#d9b184" />)}
    </g>
    {OFFICE_ROOMS.map((room) => {
      const chosen = room.id === selectedId;
      const { icon: Icon, label, tone } = ROOM_DISPLAY[room.id]!;
      const p = project(room.x + room.width / 2, room.y + room.height - 20, room.y < 440 ? 5 : 3);
      const clickable = !close || chosen;
      return <g className={`spatial-room space-${tone}${chosen ? ' is-current' : ''}${close && !chosen && selectedId ? ' is-muted' : ''}`} key={room.id}
        {...(clickable ? { role: 'button', tabIndex: 0, 'aria-label': `دخول ${room.nameAr}`, 'aria-pressed': chosen } : { 'aria-hidden': true })}
        data-room={room.id} onClick={() => { if (clickable) onRoom(room.id); }} onKeyDown={(event) => { if (clickable) activate(event, () => onRoom(room.id)); }}>
        <Interior room={room} />
        {!close && <g className="spatial-room-label" transform={`translate(${p.x} ${p.y})`} aria-hidden="true">
          <rect x={-102} y={-25} width={204} height={51} rx={12} />
          <Icon x={66} y={-13} width={26} height={26} />
          <text x={-8} y={10} textAnchor="middle" direction="rtl">{label}</text>
        </g>}
      </g>;
    })}
  </>;
});

const center = { x: SCENE_FRAME.width / 2, y: SCENE_FRAME.height / 2 };

export function SpatialOffice({ room, wide, onRoom, onAgent }: { room?: OfficeRoom; wide: boolean; onRoom: (id: string) => void; onAgent: (id: string) => void }) {
  const titleId = useId();
  const player = useOfficeMotion((state) => state.player);
  const markers = useOfficeMotion((state) => state.markers);
  const agents = useWoraStore((state) => state.agents);
  const active = useWoraStore((state) => state.selectedAgentId);
  const follow = useWoraStore((state) => state.followAgentId);
  const command = useWoraStore((state) => state.officeCommand);
  const trackingId = follow ?? (command?.kind === 'focus-agent' ? command.agentId : null);
  const tracked = trackingId ? markers[trackingId] : undefined;
  const close = !wide && player.path.length === 0;
  const camera = close && tracked ? { center: project(tracked.x, tracked.y, 16), scale: 2.25 } : close && room ? roomCamera(room) : { center, scale: 1 };
  const selectedId = tracked && camera.scale > 1 ? locatePoint(tracked).room?.id ?? null : room?.id ?? null;
  const viewport = `translate(${center.x - camera.center.x * camera.scale}px, ${center.y - camera.center.y * camera.scale}px) scale(${camera.scale})`;
  const guest = project(player.x, player.y);
  const route = player.path.length ? points([player, ...player.path].map(({ x, y }) => project(x, y, 4))) : '';

  return <svg className="spatial-svg" viewBox={`0 0 ${SCENE_FRAME.width} ${SCENE_FRAME.height}`} aria-labelledby={titleId} role="group" style={{ direction: 'ltr' }}>
    <title id={titleId}>مجسّم مقر Wora — اختر قسماً لتزوره</title>
    <g className={`spatial-camera${follow ? ' is-following' : ''}`} style={{ transform: viewport }}>
      <Terrain selectedId={selectedId} close={camera.scale > 1} onRoom={onRoom} />
      {route && <polyline className="spatial-guest-route" points={route} aria-hidden="true" />}
      {Object.entries(markers).map(([id, marker]) => marker.path.length && agents[id] ? <polyline key={id} className="spatial-agent-route" points={points([marker, ...marker.path].map(({ x, y }) => project(x, y, 3)))} aria-hidden="true" /> : null)}
      {Object.entries(markers).map(([id, point]) => {
        const agent = agents[id];
        if (!agent) return null;
        const p = project(point.x, point.y);
        const inside = Math.abs(p.x - camera.center.x) < (SCENE_FRAME.width / 2 - 86) / camera.scale && Math.abs(p.y - camera.center.y) < (SCENE_FRAME.height / 2 - 96) / camera.scale;
        const showName = inside && (camera.scale > 1 || id === active);
        const busy = agent.lifecycleState === 'RESPONDING' || agent.lifecycleState === 'THINKING';
        return <g className={`spatial-agent${id === active ? ' is-active' : ''}`} key={id} transform={`translate(${p.x} ${p.y})`}
          {...(inside ? { role: 'button', tabIndex: 0, 'aria-label': `تحديد ${agent.displayName}`, 'aria-pressed': id === active } : { 'aria-hidden': true })}
          style={{ '--spatial-agent-color': agent.profile.avatarColor } as CSSProperties}
          onClick={() => onAgent(id)} onKeyDown={(event) => activate(event, () => onAgent(id))}>
          <ellipse rx={23} ry={11} className="spatial-person-shadow" />
          <path d="M-12 -6 L-12 -23 Q0 -37 12 -23 V-6 Q0 1 -12 -6" className="spatial-agent-body" />
          <circle cy={-43} r={17} className="spatial-agent-face" />
          <text y={-38} textAnchor="middle" className="spatial-initials">{agentInitials(agent)}</text>
          <circle cx={13} cy={-54} r={5} className={`spatial-agent-status${busy ? ' is-busy' : ''}`} />
          {showName && <text className="spatial-agent-name" y={-68} textAnchor="middle">{agent.displayName}</text>}
        </g>;
      })}
      <g className="spatial-guest" transform={`translate(${guest.x} ${guest.y})`} aria-hidden="true">
        <ellipse rx={29} ry={15} className="spatial-guest-glow" />
        <path d="M0 0 C-9 -14 -20 -20 -20 -35 A20 20 0 0 1 20 -35 C20 -20 9 -14 0 0Z" />
        <circle cy={-35} r={7} />
        <text y={-63} textAnchor="middle" direction="rtl">أنت</text>
      </g>
    </g>
  </svg>;
}
