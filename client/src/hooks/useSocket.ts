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
import {
  AgentLifecycleState,
  AvatarAnimState,
  BRAIN_PROVIDER_LABELS,
  BrainProvider,
  MessageType,
} from '../types.js';
import type {
  AgentParticipant,
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

function resolveAuthToken(): string | undefined {
  try {
    const stored = window.localStorage.getItem('wora:authToken')?.trim();
    if (stored) return stored;
  } catch {
    // ignore restricted localStorage
  }
  const envToken = (import.meta.env['VITE_AUTH_TOKEN'] as string | undefined)?.trim();
  return envToken || undefined;
}

/* ─── WIRE PAYLOAD SHAPES ───────────────────────────────── */
interface RoomStateEvent {
  room?:           { id?: string };
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
    state.setConnected(true);
    state.setDemoMode(false);
    socket.emit('room:join', {
      roomId:   state.roomId,
      position: state.localPosition,
    });
  });

  socket.on('disconnect', () => {
    useWoraStore.getState().setConnected(false);
  });

  socket.on('connect_error', (err: Error) => {
    connectFailures += 1;
    const state = useWoraStore.getState();
    state.setConnected(false);
    state.setDemoMode(true);
    state.setConnectionError(err.message);

    // On static preview hosts (e.g. Vercel without VITE_SOCKET_URL), stop noisy retry loops
    if (!getExplicitServerUrl() && connectFailures >= 2) {
      socket.disconnect();
    }
  });

  socket.on('room:state', (data: RoomStateEvent) => {
    useWoraStore.getState().setRoomState({
      roomId:         data?.room?.id,
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
    if (data?.agentId && data?.state) {
      useWoraStore.getState().updateAgentLifecycle(
        data.agentId,
        data.state,
        (data.avatarState ?? AvatarAnimState.Idle) as AvatarAnimState,
      );
    }
  });

  socket.on('agent:brain-updated', (data: Partial<BrainSwapBroadcast>) => {
    if (data?.agentId && data?.newBrain) {
      useWoraStore.getState().updateAgentBrain(data.agentId, data.newBrain);
    }
  });

  socket.on('workspace:update', (data: Partial<WorkspaceUpdatePayload>) => {
    if (!data?.zoneId || !data?.entry) return;
    const state = useWoraStore.getState();
    const existing = state.workspaces[data.zoneId];
    const entries = existing?.entries ?? [];
    const idx = entries.findIndex((e) => e.id === data.entry!.id);
    const nextEntries =
      idx >= 0
        ? entries.map((e, i) => (i === idx ? data.entry! : e))
        : [...entries, data.entry];

    state.upsertWorkspace({
      zoneId:        data.zoneId,
      roomId:        data.roomId ?? state.roomId,
      entries:       nextEntries,
      lastWriteAt:   data.entry.updatedAt ?? new Date().toISOString(),
      lastWrittenBy: data.entry.authorAgentId ?? '',
    });
  });

  socket.on('error', (data: ServerErrorEvent) => {
    const text = data?.message?.trim();
    if (!text) return;
    const state = useWoraStore.getState();
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
  const token = resolveAuthToken();
  const hasExplicitApi = Boolean(getExplicitServerUrl());

  const socket = io(resolveSocketUrl(), {
    transports:           ['websocket', 'polling'],
    withCredentials:      true,
    auth: {
      userId:      localUserId,
      displayName: 'You',
      ...(token ? { token } : {}),
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
      (state.selectedAgentId ? state.agents[state.selectedAgentId] : undefined) ??
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

  // Send agent back toward their workstation if they are out roaming
  if (homeRoom && loc && loc.areaId !== homeRoom.id) {
    store.dispatchAgentToRoom(agent.id, homeRoom.id, 'عائد للمكتب للرد على رسالتك');
  }

  store.updateAgentLifecycle(agent.id, AgentLifecycleState.Thinking, AvatarAnimState.Thinking);
  await new Promise((r) => setTimeout(r, 380));

  store.updateAgentLifecycle(agent.id, AgentLifecycleState.Responding, AvatarAnimState.Talking);

  const cleanPrompt = userText.replace(/@[\p{L}\p{N}_-]+/gu, '').trim() || userText.trim();
  const reply =
    `أهلاً! معك ${agent.displayName} (${agent.profile.customRole}) من ${homeRoom?.nameAr ?? 'مقر الشركة'}.\n` +
    `أعمل حالياً عبر موديل ${model} (${providerLabel})، واستلمت طلبك: «${cleanPrompt.slice(0, 140)}».\n` +
    `جاري التنسيق مع الفريق داخل المقر — ويمكنك ربط الخادم الخلفي في أي وقت لتفعيل الاستدعاء الفعلي لنموذج ${model}.`;

  const messageId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tokens = reply.match(/\S+\s*|\s+/g) ?? [reply];

  for (const token of tokens) {
    useWoraStore.getState().appendStream({
      messageId,
      agentId: agent.id,
      taskId:  messageId,
      chunk:   token,
      isDone:  false,
    });
    await new Promise((r) => setTimeout(r, 24));
  }

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

function sendMessage(content: string, options?: { replyToId?: string; targetAgentId?: string }): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const state = useWoraStore.getState();
  const hasMention = /@[\p{L}\p{N}_-]{2,}/u.test(trimmed);
  const targetId = options?.targetAgentId ?? state.selectedAgentId ?? undefined;
  const targetAgent = targetId ? state.agents[targetId] : undefined;
  const isCustomOnlyTarget = Boolean(!hasMention && targetAgent?.id.startsWith('agent-custom-'));

  if (singletonSocket?.connected && !isCustomOnlyTarget) {
    return emitSafe('message:send', {
      roomId:  state.roomId,
      content: trimmed,
      type:    hasMention ? MessageType.Mention : MessageType.Text,
      ...(options?.replyToId ? { replyToId: options.replyToId } : {}),
      ...(!hasMention && targetId ? { targetAgentId: targetId } : {}),
    });
  }

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

function movePlayer(position: { x: number; y: number; z: number }): boolean {
  const now = Date.now();
  if (now - lastMoveSentAt < MOVE_THROTTLE_MS) return false;
  lastMoveSentAt = now;

  const state = useWoraStore.getState();
  state.setLocalPosition(position);
  if (singletonSocket?.connected) {
    // Clamp into backend's [-500, 500] schema coordinates
    const normalized = {
      x: Math.max(-500, Math.min(500, Number(((position.x - 800) / 20).toFixed(2)))),
      y: 0,
      z: Math.max(-500, Math.min(500, Number(((position.z - 480) / 20).toFixed(2)))),
    };
    return emitSafe('room:move', { roomId: state.roomId, position: normalized });
  }
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

function sendWorkspaceSignal(
  zoneId: string,
  agentId: string,
  title: string,
  data: Record<string, unknown> = {},
): boolean {
  const cleanTitle = title.trim();
  if (!cleanTitle) return false;
  const state = useWoraStore.getState();

  // Dispatch assigned agent toward that department room visually
  if (state.agents[agentId] && ROOM_BY_ID[zoneId]) {
    state.dispatchAgentToRoom(agentId, zoneId, `مهمة جديدة: ${cleanTitle.slice(0, 28)}`);
  }

  if (singletonSocket?.connected && !agentId.startsWith('agent-custom-')) {
    return emitSafe('workspace:signal', { zoneId, agentId, title: cleanTitle, data });
  }

  // Local update for standalone preview mode
  const now = new Date().toISOString();
  const entry: SharedWorkspaceEntry = {
    id:            `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    zoneId,
    roomId:        state.roomId,
    type:          'task',
    status:        'in_progress',
    authorAgentId: agentId,
    title:         cleanTitle,
    payload:       data,
    createdAt:     now,
    updatedAt:     now,
    chainIds:      [],
  };
  const existing = state.workspaces[zoneId]?.entries ?? [];
  state.upsertWorkspace({
    zoneId,
    roomId:        state.roomId,
    entries:       [...existing, entry],
    lastWriteAt:   now,
    lastWrittenBy: agentId,
  });
  return true;
}

export interface SocketActions {
  sendMessage:         typeof sendMessage;
  movePlayer:          typeof movePlayer;
  swapBrain:           typeof swapBrain;
  sendWorkspaceSignal: typeof sendWorkspaceSignal;
  getSocket:           () => Socket | null;
}

const SOCKET_ACTIONS: SocketActions = Object.freeze({
  sendMessage,
  movePlayer,
  swapBrain,
  sendWorkspaceSignal,
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
