/**
 * useSocket.ts — Wora Agent OS (Singleton Socket Manager)
 * ───────────────────────────────────────────────────────────────────
 * Eliminates the multi-socket bug where calling `useSocket()` across
 * `SocketBridge`, `ChatPanel`, and `BrainSwapModal` opened multiple
 * parallel WebSocket connections, duplicated every streamed token,
 * appended ghost empty messages, and wiped Redis presence on modal close.
 *
 * Design:
 *  - Exactly ONE module-scoped Socket.IO instance & listener set exists.
 *  - `useSocketLifecycle()` is mounted once at the root (`SocketBridge`)
 *    and handles React 18 `<StrictMode>` double-invocation gracefully via
 *    deferred teardown.
 *  - `useSocket()` returns stable, zero-subscription action dispatchers
 *    (`sendMessage`, `movePlayer`, `swapBrain`, `sendWorkspaceSignal`)
 *    safe to call from any component without opening new connections or
 *    causing store-wide re-renders.
 */

import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useWoraStore, type PresenceEntry } from '../store/useWoraStore.js';
import { MessageType } from '../types.js';
import type {
  AgentLifecycleState,
  AgentParticipant,
  AvatarAnimState,
  BrainSwapBroadcast,
  Message,
  MessageStreamPayload,
  PublicBrainConfig,
  SharedWorkspaceState,
  WorkspaceUpdatePayload,
  WorkspaceZone,
} from '../types.js';

/* ─── CONFIG ────────────────────────────────────────────── */
function resolveSocketUrl(): string {
  const explicit =
    (import.meta.env['VITE_SOCKET_URL'] as string | undefined)?.trim() ||
    (import.meta.env['VITE_API_URL'] as string | undefined)?.trim();
  return explicit || window.location.origin;
}

function resolveAuthToken(): string | undefined {
  try {
    const stored = window.localStorage.getItem('wora:authToken')?.trim();
    if (stored) return stored;
  } catch {
    // localStorage may be blocked in restricted contexts
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
const MOVE_THROTTLE_MS    = 100;
const TEARDOWN_GRACE_MS   = 150; // Absorbs React 18 StrictMode unmount→remount cycle

let singletonSocket: Socket | null = null;
let activeLifecycleOwners = 0;
let pendingTeardownTimer: ReturnType<typeof setTimeout> | null = null;
let lastMoveSentAt = 0;

function attachListeners(socket: Socket): void {
  socket.on('connect', () => {
    const state = useWoraStore.getState();
    state.setConnected(true);
    socket.emit('room:join', {
      roomId:   state.roomId,
      position: state.localPosition,
    });
  });

  socket.on('disconnect', () => {
    useWoraStore.getState().setConnected(false);
  });

  socket.on('connect_error', (err: Error) => {
    const state = useWoraStore.getState();
    state.setConnected(false);
    state.setConnectionError(err.message);
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
    if (data?.participant?.isAgent) {
      state.upsertAgent(data.participant);
    }
    if (data?.presence) {
      state.upsertPresence(data.presence);
    }
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
        (data.avatarState ?? 'idle') as AvatarAnimState,
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

/** Lazily creates and returns the single shared Socket.IO client instance */
export function getSocket(): Socket {
  if (singletonSocket) return singletonSocket;

  const { localUserId } = useWoraStore.getState();
  const token = resolveAuthToken();

  const socket = io(resolveSocketUrl(), {
    transports:           ['websocket', 'polling'],
    withCredentials:      true,
    auth: {
      userId:      localUserId,
      displayName: 'You',
      ...(token ? { token } : {}),
    },
    reconnection:         true,
    reconnectionAttempts: Infinity,
    reconnectionDelay:    1_500,
    reconnectionDelayMax: 10_000,
    timeout:              10_000,
    path:                 '/socket.io',
  });

  attachListeners(socket);
  singletonSocket = socket;
  return socket;
}

/** Explicitly disconnects and disposes the singleton socket */
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

/* ─── STABLE SINGLETON ACTION DISPATCHERS ───────────────── */
function emitSafe(event: string, payload?: unknown): boolean {
  if (!singletonSocket || !singletonSocket.connected) return false;
  singletonSocket.emit(event, payload);
  return true;
}

function sendMessage(content: string, options?: { replyToId?: string; targetAgentId?: string }): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const { roomId, selectedAgentId } = useWoraStore.getState();
  const hasMention = /@[\p{L}\p{N}_-]{2,}/u.test(trimmed);

  return emitSafe('message:send', {
    roomId,
    content: trimmed,
    type:    hasMention ? MessageType.Mention : MessageType.Text,
    ...(options?.replyToId ? { replyToId: options.replyToId } : {}),
    ...(!hasMention && (options?.targetAgentId ?? selectedAgentId)
      ? { targetAgentId: options?.targetAgentId ?? selectedAgentId ?? undefined }
      : {}),
  });
}

function movePlayer(position: { x: number; y: number; z: number }): boolean {
  const now = Date.now();
  if (now - lastMoveSentAt < MOVE_THROTTLE_MS) return false;
  lastMoveSentAt = now;

  const state = useWoraStore.getState();
  state.setLocalPosition(position);
  return emitSafe('room:move', { roomId: state.roomId, position });
}

function swapBrain(agentId: string, brain: PublicBrainConfig, reason?: string): boolean {
  if (!agentId || !brain.provider || !brain.model) return false;
  const { localUserId } = useWoraStore.getState();
  return emitSafe('agent:brain-swap', {
    agentId,
    newBrain: {
      provider: brain.provider,
      model:    brain.model,
      ...(brain.maxTokens !== undefined ? { maxTokens: brain.maxTokens } : {}),
      ...(brain.temperature !== undefined ? { temperature: brain.temperature } : {}),
    },
    requestedBy: localUserId,
    ...(reason ? { reason } : {}),
  });
}

function sendWorkspaceSignal(
  zoneId: string,
  agentId: string,
  title: string,
  data: Record<string, unknown> = {},
): boolean {
  return emitSafe('workspace:signal', { zoneId, agentId, title, data });
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

/* ─── HOOKS ─────────────────────────────────────────────── */
/**
 * Mount ONCE in the root `<SocketBridge />` component.
 * Manages the lifecycle of the single shared Socket.IO connection.
 */
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

/**
 * Safe to call in ANY component (`ChatPanel`, `AgentSidebar`, `World`, etc.).
 * Never creates additional sockets and never subscribes to store updates.
 */
export function useSocket(): SocketActions {
  return SOCKET_ACTIONS;
}
