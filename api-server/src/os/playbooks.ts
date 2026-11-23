/**
 * WORA OS — self-building intelligence: validated optimization playbooks.
 *
 * When a mission completes successfully with an OR task, WORA distills the run
 * into a reusable playbook: the tool, the exact input, and the evidence that
 * the input RE-VALIDATES (solver re-run, not the original output trusted).
 * A playbook is only persisted after it passes its own validation pass —
 * "validated before trust". A later, similar mission reinforces the existing
 * playbook (success_runs += 1) instead of forking a duplicate.
 *
 * Scope: distillation + re-validation + persistence are live. Autonomous
 * reuse of a playbook inside the planner is NOT wired yet — playbooks are
 * listed for operators and referenced as advisory context. Recorded honestly.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { solveEmployeeSchedule, solveAssignment, solveLp } from './ortools.js';

const OR_TOOLS = new Set(['or.employee_schedule', 'or.assignment', 'or.solve_lp']);

export interface PlaybookRecord {
  id: string; name: string; toolId: string; keywords: string[];
  toolInput: Record<string, unknown>;
  validation: { ok: boolean; detail: string };
  status: 'validated'; successRuns: number; reuseCount: number; createdFromMission: string | null; createdAt: string; updatedAt: string;
}

const tokenize = (text: string): string[] =>
  [...new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length > 3))].slice(0, 24);

const jaccard = (a: string[], b: string[]): number => {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  return intersection / union.size;
};

const playbookView = (row: Record<string, string | number>): PlaybookRecord => ({
  id: String(row['id']),
  name: String(row['name']),
  toolId: String(row['tool_id']),
  keywords: parseJson<string[]>(String(row['keywords']), []),
  toolInput: parseJson<Record<string, unknown>>(String(row['tool_input']), {}),
  validation: parseJson<{ ok: boolean; detail: string }>(String(row['validation']), { ok: false, detail: 'unknown' }),
  status: 'validated',
  successRuns: Number(row['success_runs']),
  reuseCount: Number(row['reuse_count'] ?? 0),
  createdFromMission: (row['created_from_mission'] as string | null) ?? null,
  createdAt: String(row['created_at']),
  updatedAt: String(row['updated_at']),
});

export function findPlaybookFor(workspaceId: string, toolId: string, objective: string): PlaybookRecord | null {
  const keywords = tokenize(objective);
  const rows = getOsDb().prepare('SELECT * FROM os_playbooks WHERE workspace_id = ? AND tool_id = ?').all(workspaceId, toolId) as unknown as Array<Record<string, string | number>>;
  let best: { row: Record<string, string | number>; score: number } | null = null;
  for (const row of rows) {
    const score = jaccard(keywords, parseJson<string[]>(String(row['keywords']), []));
    if (score >= 0.5 && (!best || score > best.score)) best = { row, score };
  }
  return best ? playbookView(best.row) : null;
}

export function recordPlaybookReuse(workspaceId: string, playbookId: string, actor: string): void {
  const db = getOsDb();
  db.prepare('UPDATE os_playbooks SET reuse_count = COALESCE(reuse_count, 0) + 1, updated_at = ? WHERE id = ?').run(nowIso(), playbookId);
  audit(db, { workspaceId, actor, action: 'playbook.reuse', subject: playbookId, detail: {} });
}

export function listPlaybooks(workspaceId: string): PlaybookRecord[] {
  const rows = getOsDb().prepare('SELECT * FROM os_playbooks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50').all(workspaceId) as unknown as Array<Record<string, string | number>>;
  return rows.map(playbookView);
}

export function deletePlaybook(workspaceId: string, playbookId: string, actor: string): boolean {
  const db = getOsDb();
  const result = db.prepare('DELETE FROM os_playbooks WHERE workspace_id = ? AND id = ?').run(workspaceId, playbookId);
  if (result.changes > 0) audit(db, { workspaceId, actor, action: 'playbook.delete', subject: playbookId, detail: {} });
  return result.changes > 0;
}

/** Re-run the solver on the recorded input — the only way a playbook earns trust. */
async function revalidate(tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  try {
    if (tool === 'or.employee_schedule') {
      const out = await solveEmployeeSchedule(input as unknown as Parameters<typeof solveEmployeeSchedule>[0]);
      return { ok: out.feasible === true, detail: `re-solve feasible=${out.feasible}, totalCost=${String(out.totalCost ?? 'n/a')}` };
    }
    if (tool === 'or.solve_lp') {
      const out = await solveLp(input as unknown as Parameters<typeof solveLp>[0]);
      return { ok: out.status === 'Optimal', detail: `re-solve status=${out.status}` };
    }
    if (tool === 'or.assignment') {
      const out = solveAssignment(
        input['costMatrix'] as number[][],
        input['rowLabels'] as string[] | undefined,
        input['colLabels'] as string[] | undefined,
      );
      const matrix = input['costMatrix'] as number[][];
      return { ok: out.assignments.length === matrix.length, detail: `assignment covers ${out.assignments.length}/${matrix.length} rows, totalCost=${out.totalCost ?? 'n/a'}` };
    }
    return { ok: false, detail: 'tool not revalidatable' };
  } catch (err) {
    return { ok: false, detail: `re-validation error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** After a mission completes, distill validated OR runs into reusable playbooks. */
export async function maybeDistillPlaybook(input: { workspaceId: string; missionId: string; objective: string; actor: string }): Promise<PlaybookRecord[]> {
  const db = getOsDb();
  const tasks = db.prepare("SELECT * FROM os_tasks WHERE mission_id = ? AND status = 'completed'").all(input.missionId) as Array<{ id: string; tool: string | null; tool_input: string; title: string }>;
  const distilled: PlaybookRecord[] = [];
  for (const task of tasks) {
    if (!task.tool || !OR_TOOLS.has(task.tool)) continue;
    const toolInput = parseJson<Record<string, unknown>>(task.tool_input, {});
    const validation = await revalidate(task.tool, toolInput);
    if (!validation.ok) {
      audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'playbook.rejected', subject: task.tool, detail: { reason: validation.detail, missionId: input.missionId } });
      continue;
    }
    const keywords = tokenize(input.objective);
    const candidates = db.prepare('SELECT * FROM os_playbooks WHERE workspace_id = ? AND tool_id = ?').all(input.workspaceId, task.tool) as unknown as Array<Record<string, string | number>>;
    let twin: Record<string, string | number> | null = null;
    for (const candidate of candidates) {
      if (jaccard(keywords, parseJson<string[]>(String(candidate['keywords']), [])) >= 0.5) { twin = candidate; break; }
    }
    if (twin) {
      db.prepare('UPDATE os_playbooks SET success_runs = success_runs + 1, validation = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(validation), nowIso(), String(twin['id']));
      audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'playbook.reinforce', subject: String(twin['id']), detail: { missionId: input.missionId, successRuns: Number(twin['success_runs']) + 1 } });
      distilled.push(playbookView(db.prepare('SELECT * FROM os_playbooks WHERE id = ?').get(String(twin['id'])) as Record<string, string | number>));
      continue;
    }
    const id = newId('pbk');
    const name = `${task.tool} — ${input.objective.slice(0, 72)}`;
    db.prepare(`INSERT INTO os_playbooks (id, workspace_id, name, tool_id, keywords, tool_input, validation, status, success_runs, created_from_mission, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', 1, ?, ?, ?)`)
      .run(id, input.workspaceId, name, task.tool, JSON.stringify(keywords), JSON.stringify(toolInput).slice(0, 60_000), JSON.stringify(validation), input.missionId, nowIso(), nowIso());
    audit(db, { workspaceId: input.workspaceId, actor: input.actor, action: 'playbook.distill', subject: id, detail: { missionId: input.missionId, tool: task.tool, validation: validation.detail } });
    distilled.push(playbookView(db.prepare('SELECT * FROM os_playbooks WHERE id = ?').get(id) as Record<string, string | number>));
  }
  return distilled;
}
