import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { AgentSkillModel, createMongoSkillStore } from '../models/AgentSkills.js';
import { MAX_SKILLS, type SkillDraft } from './metadata.js';

const draft: SkillDraft = {
  name: 'Notes', description: 'Summarize a note.', inputSchema: { type: 'object', properties: { 'note.text': { type: 'string' } }, required: ['note.text'] },
  source: { kind: 'skill.json', path: 'skill.json', sha: 'a'.repeat(40), repository: 'fixtures/notes', url: 'https://github.com/fixtures/notes' },
};

test('AgentSkillSet validates scoped rows and stores schema keywords as JSON text', async () => {
  const { inputSchema, ...metadata } = draft;
  const skill = { ...metadata, id: randomUUID(), schemaJson: JSON.stringify(inputSchema), active: false, importedAt: new Date().toISOString() };
  const row = new AgentSkillModel({ _id: 'wora-fixture/agent-01', roomId: 'wora-fixture', agentId: 'agent-01', revision: 1, skills: [skill] });
  await row.validate();
  assert.deepEqual(JSON.parse(row.skills[0]!.schemaJson), inputSchema);
  assert.equal(row.skills[0]!.active, false);
  row.skills = Array.from({ length: MAX_SKILLS + 1 }, () => skill);
  await assert.rejects(row.validate(), (error: unknown) => error instanceof mongoose.Error.ValidationError && Boolean(error.errors['skills']));
});

const mongo = process.env['WORA_TEST_MONGO_URL'];
test('MongoDB persists revisions, isolates workspaces, and deduplicates concurrent imports', { skip: !mongo }, async () => {
  // Always use an isolated disposable database, never the DB named in the connection URL.
  await mongoose.connect(mongo!, { dbName: `wora_skills_test_${randomUUID().replaceAll('-', '')}`, serverSelectionTimeoutMS: 4_000 });
  try {
    const store = createMongoSkillStore();
    const roomId = 'wora-fixture'; const agentId = 'agent-01';
    const results = await Promise.all(Array.from({ length: 5 }, () => store.add(roomId, agentId, draft)));
    assert.equal(results.filter((item) => item.created).length, 1);
    const ids = new Set(results.map(({ catalog }) => catalog.skills[0]?.id));
    assert.equal(ids.size, 1);
    const imported = results[0]!.catalog.skills[0]!;
    assert.equal(imported.active, false);
    const active = await store.activate(roomId, agentId, imported.id, true);
    assert.deepEqual(active.skills[0]?.inputSchema, draft.inputSchema);
    const reopened = createMongoSkillStore();
    assert.deepEqual(await reopened.get(roomId, agentId), active);
    assert.deepEqual(await reopened.getIndex(roomId), { [agentId]: { revision: 2, activeNames: ['Notes'] } });
    assert.deepEqual(await reopened.get('wora-other', agentId), { revision: 0, skills: [] });
    assert.deepEqual(await reopened.getIndex('wora-other'), {});
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
