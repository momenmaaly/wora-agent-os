import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

test('execution UI controls are wired to real mission, lease and verification endpoints', () => {
  const ui = read('components/ExecutionCenter.tsx');
  for (const call of ['osApi.pauseMission', 'osApi.cancelMission', 'osApi.executeMission', 'osApi.replanMission', 'osApi.missionLeases', 'osApi.missionVerifications']) {
    assert.ok(ui.includes(call), `${call} is wired`);
  }
  assert.match(ui, /problemProfile/);
  assert.match(ui, /planVersions/);
  assert.match(ui, /planVerification/);
  assert.match(ui, /payloadDigest/);
  assert.match(ui, /expiresAt/);
  assert.match(ui, /problemModel/);
  assert.match(ui, /composition/);
  assert.match(ui, /execution\.composite/);
  assert.match(ui, /'composite'/);
  assert.match(ui, /outcomeVerification/);
  assert.match(ui, /execution\.outcomeVerificationTitle/);
  assert.match(ui, /capability-gap|outcomeStatus/);
  assert.match(ui, /detail\.reasoning/);
  assert.match(ui, /execution\.reasoningTitle/);
  assert.match(ui, /hypotheses/);
  assert.match(ui, /causalGraph/);
  assert.match(ui, /informationNeeds/);
  assert.match(ui, /sufficientToProceed/);
  assert.match(ui, /provider\.notice/);
  assert.match(ui, /problemStructure/);
  assert.match(ui, /missingInputs/);
});

test('lesson lifecycle and benchmark UI call the real APIs', () => {
  const ui = read('components/IntelligenceHub.tsx');
  for (const call of ['osApi.lessons', 'osApi.evaluateLesson', 'osApi.promoteLesson', 'osApi.rejectLesson', 'osApi.revokeLesson', 'osApi.recordLessonOutcome', 'osApi.lessonHistory', 'osApi.runBenchmarks', 'osApi.benchmarkDomains']) {
    assert.ok(ui.includes(call), `${call} is wired`);
  }
  assert.match(ui, /لا ترقية تلقائية|بلا ترقية تلقائية/);
});

test('execution limits UI persists through the admin API', () => {
  const ui = read('components/SystemConsole.tsx');
  assert.match(ui, /osApi\.executionLimits/);
  assert.match(ui, /osApi\.setExecutionLimits/);
  assert.match(ui, /maxConcurrentTasks/);
  assert.match(ui, /leaseTtlMs/);
});

test('typed client exposes plan, lease, lesson and benchmark contracts', () => {
  const api = read('os/api.ts');
  for (const token of ['interface PlanVersion', 'interface TaskLease', 'interface VerificationRecord', 'interface Lesson', 'interface BenchmarkRun', 'interface UnifiedProblem', 'interface CompositionRecord', 'missionPlans', 'replanMission', 'executionLimits', 'runBenchmarks', 'interface ReasoningModel', 'interface ProblemStructure', 'missionReasoning', 'addReasoningEvidence', 'reasonProblem']) {
    assert.ok(api.includes(token), `${token} is typed`);
  }
});
