/**
 * WORA OS — held-out generalization benchmark.
 *
 * These formulations are distinct from the 11 development cases in
 * adaptive-benchmark.test.ts. They were written after the selection policy was
 * fixed and are not used to tune it. The benchmark measures classification,
 * selected method, unsupported-requirement honesty, unnecessary solver use and
 * real execution for a subset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-v22-heldout-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { buildPlan, createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { understandProblem } = await import('./problem.js');
const { selectAdaptiveMethod } = await import('./adaptive-intelligence.js');
const { ensureSeedAgents } = await import('./registry.js');
const { setExecutionLimits } = await import('./task-queue.js');

const WS = 'wora-v22-heldout';
ensureSeedAgents(WS);
setExecutionLimits(WS, { maxAttempts: 1 }, 'test');

type HeldOut = { id: string; objective: string; expected: string | null; research?: string; ordinary?: boolean; execute?: boolean };

const cases: HeldOut[] = [
  {
    id: 'audit-assignment', expected: 'or.assignment', execute: true,
    objective: 'Match five auditors to five engagements one-to-one at minimum cost. Test data: {"costMatrix":[[9,2,7,8,6],[6,4,3,7,8],[5,8,1,9,4],[7,6,9,2,5],[4,7,6,5,3]]}',
  },
  {
    id: 'technician-routing', expected: 'routing.vrp', execute: true,
    objective: `Design technician routes from two service hubs for six jobs with limited van capacity. Test data: ${JSON.stringify({
      depots: [{ id: 'north-hub', x: 0, y: 10 }, { id: 'south-hub', x: 0, y: -10 }],
      customers: [
        { id: 'j1', x: 2, y: 12, demand: 2 }, { id: 'j2', x: -3, y: 9, demand: 3 }, { id: 'j3', x: 4, y: 7, demand: 1 },
        { id: 'j4', x: -2, y: -8, demand: 2 }, { id: 'j5', x: 3, y: -11, demand: 3 }, { id: 'j6', x: -4, y: -12, demand: 1 },
      ],
      vehicles: [{ id: 'van-1', capacity: 6 }, { id: 'van-2', capacity: 6 }, { id: 'van-3', capacity: 6 }],
    })}`,
  },
  {
    id: 'blend-mix', expected: 'or.solve_lp', execute: true,
    objective: 'Blend two raw materials to minimize cost while meeting protein and weight limits. Test data: {"sense":"minimize","objective":[{"var":"corn","coeff":3},{"var":"soy","coeff":5}],"constraints":[{"name":"protein","terms":[{"var":"corn","coeff":2},{"var":"soy","coeff":7}],"op":">=","rhs":28},{"name":"weight","terms":[{"var":"corn","coeff":1},{"var":"soy","coeff":1}],"op":">=","rhs":10}],"bounds":{"corn":{"lower":0},"soy":{"lower":0}}}',
  },
  {
    id: 'nurse-roster', expected: 'or.employee_schedule',
    objective: `Build a weekend roster for four nurses across three shifts at minimum cost. Test data: ${JSON.stringify({
      employees: [
        { id: 'n1', name: 'Nora', hourlyCost: 22, availability: ['fri', 'sat'], maxAssignments: 1 },
        { id: 'n2', name: 'Omar', hourlyCost: 20, availability: ['sat', 'sun'], maxAssignments: 1 },
        { id: 'n3', name: 'Lina', hourlyCost: 24, availability: ['fri', 'sun'], maxAssignments: 1 },
        { id: 'n4', name: 'Sami', hourlyCost: 19, availability: ['fri', 'sat', 'sun'], maxAssignments: 2 },
      ],
      shifts: [{ id: 'fri', name: 'Friday', demand: 1 }, { id: 'sat', name: 'Saturday', demand: 2 }, { id: 'sun', name: 'Sunday', demand: 1 }],
    })}`,
  },
  {
    id: 'road-network', expected: 'graph.shortest_path', execute: true,
    objective: 'Find the fastest route through this road network. Test data: {"edges":[{"from":"A","to":"B","weight":4},{"from":"A","to":"C","weight":2},{"from":"C","to":"B","weight":1},{"from":"B","to":"D","weight":5},{"from":"C","to":"D","weight":8},{"from":"D","to":"E","weight":2}],"start":"A","goal":"E"}',
  },
  {
    id: 'water-network', expected: 'graph.max_flow',
    objective: 'Maximize throughput through this water distribution network. Test data: {"source":"reservoir","sink":"city","edges":[{"from":"reservoir","to":"pump-a","capacity":12},{"from":"reservoir","to":"pump-b","capacity":8},{"from":"pump-a","to":"city","capacity":9},{"from":"pump-b","to":"city","capacity":7},{"from":"pump-a","to":"pump-b","capacity":2}]}',
  },
  {
    id: 'laptop-tradeoffs', expected: 'decision.pareto',
    objective: `Compare four laptop models on price and battery life without inventing missing scores. Test data: ${JSON.stringify({
      objectives: [{ id: 'price', label: 'Price', direction: 'minimize' }, { id: 'battery', label: 'Battery', direction: 'maximize' }],
      candidates: [
        { name: 'air', values: { price: 1100, battery: 14 } }, { name: 'pro', values: { price: 1600, battery: 18 } },
        { name: 'budget', values: { price: 700, battery: 9 } }, { name: 'travel', values: { price: 1200, battery: 20 } },
      ],
    })}`,
  },
  {
    id: 'conversion-belief', expected: 'stats.bayes_update',
    objective: 'Estimate the conversion probability after eighteen successes in twenty-five trials, starting from a weak prior. Test data: {"type":"beta_binomial","prior":{"alpha":1,"beta":1},"successes":18,"trials":25,"credibleLevel":0.95}',
  },
  {
    id: 'ticket-queue', expected: 'sim.queue',
    objective: 'Simulate a ticket counter with two agents and report waiting time and utilization. Test data: {"customers":250,"interarrivalMean":1.2,"serviceMean":2.1,"servers":2,"seed":11}',
  },
  {
    id: 'monthly-demand', expected: 'forecast.linear',
    objective: 'Forecast monthly demand for the next four months from this historical series. Test data: {"series":[21,23,22,25,27,26,29,31,30,33],"steps":4}',
  },
  {
    id: 'nonlinear-reactor', expected: null, research: 'research-required',
    objective: 'Minimize a nonlinear non-convex reactor yield objective with this model. Test data: {"sense":"minimize","objective":[{"var":"temperature","coeff":1}],"constraints":[{"name":"limit","terms":[{"var":"temperature","coeff":1}],"op":"<=","rhs":10}]}',
  },
  {
    id: 'time-window-delivery', expected: null, research: 'research-required',
    objective: 'Route delivery vans with strict customer time windows and capacity limits. Test data: {"depots":[{"id":"d","x":0,"y":0}],"customers":[{"id":"c1","x":1,"y":1,"demand":1}],"vehicles":[{"id":"v","capacity":4}]}',
  },
  {
    id: 'stochastic-inventory', expected: null, research: 'research-required',
    objective: 'Solve a two-stage stochastic inventory problem with uncertain demand. Test data: {"sense":"minimize","objective":[{"var":"order","coeff":1}],"constraints":[{"name":"demand","terms":[{"var":"order","coeff":1}],"op":">=","rhs":5}]}',
  },
  {
    id: 'policy-summary', expected: null, ordinary: true,
    objective: 'Write a short summary of the onboarding policy and list three open questions for the people team.',
  },
  {
    id: 'design-agenda', expected: null, ordinary: true,
    objective: 'Draft an agenda for the weekly design review and note the decisions we need to make.',
  },
];

test('held-out benchmark — unseen formulations select the right method or an honest gap', () => {
  let correct = 0;
  let unnecessarySolvers = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of cases) {
    const profile = understandProblem({ objective: entry.objective });
    const decision = selectAdaptiveMethod({ workspaceId: WS, objective: entry.objective, profile });
    const selected = decision.selected?.toolId ?? null;
    const plan = buildPlan(entry.objective, undefined, WS);
    const solver = plan.find((task) => /^(?:or|routing|graph|decision|stats|sim|forecast)\./u.test(task.tool ?? ''));
    const passed = selected === entry.expected
      && (entry.research ? decision.research?.status === entry.research : true)
      && (entry.ordinary ? decision.scientificRequired === false && !solver : true);
    if (passed) correct += 1;
    if (entry.ordinary && solver) unnecessarySolvers += 1;
    rows.push({ id: entry.id, selected, expected: entry.expected, research: decision.research?.status ?? null, planned: plan.map((task) => task.tool), passed });
  }
  const accuracy = correct / cases.length;
  console.log(`HELD_OUT_BENCHMARK ${JSON.stringify({ cases: cases.length, correct, accuracy, unnecessarySolvers, rows })}`);
  assert.equal(accuracy, 1, 'held-out cases must select the expected method or an explicit research/gap outcome');
  assert.equal(unnecessarySolvers, 0, 'ordinary held-out tasks must not start a solver');
});

test('held-out execution subset reaches the real objective and is independently verified', async () => {
  for (const entry of cases.filter((candidate) => candidate.execute)) {
    const workspaceId = `${WS}-${entry.id}`;
    ensureSeedAgents(workspaceId);
    setExecutionLimits(workspaceId, { maxAttempts: 1 }, 'test');
    const missionId = createMission({ workspaceId, objective: entry.objective, actor: 'test' });
    await executeMission(missionId, 'test');
    const detail = getMissionDetail(workspaceId, missionId)!;
    assert.equal(detail.status, 'completed', `${entry.id}: ${detail.summary}`);
    assert.equal(detail.outcomeStatus, 'verified', `${entry.id}: outcome ${detail.outcomeStatus}`);
    assert.ok(detail.tasks.some((task) => task.tool === entry.expected), `${entry.id}: missing ${entry.expected}`);
    assert.ok(detail.verifications.every((verification) => verification.result === 'passed'), `${entry.id}: verification failed`);
  }
});
