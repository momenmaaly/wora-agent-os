import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  Activity, Bot, Box, ClipboardList, Cpu, Map as MapIcon, Monitor, Radio, RotateCcw, UsersRound, X,
} from 'lucide-react';
import { ROOM_BY_ID } from '../office/layout.js';
import { motionMarkersToWorld } from '../office/motionBridge.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { useOfficeMotion } from '../office/useOfficeSimulation.js';
import { localTime, officeTasks, taskSourceLabel, taskStage } from '../office/work.js';
import { useWoraStore, type AgentLocationSnapshot } from '../store/useWoraStore.js';
import {
  agentCurrentTask, agentVisualState, ROBOT_STATE_LABELS, type AgentMotionSnapshot,
} from '../three/layout.js';
import { createOfficeScene, type OfficeSceneController, type OfficeSelection } from '../three/officeScene.js';
import { recommended3DQuality, supportsWebGL } from '../three/webgl.js';
import { ConnectionBadge } from './OfficePeople.js';

export interface Office3DProps {
  roomId: string | null;
  resetSignal: number;
  onRoom: (roomId: string) => void;
  onAgent: (agentId: string) => void;
  onViewChange: (view: 'plan' | 'space') => void;
  onOpenTasks: (roomId: string) => void;
  onTeam: (roomId: string) => void;
  onAssign: () => void;
}

interface MotionMeta {
  authorized: Set<string>;
  moving: Set<string>;
}

const LIVE_SCOPE_LABELS: Record<string, string> = {
  local: 'محلي', session: 'جلسة', preview: 'معاينة', server: 'خادم',
};

const OBJECT_LABELS: Record<OfficeSelection['kind'], string> = {
  robot: 'ملف الوكيل',
  department: 'مساحة القسم',
  workstation: 'محطة عمل',
  screen: 'شاشة محطة عمل',
  meeting: 'مساحة اجتماع',
};

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function locationSignature(location: AgentLocationSnapshot | undefined): string {
  if (!location) return '';
  return [location.areaId, location.activity, location.isWalking ? 'walking' : 'settled', location.targetRoomId ?? ''].join('|');
}

export function Office3D({
  roomId, resetSignal, onRoom, onAgent, onViewChange, onOpenTasks, onTeam, onAssign,
}: Office3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<OfficeSceneController | null>(null);
  const callbacks = useRef({ onRoom, onAgent, onOpenTasks, onTeam, onAssign });
  callbacks.current = { onRoom, onAgent, onOpenTasks, onTeam, onAssign };
  const [error, setError] = useState('');
  const [showLive, setShowLive] = useState(false);
  const [inspection, setInspection] = useState<OfficeSelection | null>(null);
  const [motionMeta, setMotionMeta] = useState<MotionMeta>({ authorized: new Set(), moving: new Set() });
  const firstReset = useRef(true);
  const frameRef = useRef(motionMarkersToWorld(useOfficeMotion.getState().markers));

  const agents = useWoraStore((state) => state.agents);
  const workspaces = useWoraStore((state) => state.workspaces);
  const activityLog = useWoraStore((state) => state.activityLog);
  const selectedAgentId = useWoraStore((state) => state.selectedAgentId);
  const connected = useWoraStore((state) => state.connected);
  const serverMode = useWoraStore((state) => state.serverMode);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const agentList = useMemo(() => Object.values(agents), [agents]);
  const agentsRef = useRef(agentList);
  const tasksRef = useRef(tasks);
  const locationsRef = useRef<Record<string, AgentLocationSnapshot>>(useWoraStore.getState().agentLocations);
  const locationSignatures = useRef(new Map<string, string>());
  agentsRef.current = agentList;
  tasksRef.current = tasks;

  const stateFor = useMemo(() => (agentId: string) => {
    const agent = agents[agentId];
    if (!agent) return null;
    return agentVisualState(agent, tasks, {
      location: useWoraStore.getState().agentLocations[agentId],
      locationAuthorized: motionMeta.authorized.has(agentId),
      movementActive: motionMeta.moving.has(agentId),
    });
  }, [agents, motionMeta, tasks]);

  useEffect(() => {
    const canvasHost = mount.current;
    if (!canvasHost) return;
    if (!supportsWebGL()) {
      setError('WebGL is unavailable in this browser. The existing SVG office and floor plan remain fully operational.');
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const state = useWoraStore.getState();
    const initialTasks = officeTasks(state.workspaces);
    const initialFrame = motionMarkersToWorld(useOfficeMotion.getState().markers);
    try {
      controller.current = createOfficeScene({
        container: canvasHost,
        agents: Object.values(state.agents),
        tasks: initialTasks,
        locations: state.agentLocations,
        commandAgentIds: initialFrame.authorized,
        selectedRoomId: roomId,
        focusedAgentId: state.selectedAgentId,
        quality: recommended3DQuality(),
        reducedMotion,
        onRoom: (id) => {
          setInspection({ kind: 'department', id, roomId: id });
          callbacks.current.onRoom(id);
        },
        onAgent: (id) => {
          const agent = agentsRef.current.find((item) => item.id === id);
          setInspection({ kind: 'robot', id, roomId: agent?.zoneId ?? '' });
          callbacks.current.onAgent(id);
        },
        onInspect: (selection) => {
          setInspection(selection);
          if (selection.kind === 'screen') controller.current?.focusSpot(selection.id.replace(/-screen$/, ''));
        },
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The WebGL office could not be initialized.');
    }
    return () => { controller.current?.destroy(); controller.current = null; };
    // The scene owns its lifecycle; live data and camera targets are updated by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Connect the preserved 2D corridor network to WebGL robots, command markers only. */
  useEffect(() => {
    function applyMarkers(markers: ReturnType<typeof useOfficeMotion.getState>['markers']): void {
      const frame = motionMarkersToWorld(markers);
      const previous = frameRef.current;
      frameRef.current = frame;
      controller.current?.setRobotPositions(frame.positions);
      controller.current?.setMovementActive(frame.movement);
      if (!sameSet(frame.authorized, previous.authorized) || !sameSet(frame.movement, previous.movement)) {
        setMotionMeta({ authorized: new Set(frame.authorized), moving: new Set(frame.movement) });
        controller.current?.setAgents(agentsRef.current, tasksRef.current, locationsRef.current, frame.authorized);
      }
    }
    applyMarkers(useOfficeMotion.getState().markers);
    return useOfficeMotion.subscribe((state, previousState) => {
      if (state.markers !== previousState.markers) applyMarkers(state.markers);
    });
  }, []);

  /** Keep semantic location changes without re-rendering React on every animation frame. */
  useEffect(() => useWoraStore.subscribe((state, previousState) => {
    if (state.agentLocations === previousState.agentLocations) return;
    locationsRef.current = state.agentLocations;
    let meaningful = false;
    for (const [id, location] of Object.entries(state.agentLocations)) {
      if (!frameRef.current.authorized.has(id)) continue;
      const signature = locationSignature(location);
      if (locationSignatures.current.get(id) !== signature) {
        locationSignatures.current.set(id, signature);
        meaningful = true;
      }
    }
    if (meaningful) controller.current?.setAgents(agentsRef.current, tasksRef.current, state.agentLocations, frameRef.current.authorized);
  }), []);

  useEffect(() => {
    controller.current?.setAgents(agentList, tasks, locationsRef.current, frameRef.current.authorized);
  }, [agentList, tasks]);

  useEffect(() => {
    controller.current?.focusRoom(roomId);
  }, [roomId]);

  useEffect(() => {
    if (selectedAgentId) {
      const agent = agentsRef.current.find((item) => item.id === selectedAgentId);
      setInspection({ kind: 'robot', id: selectedAgentId, roomId: agent?.zoneId ?? '' });
      controller.current?.focusAgent(selectedAgentId);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    controller.current?.resetCamera();
    setInspection(null);
  }, [resetSignal]);

  const counts = useMemo(() => {
    const result = { total: agentList.length, engaged: 0, blocked: 0, offline: 0 };
    for (const agent of agentList) {
      const state = stateFor(agent.id);
      if (state === 'blocked') result.blocked += 1;
      else if (state === 'offline' || state === 'waiting') result.offline += 1;
      else if (state && state !== 'idle' && state !== 'completed') result.engaged += 1;
    }
    return result;
  }, [agentList, stateFor]);

  const inspectRoomId = inspection?.roomId && ROOM_BY_ID[inspection.roomId] ? inspection.roomId : null;
  const inspectRoom = inspectRoomId ? ROOM_BY_ID[inspectRoomId] : undefined;
  const inspectTeam = useMemo(
    () => inspectRoomId ? agentList.filter((agent) => agent.zoneId === inspectRoomId) : [],
    [agentList, inspectRoomId],
  );
  const inspectTasks = useMemo(
    () => inspectRoomId ? tasks.filter((task) => task.zoneId === inspectRoomId) : [],
    [inspectRoomId, tasks],
  );
  const robotAgent = inspection?.kind === 'robot' ? agents[inspection.id] : undefined;
  const robotTask = robotAgent ? agentCurrentTask(robotAgent.id, tasks) : undefined;
  const robotState = robotAgent ? stateFor(robotAgent.id) : null;
  const robotLocation: AgentMotionSnapshot | undefined = robotAgent && motionMeta.authorized.has(robotAgent.id)
    ? useWoraStore.getState().agentLocations[robotAgent.id] : undefined;
  const preview = serverMode === 'preview';

  function resetCamera() {
    controller.current?.resetCamera();
    setInspection(null);
  }

  function closeInspection() {
    setInspection(null);
    if (inspection?.kind === 'robot') controller.current?.focusAgent(null);
  }

  function openInspectedTasks() {
    if (inspectRoomId) callbacks.current.onOpenTasks(inspectRoomId);
  }

  function openInspectedTeam() {
    if (inspectRoomId) callbacks.current.onTeam(inspectRoomId);
  }

  function fallback(form: FormEvent) {
    form.preventDefault();
    onViewChange('space');
  }

  return <section className="office3d-shell" aria-label="WORA 3D company office" dir="ltr">
    <div className="office3d-canvas" ref={mount} aria-label="Interactive WebGL office canvas" />
    <div className="office3d-hint" aria-hidden="true">Drag to rotate · Scroll or pinch to zoom · Click departments, robots, desks, screens or meeting spaces</div>

    <div className="office3d-status" role="status">
      <span className="office3d-status-title"><span className="status-dot" /> {connected ? `Connected · ${serverMode ?? 'session'}` : 'Local session'}</span>
      <span><bdi>{counts.total}</bdi> agents</span>
      <span><bdi>{counts.engaged}</bdi> engaged</span>
      <span><bdi>{counts.blocked}</bdi> blocked</span>
      {preview && <span className="office3d-preview-note">Preview · simulated replies, no provider</span>}
    </div>

    {showLive && <aside className="office3d-live" aria-label="Live activity">
      <header><span><Activity size={15} aria-hidden="true" /> Recorded activity</span><button type="button" aria-label="Close live activity" onClick={() => setShowLive(false)}><X size={15} /></button></header>
      <div className="office3d-live-status"><ConnectionBadge /><span>Workspace events only</span></div>
      {activityLog.length ? <ul>{activityLog.slice(0, 10).map((event) => <li key={event.id}>
        <p dir="auto">{event.text}</p>
        <small>{LIVE_SCOPE_LABELS[event.scope] ?? event.scope} · <time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small>
      </li>)}</ul> : <p className="office3d-empty">No workspace events have been recorded in this session yet.</p>}
      {tasks.length > 0 && <div className="office3d-live-tasks"><h3>Recorded tasks</h3>{tasks.slice(0, 5).map((task) => <div key={task.id}>
        <span dir="auto">{task.title}</span><small>{taskStage(task)} · {taskSourceLabel(task) || 'workspace'}</small>
      </div>)}</div>}
    </aside>}

    {inspection && <aside className="office3d-inspector" aria-label={OBJECT_LABELS[inspection.kind]}>
      <header>
        <span>
          {inspection.kind === 'robot' ? <Bot size={15} aria-hidden="true" /> : inspection.kind === 'screen' ? <Monitor size={15} aria-hidden="true" /> : <UsersRound size={15} aria-hidden="true" />}
          {OBJECT_LABELS[inspection.kind]}
        </span>
        <button type="button" aria-label="Close inspector" onClick={closeInspection}><X size={15} /></button>
      </header>

      {robotAgent ? <div className="office3d-inspector-body">
        <div className="office3d-profile-head">
          <span className="office3d-avatar" style={{ '--agent-color': robotAgent.profile?.avatarColor ?? '#55d6f0' } as CSSProperties}>{robotAgent.displayName.slice(0, 2).toUpperCase()}</span>
          <div><strong dir="auto">{robotAgent.displayName}</strong><small dir="auto">{robotAgent.profile?.customRole ?? 'AI Agent'}</small></div>
        </div>
        <dl>
          <div><dt>Department</dt><dd>{ROOM_DISPLAY[robotAgent.zoneId ?? '']?.label ?? robotAgent.zoneId ?? '—'}</dd></div>
          <div><dt>Model</dt><dd><Cpu size={13} aria-hidden="true" /> {robotAgent.brainConfig?.model ?? robotAgent.modelId ?? '—'}</dd></div>
          <div><dt>State</dt><dd>{robotState ? ROBOT_STATE_LABELS[robotState] : '—'}</dd></div>
          <div><dt>Current task</dt><dd dir="auto">{robotTask?.title ?? 'No recorded task'}</dd></div>
          <div><dt>Task stage</dt><dd>{robotTask ? `${taskStage(robotTask)} · ${taskSourceLabel(robotTask) || 'workspace'}` : '—'}</dd></div>
          <div><dt>Recorded activity</dt><dd dir="auto">{robotLocation?.statusTextAr ?? 'No command activity recorded'}</dd></div>
          <div><dt>Last seen</dt><dd>{robotAgent.lastSeenAt ? localTime(robotAgent.lastSeenAt) : '—'}</dd></div>
        </dl>
        <p className="office3d-inspector-note"><ClipboardList size={13} aria-hidden="true" /> Values come from workspace records and lifecycle events. No execution progress is inferred.</p>
        <div className="office3d-inspector-actions">
          <button type="button" className="button small" onClick={() => useWoraStore.getState().toggleChat(true)}>Open chat</button>
          <button type="button" className="button small ghost" onClick={callbacks.current.onAssign}>Assign task</button>
        </div>
      </div> : <div className="office3d-inspector-body">
        <div className="office3d-object-head">
          <span className="office3d-object-code">{inspectRoom?.code ?? 'WORA'}</span>
          <div><strong dir="auto">{inspection.label ?? inspectRoom?.nameAr ?? ROOM_DISPLAY[inspectRoomId ?? '']?.label ?? 'Shared office space'}</strong><small>{inspectRoom?.nameEn ?? 'Connected office'}</small></div>
        </div>
        <dl>
          <div><dt>Department</dt><dd dir="auto">{inspectRoom?.nameAr ?? '—'}</dd></div>
          <div><dt>Team records</dt><dd><bdi>{inspectTeam.length}</bdi></dd></div>
          <div><dt>Recorded tasks</dt><dd><bdi>{inspectTasks.length}</bdi></dd></div>
          <div><dt>Live equipment data</dt><dd>{inspection.kind === 'screen' || inspection.kind === 'workstation' ? 'Not connected' : 'Not applicable'}</dd></div>
        </dl>
        {inspectTasks.length > 0 && <div className="office3d-inspector-tasks">
          {inspectTasks.slice(0, 3).map((task) => <div key={task.id}><span dir="auto">{task.title}</span><small>{taskStage(task)}</small></div>)}
        </div>}
        <p className="office3d-inspector-note">Object selection opens real department records; no device telemetry or work is simulated.</p>
        <div className="office3d-inspector-actions">
          {inspectRoomId && <button type="button" className="button small" onClick={openInspectedTasks}>Open tasks</button>}
          {inspectRoomId && <button type="button" className="button small ghost" onClick={openInspectedTeam}>Show team</button>}
          {inspection.kind === 'meeting' && <button type="button" className="button small ghost" onClick={() => useWoraStore.getState().callTeamStandup()}>Call standup</button>}
        </div>
      </div>}
    </aside>}

    <div className="office3d-controls" role="group" aria-label="Office view controls">
      <span className="office3d-active-view" aria-current="true"><Box size={14} aria-hidden="true" /><span>3D View</span></span>
      <button type="button" onClick={() => onViewChange('plan')}><MapIcon size={14} aria-hidden="true" /><span>Floor Plan</span></button>
      <button type="button" aria-pressed={showLive} onClick={() => setShowLive((value) => !value)}><Radio size={14} aria-hidden="true" /><span>Activity</span></button>
      <button type="button" onClick={resetCamera}><RotateCcw size={14} aria-hidden="true" /><span>Reset</span></button>
    </div>

    {error && <div className="office3d-fallback" role="alert">
      <strong>3D view unavailable</strong>
      <p>{error}</p>
      <p>The existing interactive SVG office and floor plan remain available; no simulated company state was created.</p>
      <form onSubmit={fallback}><button type="submit" className="button primary">Open SVG office</button><button type="button" className="button" onClick={() => onViewChange('plan')}>Open floor plan</button></form>
    </div>}
  </section>;
}

export default Office3D;
