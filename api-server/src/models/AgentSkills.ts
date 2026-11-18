import mongoose, { Schema } from 'mongoose';
import type { AgentSkillCatalog, ImportedSkill } from '../../../shared/types/index.js';
import { MAX_SKILLS, SkillError, type SkillDraft } from '../skills/metadata.js';
import { addSkill, emptyCatalog, setSkillActive, type ImportResult, type SkillStore } from '../skills/store.js';

type StoredSkill = Omit<ImportedSkill, 'inputSchema'> & { schemaJson: string };
interface AgentSkillSet {
  _id: string;
  roomId: string;
  agentId: string;
  revision: number;
  skills: StoredSkill[];
}

const SkillSourceSchema = new Schema<ImportedSkill['source']>({
  repository: { type: String, required: true, maxlength: 140 },
  url: { type: String, required: true, maxlength: 170 },
  path: { type: String, required: true, maxlength: 256 },
  sha: { type: String, required: true, match: /^[a-f0-9]{40}$/u },
  kind: { type: String, required: true, enum: ['skill.json', 'readme'] },
}, { _id: false });

const SkillSchema = new Schema<StoredSkill>({
  id: { type: String, required: true, maxlength: 36 },
  name: { type: String, required: true, maxlength: 120 },
  description: { type: String, required: true, maxlength: 800 },
  // JSON text preserves JSON Schema keywords and dotted input names without treating them as MongoDB keys.
  schemaJson: { type: String, required: true, maxlength: 5_120 },
  source: { type: SkillSourceSchema, required: true },
  active: { type: Boolean, required: true, default: false },
  importedAt: { type: String, required: true, maxlength: 32 },
}, { _id: false });

const schema = new Schema<AgentSkillSet>({
  _id: { type: String, required: true },
  roomId: { type: String, required: true, index: true },
  agentId: { type: String, required: true },
  revision: { type: Number, required: true, min: 1 },
  skills: { type: [SkillSchema], validate: (skills: StoredSkill[]) => skills.length <= MAX_SKILLS },
}, { timestamps: true, versionKey: false, bufferCommands: false });

/** Workspaces share the base AgentModel roster but never share its private skill catalogs. */
export const AgentSkillModel = mongoose.model<AgentSkillSet>('AgentSkillSet', schema);

function read(document: AgentSkillSet | null): AgentSkillCatalog {
  if (!document) return emptyCatalog();
  return {
    revision: document.revision,
    skills: document.skills.map(({ schemaJson, ...skill }) => ({ ...skill, inputSchema: JSON.parse(schemaJson) as ImportedSkill['inputSchema'] })),
  };
}

export function createMongoSkillStore(): SkillStore {
  const key = (roomId: string, agentId: string) => `${roomId}/${agentId}`;
  const get = async (roomId: string, agentId: string) => read(await AgentSkillModel.findById(key(roomId, agentId)).maxTimeMS(2_500).lean());

  // Compare-and-set prevents duplicate imports, capacity races and lost activation toggles across API instances.
  async function mutate(roomId: string, agentId: string, update: (catalog: AgentSkillCatalog) => AgentSkillCatalog): Promise<ImportResult> {
    const _id = key(roomId, agentId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await get(roomId, agentId);
      const next = update(previous);
      if (next === previous) return { catalog: previous, created: false };
      const skills = next.skills.map(({ inputSchema, ...skill }) => ({ ...skill, schemaJson: JSON.stringify(inputSchema) }));
      try {
        const saved = await AgentSkillModel.updateOne(
          previous.revision ? { _id, revision: previous.revision } : { _id, revision: { $exists: false } },
          { $set: { revision: next.revision, skills }, $setOnInsert: { roomId, agentId } },
          { upsert: previous.revision === 0, maxTimeMS: 2_500, runValidators: true },
        );
        if (saved.matchedCount || saved.upsertedCount) return { catalog: next, created: true };
      } catch (error) {
        if ((error as { code?: unknown }).code !== 11000) throw error;
      }
    }
    throw new SkillError('SKILLS_BUSY', 503);
  }

  return {
    get,
    add: (roomId, agentId, draft: SkillDraft) => mutate(roomId, agentId, (catalog) => addSkill(catalog, draft)),
    async activate(roomId, agentId, skillId, active) { return (await mutate(roomId, agentId, (catalog) => setSkillActive(catalog, skillId, active))).catalog; },
    async getIndex(roomId) {
      const docs = await AgentSkillModel.find({ roomId }).select('agentId revision skills.name skills.active').maxTimeMS(2_500).limit(200).lean();
      return Object.fromEntries(docs.map((doc) => [doc.agentId, { revision: doc.revision, activeNames: doc.skills.filter((skill) => skill.active).map((skill) => skill.name) }]));
    },
  };
}
