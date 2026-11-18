import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import type { AgentSkillUpdate } from '../../../shared/types/index.js';
import { verifySessionToken } from '../lib/session.js';
import { createSkillsRouter } from './router.js';
import { createMemorySkillStore } from './store.js';

const secret = 'fixture local secret';
function token(sub: string, exp: number | undefined = Math.floor(Date.now() / 1_000) + 60) {
  const encoded = Buffer.from(JSON.stringify({ sub, exp })).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

test('HTTP lifecycle persists an inactive draft, activates explicitly, and scopes catalog and events to the signed user', async (t) => {
  const events: AgentSkillUpdate[] = [];
  let pulls = 0;
  const store = createMemorySkillStore();
  const app = express();
  app.use('/api/agents/:agentId/skills', createSkillsRouter({
    available: () => true,
    authenticate(input) {
      const session = verifySessionToken(input, secret, true);
      return session ? { userId: session.userId, roomId: `wora-${session.userId}` } : null;
    },
    hasAgent: (_roomId, id) => id === 'agent-planner-01',
    consumeQuota: async (_kind, id) => id === 'limited-user' ? 60 : null,
    async importGitHub(repo) {
      pulls++;
      return { name: 'Notes', description: 'Summarize plain notes.', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
        source: { repository: repo.fullName, url: repo.url, kind: 'skill.json', path: 'skill.json', sha: 'b'.repeat(40) } };
    },
    store,
    publish: (event) => { events.push(event); },
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents/agent-planner-01/skills`;
  const owner = token('fixture-owner'); const other = token('fixture-other');
  function call(bearer?: string, method = 'GET', path = '', data?: unknown) {
    return fetch(base + path, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(4_000) });
  }
  assert.equal((await call()).status, 401);
  assert.equal((await call(token('fixture-owner', 1))).status, 401);
  assert.equal((await fetch(base.replace('agent-planner-01', 'unknown-agent'), { headers: { Authorization: `Bearer ${owner}` } })).status, 404);
  assert.deepEqual(await (await call(owner)).json(), { revision: 0, skills: [] });
  const url = 'https://github.com/workshop/notes';
  assert.equal((await call(owner, 'POST', '/import-github', { url, active: true })).status, 400);
  const limited = await call(token('limited-user'), 'POST', '/import-github', { url });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(pulls, 0);
  const firstResponse = await call(owner, 'POST', '/import-github', { url });
  assert.equal(firstResponse.status, 201); assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
  const first = await firstResponse.json();
  const id = first.skillId;
  assert.deepEqual(first.skills[0].inputSchema.required, ['note']); assert.equal(first.skills[0].active, false);
  assert.deepEqual(events, [{ roomId: 'wora-fixture-owner', agentId: 'agent-planner-01', revision: 1, activeNames: [] }]);
  assert.deepEqual(await (await call(other)).json(), { revision: 0, skills: [] });
  assert.equal((await call(other, 'PATCH', `/${id}`, { active: true })).status, 404);
  const duplicate = await (await call(owner, 'POST', '/import-github', { url: 'https://github.com/Workshop/NOTES.git/' })).json();
  assert.equal(duplicate.skillId, id); assert.equal(duplicate.reused, true); assert.equal(pulls, 1);
  assert.equal((await call(owner, 'PATCH', `/${id}`, { active: 'true' })).status, 400);
  const active = await (await call(owner, 'PATCH', `/${id}`, { active: true })).json();
  assert.equal(active.skills[0].active, true); assert.equal(active.revision, 2);
  assert.deepEqual(await (await call(owner)).json(), active);
  assert.deepEqual(await store.getIndex('wora-fixture-owner'), { 'agent-planner-01': { revision: 2, activeNames: ['Notes'] } });
  assert.deepEqual(await store.getIndex('wora-fixture-other'), {});
  const inactive = await (await call(owner, 'PATCH', `/${id}`, { active: false })).json();
  assert.equal(inactive.skills[0].active, false); assert.equal(inactive.revision, 3);
  assert.deepEqual(events.map(({ roomId, revision, activeNames }) => [roomId, revision, activeNames]), [
    ['wora-fixture-owner', 1, []], ['wora-fixture-owner', 2, ['Notes']], ['wora-fixture-owner', 3, []],
  ]);
});
