import mongoose, { Schema, Document, Model } from 'mongoose';
import type { SharedWorkspaceEntry } from '../../../shared/types/index.js';

export interface IWorkspaceEntryDoc extends Omit<Document, 'id'>, SharedWorkspaceEntry {}

const ENTRY_TYPES = ['task', 'artifact', 'review', 'signal', 'handoff'] as const;
const ENTRY_STATUSES = [
  'open',
  'claimed',
  'in_progress',
  'review_pending',
  'approved',
  'rejected',
  'done',
  'expired',
] as const;

const WorkspaceEntrySchema = new Schema<IWorkspaceEntryDoc>(
  {
    id:            { type: String, required: true, unique: true, index: true },
    zoneId:        { type: String, required: true, index: true, maxlength: 80 },
    roomId:        { type: String, required: true, index: true, maxlength: 120 },
    type:          { type: String, required: true, enum: ENTRY_TYPES },
    status:        { type: String, required: true, enum: ENTRY_STATUSES, default: 'open', index: true },
    authorAgentId: { type: String, required: true, maxlength: 120 },
    targetAgentId: { type: String, maxlength: 120 },
    title:         { type: String, required: true, maxlength: 200 },
    payload:       { type: Schema.Types.Mixed, default: {} },
    constitutionResult: {
      passed:     Boolean,
      score:      Number,
      violations: [String],
      reviewedBy: String,
      reviewedAt: String,
    },
    parentEntryId: { type: String, maxlength: 80 },
    chainIds:      { type: [String], default: [] },
    createdAt:     { type: String, required: true },
    updatedAt:     { type: String, required: true },
    expiresAt:     { type: String },
  },
  { strict: true },
);

WorkspaceEntrySchema.index({ roomId: 1, zoneId: 1, createdAt: -1 }, { name: 'room_zone_created' });
WorkspaceEntrySchema.index({ roomId: 1, zoneId: 1, status: 1 },     { name: 'room_zone_status' });
WorkspaceEntrySchema.index({ roomId: 1, zoneId: 1, type: 1 },       { name: 'room_zone_type' });

export const WorkspaceEntryModel: Model<IWorkspaceEntryDoc> =
  (mongoose.models['WorkspaceEntry'] as Model<IWorkspaceEntryDoc> | undefined) ??
  mongoose.model<IWorkspaceEntryDoc>('WorkspaceEntry', WorkspaceEntrySchema);
