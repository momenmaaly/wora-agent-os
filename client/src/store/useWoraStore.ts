import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { MessageType } from '../types.js';
import type {
  AgentParticipant,
  WorkspaceZone,
  Message,
  SharedWorkspaceState,
  PublicBrainConfig,
  AvatarAnimState,
  AgentLifecycleState,
} from '../types.js';

export interface PresenceEntry {
  participantId: string;
  roomId:        string;
  position:      { x: number; y: number; z: number };
  joinedAt:      string;
}

export interface StreamChunk {
  messageId: string;
  agentId:   string;
  taskId:    string;
  content:   string;
  isDone:    boolean;
}

export interface AppendStreamInput {
  messageId: string;
  agentId:   string;
  taskId:    string;
  chunk:     string;
  isDone:    boolean;
  aborted?:  boolean;
}

export interface WoraState {
  roomId:          string;
  connected:       boolean;
  connectionError: string | null;
  agents:          Record<string, AgentParticipant>;
  zones:           WorkspaceZone[];
  presence:        Record<string, PresenceEntry>;
  messages:        Message[];
  workspaces:      Record<string, SharedWorkspaceState>;
  activeStreams:   Record<string, StreamChunk>;
  selectedAgentId: string | null;
  localUserId:     string;
  localPosition:   { x: number; y: number; z: number };
  ui: {
    showSidebar:      boolean;
    showWorkspaceHUD: boolean;
    chatExpanded:     boolean;
  };

  setRoomId:            (id: string) => void;
  setConnected:         (v: boolean) => void;
  setConnectionError:   (e: string | null) => void;
  setRoomState:         (state: {
    roomId?:        string;
    participants:   AgentParticipant[];
    presence:       PresenceEntry[];
    zones:          WorkspaceZone[];
    recentMessages: Message[];
    workspaces:     SharedWorkspaceState[];
  }) => void;
  upsertAgent:          (agent: AgentParticipant) => void;
  updateAgentLifecycle: (agentId: string, state: AgentLifecycleState, avatarState: AvatarAnimState) => void;
  updateAgentBrain:     (agentId: string, brain: PublicBrainConfig) => void;
  upsertPresence:       (entry: PresenceEntry) => void;
  removePresence:       (participantId: string) => void;
  addMessage:           (msg: Message) => void;
  appendStream:         (input: AppendStreamInput) => void;
  upsertWorkspace:      (ws: SharedWorkspaceState) => void;
  selectAgent:          (id: string | null) => void;
  setLocalPosition:     (pos: { x: number; y: number; z: number }) => void;
  toggleSidebar:        () => void;
  toggleWorkspaceHUD:   () => void;
  toggleChat:           () => void;
}

const USER_ID_STORAGE_KEY = 'wora:localUserId';
const MAX_MESSAGES = 200;

function getOrCreateUserId(): string {
  try {
    const stored = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (stored && /^[a-zA-Z0-9_-]{6,64}$/.test(stored)) {
      return stored;
    }
    const randomPart =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 12);
    const created = `user-${randomPart}`;
    window.localStorage.setItem(USER_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `user-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export const useWoraStore = create<WoraState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      const localUserId = getOrCreateUserId();

      return {
        roomId:          `wora-${localUserId}`,
        connected:       false,
        connectionError: null,
        agents:          {},
        zones:           [],
        presence:        {},
        messages:        [],
        workspaces:      {},
        activeStreams:   {},
        selectedAgentId: null,
        localUserId,
        localPosition:   { x: 0, y: 0, z: 2 },
        ui: {
          showSidebar:      true,
          showWorkspaceHUD: false,
          chatExpanded:     true,
        },

        setRoomId:          (id) => set({ roomId: id }),
        setConnected:       (v)  => set({ connected: v, connectionError: v ? null : get().connectionError }),
        setConnectionError: (e)  => set({ connectionError: e }),

        setRoomState: ({ roomId, participants, presence, zones, recentMessages, workspaces }) => {
          const agents: Record<string, AgentParticipant> = {};
          for (const p of participants) {
            if (p.isAgent) agents[p.id] = p;
          }
          const presenceMap: Record<string, PresenceEntry> = {};
          for (const p of presence) presenceMap[p.participantId] = p;

          const wsMap: Record<string, SharedWorkspaceState> = {};
          for (const ws of workspaces) wsMap[ws.zoneId] = ws;

          set((s) => ({
            roomId:        roomId ?? s.roomId,
            agents,
            zones,
            presence:      presenceMap,
            messages:      recentMessages.slice(-MAX_MESSAGES),
            workspaces:    wsMap,
            activeStreams: {},
          }));
        },

        upsertAgent: (agent) =>
          set((s) => ({ agents: { ...s.agents, [agent.id]: agent } })),

        updateAgentLifecycle: (agentId, state, avatarState) =>
          set((s) => {
            const ag = s.agents[agentId];
            if (!ag) return s;
            return {
              agents: {
                ...s.agents,
                [agentId]: { ...ag, lifecycleState: state, avatarState },
              },
            };
          }),

        updateAgentBrain: (agentId, brain) =>
          set((s) => {
            const ag = s.agents[agentId];
            if (!ag) return s;
            return {
              agents: {
                ...s.agents,
                [agentId]: { ...ag, brainConfig: brain, modelId: brain.model },
              },
            };
          }),

        upsertPresence: (entry) =>
          set((s) => ({ presence: { ...s.presence, [entry.participantId]: entry } })),

        removePresence: (id) =>
          set((s) => {
            if (!(id in s.presence)) return s;
            const next = { ...s.presence };
            delete next[id];
            return { presence: next };
          }),

        addMessage: (msg) =>
          set((s) => {
            if (s.messages.some((m) => m.id === msg.id)) return s;
            return { messages: [...s.messages.slice(-(MAX_MESSAGES - 1)), msg] };
          }),

        appendStream: ({ messageId, agentId, taskId, chunk, isDone, aborted }) =>
          set((s) => {
            // Aborted stream (provider error / retry): clear partial bubble cleanly
            if (aborted) {
              if (!(messageId in s.activeStreams)) return s;
              const streams = { ...s.activeStreams };
              delete streams[messageId];
              return { activeStreams: streams };
            }

            const existing = s.activeStreams[messageId];
            const content = (existing?.content ?? '') + chunk;

            if (isDone) {
              const streams = { ...s.activeStreams };
              delete streams[messageId];

              // Never append empty or duplicate bubbles
              if (!content.trim() || s.messages.some((m) => m.id === messageId)) {
                return { activeStreams: streams };
              }

              const finalMsg: Message = {
                id:        messageId,
                roomId:    s.roomId,
                senderId:  agentId,
                type:      MessageType.Text,
                content,
                timestamp: new Date().toISOString(),
                mentions:  [],
              };

              return {
                activeStreams: streams,
                messages:      [...s.messages.slice(-(MAX_MESSAGES - 1)), finalMsg],
              };
            }

            return {
              activeStreams: {
                ...s.activeStreams,
                [messageId]: { messageId, agentId, taskId, content, isDone: false },
              },
            };
          }),

        upsertWorkspace: (ws) =>
          set((s) => ({ workspaces: { ...s.workspaces, [ws.zoneId]: ws } })),

        selectAgent:        (id)  => set({ selectedAgentId: id }),
        setLocalPosition:   (pos) => set({ localPosition: pos }),
        toggleSidebar:      ()    => set((s) => ({ ui: { ...s.ui, showSidebar: !s.ui.showSidebar } })),
        toggleWorkspaceHUD: ()    => set((s) => ({ ui: { ...s.ui, showWorkspaceHUD: !s.ui.showWorkspaceHUD } })),
        toggleChat:         ()    => set((s) => ({ ui: { ...s.ui, chatExpanded: !s.ui.chatExpanded } })),
      };
    }),
    { name: 'WoraStore' },
  ),
);

/* ─── STABLE SELECTORS (Zustand v5 Object.is safe) ─────── */
export const selectAgentsMap     = (s: WoraState) => s.agents;
export const selectAgentById     = (id: string) => (s: WoraState) => s.agents[id] ?? null;
export const selectAgentBrain    = (id: string) => (s: WoraState) => s.agents[id]?.brainConfig ?? null;
export const selectMessages      = (s: WoraState) => s.messages;
export const selectStreams        = (s: WoraState) => s.activeStreams;
export const selectZones         = (s: WoraState) => s.zones;
export const selectPresence      = (s: WoraState) => s.presence;
export const selectWorkspaces    = (s: WoraState) => s.workspaces;
export const selectUI            = (s: WoraState) => s.ui;
export const selectConnected     = (s: WoraState) => s.connected;
export const selectSelectedAgent = (s: WoraState) =>
  s.selectedAgentId ? (s.agents[s.selectedAgentId] ?? null) : null;
