import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { RECEPTION_POINT } from '../office/visits.js';
import { useBillingStore } from './useBillingStore.js';
import {
  AgentLifecycleState,
  AgentOrigin,
  AvatarAnimState,
  MessageType,
  ParticipantStatus,
} from '../types.js';
import type {
  AgentParticipant,
  BrainProvider,
  Message,
  PublicBrainConfig,
  SharedWorkspaceState,
  WorkspaceZone,
} from '../types.js';
import {
  AGENT_ROLE_AR,
  buildDefaultWorkspaces,
  DEFAULT_COMPANY_AGENTS,
  DEFAULT_COMPANY_ZONES,
  OFFICE_ROOMS,
  ROOM_BY_ID,
} from '../office/layout.js';

export const LOCAL_TASK_PREFIX = 'local-ws-';

export function workspaceEntryLabel(id: string) {
  return id.startsWith('init-') ? 'مثال للمعاينة' : id.startsWith(LOCAL_TASK_PREFIX) ? 'مهمة محلية' : null;
}

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

export type AgentActivityKind =
  | 'desk'
  | 'walking'
  | 'meeting'
  | 'collab'
  | 'coffee'
  | 'board'
  | 'thinking'
  | 'responding';

export interface AgentLocationSnapshot {
  areaId:           string;
  areaNameAr:       string;
  targetRoomId:     string | null;
  targetRoomNameAr: string | null;
  isWalking:        boolean;
  activity:         AgentActivityKind;
  statusTextAr:     string;
}

export interface ActivityFeedItem {
  id:        string;
  text:      string;
  color:     string;
  timestamp: string;
}

export type OfficeCommand =
  | { seq: number; kind: 'dispatch-room'; agentId: string; roomId: string; spotId?: string; reasonAr?: string; activity?: AgentActivityKind }
  | { seq: number; kind: 'standup' }
  | { seq: number; kind: 'return-desks' }
  | { seq: number; kind: 'handoff'; fromAgentId?: string; toAgentId?: string }
  | { seq: number; kind: 'focus-room'; roomId: string }
  | { seq: number; kind: 'focus-agent'; agentId: string }
  | { seq: number; kind: 'reset-camera' }
  | { seq: number; kind: 'spawn-at-reception'; agentId: string; homeRoomId: string };

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
  demoMode:          boolean;
  connectionError:   string | null;
  agents:            Record<string, AgentParticipant>;
  agentLocations:    Record<string, AgentLocationSnapshot>;
  lastSwappedAgent:  { agentId: string; at: number } | null;
  zones:             WorkspaceZone[];
  presence:          Record<string, PresenceEntry>;
  messages:          Message[];
  workspaces:        Record<string, SharedWorkspaceState>;
  activeStreams:     Record<string, StreamChunk>;
  activityLog:       ActivityFeedItem[];
  selectedAgentId:   string | null;
  followAgentId:     string | null;
  localUserId:       string;
  localPosition:     { x: number; y: number; z: number };
  officeCommand:     OfficeCommand | null;
  ui: {
    theme:            'light' | 'dark';
    showWorkspaceHUD: boolean;
    workspaceZoneId:  string | null;
    showChat:         boolean;
    autoRoam:         boolean;
    modelSwapAgentId: string | null;
    showHireModal:    boolean;
  };

  setRoomId:              (id: string) => void;
  setConnected:           (v: boolean) => void;
  setDemoMode:            (v: boolean) => void;
  setConnectionError:     (e: string | null) => void;
  setRoomState:           (state: {
    roomId?:        string;
    participants:   AgentParticipant[];
    presence:       PresenceEntry[];
    zones:          WorkspaceZone[];
    recentMessages: Message[];
    workspaces:     SharedWorkspaceState[];
  }) => void;
  upsertAgent:            (agent: AgentParticipant) => void;
  hireAgent:              (input: HireAgentInput) => AgentParticipant;
  removeCustomAgent:      (agentId: string) => void;
  updateAgentLifecycle:   (agentId: string, state: AgentLifecycleState, avatarState: AvatarAnimState) => void;
  updateAgentBrain:       (agentId: string, brain: PublicBrainConfig) => void;
  setAgentLocation:       (agentId: string, loc: AgentLocationSnapshot) => void;
  pushActivity:           (text: string, color?: string) => void;
  upsertPresence:         (entry: PresenceEntry) => void;
  removePresence:         (participantId: string) => void;
  addMessage:             (msg: Message) => void;
  appendStream:           (input: AppendStreamInput) => void;
  upsertWorkspace:        (ws: SharedWorkspaceState) => void;
  selectAgent:            (id: string | null) => void;
  setFollowAgent:         (id: string | null) => void;
  setLocalPosition:       (pos: { x: number; y: number; z: number }) => void;
  toggleTheme:            () => void;
  toggleWorkspaceHUD:     (force?: boolean, zoneId?: string | null) => void;
  toggleChat:             (force?: boolean) => void;
  toggleAutoRoam:         () => void;
  openModelSwap:          (agentId: string | null) => void;
  setShowHireModal:       (open: boolean) => void;
  dispatchAgentToRoom:    (agentId: string, roomId: string, reasonAr?: string) => void;
  callTeamStandup:        () => void;
  returnAllToDesks:       () => void;
  triggerHandoff:         (fromAgentId?: string, toAgentId?: string) => void;
  focusRoomCamera:        (roomId: string) => void;
  focusAgentCamera:       (agentId: string) => void;
  resetCamera:            () => void;
}

const USER_ID_STORAGE_KEY = 'wora:localUserId';
const THEME_STORAGE_KEY   = 'wora:hqTheme';
const MAX_MESSAGES        = 200;
const MAX_ACTIVITY        = 28;

let cmdSeq = 1;

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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11101a' : '#f4f2f8');
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

function buildInitialLocations(agents: Record<string, AgentParticipant>): Record<string, AgentLocationSnapshot> {
  const out: Record<string, AgentLocationSnapshot> = {};
  for (const ag of Object.values(agents)) {
    const room = (ag.zoneId ? ROOM_BY_ID[ag.zoneId] : undefined) ?? OFFICE_ROOMS[0]!;
    out[ag.id] = {
      areaId:           room.id,
      areaNameAr:       room.nameAr,
      targetRoomId:     null,
      targetRoomNameAr: null,
      isWalking:        false,
      activity:         'desk',
      statusTextAr:     'على المكتب',
    };
  }
  return out;
}

function makeActivityItem(text: string, color = '#3b82f6'): ActivityFeedItem {
  return {
    id:        `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    color,
    timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
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
        demoMode:         false,
        connectionError:  null,
        agents:           initialAgents,
        agentLocations:   buildInitialLocations(initialAgents),
        lastSwappedAgent: null,
        zones:            DEFAULT_COMPANY_ZONES,
        presence:         {},
        messages: [
          {
            id:        'welcome-hq-1',
            roomId,
            senderId:  'agent-planner-01',
            type:      MessageType.Text,
            content:
              'أهلاً بك في مقر Wora! اختر وكيلاً لمراسلته، أو اكتب @ متبوعة باسمه. جرّب أن تطلب من الفريق مساعدتك في تخطيط مشروعك القادم.',
            timestamp: new Date().toISOString(),
            mentions:  [],
          },
        ],
        workspaces:      buildDefaultWorkspaces(roomId),
        activeStreams:   {},
        activityLog: [
          makeActivityItem('تم افتتاح مقر الشركة وتوزيع الوكلاء على غرف الأقسام', '#4f46e5'),
        ],
        selectedAgentId: null,
        followAgentId:   null,
        localUserId,
        localPosition:   { x: RECEPTION_POINT.x, y: 0, z: RECEPTION_POINT.y },
        officeCommand:   null,
        ui: {
          theme:            initialTheme,
          showWorkspaceHUD: false,
          workspaceZoneId:  null,
          showChat:         false,
          autoRoam:         false,
          modelSwapAgentId: null,
          showHireModal:    false,
        },

        setRoomId:          (id) => set({ roomId: id }),
        setConnected:       (v)  => set({ connected: v, demoMode: v ? false : get().demoMode, connectionError: v ? null : get().connectionError }),
        setDemoMode:        (v)  => set({ demoMode: v }),
        setConnectionError: (e)  => set({ connectionError: e }),

        setRoomState: ({ roomId: nextRoomId, participants, presence, zones, recentMessages, workspaces }) => {
          const state = get();
          const serverAgents = participants.filter((p) => p.isAgent);

          // A connected snapshot is authoritative, including empty lists. Keep only
          // explicit session-local additions from the standalone preview.
          const nextAgents: Record<string, AgentParticipant> = {};
          for (const p of serverAgents) {
            const roleAr = AGENT_ROLE_AR[p.id];
            nextAgents[p.id] = roleAr ? { ...p, profile: { ...p.profile, customRole: roleAr } } : p;
          }
          for (const agent of Object.values(state.agents)) {
            if (agent.id.startsWith('agent-custom-') && !(agent.id in nextAgents)) nextAgents[agent.id] = agent;
          }

          const presenceMap: Record<string, PresenceEntry> = {};
          for (const p of presence) presenceMap[p.participantId] = p;

          const wsMap: Record<string, SharedWorkspaceState> = Object.fromEntries(workspaces.map((ws) => [ws.zoneId, ws]));
          for (const local of Object.values(state.workspaces)) {
            const additions = local.entries.filter((entry) => entry.id.startsWith(LOCAL_TASK_PREFIX));
            if (additions.length) wsMap[local.zoneId] = { ...local, ...wsMap[local.zoneId], entries: [...(wsMap[local.zoneId]?.entries ?? []), ...additions] };
          }

          const nextLocations = { ...state.agentLocations };
          for (const ag of Object.values(nextAgents)) {
            if (!nextLocations[ag.id]) {
              const room = (ag.zoneId ? ROOM_BY_ID[ag.zoneId] : undefined) ?? OFFICE_ROOMS[0]!;
              nextLocations[ag.id] = {
                areaId:           room.id,
                areaNameAr:       room.nameAr,
                targetRoomId:     null,
                targetRoomNameAr: null,
                isWalking:        false,
                activity:         'desk',
                statusTextAr:     'على المكتب',
              };
            }
          }

          set({
            roomId:         nextRoomId ?? state.roomId,
            connected:      true,
            demoMode:       false,
            connectionError: null,
            agents:         nextAgents,
            agentLocations: nextLocations,
            zones,
            presence:       presenceMap,
            messages:       recentMessages.length > 0 ? recentMessages.slice(-MAX_MESSAGES) : state.messages,
            workspaces:     wsMap,
            selectedAgentId: state.selectedAgentId && nextAgents[state.selectedAgentId] ? state.selectedAgentId : null,
            followAgentId:   state.followAgentId && nextAgents[state.followAgentId] ? state.followAgentId : null,
            activeStreams:  {},
          });
        },

        upsertAgent: (agent) =>
          set((s) => ({ agents: { ...s.agents, [agent.id]: agent } })),

        hireAgent: (input) => {
          const id = `agent-custom-${Date.now().toString(36)}`;
          const now = new Date().toISOString();
          const room = ROOM_BY_ID[input.zoneId] ?? OFFICE_ROOMS[0]!;
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
            agentLocations: {
              ...s.agentLocations,
              [id]: {
                areaId:           'zone-lounge',
                areaNameAr:       'الاستقبال واستراحة الموظفين',
                targetRoomId:     room.id,
                targetRoomNameAr: room.nameAr,
                isWalking:        true,
                activity:         'walking',
                statusTextAr:     `متجه إلى ${room.nameAr}`,
              },
            },
            selectedAgentId: id,
            officeCommand: {
              seq:        ++cmdSeq,
              kind:       'spawn-at-reception',
              agentId:    id,
              homeRoomId: room.id,
            },
            activityLog: [
              makeActivityItem(
                `انضم ${newAgent.displayName} (${input.model}) ويتجه من الاستقبال إلى ${room.nameAr}`,
                input.avatarColor,
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
            const nextLocs = { ...s.agentLocations };
            delete nextLocs[agentId];
            return {
              agents:          nextAgents,
              agentLocations:  nextLocs,
              selectedAgentId: s.selectedAgentId === agentId ? null : s.selectedAgentId,
              followAgentId:   s.followAgentId === agentId ? null : s.followAgentId,
              activityLog: removed
                ? [makeActivityItem(`غادر ${removed.displayName} مقر الشركة`, '#64748b'), ...s.activityLog].slice(0, MAX_ACTIVITY)
                : s.activityLog,
            };
          }),

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
            const changed = ag.brainConfig?.model !== brain.model || ag.brainConfig?.provider !== brain.provider;
            return {
              agents: {
                ...s.agents,
                [agentId]: { ...ag, brainConfig: brain, modelId: brain.model },
              },
              lastSwappedAgent: { agentId, at: Date.now() },
              activityLog: changed
                ? [
                    makeActivityItem(
                      `تم تحديث موديل ${ag.displayName} إلى ${brain.model}`,
                      ag.profile.avatarColor ?? '#3b82f6',
                    ),
                    ...s.activityLog,
                  ].slice(0, MAX_ACTIVITY)
                : s.activityLog,
            };
          }),

        setAgentLocation: (agentId, loc) =>
          set((s) => {
            const prev = s.agentLocations[agentId];
            if (
              prev &&
              prev.areaId === loc.areaId &&
              prev.targetRoomId === loc.targetRoomId &&
              prev.isWalking === loc.isWalking &&
              prev.activity === loc.activity &&
              prev.statusTextAr === loc.statusTextAr
            ) {
              return s;
            }
            return {
              agentLocations: { ...s.agentLocations, [agentId]: loc },
            };
          }),

        pushActivity: (text, color = '#3b82f6') =>
          set((s) => ({
            activityLog: [makeActivityItem(text, color), ...s.activityLog].slice(0, MAX_ACTIVITY),
          })),

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

        selectAgent:      (id)  => set((s) => ({ selectedAgentId: id, followAgentId: id === s.followAgentId ? s.followAgentId : null })),
        setFollowAgent:   (id)  => set({ followAgentId: id, selectedAgentId: id ?? get().selectedAgentId }),
        setLocalPosition: (pos) => set({ localPosition: pos }),

        toggleTheme: () =>
          set((s) => {
            const next = s.ui.theme === 'light' ? 'dark' : 'light';
            applyDomTheme(next);
            return { ui: { ...s.ui, theme: next } };
          }),

        toggleWorkspaceHUD: (force, zoneId) => set((s) => {
          const show = force ?? !s.ui.showWorkspaceHUD;
          return { ui: { ...s.ui, showWorkspaceHUD: show, workspaceZoneId: show ? zoneId ?? null : null, showChat: show ? false : s.ui.showChat } };
        }),
        toggleChat: (force) => set((s) => {
          const show = force ?? !s.ui.showChat;
          return { ui: { ...s.ui, showChat: show, showWorkspaceHUD: show ? false : s.ui.showWorkspaceHUD } };
        }),
        toggleAutoRoam:     () => set((s) => ({ ui: { ...s.ui, autoRoam: !s.ui.autoRoam } })),
        openModelSwap:      (agentId) => set((s) => ({ ui: { ...s.ui, modelSwapAgentId: agentId } })),
        setShowHireModal:   (open) => set((s) => ({ ui: { ...s.ui, showHireModal: open } })),

        dispatchAgentToRoom: (agentId, roomId, reasonAr) => {
          const ag = get().agents[agentId];
          const room = Object.hasOwn(ROOM_BY_ID, roomId) ? ROOM_BY_ID[roomId] : undefined;
          if (!ag || !room || isRoomLockedForPlan(roomId, useBillingStore.getState().plan)) return;
          set((s) => ({
            officeCommand: {
              seq:      ++cmdSeq,
              kind:     'dispatch-room',
              agentId,
              roomId,
              reasonAr: reasonAr ?? `يتجه إلى ${room.nameAr}`,
            },
            activityLog: [
              makeActivityItem(
                `${ag.displayName} يتحرك عبر الممرات نحو ${room.nameAr}`,
                ag.profile.avatarColor ?? room.accent,
              ),
              ...s.activityLog,
            ].slice(0, MAX_ACTIVITY),
          }));
        },

        callTeamStandup: () =>
          set((s) => ({
            officeCommand: { seq: ++cmdSeq, kind: 'standup' },
            activityLog: [
              makeActivityItem('دعوة اجتماع عام — الوكلاء يتجهون إلى مساحة الاجتماع', '#7c3aed'),
              ...s.activityLog,
            ].slice(0, MAX_ACTIVITY),
          })),

        returnAllToDesks: () =>
          set((s) => ({
            officeCommand: { seq: ++cmdSeq, kind: 'return-desks' },
            activityLog: [
              makeActivityItem('عودة جميع الوكلاء عبر الممرات إلى مكاتبهم الأساسية', '#0284c7'),
              ...s.activityLog,
            ].slice(0, MAX_ACTIVITY),
          })),

        triggerHandoff: (fromAgentId, toAgentId) =>
          set((s) => ({
            officeCommand: { seq: ++cmdSeq, kind: 'handoff', fromAgentId, toAgentId },
          })),

        focusRoomCamera:  (roomId)  => set({ followAgentId: null, officeCommand: { seq: ++cmdSeq, kind: 'focus-room', roomId } }),
        focusAgentCamera: (agentId) => set({ selectedAgentId: agentId, followAgentId: null, officeCommand: { seq: ++cmdSeq, kind: 'focus-agent', agentId } }),
        resetCamera:      ()        => set({ followAgentId: null, officeCommand: { seq: ++cmdSeq, kind: 'reset-camera' } }),
      };
    }),
    { name: 'WoraHQStore' },
  ),
);

/* ─── STABLE SELECTORS ──────────────────────────────────── */
export const selectAgentsMap     = (s: WoraState) => s.agents;
export const selectAgentLocs     = (s: WoraState) => s.agentLocations;
export const selectMessages      = (s: WoraState) => s.messages;
export const selectStreams        = (s: WoraState) => s.activeStreams;
export const selectWorkspaces    = (s: WoraState) => s.workspaces;
export const selectUI            = (s: WoraState) => s.ui;
export const selectConnected     = (s: WoraState) => s.connected;
export const selectDemoMode      = (s: WoraState) => s.demoMode;
export const selectSelectedAgent = (s: WoraState) =>
  s.selectedAgentId ? (s.agents[s.selectedAgentId] ?? null) : null;
