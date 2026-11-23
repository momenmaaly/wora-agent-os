/**
 * WORA OS — Project OS board persistence.
 *
 * The client keeps an optimistic zustand/localStorage board; this module is the
 * durable source of truth (one JSON document per workspace in os_boards), so
 * projects/products/ideas/kanban tasks survive device loss and are shared
 * across sessions of the same workspace. State is opaque JSON to the server,
 * size-capped and audited — schema evolution lives on the client.
 */
import { getOsDb, nowIso, audit } from './db.js';

const MAX_BOARD_BYTES = 512 * 1024; // 512 KB — generous for hundreds of records

export interface BoardDocument {
  state: Record<string, unknown>;
  updatedAt: string;
  sizeBytes: number;
}

export function getBoard(workspaceId: string): BoardDocument | null {
  const row = getOsDb().prepare('SELECT state, updated_at FROM os_boards WHERE workspace_id = ?').get(workspaceId) as { state?: string; updated_at?: string } | undefined;
  if (!row?.state) return null;
  try {
    const state = JSON.parse(row.state) as Record<string, unknown>;
    return { state, updatedAt: row.updated_at ?? '', sizeBytes: Buffer.byteLength(row.state) };
  } catch {
    return null;
  }
}

export function putBoard(workspaceId: string, state: unknown, actor = 'user'): BoardDocument {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Board state must be a JSON object');
  const serialized = JSON.stringify(state);
  const size = Buffer.byteLength(serialized);
  if (size > MAX_BOARD_BYTES) throw new Error(`Board state exceeds the ${Math.round(MAX_BOARD_BYTES / 1024)} KB limit`);
  const db = getOsDb();
  const ts = nowIso();
  db.prepare(`INSERT INTO os_boards (workspace_id, state, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(workspace_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
    .run(workspaceId, serialized, ts);
  audit(db, { workspaceId, actor, action: 'board.put', subject: workspaceId, detail: { sizeBytes: size } });
  return { state: state as Record<string, unknown>, updatedAt: ts, sizeBytes: size };
}

export function clearBoard(workspaceId: string, actor = 'user'): void {
  const db = getOsDb();
  db.prepare('DELETE FROM os_boards WHERE workspace_id = ?').run(workspaceId);
  audit(db, { workspaceId, actor, action: 'board.clear', subject: workspaceId, detail: {} });
}
