import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  Activity, Bot, Box, ClipboardList, Cpu, Map, Radio, RotateCcw, X,
} from 'lucide-react';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { localTime, officeTasks, taskSourceLabel, taskStage } from '../office/work.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { agentCurrentTask, agentVisualState, ROBOT_STATE_LABELS } from '../three/layout.js';
import { createOfficeScene, type OfficeSceneController } from '../three/officeScene.js';
import { recommended3DQuality, supportsWebGL } from '../three/webgl.js';
import { ConnectionBadge } from './OfficePeople.js';

export interface Office3DProps {
  roomId: string | null;
  resetSignal: number;
  onRoom: (roomId: string) => void;
  onAgent: (agentId: string) => void;
  onViewChange: (view: 'plan' | 'space') => void;
}

const LIVE_SCOPE_LABELS: Record<string, string> = {
  local: 'محلي', session: 'جلسة', preview: 'معاينة', server: 'خادم',
};

export function Office3D({ roomId, resetSignal, onRoom, onAgent, onViewChange }: Office3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<OfficeSceneController | null>(null);
  const callbacks = useRef({ onRoom, onAgent });
  callbacks.current = { onRoom, onAgent };
  const [error, setError] = useState('');
  const [showLive, setShowLive] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const firstReset = useRef(true);

  const agents = useWoraStore((state) => state.agents);
  const workspaces = useWoraStore((state) => state.workspaces);
  const activityLog = useWoraStore((state) => state.activityLog);
  const selectedAgentId = useWoraStore((state) => state.selectedAgentId);
  const connected = useWoraStore((state) => state.connected);
  const serverMode = useWoraStore((state) => state.serverMode);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const agentList = useMemo(() => Object.values(agents), [agents]);

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
    try {
      controller.current = createOfficeScene({
        container: canvasHost,
        agents: Object.values(state.agents),
        tasks: initialTasks,
        selectedRoomId: roomId,
        focusedAgentId: state.selectedAgentId,
        quality: recommended3DQuality(),
        reducedMotion,
        onRoom: (id) => callbacks.current.onRoom(id),
        onAgent: (id) => { setProfileId(id); callbacks.current.onAgent(id); },
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The WebGL office could not be initialized.');
    }
    return () => { controller.current?.destroy(); controller.current = null; };
    // The scene owns its lifecycle; live data and camera targets are updated by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controller.current?.setAgents(agentList, tasks);
  }, [agentList, tasks]);

  useEffect(() => {
    controller.current?.focusRoom(roomId);
  }, [roomId]);

  useEffect(() => {
    if (selectedAgentId) {
      setProfileId(selectedAgentId);
      controller.current?.focusAgent(selectedAgentId);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    controller.current?.resetCamera();
  }, [resetSignal]);

  const profileAgent = profileId ? agents[profileId] : undefined;
  const profileTask = profileAgent ? agentCurrentTask(profileAgent.id, tasks) : undefined;
  const profileState = profileAgent ? agentVisualState(profileAgent, tasks) : null;
  const counts = useMemo(() => {
    const result = { total: agentList.length, working: 0, waiting: 0, blocked: 0, idle: 0 };
    for (const agent of agentList) {
      const state = agentVisualState(agent, tasks);
      if (state === 'working' || state === 'thinking' || state === 'communicating') result.working += 1;
      else if (state === 'waiting' || state === 'offline') result.waiting += 1;
      else if (state === 'blocked') result.blocked += 1;
      else result.idle += 1;
    }
    return result;
  }, [agentList, tasks]);

  function resetCamera() {
    controller.current?.resetCamera();
    setProfileId(null);
  }

  function fallback(form: FormEvent) {
    form.preventDefault();
    onViewChange('space');
  }

  return <section className="office3d-shell" aria-label="WORA 3D company office" dir="ltr">
    <div className="office3d-canvas" ref={mount} aria-label="Interactive WebGL office canvas" />
    <div className="office3d-hint" aria-hidden="true">Drag to rotate · Scroll or pinch to zoom · Click a department or robot</div>

    <div className="office3d-status" role="status">
      <span className="office3d-status-title"><span className="status-dot" /> {connected ? `Connected · ${serverMode ?? 'session'}` : 'Local session'}</span>
      <span><bdi>{counts.total}</bdi> agents</span>
      <span><bdi>{counts.working}</bdi> active</span>
      <span><bdi>{counts.waiting}</bdi> waiting</span>
      <span><bdi>{counts.blocked}</bdi> blocked</span>
    </div>

    {showLive && <aside className="office3d-live" aria-label="Live activity">
      <header><span><Activity size={15} aria-hidden="true" /> Live Activity</span><button type="button" aria-label="Close live activity" onClick={() => setShowLive(false)}><X size={15} /></button></header>
      <div className="office3d-live-status"><ConnectionBadge /><span>Recorded workspace events only</span></div>
      {activityLog.length ? <ul>{activityLog.slice(0, 8).map((event) => <li key={event.id}>
        <p dir="auto">{event.text}</p>
        <small>{LIVE_SCOPE_LABELS[event.scope] ?? event.scope} · <time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small>
      </li>)}</ul> : <p className="office3d-empty">No live events have been recorded in this session yet.</p>}
      {tasks.length > 0 && <div className="office3d-live-tasks"><h3>Recorded tasks</h3>{tasks.slice(0, 4).map((task) => <div key={task.id}>
        <span dir="auto">{task.title}</span><small>{taskStage(task)} · {taskSourceLabel(task) || 'workspace'}</small>
      </div>)}</div>}
    </aside>}

    {profileAgent && <aside className="office3d-profile" aria-label={`${profileAgent.displayName} agent profile`}>
      <header><span><Bot size={16} aria-hidden="true" /> Agent Profile</span><button type="button" aria-label="Close agent profile" onClick={() => { setProfileId(null); controller.current?.focusAgent(null); }}><X size={15} /></button></header>
      <div className="office3d-profile-head">
        <span className="office3d-avatar" style={{ '--agent-color': profileAgent.profile?.avatarColor ?? '#55d6f0' } as CSSProperties}>{profileAgent.displayName.slice(0, 2).toUpperCase()}</span>
        <div><strong dir="auto">{profileAgent.displayName}</strong><small dir="auto">{profileAgent.profile?.customRole ?? 'AI Agent'}</small></div>
      </div>
      <dl>
        <div><dt>Department</dt><dd>{ROOM_DISPLAY[profileAgent.zoneId ?? '']?.label ?? profileAgent.zoneId ?? '—'}</dd></div>
        <div><dt>Model</dt><dd><Cpu size={13} aria-hidden="true" /> {profileAgent.brainConfig?.model ?? profileAgent.modelId ?? '—'}</dd></div>
        <div><dt>State</dt><dd>{profileState ? ROBOT_STATE_LABELS[profileState] : '—'}</dd></div>
        <div><dt>Current task</dt><dd dir="auto">{profileTask?.title ?? 'No recorded task'}</dd></div>
        <div><dt>Task stage</dt><dd>{profileTask ? `${taskStage(profileTask)} · ${taskSourceLabel(profileTask) || 'workspace'}` : '—'}</dd></div>
        <div><dt>Active tasks</dt><dd><bdi>{profileAgent.activeTasks ?? 0}</bdi></dd></div>
        <div><dt>Skills</dt><dd>{(profileAgent.profile?.skills ?? []).join(', ') || 'Not configured'}</dd></div>
        <div><dt>Last seen</dt><dd>{profileAgent.lastSeenAt ? localTime(profileAgent.lastSeenAt) : '—'}</dd></div>
      </dl>
      <p className="office3d-profile-note"><ClipboardList size={13} aria-hidden="true" /> Data shown comes from the current workspace state. Deliverables, execution history, and metrics will appear only when those records exist.</p>
    </aside>}

    <div className="office3d-controls" role="group" aria-label="Office view controls">
      <button type="button" aria-pressed="true"><Box size={14} aria-hidden="true" />3D View</button>
      <button type="button" onClick={() => onViewChange('plan')}><Map size={14} aria-hidden="true" />Floor Plan</button>
      <button type="button" aria-pressed={showLive} onClick={() => setShowLive((value) => !value)}><Radio size={14} aria-hidden="true" />Live View</button>
      <button type="button" onClick={resetCamera}><RotateCcw size={14} aria-hidden="true" />Reset Camera</button>
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
