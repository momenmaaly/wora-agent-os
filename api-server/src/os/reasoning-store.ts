/**
 * WORA OS — append-only reasoning model history.
 *
 * Every update creates a new version; the latest version is the current model.
 * Old versions, claims, evidence references and rejected hypotheses are never
 * overwritten, so an adaptive update can be audited against the model it
 * replaced.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { updateReasoningWithEvidence } from './reasoning-engine.js';
import { redactSecrets } from './secrets.js';
import type { ReasoningChange, ReasoningEvidenceInput, ReasoningModel } from './reasoning-types.js';

interface Row { id: string; workspace_id: string; mission_id: string; version: number; parent_version: number | null; model: string; created_at: string }

export function saveReasoningModel(model: ReasoningModel): ReasoningModel {
  const workspaceId = model.workspaceId;
  const missionId = model.missionId;
  if (!workspaceId || !missionId) throw new Error('A reasoning model must belong to a workspace and mission');
  const db = getOsDb();
  const max = (db.prepare('SELECT MAX(version) AS version FROM os_reasoning_models WHERE workspace_id = ? AND mission_id = ?')
    .get(workspaceId, missionId) as { version?: number | null } | undefined)?.version ?? 0;
  const version = Math.max(model.version, Number(max) + 1);
  const stored: ReasoningModel = redactSecrets({ ...model, version, parentVersion: Number(max) || null }).value;
  db.prepare('INSERT INTO os_reasoning_models (id, workspace_id, mission_id, version, parent_version, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('rsn'), workspaceId, missionId, version, stored.parentVersion, JSON.stringify(stored).slice(0, 240_000), nowIso());
  return stored;
}

export function getReasoningModel(workspaceId: string, missionId: string): ReasoningModel | null {
  const row = getOsDb().prepare('SELECT model FROM os_reasoning_models WHERE workspace_id = ? AND mission_id = ? ORDER BY version DESC LIMIT 1')
    .get(workspaceId, missionId) as { model?: string } | undefined;
  const parsed = row?.model ? parseJson<ReasoningModel | null>(row.model, null) : null;
  return parsed && parsed.schemaVersion === '1.0' && Array.isArray(parsed.claims) ? redactSecrets(parsed).value : null;
}

export function listReasoningVersions(workspaceId: string, missionId: string, limit = 20): Array<{ id: string; version: number; parentVersion: number | null; mode: string; createdAt: string; model: ReasoningModel }> {
  const rows = getOsDb().prepare('SELECT id, version, parent_version, model, created_at FROM os_reasoning_models WHERE workspace_id = ? AND mission_id = ? ORDER BY version DESC LIMIT ?')
    .all(workspaceId, missionId, Math.min(Math.max(limit, 1), 50)) as unknown as Row[];
  return rows.map((row) => ({
    id: row.id, version: Number(row.version), parentVersion: row.parent_version == null ? null : Number(row.parent_version),
    mode: (parseJson<{ mode?: string }>(row.model, {}).mode ?? 'deterministic'), createdAt: row.created_at,
    model: redactSecrets(parseJson<ReasoningModel>(row.model, {} as ReasoningModel)).value,
  }));
}

export function addReasoningEvidence(input: {
  workspaceId: string; missionId: string; evidence: ReasoningEvidenceInput[]; actor: string;
}): { model: ReasoningModel; change: ReasoningChange } | null {
  const current = getReasoningModel(input.workspaceId, input.missionId);
  if (!current) return null;
  const updated = updateReasoningWithEvidence(current, input.evidence, input.actor);
  if (updated.change.replanRecommended) {
    const db = getOsDb();
    const invalidated = updated.model.claims.filter((claim) => updated.change.invalidatedAssumptionIds.includes(claim.id));
    const tokens = new Set(invalidated.flatMap((claim) => claim.statement.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));
    const tasks = db.prepare("SELECT id, objective, acceptance, tool, detail FROM os_tasks WHERE workspace_id = ? AND mission_id = ? AND status != 'completed'").all(input.workspaceId, input.missionId) as unknown as Array<{ id: string; objective: string; acceptance: string; tool: string | null; detail: string }>;
    const affected = tasks.filter((task) => [...tokens].some((token) => `${task.objective} ${task.acceptance} ${task.tool ?? ''} ${task.detail}`.toLowerCase().includes(token)));
    updated.change.affectedTaskIds = (affected.length ? affected : tasks).map((task) => task.id);
  }
  const stored = saveReasoningModel(updated.model);
  audit(getOsDb(), {
    workspaceId: input.workspaceId, actor: input.actor, action: 'mission.reasoning.evidence',
    subject: input.missionId, detail: { version: stored.version, evidence: input.evidence.length, change: updated.change.kind, replanRecommended: updated.change.replanRecommended },
  });
  return { model: stored, change: updated.change };
}

/** Records the independent mission outcome as observed evidence, without claiming more than it verifies. */
export function recordOutcomeReasoningEvidence(input: {
  workspaceId: string; missionId: string; status: string; taskEvidence: Array<{ taskId: string; tool: string | null; status: string; verification: string | null; outcome: string }>;
}): { model: ReasoningModel; change: ReasoningChange } | null {
  const evidence: ReasoningEvidenceInput[] = [{
    id: `outcome-${input.missionId}`, statement: `Independent outcome verification recorded status "${input.status}" for the completed mission.`,
    kind: 'observed-fact', source: 'verification:mission-outcome', sourceId: `outcome-${input.missionId}`, trust: 'verified', confidence: 0.9,
    experimental: false,
  }];
  for (const task of input.taskEvidence.slice(0, 20)) {
    if (task.status !== 'completed') continue;
    evidence.push({
      id: `task-outcome-${task.taskId}`, statement: `Task ${task.taskId} (${task.tool ?? 'no tool'}) completed with verification=${task.verification ?? 'none'} and outcome=${task.outcome}.`,
      kind: 'observed-fact', source: 'verification:task-outcome', sourceId: task.taskId, trust: 'verified', confidence: 0.8,
    });
  }
  return addReasoningEvidence({ workspaceId: input.workspaceId, missionId: input.missionId, evidence, actor: 'wora.outcome-verifier' });
}
