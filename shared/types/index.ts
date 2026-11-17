export type SupportedLocale = 'en' | 'ar';

export type AgentTone =
  | 'Formal'
  | 'Creative'
  | 'Analytical'
  | 'Casual'
  | 'Socratic'
  | 'Concise'
  | (string & {});

export enum BrainProvider {
  Google    = 'google',
  OpenAI    = 'openai',
  Anthropic = 'anthropic',
  Groq      = 'groq',
}

export const BRAIN_MODELS: Record<BrainProvider, readonly string[]> = {
  [BrainProvider.Google]: [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite',
  ],
  [BrainProvider.OpenAI]: [
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'o4-mini',
  ],
  [BrainProvider.Anthropic]: [
    'claude-sonnet-4-5',
    'claude-opus-4-5',
    'claude-haiku-4-5',
  ],
  [BrainProvider.Groq]: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
};

export const BRAIN_PROVIDER_LABELS: Record<BrainProvider, string> = {
  [BrainProvider.Google]:    'Google Gemini',
  [BrainProvider.OpenAI]:    'OpenAI GPT',
  [BrainProvider.Anthropic]: 'Anthropic Claude',
  [BrainProvider.Groq]:      'Groq / Llama',
};

export const DEFAULT_BRAIN_MODEL = 'gemini-2.5-flash';

export interface BrainConfig {
  provider:     BrainProvider;
  model:        string;
  apiKeyAlias?: string;
  maxTokens?:   number;
  temperature?: number;
}

/** Public BrainConfig stripped of server-only fields like apiKeyAlias */
export type PublicBrainConfig = Omit<BrainConfig, 'apiKeyAlias'>;

export interface BrainCompletionResult {
  text:               string;
  provider:           BrainProvider;
  model:              string;
  tokenEstimate:      number;
  wasRefined:         boolean;
  refinementAttempts: number;
  constitutionPassed: boolean;
  auditId:            string;
  toolCallCount:      number;
  streamingFailed:    boolean;
}

export enum AvatarAnimState {
  Idle     = 'idle',
  Thinking = 'thinking',
  Talking  = 'talking',
  Error    = 'error',
}

export enum AgentLifecycleState {
  Booting       = 'BOOTING',
  Idle          = 'IDLE',
  Thinking      = 'THINKING',
  Refining      = 'REFINING',
  ExecutingTool = 'EXECUTING_TOOL',
  Executing     = 'EXECUTING',
  Responding    = 'RESPONDING',
  Error         = 'ERROR',
}

export function lifecycleToAvatarState(state: AgentLifecycleState): AvatarAnimState {
  switch (state) {
    case AgentLifecycleState.Thinking:
    case AgentLifecycleState.Refining:
    case AgentLifecycleState.ExecutingTool:
    case AgentLifecycleState.Executing:
    case AgentLifecycleState.Booting:
      return AvatarAnimState.Thinking;
    case AgentLifecycleState.Responding:
      return AvatarAnimState.Talking;
    case AgentLifecycleState.Error:
      return AvatarAnimState.Error;
    case AgentLifecycleState.Idle:
    default:
      return AvatarAnimState.Idle;
  }
}

export type SharedWorkspaceEntryType =
  | 'task'
  | 'artifact'
  | 'review'
  | 'signal'
  | 'handoff';

export type SharedWorkspaceEntryStatus =
  | 'open'
  | 'claimed'
  | 'in_progress'
  | 'review_pending'
  | 'approved'
  | 'rejected'
  | 'done'
  | 'expired';

export interface SharedWorkspaceEntry {
  id:            string;
  zoneId:        string;
  roomId:        string;
  type:          SharedWorkspaceEntryType;
  status:        SharedWorkspaceEntryStatus;
  authorAgentId: string;
  targetAgentId?: string;
  title:         string;
  payload:       Record<string, unknown>;
  constitutionResult?: {
    passed:     boolean;
    score:      number;
    violations: string[];
    reviewedBy: string;
    reviewedAt: string;
  };
  parentEntryId?: string;
  chainIds:      string[];
  createdAt:     string;
  updatedAt:     string;
  expiresAt?:    string;
}

export interface SharedWorkspaceState {
  zoneId:        string;
  roomId:        string;
  entries:       SharedWorkspaceEntry[];
  lastWriteAt:   string;
  lastWrittenBy: string;
}

export interface WorkspaceUpdatePayload {
  zoneId: string;
  roomId: string;
  entry:  SharedWorkspaceEntry;
  action: 'created' | 'claimed' | 'updated' | 'completed' | 'rejected';
}

export interface BrainSwapPayload {
  agentId:      string;
  newBrain:     PublicBrainConfig;
  requestedBy?: string;
  reason?:      string;
}

export interface BrainSwapBroadcast {
  agentId:       string;
  previousBrain: PublicBrainConfig;
  newBrain:      PublicBrainConfig;
  swappedAt:     string;
  swappedBy:     string;
  scope?:        'room' | 'global';
}

export interface MessageStreamPayload {
  messageId:    string;
  agentId:      string;
  taskId:       string;
  chunk:        string;
  isDone:       boolean;
  isRefinement: boolean;
  aborted?:     boolean;
  roomId:       string;
}

export enum ParticipantStatus {
  Online  = 'ONLINE',
  Busy    = 'BUSY',
  Away    = 'AWAY',
  Offline = 'OFFLINE',
}

export enum MessageType {
  Text         = 'TEXT',
  System       = 'SYSTEM',
  AgentThought = 'AGENT_THOUGHT',
  IAC          = 'IAC',
  Mention      = 'MENTION',
  External     = 'EXTERNAL',
}

export enum AgentOrigin {
  Internal = 'INTERNAL',
  External = 'EXTERNAL',
}

export enum RoomAccessMode {
  Public    = 'PUBLIC',
  Private   = 'PRIVATE',
  AgentOnly = 'AGENT_ONLY',
}

export interface SpatialPosition {
  x:          number;
  y:          number;
  z:          number;
  rotationY?: number;
}

export interface AgentProfile {
  customRole:        string;
  tone:              AgentTone;
  skills:            string[];
  avatarColor:       string;
  tagline?:          string;
  specialty?:        string;
  boundaries?:       string[];
  colleagues?:       Array<{ displayName: string; customRole: string }>;
  knowledgeBaseIds?: string[];
}

export interface WorkspaceZone {
  id:               string;
  name:             string;
  themeColor:       string;
  maxCapacity:      number;
  position:         { x: number; z: number };
  radius:           number;
  assignedAgentIds: string[];
  description?:     string;
  createdAt:        string;
  createdBy:        string;
}

export interface Message {
  id:                string;
  roomId:            string;
  senderId:          string;
  type:              MessageType;
  content:           string;
  timestamp:         string;
  mentions:          Array<{ participantId: string; raw: string; startIndex: number; endIndex: number }>;
  replyToId?:        string;
  wasRefined?:       boolean;
  workspaceEntryId?: string;
}

export interface AgentParticipant {
  id:              string;
  displayName:     string;
  isHuman:         false;
  isAgent:         true;
  origin:          AgentOrigin.Internal;
  profile:         AgentProfile;
  zoneId:          string | null;
  lifecycleState:  AgentLifecycleState;
  socketId:        string | null;
  assignedRoomIds: string[];
  modelId:         string;
  activeTasks:     number;
  brainConfig:     PublicBrainConfig;
  avatarGlb?:      string;
  avatarState:     AvatarAnimState;
  locale:          SupportedLocale;
  createdAt:       string;
  lastSeenAt:      string;
  status:          ParticipantStatus;
  activeRoomIds:   string[];
  avatarUrl?:      string;
}

export interface AgentDefinition {
  id:              string;
  displayName:     string;
  profile:         AgentProfile;
  zoneId:          string | null;
  assignedRoomIds: string[];
  locale:          SupportedLocale;
  modelId:         string;
  avatarUrl?:      string;
  brainConfig:     BrainConfig;
  avatarGlb?:      string;
}
