import { z } from 'zod';
import { VALID_ZONE_IDS } from '../zones.js';
import type { SharedWorkspaceEntry } from '../../../shared/types/index.js';

const safeId = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/u);
export const workspaceSignalSchema = z.object({
  zoneId: safeId.refine((id) => VALID_ZONE_IDS.has(id), 'Unknown zoneId'),
  agentId: safeId,
  title: z.string().trim().min(1).max(200),
  data: z.object({ source: z.enum(['hq-board', 'director']).optional(), brief: z.string().trim().min(5).max(1200).optional() }).default({}),
}).refine(({ data }) => data.source !== 'director' || Boolean(data.brief), 'A director assignment needs a brief');

export type AssignmentAck = { ok: true; entry: SharedWorkspaceEntry } | { ok: false; code: string };
export type ReplyToAssignment = (result: AssignmentAck) => void;
