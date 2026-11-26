/**
 * WORA OS — planning evaluation.
 *
 * Compares the existing deterministic planner with its own direct/risk-first
 * alternatives and with the existing MIP scheduler. The test records measured
 * metrics and only asserts behavior that was actually produced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-planning-eval-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { comparePlans } = await import('./planning.js');
const { understandProblem } = await import('./problem.js');
const { sampleEmployeeInput } = await import('./orchestrator.js');
const { solveEmployeeSchedule } = await import('./ortools.js');

const WS = 'wora-planning-eval';

type Task = { title: string; objective: string; specialization: string; tool: string | null; toolInput: Record<string, unknown>; dependsOn: number[]; acceptance: string[]; detail: string };
const task = (title: string, tool: string | null, dependsOn: number[] = []): Task => ({
  title, objective: title, specialization: tool === 'host.exec' ? 'qa_engineer' : 'business_analyst',
  tool, toolInput: {}, dependsOn, acceptance: ['verified'], detail: '',
});

test('independent tasks: direct and risk-first orders have equal cost; risk-first adds no measured benefit', () => {
  const profile = understandProblem({ objective: 'Analyze independent requirements' });
  const plan = Array.from({ length: 8 }, (_, index) => task(`independent-${index}`, 'text.extract_summary'));
  const comparison = comparePlans(plan, WS, profile);
  const [direct, riskFirst] = comparison.plans;
  assert.equal(direct!.metrics.totalCost, riskFirst!.metrics.totalCost);
  assert.equal(direct!.metrics.depth, 1);
  assert.equal(riskFirst!.metrics.depth, 1);
  assert.equal(comparison.preferred.strategy, 'direct');
  console.log(`[planning-eval] independent tasks=${plan.length} depth=${direct!.metrics.depth} totalCost=${direct!.metrics.totalCost} preferred=${comparison.preferred.strategy}`);
});

test('mixed-risk independent tasks: reordering changes order, not total cost; no A* or HTN claim', () => {
  const profile = understandProblem({ objective: 'Analyze mixed-risk requirements' });
  const plan = [task('low', 'text.extract_summary'), task('high', 'host.exec'), task('medium', 'scaffold.webapp')];
  const comparison = comparePlans(plan, WS, profile);
  const [direct, riskFirst] = comparison.plans;
  assert.deepEqual(direct!.order, [0, 1, 2]);
  assert.deepEqual(riskFirst!.order, [1, 2, 0]);
  assert.equal(direct!.metrics.totalCost, riskFirst!.metrics.totalCost);
  assert.equal(direct!.metrics.maxRisk, 'high');
  assert.equal(comparison.preferred.strategy, 'direct');
  console.log(`[planning-eval] mixed-risk direct=${direct!.order.join(',')} risk-first=${riskFirst!.order.join(',')} totalCost=${direct!.metrics.totalCost}`);
});

test('dependency chain: order is forced; depth exposes the critical path without a search algorithm', () => {
  const profile = understandProblem({ objective: 'Analyze sequential requirements' });
  const plan = Array.from({ length: 6 }, (_, index) => task(`chain-${index}`, 'text.extract_summary', index ? [index - 1] : []));
  const comparison = comparePlans(plan, WS, profile);
  assert.deepEqual(comparison.plans[0]!.order, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(comparison.plans[1]!.order, [0, 1, 2, 3, 4, 5]);
  assert.equal(comparison.plans[0]!.metrics.depth, 6);
  assert.equal(comparison.plans[1]!.metrics.depth, 6);
  assert.equal(comparison.preferred.strategy, 'direct');
  console.log(`[planning-eval] chain tasks=${plan.length} depth=${comparison.plans[0]!.metrics.depth} criticalPath=${comparison.plans[0]!.criticalPath.join('>')}`);
});

test('resource-constrained scheduling is delegated to the existing MIP solver, not reimplemented by the planner', async () => {
  const { employees, shifts } = sampleEmployeeInput();
  const started = Date.now();
  const result = await solveEmployeeSchedule({ employees, shifts });
  const elapsed = Date.now() - started;
  assert.equal(result.feasible, true);
  assert.ok((result.totalCost ?? -1) >= 0);
  assert.ok(result.assignments.length > 0);
  console.log(`[planning-eval] MIP employees=${employees.length} shifts=${shifts.length} feasible=${result.feasible} cost=${result.totalCost ?? 'n/a'} elapsedMs=${elapsed}`);
});
