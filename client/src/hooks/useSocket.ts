/**
 * useSocket.ts — Wora HQ Singleton Socket Manager + Standalone Preview Fallback
 * ──────────────────────────────────────────────────────────────────────────────
 * Maintains a single module-scoped Socket.IO connection (preventing duplicate
 * token streams and StrictMode socket leaks). When deployed to a static preview
 * host (such as Vercel) before an API server URL is configured, it transitions
 * cleanly into interactive company simulation mode so agent movement, model
 * hot-swapping, workspace tasks, and live chat all work out of the box.
 */

import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useWoraStore, type PresenceEntry } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { isRoomLockedForPlan } from '../billing/plans.js';
import {
  AgentLifecycleState,
  lifecycleToAvatarState,
  AvatarAnimState,
  BRAIN_PROVIDER_LABELS,
  BrainProvider,
  MessageType,
} from '../types.js';
import type {
  AgentParticipant,
  AgentSkillUpdate,
  BrainSwapBroadcast,
  Message,
  MessageStreamPayload,
  PublicBrainConfig,
  SharedWorkspaceEntry,
  SharedWorkspaceState,
  WorkspaceUpdatePayload,
  WorkspaceZone,
} from '../types.js';
import { ROOM_BY_ID } from '../office/layout.js';
import { canTakeTask, isFinished, isLocalTask, LOCAL_TASK_PREFIX, TASK_BRIEF_LIMIT, type TaskScope } from '../office/work.js';
import { clearWorkspaceSession, isSessionError, readPreviewSession, readSessionToken, rememberPreviewSession } from '../lib/session.js';

/* ─── CONFIG ────────────────────────────────────────────── */
function getExplicitServerUrl(): string | undefined {
  const raw =
    (import.meta.env['VITE_SOCKET_URL'] as string | undefined)?.trim() ||
    (import.meta.env['VITE_API_URL'] as string | undefined)?.trim();
  return raw || undefined;
}

function resolveSocketUrl(): string {
  return getExplicitServerUrl() ?? window.location.origin;
}

/** Do not silently simulate a private workspace if the real connection fails. */
export function requiresWorkspaceConnection(state = useWoraStore.getState()) {
  if (state.serverMode === 'preview') return false;
  return Boolean(state.serverMode === 'server' || isSessionError(state.connectionError) || getExplicitServerUrl() || readSessionToken());
}

/* ─── WIRE PAYLOAD SHAPES ───────────────────────────────── */
interface RoomStateEvent {
  mode?:           unknown;
  room?:           { id?: string; createdBy?: string };
  previewSession?: unknown;
  participants?:   AgentParticipant[];
  presence?:       PresenceEntry[];
  zones?:          WorkspaceZone[];
  recentMessages?: Message[];
  workspaces?:     SharedWorkspaceState[];
}

interface ParticipantJoinedEvent {
  participant?: AgentParticipant;
  presence?:    PresenceEntry;
}

interface ParticipantLeftEvent {
  participantId?: string;
}

interface ParticipantMovedEvent {
  participantId?: string;
  roomId?:        string;
  position?:      { x: number; y: number; z: number };
}

interface MessageReceivedEvent {
  message?: Message;
}

interface AgentLifecycleEvent {
  roomId?:      string;
  revision?:    number;
  agentId?:     string;
  state?:       AgentLifecycleState;
  avatarState?: AvatarAnimState;
}

interface ServerErrorEvent {
  code?:    string;
  message?: string;
}

/* ─── SINGLETON STATE ───────────────────────────────────── */
const MOVE_THROTTLE_MS  = 120;
const TEARDOWN_GRACE_MS = 150;

let singletonSocket: Socket | null = null;
let activeLifecycleOwners = 0;
let pendingTeardownTimer: ReturnType<typeof setTimeout> | null = null;
let lastMoveSentAt = 0;
let connectFailures = 0;

function attachListeners(socket: Socket): void {
  socket.on('connect', () => {
    connectFailures = 0;
    const state = useWoraStore.getState();
    socket.emit('room:join', {
      roomId:   state.roomId,
      position: networkPosition(state.localPosition),
    });
  });

  socket.on('disconnect', () => {
    const state = useWoraStore.getState();
    state.setConnected(false);
    state.setDemoMode(true);
  });

  socket.on('session:expired', () => {
    clearWorkspaceSession();
    useWoraStore.getState().expireWorkspaceSession();
  });

  socket.on('connect_error', (err: Error) => {
    connectFailures += 1;
    const state = useWoraStore.getState();
    if (err.message === 'AUTH_INVALID' && state.serverMode === 'server') {
      // The client may have been offline when the server emitted session:expired.
      clearWorkspaceSession();
      state.expireWorkspaceSession();
      socket.disconnect();
      return;
    }
    state.setConnected(false);
    state.setDemoMode(true);
    state.setConnectionError(err.message);

    // On static preview hosts (e.g. Vercel without VITE_SOCKET_URL), stop noisy retry loops
    if (!getExplicitServerUrl() && connectFailures >= 2) {
      socket.disconnect();
    }
  });

  socket.on('room:state', (data: RoomStateEvent) => {
    if (data?.mode === 'preview') rememberPreviewSession(data.previewSession);
    useWoraStore.getState().setRoomState({
      roomId:         data?.room?.id,
      userId:         data?.room?.createdBy,
      mode:           data?.mode === 'preview' ? 'preview' : 'server',
      participants:   data?.participants ?? [],
      presence:       data?.presence ?? [],
      zones:          data?.zones ?? [],
      recentMessages: data?.recentMessages ?? [],
      workspaces:     data?.workspaces ?? [],
    });
  });

  socket.on('participant:joined', (data: ParticipantJoinedEvent) => {
    const state = useWoraStore.getState();
    if (data?.participant?.isAgent) state.upsertAgent(data.participant);
    if (data?.presence) state.upsertPresence(data.presence);
  });

  socket.on('participant:left', (data: ParticipantLeftEvent) => {
    if (data?.participantId) {
      useWoraStore.getState().removePresence(data.participantId);
    }
  });

  socket.on('participant:moved', (data: ParticipantMovedEvent) => {
    if (data?.participantId && data?.position) {
      const state = useWoraStore.getState();
      state.upsertPresence({
        participantId: data.participantId,
        roomId:        data.roomId ?? state.roomId,
        position:      data.position,
        joinedAt:      state.presence[data.participantId]?.joinedAt ?? new Date().toISOString(),
      });
    }
  });

  socket.on('message:received', (data: MessageReceivedEvent) => {
    if (data?.message) {
      useWoraStore.getState().addMessage(data.message);
    }
  });

  socket.on('message:stream', (data: Partial<MessageStreamPayload>) => {
    if (!data?.messageId || !data?.agentId) return;
    useWoraStore.getState().appendStream({
      messageId: data.messageId,
      agentId:   data.agentId,
      taskId:    data.taskId ?? data.messageId,
      chunk:     data.chunk ?? '',
      isDone:    Boolean(data.isDone),
      aborted:   Boolean(data.aborted),
    });
  });

  socket.on('agent:lifecycle', (data: AgentLifecycleEvent) => {
    const state = useWoraStore.getState();
    if (data?.agentId && data?.state && (!data.roomId || data.roomId === state.roomId)) {
      state.updateAgentLifecycle(data.agentId, data.state, data.avatarState ?? lifecycleToAvatarState(data.state), data.revision);
    }
  });

  socket.on('agent:brain-updated', (data: Partial<BrainSwapBroadcast>) => {
    if (data?.agentId && data?.newBrain) {
      useWoraStore.getState().updateAgentBrain(data.agentId, data.newBrain);
    }
  });

  socket.on('agent:skills-updated', (event: AgentSkillUpdate) => {
    if (event?.agentId && Number.isSafeInteger(event.revision) && Array.isArray(event.activeNames)) {
      useWoraStore.getState().updateAgentSkills(event);
    }
  });

  socket.on('workspace:update', (data: Partial<WorkspaceUpdatePayload>) => {
    if (data?.entry && data.zoneId === data.entry.zoneId) recordWorkspaceEntry(data.entry);
  });

  socket.on('error', (data: ServerErrorEvent) => {
    const state = useWoraStore.getState();
    if (data?.code === 'ROSTER_UNAVAILABLE' || data?.code === 'JOIN_ERROR') {
      state.setConnected(false);
      state.setConnectionError(data.code);
    }
    const text = data?.message?.trim();
    if (!text) return;
    state.addMessage({
      id:        `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomId:    state.roomId,
      senderId:  'system',
      type:      MessageType.System,
      content:   text,
      timestamp: new Date().toISOString(),
      mentions:  [],
    });
  });
}

export function getSocket(): Socket {
  if (singletonSocket) return singletonSocket;

  const { localUserId } = useWoraStore.getState();
  const hasExplicitApi = Boolean(getExplicitServerUrl());

  const socket = io(resolveSocketUrl(), {
    transports:           ['websocket', 'polling'],
    withCredentials:      true,
    auth: (done) => {
      const token = readSessionToken();
      const previewSession = readPreviewSession();
      done({ userId: localUserId, displayName: 'You', ...(token ? { token } : {}), ...(previewSession ? { previewSession } : {}) });
    },
    reconnection:         true,
    reconnectionAttempts: hasExplicitApi ? Infinity : 2,
    reconnectionDelay:    1_500,
    reconnectionDelayMax: 8_000,
    timeout:              4_500,
    path:                 '/socket.io',
  });

  attachListeners(socket);
  singletonSocket = socket;
  return socket;
}

export function destroySocket(): void {
  if (!singletonSocket) return;
  const socket = singletonSocket;
  singletonSocket = null;
  if (socket.connected) {
    socket.emit('room:leave', { roomId: useWoraStore.getState().roomId });
  }
  socket.removeAllListeners();
  socket.disconnect();
  useWoraStore.getState().setConnected(false);
}

/* ─── LOCAL INTERACTIVE SIMULATION (STANDALONE PREVIEW) ─── */
function resolveLocalTargets(content: string, explicitTargetId?: string): AgentParticipant[] {
  const state = useWoraStore.getState();
  const allAgents = Object.values(state.agents);
  const matched: AgentParticipant[] = [];

  for (const m of content.matchAll(/@([\p{L}\p{N}_-]{2,40})/gu)) {
    const tok = m[1]?.toLowerCase();
    if (!tok) continue;
    const found = allAgents.find(
      (a) =>
        a.id.toLowerCase() === tok ||
        a.displayName.toLowerCase() === tok ||
        (tok.length >= 3 && a.displayName.toLowerCase().startsWith(tok)),
    );
    if (found && !matched.some((x) => x.id === found.id)) {
      matched.push(found);
    }
  }

  if (matched.length === 0) {
    const pick =
      (explicitTargetId ? state.agents[explicitTargetId] : undefined) ??
      allAgents[0];
    if (pick) matched.push(pick);
  }

  return matched.slice(0, 3);
}

async function runLocalSimulatedStream(agent: AgentParticipant, userText: string): Promise<void> {
  const store = useWoraStore.getState();
  const provider = agent.brainConfig?.provider ?? BrainProvider.Google;
  const model    = agent.brainConfig?.model ?? agent.modelId;
  const providerLabel = BRAIN_PROVIDER_LABELS[provider] ?? provider;
  const loc = store.agentLocations[agent.id];
  const homeRoom = agent.zoneId ? ROOM_BY_ID[agent.zoneId] : undefined;
  const roomId = store.roomId;

  // Send agent back toward their workstation if they are out roaming
  if (homeRoom && loc && loc.areaId !== homeRoom.id) {
    store.dispatchAgentToRoom(agent.id, homeRoom.id, 'عائد للمكتب للرد على رسالتك');
  }

  store.updateAgentLifecycle(agent.id, AgentLifecycleState.Thinking, AvatarAnimState.Thinking);
  await new Promise((r) => setTimeout(r, 380));
  if (useWoraStore.getState().roomId !== roomId) return;

  store.updateAgentLifecycle(agent.id, AgentLifecycleState.Responding, AvatarAnimState.Talking);

  const cleanPrompt = userText.replace(/@[\p{L}\p{N}_-]+/gu, '').trim() || userText.trim();
  const reply =
    `أهلاً! معك ${agent.displayName} (${agent.profile.customRole}) من ${homeRoom?.nameAr ?? 'مقر الشركة'}.\n` +
    `استلمت طلبك: «${cleanPrompt.slice(0, 140)}».\n` +
    `هذا ردّ محاكاة. لم يُستدعَ نموذج ${model} (${providerLabel}).`;

  const messageId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tokens = reply.match(/\S+\s*|\s+/g) ?? [reply];

  for (const token of tokens) {
    if (useWoraStore.getState().roomId !== roomId) return;
    useWoraStore.getState().appendStream({
      messageId,
      agentId: agent.id,
      taskId:  messageId,
      chunk:   token,
      isDone:  false,
    });
    await new Promise((r) => setTimeout(r, 24));
  }

  if (useWoraStore.getState().roomId !== roomId) return;
  useWoraStore.getState().appendStream({
    messageId,
    agentId: agent.id,
    taskId:  messageId,
    chunk:   '',
    isDone:  true,
  });
  useWoraStore.getState().updateAgentLifecycle(agent.id, AgentLifecycleState.Idle, AvatarAnimState.Idle);
}

/* ─── STABLE SINGLETON ACTIONS ──────────────────────────── */
function emitSafe(event: string, payload?: unknown): boolean {
  if (!singletonSocket || !singletonSocket.connected) return false;
  singletonSocket.emit(event, payload);
  return true;
}

function sendMessage(content: string, options?: { replyToId?: string; targetAgentId?: string | null }): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const state = useWoraStore.getState();
  const hasMention = /@[\p{L}\p{N}_-]{2,}/u.test(trimmed);
  const targetId = options?.targetAgentId === null ? undefined : options?.targetAgentId ?? state.selectedAgentId ?? undefined;
  const targetAgent = targetId ? state.agents[targetId] : undefined;
  const isCustomOnlyTarget = Boolean(!hasMention && targetAgent?.id.startsWith('agent-custom-'));

  if (state.connected && singletonSocket?.connected && !isCustomOnlyTarget) {
    return emitSafe('message:send', {
      roomId:  state.roomId,
      content: trimmed,
      type:    hasMention ? MessageType.Mention : MessageType.Text,
      ...(options?.replyToId ? { replyToId: options.replyToId } : {}),
      ...(!hasMention && targetId ? { targetAgentId: targetId } : {}),
    });
  }

  if (!isCustomOnlyTarget && requiresWorkspaceConnection(state)) return false;

  // Standalone interactive simulation fallback
  const userMsg: Message = {
    id:        `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    roomId:    state.roomId,
    senderId:  state.localUserId,
    type:      hasMention ? MessageType.Mention : MessageType.Text,
    content:   trimmed,
    timestamp: new Date().toISOString(),
    mentions:  [],
  };
  state.addMessage(userMsg);

  const targets = resolveLocalTargets(trimmed, targetId);
  for (const ag of targets) {
    void runLocalSimulatedStream(ag, trimmed);
  }
  return true;
}

function networkPosition(position: { x: number; y: number; z: number }) {
  const clamp = (value: number) => Math.max(-500, Math.min(500, Number(value.toFixed(2))));
  return { x: clamp((position.x - 800) / 20), y: 0, z: clamp((position.z - 480) / 20) };
}

function movePlayer(position: { x: number; y: number; z: number }): boolean {
  const state = useWoraStore.getState();
  state.setLocalPosition(position);
  const now = Date.now();
  if (now - lastMoveSentAt < MOVE_THROTTLE_MS) return false;
  lastMoveSentAt = now;
  if (singletonSocket?.connected) return emitSafe('room:move', { roomId: state.roomId, position: networkPosition(position) });
  return true;
}

function swapBrain(agentId: string, brain: PublicBrainConfig, reason?: string): boolean {
  if (!agentId || !brain.provider || !brain.model) return false;

  const nextBrain: PublicBrainConfig = {
    provider: brain.provider,
    model:    brain.model,
    ...(brain.maxTokens !== undefined ? { maxTokens: brain.maxTokens } : {}),
    ...(brain.temperature !== undefined ? { temperature: brain.temperature } : {}),
  };

  const state = useWoraStore.getState();
  // Always apply cleanly for instant visual feedback (and for custom local agents)
  state.updateAgentBrain(agentId, nextBrain);

  if (singletonSocket?.connected && !agentId.startsWith('agent-custom-')) {
    emitSafe('agent:brain-swap', {
      agentId,
      newBrain:    nextBrain,
      requestedBy: state.localUserId,
      ...(reason ? { reason } : {}),
    });
  }
  return true;
}

function recordWorkspaceEntry(entry: SharedWorkspaceEntry) {
  const state = useWoraStore.getState();
  if (entry.roomId !== state.roomId || !Object.hasOwn(ROOM_BY_ID, entry.zoneId)) return;
  const entries = state.workspaces[entry.zoneId]?.entries ?? [];
  const previous = entries.find((item) => item.id === entry.id);
  if (previous && previous.updatedAt > entry.updatedAt) return;
  state.upsertWorkspace({
    zoneId: entry.zoneId, roomId: entry.roomId,
    entries: previous ? entries.map((item) => item.id === entry.id ? entry : item) : [...entries.slice(-199), entry],
    lastWriteAt: entry.updatedAt, lastWrittenBy: entry.authorAgentId,
  });
  const target = entry.targetAgentId ? state.agents[entry.targetAgentId] : undefined;
  const scope = isLocalTask(entry) ? 'local' : state.serverMode ?? 'server';
  if (!previous && target && entry.type === 'task') state.pushActivity(`أُسندت إلى ${target.displayName}: ${entry.title}`, scope);
  if (
    previous && entry.type === 'task' && previous.targetAgentId && entry.targetAgentId
    && previous.targetAgentId !== entry.targetAgentId
    && state.agents[previous.targetAgentId] && state.agents[entry.targetAgentId]
  ) {
    // A recorded task changed assignee: route the previous owner through the real
    // office corridor network toward the new owner's department. No task progress is invented.
    state.triggerHandoff(previous.targetAgentId, entry.targetAgentId);
    state.pushActivity(`تحويل مهمة مسجّلة: ${entry.title} → ${state.agents[entry.targetAgentId]!.displayName}`, scope);
  }
  if (previous && previous.status !== entry.status) {
    if (isFinished(entry)) state.pushActivity(`اكتملت: ${entry.title}`, scope);
    else if (typeof entry.payload['directorResponse'] === 'string' && entry.status === 'review_pending') state.pushActivity(`ردّ الوكيل جاهز: ${entry.title}`, scope);
  }
}

export type AssignmentResult = { ok: true; entryId: string; zoneId: string; scope: TaskScope } | { ok: false; reason: 'invalid' | 'rejected' | 'unconfirmed' };

type AssignmentWire = { ok: true; entry: SharedWorkspaceEntry } | { ok: false; code: string };

async function sendWorkspaceSignal(zoneId: string, agentId: string, title: string, data: { source?: 'hq-board' | 'director'; brief?: string } = {}): Promise<AssignmentResult> {
  const cleanTitle = title.trim();
  const state = useWoraStore.getState();
  const agent = Object.hasOwn(state.agents, agentId) ? state.agents[agentId] : undefined;
  if (!cleanTitle || cleanTitle.length > 200 || (data.brief?.length ?? 0) > TASK_BRIEF_LIMIT || !Object.hasOwn(ROOM_BY_ID, zoneId) || !agent || !canTakeTask(agent)
    || (data.source === 'director' && (agent.zoneId !== zoneId || (data.brief?.trim().length ?? 0) < 5)) || isRoomLockedForPlan(zoneId, useBillingStore.getState().plan)) {
    return { ok: false, reason: 'invalid' };
  }

  function finish(entry: SharedWorkspaceEntry, scope: TaskScope): AssignmentResult {
    const current = useWoraStore.getState();
    if (entry.roomId !== current.roomId) return { ok: false, reason: 'unconfirmed' };
    if (!current.workspaces[zoneId]?.entries.some((item) => item.id === entry.id)) recordWorkspaceEntry(entry);
    if (current.agentLocations[agentId]?.areaId !== zoneId) current.dispatchAgentToRoom(agentId, zoneId);
    return { ok: true, scope, zoneId, entryId: entry.id };
  }

  if (!state.connected && !agentId.startsWith('agent-custom-') && requiresWorkspaceConnection(state)) return { ok: false, reason: 'rejected' };

  if (state.serverMode && !agentId.startsWith('agent-custom-') && state.zones.some((zone) => zone.id === zoneId)) {
    if (!state.connected || !singletonSocket?.connected) return { ok: false, reason: 'rejected' };
    try {
      const ack: AssignmentWire | undefined = await singletonSocket.timeout(6_500).emitWithAck('workspace:signal', { zoneId, agentId, title: cleanTitle, data });
      if (!ack || (ack.ok && (!ack.entry || ack.entry.zoneId !== zoneId || ack.entry.targetAgentId !== agentId))) return { ok: false, reason: 'unconfirmed' };
      return ack.ok ? finish(ack.entry, state.serverMode) : { ok: false, reason: ack.code === 'WORKSPACE_UNCONFIRMED' ? 'unconfirmed' : 'rejected' };
    } catch { return { ok: false, reason: 'unconfirmed' }; }
  }

  const now = new Date().toISOString();
  return finish({
    id: `${LOCAL_TASK_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, zoneId, roomId: state.roomId,
    type: 'task', status: 'open', authorAgentId: state.localUserId, targetAgentId: agentId, title: cleanTitle,
    payload: data.source === 'director' ? { ...data, directorExecution: 'unavailable' } : data, createdAt: now, updatedAt: now, chainIds: [],
  }, 'local');
}

async function recommendDirector(brief: string, candidates: { agentId: string; workload: number }[]) {
  const state = useWoraStore.getState();
  if (!state.connected || state.serverMode !== 'server' || !singletonSocket?.connected || !readSessionToken() || candidates.length < 2) return null;
  try {
    const response: unknown = await singletonSocket.timeout(7_500).emitWithAck('director:recommend', { brief, candidates });
    if (!response || typeof response !== 'object') return null;
    const result = response as { ok?: unknown; agentId?: unknown; skill?: unknown };
    return result.ok === true && typeof result.agentId === 'string' && candidates.some((candidate) => candidate.agentId === result.agentId)
      && typeof result.skill === 'string' && result.skill.length >= 2 && result.skill.length <= 200
      ? { agentId: result.agentId, skill: result.skill } : null;
  } catch { return null; }
}

export interface SocketActions {
  sendMessage:         typeof sendMessage;
  movePlayer:          typeof movePlayer;
  swapBrain:           typeof swapBrain;
  sendWorkspaceSignal: typeof sendWorkspaceSignal;
  recommendDirector:   typeof recommendDirector;
  getSocket:           () => Socket | null;
}

const SOCKET_ACTIONS: SocketActions = Object.freeze({
  sendMessage,
  movePlayer,
  swapBrain,
  sendWorkspaceSignal,
  recommendDirector,
  getSocket: () => singletonSocket,
});

export function useSocketLifecycle(): void {
  useEffect(() => {
    activeLifecycleOwners += 1;
    if (pendingTeardownTimer) {
      clearTimeout(pendingTeardownTimer);
      pendingTeardownTimer = null;
    }

    const socket = getSocket();
    if (!socket.connected && !socket.active) {
      socket.connect();
    }

    return () => {
      activeLifecycleOwners = Math.max(0, activeLifecycleOwners - 1);
      if (activeLifecycleOwners === 0) {
        pendingTeardownTimer = setTimeout(() => {
          pendingTeardownTimer = null;
          if (activeLifecycleOwners === 0) {
            destroySocket();
          }
        }, TEARDOWN_GRACE_MS);
      }
    };
  }, []);
}

export function useSocket(): SocketActions {
  return SOCKET_ACTIONS;
}
