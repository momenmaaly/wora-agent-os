/**
 * WORA OS — verification and evidence records.
 *
 * A run's own `completed` status is not evidence. This module stores the
 * structured verification record that binds a task objective, acceptance
 * criteria, expected output, actual output, evidence, independent checks and
 * failure reason. The orchestrator writes one record per run attempt; callers
 * can inspect them without trusting an agent's self-report.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';

export type VerificationResult = 'passed' | 'failed' | 'blocked';
export type VerificationCheckStatus = 'passed' | 'failed' | 'blocked' | 'not_run';
export type VerificationIndependence = 'deterministic-review' | 'external' | 'none';

export interface VerificationCheck {
  id: string;
  kind: string;
  description: string;
  status: VerificationCheckStatus;
  evidence?: string;
}

export interface VerificationRecord {
  id: string;
  workspaceId: string;
  missionId: string;
  taskId: string;
  runId: string;
  objective: string;
  acceptanceCriteria: string[];
  expectedOutput: string;
  actualOutput: unknown;
  evidence: unknown;
  checks: VerificationCheck[];
  result: VerificationResult;
  independence: VerificationIndependence;
  failureReason: string;
  verifier: string;
  createdAt: string;
}

const jsonCap = (value: unknown, cap = 60_000): string => {
  try {
    const text = JSON.stringify(value ?? null);
    return text.length > cap ? `${text.slice(0, cap)}…[truncated ${text.length - cap} chars]` : text;
  } catch {
    return '"[unserializable]"';
  }
};

const view = (row: Record<string, string | null>): VerificationRecord => ({
  id: String(row['id']),
  workspaceId: String(row['workspace_id']),
  missionId: String(row['mission_id']),
  taskId: String(row['task_id']),
  runId: String(row['run_id']),
  objective: String(row['objective']),
  acceptanceCriteria: parseJson(row['acceptance_criteria'], []),
  expectedOutput: String(row['expected_output'] ?? ''),
  actualOutput: parseJson(row['actual_output'], null),
  evidence: parseJson(row['evidence'], []),
  checks: parseJson(row['checks'], []),
  result: String(row['result']) as VerificationResult,
  independence: String(row['independence']) as VerificationIndependence,
  failureReason: String(row['failure_reason'] ?? ''),
  verifier: String(row['verifier']),
  createdAt: String(row['created_at']),
});

export function recordVerification(input: {
  workspaceId: string;
  missionId: string;
  taskId: string;
  runId: string;
  objective: string;
  acceptanceCriteria: string[];
  expectedOutput: string;
  actualOutput: unknown;
  evidence: unknown;
  checks: VerificationCheck[];
  result: VerificationResult;
  independence?: VerificationIndependence;
  failureReason?: string;
  verifier?: string;
}): VerificationRecord {
  const db = getOsDb();
  const id = newId('ver');
  const createdAt = nowIso();
  db.prepare(`INSERT INTO os_verifications
    (id, workspace_id, mission_id, task_id, run_id, objective, acceptance_criteria, expected_output, actual_output, evidence, checks, result, independence, failure_reason, verifier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, input.workspaceId, input.missionId, input.taskId, input.runId,
      input.objective.slice(0, 4_000),
      jsonCap(input.acceptanceCriteria, 10_000),
      input.expectedOutput.slice(0, 4_000),
      jsonCap(input.actualOutput),
      jsonCap(input.evidence),
      jsonCap(input.checks, 20_000),
      input.result,
      input.independence ?? 'deterministic-review',
      (input.failureReason ?? '').slice(0, 4_000),
      (input.verifier ?? 'wora.orchestrator/reviewRun').slice(0, 200),
      createdAt,
    );
  audit(db, {
    workspaceId: input.workspaceId,
    actor: input.verifier ?? 'wora.orchestrator/reviewRun',
    action: 'verification.record',
    subject: id,
    detail: { missionId: input.missionId, taskId: input.taskId, runId: input.runId, result: input.result, checks: input.checks.length },
  });
  return getVerification(input.workspaceId, id)!;
}

export function getVerification(workspaceId: string, id: string): VerificationRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_verifications WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as Record<string, string> | undefined;
  return row ? view(row) : null;
}

export function listVerifications(workspaceId: string, opts: { missionId?: string; taskId?: string; limit?: number } = {}): VerificationRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const db = getOsDb();
  let rows: Array<Record<string, string>>;
  if (opts.taskId) {
    rows = db.prepare('SELECT * FROM os_verifications WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, opts.taskId, limit) as unknown as Array<Record<string, string>>;
  } else if (opts.missionId) {
    rows = db.prepare('SELECT * FROM os_verifications WHERE workspace_id = ? AND mission_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, opts.missionId, limit) as unknown as Array<Record<string, string>>;
  } else {
    rows = db.prepare('SELECT * FROM os_verifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit) as unknown as Array<Record<string, string>>;
  }
  return rows.map(view);
}
