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

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  scope: MemoryScope;
  scopeId: string;
  content: string;
  tags: string[];
  provenance: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  id: string; workspace_id: string; scope: string; scope_id: string; content: string;
  tags: string; provenance: string; agent_id: string | null; created_at: string; updated_at: string;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id, workspaceId: row.workspace_id, scope: row.scope as MemoryScope, scopeId: row.scope_id,
    content: row.content, tags: parseJson(row.tags, []), provenance: row.provenance,
    agentId: row.agent_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function addMemory(input: { workspaceId: string; scope: MemoryScope; scopeId?: string; content: string; tags?: string[]; provenance?: string; agentId?: string | null; actor?: string }): MemoryRecord {
  if (!MEMORY_SCOPES.includes(input.scope)) throw new Error(`Unknown memory scope "${input.scope}"`);
  const db = getOsDb();
  const id = newId('mem');
  const ts = nowIso();
  db.prepare(
    'INSERT INTO os_memory (id, workspace_id, scope, scope_id, content, tags, provenance, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.workspaceId, input.scope, input.scopeId ?? '', input.content.slice(0, 20_000), JSON.stringify((input.tags ?? []).slice(0, 20)), input.provenance ?? 'user', input.agentId ?? null, ts, ts);
  audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'memory.write', subject: id, detail: { scope: input.scope, scopeId: input.scopeId ?? '' } });
  return getMemory(input.workspaceId, id)!;
}

export function getMemory(workspaceId: string, id: string): MemoryRecord | null {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MemoryRow | undefined;
  return row ? rowToMemory(row) : null;
}

export function listMemories(workspaceId: string, filter: { scope?: MemoryScope; scopeId?: string; limit?: number } = {}): MemoryRecord[] {
  const db = getOsDb();
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  let rows: MemoryRow[];
  if (filter.scope && filter.scopeId !== undefined) {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND scope = ? AND scope_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, filter.scope, filter.scopeId, limit) as unknown as MemoryRow[];
  } else if (filter.scope) {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND scope = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, filter.scope, limit) as unknown as MemoryRow[];
  } else {
    rows = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit) as unknown as MemoryRow[];
  }
  return rows.map(rowToMemory);
}

const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

export function searchMemories(workspaceId: string, query: string, filter: { scope?: MemoryScope; limit?: number } = {}): Array<MemoryRecord & { score: number }> {
  const q = tokenize(query);
  if (!q.length) return [];
  const candidates = listMemories(workspaceId, { scope: filter.scope, limit: 500 });
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
  const row = db.prepare('SELECT id FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id);
  if (!row) return false;
  db.prepare('DELETE FROM os_memory WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  audit(db, { workspaceId, actor, action: 'memory.delete', subject: id });
  return true;
}
