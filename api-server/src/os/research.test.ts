import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-research-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
process.env['WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS'] = '1';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { planResearch, synthesizeResearch, findingFromToolOutput } = await import('./research.js');
const { understandProblem } = await import('./problem.js');
const { buildClarificationPlan } = await import('./clarification.js');
const { buildDeterministicReasoning } = await import('./reasoning-engine.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');

const WS = 'wora-research-test';
const server = createServer((req, res) => {
  if (req.url === '/report') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Market Report</title></head><body><p>The current market rate is 12 percent for 2026. This report was published in 2026 and covers the current period.</p></body></html>');
    return;
  }
  if (req.url === '/failed') {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('upstream unavailable');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

after(() => server.close());

test('research planning: explicit sources become a real plan with questions and provenance', () => {
  const plan = planResearch({
    objective: 'Research the latest EU AI regulation from https://example.com/ai-act and cite sources',
    urls: ['https://example.com/ai-act'],
  });
  assert.equal(plan.needed, true);
  assert.equal(plan.status, 'planned');
  assert.ok(plan.questions.length >= 1);
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0]!.kind, 'web');
  assert.equal(plan.sources[0]!.tool, 'web.fetch_read');
  assert.equal(plan.sources[0]!.locator, 'https://example.com/ai-act');
});

test('research planning: URL credentials and token-like query values are not copied into a plan', () => {
  const plan = planResearch({ objective: 'Research https://user:pass@example.com/report?token=super-secret and summarize it' });
  assert.equal(plan.sources.length, 0);
  assert.ok(!JSON.stringify(plan).includes('super-secret'));
  assert.ok(!JSON.stringify(plan).includes('user:pass'));
});

test('research planning: no source is invented and the gap becomes a clarification question', () => {
  const objective = 'Research the latest EU AI regulation requirements';
  const plan = planResearch({ objective });
  assert.equal(plan.needed, true);
  assert.equal(plan.status, 'unanswered');
  assert.equal(plan.sources.length, 0);
  assert.ok(plan.limitations.some((item) => /did not search|fabricate|source/i.test(item)));
  const clarification = buildClarificationPlan({ problem: understandProblem({ objective }), research: plan });
  assert.ok(clarification.questions.some((question) => question.code === 'research_sources'));
});

test('research synthesis: conflicting sources are surfaced, not averaged away', () => {
  const plan = planResearch({ objective: 'Research the current market rate', urls: ['https://a.example/report'] });
  const questionId = plan.questions[0]!.id;
  const base = {
    questionIds: [questionId], sourceId: null, tool: 'web.fetch_read', title: 'A', retrievedAt: new Date().toISOString(),
    digest: 'a', truncated: false, note: '',
  };
  const synthesis = synthesizeResearch({
    plan,
    findings: [
      { ...base, id: 'f-support', url: 'https://a.example/report', status: 200, stance: 'supports', strength: 'moderate', excerpt: 'The current market rate is 12 percent for 2026 and this report confirms the current value.' },
      { ...base, id: 'f-contradict', url: 'https://b.example/report', status: 200, stance: 'contradicts', strength: 'moderate', excerpt: 'The current market rate is not 12 percent; this report says 7 percent for 2026.' },
    ],
  });
  assert.equal(synthesis.conflicts.length, 1);
  assert.equal(synthesis.status, 'partial');
  assert.equal(synthesis.evidence.length, 2);
  assert.deepEqual(synthesis.sourcesUsed.sort(), ['https://a.example/report', 'https://b.example/report']);
});

test('research synthesis: a failed retrieval is weak evidence and never a finding claim', () => {
  const plan = planResearch({ objective: 'Research the current market rate', urls: ['https://failed.example/report'] });
  const synthesis = synthesizeResearch({
    plan,
    findings: [{
      id: 'f-failed', questionIds: [plan.questions[0]!.id], sourceId: null, tool: 'web.fetch_read',
      url: 'https://failed.example/report', title: null, retrievedAt: new Date().toISOString(), status: 503,
      excerpt: 'upstream unavailable', digest: 'f', truncated: false, stance: 'unclear', strength: 'none', note: '',
    }],
  });
  assert.equal(synthesis.status, 'unanswered');
  assert.ok(synthesis.weakEvidence.includes('f-failed'));
  assert.equal(synthesis.evidence.length, 0);
  assert.ok(synthesis.unansweredQuestionIds.length > 0);
});

test('research tool output keeps URL, status, digest and a heuristic stance', () => {
  const plan = planResearch({ objective: 'Research the current market rate', urls: ['https://a.example/report'] });
  const finding = findingFromToolOutput({
    taskId: 'task-1', runId: 'run-1', tool: 'web.fetch_read', plan,
    output: { url: 'https://a.example/report', status: 200, title: 'Market', text: 'The current market rate is 12 percent for 2026. The report confirms the current market rate.' },
  });
  assert.ok(finding);
  assert.equal(finding!.url, 'https://a.example/report');
  assert.equal(finding!.status, 200);
  assert.match(finding!.digest, /^[a-f0-9]{64}$/);
  assert.ok(['supports', 'neutral', 'unclear'].includes(finding!.stance));
});

test('advanced reasoning: observational causal language is not claimed as identified causation', () => {
  const model = buildDeterministicReasoning({
    workspaceId: WS, objective: 'Explain why churn is associated with price. The data is observational.', includeMemory: false, actor: 'test',
  });
  assert.ok(model.causalGraph.length >= 1);
  assert.ok(model.causalGraph.every((edge) => edge.evidenceKind !== 'experimental' ? edge.identified === false : true));
  assert.ok(model.limitations.some((item) => /correlation is not causation|identification is not claimed/i.test(item)));
  assert.notEqual(model.confidence.kind, 'calibrated');
});

test('research planning: an optimization mission does not trigger external research', () => {
  const plan = planResearch({ objective: 'Optimize employee shift schedule under cost constraints' });
  assert.equal(plan.needed, false);
  assert.equal(plan.status, 'not-needed');
});

test('mission integration: a real fetch becomes reasoning evidence and a research synthesis', async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env['WORA_TEST_ALLOWED_PORTS'] = String(address.port);
  const objective = `Research http://127.0.0.1:${address.port}/report and summarize the current market rate`;
  const missionId = createMission({ workspaceId: WS, objective, actor: 'test' });
  await executeMission(missionId, 'test');
  const detail = getMissionDetail(WS, missionId)!;
  assert.equal(detail.status, 'completed');
  assert.equal(detail.tasks[0]!.tool, 'web.fetch_read');
  assert.ok(detail.verifications.some((record) => record.result === 'passed'));
  const research = detail.reasoning?.research;
  assert.ok(research, 'research state must be persisted');
  assert.equal(research!.plan.sources[0]!.locator, `http://127.0.0.1:${address.port}/report`);
  assert.equal(research!.findings.length, 1);
  assert.equal(research!.findings[0]!.url, `http://127.0.0.1:${address.port}/report`);
  assert.match(research!.findings[0]!.digest, /^[a-f0-9]{64}$/);
  assert.ok(research!.synthesis.sourcesUsed.includes(`http://127.0.0.1:${address.port}/report`));
  assert.ok(detail.reasoning!.claims.some((claim) => /Market Report|12 percent/i.test(claim.statement)));
  assert.ok(research!.synthesis.limitations.some((item) => /Research synthesis is extractive/i.test(item)));
});
