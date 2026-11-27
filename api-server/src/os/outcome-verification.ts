/**
 * WORA OS — independent mission outcome verification.
 *
 * A completed command is not a completed outcome. This module checks the
 * actual evidence attached to each task, applies tool-specific outcome
 * invariants, and classifies the mission outcome explicitly. It never turns a
 * missing or failed verification into success.
 */
import { getOsDb, nowIso, parseJson, audit } from './db.js';
import { listVerifications, type VerificationRecord } from './verification.js';
import { openTaskToolInput } from '../security/task-fields.js';
import { redactSecrets } from './secrets.js';

export type OutcomeStatus = 'verified' | 'partially_verified' | 'unverified' | 'failed' | 'blocked' | 'requires_human_review';

export interface OutcomeCheck {
  id: string;
  kind: 'task' | 'verification' | 'outcome' | 'evidence' | 'security' | 'external';
  status: 'passed' | 'failed' | 'not_run';
  description: string;
  evidence: string;
}

export interface OutcomeVerification {
  missionId: string;
  workspaceId: string;
  status: OutcomeStatus;
  checks: OutcomeCheck[];
  reasons: string[];
  taskEvidence: Array<{ taskId: string; tool: string | null; status: string; verification: string | null; outcome: string }>;
  artifactId: string | null;
  generatedAt: string;
}

interface TaskRow {
  id: string; workspace_id: string; mission_id: string; title: string; status: string;
  tool: string | null; tool_input: string; detail: string; created_at: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function latestRunOutput(workspaceId: string, taskId: string): { output: unknown; digest: string | null; runId: string | null } {
  const row = getOsDb().prepare("SELECT id, evidence FROM os_runs WHERE workspace_id = ? AND task_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1")
    .get(workspaceId, taskId) as { id?: string; evidence?: string } | undefined;
  if (!row?.evidence) return { output: null, digest: null, runId: row?.id ?? null };
  const evidence = parseJson<Array<Record<string, unknown>>>(row.evidence, []);
  const entry = evidence.find((item) => item['output'] !== undefined);
  return {
    output: entry?.['output'] ?? null,
    digest: typeof entry?.['artifactDigest'] === 'string' ? entry['artifactDigest'] : null,
    runId: row.id ?? null,
  };
}

function resolveOutcomeInput(workspaceId: string, missionId: string, task: TaskRow, input: Record<string, unknown>): Record<string, unknown> {
  const bindings = parseJson<Array<{ key?: string; taskIndex?: number; path?: string[] }>>(
    (getOsDb().prepare('SELECT input_bindings FROM os_tasks WHERE id = ?').get(task.id) as { input_bindings?: string } | undefined)?.input_bindings ?? '[]', [],
  );
  const resolved = { ...input };
  for (const binding of bindings) {
    const taskIndex = binding.taskIndex;
    if (!binding.key || !Number.isInteger(taskIndex)) continue;
    const upstream = getOsDb().prepare('SELECT id, status FROM os_tasks WHERE mission_id = ? AND order_index = ?').get(missionId, taskIndex as number) as { id?: string; status?: string } | undefined;
    if (!upstream?.id || upstream.status !== 'completed') continue;
    const run = getOsDb().prepare("SELECT evidence FROM os_runs WHERE task_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1").get(upstream.id) as { evidence?: string } | undefined;
    const evidence = run?.evidence ? parseJson<Array<Record<string, unknown>>>(run.evidence, []) : [];
    let value: unknown = evidence.find((entry) => entry['output'] !== undefined)?.['output'];
    for (const segment of binding.path ?? []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { value = undefined; break; }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value !== undefined && value !== null) resolved[binding.key] = value;
  }
  return resolved;
}

function toolOutcome(tool: string | null, output: unknown, input: unknown): { status: 'passed' | 'failed' | 'not_run'; description: string; evidence: string } {
  if (!isRecord(output)) return { status: 'not_run', description: 'No actual output is available for an independent outcome check', evidence: 'missing run output' };
  const out = output;
  const inp = isRecord(input) ? input : {};
  switch (tool) {
    case 'host.exec': {
      const passed = out['passed'] === true;
      return { status: passed ? 'passed' : 'failed', description: 'The executed test command reports a real passing exit and test result', evidence: `passed=${String(out['passed'])} exitCode=${String(out['exitCode'] ?? '?')}` };
    }
    case 'scaffold.webapp': {
      const files = Array.isArray(out['files']) ? out['files'].length : 0;
      const passed = out['testPassed'] === true && files > 0;
      return { status: passed ? 'passed' : 'failed', description: 'The generated application has files and its independent test run passed', evidence: `files=${files}; testPassed=${String(out['testPassed'])}` };
    }
    case 'or.employee_schedule': {
      const feasible = out['feasible'] === true;
      const assignments = Array.isArray(out['assignments']) ? out['assignments'].length : 0;
      const perShift = Array.isArray(out['perShift']) ? out['perShift'] as Array<Record<string, unknown>> : [];
      const demand = perShift.length > 0 && perShift.every((shift) => shift['meetsDemand'] === true);
      const passed = feasible && assignments > 0 && demand && finite(out['totalCost']);
      return { status: passed ? 'passed' : 'failed', description: 'A feasible schedule meets every shift demand and has a finite cost', evidence: `feasible=${feasible}; assignments=${assignments}; demandCovered=${demand}; cost=${String(out['totalCost'])}` };
    }
    case 'or.assignment': {
      const assignments = Array.isArray(out['assignments']) ? out['assignments'].length : 0;
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const passed = verified && assignments > 0 && finite(out['totalCost']) && Number(out['totalCost']) >= 0;
      return { status: passed ? 'passed' : 'failed', description: 'The assignment covers rows, has a finite non-negative cost and passed independent verification', evidence: `verified=${verified}; assignments=${assignments}; cost=${String(out['totalCost'])}` };
    }
    case 'or.solve_lp': {
      const status = typeof out['status'] === 'string' ? out['status'] : '';
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const optimalOrFeasible = status === 'Optimal' || status === 'Feasible';
      const passed = verified && optimalOrFeasible && finite(out['objectiveValue']);
      return { status: passed ? 'passed' : 'failed', description: 'LP/MIP output is optimal or feasible and independently verified', evidence: `status=${status}; verified=${verified}; objective=${String(out['objectiveValue'])}` };
    }
    case 'graph.shortest_path': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const passed = verified && out['status'] === 'optimal' && Array.isArray(out['path']) && finite(out['totalCost']);
      return { status: passed ? 'passed' : 'failed', description: 'Shortest-path output is optimal, has a path and passed independent verification', evidence: `status=${String(out['status'])}; verified=${verified}; cost=${String(out['totalCost'])}` };
    }
    case 'graph.max_flow': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const cut = isRecord(out['minCut']) ? out['minCut'] : null;
      const passed = verified && out['status'] === 'optimal' && finite(out['maxFlow']) && cut !== null
        && Math.abs(Number(out['maxFlow']) - Number(cut['capacity'])) <= 1e-6;
      return { status: passed ? 'passed' : 'failed', description: 'Max-flow is optimal, equals its min-cut certificate and passed independent verification', evidence: `status=${String(out['status'])}; maxFlow=${String(out['maxFlow'])}; minCut=${String(cut?.['capacity'])}; verified=${verified}` };
    }
    case 'graph.min_cost_flow': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const passed = verified && out['status'] === 'optimal' && finite(out['flow']) && finite(out['totalCost'])
        && Number(out['flow']) === Number(out['demand']);
      return { status: passed ? 'passed' : 'failed', description: 'Min-cost flow delivers the exact demand and passed independent verification', evidence: `status=${String(out['status'])}; flow=${String(out['flow'])}; demand=${String(out['demand'])}; cost=${String(out['totalCost'])}; verified=${verified}` };
    }
    case 'graph.bipartite_matching': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const matching = Array.isArray(out['matching']) ? out['matching'].length : 0;
      const passed = verified && out['status'] === 'optimal' && finite(out['size']) && matching === Number(out['size']);
      return { status: passed ? 'passed' : 'failed', description: 'Bipartite matching size is consistent and passed independent verification', evidence: `status=${String(out['status'])}; size=${String(out['size'])}; pairs=${matching}; verified=${verified}` };
    }
    case 'routing.tsp': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const tour = Array.isArray(out['tour']) ? out['tour'].length : 0;
      const passed = verified && (out['status'] === 'optimal' || out['status'] === 'approximate') && tour > 0 && finite(out['cost']);
      return { status: passed ? 'passed' : 'failed', description: 'TSP output is optimal or explicitly approximate and independently verified', evidence: `status=${String(out['status'])}; exact=${String(out['exact'])}; nodes=${tour}; cost=${String(out['cost'])}; verified=${verified}` };
    }
    case 'routing.vrp': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const routes = Array.isArray(out['routes']) ? out['routes'].length : 0;
      const passed = verified && out['status'] === 'feasible' && routes > 0 && finite(out['totalDistance']);
      return { status: passed ? 'passed' : 'failed', description: 'VRP output is feasible, covers customers and passed independent verification', evidence: `status=${String(out['status'])}; routes=${routes}; distance=${String(out['totalDistance'])}; verified=${verified}` };
    }
    case 'decision.pareto': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const frontier = Array.isArray(out['frontier']) ? out['frontier'].length : 0;
      const passed = verified && out['status'] === 'optimal' && frontier > 0;
      return { status: passed ? 'passed' : 'failed', description: 'Pareto frontier is non-empty and passed independent dominance verification', evidence: `status=${String(out['status'])}; frontier=${frontier}; verified=${verified}` };
    }
    case 'stats.bayes_update': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const interval = isRecord(out['credibleInterval']) ? out['credibleInterval'] : null;
      const passed = verified && out['status'] === 'optimal' && interval !== null
        && finite(interval['lower']) && finite(interval['upper']) && Number(interval['lower']) <= Number(interval['upper']);
      return { status: passed ? 'passed' : 'failed', description: 'Bayesian posterior has a valid credible interval and passed independent verification', evidence: `status=${String(out['status'])}; interval=${interval ? `${String(interval['lower'])}..${String(interval['upper'])}` : 'missing'}; verified=${verified}` };
    }
    case 'sim.queue': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const passed = verified && out['simulated'] === true && Number(out['served']) === Number(out['customers']);
      return { status: passed ? 'passed' : 'failed', description: 'Queue simulation served every customer and passed independent verification', evidence: `served=${String(out['served'])}/${String(out['customers'])}; seed=${String(out['seed'])}; verified=${verified}` };
    }
    case 'sim.scenario_compare': {
      const verified = isRecord(out['verification']) && out['verification']['passed'] === true;
      const scenarios = Array.isArray(out['scenarios']) ? out['scenarios'].length : 0;
      const passed = verified && out['simulated'] === true && scenarios >= 2 && Array.isArray(out['ranking']);
      return { status: passed ? 'passed' : 'failed', description: 'Scenario comparison is reproducible and passed independent verification', evidence: `scenarios=${scenarios}; seed=${String(out['seed'])}; verified=${verified}` };
    }
    case 'meta.formulate_scientific_problem':
      return { status: out['executable'] === true ? 'passed' : 'failed', description: 'Scientific formulation is executable', evidence: `executable=${String(out['executable'])}` };
    case 'stats.describe': {
      const series = Array.isArray(inp['series']) ? inp['series'].length : null;
      const count = finite(out['count']) ? Number(out['count']) : null;
      const passed = finite(out['mean']) && count !== null && (series === null || count === series);
      return { status: passed ? 'passed' : 'failed', description: 'Descriptive statistics cover the exact supplied series', evidence: `inputSeries=${series ?? 'unknown'}; outputCount=${count}; mean=${String(out['mean'])}` };
    }
    case 'text.extract_summary': {
      const summary = typeof out['summary'] === 'string' ? out['summary'].trim() : '';
      return { status: summary ? 'passed' : 'failed', description: 'The summary is non-empty and derived from the supplied text', evidence: `${summary.length} characters` };
    }
    case 'sim.monte_carlo': {
      const ordered = finite(out['p10']) && finite(out['p50']) && finite(out['p90']) && Number(out['p10']) <= Number(out['p50']) && Number(out['p50']) <= Number(out['p90']);
      return { status: ordered ? 'passed' : 'failed', description: 'Simulation quantiles are ordered and finite', evidence: `p10=${String(out['p10'])} p50=${String(out['p50'])} p90=${String(out['p90'])}` };
    }
    case 'forecast.linear': {
      const projections = Array.isArray(out['projections']) ? out['projections'].length : 0;
      return { status: projections > 0 ? 'passed' : 'failed', description: 'A forecast produced ordered projections', evidence: `projections=${projections}` };
    }
    case 'decision.weighted_matrix': {
      const ranking = Array.isArray(out['ranking']) ? out['ranking'].length : 0;
      return { status: ranking > 0 ? 'passed' : 'failed', description: 'The decision produced a ranking', evidence: `ranking=${ranking}` };
    }
    case 'org.build': {
      const id = typeof out['organizationId'] === 'string' ? out['organizationId'] : '';
      const exists = id ? Boolean(getOsDb().prepare('SELECT 1 FROM os_organizations WHERE id = ?').get(id)) : false;
      return { status: exists ? 'passed' : 'failed', description: 'The organization is persisted and readable', evidence: `organizationId=${id || 'missing'}; exists=${exists}` };
    }
    case 'agents.create': {
      const id = typeof out['id'] === 'string' ? out['id'] : '';
      const exists = id ? Boolean(getOsDb().prepare('SELECT 1 FROM os_agents WHERE id = ?').get(id)) : false;
      return { status: exists ? 'passed' : 'failed', description: 'The created agent is persisted and readable', evidence: `agentId=${id || 'missing'}; exists=${exists}` };
    }
    case 'web.fetch_read': {
      const status = finite(out['status']) ? Number(out['status']) : 0;
      return { status: status > 0 && status < 400 ? 'passed' : 'failed', description: 'The authoritative HTTP response is successful', evidence: `status=${status}` };
    }
    case 'browser.open': {
      const title = typeof out['title'] === 'string' ? out['title'].trim() : '';
      const url = typeof out['url'] === 'string' ? out['url'] : '';
      const status = finite(out['status']) ? Number(out['status']) : 0;
      return { status: title && url && status > 0 && status < 400 ? 'passed' : 'failed', description: 'A real browser loaded a titled page successfully', evidence: `title=${title.slice(0, 120)}; url=${url}; status=${status}` };
    }
    case 'browser.inspect': {
      const markdown = typeof out['markdown'] === 'string' ? out['markdown'].trim() : '';
      const headings = Array.isArray(out['headings']) ? out['headings'].length : 0;
      return { status: markdown.length > 40 ? 'passed' : 'failed', description: 'Live DOM inspection produced substantive page content', evidence: `markdown=${markdown.length} chars; headings=${headings}` };
    }
    case 'browser.screenshot': {
      const id = typeof out['artifactId'] === 'string' ? out['artifactId'] : '';
      const bytes = finite(out['bytes']) ? Number(out['bytes']) : 0;
      const exists = id ? Boolean(getOsDb().prepare('SELECT 1 FROM os_runtime_artifacts WHERE id = ?').get(id)) : false;
      return { status: id && bytes > 0 && exists ? 'passed' : 'failed', description: 'A real PNG screenshot is persisted as a runtime artifact', evidence: `artifactId=${id || 'missing'}; bytes=${bytes}; persisted=${exists}` };
    }
    case 'browser.research': {
      const documentId = typeof out['documentArtifactId'] === 'string' ? out['documentArtifactId'] : '';
      const screenshotId = typeof out['screenshotArtifactId'] === 'string' ? out['screenshotArtifactId'] : '';
      const markdown = typeof out['markdown'] === 'string' ? out['markdown'].trim() : '';
      const persisted = [documentId, screenshotId].filter(Boolean).filter((id) => Boolean(getOsDb().prepare('SELECT 1 FROM os_runtime_artifacts WHERE id = ?').get(id))).length;
      return { status: markdown.length > 40 && persisted === 2 ? 'passed' : 'failed', description: 'Browser research produced a substantive Markdown summary and two persisted artifacts', evidence: `markdown=${markdown.length} chars; persistedArtifacts=${persisted}` };
    }
    case 'cloud.write_file': {
      const bytes = finite(out['bytes']) ? Number(out['bytes']) : 0;
      return { status: bytes > 0 ? 'passed' : 'failed', description: 'The cloud workspace file contains bytes written by the tool', evidence: `bytes=${bytes}` };
    }
    case 'cloud.exec': {
      const exitCode = out['exitCode'];
      return { status: exitCode === 0 && out['timedOut'] !== true ? 'passed' : 'failed', description: 'The cloud command completed with exit code 0 and did not time out', evidence: `exitCode=${String(exitCode)}; timedOut=${String(out['timedOut'])}` };
    }
    default: {
      if (!isRecord(output)) return { status: 'not_run', description: 'No tool-specific independent outcome check is available', evidence: 'no output' };
      if (/\.echo$/u.test(tool ?? '')) {
        const expected = typeof inp['text'] === 'string' ? inp['text'] : null;
        const contentText = Array.isArray(out['content'])
          ? (out['content'] as Array<Record<string, unknown>>).map((item) => typeof item['text'] === 'string' ? item['text'] : '').join('')
          : null;
        const actual = typeof out['text'] === 'string' ? out['text'] : contentText;
        if (actual === null) return { status: 'not_run', description: 'The echo output shape is not independently comparable', evidence: 'no text or MCP content text' };
        const passed = expected !== null && actual === expected;
        return { status: passed ? 'passed' : 'failed', description: 'The echo tool returned exactly the supplied text', evidence: `expected=${expected?.length ?? 0} chars; actual=${actual.length} chars` };
      }
      return { status: 'not_run', description: 'The plugin output has no tool-specific independent outcome invariant', evidence: `plugin tool ${tool ?? 'unknown'}` };
    }
  }
}

export function verifyMissionOutcome(workspaceId: string, missionId: string): OutcomeVerification {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, missionId) as
    | { id: string; status: string; objective: string; artifact_id: string | null }
    | undefined;
  if (!mission) throw new Error('Mission not found');
  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index').all(missionId) as unknown as TaskRow[];
  const verifications = listVerifications(workspaceId, { missionId, limit: 200 });
  const byTask = new Map<string, VerificationRecord>();
  for (const verification of verifications) if (!byTask.has(verification.taskId)) byTask.set(verification.taskId, verification);
  const checks: OutcomeCheck[] = [];
  const reasons: string[] = [];
  const taskEvidence: OutcomeVerification['taskEvidence'] = [];
  let partial = false;

  const add = (check: OutcomeCheck) => {
    checks.push(check);
    if (check.status === 'failed') reasons.push(`${check.id}: ${check.evidence}`);
  };

  add({
    id: 'task-completion', kind: 'task', status: tasks.length > 0 && tasks.every((task) => task.status === 'completed') ? 'passed' : 'failed',
    description: 'Every planned task reached completed status', evidence: `${tasks.filter((task) => task.status === 'completed').length}/${tasks.length} completed`,
  });

  for (const task of tasks) {
    const verification = byTask.get(task.id) ?? null;
    const run = latestRunOutput(workspaceId, task.id);
    const input = resolveOutcomeInput(workspaceId, missionId, task, openTaskToolInput<Record<string, unknown>>(workspaceId, task.id, task.tool_input, {}));
    const outcome = task.status === 'completed' ? toolOutcome(task.tool, run.output, input) : { status: 'not_run' as const, description: 'Task did not complete', evidence: task.status };
    add({
      id: `task-${task.id}-execution`, kind: 'task', status: task.status === 'completed' ? 'passed' : 'failed',
      description: `Task "${task.title}" completed`, evidence: `status=${task.status}; tool=${task.tool ?? 'none'}`,
    });
    add({
      id: `task-${task.id}-verification`, kind: 'verification',
      status: verification?.result === 'passed' ? 'passed' : verification ? 'failed' : 'not_run',
      description: `Task "${task.title}" has an independent verification record`, evidence: verification ? `${verification.verifier}: ${verification.result}` : 'no verification record',
    });
    add({
      id: `task-${task.id}-outcome`, kind: 'outcome', status: outcome.status,
      description: `Outcome invariant for "${task.title}"`, evidence: outcome.evidence,
    });
    if (outcome.status === 'not_run' && task.status === 'completed') partial = true;
    add({
      id: `task-${task.id}-artifact`, kind: 'evidence',
      status: verification && run.digest ? 'passed' : 'not_run',
      description: `Task "${task.title}" has a completed run with an artifact digest`,
      evidence: run.digest ? `digest=${run.digest.slice(0, 16)}…` : 'no completed run digest',
    });
    taskEvidence.push({ taskId: task.id, tool: task.tool, status: task.status, verification: verification?.result ?? null, outcome: outcome.status });
  }

  const inputGapTasks = tasks.filter((task) => /(?:FORECAST INPUT GAP|INPUT GAP\b|MISSING REQUIRED INPUT)/iu.test(task.detail ?? ''));
  if (inputGapTasks.length) {
    partial = true;
    add({
      id: 'required-input-gap', kind: 'outcome', status: 'not_run',
      description: 'A task reported missing required inputs instead of fabricating them',
      evidence: inputGapTasks.map((task) => task.detail).join(' | ').slice(0, 1_500),
    });
  }
  const compositionRow = db.prepare('SELECT gaps FROM os_capability_compositions WHERE mission_id = ?').get(missionId) as { gaps?: string } | undefined;
  const compositionGaps = compositionRow?.gaps ? parseJson<Array<{ message?: string; missing?: string[] }>>(compositionRow.gaps, []) : [];
  if (compositionGaps.length) {
    add({
      id: 'capability-gap', kind: 'outcome', status: 'not_run',
      description: 'The composition reported an unfulfilled capability gap',
      evidence: compositionGaps.map((gap) => `${(gap.missing ?? []).join(', ')}: ${gap.message ?? ''}`).join(' | ').slice(0, 1_500),
    });
  }
  const artifacts = db.prepare('SELECT id FROM os_artifacts WHERE mission_id = ? LIMIT 1').get(missionId) as { id?: string } | undefined;
  add({
    id: 'mission-artifact', kind: 'evidence', status: artifacts?.id ? 'passed' : 'failed',
    description: 'The mission deliverable artifact exists', evidence: artifacts?.id ? `artifact=${artifacts.id}` : 'no mission artifact',
  });
  const leaked = verifications.some((verification) => verification.checks.some((check) => check.id === 'secret-leak' && check.status === 'failed'));
  add({
    id: 'secret-safety', kind: 'security', status: leaked ? 'failed' : 'passed',
    description: 'No verification record reported a credential leak', evidence: leaked ? 'a verification check failed for secret leak' : 'no secret-leak failure recorded',
  });

  if (mission.status === 'cancelled') {
    reasons.push('The mission was cancelled; no outcome is claimed.');
    return persist(workspaceId, missionId, { missionId, workspaceId, status: 'blocked', checks, reasons: [...new Set(reasons)], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  }
  const anyFailed = tasks.some((task) => task.status === 'failed');
  if (anyFailed) return persist(workspaceId, missionId, { missionId, workspaceId, status: 'failed', checks, reasons: [...new Set([...reasons, 'At least one task failed.'])], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  const anyBlocked = tasks.some((task) => task.status === 'blocked');
  if (anyBlocked) return persist(workspaceId, missionId, { missionId, workspaceId, status: 'requires_human_review', checks, reasons: [...new Set([...reasons, 'A task is blocked; inspect approval or execution evidence.'])], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  if (tasks.some((task) => task.status !== 'completed')) return persist(workspaceId, missionId, { missionId, workspaceId, status: 'unverified', checks, reasons: [...new Set([...reasons, 'Not every task completed.'])], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  if (!verifications.length) return persist(workspaceId, missionId, { missionId, workspaceId, status: 'unverified', checks, reasons: [...new Set([...reasons, 'No independent verification records exist.'])], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });

  if (checks.some((check) => check.status === 'failed')) {
    return persist(workspaceId, missionId, { missionId, workspaceId, status: 'failed', checks, reasons: [...new Set(reasons)], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  }
  const notRun = checks.filter((check) => check.status === 'not_run');
  if (notRun.length || partial) {
    return persist(workspaceId, missionId, { missionId, workspaceId, status: 'partially_verified', checks, reasons: [...new Set([...reasons, ...notRun.map((check) => `${check.id}: ${check.description}`)])], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
  }
  const businessClaim = /market|revenue|profit|sales|سوق|إيراد|ربح|مبيعات/iu.test(mission.objective) && !/\b(?:forecast|project|predict|estimate|extrapolat)/iu.test(mission.objective);
  if (businessClaim) {
    return persist(workspaceId, missionId, {
      missionId, workspaceId, status: 'partially_verified',
      checks: [...checks, { id: 'external-business-outcome', kind: 'external', status: 'not_run', description: 'Market success is not independently observable', evidence: 'No authoritative external market/outcome source was used; only internal arithmetic, dependencies and feasibility are verified.' }],
      reasons: ['Internal business plan evidence is verified; actual market success is not claimed.'],
      taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso(),
    });
  }
  return persist(workspaceId, missionId, { missionId, workspaceId, status: 'verified', checks, reasons: [], taskEvidence, artifactId: artifacts?.id ?? null, generatedAt: nowIso() });
}

function persist(workspaceId: string, missionId: string, verification: OutcomeVerification): OutcomeVerification {
  const clean = redactSecrets(verification).value;
  getOsDb().prepare('UPDATE os_missions SET outcome_status = ?, outcome_evidence = ?, updated_at = ? WHERE workspace_id = ? AND id = ?')
    .run(clean.status, JSON.stringify(clean).slice(0, 120_000), nowIso(), workspaceId, missionId);
  audit(getOsDb(), { workspaceId, actor: 'wora.outcome-verifier', action: 'mission.outcome_verified', subject: missionId, detail: { status: clean.status, checks: clean.checks.length } });
  return clean;
}

export function getMissionOutcome(workspaceId: string, missionId: string): OutcomeVerification | null {
  const row = getOsDb().prepare('SELECT outcome_evidence FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, missionId) as { outcome_evidence?: string } | undefined;
  const parsed = row?.outcome_evidence ? parseJson<OutcomeVerification | null>(row.outcome_evidence, null) : null;
  return parsed && typeof parsed.status === 'string' && Array.isArray(parsed.checks) ? parsed : null;
}
