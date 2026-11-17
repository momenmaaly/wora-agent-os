import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  BrainProvider,
  DEFAULT_BRAIN_MODEL,
} from '../../../shared/types/index.js';
import type { BrainConfig, SupportedLocale } from '../../../shared/types/index.js';

export interface IAgentDocument extends Document {
  agentId:         string;
  displayName:     string;
  locale:          SupportedLocale;
  modelId:         string;
  brainConfig:     BrainConfig;
  avatarGlb?:      string;
  avatarUrl?:      string;
  zoneId:          string | null;
  zoneConfig:      Record<string, unknown> | null;
  assignedRoomIds: string[];
  profile: {
    customRole:        string;
    tone:              string;
    skills:            string[];
    avatarColor:       string;
    tagline?:          string;
    specialty?:        string;
    boundaries?:       string[];
    tools?:            unknown[];
    knowledgeBaseIds?: string[];
    colleagues?:       Array<{ displayName: string; customRole: string }>;
  };
  systemPromptOverride?: string;
  promptVersion:   number;
  status:          'active' | 'inactive' | 'error' | 'maintenance';
  lastSeenAt:      Date;
  activeTasks:     number;
  totalTasksRun:   number;
  meta:            Record<string, unknown>;
  createdAt:       Date;
  updatedAt:       Date;
}

const BrainConfigSchema = new Schema<BrainConfig>(
  {
    provider:    { type: String, required: true, enum: Object.values(BrainProvider), default: BrainProvider.Google },
    model:       { type: String, required: true, default: DEFAULT_BRAIN_MODEL },
    apiKeyAlias: { type: String, match: /^WORA_KEY_[A-Z0-9_]{1,48}$/ },
    maxTokens:   { type: Number, default: 2048, min: 64, max: 16384 },
    temperature: { type: Number, default: 0.7, min: 0, max: 2 },
  },
  { _id: false, strict: true },
);

const ColleagueSchema = new Schema(
  {
    displayName: { type: String, required: true, maxlength: 80 },
    customRole:  { type: String, required: true, maxlength: 120 },
  },
  { _id: false, strict: true },
);

const AgentSchema = new Schema<IAgentDocument>(
  {
    agentId:     { type: String, required: true, unique: true, index: true, maxlength: 80 },
    displayName: { type: String, required: true, maxlength: 80 },
    locale:      { type: String, required: true, enum: ['en', 'ar'], default: 'en' },
    modelId:     { type: String, required: true, default: DEFAULT_BRAIN_MODEL },
    brainConfig: {
      type:    BrainConfigSchema,
      default: () => ({ provider: BrainProvider.Google, model: DEFAULT_BRAIN_MODEL, maxTokens: 2048, temperature: 0.7 }),
    },
    avatarGlb:       { type: String, maxlength: 512 },
    avatarUrl:       { type: String, maxlength: 512 },
    zoneId:          { type: String, default: null, index: true },
    zoneConfig:      { type: Schema.Types.Mixed, default: null },
    assignedRoomIds: { type: [String], default: [] },
    profile: {
      customRole:       { type: String, required: true, maxlength: 120 },
      tone:             { type: String, required: true, default: 'Analytical', maxlength: 60 },
      skills:           { type: [String], default: [] },
      avatarColor:      { type: String, required: true, match: /^#[0-9a-fA-F]{3,8}$/ },
      tagline:          { type: String, maxlength: 240 },
      specialty:        { type: String, maxlength: 240 },
      boundaries:       { type: [String], default: [] },
      tools:            { type: [Schema.Types.Mixed], default: [] },
      knowledgeBaseIds: { type: [String], default: [] },
      colleagues:       { type: [ColleagueSchema], default: [] },
    },
    systemPromptOverride: { type: String, maxlength: 8000 },
    promptVersion:        { type: Number, required: true, default: 1, min: 1 },
    status: {
      type:     String,
      required: true,
      enum:     ['active', 'inactive', 'error', 'maintenance'],
      default:  'active',
      index:    true,
    },
    lastSeenAt:    { type: Date, default: () => new Date(), index: true },
    activeTasks:   { type: Number, default: 0, min: 0 },
    totalTasksRun: { type: Number, default: 0, min: 0 },
    meta:          { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false, strict: true },
);

AgentSchema.index({ status: 1, lastSeenAt: -1 }, { name: 'status_lastseen' });
AgentSchema.index({ displayName: 1, status: 1 }, { name: 'displayname_status' });
AgentSchema.index({ assignedRoomIds: 1 },        { name: 'room_agents' });
AgentSchema.index({ 'brainConfig.provider': 1 }, { name: 'brain_provider' });

export interface IAgentModel extends Model<IAgentDocument> {
  findByAgentId(id: string): ReturnType<Model<IAgentDocument>['findOne']>;
  findByRoom(roomId: string): ReturnType<Model<IAgentDocument>['find']>;
}

AgentSchema.statics['findByAgentId'] = function (id: string) {
  return this.findOne({ agentId: id });
};
AgentSchema.statics['findByRoom'] = function (roomId: string) {
  return this.find({ assignedRoomIds: roomId, status: 'active' });
};

export const AgentModel: IAgentModel =
  (mongoose.models['Agent'] as IAgentModel | undefined) ??
  mongoose.model<IAgentDocument, IAgentModel>('Agent', AgentSchema);
