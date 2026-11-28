/**
 * WORA Personal — durable research-program domain service.
 *
 * Programs group existing WORA missions; they never replace the mission
 * orchestrator. State is append-only in os_artifacts so this first slice needs
 * no destructive schema migration and preserves a complete version history.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { redactSecrets } from './secrets.js';

export type ResearchProgramStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type ResearchWorkstreamStatus = 'planned' | 'active' | 'blocked' | 'completed';

export interface ResearchWorkstream {
  id: string;
  title: string;
  objective: string;
  specialization: string;
  dependsOn: string[];
  missionIds: string[];
  status: ResearchWorkstreamStatus;
  deliverables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchProgram {
  schemaVersion: '1.0';
  id: string;
  workspaceId: string;
  title: string;
  objective: string;
  successCriteria: string[];
  status: ResearchProgramStatus;
  workstreams: ResearchWorkstream[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const MAX_TEXT = 4000;

const STATUS_TRANSITIONS: Record<ResearchProgramStatus, readonly ResearchProgramStatus[]> = {
  draft: ['draft', 'active', 'cancelled'],
  active: ['active', 'paused', 'completed', 'cancelled'],
  paused: ['paused', 'active', 'completed', 'cancelled'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

function canTransitionStatus(from: ResearchProgramStatus, to: ResearchProgramStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}
const clean = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  const result = value.trim();
  if (result.length > MAX_TEXT) throw new Error(`${label} exceeds ${MAX_TEXT} characters`);
  return result;
};
const unique = (values: string[]): string[] => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function latestProgram(workspaceId: string, programId: string): ResearchProgram | null {
  const rows = getOsDb().prepare(`SELECT content FROM os_artifacts
    WHERE workspace_id = ? AND mission_id IS NULL AND kind = 'research-program' AND name LIKE ?`)
    .all(workspaceId, `program:${programId}:v%`) as Array<{ content: string }>;
  const versions = rows.map((row) => parseJson<ResearchProgram | null>(row.content, null))
    .filter((item): item is ResearchProgram => Boolean(item && item.schemaVersion === '1.0' && item.workspaceId === workspaceId && item.id === programId));
  return versions.sort((left, right) => right.version - left.version)[0] ?? null;
}

function persist(program: ResearchProgram, actor: string): ResearchProgram {
  const db = getOsDb();
  const stored = redactSecrets(program).value;
  // Serialize writers. A read-then-insert check without a write lock can allow
  // two callers with the same expectedVersion to both append version N+1.
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = latestProgram(program.workspaceId, program.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== program.version - 1) {
      throw new Error(`Research program version conflict: expected ${program.version - 1}, current ${currentVersion}`);
    }
    db.prepare(`INSERT INTO os_artifacts (id, mission_id, workspace_id, name, kind, content, created_at)
      VALUES (?, NULL, ?, ?, 'research-program', ?, ?)`)
      .run(newId('rpg'), program.workspaceId, `program:${program.id}:v${program.version}`, JSON.stringify(stored), nowIso());
    audit(db, { workspaceId: program.workspaceId, actor, action: 'research.program.version.created',
      subject: program.id, detail: { version: program.version, status: program.status, workstreams: program.workstreams.length } });
    db.exec('COMMIT');
    return stored;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createResearchProgram(input: {
  workspaceId: string; title: string; objective: string; successCriteria?: string[]; actor?: string;
}): ResearchProgram {
  const workspaceId = clean(input.workspaceId, 'workspaceId');
  const timestamp = nowIso();
  const program: ResearchProgram = {
    schemaVersion: '1.0', id: newId('rprog'), workspaceId,
    title: clean(input.title, 'title'), objective: clean(input.objective, 'objective'),
    successCriteria: unique((input.successCriteria ?? []).map((v) => clean(v, 'success criterion'))).slice(0, 30),
    status: 'draft', workstreams: [], version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  return persist(program, input.actor ?? 'system');
}

export function getResearchProgram(workspaceId: string, programId: string): ResearchProgram | null {
  return latestProgram(workspaceId, programId);
}

export function listResearchPrograms(workspaceId: string, limit = 50): ResearchProgram[] {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  // Read the complete append-only history before collapsing versions. A fixed
  // multiplier can silently omit older programs that have many revisions.
  const rows = getOsDb().prepare(`SELECT content FROM os_artifacts
    WHERE workspace_id = ? AND mission_id IS NULL AND kind = 'research-program'
    ORDER BY created_at DESC`).all(workspaceId) as Array<{ content: string }>;
  const latest = new Map<string, ResearchProgram>();
  for (const row of rows) {
    const item = parseJson<ResearchProgram | null>(row.content, null);
    if (item?.schemaVersion === '1.0' && item.workspaceId === workspaceId && (latest.get(item.id)?.version ?? 0) < item.version) latest.set(item.id, item);
  }
  return [...latest.values()].slice(0, bounded);
}

export function updateResearchProgram(input: {
  workspaceId: string; programId: string; expectedVersion: number; actor?: string;
  patch: { title?: string; objective?: string; successCriteria?: string[]; status?: ResearchProgramStatus };
}): ResearchProgram {
  const current = latestProgram(input.workspaceId, input.programId);
  if (!current) throw new Error('Research program not found');
  if (current.version !== input.expectedVersion) throw new Error(`Research program version conflict: expected ${input.expectedVersion}, current ${current.version}`);
  if (input.patch.status !== undefined && !canTransitionStatus(current.status, input.patch.status)) {
    throw new Error(`Invalid research program status transition: ${current.status} -> ${input.patch.status}`);
  }
  const next: ResearchProgram = {
    ...current,
    ...(input.patch.title !== undefined ? { title: clean(input.patch.title, 'title') } : {}),
    ...(input.patch.objective !== undefined ? { objective: clean(input.patch.objective, 'objective') } : {}),
    ...(input.patch.successCriteria !== undefined ? { successCriteria: unique(input.patch.successCriteria.map((v) => clean(v, 'success criterion'))).slice(0, 30) } : {}),
    ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
    version: current.version + 1, updatedAt: nowIso(),
  };
  return persist(next, input.actor ?? 'system');
}

export function addResearchWorkstream(input: {
  workspaceId: string; programId: string; expectedVersion: number; actor?: string;
  workstream: { title: string; objective: string; specialization: string; dependsOn?: string[]; deliverables?: string[] };
}): ResearchProgram {
  const current = latestProgram(input.workspaceId, input.programId);
  if (!current) throw new Error('Research program not found');
  if (current.version !== input.expectedVersion) throw new Error(`Research program version conflict: expected ${input.expectedVersion}, current ${current.version}`);
  if (current.status === 'completed' || current.status === 'cancelled') throw new Error('Cannot add workstreams to a terminal research program');
  const id = newId('rws');
  const dependsOn = unique(input.workstream.dependsOn ?? []);
  if (dependsOn.some((dependency) => !current.workstreams.some((item) => item.id === dependency))) throw new Error('Workstream dependency must reference an existing workstream');
  const timestamp = nowIso();
  const workstream: ResearchWorkstream = {
    id, title: clean(input.workstream.title, 'workstream title'),
    objective: clean(input.workstream.objective, 'workstream objective'),
    specialization: clean(input.workstream.specialization, 'specialization'),
    dependsOn, missionIds: [], status: 'planned',
    deliverables: unique((input.workstream.deliverables ?? []).map((v) => clean(v, 'deliverable'))).slice(0, 30),
    createdAt: timestamp, updatedAt: timestamp,
  };
  return persist({ ...current, workstreams: [...current.workstreams, workstream], version: current.version + 1, updatedAt: timestamp }, input.actor ?? 'system');
}

/** Link only missions that already exist in this workspace; no duplicate mission execution is created. */
export function linkMissionToWorkstream(input: {
  workspaceId: string; programId: string; workstreamId: string; missionId: string;
  expectedVersion: number; actor?: string;
}): ResearchProgram {
  const current = latestProgram(input.workspaceId, input.programId);
  if (!current) throw new Error('Research program not found');
  if (current.version !== input.expectedVersion) throw new Error(`Research program version conflict: expected ${input.expectedVersion}, current ${current.version}`);
  const mission = getOsDb().prepare('SELECT id FROM os_missions WHERE workspace_id = ? AND id = ?').get(input.workspaceId, input.missionId);
  if (!mission) throw new Error('Mission not found in this workspace');
  const target = current.workstreams.find((item) => item.id === input.workstreamId);
  if (!target) throw new Error('Research workstream not found');
  const timestamp = nowIso();
  const workstreams = current.workstreams.map((item) => item.id === target.id
    ? { ...item, missionIds: unique([...item.missionIds, input.missionId]), status: 'active' as const, updatedAt: timestamp }
    : item);
  return persist({ ...current, workstreams, status: current.status === 'draft' ? 'active' : current.status, version: current.version + 1, updatedAt: timestamp }, input.actor ?? 'system');
}
