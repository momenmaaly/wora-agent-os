/**
 * WORA OS — unified memory & knowledge service.
 *
 * Scopes: user, workspace, project, agent, organization, execution, episodic,
 * semantic. Every record carries provenance (who wrote it, from which
 * mission/run) and is isolated per workspace. Retrieval is deterministic
 * term-frequency scoring over content + tags; no vector store is claimed.
 * Retention and deletion are explicit operations, audited.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';

export const MEMORY_SCOPES = ['user', 'workspace', 'project', 'agent', 'organization', 'execution', 'episodic', 'semantic'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type MemoryVisibility = 'workspace' | 'owner';

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  scope: MemoryScope;
  scopeId: string;
  content: string;
  tags: string[];
  provenance: string;
  agentId: string | null;
  visibility: MemoryVisibility;
  ownerId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  id: string; workspace_id: string; scope: string; scope_id: string; content: string;
  tags: string; provenance: string; agent_id: string | null; visibility: string; owner_id: string;
  expires_at: string | null; created_at: string; updated_at: string;
}

/** Actor may see workspace-visible memory always; owner-visible memory only their own. */
const canSee = (row: Pick<MemoryRow, 'visibility' | 'owner_id'>, actor: string) =>
  row.visibility !== 'owner' || row.owner_id === actor;

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id, workspaceId: row.workspace_id, scope: row.scope as MemoryScope, scopeId: row.scope_id,
    content: row.content, tags: parseJson(row.tags, []), provenance: row.provenance,
    agentId: row.agent_id, visibility: (row.visibility as MemoryVisibility) ?? 'workspace',
    ownerId: row.owner_id ?? '', expiresAt: row.expires_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const VERSION_CAP = 20;
function snapshotVersion(db: ReturnType<typeof getOsDb>, row: MemoryRow, action: string, actor: string): void {
  db.prepare('INSERT INTO os_memory_versions (id, memory_id, workspace_id, scope, content, tags, action, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('memv'), row.id, row.workspace_id, row.scope, row.content, row.tags, action, actor, nowIso());
  // keep only the newest VERSION_CAP versions per memory record
  const excess = db.prepare('SELECT id FROM os_memory_versions WHERE memory_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(row.id, VERSION_CAP) as Array<{ id: string }>;
  for (const old of excess) db.prepare('DELETE FROM os_memory_versions WHERE id = ?').run(old.id);
}

export function addMemory(input: { workspaceId: string; scope: MemoryScope; scopeId?: string; content: string; tags?: string[]; provenance?: string; agentId?: string | null; actor?: string; visibility?: MemoryVisibility; ttlDays?: number | null }): MemoryRecord {
  if (!MEMORY_SCOPES.includes(input.scope)) throw new Error(`Unknown memory scope "${input.scope}"`);
  if (input.visibility && !['workspace', 'owner'].includes(input.visibility)) throw new Error(`Unknown visibility "${input.visibility}"`);
  const db = getOsDb();
  const id = newId('mem');
  const ts = nowIso();
  const actor = input.actor ?? 'user';
  const expiresAt = input.ttlDays && input.ttlDays > 0 ? new Date(Date.now() + Math.min(input.ttlDays, 3650) * 86_400_000).toISOString() : null;
  db.prepare(
    'INSERT INTO os_memory (id, workspace_id, scope, scope_id, content, tags, provenance, agent_id, visibility, owner_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.workspaceId, input.scope, input.scopeId ?? '', input.content.slice(0, 20_000), JSON.stringify((input.tags ?? []).slice(0, 20)), input.provenance ?? 'user', input.agentId ?? null, input.visibility ?? 'workspace', actor, expiresAt, ts, ts);
  snapshotVersion(db, db.prepare('SELECT * FROM os_memory WHERE id = ?').get(id) as unknown as MemoryRow, 'create', actor);
  audit(db, { workspaceId: input.workspaceId, actor, action: 'memory.write', subject: id, detail: { scope: input.scope, scopeId: input.scopeId ?? '', visibility: input.visibility ?? 'workspace', expiresAt } });
  return getMemory(input.workspaceId, id, actor)!;
}

export function getMemory(workspaceId: string, id: string, actor = 'user'): MemoryRecord | null {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MemoryRow | undefined;
  if (!row || (row.expires_at && row.expires_at <= nowIso()) || !canSee(row, actor)) return null;
  return rowToMemory(row);
}

export function listMemories(workspaceId: string, filter: { scope?: MemoryScope; scopeId?: string; limit?: number; actor?: string } = {}): MemoryRecord[] {
  const db = getOsDb();
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const actor = filter.actor ?? 'user';
  const now = nowIso();
  let rows: MemoryRow[];
  if (filter.scope && filter.scopeId !== undefined) {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND scope = ? AND scope_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?').all(workspaceId, filter.scope, filter.scopeId, now, limit * 2) as unknown as MemoryRow[];
  } else if (filter.scope) {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND scope = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?').all(workspaceId, filter.scope, now, limit * 2) as unknown as MemoryRow[];
  } else {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?').all(workspaceId, now, limit * 2) as unknown as MemoryRow[];
  }
  return rows.filter((row) => canSee(row, actor)).slice(0, limit).map(rowToMemory);
}

const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

export function searchMemories(workspaceId: string, query: string, filter: { scope?: MemoryScope; limit?: number; actor?: string } = {}): Array<MemoryRecord & { score: number }> {
  const q = tokenize(query);
  if (!q.length) return [];
  const candidates = listMemories(workspaceId, { scope: filter.scope, limit: 500, actor: filter.actor });
  const df = new Map<string, number>();
  const docs = candidates.map((m) => tokenize(`${m.content} ${m.tags.join(' ')}`));
  for (const tokens of docs) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = Math.max(candidates.length, 1);
  const scored = candidates.map((m, i) => {
    const tokens = docs[i]!;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + n / (df.get(term) ?? 1));
      score += f * idf;
    }
    return { ...m, score: Math.round(score * 1000) / 1000 };
  }).filter((m) => m.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(Math.max(filter.limit ?? 10, 1), 50));
}

export function deleteMemory(workspaceId: string, id: string, actor = 'user'): boolean {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MemoryRow | undefined;
  if (!row) return false;
  if (!canSee(row, actor)) return false; // owner-scoped record owned by someone else — refuse silently
  snapshotVersion(db, row, 'delete', actor);
  db.prepare('DELETE FROM os_memory WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  audit(db, { workspaceId, actor, action: 'memory.delete', subject: id });
  return true;
}

export function listMemoryVersions(workspaceId: string, memoryId: string, actor = 'user'): Array<{ id: string; memoryId: string; action: string; actor: string; createdAt: string; content: string; tags: string[] }> {
  const db = getOsDb();
  const rows = db.prepare('SELECT * FROM os_memory_versions WHERE workspace_id = ? AND memory_id = ? ORDER BY created_at DESC LIMIT 50').all(workspaceId, memoryId) as Array<{ id: string; memory_id: string; action: string; actor: string; created_at: string; content: string; tags: string }>;
  return rows.map((row) => ({ id: row.id, memoryId: row.memory_id, action: row.action, actor: row.actor, createdAt: row.created_at, content: row.content, tags: parseJson(row.tags, []) }));
}
