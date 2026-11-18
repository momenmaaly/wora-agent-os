import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import {
  AgentLifecycleState,
  AgentOrigin,
  AvatarAnimState,
  MessageType,
  ParticipantStatus,
} from '../types.js';
import type {
  AgentParticipant,
  AgentSkillUpdate,
  BrainProvider,
  Message,
  PublicBrainConfig,
  SharedWorkspaceState,
  WorkspaceZone,
} from '../types.js';
import {
  AGENT_ROLE_AR,
  DEFAULT_COMPANY_AGENTS,
  DEFAULT_COMPANY_ZONES,
} from '../office/catalog.js';
import { CHANNELS, CHANNEL_BY_ID } from '../office/channels.js';

import { isLocalTask, type ServerMode, type TaskScope } from '../office/work.js';

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

export interface ActivityFeedItem {
  id:        string;
  text:      string;
  scope:     TaskScope | 'session';
  timestamp: string;
}

export interface HireAgentInput {
  displayName: string;
  customRole:  string;
  zoneId:      string;
  avatarColor: string;
  provider:    BrainProvider;
  model:       string;
}

export interface WoraState {
  roomId:            string;
  connected:         boolean;
  serverMode:        ServerMode | null;
  demoMode:          boolean;
  connectionError:   string | null;
  agents:            Record<string, AgentParticipant>;

  zones:             WorkspaceZone[];

  messages:          Message[];
  workspaces:        Record<string, SharedWorkspaceState>;
  activeStreams:     Record<string, StreamChunk>;
  activityLog:       ActivityFeedItem[];
  selectedAgentId:   string | null;

  localUserId:       string;
  workspaceUserId:   string;
  ui: {
    theme:            'light' | 'dark';
    showWorkspaceHUD: boolean;
    workspaceZoneId:  string | null;
    workspaceEntryId: string | null;
    showChat:         boolean;

    modelSwapAgentId: string | null;
    showHireModal:    boolean;
    skillsDialog:     { agentId: string; mode: 'catalog' | 'import' } | null;
  };

  setConnected:           (v: boolean) => void;
  setDemoMode:            (v: boolean) => void;
  setConnectionError:     (e: string | null) => void;
  setRoomState:           (state: {
    roomId?:        string;
    userId?:        string;
    mode:           ServerMode;
    participants:   AgentParticipant[];

    zones:          WorkspaceZone[];
    recentMessages: Message[];
    workspaces:     SharedWorkspaceState[];
  }) => void;
  upsertAgent:            (agent: AgentParticipant) => void;
  hireAgent:              (input: HireAgentInput) => AgentParticipant;
  removeCustomAgent:      (agentId: string) => void;
  updateAgentLifecycle:   (agentId: string, state: AgentLifecycleState, avatarState: AvatarAnimState, revision?: number) => void;
  updateAgentSkills:      (event: AgentSkillUpdate) => void;
  updateAgentBrain:       (agentId: string, brain: PublicBrainConfig) => void;

  pushActivity:           (text: string, scope: TaskScope) => void;

  addMessage:             (msg: Message) => void;
  appendStream:           (input: AppendStreamInput) => void;
  upsertWorkspace:        (ws: SharedWorkspaceState) => void;
  selectAgent:            (id: string | null) => void;

  toggleTheme:            () => void;
  toggleWorkspaceHUD:     (force?: boolean, zoneId?: string | null, entryId?: string) => void;
  toggleChat:             (force?: boolean) => void;

  openModelSwap:          (agentId: string | null) => void;
  openAgentSkills:        (agentId: string | null, mode?: 'catalog' | 'import') => void;
  setShowHireModal:       (open: boolean) => void;

}

const USER_ID_STORAGE_KEY = 'wora:localUserId';
const THEME_STORAGE_KEY   = 'wora:hqTheme';
const MAX_MESSAGES        = 200;
const MAX_ACTIVITY        = 28;

function getOrCreateUserId(): string {
  try {
    const stored = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (stored && /^[a-zA-Z0-9_-]{6,64}$/.test(stored)) return stored;
    const rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 12);
    const created = `user-${rand}`;
    window.localStorage.setItem(USER_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `user-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function readInitialTheme(): 'light' | 'dark' {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // ignore storage errors
  }
  return 'dark';
}

function applyDomTheme(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080e17' : '#edf3f4');
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

function buildInitialAgents(): Record<string, AgentParticipant> {
  const map: Record<string, AgentParticipant> = {};
  for (const a of DEFAULT_COMPANY_AGENTS) {
    map[a.id] = a;
  }
  return map;
}

function makeActivityItem(text: string, scope: ActivityFeedItem['scope'] = 'session'): ActivityFeedItem {
  return {
    id:        `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    scope,
    timestamp: new Date().toISOString(),
  };
}

export const useWoraStore = create<WoraState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      const localUserId = getOrCreateUserId();
      const roomId = `wora-${localUserId}`;
      const initialTheme = readInitialTheme();
      applyDomTheme(initialTheme);

      const initialAgents = buildInitialAgents();

      return {
        roomId,
        connected:        false,
        serverMode:       null,
        demoMode:         false,
        connectionError:  null,
        agents:           initialAgents,
        zones:            DEFAULT_COMPANY_ZONES,
        messages:         [],
        workspaces:       {},
        activeStreams:    {},
        activityLog:      [],
        selectedAgentId: null,
        localUserId,
        workspaceUserId: localUserId,
        ui: {
          theme:            initialTheme,
          showWorkspaceHUD: false,
          workspaceZoneId:  null,
          workspaceEntryId: null,
          showChat:         false,
          modelSwapAgentId: null,
          showHireModal:    false,
          skillsDialog:     null,
        },

        setConnected:       (v)  => set({ connected: v, demoMode: v ? false : get().demoMode, connectionError: v ? null : get().connectionError, ...(!v && get().serverMode ? { activeStreams: {} } : {}) }),
        setDemoMode:        (v)  => set({ demoMode: v }),
        setConnectionError: (e)  => set({ connectionError: e }),

        setRoomState: ({ roomId: nextRoomId, userId, mode, participants, zones, recentMessages, workspaces }) => {
          const state = get();
          const roomId = nextRoomId ?? state.roomId;
          const sameRoom = roomId === state.roomId;
          const serverAgents = participants.filter((p) => p.isAgent);

          // A connected snapshot is authoritative, including empty lists. Keep only
          // explicit session-local additions from the standalone preview.
          const nextAgents = Object.create(null) as Record<string, AgentParticipant>;
          for (const p of serverAgents) {
            const roleAr = AGENT_ROLE_AR[p.id];
            const previous = sameRoom ? state.agents[p.id] : undefined;
            const previousSkills = previous?.skillSnapshot;
            const skillSnapshot = previousSkills && previousSkills.revision > (p.skillSnapshot?.revision ?? 0) ? previousSkills : p.skillSnapshot;
            const newerLifecycle = previous?.lifecycleRevision && p.lifecycleRevision !== undefined && previous.lifecycleRevision > p.lifecycleRevision ? previous : p;
            nextAgents[p.id] = { ...p, skillSnapshot, lifecycleRevision: newerLifecycle.lifecycleRevision, lifecycleState: newerLifecycle.lifecycleState,
              avatarState: newerLifecycle.avatarState, profile: roleAr ? { ...p.profile, customRole: roleAr } : p.profile };
          }
          for (const agent of Object.values(state.agents)) {
            if (sameRoom && agent.id.startsWith('agent-custom-') && !(agent.id in nextAgents)) nextAgents[agent.id] = agent;
          }

          const wsMap: Record<string, SharedWorkspaceState> = Object.fromEntries(workspaces.filter((ws) => ws.roomId === roomId && Object.hasOwn(CHANNEL_BY_ID, ws.zoneId)).map((ws) => [ws.zoneId, ws]));
          for (const local of sameRoom ? Object.values(state.workspaces) : []) {
            const additions = local.entries.filter(isLocalTask);
            if (additions.length) wsMap[local.zoneId] = { ...local, ...wsMap[local.zoneId], entries: [...(wsMap[local.zoneId]?.entries ?? []), ...additions] };
          }

          set({
            roomId,
            workspaceUserId: userId ?? state.localUserId,
            ui: sameRoom ? state.ui : { ...state.ui, skillsDialog: null },
            connected:      true,
            serverMode:     mode,
            demoMode:       false,
            connectionError: null,
            agents:         nextAgents,
            zones,
            messages:       recentMessages.filter((message) => message.roomId === roomId).slice(-MAX_MESSAGES),
            activityLog:    sameRoom ? state.activityLog : [],
            workspaces:     wsMap,
            selectedAgentId: state.selectedAgentId && nextAgents[state.selectedAgentId] ? state.selectedAgentId : null,
            activeStreams:  {},
          });
        },

        upsertAgent: (agent) =>
          set((s) => ({ agents: { ...s.agents, [agent.id]: agent } })),

        hireAgent: (input) => {
          const id = `agent-custom-${Date.now().toString(36)}`;
          const now = new Date().toISOString();
          const room = CHANNEL_BY_ID[input.zoneId] ?? CHANNELS[0];
          const newAgent: AgentParticipant = {
            id,
            displayName:     input.displayName.trim(),
            isHuman:         false,
            isAgent:         true,
            origin:          AgentOrigin.Internal,
            zoneId:          room.id,
            lifecycleState:  AgentLifecycleState.Idle,
            socketId:        null,
            assignedRoomIds: [],
            modelId:         input.model,
            activeTasks:     0,
            brainConfig: {
              provider:    input.provider,
              model:       input.model,
              maxTokens:   2048,
              temperature: 0.6,
            },
            avatarState:   AvatarAnimState.Idle,
            locale:        'ar',
            createdAt:     now,
            lastSeenAt:    now,
            status:        ParticipantStatus.Online,
            activeRoomIds: [get().roomId],
            profile: {
              customRole:  input.customRole.trim(),
              tone:        'Analytical',
              avatarColor: input.avatarColor,
              tagline:     `عضو فريق ${room.nameAr}`,
              specialty:   input.customRole.trim(),
              skills:      [room.nameAr, input.model],
            },
          };

          set((s) => ({
            agents: { ...s.agents, [id]: newAgent },
            selectedAgentId: id,
            activityLog: [
              makeActivityItem(
                `أُضيف ${newAgent.displayName} إلى قناة ${room.nameAr}`,
              ),
              ...s.activityLog,
            ].slice(0, MAX_ACTIVITY),
          }));

          return newAgent;
        },

        removeCustomAgent: (agentId) =>
          set((s) => {
            if (!agentId.startsWith('agent-custom-') || !(agentId in s.agents)) return s;
            const nextAgents = { ...s.agents };
            const removed = nextAgents[agentId];
            delete nextAgents[agentId];
            return {
              agents:          nextAgents,
              selectedAgentId: s.selectedAgentId === agentId ? null : s.selectedAgentId,
              activityLog: removed
                ? [makeActivityItem(`أُزيل ${removed.displayName} من الفريق`), ...s.activityLog].slice(0, MAX_ACTIVITY)
                : s.activityLog,
            };
          }),

        updateAgentLifecycle: (agentId, state, avatarState, revision) =>
          set((s) => {
            const ag = s.agents[agentId];
            if (!ag || (revision !== undefined && (ag.lifecycleRevision ?? 0) >= revision)
              || (revision === undefined && ag.lifecycleState === state && ag.avatarState === avatarState)) return s;
            return { agents: { ...s.agents, [agentId]: { ...ag, lifecycleState: state, avatarState, lifecycleRevision: revision } } };
          }),

        updateAgentSkills: ({ roomId, agentId, revision, activeNames }) =>
          set((s) => {
            const agent = s.agents[agentId];
            if (s.roomId !== roomId || !agent || (agent.skillSnapshot?.revision ?? -1) >= revision) return s;
            return { agents: { ...s.agents, [agentId]: { ...agent, skillSnapshot: { revision, activeNames } } } };
          }),

        updateAgentBrain: (agentId, brain) =>
          set((s) => {
            const ag = s.agents[agentId];
            if (!ag) return s;
            const changed = ag.brainConfig?.model !== brain.model || ag.brainConfig?.provider !== brain.provider;
            return {
              agents: {
                ...s.agents,
                [agentId]: { ...ag, brainConfig: brain, modelId: brain.model },
              },
              activityLog: changed
                ? [
                    makeActivityItem(
                      `تم تحديث موديل ${ag.displayName} إلى ${brain.model}`,
                    ),
                    ...s.activityLog,
                  ].slice(0, MAX_ACTIVITY)
                : s.activityLog,
            };
          }),

        pushActivity: (text, scope) =>
          set((s) => ({
            activityLog: [makeActivityItem(text, scope), ...s.activityLog].slice(0, MAX_ACTIVITY),
          })),

        addMessage: (msg) =>
          set((s) => {
            if (s.messages.some((m) => m.id === msg.id)) return s;
            return { messages: [...s.messages.slice(-(MAX_MESSAGES - 1)), msg] };
          }),

        appendStream: ({ messageId, agentId, taskId, chunk, isDone, aborted }) =>
          set((s) => {
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

        selectAgent: (id) => set({ selectedAgentId: id }),

        toggleTheme: () =>
          set((s) => {
            const next = s.ui.theme === 'light' ? 'dark' : 'light';
            applyDomTheme(next);
            return { ui: { ...s.ui, theme: next } };
          }),

        toggleWorkspaceHUD: (force, zoneId, entryId) => set((s) => {
          const show = force ?? !s.ui.showWorkspaceHUD;
          return { ui: { ...s.ui, showWorkspaceHUD: show, workspaceZoneId: show ? zoneId ?? null : null, workspaceEntryId: show ? entryId ?? null : null, showChat: show ? false : s.ui.showChat } };
        }),
        toggleChat: (force) => set((s) => {
          const show = force ?? !s.ui.showChat;
          return { ui: { ...s.ui, showChat: show, showWorkspaceHUD: show ? false : s.ui.showWorkspaceHUD } };
        }),
        openAgentSkills: (agentId, mode = 'catalog') => set((s) => ({ ui: { ...s.ui, skillsDialog: agentId ? { agentId, mode } : null } })),
        openModelSwap:      (agentId) => set((s) => ({ ui: { ...s.ui, modelSwapAgentId: agentId } })),
        setShowHireModal:   (open) => set((s) => ({ ui: { ...s.ui, showHireModal: open } })),

      };
    }),
    { name: 'WoraCommandStore' },
  ),
);
