import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-scope-auth-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';

const { getOsDb, nowIso } = await import('../os/db.js');
const { getWorkspaceRole, setWorkspaceRole } = await import('../os/roles.js');
const { createAgent } = await import('../os/registry.js');
const { seedBuiltinCatalog } = await import('./builtin.js');
const { findPackageByKey } = await import('./store.js');
const { createExtensionsRouter } = await import('./router.js');

const WS = 'wora-scope-auth';
let server: Server;
let base = '';
let agentId = '';

before(async () => {
  getWorkspaceRole(WS, 'owner');
  setWorkspaceRole(WS, 'member', 'member', 'owner');
  setWorkspaceRole(WS, 'admin', 'admin', 'owner');
  setWorkspaceRole(WS, 'other', 'member', 'owner');
  agentId = createAgent({ workspaceId: WS, name: 'Scope Agent', role: 'Generalist', specialization: 'generalist', actor: 'owner' }).id;
  const db = getOsDb();
  const ts = nowIso();
  db.prepare('INSERT INTO os_projects (id, workspace_id, org_id, name, objective, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('prj-scope', WS, null, 'Scope Project', 'Scope project objective', 'active', ts);
  db.prepare('INSERT INTO os_organizations (id, workspace_id, name, objective, structure, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('org-scope', WS, 'Scope Org', 'Scope org objective', '{}', ts);
  seedBuiltinCatalog(WS);

  const app = express();
  app.use((req, res, next) => {
    res.locals['workspaceId'] = WS;
    res.locals['actor'] = String(req.header('x-test-actor') ?? 'member');
    res.locals['role'] = String(req.header('x-test-role') ?? 'member');
    next();
  });
  app.use(express.json());
  app.use('/extensions', createExtensionsRouter());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}/extensions`;
});

after(() => {
  server?.close();
  rmSync(TMP, { recursive: true, force: true });
});

async function call(role: string, actor: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-test-role': role, 'x-test-actor': actor, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text) as unknown; } catch { /* keep text */ }
  return { status: response.status, body: body as Record<string, unknown> };
}

function install(role: string, actor: string, scope: string, scopeId?: string) {
  const pkg = findPackageByKey(WS, 'skill', 'wora.software-architecture');
  assert.ok(pkg, 'builtin skill must exist');
  return call(role, actor, `/packages/${pkg.id}/install`, {
    method: 'POST', body: JSON.stringify({ scope, ...(scopeId ? { scopeId } : {}) }),
  });
}

test('installation scopes require the correct role and an existing workspace target', async () => {
  const instance = await install('member', 'member', 'instance');
  assert.equal(instance.status, 403, JSON.stringify(instance.body));
  assert.equal(instance.body['code'], 'INSTANCE_SCOPE_REQUIRES_ADMIN');

  const agent = await install('member', 'member', 'agent', agentId);
  assert.equal(agent.status, 201, JSON.stringify(agent.body));

  const missingAgent = await install('member', 'member', 'agent', 'agent-does-not-exist');
  assert.equal(missingAgent.status, 403, JSON.stringify(missingAgent.body));
  assert.equal(missingAgent.body['code'], 'AGENT_SCOPE_TARGET_FORBIDDEN');

  const project = await install('member', 'member', 'project', 'prj-scope');
  assert.equal(project.status, 201, JSON.stringify(project.body));

  const missingProject = await install('member', 'member', 'project', 'prj-does-not-exist');
  assert.equal(missingProject.status, 403, JSON.stringify(missingProject.body));
  assert.equal(missingProject.body['code'], 'PROJECT_SCOPE_TARGET_FORBIDDEN');

  const otherUser = await install('member', 'member', 'user', 'other');
  assert.equal(otherUser.status, 403, JSON.stringify(otherUser.body));
  assert.equal(otherUser.body['code'], 'USER_SCOPE_FORBIDDEN');

  const self = await install('member', 'member', 'user', 'member');
  assert.equal(self.status, 201, JSON.stringify(self.body));

  const organization = await install('member', 'member', 'organization', 'org-scope');
  assert.equal(organization.status, 403, JSON.stringify(organization.body));

  const adminInstance = await install('admin', 'admin', 'instance');
  assert.equal(adminInstance.status, 201, JSON.stringify(adminInstance.body));

  const adminOrganization = await install('admin', 'admin', 'organization', 'org-scope');
  assert.equal(adminOrganization.status, 201, JSON.stringify(adminOrganization.body));

  const adminOtherUser = await install('admin', 'admin', 'user', 'other');
  assert.equal(adminOtherUser.status, 201, JSON.stringify(adminOtherUser.body));

  const viewer = await install('viewer', 'member', 'agent', agentId);
  assert.equal(viewer.status, 403, JSON.stringify(viewer.body));
});

test('agent policy targets must exist and organization binding requires admin', async () => {
  const project = await call('member', 'member', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ projectIds: ['prj-scope'] }),
  });
  assert.equal(project.status, 200, JSON.stringify(project.body));

  const missingProject = await call('member', 'member', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ projectIds: ['prj-does-not-exist'] }),
  });
  assert.equal(missingProject.status, 403, JSON.stringify(missingProject.body));
  assert.equal(missingProject.body['code'], 'PROJECT_SCOPE_TARGET_FORBIDDEN');

  const memberOrg = await call('member', 'member', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ organizationId: 'org-scope' }),
  });
  assert.equal(memberOrg.status, 403, JSON.stringify(memberOrg.body));
  assert.equal(memberOrg.body['code'], 'ORGANIZATION_SCOPE_REQUIRES_ADMIN');

  const adminMissingOrg = await call('admin', 'admin', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ organizationId: 'org-does-not-exist' }),
  });
  assert.equal(adminMissingOrg.status, 403, JSON.stringify(adminMissingOrg.body));
  assert.equal(adminMissingOrg.body['code'], 'ORGANIZATION_SCOPE_TARGET_FORBIDDEN');

  const adminOrg = await call('admin', 'admin', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ organizationId: 'org-scope' }),
  });
  assert.equal(adminOrg.status, 200, JSON.stringify(adminOrg.body));

  const viewer = await call('viewer', 'member', `/agents/${agentId}/policy`, {
    method: 'PUT', body: JSON.stringify({ projectIds: ['prj-scope'] }),
  });
  assert.equal(viewer.status, 403, JSON.stringify(viewer.body));
});
