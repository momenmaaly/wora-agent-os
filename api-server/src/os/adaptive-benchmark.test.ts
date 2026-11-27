/**
 * WORA OS — adaptive method-selection benchmark.
 *
 * Methodology: a fixed, inspectable matrix of natural-language objectives with
 * known structure and expected executable method (or an explicit research/gap
 * outcome). The benchmark measures exact selection, unnecessary-solver use and
 * honesty on unsupported requirements. It is deterministic and uses the real
 * catalog and planner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-adaptive-benchmark-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { understandProblem } = await import('./problem.js');
const { selectAdaptiveMethod } = await import('./adaptive-intelligence.js');
const { buildPlan } = await import('./orchestrator.js');

const WS = 'wora-adaptive-benchmark';

const cases: Array<{ id: string; objective: string; expected: string | null; research?: string; ordinary?: boolean }> = [
  { id: 'assignment', expected: 'or.assignment', objective: 'Assign three candidates to three options. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]]}' },
  { id: 'vrp', expected: 'routing.vrp', objective: `Route two capacity-limited vehicles to four customers. Test data: ${JSON.stringify({ depots: [{ id: 'd', x: 0, y: 0 }], customers: [{ id: 'a', x: 1, y: 1, demand: 2 }, { id: 'b', x: 2, y: 2, demand: 2 }], vehicles: [{ id: 'v', capacity: 4 }] })}` },
  { id: 'lp', expected: 'or.solve_lp', objective: 'Minimize a linear program. Test data: {"sense":"minimize","objective":[{"var":"x","coeff":1}],"constraints":[{"name":"c","terms":[{"var":"x","coeff":1}],"op":">=","rhs":2}],"bounds":[{"var":"x","lower":0}]}' },
  { id: 'schedule', expected: 'or.employee_schedule', objective: 'Schedule employees across shifts. Test data: {"employees":[{"id":"e","name":"E","hourlyCost":10,"availability":["s"],"maxAssignments":1}],"shifts":[{"id":"s","name":"S","demand":1}]}' },
  { id: 'bayes', expected: 'stats.bayes_update', objective: 'Update a Bayesian belief. Test data: {"type":"beta_binomial","prior":{"alpha":2,"beta":2},"successes":7,"trials":10}' },
  { id: 'tsp', expected: 'routing.tsp', objective: 'Plan the shortest tour. Test data: {"points":[{"id":"a","x":0,"y":0},{"id":"b","x":1,"y":0},{"id":"c","x":1,"y":1}]}' },
  { id: 'missing-max-flow', expected: null, research: 'missing-inputs', objective: 'Find the maximum flow from source to sink in our network.' },
  { id: 'time-windows', expected: null, research: 'research-required', objective: 'Route vehicles with delivery time windows and capacity.' },
  { id: 'nonlinear', expected: null, research: 'research-required', objective: 'Find a nonlinear non-convex optimum for a chemical process.' },
  { id: 'ordinary-report', expected: null, ordinary: true, objective: 'Write a short project update for the team and list the next three meetings.' },
  { id: 'ordinary-research', expected: null, ordinary: true, objective: 'Research competitors and summarize their public pricing pages.' },
];

test('adaptive benchmark — exact selection, no unnecessary solver, honest unsupported outcomes', () => {
  let correct = 0;
  let unnecessarySolvers = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of cases) {
    const profile = understandProblem({ objective: entry.objective });
    const decision = selectAdaptiveMethod({ workspaceId: WS, objective: entry.objective, profile });
    const selected = decision.selected?.toolId ?? null;
    const passed = selected === entry.expected
      && (entry.research ? decision.research?.status === entry.research : true)
      && (entry.ordinary ? decision.scientificRequired === false : true);
    if (passed) correct += 1;
    if (entry.ordinary) {
      const plan = buildPlan(entry.objective, undefined, WS);
      if (plan.some((task) => task.tool?.startsWith('or.') || task.tool?.startsWith('routing.') || task.tool?.startsWith('graph.'))) unnecessarySolvers += 1;
    }
    rows.push({
      id: entry.id, selected, expected: entry.expected, research: decision.research?.status ?? null,
      scientificRequired: decision.scientificRequired, candidates: decision.candidates.length, passed,
    });
  }
  const accuracy = correct / cases.length;
  console.log(`ADAPTIVE_BENCHMARK ${JSON.stringify({ cases: cases.length, correct, accuracy, unnecessarySolvers, rows })}`);
  assert.equal(accuracy, 1, 'every benchmark case must select the expected method or an explicit research/gap outcome');
  assert.equal(unnecessarySolvers, 0, 'ordinary tasks must not start a solver');
});
