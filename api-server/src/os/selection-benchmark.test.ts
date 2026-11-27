/**
 * Deterministic benchmark: explainable dynamic selection vs a static
 * "first agent in the registry" baseline. Both read the same real agents,
 * verified evidence and workload; only the decision rule differs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-selection-bench-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { ensureSeedAgents, listAgents, createAgent, deleteAgent } = await import('./registry.js');
const { requirementForTask, selectForRequirement, selectReplacement, previewTeam, recordAgentPerformance } = await import('./selection.js');
const { createMission } = await import('./orchestrator.js');
const { getOsDb } = await import('./db.js');

const WS = 'selection-benchmark';

test('dynamic selection outperforms the static first-agent baseline on verified evidence and workload', () => {
  ensureSeedAgents(WS);
  for (const agent of listAgents(WS, { specialization: 'data_analyst' })) deleteAgent(WS, agent.id, 'benchmark');
  const baselineAgent = createAgent({ workspaceId: WS, name: 'Static First Analyst', role: 'Analyst', specialization: 'data_analyst', actor: 'benchmark' });
  const evidenceAgent = createAgent({ workspaceId: WS, name: 'Evidence Analyst', role: 'Analyst', specialization: 'data_analyst', actor: 'benchmark' });
  for (let index = 0; index < 5; index += 1) recordAgentPerformance({ workspaceId: WS, agentId: evidenceAgent.id, taskCategory: 'data_analyst', result: 'passed', durationMs: 80 });
  for (let index = 0; index < 3; index += 1) recordAgentPerformance({ workspaceId: WS, agentId: baselineAgent.id, taskCategory: 'data_analyst', result: 'failed', durationMs: 120 });

  const missionId = createMission({ workspaceId: WS, objective: 'inspect my computer', actor: 'benchmark', track: 'generic' });
  const task = getOsDb().prepare('SELECT id FROM os_tasks WHERE mission_id = ? LIMIT 1').get(missionId) as { id: string };
  getOsDb().prepare("UPDATE os_tasks SET agent_id = ?, status = 'running' WHERE id = ?").run(baselineAgent.id, task.id);

  const requirement = requirementForTask({ title: 'Analyze the dataset', objective: 'Analyze', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['Statistics returned'], dependsOn: [] }, 0, WS);
  const baseline = listAgents(WS, { specialization: 'data_analyst' })[0]!;
  const started = performance.now();
  let dynamicCorrect = 0;
  let baselineCorrect = 0;
  let dynamicExpectedSuccess = 0;
  let baselineExpectedSuccess = 0;
  for (let index = 0; index < 25; index += 1) {
    const decision = selectForRequirement(WS, requirement);
    const selected = decision.candidates.find((candidate) => candidate.agentId === decision.selectedAgentId);
    if (decision.selectedAgentId === evidenceAgent.id) dynamicCorrect += 1;
    dynamicExpectedSuccess += selected?.metrics.successRate ?? 0;
    const staticCandidate = decision.candidates.find((candidate) => candidate.agentId === baseline.id);
    if (baseline.id === evidenceAgent.id) baselineCorrect += 1;
    baselineExpectedSuccess += staticCandidate?.metrics.successRate ?? 0;
  }
  const elapsed = performance.now() - started;
  const replacement = selectReplacement(WS, { title: 'Analyze', objective: 'Analyze', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['Statistics returned'], dependsOn: [], agentId: baseline.id }, missionId, baseline.id);
  const twoTasks = [
    { title: 'Analyze A', objective: 'A', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['Statistics returned'], dependsOn: [] },
    { title: 'Analyze B', objective: 'B', specialization: 'data_analyst', tool: 'stats.describe', acceptance: ['Statistics returned'], dependsOn: [] },
  ];
  const dynamicTeam = previewTeam(WS, twoTasks);
  const baselineTeam = { team: [baseline.id] };
  const result = {
    runs: 25,
    selectionLatencyMs: Math.round(elapsed * 100) / 100,
    baseline: {
      accuracy: baselineCorrect / 25,
      expectedVerifiedSuccessRate: baselineExpectedSuccess / 25,
      teamSize: baselineTeam.team.length,
      reassignmentAvailable: false,
    },
    dynamic: {
      accuracy: dynamicCorrect / 25,
      expectedVerifiedSuccessRate: dynamicExpectedSuccess / 25,
      teamSize: dynamicTeam.team.length,
      reassignmentAvailable: Boolean(replacement.agent),
      selectedAgent: dynamicTeam.team[0]?.name ?? null,
      explanation: dynamicTeam.explanation,
    },
    unnecessaryAgents: dynamicTeam.team.length - 1,
  };
  console.log('[selection-benchmark]', JSON.stringify(result));
  assert.equal(result.dynamic.accuracy, 1);
  assert.equal(result.baseline.accuracy, 0);
  assert.ok(result.dynamic.expectedVerifiedSuccessRate > result.baseline.expectedVerifiedSuccessRate);
  assert.equal(result.dynamic.teamSize, 1, 'two similar tasks use one capable specialist');
  assert.equal(result.dynamic.reassignmentAvailable, true);
  assert.ok(result.unnecessaryAgents === 0);
});
