import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Crosshair,
  Footprints,
  Coffee,
  UsersRound,
  MapPin,
  Sparkles,
  Eye,
  EyeOff,
  Move,
} from 'lucide-react';
import { useWoraStore, type AgentActivityKind } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  OFFICE_ROOMS,
  CORRIDORS,
  ROOM_SPOTS,
  SPOT_BY_ID,
  getAgentHomeSpot,
  computeOfficePath,
  locatePoint,
  PROVIDER_VISUALS,
  formatShortModel,
} from '../office/layout.js';
import type { Point2D } from '../office/layout.js';
import type { AgentParticipant } from '../types.js';
import { BrainProvider } from '../types.js';

// ─── TYPES ──────────────────────────────────────────────────
interface MovableAgent {
  id:         string;
  x:          number;
  y:          number;
  path:       Point2D[];
  targetRoomId: string | null;
  activity:   AgentActivityKind;
  isWalking:  boolean;
  facing:     number; // degrees
  bubble?:    string | null;
}

// ─── CONSTANTS ──────────────────────────────────────────────
const AGENT_SPEED      = 110; // px/sec
const USER_SPEED       = 140;
const AUTO_ROAM_MIN_MS = 7000;
const AUTO_ROAM_MAX_MS = 14000;

// ─── HELPERS ────────────────────────────────────────────────
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

function roomCenter(roomId: string): Point2D {
  const r = OFFICE_ROOMS.find((x) => x.id === roomId);
  if (!r) return { x: 800, y: 460 };
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// ─── MAIN COMPONENT ─────────────────────────────────────────
export function OfficeFloorplan() {
  const agents         = useWoraStore((s) => s.agents);
  const zones          = useWoraStore((s) => s.zones);
  const selectedId     = useWoraStore((s) => s.selectedAgentId);
  const followId       = useWoraStore((s) => s.followAgentId);
  const selectAgent    = useWoraStore((s) => s.selectAgent);
  const setFollowAgent = useWoraStore((s) => s.setFollowAgent);
  const openModelSwap  = useWoraStore((s) => s.openModelSwap);
  const dispatchToRoom = useWoraStore((s) => s.dispatchAgentToRoom);
  const officeCommand  = useWoraStore((s) => s.officeCommand);
  const setAgentLoc    = useWoraStore((s) => s.setAgentLocation);
  const autoRoam       = useWoraStore((s) => s.ui.autoRoam);
  const theme          = useWoraStore((s) => s.ui.theme);
  const localPos       = useWoraStore((s) => s.localPosition);
  const pushActivity   = useWoraStore((s) => s.pushActivity);
  const { movePlayer } = useSocket();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  // Camera
  const [scale, setScale]   = useState(1);
  const [pan, setPan]       = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // User avatar
  const [userPos, setUserPos]   = useState<Point2D>({ x: localPos.x, y: localPos.z });
  const [userPath, setUserPath] = useState<Point2D[]>([]);
  const [userFacing, setUserFacing] = useState(0);
  const keysRef = useRef<Set<string>>(new Set());

  // Agents movable state
  const [movables, setMovables] = useState<Record<string, MovableAgent>>(() => {
    const init: Record<string, MovableAgent> = {};
    for (const ag of Object.values(agents)) {
      const spot = getAgentHomeSpot(ag);
      init[ag.id] = {
        id: ag.id, x: spot.x, y: spot.y, path: [], targetRoomId: null,
        activity: 'desk', isWalking: false, facing: 0, bubble: null,
      };
    }
    return init;
  });

  // Sync when new agents hired
  useEffect(() => {
    setMovables((prev) => {
      const next = { ...prev };
      for (const ag of Object.values(agents)) {
        if (!next[ag.id]) {
          // newly hired — spawn at reception lounge
          const reception = SPOT_BY_ID['lng-reception'];
          const homeSpot  = getAgentHomeSpot(ag);
          const path = reception ? computeOfficePath({ x: reception.x, y: reception.y }, homeSpot.id) : [];
          next[ag.id] = {
            id: ag.id, x: reception?.x ?? 800, y: reception?.y ?? 774,
            path, targetRoomId: homeSpot.roomId, activity: 'walking', isWalking: true, facing: 0,
          };
        }
      }
      // remove gone agents
      for (const id of Object.keys(next)) if (!agents[id]) delete next[id];
      return next;
    });
  }, [agents]);

  // Keep userPos in sync with store localPosition (for preview)
  useEffect(() => {
    setUserPos({ x: localPos.x, y: localPos.z });
  }, [localPos.x, localPos.z]);

  // ─── COMMAND HANDLER ────────────────────────────────────
  useEffect(() => {
    if (!officeCommand) return;
    const cmd = officeCommand;

    if (cmd.kind === 'dispatch-room') {
      const cur = movables[cmd.agentId];
      if (!cur) return;
      const targetSpots = ROOM_SPOTS.filter((s) => s.roomId === cmd.roomId);
      const spot = targetSpots.find((s) => s.role === 'desk') ?? targetSpots[0];
      if (!spot) return;
      const path = computeOfficePath({ x: cur.x, y: cur.y }, spot.id);
      setMovables((prev) => ({
        ...prev,
        [cmd.agentId]: {
          ...prev[cmd.agentId]!,
          path,
          targetRoomId: cmd.roomId,
          activity: (cmd.activity as AgentActivityKind) ?? 'walking',
          isWalking: path.length > 0,
          bubble: cmd.reasonAr ?? null,
        },
      }));
      setTimeout(() => {
        setMovables((p) => {
          const m = p[cmd.agentId];
          if (m) return { ...p, [cmd.agentId]: { ...m, bubble: null } };
          return p;
        });
      }, 3200);
    } else if (cmd.kind === 'standup') {
      const seats = ROOM_SPOTS.filter((s) => s.roomId === 'zone-boardroom' && s.role === 'meeting');
      const ids = Object.keys(movables);
      setMovables((prev) => {
        const next = { ...prev };
        ids.forEach((id, i) => {
          const seat = seats[i % seats.length];
          if (!seat) return;
          const cur = prev[id]!;
          next[id] = {
            ...cur,
            path: computeOfficePath({ x: cur.x, y: cur.y }, seat.id),
            targetRoomId: 'zone-boardroom',
            activity: 'meeting',
            isWalking: true,
            bubble: 'اجتماع عام',
          };
        });
        return next;
      });
    } else if (cmd.kind === 'return-desks') {
      setMovables((prev) => {
        const next = { ...prev };
        for (const ag of Object.values(agents)) {
          const cur = prev[ag.id];
          if (!cur) continue;
          const home = getAgentHomeSpot(ag);
          next[ag.id] = {
            ...cur,
            path: computeOfficePath({ x: cur.x, y: cur.y }, home.id),
            targetRoomId: home.roomId,
            activity: 'desk',
            isWalking: true,
            bubble: 'عودة للمكتب',
          };
        }
        return next;
      });
    } else if (cmd.kind === 'handoff') {
      const fromId = cmd.fromAgentId ?? Object.keys(movables)[0];
      const toId   = cmd.toAgentId   ?? Object.keys(movables)[1];
      if (!fromId || !toId) return;
      const from = movables[fromId];
      const to   = movables[toId];
      if (!from || !to) return;
      // from walks to to's current room
      const toLoc = locatePoint({ x: to.x, y: to.y });
      const roomId = toLoc.isRoom ? toLoc.areaId : (to.targetRoomId ?? 'zone-lounge');
      const spots = ROOM_SPOTS.filter((s) => s.roomId === roomId);
      const spot = spots.find((s) => s.role === 'collab') ?? spots[0];
      if (!spot) return;
      setMovables((prev) => ({
        ...prev,
        [fromId]: {
          ...prev[fromId]!,
          path: computeOfficePath({ x: from.x, y: from.y }, spot.id),
          targetRoomId: roomId,
          activity: 'collab',
          isWalking: true,
          bubble: 'تسليم مهمة',
        },
      }));
      pushActivity(`تسليم مباشر بين ${agents[fromId]?.displayName ?? fromId} و ${agents[toId]?.displayName ?? toId}`, '#7c3aed');
    } else if (cmd.kind === 'spawn-at-reception') {
      const cur = movables[cmd.agentId];
      if (!cur) return;
      const homeSpots = ROOM_SPOTS.filter((s) => s.roomId === cmd.homeRoomId);
      const spot = homeSpots.find((s) => s.role === 'desk') ?? homeSpots[0];
      if (!spot) return;
      setMovables((prev) => ({
        ...prev,
        [cmd.agentId]: {
          ...prev[cmd.agentId]!,
          path: computeOfficePath({ x: prev[cmd.agentId]!.x, y: prev[cmd.agentId]!.y }, spot.id),
          targetRoomId: cmd.homeRoomId,
          activity: 'walking',
          isWalking: true,
          bubble: 'أول يوم عمل!',
        },
      }));
    } else if (cmd.kind === 'focus-room') {
      const c = roomCenter(cmd.roomId);
      setPan({ x: 800 - c.x, y: 480 - c.y });
      setScale(1.15);
    } else if (cmd.kind === 'focus-agent') {
      const m = movables[cmd.agentId];
      if (m) {
        setPan({ x: 800 - m.x, y: 480 - m.y });
        setScale(1.2);
        setFollowAgent(cmd.agentId);
      }
    } else if (cmd.kind === 'reset-camera') {
      setPan({ x: 0, y: 0 });
      setScale(1);
      setFollowAgent(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeCommand]);

  // Follow camera
  useEffect(() => {
    if (!followId) return;
    const m = movables[followId];
    if (!m) return;
    setPan({ x: 800 - m.x, y: 480 - m.y });
  }, [followId, movables]);

  // ─── AUTONOMOUS ROAMING ─────────────────────────────────
  useEffect(() => {
    if (!autoRoam) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const delay = AUTO_ROAM_MIN_MS + Math.random() * (AUTO_ROAM_MAX_MS - AUTO_ROAM_MIN_MS);
      timer = setTimeout(() => {
        if (cancelled) return;
        const ids = Object.keys(movables).filter((id) => {
          const m = movables[id];
          return m && !m.isWalking && Math.random() < 0.42;
        });
        if (ids.length === 0) { schedule(); return; }
        const pick = ids[Math.floor(Math.random() * ids.length)]!;
        const cur = movables[pick]!;
        // weighted destinations
        const roll = Math.random();
        let destRoomId: string;
        let activity: AgentActivityKind = 'walking';
        let reason = '';
        if (roll < 0.28) { destRoomId = 'zone-lounge'; activity = 'coffee'; reason = 'استراحة قهوة'; }
        else if (roll < 0.52) { destRoomId = 'zone-boardroom'; activity = 'meeting'; reason = 'اجتماع سريع'; }
        else {
          const rooms = OFFICE_ROOMS.map((r) => r.id).filter((id) => id !== locatePoint({ x: cur.x, y: cur.y }).areaId);
          destRoomId = rooms[Math.floor(Math.random() * rooms.length)]!;
          activity = Math.random() < 0.5 ? 'collab' : 'walking';
          reason = activity === 'collab' ? 'تعاون مع قسم آخر' : 'جولة في المقر';
        }
        const spots = ROOM_SPOTS.filter((s) => s.roomId === destRoomId);
        const spot = spots[Math.floor(Math.random() * spots.length)] ?? spots[0];
        if (!spot) { schedule(); return; }
        const path = computeOfficePath({ x: cur.x, y: cur.y }, spot.id);
        if (path.length === 0) { schedule(); return; }
        setMovables((prev) => ({
          ...prev,
          [pick]: { ...prev[pick]!, path, targetRoomId: destRoomId, activity, isWalking: true, bubble: reason },
        }));
        // clear bubble
        setTimeout(() => setMovables((p) => {
          const mm = p[pick]; if (!mm) return p;
          return { ...p, [pick]: { ...mm, bubble: null } };
        }), 2600);
        schedule();
      }, delay);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoRoam, movables]);

  // ─── FRAME LOOP (60 FPS) ────────────────────────────────
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(performance.now());

  useEffect(() => {
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastRef.current) / 1000);
      lastRef.current = now;

      // move agents
      setMovables((prev) => {
        let changed = false;
        const next: Record<string, MovableAgent> = { ...prev };
        for (const id of Object.keys(prev)) {
          const m = prev[id]!;
          if (m.path.length === 0) {
            if (m.isWalking) {
              changed = true;
              next[id] = { ...m, isWalking: false };
              // update store location snapshot
              const loc = locatePoint({ x: m.x, y: m.y });
              const activityFinal: AgentActivityKind =
                m.activity === 'coffee' ? 'coffee'
                : m.activity === 'meeting' ? 'meeting'
                : m.activity === 'collab' ? 'collab'
                : 'desk';
              const statusMap: Record<AgentActivityKind, string> = {
                desk: 'على المكتب', walking: 'في الممر', meeting: 'في اجتماع', collab: 'تعاون مشترك',
                coffee: 'استراحة قهوة', board: 'عند اللوحة', thinking: 'يفكر', responding: 'يرد',
              };
              setAgentLoc(id, {
                areaId: loc.areaId, areaNameAr: loc.nameAr,
                targetRoomId: null, targetRoomNameAr: null,
                isWalking: false, activity: activityFinal,
                statusTextAr: statusMap[activityFinal] ?? 'متاح',
              });
            }
            continue;
          }
          const target = m.path[0]!;
          const dx = target.x - m.x;
          const dy = target.y - m.y;
          const dist = Math.hypot(dx, dy);
          const step = AGENT_SPEED * dt;
          if (dist <= step + 1) {
            // snap to waypoint
            const remaining = m.path.slice(1);
            const nx = target.x, ny = target.y;
            const facing = dist > 0.5 ? Math.atan2(dy, dx) * 180 / Math.PI : m.facing;
            changed = true;
            next[id] = { ...m, x: nx, y: ny, path: remaining, facing, isWalking: remaining.length > 0 };
            if (remaining.length === 0) {
              // arrival — update store
              const loc = locatePoint({ x: nx, y: ny });
              const aKind: AgentActivityKind = m.activity;
              const statusMap: Record<AgentActivityKind, string> = {
                desk: 'على المكتب', walking: 'في الممر', meeting: 'في اجتماع', collab: 'تعاون مشترك',
                coffee: 'استراحة قهوة', board: 'عند اللوحة', thinking: 'يفكر', responding: 'يرد',
              };
              setAgentLoc(id, {
                areaId: loc.areaId, areaNameAr: loc.nameAr,
                targetRoomId: null, targetRoomNameAr: null,
                isWalking: false, activity: aKind, statusTextAr: statusMap[aKind] ?? 'متاح',
              });
            } else {
              const loc = locatePoint({ x: nx, y: ny });
              setAgentLoc(id, {
                areaId: loc.areaId, areaNameAr: loc.nameAr,
                targetRoomId: m.targetRoomId,
                targetRoomNameAr: m.targetRoomId ? (OFFICE_ROOMS.find((r) => r.id === m.targetRoomId)?.nameAr ?? null) : null,
                isWalking: true, activity: m.activity,
                statusTextAr: m.bubble ?? 'يتنقل عبر الممرات',
              });
            }
          } else {
            const nx = m.x + (dx / dist) * step;
            const ny = m.y + (dy / dist) * step;
            const facing = Math.atan2(dy, dx) * 180 / Math.PI;
            changed = true;
            next[id] = { ...m, x: nx, y: ny, facing };
          }
        }
        return changed ? next : prev;
      });

      // move user along path
      setUserPos((prev) => {
        if (userPath.length === 0) return prev;
        const target = userPath[0]!;
        const dx = target.x - prev.x;
        const dy = target.y - prev.y;
        const dist = Math.hypot(dx, dy);
        const step = USER_SPEED * dt;
        if (dist <= step + 1) {
          const remaining = userPath.slice(1);
          setUserPath(remaining);
          const nx = target.x, ny = target.y;
          if (dist > 0.5) setUserFacing(Math.atan2(dy, dx) * 180 / Math.PI);
          movePlayer({ x: nx, y: 0, z: ny });
          if (remaining.length === 0) {
            const loc = locatePoint({ x: nx, y: ny });
            pushActivity(`وصلت إلى ${loc.nameAr}`, '#0ea5e9');
          }
          return { x: nx, y: ny };
        }
        const nx = prev.x + (dx / dist) * step;
        const ny = prev.y + (dy / dist) * step;
        setUserFacing(Math.atan2(dy, dx) * 180 / Math.PI);
        return { x: nx, y: ny };
      });

      // WASD continuous movement (when no path queued)
      if (keysRef.current.size > 0 && userPath.length === 0) {
        const speed = USER_SPEED * dt;
        let dx = 0, dy = 0;
        if (keysRef.current.has('w') || keysRef.current.has('arrowup')) dy -= speed;
        if (keysRef.current.has('s') || keysRef.current.has('arrowdown')) dy += speed;
        if (keysRef.current.has('a') || keysRef.current.has('arrowleft')) dx -= speed;
        if (keysRef.current.has('d') || keysRef.current.has('arrowright')) dx += speed;
        if (dx !== 0 || dy !== 0) {
          setUserPos((p) => {
            const nx = clamp(p.x + dx, 60, WORLD_WIDTH - 60);
            const ny = clamp(p.y + dy, 60, WORLD_HEIGHT - 60);
            // prevent walking through walls — if new point is inside non-corridor wall area without door, block move
            // simplified: allow move but if it jumps across wall threshold without doorway, clamp to corridor
            // we keep it simple: allow free but visually walls are overlay
            if (dx !== 0 || dy !== 0) setUserFacing(Math.atan2(dy, dx) * 180 / Math.PI);
            return { x: nx, y: ny };
          });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [userPath, movePlayer, setAgentLoc, pushActivity]);

  // Keyboard listeners
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        keysRef.current.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Convert screen click to world coords
  const screenToWorld = useCallback((clientX: number, clientY: number): Point2D | null => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return null;
    const rect = container.getBoundingClientRect();
    const vbW = WORLD_WIDTH * scale;
    const vbH = WORLD_HEIGHT * scale;
    const viewX = (WORLD_WIDTH - vbW) / 2 - pan.x * scale;
    const viewY = (WORLD_HEIGHT - vbH) / 2 - pan.y * scale;
    // Actually we use viewBox transform: viewBox = `${-pan.x} ${-pan.y} ${WORLD_WIDTH/scale} ${WORLD_HEIGHT/scale}`? Simpler: use SVG CTM
    // We'll compute via SVG point
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return { x: clamp(p.x, 0, WORLD_WIDTH), y: clamp(p.y, 0, WORLD_HEIGHT) };
  }, [pan, scale]);

  const handleFloorClick = useCallback((e: React.MouseEvent) => {
    // ignore if clicking on agent UI (bubbles stop propagation)
    const w = screenToWorld(e.clientX, e.clientY);
    if (!w) return;
    // If clicking an agent's spot, select agent instead — handled by agent click handler
    // Otherwise move user
    if (selectedId) {
      // if an agent is selected, clicking floor moves that agent
      const spots = ROOM_SPOTS.filter((s) => Math.hypot(s.x - w.x, s.y - w.y) < 44);
      if (spots.length > 0) {
        const spot = spots[0]!;
        dispatchToRoom(selectedId, spot.roomId, `يتجه إلى ${spot.labelAr}`);
        return;
      }
      // clicking a room center also dispatches
      const loc = locatePoint(w);
      if (loc.isRoom && loc.room) {
        dispatchToRoom(selectedId, loc.room.id);
        return;
      }
    }
    // default: move user avatar through corridors
    const path = computeOfficePath(userPos, w);
    const finalPath = path.length > 0 ? path : [w];
    setUserPath(finalPath);
    const loc = locatePoint(w);
    pushActivity(`تتحرك إلى ${loc.nameAr}`, '#0ea5e9');
  }, [screenToWorld, selectedId, dispatchToRoom, userPos, pushActivity]);

  const handleAgentClick = useCallback((agent: AgentParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    selectAgent(agent.id);
  }, [selectAgent]);

  // Zoom controls
  const zoomIn  = () => setScale((s) => clamp(s * 1.25, 0.6, 2.4));
  const zoomOut = () => setScale((s) => clamp(s / 1.25, 0.6, 2.4));
  const resetView = () => { setScale(1); setPan({ x: 0, y: 0 }); setFollowAgent(null); };

  // Pan handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // middle/right or shift+drag for pan
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      (e.target as Element).setPointerCapture(e.pointerId);
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isPanning || !panStartRef.current) return;
    const dx = (e.clientX - panStartRef.current.x) / scale;
    const dy = (e.clientY - panStartRef.current.y) / scale;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  };
  const onPointerUp = () => {
    setIsPanning(false);
    panStartRef.current = null;
  };

  const viewBox = useMemo(() => {
    const vbW = WORLD_WIDTH / scale;
    const vbH = WORLD_HEIGHT / scale;
    const cx = WORLD_WIDTH / 2 - pan.x;
    const cy = WORLD_HEIGHT / 2 - pan.y;
    return `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`;
  }, [scale, pan]);

  const isDark = theme === 'dark';

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden bg-[hsl(var(--background))]">
      {/* Top overlay controls */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/90 px-1 py-1 shadow-card backdrop-blur">
          <button onClick={zoomOut} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted" title="تصغير">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3rem] text-center font-mono text-xs font-bold text-foreground">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted" title="تكبير">
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          <button onClick={resetView} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted" title="إعادة ضبط العرض">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-auto hidden items-center gap-1.5 sm:flex">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm backdrop-blur">
            <Move className="h-3 w-3" />
            Shift+سحب للتحريك
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm backdrop-blur">
            <Crosshair className="h-3 w-3" />
            WASD للحركة
          </span>
          {followId && (
            <button
              onClick={() => setFollowAgent(null)}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
            >
              <Eye className="h-3.5 w-3.5" />
              إلغاء المتابعة
            </button>
          )}
        </div>
      </div>

      {/* SVG Floorplan */}
      <div
        className="flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      >
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="h-full w-full select-none"
          onClick={handleFloorClick}
          style={{ background: isDark ? '#0f1219' : '#eef2f7' }}
        >
          <defs>
            {/* Oak corridor planks */}
            <pattern id="oak-planks" width="32" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
              <rect width="32" height="24" fill={isDark ? '#1c1a14' : '#e9ddd0'} />
              <rect x="0" y="0" width="32" height="1.5" fill={isDark ? '#2a241b' : '#d8c8b4'} opacity="0.9" />
              <rect x="16" y="12" width="16" height="1" fill={isDark ? '#2a241b' : '#d8c8b4'} opacity="0.45" />
              <rect x="0" y="6" width="1" height="18" fill={isDark ? '#252019' : '#cbb8a3'} opacity="0.35" />
            </pattern>
            {/* Carpet */}
            <pattern id="carpet-dots" width="14" height="14" patternUnits="userSpaceOnUse">
              <rect width="14" height="14" fill="transparent" />
              <circle cx="7" cy="7" r="1" fill="currentColor" opacity="0.06" />
            </pattern>
            {/* Agent shadow */}
            <filter id="agent-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.18" />
            </filter>
            <filter id="nameplate-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
            </filter>
          </defs>

          {/* Subtle campus base */}
          <rect x="0" y="0" width={WORLD_WIDTH} height={WORLD_HEIGHT} rx="18" fill={isDark ? '#0f1219' : '#e6ebf2'} />
          <rect x="16" y="16" width={WORLD_WIDTH - 32} height={WORLD_HEIGHT - 32} rx="16" fill={isDark ? '#13151d' : '#f5f7fb'} stroke={isDark ? '#1e2330' : '#d7deea'} strokeWidth="1.5" />

          {/* Corridors */}
          {Object.values(CORRIDORS).map((c) => (
            <g key={c.id}>
              <rect x={c.x} y={c.y} width={c.width} height={c.height} rx="10" fill="url(#oak-planks)" stroke={isDark ? '#2e261d' : '#cbbfb0'} strokeWidth="1" />
              {/* plank direction line */}
              <line x1={c.x + 8} y1={c.y + c.height / 2} x2={c.x + c.width - 8} y2={c.y + c.height / 2} stroke={isDark ? '#3a3226' : '#b8a99a'} strokeWidth="0.6" strokeDasharray="10 12" opacity="0.55" />
              {/* corridor label */}
              <text x={c.x + c.width / 2} y={c.y + c.height / 2 + 4} textAnchor="middle" fontSize="8.5" fontWeight="700" letterSpacing="0.08em" fill={isDark ? '#6b5e4f' : '#8a7d6f'} opacity="0.9">
                {c.nameEn}
              </text>
            </g>
          ))}

          {/* Crosswalk stripes at intersections */}
          <g opacity={isDark ? 0.22 : 0.32}>
            <rect x={518 - 18} y={460 - 10} width={36} height={20} rx="2" fill="white" />
            <g stroke={isDark ? '#1c1a14' : '#b8a99a'} strokeWidth="2">
              <line x1={504} y1={455} x2={532} y2={455} />
              <line x1={504} y1={460} x2={532} y2={460} />
              <line x1={504} y1={465} x2={532} y2={465} />
            </g>
            <rect x={1082 - 18} y={460 - 10} width={36} height={20} rx="2" fill="white" />
            <g stroke={isDark ? '#1c1a14' : '#b8a99a'} strokeWidth="2">
              <line x1={1068} y1={455} x2={1096} y2={455} />
              <line x1={1068} y1={460} x2={1096} y2={460} />
              <line x1={1068} y1={465} x2={1096} y2={465} />
            </g>
          </g>

          {/* Rooms */}
          {OFFICE_ROOMS.map((room) => {
            const isSelRoom = selectedId ? (Object.values(agents).find((a) => a.id === selectedId)?.zoneId === room.id) : false;
            return (
              <g key={room.id} opacity={1}>
                {/* outer wall shadow */}
                <rect x={room.x - 1} y={room.y - 1} width={room.width + 2} height={room.height + 2} rx="14" fill="black" opacity={isDark ? 0.22 : 0.08} />
                {/* floor */}
                <rect x={room.x} y={room.y} width={room.width} height={room.height} rx="14" fill={isDark ? room.floorTintDark : room.floorTintLight} stroke={isSelRoom ? room.accent : (isDark ? '#252a3a' : '#d7deea')} strokeWidth={isSelRoom ? 2.2 : 1.2} />
                {/* inner rug */}
                <rect x={room.x + 12} y={room.y + 32} width={room.width - 24} height={room.height - 44} rx="10" fill={isDark ? room.rugDark : room.rugLight} opacity={0.95} />
                {/* dotted carpet texture overlay */}
                <rect x={room.x + 12} y={room.y + 32} width={room.width - 24} height={room.height - 44} rx="10" fill="url(#carpet-dots)" color={room.accent} opacity="0.5" />
                {/* Walls with door gaps — draw as 4 segments with gaps */}
                {(() => {
                  const strokeW = 5;
                  const doorColor = isDark ? '#1a1d28' : '#eef2f7';
                  // helper to draw wall segments
                  const walls: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
                  const doorsByWall = {
                    north: room.doors.filter((d) => d.wall === 'north'),
                    south: room.doors.filter((d) => d.wall === 'south'),
                    east:  room.doors.filter((d) => d.wall === 'east'),
                    west:  room.doors.filter((d) => d.wall === 'west'),
                  };
                  // North wall y = room.y, x from room.x to room.x+width
                  {
                    let cur = room.x;
                    const y = room.y;
                    const sorted = [...doorsByWall.north].sort((a,b)=>a.from-b.from);
                    for (const d of sorted) {
                      if (d.from > cur) walls.push({ x1: cur, y1: y, x2: d.from, y2: y });
                      cur = d.to;
                    }
                    if (cur < room.x + room.width) walls.push({ x1: cur, y1: y, x2: room.x + room.width, y2: y });
                  }
                  // South wall y = room.y+height
                  {
                    let cur = room.x;
                    const y = room.y + room.height;
                    const sorted = [...doorsByWall.south].sort((a,b)=>a.from-b.from);
                    for (const d of sorted) {
                      if (d.from > cur) walls.push({ x1: cur, y1: y, x2: d.from, y2: y });
                      cur = d.to;
                    }
                    if (cur < room.x + room.width) walls.push({ x1: cur, y1: y, x2: room.x + room.width, y2: y });
                  }
                  // West wall x = room.x
                  {
                    let cur = room.y;
                    const x = room.x;
                    const sorted = [...doorsByWall.west].sort((a,b)=>a.from-b.from);
                    for (const d of sorted) {
                      if (d.from > cur) walls.push({ x1: x, y1: cur, x2: x, y2: d.from });
                      cur = d.to;
                    }
                    if (cur < room.y + room.height) walls.push({ x1: x, y1: cur, x2: x, y2: room.y + room.height });
                  }
                  // East wall x = room.x+width
                  {
                    let cur = room.y;
                    const x = room.x + room.width;
                    const sorted = [...doorsByWall.east].sort((a,b)=>a.from-b.from);
                    for (const d of sorted) {
                      if (d.from > cur) walls.push({ x1: x, y1: cur, x2: x, y2: d.from });
                      cur = d.to;
                    }
                    if (cur < room.y + room.height) walls.push({ x1: x, y1: cur, x2: x, y2: room.y + room.height });
                  }
                  return (
                    <>
                      {walls.map((w, i) => (
                        <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={isDark ? '#252a3a' : '#cbd5e1'} strokeWidth={strokeW} strokeLinecap="round" opacity={0.95} />
                      ))}
                      {/* door thresholds */}
                      {room.doors.map((d) => {
                        const isH = d.wall === 'north' || d.wall === 'south';
                        const cx = isH ? (d.from + d.to) / 2 : (d.wall === 'west' ? room.x : room.x + room.width);
                        const cy = !isH ? (d.from + d.to) / 2 : (d.wall === 'north' ? room.y : room.y + room.height);
                        return (
                          <g key={d.id}>
                            <rect x={isH ? d.from : cx - 6} y={!isH ? d.from : cy - 6} width={isH ? d.to - d.from : 12} height={!isH ? d.to - d.from : 12} rx="3" fill={doorColor} stroke={isDark ? '#2a2f42' : '#d7deea'} strokeWidth="1" />
                            {d.isDouble && (
                              <line x1={isH ? (d.from + d.to) / 2 : cx} y1={!isH ? d.from : cy} x2={isH ? (d.from + d.to) / 2 : cx} y2={!isH ? d.to : cy} stroke={isDark ? '#2a2f42' : '#cbd5e1'} strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
                            )}
                          </g>
                        );
                      })}
                    </>
                  );
                })()}

                {/* Room label header */}
                <g>
                  <rect x={room.x + 10} y={room.y + 8} width={room.width - 20} height={20} rx="8" fill={isDark ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.92)'} stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'} />
                  <text x={room.x + 18} y={room.y + 21} fontSize="10" fontWeight="800" fill={room.accent}>{room.code}</text>
                  <text x={room.x + 52} y={room.y + 21} fontSize="10.5" fontWeight="700" fill={isDark ? '#e2e8f0' : '#0f172a'}>{room.nameAr}</text>
                </g>

                {/* Furniture per spot */}
                {ROOM_SPOTS.filter((s) => s.roomId === room.id).map((spot) => {
                  const isDesk = spot.role === 'desk' || spot.role === 'desk-alt';
                  const isMeeting = spot.role === 'meeting';
                  const isCoffee = spot.role === 'coffee';
                  const isLounge = spot.role === 'lounge';
                  const isReception = spot.role === 'reception';
                  const isBoard = spot.role === 'board';
                  const isCollab = spot.role === 'collab';
                  return (
                    <g key={spot.id} opacity={0.95}>
                      {isDesk && (
                        <>
                          <rect x={spot.x - 28} y={spot.y - 16} width={56} height={32} rx="7" fill={isDark ? '#24283b' : 'white'} stroke={isDark ? '#2e334e' : '#d7deea'} strokeWidth="1" />
                          <rect x={spot.x - 22} y={spot.y - 10} width={44} height={10} rx="3" fill={room.accent} opacity={0.12} />
                          <rect x={spot.x - 10} y={spot.y - 20} width={20} height={14} rx="3" fill={isDark ? '#1c2033' : '#eef2f7'} stroke={isDark ? '#2e334e' : '#d7deea'} />
                          <circle cx={spot.x + 14} cy={spot.y - 4} r="3.5" fill={room.accent} opacity={0.9} />
                        </>
                      )}
                      {isMeeting && (
                        <>
                          <rect x={spot.x - 18} y={spot.y - 12} width={36} height={24} rx="8" fill={isDark ? '#2a2d40' : 'white'} stroke={isDark ? '#353a55' : '#d7deea'} />
                          <circle cx={spot.x} cy={spot.y - 2} r="5" fill={room.accent} opacity={0.18} />
                        </>
                      )}
                      {isCoffee && (
                        <>
                          <rect x={spot.x - 20} y={spot.y - 14} width={40} height={28} rx="8" fill={isDark ? '#1e2a2c' : 'white'} stroke={isDark ? '#264040' : '#d7deea'} />
                          <rect x={spot.x - 8} y={spot.y - 8} width={16} height={14} rx="3" fill="#b45309" />
                          <circle cx={spot.x} cy={spot.y - 14} r="4" fill={room.accent} opacity={0.15} />
                        </>
                      )}
                      {isLounge && (
                        <>
                          <rect x={spot.x - 20} y={spot.y - 10} width={40} height={20} rx="10" fill={room.accent} opacity={0.14} stroke={room.accent} strokeWidth="0.8" />
                          <circle cx={spot.x} cy={spot.y} r="6" fill={room.accent} opacity={0.22} />
                        </>
                      )}
                      {isReception && (
                        <>
                          <rect x={spot.x - 32} y={spot.y - 10} width={64} height={20} rx="10" fill={isDark ? '#1e293b' : 'white'} stroke={room.accent} strokeWidth="1.2" />
                          <text x={spot.x} y={spot.y + 4} textAnchor="middle" fontSize="7" fontWeight="700" fill={room.accent}>RECEPTION</text>
                        </>
                      )}
                      {isBoard && (
                        <>
                          <rect x={spot.x - 18} y={spot.y - 12} width={36} height={24} rx="6" fill={isDark ? '#1c2033' : 'white'} stroke={isDark ? '#2e334e' : '#d7deea'} />
                          <rect x={spot.x - 10} y={spot.y - 6} width={20} height={12} rx="2" fill={room.accent} opacity={0.2} />
                          <text x={spot.x} y={spot.y + 14} textAnchor="middle" fontSize="6" fontWeight="700" fill={isDark ? '#94a3b8' : '#64748b'}>{spot.role === 'board' ? 'BOARD' : 'COLLAB'}</text>
                        </>
                      )}
                      {isCollab && (
                        <>
                          <rect x={spot.x - 22} y={spot.y - 14} width={44} height={28} rx="9" fill={isDark ? '#222840' : 'white'} stroke={isDark ? '#2e334e' : '#d7deea'} />
                          <rect x={spot.x - 16} y={spot.y - 3} width={32} height={6} rx="3" fill={room.accent} opacity={0.12} />
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* --- Animated route trails (for walking agents) --- */}
          {Object.values(movables).map((m) => {
            if (m.path.length === 0) return null;
            const allPts = [{ x: m.x, y: m.y }, ...m.path];
            const d = allPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const accent = (() => {
              const ag = agents[m.id];
              return ag?.profile.avatarColor ?? '#6366f1';
            })();
            return (
              <g key={`trail-${m.id}`}>
                <path d={d} fill="none" stroke={accent} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 8" opacity="0.42" className="animate-route-dash" />
                <path d={d} fill="none" stroke="white" strokeWidth="1" strokeDasharray="8 8" opacity={0.7} className="animate-route-dash" />
              </g>
            );
          })}

          {/* --- User avatar --- */}
          <g transform={`translate(${userPos.x}, ${userPos.y})`} style={{ cursor: 'pointer' }}>
            {/* shadow */}
            <ellipse cx="0" cy="14" rx="14" ry="4.5" fill="black" opacity={isDark ? 0.32 : 0.12} />
            {/* body */}
            <g transform={`rotate(${userFacing} 0 0)`}>
              <rect x="-11" y="-9" width="22" height="18" rx="7" fill="#0ea5e9" stroke="white" strokeWidth="1.5" filter="url(#agent-shadow)" />
              <circle cx="0" cy="-11" r="9" fill="#0ea5e9" stroke="white" strokeWidth="1.5" />
              <text x="0" y="-7.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="white">YOU</text>
              {/* direction arrow */}
              <polygon points="9,-2 14,0 9,2" fill="#0ea5e9" stroke="white" strokeWidth="0.8" />
            </g>
            {/* nameplate */}
            <g filter="url(#nameplate-shadow)">
              <rect x="-26" y="-30" width="52" height="14" rx="7" fill={isDark ? '#0f172a' : 'white'} stroke="#0ea5e9" strokeWidth="1.2" />
              <text x="0" y="-20.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill={isDark ? 'white' : '#0f172a'}>أنت</text>
            </g>
            {/* user path trail */}
            {userPath.length > 0 && (
              <path
                d={[{ x: 0, y: 0 }, ...userPath.map((p) => ({ x: p.x - userPos.x, y: p.y - userPos.y }))].map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeDasharray="6 6" opacity="0.5" className="animate-route-dash"
              />
            )}
          </g>

          {/* --- Agents --- */}
          {Object.values(agents).map((ag) => {
            const m = movables[ag.id];
            if (!m) return null;
            const brain = ag.brainConfig;
            const vis = brain ? (PROVIDER_VISUALS[brain.provider as BrainProvider] ?? PROVIDER_VISUALS[BrainProvider.Google]) : null;
            const isSelected = selectedId === ag.id;
            const isFollowed = followId === ag.id;
            const showThought = ag.lifecycleState === 'THINKING' || ag.lifecycleState === 'REFINING' || ag.lifecycleState === 'EXECUTING' || ag.lifecycleState === 'EXECUTING_TOOL';
            const showTalk    = ag.lifecycleState === 'RESPONDING';
            const isWalking   = m.isWalking;

            return (
              <g
                key={ag.id}
                transform={`translate(${m.x}, ${m.y})`}
                onClick={(e) => handleAgentClick(ag, e as unknown as React.MouseEvent)}
                style={{ cursor: 'pointer' }}
              >
                {/* selection halo */}
                {isSelected && (
                  <circle cx="0" cy="0" r="30" fill="none" stroke={ag.profile.avatarColor} strokeWidth="1.5" strokeDasharray="5 5" opacity="0.55" />
                )}
                {isFollowed && (
                  <circle cx="0" cy="0" r="34" fill="none" stroke="#6366f1" strokeWidth="1.8" opacity={0.45} />
                )}

                {/* shadow */}
                <ellipse cx="0" cy="15" rx="14" ry="5" fill="black" opacity={isDark ? 0.28 : 0.10} />

                {/* body puck */}
                <g filter="url(#agent-shadow)" transform={`rotate(${m.facing} 0 0)`}>
                  <rect x="-13" y="-10" width="26" height="20" rx="8" fill={ag.profile.avatarColor} stroke={isSelected ? ag.profile.avatarColor : 'white'} strokeWidth={isSelected ? 2 : 1.6} />
                  {/* walking legs hint */}
                  {isWalking && (
                    <g opacity="0.85">
                      <ellipse cx="-5" cy="8" rx="3" ry="4" fill={ag.profile.avatarColor} />
                      <ellipse cx="5" cy="8" rx="3" ry="4" fill={ag.profile.avatarColor} />
                    </g>
                  )}
                  {/* facing arrow */}
                  <polygon points="11,-2 16,0 11,2" fill={ag.profile.avatarColor} stroke="white" strokeWidth="0.9" />
                </g>

                {/* head */}
                <circle cx="0" cy="-13.5" r="10.5" fill={ag.profile.avatarColor} stroke="white" strokeWidth="1.6" />
                <text x="0" y="-9.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="white">
                  {ag.displayName.slice(0, 2).toUpperCase()}
                </text>

                {/* status dot */}
                <circle
                  cx="8.5" cy="-20" r="4.2" fill={
                    ag.lifecycleState === 'ERROR' ? '#ef4444'
                    : showTalk ? '#10b981'
                    : showThought ? '#f59e0b'
                    : isWalking ? '#6366f1'
                    : '#94a3b8'
                  }
                  stroke="white" strokeWidth="1.3"
                />
                {(showThought || showTalk || isWalking) && (
                  <circle cx="8.5" cy="-20" r="7" fill="none" stroke={ag.lifecycleState === 'ERROR' ? '#ef4444' : showTalk ? '#10b981' : showThought ? '#f59e0b' : '#6366f1'} strokeWidth="1" opacity="0.45">
                    <animate attributeName="r" values="6;9;6" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.45;0;0.45" dur="1.2s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Nameplate + role + status */}
                <g filter="url(#nameplate-shadow)">
                  <rect x="-42" y="-42" width="84" height="18" rx="9" fill={isDark ? '#0f172a' : 'white'} stroke={ag.profile.avatarColor} strokeWidth="1" opacity="0.98" />
                  <text x="0" y="-33.5" textAnchor="middle" fontSize="7.2" fontWeight="800" fill={isDark ? 'white' : '#0f172a'}>{ag.displayName}</text>
                  <text x="0" y="-28" textAnchor="middle" fontSize="5.6" fontWeight="600" fill={isDark ? '#94a3b8' : '#64748b'}>{ag.profile.customRole}</text>
                </g>

                {/* Model chip — always visible, click to swap */}
                {brain && vis && (
                  <g
                    onClick={(e) => { e.stopPropagation(); openModelSwap(ag.id); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect x="-42" y="18" width="84" height="14" rx="7" fill={isDark ? vis.bgDark : vis.bgLight} stroke={vis.border} strokeWidth="1" />
                    <circle cx="-33" cy="25" r="5" fill={vis.color} />
                    <text x="-33" y="27.2" textAnchor="middle" fontSize="5.5" fontWeight="800" fill="white">{vis.shortLabel.slice(0, 2).toUpperCase()}</text>
                    <text x="-24" y="28.4" fontSize="6" fontWeight="700" fill={vis.color}>{vis.shortLabel}</text>
                    <text x="39" y="28.4" textAnchor="end" fontSize="5.8" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill={isDark ? '#e2e8f0' : '#0f172a'}>{formatShortModel(brain.model)}</text>
                  </g>
                )}

                {/* Activity label */}
                <g>
                  <rect x="-30" y="34" width="60" height="10" rx="5" fill={isWalking ? '#6366f1' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'} />
                  <text x="0" y="41.2" textAnchor="middle" fontSize="5.5" fontWeight="700" fill={isWalking ? 'white' : (isDark ? '#cbd5e1' : '#475569')}>
                    {isWalking ? '● يتنقل عبر الممرات' : showThought ? 'يفكر…' : showTalk ? 'يرد…' : '● على المكتب'}
                  </text>
                </g>

                {/* Speech / thought bubble */}
                {(m.bubble || showThought || showTalk) && (
                  <g>
                    <rect x="-46" y="-62" width="92" height="14" rx="7" fill={isDark ? '#1e293b' : 'white'} stroke={ag.profile.avatarColor} strokeWidth="0.9" />
                    <text x="0" y="-52.5" textAnchor="middle" fontSize="6.5" fontWeight="600" fill={isDark ? '#e2e8f0' : '#0f172a'}>
                      {m.bubble ? m.bubble.slice(0, 28) : showThought ? 'يفكر في الحل…' : 'يكتب الرد…'}
                    </text>
                    {/* tail */}
                    <polygon points="-4,-48 0,-42 4,-48" fill={isDark ? '#1e293b' : 'white'} stroke={ag.profile.avatarColor} strokeWidth="0.7" />
                  </g>
                )}
              </g>
            );
          })}

          {/* Invisible hit overlay for floor clicks */}
          <rect x="0" y="0" width={WORLD_WIDTH} height={WORLD_HEIGHT} fill="transparent" style={{ pointerEvents: 'none' }} />
        </svg>
      </div>

      {/* Bottom hint bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/80 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> الممرات المضيئة هي المسارات الآمنة — الوكلاء لا يعبرون الجدران
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Footprints className="h-3.5 w-3.5 text-indigo-500" />
            انقر على أي غرفة أو مكتب لتوجيه الوكيل المحدد
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (!selectedId) return;
              const ag = agents[selectedId];
              if (!ag) return;
              openModelSwap(ag.id);
            }}
            disabled={!selectedId}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 dark:bg-white/5"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            تبديل موديل المحدد
          </button>
          <button
            onClick={() => setFollowAgent(followId ? null : selectedId)}
            disabled={!selectedId}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold disabled:opacity-40 ${followId ? 'bg-indigo-600 text-white' : 'border border-border bg-white text-foreground hover:bg-muted dark:bg-white/5'}`}
          >
            {followId ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {followId ? 'متابعة' : 'تتبع'}
          </button>
        </div>
      </div>

      {/* Selected agent quick bar (mobile) */}
      {selectedId && agents[selectedId] && (
        <div className="absolute bottom-[52px] left-2 right-2 flex items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-card backdrop-blur sm:bottom-3 sm:left-3 sm:right-auto sm:max-w-[520px]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white" style={{ background: agents[selectedId]!.profile.avatarColor }}>
            {agents[selectedId]!.displayName.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold leading-none text-foreground">{agents[selectedId]!.displayName} — {agents[selectedId]!.profile.customRole}</div>
            <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {movables[selectedId]?.targetRoomId
                ? `متجه إلى ${OFFICE_ROOMS.find((r) => r.id === movables[selectedId]!.targetRoomId)?.nameAr ?? movables[selectedId]!.targetRoomId}`
                : (locatePoint({ x: movables[selectedId]?.x ?? 800, y: movables[selectedId]?.y ?? 480 }).nameAr)}
              {movables[selectedId]?.isWalking && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />}
            </div>
          </div>
          <button
            onClick={() => {
              const ag = agents[selectedId]!;
              const spots = OFFICE_ROOMS.filter((r) => r.id !== (ag.zoneId ?? ''));
              const dest = spots[Math.floor(Math.random() * spots.length)]!;
              dispatchToRoom(ag.id, dest.id);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-900"
          >
            <Footprints className="h-3.5 w-3.5" />
            نقل عشوائي
          </button>
        </div>
      )}
    </div>
  );
}
