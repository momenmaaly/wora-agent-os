/**
 * WORA OS — persistent agent registry.
 *
 * Agents are real, editable, executable entities backed by SQLite: identity,
 * role, specialization, skills, tools, permissions, model configuration,
 * instructions, limits, status and source. The 18 specializations from the
 * catalog are seeded per workspace on first access; users can create custom
 * specializations freely.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { SPECIALIZATIONS, SPECIALIZATION_BY_ID } from './specializations.js';

export interface AgentRecord {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  specialization: string;
  skills: string[];
  tools: string[];
  permissions: string[];
  model: { provider?: string; model?: string };
  limits: { maxTokens?: number; timeoutMs?: number };
  instructions: string;
  status: 'active' | 'paused' | 'archived';
  source: string;
  evaluation: string[];
  createdAt: string;
  updatedAt: string;
}

interface AgentRow {
  id: string; workspace_id: string; name: string; role: string; specialization: string;
  skills: string; tools: string; permissions: string; model: string; limits: string;
  instructions: string; status: string; source: string; created_at: string; updated_at: string;
}

function rowToAgent(row: AgentRow): AgentRecord {
  const spec = SPECIALIZATION_BY_ID.get(row.specialization);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    role: row.role,
    specialization: row.specialization,
    skills: parseJson(row.skills, []),
    tools: parseJson(row.tools, []),
    permissions: parseJson(row.permissions, []),
    model: parseJson(row.model, {}),
    limits: parseJson(row.limits, {}),
    instructions: row.instructions,
    status: (row.status as AgentRecord['status']) ?? 'active',
    source: row.source,
    evaluation: [
      'Delivers the assigned objective with evidence attached',
      'Stays within granted permissions and tool scope',
      'Handoff contract passes the receiving review checklist',
      spec ? `Demonstrates ${spec.label} competencies: ${spec.skills.slice(0, 3).join(', ')}` : 'Meets the acceptance criteria set on each task',
    ],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureSeedAgents(workspaceId: string): void {
  const db = getOsDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM os_agents WHERE workspace_id = ? AND source = ?').get(workspaceId, 'seed') as { c: number };
  if (count.c > 0) return;
  const insert = db.prepare(
    `INSERT INTO os_agents (id, workspace_id, name, role, specialization, skills, tools, permissions, model, limits, instructions, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'seed', ?, ?)`
  );
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    for (const spec of SPECIALIZATIONS) {
      insert.run(
        newId('agt'), workspaceId, spec.label, spec.description, spec.id,
        JSON.stringify(spec.skills), JSON.stringify(spec.tools), JSON.stringify(spec.permissions),
        JSON.stringify({}), JSON.stringify({ timeoutMs: 60_000 }),
        `You are the ${spec.label}. ${spec.description} Work only from granted tools, attach evidence to every handoff and flag gaps instead of inventing them.`,
        ts, ts,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  role: string;
  specialization: string;
  skills?: string[];
  tools?: string[];
  permissions?: string[];
  instructions?: string;
  model?: { provider?: string; model?: string };
  source?: string;
  actor?: string;
}

export function createAgent(input: CreateAgentInput): AgentRecord {
  const db = getOsDb();
  const spec = SPECIALIZATION_BY_ID.get(input.specialization);
  const id = newId('agt');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO os_agents (id, workspace_id, name, role, specialization, skills, tools, permissions, model, limits, instructions, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(
    id, input.workspaceId, input.name.trim(), input.role.trim(), input.specialization,
    JSON.stringify(input.skills ?? spec?.skills ?? ['execution']),
    JSON.stringify(input.tools ?? spec?.tools ?? []),
    JSON.stringify(input.permissions ?? spec?.permissions ?? []),
    JSON.stringify(input.model ?? {}),
    JSON.stringify({ timeoutMs: 60_000 }),
    (input.instructions ?? `You are the ${input.name.trim()}. ${input.role.trim()} Ground every answer in tool evidence and request approval before risky actions.`).slice(0, 4000),
    input.source ?? 'user', ts, ts,
  );
  audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'agent.create', subject: id, detail: { name: input.name, specialization: input.specialization } });
  return getAgent(input.workspaceId, id)!;
}

export function listAgents(workspaceId: string, filter: { specialization?: string; status?: string; query?: string } = {}): AgentRecord[] {
  ensureSeedAgents(workspaceId);
  const db = getOsDb();
  let rows = db.prepare('SELECT * FROM os_agents WHERE workspace_id = ? ORDER BY created_at ASC').all(workspaceId) as unknown as AgentRow[];
  if (filter.specialization) rows = rows.filter((r) => r.specialization === filter.specialization);
  if (filter.status) rows = rows.filter((r) => r.status === filter.status);
  if (filter.query) {
    const q = filter.query.toLowerCase();
    rows = rows.filter((r) => [r.name, r.role, r.specialization].join(' ').toLowerCase().includes(q));
  }
  return rows.map(rowToAgent);
}

export function getAgent(workspaceId: string, id: string): AgentRecord | null {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_agents WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

export interface UpdateAgentInput {
  name?: string;
  role?: string;
  skills?: string[];
  tools?: string[];
  permissions?: string[];
  instructions?: string;
  status?: AgentRecord['status'];
  model?: { provider?: string; model?: string };
}

export function updateAgent(workspaceId: string, id: string, patch: UpdateAgentInput, actor = 'user'): AgentRecord | null {
  const existing = getAgent(workspaceId, id);
  if (!existing) return null;
  const db = getOsDb();
  db.prepare(
    `UPDATE os_agents SET name = ?, role = ?, skills = ?, tools = ?, permissions = ?, instructions = ?, status = ?, model = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`
  ).run(
    (patch.name ?? existing.name).slice(0, 80),
    (patch.role ?? existing.role).slice(0, 500),
    JSON.stringify(patch.skills ?? existing.skills),
    JSON.stringify(patch.tools ?? existing.tools),
    JSON.stringify(patch.permissions ?? existing.permissions),
    (patch.instructions ?? existing.instructions).slice(0, 4000),
    patch.status ?? existing.status,
    JSON.stringify(patch.model ?? existing.model),
    nowIso(), workspaceId, id,
  );
  audit(db, { workspaceId, actor, action: 'agent.update', subject: id, detail: { fields: Object.keys(patch) } });
  return getAgent(workspaceId, id);
}

export function deleteAgent(workspaceId: string, id: string, actor = 'user'): boolean {
  const db = getOsDb();
  const row = db.prepare('SELECT id FROM os_agents WHERE workspace_id = ? AND id = ?').get(workspaceId, id);
  if (!row) return false;
  db.prepare('DELETE FROM os_agents WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  audit(db, { workspaceId, actor, action: 'agent.delete', subject: id });
  return true;
}

export function pickAgent(workspaceId: string, specialization: string): AgentRecord | null {
  ensureSeedAgents(workspaceId);
  const db = getOsDb();
  const rows = db.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM os_tasks t WHERE t.agent_id = a.id AND t.status IN ('running', 'assigned')) AS load
     FROM os_agents a WHERE a.workspace_id = ? AND a.specialization = ? AND a.status = 'active'`
  ).all(workspaceId, specialization) as unknown as (AgentRow & { load: number })[];
  rows.sort((x, y) => (x.load - y.load) || x.created_at.localeCompare(y.created_at));
  return rows[0] ? rowToAgent(rows[0]) : null;
}
