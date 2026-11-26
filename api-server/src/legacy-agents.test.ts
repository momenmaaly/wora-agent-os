import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { issueSessionToken } from './lib/session.js';
import { createLegacyAgentsHandler, type LegacyAgentView } from './legacy-agents.js';

const SECRET = 'legacy-agents-test-secret-0123456789abcdef';
let server: Server;
let base = '';

const agents: LegacyAgentView[] = [
  { agentId: 'private-agent', displayName: 'Private Agent', locale: 'en', zoneId: null, modelId: 'm', brainConfig: {}, profile: { customRole: 'private' }, status: 'active', assignedRoomIds: ['wora-memberuser'] },
  { agentId: 'other-agent', displayName: 'Other Agent', locale: 'ar', zoneId: null, modelId: 'm', brainConfig: {}, profile: { customRole: 'other' }, status: 'active', assignedRoomIds: ['wora-otheruser'] },
];

before(async () => {
  const app = express();
  app.get('/api/agents', createLegacyAgentsHandler({
    authSecret: SECRET,
    isProduction: true,
    adminApiKey: 'admin-key',
    loadActiveAgents: async () => agents,
    isSessionActive: () => true,
    getWorkspaceRole: (_workspaceId, userId) => userId === 'adminuser' ? 'admin' : userId === 'memberuser' ? 'member' : 'viewer',
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}/api/agents`;
});

after(() => server?.close());

async function call(headers: Record<string, string> = {}) {
  const response = await fetch(base, { headers });
  return { status: response.status, body: await response.json() as { agents?: LegacyAgentView[]; code?: string } };
}

test('legacy agent roster rejects anonymous and invalid sessions', async () => {
  const anonymous = await call();
  assert.equal(anonymous.status, 401);
  const invalid = await call({ authorization: 'Bearer invalid' });
  assert.equal(invalid.status, 401);
});

test('a member only sees agents assigned to their own room', async () => {
  const token = issueSessionToken('memberuser', SECRET, 10);
  const response = await call({ authorization: `Bearer ${token}` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.agents?.map((agent) => agent.agentId), ['private-agent']);
});

test('an admin and the explicit admin key can read the full roster', async () => {
  const token = issueSessionToken('adminuser', SECRET, 10);
  const admin = await call({ authorization: `Bearer ${token}` });
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.agents?.map((agent) => agent.agentId), ['private-agent', 'other-agent']);
  const key = await call({ 'x-api-key': 'admin-key' });
  assert.equal(key.status, 200);
  assert.deepEqual(key.body.agents?.map((agent) => agent.agentId), ['private-agent', 'other-agent']);
});
