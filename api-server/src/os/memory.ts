/**
 * WORA OS — unified memory & knowledge service.
 *
 * Scopes: user, workspace, project, agent, organization, execution, episodic,
 * semantic. Every record carries provenance, workspace isolation, owner
 * visibility, verification metadata and an explicit knowledge status. Retrieval
 * is deterministic term-frequency scoring over content + tags; no vector store
 * is claimed. Retention and deletion are explicit operations, audited.
 */
import { createHash } from 'node:crypto';
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { getWorkspaceRole, roleRank } from './roles.js';
import { redactSecrets, redactText } from './secrets.js';

export const MEMORY_SCOPES = ['user', 'workspace', 'project', 'agent', 'organization', 'instance', 'execution', 'episodic', 'semantic'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type MemoryVisibility = 'workspace' | 'owner';
export type MemorySourceClass = 'legacy' | 'user-provided-fact' | 'execution-observation' | 'promoted-lesson' | 'system';
export type MemoryVerificationStatus = 'unverified' | 'verified' | 'revoked';
export type MemoryKnowledgeStatus = 'candidate' | 'active' | 'revoked';

export const DEFAULT_MISSION_MEMORY_SCOPES: MemoryScope[] = ['workspace', 'semantic'];
const RESERVED_VERIFICATION_TAGS = new Set(['verified', 'trusted', 'approved', 'reviewed']);

export class MemoryPolicyError extends Error {
  readonly code: string;
  constructor(message: string, code = 'MEMORY_POLICY_VIOLATION') {
    super(message);
    this.name = 'MemoryPolicyError';
    this.code = code;
  }
}

export interface MemoryAccessOptions {
  scopes?: MemoryScope[];
  scopeIds?: Partial<Record<MemoryScope, string[]>>;
  onlyVerifiedSemantic?: boolean;
}

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
  sourceClass: MemorySourceClass;
  verificationStatus: MemoryVerificationStatus;
  knowledgeStatus: MemoryKnowledgeStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  evidenceDigest: string;
  contentDigest: string;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  id: string; workspace_id: string; scope: string; scope_id: string; content: string;
  tags: string; provenance: string; agent_id: string | null; visibility: string; owner_id: string;
  expires_at: string | null; source_class: string; verification_status: string; knowledge_status: string;
  reviewed_by: string | null; reviewed_at: string | null; evidence_digest: string; content_digest: string;
  created_at: string; updated_at: string;
}

interface MemoryVersionRow {
  id: string; memory_id: string; workspace_id: string; scope: string; content: string;
  tags: string; action: string; actor: string; created_at: string;
}

export interface MemoryQueryFilter extends MemoryAccessOptions {
  scope?: MemoryScope;
  scopeId?: string;
  limit?: number;
  actor?: string;
  includeRevoked?: boolean;
}

export interface MemoryRetrievalRecord {
  id: string;
  workspaceId: string;
  actor: string;
  missionId: string | null;
  purpose: string;
  queryDigest: string;
  scopes: MemoryScope[];
  scopeIds: Partial<Record<MemoryScope, string[]>>;
  selectedIds: string[];
  limit: number;
  createdAt: string;
}

/** Actor may see workspace-visible memory always; owner-visible memory only their own. */
const canSee = (row: Pick<MemoryRow, 'visibility' | 'owner_id'>, actor: string) =>
  row.visibility !== 'owner' || row.owner_id === actor;

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function safeTags(tags: string[], verificationStatus: MemoryVerificationStatus): string[] {
  return tags
    .map((tag) => redactText(String(tag)).trim())
    .filter(Boolean)
    .filter((tag) => verificationStatus === 'verified' || !RESERVED_VERIFICATION_TAGS.has(tag.toLowerCase()))
    .slice(0, 20);
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  const verificationStatus = (row.verification_status as MemoryVerificationStatus) ?? 'unverified';
  return {
    id: row.id, workspaceId: row.workspace_id, scope: row.scope as MemoryScope, scopeId: row.scope_id,
    content: redactSecrets(row.content).value, tags: safeTags(parseJson(row.tags, []), verificationStatus),
    provenance: redactSecrets(row.provenance ?? '').value,
    agentId: row.agent_id, visibility: (row.visibility as MemoryVisibility) ?? 'workspace',
    ownerId: row.owner_id ?? '', expiresAt: row.expires_at ?? null,
    sourceClass: (row.source_class as MemorySourceClass) ?? 'legacy',
    verificationStatus,
    knowledgeStatus: (row.knowledge_status as MemoryKnowledgeStatus) ?? 'active',
    reviewedBy: row.reviewed_by ?? null, reviewedAt: row.reviewed_at ?? null,
    evidenceDigest: row.evidence_digest ?? '',
    contentDigest: row.content_digest || digest(row.content),
    createdAt: row.created_at, updatedAt: row.updated_at,
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

function policyError(message: string, code?: string): never {
  throw new MemoryPolicyError(message, code);
}

export function addMemory(input: {
  workspaceId: string;
  scope: MemoryScope;
  scopeId?: string;
  content: string;
  tags?: string[];
  provenance?: string;
  agentId?: string | null;
  actor?: string;
  visibility?: MemoryVisibility;
  ttlDays?: number | null;
  sourceClass?: MemorySourceClass;
  verificationStatus?: MemoryVerificationStatus;
  knowledgeStatus?: MemoryKnowledgeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  evidenceDigest?: string;
  evidenceRef?: string;
}): MemoryRecord {
  if (!MEMORY_SCOPES.includes(input.scope)) throw new Error(`Unknown memory scope "${input.scope}"`);
  if (input.visibility && !['workspace', 'owner'].includes(input.visibility)) throw new Error(`Unknown visibility "${input.visibility}"`);
  const actor = input.actor ?? 'user';
  const visibility: MemoryVisibility = input.scope === 'user' ? 'owner' : (input.visibility ?? 'workspace');
  if (input.scope === 'organization' || input.scope === 'instance') {
    const role = getWorkspaceRole(input.workspaceId, actor);
    const required = input.scope === 'instance' ? 'owner' : 'admin';
    if (roleRank(role) < roleRank(required)) {
      policyError(`${input.scope} memory requires ${required} review; actor role is ${role}.`, 'MEMORY_SCOPE_REVIEW_REQUIRED');
    }
  }
  const sourceClass = input.sourceClass ?? 'user-provided-fact';
  const verificationStatus = input.verificationStatus ?? 'unverified';
  const knowledgeStatus = input.knowledgeStatus ?? (input.scope === 'semantic' ? 'candidate' : 'active');
  const rawTags = (input.tags ?? []).slice(0, 20);
  if (rawTags.some((tag) => RESERVED_VERIFICATION_TAGS.has(String(tag).toLowerCase())) && verificationStatus !== 'verified') {
    policyError('Verification tags such as "verified" are reserved and cannot be self-assigned.');
  }
  if (verificationStatus === 'verified' && sourceClass !== 'promoted-lesson') {
    policyError('Verified memory must be created through the reviewed lesson promotion workflow.');
  }
  if (verificationStatus === 'verified' && (!input.reviewedBy || !input.reviewedAt || !input.evidenceDigest)) {
    policyError('Verified memory requires a reviewer, review timestamp and resolved evidence digest.');
  }
  if (input.scope === 'semantic' && sourceClass === 'user-provided-fact' && knowledgeStatus === 'active') {
    policyError('User-provided semantic memory must remain a candidate until reviewed.');
  }
  const db = getOsDb();
  let verifiedLesson: { id: string; content: string } | null = null;
  if (verificationStatus === 'verified') {
    const evidenceRef = String(input.evidenceRef ?? '').trim();
    if (!evidenceRef.startsWith('lesson:')) {
      policyError('Verified memory requires a resolvable evidence reference; a digest alone is not proof.', 'MEMORY_EVIDENCE_REQUIRED');
    }
    const lessonId = evidenceRef.slice('lesson:'.length);
    const row = db.prepare('SELECT id, content, evidence, status, promoted_by, memory_id FROM os_lessons WHERE workspace_id = ? AND id = ?')
      .get(input.workspaceId, lessonId) as { id: string; content: string; evidence: string; status: string; promoted_by: string | null; memory_id: string | null } | undefined;
    if (!row) policyError('Verified memory evidence lesson was not found in this workspace.', 'MEMORY_EVIDENCE_NOT_FOUND');
    if (row.status !== 'promoted') policyError('Verified memory evidence must be a promoted lesson.', 'MEMORY_EVIDENCE_INVALID');
    if (row.memory_id) policyError('This lesson already produced verified memory; promotion cannot be replayed.', 'MEMORY_EVIDENCE_REPLAYED');
    if (row.promoted_by !== actor) policyError('The reviewer must be the same authorized actor that promoted the lesson.', 'MEMORY_REVIEWER_MISMATCH');
    if (input.reviewedBy !== actor) policyError('The reviewer identity must match the acting principal.', 'MEMORY_REVIEWER_MISMATCH');
    if (!input.reviewedAt || Number.isNaN(Date.parse(input.reviewedAt))) policyError('Reviewed timestamp must be a valid ISO timestamp.');
    const evidence = parseJson<unknown[]>(row.evidence, []);
    const lessonDigest = createHash('sha256').update(JSON.stringify(evidence ?? null)).digest('hex').slice(0, 32);
    if (input.evidenceDigest !== lessonDigest) {
      policyError('Evidence digest does not match the accessible lesson evidence record.', 'MEMORY_EVIDENCE_MISMATCH');
    }
    if (redactSecrets(input.content).value !== redactSecrets(row.content).value) {
      policyError('Verified memory content must match the reviewed lesson content.', 'MEMORY_CONTENT_MISMATCH');
    }
    if (roleRank(getWorkspaceRole(input.workspaceId, actor)) < roleRank('admin')) {
      policyError('Verified knowledge promotion requires an admin or owner review.', 'MEMORY_REVIEW_REQUIRED');
    }
    verifiedLesson = { id: row.id, content: row.content };
  }
  const id = newId('mem');
  const ts = nowIso();
  const content = redactSecrets(input.content).value.slice(0, 20_000);
  const expiresAt = input.ttlDays && input.ttlDays > 0 ? new Date(Date.now() + Math.min(input.ttlDays, 3650) * 86_400_000).toISOString() : null;
  const tags = safeTags(rawTags, verificationStatus);
  const provenance = redactSecrets(input.provenance ?? 'user').value;
  const contentDigest = digest(content);
  const ownsTransaction = Boolean(verifiedLesson) && !db.isTransaction;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO os_memory (id, workspace_id, scope, scope_id, content, tags, provenance, agent_id, visibility, owner_id, expires_at, source_class, verification_status, knowledge_status, reviewed_by, reviewed_at, evidence_digest, content_digest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, input.workspaceId, input.scope, input.scopeId ?? '', content, JSON.stringify(tags), provenance,
      input.agentId ?? null, visibility, actor, expiresAt, sourceClass, verificationStatus,
      knowledgeStatus, input.reviewedBy ?? null, input.reviewedAt ?? null, input.evidenceDigest ?? '', contentDigest, ts, ts,
    );
    if (verifiedLesson) {
      const claim = db.prepare("UPDATE os_lessons SET memory_id = ? WHERE workspace_id = ? AND id = ? AND memory_id IS NULL AND status = 'promoted'")
        .run(id, input.workspaceId, verifiedLesson.id);
      if (Number(claim.changes ?? 0) !== 1) {
        policyError('This lesson already produced verified memory; promotion cannot be replayed.', 'MEMORY_EVIDENCE_REPLAYED');
      }
    }
    snapshotVersion(db, db.prepare('SELECT * FROM os_memory WHERE id = ?').get(id) as unknown as MemoryRow, 'create', actor);
    audit(db, {
      workspaceId: input.workspaceId, actor, action: 'memory.write', subject: id,
      detail: { scope: input.scope, scopeId: input.scopeId ?? '', visibility, expiresAt, sourceClass, verificationStatus, knowledgeStatus, contentDigest },
    });
    if (ownsTransaction) db.exec('COMMIT');
  } catch (error) {
    if (ownsTransaction) { try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ } }
    throw error;
  }
  return getMemory(input.workspaceId, id, actor)!;
}

export function getMemory(workspaceId: string, id: string, actor = 'system'): MemoryRecord | null {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MemoryRow | undefined;
  if (!row || row.knowledge_status === 'revoked' || (row.expires_at && row.expires_at <= nowIso()) || !canSee(row, actor)) return null;
  return rowToMemory(row);
}

function sqlFilter(workspaceId: string, filter: MemoryQueryFilter, actor: string): { where: string; values: string[] } {
  const clauses = ['workspace_id = ?', '(expires_at IS NULL OR expires_at > ?)'];
  const values: string[] = [workspaceId, nowIso()];
  if (!filter.includeRevoked) clauses.push("knowledge_status <> 'revoked'");
  clauses.push("(visibility <> 'owner' OR owner_id = ?)");
  values.push(actor);
  if (filter.scopes?.length) {
    clauses.push(`scope IN (${filter.scopes.map(() => '?').join(', ')})`);
    values.push(...filter.scopes);
  } else if (filter.scope) {
    clauses.push('scope = ?');
    values.push(filter.scope);
  }
  if (filter.scopeId !== undefined) {
    clauses.push('scope_id = ?');
    values.push(filter.scopeId);
  }
  if (filter.scopeIds) {
    for (const [scope, ids] of Object.entries(filter.scopeIds) as Array<[MemoryScope, string[]]>) {
      if (!ids.length) continue;
      clauses.push(`(scope <> ? OR scope_id IN (${ids.map(() => '?').join(', ')}))`);
      values.push(scope, ...ids);
    }
  }
  if (filter.onlyVerifiedSemantic) clauses.push("(scope <> 'semantic' OR verification_status = 'verified')");
  return { where: clauses.join(' AND '), values };
}

export function listMemories(workspaceId: string, filter: MemoryQueryFilter = {}): MemoryRecord[] {
  const db = getOsDb();
  const actor = filter.actor ?? 'system';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const { where, values } = sqlFilter(workspaceId, filter, actor);
  const rows = db.prepare(`SELECT * FROM os_memory WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values, limit) as unknown as MemoryRow[];
  return rows.map(rowToMemory);
}

const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

export function searchMemories(workspaceId: string, query: string, filter: MemoryQueryFilter = {}): Array<MemoryRecord & { score: number }> {
  const q = tokenize(query);
  if (!q.length) return [];
  const candidates = listMemories(workspaceId, { ...filter, limit: 500 });
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

export function deleteMemory(workspaceId: string, id: string, actor = 'system', options: { inTransaction?: boolean; skipLinkedLessons?: boolean } = {}): boolean {
  const db = getOsDb();
  const row = db.prepare('SELECT * FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as MemoryRow | undefined;
  if (!row) return false;
  if (!canSee(row, actor)) return false;
  const contentDigest = row.content_digest || digest(row.content);
  if (!options.inTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    // Content erasure is intentional: a deleted record's history must not remain
    // readable through the version endpoint. Audit metadata keeps the digest only.
    db.prepare('DELETE FROM os_memory_versions WHERE workspace_id = ? AND memory_id = ?').run(workspaceId, id);
    const linked = options.skipLinkedLessons
      ? []
      : db.prepare("SELECT id FROM os_lessons WHERE workspace_id = ? AND memory_id = ? AND status = 'promoted'").all(workspaceId, id) as Array<{ id: string }>;
    for (const lesson of linked) {
      db.prepare("UPDATE os_lessons SET status = 'revoked', revoked_at = ?, revocation_reason = 'linked memory deleted', title = 'Revoked lesson', content = '[content erased: linked memory deleted]', evidence = '[]' WHERE workspace_id = ? AND id = ?")
        .run(nowIso(), workspaceId, lesson.id);
      db.prepare('INSERT INTO os_lesson_events (id, workspace_id, lesson_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId('lse'), workspaceId, lesson.id, 'revoke', actor, JSON.stringify({ reason: 'linked memory deleted', contentDigest }), nowIso());
    }
    db.prepare('DELETE FROM os_memory WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
    audit(db, { workspaceId, actor, action: 'memory.delete', subject: id, detail: { contentDigest, versionsErased: true, linkedLessonsRevoked: linked.length } });
    if (!options.inTransaction) db.exec('COMMIT');
    return true;
  } catch (error) {
    if (!options.inTransaction) { try { db.exec('ROLLBACK'); } catch { /* preserve original error */ } }
    throw error;
  }
}

export function listMemoryVersions(workspaceId: string, memoryId: string, actor = 'system'): Array<{ id: string; memoryId: string; action: string; actor: string; createdAt: string; content: string; tags: string[] }> | null {
  const db = getOsDb();
  const parent = db.prepare('SELECT visibility, owner_id, expires_at, knowledge_status FROM os_memory WHERE workspace_id = ? AND id = ?').get(workspaceId, memoryId) as Pick<MemoryRow, 'visibility' | 'owner_id' | 'expires_at' | 'knowledge_status'> | undefined;
  if (!parent || parent.knowledge_status === 'revoked' || (parent.expires_at && parent.expires_at <= nowIso()) || !canSee(parent, actor)) return null;
  const rows = db.prepare('SELECT * FROM os_memory_versions WHERE workspace_id = ? AND memory_id = ? ORDER BY created_at DESC LIMIT 50').all(workspaceId, memoryId) as unknown as MemoryVersionRow[];
  return rows.map((row) => ({
    id: row.id, memoryId: row.memory_id, action: row.action, actor: row.actor, createdAt: row.created_at,
    content: redactSecrets(row.content).value, tags: safeTags(parseJson(row.tags, []), 'unverified'),
  }));
}

export function recordMemoryRetrieval(input: {
  workspaceId: string;
  actor: string;
  missionId?: string | null;
  purpose: string;
  query: string;
  selectedIds: string[];
  scopes: MemoryScope[];
  scopeIds?: Partial<Record<MemoryScope, string[]>>;
  limit: number;
}): MemoryRetrievalRecord {
  const id = newId('memr');
  const createdAt = nowIso();
  const queryDigest = digest(input.query);
  getOsDb().prepare(
    'INSERT INTO os_memory_retrievals (id, workspace_id, actor, mission_id, purpose, query_digest, scopes, scope_ids, selected_ids, limit_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, input.workspaceId, input.actor, input.missionId ?? null, input.purpose, queryDigest,
    JSON.stringify(input.scopes), JSON.stringify(input.scopeIds ?? {}), JSON.stringify(input.selectedIds), input.limit, createdAt,
  );
  return {
    id, workspaceId: input.workspaceId, actor: input.actor, missionId: input.missionId ?? null,
    purpose: input.purpose, queryDigest, scopes: input.scopes, scopeIds: input.scopeIds ?? {},
    selectedIds: input.selectedIds, limit: input.limit, createdAt,
  };
}

export function memoryAccessibleTo(workspaceId: string, memoryId: string, actor: string): boolean {
  return getMemory(workspaceId, memoryId, actor) !== null;
}

export function listMemoryRetrievals(workspaceId: string, opts: { missionId?: string; actor?: string; limit?: number } = {}): MemoryRetrievalRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const db = getOsDb();
  const clauses = ['workspace_id = ?'];
  const values: string[] = [workspaceId];
  if (opts.missionId) { clauses.push('mission_id = ?'); values.push(opts.missionId); }
  if (opts.actor) { clauses.push('actor = ?'); values.push(opts.actor); }
  const rows = db.prepare(`SELECT * FROM os_memory_retrievals WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...values, limit) as unknown as Array<Record<string, string | number>>;
  return rows.map((row) => ({
    id: String(row['id']), workspaceId: String(row['workspace_id']), actor: String(row['actor']),
    missionId: row['mission_id'] == null ? null : String(row['mission_id']), purpose: String(row['purpose']),
    queryDigest: String(row['query_digest']),
    scopes: parseJson<MemoryScope[]>(String(row['scopes']), []),
    scopeIds: parseJson<Partial<Record<MemoryScope, string[]>>>(String(row['scope_ids']), {}),
    selectedIds: parseJson<string[]>(String(row['selected_ids']), []),
    limit: Number(row['limit_count']), createdAt: String(row['created_at']),
  }));
}
