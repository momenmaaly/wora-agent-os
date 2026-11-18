import { randomUUID } from 'node:crypto';
import type { AgentSkillCatalog, AgentSkillSnapshot } from '../../../shared/types/index.js';
import { MAX_SKILLS, SkillError, type SkillDraft } from './metadata.js';

export type ImportResult = { catalog: AgentSkillCatalog; created: boolean };

export interface SkillStore {
  get(roomId: string, agentId: string): Promise<AgentSkillCatalog>;
  add(roomId: string, agentId: string, draft: SkillDraft): Promise<ImportResult>;
  activate(roomId: string, agentId: string, skillId: string, active: boolean): Promise<AgentSkillCatalog>;
  getIndex(roomId: string): Promise<Record<string, AgentSkillSnapshot>>;
}

export const emptyCatalog = (): AgentSkillCatalog => ({ revision: 0, skills: [] });
export const skillSnapshot = (catalog: AgentSkillCatalog): AgentSkillSnapshot => ({
  revision: catalog.revision,
  activeNames: catalog.skills.filter((skill) => skill.active).map((skill) => skill.name),
});

export function addSkill(catalog: AgentSkillCatalog, draft: SkillDraft): AgentSkillCatalog {
  if (catalog.skills.some((skill) => skill.source.repository === draft.source.repository)) return catalog;
  if (catalog.skills.length >= MAX_SKILLS) throw new SkillError('SKILL_LIMIT', 409);
  const skill = { ...draft, id: randomUUID(), active: false, importedAt: new Date().toISOString() };
  return { revision: catalog.revision + 1, skills: [...catalog.skills, skill] };
}

export function setSkillActive(catalog: AgentSkillCatalog, skillId: string, active: boolean): AgentSkillCatalog {
  const entry = catalog.skills.find((item) => item.id === skillId);
  if (!entry) throw new SkillError('SKILL_NOT_FOUND', 404);
  if (entry.active === active) return catalog;
  return { revision: catalog.revision + 1, skills: catalog.skills.map((item) => item.id === skillId ? { ...item, active } : item) };
}

/** Bounded preview-only store. Never mutates the shared agent seed catalog. */
export function createMemorySkillStore(): SkillStore {
  const capacity = 256;
  const catalogs = new Map<string, AgentSkillCatalog>();
  const key = (roomId: string, agentId: string) => `${roomId}/${agentId}`;
  function update(roomId: string, agentId: string, write: (catalog: AgentSkillCatalog) => AgentSkillCatalog) {
    const id = key(roomId, agentId);
    const result = write(catalogs.get(id) ?? emptyCatalog());
    if (!catalogs.has(id) && catalogs.size >= capacity) throw new SkillError('SKILLS_BUSY', 503);
    catalogs.set(id, result);
    return result;
  }
  return {
    async get(roomId, agentId) { return catalogs.get(key(roomId, agentId)) ?? emptyCatalog(); },
    async add(roomId, agentId, draft) {
      let created = false;
      const catalog = update(roomId, agentId, (previous) => {
        const next = addSkill(previous, draft);
        created = next !== previous;
        return next;
      });
      return { catalog, created };
    },
    async activate(roomId, agentId, skillId, active) { return update(roomId, agentId, (catalog) => setSkillActive(catalog, skillId, active)); },
    async getIndex(roomId) {
      const prefix = `${roomId}/`;
      return Object.fromEntries([...catalogs].filter(([id]) => id.startsWith(prefix)).map(([id, catalog]) => [id.slice(prefix.length), skillSnapshot(catalog)]));
    },
  };
}
