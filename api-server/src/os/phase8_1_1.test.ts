/**
 * Phase 8.1.1 — independent adversarial verification.
 *
 * These tests attempt the bypasses described in the Phase 8 audit against the
 * real SQLite services. They are intentionally separate from the Phase 8.1
 * acceptance tests so a regression cannot be hidden behind a broad suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-phase8-1-1-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
process.env['AUTH_SECRET'] = 'phase8-1-1-auth-secret-0123456789abcdef';
mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true });

const { getOsDb, nowIso } = await import('./db.js');
const { addMemory, getMemory, deleteMemory, listMemoryVersions, listMemories, listMemoryRetrievals } = await import('./memory.js');
const { modelProblem, filterProblemForActor } = await import('./problem-model.js');
const { createMission, executeMission, getMissionDetail } = await import('./orchestrator.js');
const { collectCandidateLessons, evaluateLesson, promoteLesson, revokeLesson, getLesson, recordLessonOutcome } = await import('./lessons.js');
const { redactSecrets } = await import('./secrets.js');
const { setWorkspaceRole, removeWorkspaceRole } = await import('./roles.js');

const WS = 'phase8-1-1';

async function promotedLesson(ws: string, actor = 'alice') {
  const missionId = createMission({ workspaceId: ws, objective: 'Inspect my computer and identify potential problems', actor });
  await executeMission(missionId, actor);
  const lesson = collectCandidateLessons(ws, missionId, actor)[0];
  assert.ok(lesson);
  const tested = evaluateLesson(ws, lesson.id, 'admin');
  return promoteLesson(ws, tested.id, 'admin');
}

test('forged verified semantic memory cannot be created through the service boundary', () => {
  assert.throws(() => addMemory({
    workspaceId: WS, scope: 'semantic', content: 'forged verified knowledge', actor: 'alice',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'alice', reviewedAt: nowIso(), evidenceDigest: 'f'.repeat(64),
  }), /evidence|lesson|review/i);
});

test('a real lesson digest without the lesson record cannot be replayed as verified memory', () => {
  assert.throws(() => addMemory({
    workspaceId: WS, scope: 'semantic', content: 'fabricated memory content', actor: 'admin',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'admin', reviewedAt: nowIso(), evidenceDigest: 'e'.repeat(64),
    evidenceRef: 'lesson:lsn_does_not_exist',
  } as Parameters<typeof addMemory>[0]), /evidence|lesson|not found/i);
});

test('a lesson outcome cannot be replayed to inflate effectiveness', async () => {
  const ws = 'phase8-1-1-replay';
  const lesson = await promotedLesson(ws);
  const missionId = createMission({ workspaceId: ws, objective: 'Inspect my computer again', actor: 'alice' });
  getOsDb().prepare("UPDATE os_missions SET status = 'completed', outcome_status = 'verified' WHERE workspace_id = ? AND id = ?").run(ws, missionId);
  const { recordLessonApplication } = await import('./lessons.js');
  const application = recordLessonApplication(ws, lesson.id, { missionId }, 'alice');
  const first = recordLessonOutcome(ws, lesson.id, { applicationId: application.id }, 'alice');
  assert.equal(first.outcomeCount, 1);
  assert.throws(() => recordLessonOutcome(ws, lesson.id, { applicationId: application.id }, 'alice'), /already|replay|recorded/i);
  assert.equal(getLesson(ws, lesson.id)!.outcomeCount, 1);
});

test('deleting a promoted memory erases the linked lesson content from every API view', async () => {
  const ws = 'phase8-1-1-delete';
  const lesson = await promotedLesson(ws);
  assert.match(lesson.content, /A verified approach/u);
  assert.equal(deleteMemory(ws, lesson.memoryId!, 'admin'), true);
  const tombstone = getLesson(ws, lesson.id)!;
  assert.equal(tombstone.status, 'revoked');
  assert.ok(!tombstone.content.includes('A verified approach'), 'lesson content survived memory deletion');
  assert.ok(!tombstone.title.includes('Inspect my computer'), 'lesson title survived memory deletion');
  assert.deepEqual(tombstone.evidence, []);
  const auditRow = getOsDb().prepare("SELECT detail FROM os_audit WHERE workspace_id = ? AND subject = ? AND action = 'memory.delete' ORDER BY created_at DESC LIMIT 1").get(ws, lesson.memoryId) as { detail: string };
  assert.ok(!auditRow.detail.includes('A verified approach'), 'audit detail retained deleted content');
  assert.match(auditRow.detail, /[a-f0-9]{16,}/u, 'audit detail lost the content digest');
});

test('revoking a lesson removes its content from the live lesson decision surface', async () => {
  const ws = 'phase8-1-1-revoke';
  const lesson = await promotedLesson(ws);
  const revoked = revokeLesson(ws, lesson.id, 'admin', 'independent revocation check');
  assert.equal(revoked.status, 'revoked');
  assert.ok(!revoked.content.includes('A verified approach'));
  assert.deepEqual(revoked.evidence, []);
});

test('multiline private keys are redacted as a complete block', () => {
  const body = 'MIIEowIBAAKCAQEA' + 'A'.repeat(64);
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
  const redacted = redactSecrets(`credential:\n${pem}`).value;
  assert.ok(!redacted.includes(body), 'private key body survived redaction');
  assert.ok(!redacted.includes('BEGIN RSA PRIVATE KEY'), 'private key header survived redaction');
});

test('owner and version ACLs hold for roles and after deletion', () => {
  const ws = 'phase8-1-1-acl';
  setWorkspaceRole(ws, 'owner', 'owner', 'bootstrap');
  setWorkspaceRole(ws, 'admin', 'admin', 'owner');
  setWorkspaceRole(ws, 'member', 'member', 'owner');
  const record = addMemory({ workspaceId: ws, scope: 'workspace', visibility: 'owner', content: 'owner-only payroll record', actor: 'owner' });
  for (const actor of ['admin', 'member']) {
    assert.equal(getMemory(ws, record.id, actor), null);
    assert.equal(listMemoryVersions(ws, record.id, actor), null);
    assert.ok(!listMemories(ws, { actor }).some((entry) => entry.id === record.id));
  }
  assert.equal(getMemory(ws, record.id, 'owner')?.id, record.id);
  assert.equal(deleteMemory(ws, record.id, 'owner'), true);
  assert.equal(getMemory(ws, record.id, 'owner'), null);
  assert.equal(listMemoryVersions(ws, record.id, 'owner'), null);
});

test('deleted memory cannot re-enter mission retrieval or detail through persisted models', () => {
  const ws = 'phase8-1-1-retrieval-delete';
  const record = addMemory({ workspaceId: ws, scope: 'workspace', content: 'zebra payroll evidence for deletion', actor: 'alice' });
  const missionId = createMission({ workspaceId: ws, objective: 'Explain zebra payroll evidence and its implications', actor: 'alice' });
  const before = getMissionDetail(ws, missionId, 'alice')!;
  assert.ok(before.problemModel!.evidence.some((entry) => entry.memoryId === record.id));
  deleteMemory(ws, record.id, 'alice');
  const after = getMissionDetail(ws, missionId, 'alice')!;
  assert.ok(!JSON.stringify(after).includes('zebra payroll evidence for deletion'));
  assert.ok(!filterProblemForActor(before.problemModel!, ws, 'alice').evidence.some((entry) => entry.memoryId === record.id));
  const snapshots = listMemoryRetrievals(ws, { actor: 'alice' });
  assert.ok(snapshots.every((snapshot) => !Object.prototype.hasOwnProperty.call(snapshot, 'content')));
});

test('historical rows can be scrubbed without deleting the record', async () => {
  const { scrubLegacySecrets } = await import('./migrations.js') as unknown as { scrubLegacySecrets: (db: ReturnType<typeof getOsDb>) => { updated: number } };
  assert.equal(typeof scrubLegacySecrets, 'function', 'legacy scrub migration helper is missing');
  const db = getOsDb();
  const ws = 'phase8-1-1-legacy';
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  db.prepare('INSERT INTO os_memory (id, workspace_id, scope, scope_id, content, tags, provenance, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('mem_legacy_secret', ws, 'workspace', '', `legacy ${token}`, '[]', 'user', 'alice', nowIso(), nowIso());
  db.prepare('INSERT INTO os_memory_versions (id, memory_id, workspace_id, scope, content, tags, action, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('memv_legacy_secret', 'mem_legacy_secret', ws, 'workspace', `old ${token}`, '[]', 'create', 'alice', nowIso());
  const result = scrubLegacySecrets(db);
  assert.ok(result.updated >= 2);
  const memory = db.prepare('SELECT content FROM os_memory WHERE id = ?').get('mem_legacy_secret') as { content: string };
  const version = db.prepare('SELECT content FROM os_memory_versions WHERE id = ?').get('memv_legacy_secret') as { content: string };
  assert.ok(!memory.content.includes(token));
  assert.ok(!version.content.includes(token));
});

test('at-rest content is redacted but not encrypted, and the threat is bounded explicitly', () => {
  const ws = 'phase8-1-1-at-rest';
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const record = addMemory({ workspaceId: ws, scope: 'workspace', content: `credential ${token} visible knowledge`, actor: 'alice' });
  const raw = getOsDb().prepare('SELECT content FROM os_memory WHERE id = ?').get(record.id) as { content: string };
  assert.ok(!raw.content.includes(token), 'synthetic secret persisted in plaintext');
  assert.ok(raw.content.includes('visible knowledge'), 'non-secret knowledge was encrypted or lost; redaction is not encryption');
});

test('verified evidence must belong to the same workspace and be promoted by the acting admin', async () => {
  const { createHash } = await import('node:crypto');
  const { MIGRATIONS } = await import('./migrations.js');
  void MIGRATIONS;
  const db = getOsDb();
  const ws = 'phase8-1-1-evidence';
  setWorkspaceRole(ws, 'owner', 'owner', 'bootstrap');
  setWorkspaceRole(ws, 'member', 'member', 'owner');
  setWorkspaceRole(ws, 'admin', 'admin', 'owner');
  const evidence = [{ verificationId: 'ver_evidence_boundary', taskId: 'tsk_evidence_boundary', result: 'passed' }];
  const evidenceJson = JSON.stringify(evidence);
  const digest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 32);
  const insertLesson = (id: string, status: string, promotedBy: string | null, memoryId: string | null) => {
    db.prepare(`INSERT INTO os_lessons (id, workspace_id, mission_id, task_id, title, content, evidence, status, confidence, version, provenance, created_by, promoted_by, promoted_at, memory_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.7, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ws, null, null, 'Evidence lesson', 'evidence-boundary content', evidenceJson, status, 'test', 'admin', promotedBy, nowIso(), memoryId, nowIso(), nowIso());
  };
  insertLesson('lsn_evidence_member', 'promoted', 'member', null);
  assert.throws(() => addMemory({
    workspaceId: ws, scope: 'semantic', content: 'evidence-boundary content', actor: 'member',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'member', reviewedAt: nowIso(), evidenceDigest: digest, evidenceRef: 'lesson:lsn_evidence_member',
  }), /admin|owner|review/i);
  insertLesson('lsn_evidence_other_actor', 'promoted', 'someone-else', null);
  assert.throws(() => addMemory({
    workspaceId: ws, scope: 'semantic', content: 'evidence-boundary content', actor: 'admin',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'admin', reviewedAt: nowIso(), evidenceDigest: digest, evidenceRef: 'lesson:lsn_evidence_other_actor',
  }), /reviewer|promoted|match/i);
  insertLesson('lsn_evidence_revoked', 'revoked', 'admin', null);
  assert.throws(() => addMemory({
    workspaceId: ws, scope: 'semantic', content: 'evidence-boundary content', actor: 'admin',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'admin', reviewedAt: nowIso(), evidenceDigest: digest, evidenceRef: 'lesson:lsn_evidence_revoked',
  }), /promoted|evidence/i);
  insertLesson('lsn_evidence_promote_member', 'tested', 'member', null);
  assert.throws(() => promoteLesson(ws, 'lsn_evidence_promote_member', 'member'), /admin|owner|review/i);
  insertLesson('lsn_evidence_wrong_workspace', 'promoted', 'admin', null);
  assert.throws(() => addMemory({
    workspaceId: 'phase8-1-1-other-workspace', scope: 'semantic', content: 'evidence-boundary content', actor: 'admin',
    sourceClass: 'promoted-lesson', verificationStatus: 'verified', knowledgeStatus: 'active',
    reviewedBy: 'admin', reviewedAt: nowIso(), evidenceDigest: digest, evidenceRef: 'lesson:lsn_evidence_wrong_workspace',
  }), /not found|evidence/i);
});

test('migration 13 upgrades a pre-existing v12 schema without losing rows and migration 14 stays idempotent', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS, migrationStatus } = await import('./migrations.js');
  const db = new DatabaseSync(':memory:') as unknown as ReturnType<typeof getOsDb>;
  db.exec(`
    CREATE TABLE os_memory (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', provenance TEXT NOT NULL DEFAULT 'user', agent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE os_lessons (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, mission_id TEXT, task_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'candidate', confidence REAL NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, provenance TEXT NOT NULL, created_by TEXT NOT NULL, promoted_by TEXT, promoted_at TEXT, memory_id TEXT, revoked_by TEXT, revoked_at TEXT, revocation_reason TEXT NOT NULL DEFAULT '', outcome_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE os_playbooks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, tool_id TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]', tool_input TEXT NOT NULL DEFAULT '{}', validation TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'validated', success_runs INTEGER NOT NULL DEFAULT 1, created_from_mission TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE os_agents (id TEXT PRIMARY KEY, tools TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
    CREATE TABLE os_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, rolled_back_at TEXT);
  `);
  db.prepare('INSERT INTO os_memory (id, workspace_id, scope, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('mem_v12', 'ws-v12', 'workspace', 'preserved v12 knowledge', nowIso(), nowIso());
  db.prepare('INSERT INTO os_lessons (id, workspace_id, title, content, provenance, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('lsn_v12', 'ws-v12', 'Preserved lesson', 'preserved lesson content', 'test', 'test', nowIso(), nowIso());
  db.prepare('INSERT INTO os_playbooks (id, workspace_id, name, tool_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pbk_v12', 'ws-v12', 'Preserved playbook', 'or.solve_lp', nowIso(), nowIso());
  db.prepare('INSERT INTO os_agents (id, tools, updated_at) VALUES (?, ?, ?)')
    .run('agent_v12', JSON.stringify(['memory.search', 'text.extract_summary', 'memory.write']), nowIso());
  db.exec('PRAGMA user_version = 12');
  const m13 = MIGRATIONS.find((migration) => migration.version === 13)!;
  const m14 = MIGRATIONS.find((migration) => migration.version === 14)!;
  m13.up(db, () => {});
  m13.up(db, () => {});
  const memory = db.prepare('SELECT * FROM os_memory WHERE id = ?').get('mem_v12') as Record<string, string>;
  assert.equal(memory['content'], 'preserved v12 knowledge');
  assert.equal(memory['source_class'], 'legacy');
  assert.equal(memory['verification_status'], 'unverified');
  assert.equal(memory['knowledge_status'], 'active');
  const lesson = db.prepare('SELECT * FROM os_lessons WHERE id = ?').get('lsn_v12') as Record<string, string>;
  assert.equal(lesson['content'], 'preserved lesson content');
  assert.equal(Number(lesson['inconclusive_count']), 0);
  const playbook = db.prepare('SELECT * FROM os_playbooks WHERE id = ?').get('pbk_v12') as Record<string, string>;
  assert.equal(playbook['name'], 'Preserved playbook');
  assert.equal(playbook['created_by'], 'system');
  const agent = db.prepare('SELECT tools FROM os_agents WHERE id = ?').get('agent_v12') as { tools: string };
  assert.deepEqual(JSON.parse(agent.tools), ['text.extract_summary']);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)").all('idx_os_lesson_applications_lesson', 'idx_os_memory_retrievals_ws') as Array<{ name: string }>;
  assert.equal(indexes.length, 2);
  assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  m14.up(db, () => {});
  const lessonWithOutcome = db.prepare('PRAGMA table_info(os_lesson_applications)').all() as Array<{ name: string }>;
  assert.ok(lessonWithOutcome.some((column) => column.name === 'outcome_recorded_at'));
  const before = (db.prepare('SELECT COUNT(*) AS c FROM os_schema_migrations').get() as { c: number }).c;
  m14.up(db, () => {});
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM os_schema_migrations').get() as { c: number }).c, before);
  void migrationStatus;
});

test('reasoning models are redacted during construction, persistence and retrieval', async () => {
  const { buildDeterministicReasoning, filterReasoningForActor } = await import('./reasoning-engine.js');
  const { saveReasoningModel, getReasoningModel, listReasoningVersions } = await import('./reasoning-store.js');
  const ws = 'phase8-1-1-reasoning';
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const missionId = createMission({ workspaceId: ws, objective: `Diagnose a failure involving ${token}`, actor: 'alice' });
  const model = buildDeterministicReasoning({
    workspaceId: ws, missionId, objective: `Diagnose a failure involving ${token}`, actor: 'alice',
    evidence: [{ statement: `Observed credential token=${token} in the logs`, kind: 'observed-fact', source: 'test:adversarial' }],
  });
  assert.ok(!JSON.stringify(model).includes(token), 'reasoning model construction leaked the token');
  saveReasoningModel(model);
  const raw = getOsDb().prepare('SELECT model FROM os_reasoning_models WHERE workspace_id = ? AND mission_id = ? ORDER BY version DESC LIMIT 1').get(ws, missionId) as { model: string };
  assert.ok(!raw.model.includes(token), 'persisted reasoning model leaked the token');
  assert.ok(!JSON.stringify(getReasoningModel(ws, missionId)).includes(token));
  assert.ok(!JSON.stringify(listReasoningVersions(ws, missionId, 10)).includes(token));
  const record = addMemory({ workspaceId: ws, scope: 'workspace', visibility: 'owner', content: 'secret owner reasoning fact', actor: 'alice' });
  const withOwnerEvidence = buildDeterministicReasoning({ workspaceId: ws, missionId, objective: 'Explain secret owner reasoning fact', actor: 'alice' });
  assert.ok(withOwnerEvidence.claims.some((claim) => claim.memoryId === record.id));
  assert.ok(!filterReasoningForActor(withOwnerEvidence, ws, 'bob').claims.some((claim) => claim.memoryId === record.id));
});

test('common credential shapes are redacted from raw text, JSON strings, headers and cookies', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.signaturevalue123';
  const values = [
    '{"password":"hunter2-value","nested":{"api_key":"api-key-value-123"}}',
    '{"authorization":"Bearer abcdefghijklmnopqrstuvwxyz"}',
    'X-Api-Key: api-key-value-123',
    'Cookie: sessionid=abcdefghijklmnop; theme=dark',
    `Authorization: Bearer ${jwt}`,
    `token=${jwt}`,
    'aws_secret_access_key=abcdefghijklmnopqrstuvwxyz',
  ];
  const redacted = values.map((value) => redactSecrets(value).value);
  for (const [index, value] of redacted.entries()) {
    assert.ok(!/hunter2|api-key-value-123|abcdefghijklmnop|signaturevalue123/.test(value), `credential shape ${index} survived: ${value}`);
  }
  const nested = redactSecrets({ outer: { password: 'hunter2', authorization: 'Bearer abcdefghijklmnop' } }).value;
  assert.deepEqual(nested, { outer: { password: '[REDACTED:field:password]', authorization: '[REDACTED:field:authorization]' } });
});

test('revoked memory disappears from direct-ID and version APIs', () => {
  const ws = 'phase8-1-1-revoked-memory';
  const record = addMemory({ workspaceId: ws, scope: 'semantic', content: 'candidate knowledge to revoke', actor: 'alice' });
  getOsDb().prepare("UPDATE os_memory SET knowledge_status = 'revoked' WHERE workspace_id = ? AND id = ?").run(ws, record.id);
  assert.equal(getMemory(ws, record.id, 'alice'), null);
  assert.equal(listMemoryVersions(ws, record.id, 'alice'), null);
  assert.ok(!listMemories(ws, { actor: 'alice' }).some((entry) => entry.id === record.id));
});

test('HTTP memory routes enforce signed workspace, actor and role boundaries', async () => {
  const express = (await import('express')).default;
  const { createOsRouter } = await import('./router.js');
  const { issueSessionToken } = await import('../lib/session.js');
  const secret = process.env['AUTH_SECRET']!;
  const aliceToken = issueSessionToken('alice', secret, 60);
  const bobToken = issueSessionToken('bob', secret, 60);
  const app = express();
  app.use(express.json());
  app.use('/api/os', createOsRouter({ production: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const call = (method: string, path: string, token: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/os${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    setWorkspaceRole('wora-alice', 'root', 'owner', 'bootstrap');
    setWorkspaceRole('wora-alice', 'alice', 'viewer', 'root');
    const record = addMemory({ workspaceId: 'wora-alice', scope: 'workspace', visibility: 'owner', content: 'http owner record', actor: 'alice' });
    assert.equal((await call('GET', `/memory/${record.id}/versions`, aliceToken)).status, 200);
    assert.equal((await call('GET', `/memory/${record.id}/versions`, bobToken)).status, 404);
    const bobList = await call('GET', '/memory', bobToken);
    assert.ok(!JSON.stringify(await bobList.json()).includes(record.id));
    const viewerWrite = await call('POST', '/memory', aliceToken, { scope: 'workspace', content: 'viewer must not write' });
    assert.equal(viewerWrite.status, 403);
    setWorkspaceRole('wora-alice', 'alice', 'member', 'root');
    const memberWrite = await call('POST', '/memory', aliceToken, { scope: 'workspace', content: 'member may write' });
    assert.equal(memberWrite.status, 201);
    const memberRecord = await memberWrite.json() as { id: string };
    assert.equal((await call('DELETE', `/memory/${memberRecord.id}`, aliceToken)).status, 204);
    assert.equal((await call('GET', `/memory/${memberRecord.id}/versions`, aliceToken)).status, 404);
    removeWorkspaceRole('wora-alice', 'alice', 'root');
    const revokedWrite = await call('POST', '/memory', aliceToken, { scope: 'workspace', content: 'removed member must not write' });
    assert.equal(revokedWrite.status, 403);
    assert.equal((await call('GET', `/memory/${record.id}/versions`, aliceToken)).status, 200);
  } finally {
    server.close();
  }
});

test('legacy plaintext task inputs are scrubbed while sealed ciphertext is preserved', async () => {
  const { scrubLegacySecrets } = await import('./migrations.js') as unknown as { scrubLegacySecrets: (db: ReturnType<typeof getOsDb>) => { updated: number } };
  const ws = 'phase8-1-1-legacy-tool-input';
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const first = createMission({ workspaceId: ws, objective: 'Inspect my computer and identify potential problems', actor: 'alice' });
  const second = createMission({ workspaceId: ws, objective: 'Inspect my computer and identify potential problems', actor: 'alice' });
  const firstTask = getMissionDetail(ws, first, 'alice')!.tasks[0]!.id;
  const secondTask = getMissionDetail(ws, second, 'alice')!.tasks[0]!.id;
  const db = getOsDb();
  db.prepare('UPDATE os_tasks SET tool_input = ? WHERE id = ?').run(JSON.stringify({ command: 'echo', token }), firstTask);
  const sealed = 'wora:enc:v1:v1:abcdefgh:ijklmnop:qrstuvwx';
  db.prepare('UPDATE os_tasks SET tool_input = ? WHERE id = ?').run(sealed, secondTask);
  scrubLegacySecrets(db);
  const legacy = db.prepare('SELECT tool_input FROM os_tasks WHERE id = ?').get(firstTask) as { tool_input: string };
  const encrypted = db.prepare('SELECT tool_input FROM os_tasks WHERE id = ?').get(secondTask) as { tool_input: string };
  assert.ok(!legacy.tool_input.includes(token), 'legacy task input kept the token');
  assert.equal(encrypted.tool_input, sealed, 'sealed ciphertext was mutated');
});
