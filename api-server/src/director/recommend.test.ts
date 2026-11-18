import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceSignalSchema } from '../core/taskSignal.js';
import { createDirectorRecommender } from './recommend.js';

const atlas = { agentId: 'atlas', activeTasks: 4, profile: { customRole: 'Engineer', skills: ['React', 'TypeScript'] } };
const aria = { agentId: 'aria', activeTasks: 1, profile: { customRole: 'Planner', specialty: 'Sprint planning', skills: ['Roadmap'] } };
const declined = { agentId: 'nova', profile: { skills: ['Analytics'] } };
const brief = 'Draft a React function';
const request = { brief: ` ${brief} `, candidates: [{ agentId: 'atlas', workload: 2 }, { agentId: 'aria', workload: 2 }, { agentId: 'unknown', workload: 0 }] };

const setup = (answer: string) => createDirectorRecommender({ getAgents: async () => [atlas, aria, declined], consumeQuota: async () => true, choose: async () => answer });

test('only team members from the caller shortlist are sent to the provider, with grounded workload and evidence', async () => {
  const recommend = createDirectorRecommender({
    getAgents: async () => [atlas, aria, declined],
    consumeQuota: async (userId, signal) => userId === 'user-1' && !signal.aborted,
    choose: async (input, candidates) => {
      equal(input, brief);
      deepEqual(candidates.map(({ agentId, workload }) => ({ agentId, workload })), [{ agentId: 'atlas', workload: 4 }, { agentId: 'aria', workload: 2 }]);
      return '```json\n{"agentId":"atlas","skill":"React"}\n```';
    },
  });
  deepEqual(await recommend('user-1', request), { ok: true, agentId: 'atlas', skill: 'React' });
});

test('invalid JSON, an unlisted candidate or invented skills never become a recommendation', async () => {
  for (const raw of ['no json', '{"agentId":"nova","skill":"Analytics"}', '{"agentId":"atlas","skill":"TypeScript systems"}', '{"agentId":"atlas","skill":"React","execute":true}']) {
    deepEqual(await setup(raw)('user-1', request), { ok: false });
  }
  deepEqual(await setup('{"agentId":"atlas","skill":"React"}')('user-1', { brief, candidates: [{ agentId: 'atlas', workload: 1 }] }), { ok: false });
});

test('provider stays untouched after refusal, missing quota storage or a disconnected session', async () => {
  let calls = 0;
  const make = (quota: () => Promise<boolean>) => createDirectorRecommender({ getAgents: async () => [atlas, aria], consumeQuota: quota, choose: async () => { calls++; return '{}'; } });
  const aborted = new AbortController();
  aborted.abort();
  for (const result of [await make(async () => false)('user-1', request), await make(async () => { throw new Error('redis offline'); })('user-1', request), await make(async () => true)('user-1', request, aborted.signal)]) deepEqual(result, { ok: false });
  equal(calls, 0);
});

test('an in-flight recommendation observes disconnect and discards any later provider response', async () => {
  const disconnected = new AbortController();
  const recommend = createDirectorRecommender({
    getAgents: async () => [atlas, aria], consumeQuota: async () => true,
    choose: async (_brief, _candidates, signal) => {
      disconnected.abort();
      ok(signal.aborted);
      return '{"agentId":"atlas","skill":"React"}';
    },
  });
  deepEqual(await recommend('user-1', request, disconnected.signal), { ok: false });
});

test('directed assignments require a brief, validate the zone, and strip client-provided execution state', () => {
  const raw = { zoneId: 'zone-engineering', agentId: 'atlas', title: ' Draft function ' };
  equal(workspaceSignalSchema.safeParse({ ...raw, data: { source: 'director' } }).success, false);
  equal(workspaceSignalSchema.safeParse({ ...raw, zoneId: 'invalid' }).success, false);
  equal(workspaceSignalSchema.safeParse({ ...raw, data: { source: 'director', brief: 'x'.repeat(1201) } }).success, false);
  deepEqual(workspaceSignalSchema.parse({ ...raw, data: { source: 'director', brief: ` ${brief} `, directorExecution: 'done', directorResponse: 'fake' } }),
    { ...raw, title: 'Draft function', data: { source: 'director', brief } });
});
