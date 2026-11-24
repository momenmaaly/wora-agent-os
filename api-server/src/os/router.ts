/**
 * WORA OS — REST surface (/api/os).
 *
 * Workspace resolution mirrors the rest of the API: in production a signed
 * session scopes every record to `wora-{userId}` (503 without AUTH_SECRET);
 * in development/preview traffic lands in a shared sandbox workspace unless a
 * bearer session is supplied. Direct tool execution is restricted to low and
 * medium risk tools — high-risk tools run only inside the orchestrator under
 * agent permissions. All mutating routes are rate limited per workspace.
 */
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { verifySessionToken, safeEqual } from '../lib/session.js';
import { isSessionActive } from '../lib/session-store.js';
import { isProductionEnv, sanitizeEnv } from '../lib/config.js';
import { getOsDb, parseJson } from './db.js';
import { getAiUsageSummary } from './usage.js';
import { listPlaybooks, deletePlaybook } from './playbooks.js';
import { listTools, runTool, getTool } from './tools.js';
import { listAlgorithms, selectAlgorithm, PROBLEM_KINDS, algorithmSelectionInputSchema } from './algorithms.js';
import { listVerifications, getVerification } from './verification.js';
import { listTaskLeases, listTaskCheckpoints, getExecutionLimits, setExecutionLimits } from './task-queue.js';
import { understandProblem, getProblemProfile } from './problem.js';
import { listPlanVersions, replanMission } from './planning.js';
import { previewTeam, getTeamPlan, listSelectionDecisions, performanceReport, requirementsForPlan } from './selection.js';
import { listLessons, getLesson, collectCandidateLessons, evaluateLesson, promoteLesson, rejectLesson, revokeLesson, recordLessonOutcome, listLessonEvents } from './lessons.js';
import { redactSecrets } from './secrets.js';
import { runBenchmarkSuite, listBenchmarkRuns } from './benchmarks.js';
import { listScientificDomains, scientificCatalogSummary, selectScientificMethod } from './science.js';
import { compareSolutionStrategies, assessReplan, listDecisionRecords, saveDecisionRecord } from './decision.js';
import { classifyAction } from './actions.js';
import { repairRepository, inspectRepository } from './code-repair.js';
import { recoveryReport, recoverWorkspace } from './recovery.js';
import { workerSnapshot } from './worker.js';
import { migrationStatus } from './migrations.js';
import { SPECIALIZATIONS } from './specializations.js';
import {
  createAgent, listAgents, getAgent, updateAgent, deleteAgent, ensureSeedAgents,
} from './registry.js';
import {
  createMission, executeMission, getMissionDetail, listMissions, getOsState, markInterruptedMissions, pauseMission, resumeMission, cancelMission, buildPlan,
} from './orchestrator.js';
import { addMemory, listMemories, searchMemories, deleteMemory, listMemoryVersions, MEMORY_SCOPES, type MemoryScope } from './memory.js';
import { getWorkspaceRole, roleRank, listWorkspaceRoles, setWorkspaceRole, removeWorkspaceRole, type WorkspaceRole } from './roles.js';
import { getBoard, putBoard, clearBoard } from './boards.js';
import { createTwin, getTwin, listTwins, deleteTwin, recordObservation, runScenario, type TwinDriver, type TwinKpi } from './twins.js';
import { listAgentVersions } from './registry.js';
import { buildOrganization, listOrganizations } from './orgs.js';
import { solveAssignment, solveEmployeeSchedule, solveLp } from './ortools.js';
import { sampleEmployeeInput } from './orchestrator.js';
import {
  getApproval, getAutonomyPolicy, setAutonomyPolicy, listApprovals, decideApproval, getActionBudget, setActionBudget,
  requestDevicePairing, redeemDevicePairing, revokeDevice, listDevices, deviceHeartbeat, findDeviceById,
} from './governance.js';
import { logger } from '../lib/logger.js';
import { metricsPrometheus, metricsSnapshot, newCorrelationId } from '../lib/observability.js';
import { createExtensionsRouter } from '../extensions/router.js';
import { applyAdaptiveReplan, alternativeForTask } from './adaptive-replan.js';
import { ensureWorkspaceExtensions } from '../extensions/index.js';
import { executeForAgent } from '../extensions/capabilities.js';
import { permissionSensitivity } from '../extensions/manifest.js';

const AUTH_SECRET = sanitizeEnv(process.env['AUTH_SECRET']);
const ADMIN_API_KEY = sanitizeEnv(process.env['ADMIN_API_KEY']);
const PREVIEW_WORKSPACE = 'wora-preview';

function resolveWorkspace(req: Request, res: Response, production: boolean): string | null {
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (ADMIN_API_KEY && bearer && safeEqual(bearer, ADMIN_API_KEY)) {
    res.locals['actor'] = 'admin';
    return (req.header('x-workspace') ?? 'wora-admin').slice(0, 120);
  }
  if (AUTH_SECRET) {
    const verified = bearer ? verifySessionToken(bearer, AUTH_SECRET, production) : null;
    if (verified) {
      if (verified.sessionId) {
        try {
          if (!isSessionActive(verified.sessionId, verified.userId)) {
            res.status(401).json({ code: 'SESSION_REVOKED' });
            return null;
          }
        } catch {
          res.status(503).json({ code: 'SESSION_STORE_UNAVAILABLE' });
          return null;
        }
      }
      res.locals['actor'] = verified.userId;
      return `wora-${verified.userId}`.slice(0, 120);
    }
    if (production) { res.status(401).json({ error: 'A signed session is required' }); return null; }
  } else if (production) {
    res.status(503).json({ error: 'AUTH_SECRET is required in production' });
    return null;
  }
  res.locals['actor'] = 'preview';
  return PREVIEW_WORKSPACE;
}

/* ─── Tiny per-workspace rate limiter for mutating routes ── */
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(workspaceId: string, limit = 60, scope = 'global'): boolean {
  const now = Date.now();
  const key = `${workspaceId}:${scope.replace(/\/[a-z]{2,4}_[a-z0-9]+/gi, '/:id')}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + 60_000 }); return true; }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Express 5 param values can be string | string[] — normalize. */
const param = (req: Request, name: string): string => {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value[0] ?? '');
  return '';
};

const asyncWrap = (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

export function createOsRouter(options: { production?: boolean } = {}): Router {
  const production = options.production ?? isProductionEnv(process.env);
  const router = Router();
  router.use(express.json({ limit: '512kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const supplied = req.header('x-correlation-id');
    const correlationId = supplied && /^[A-Za-z0-9._:-]{8,120}$/u.test(supplied) ? supplied : newCorrelationId();
    res.locals['correlationId'] = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  });

  // Workspace scope for every route
  /* The device agent holds no web session: the one-time pairing code and the
     device fingerprint are its credentials for redeem/heartbeat only. Everything
     else stays session-gated in production. */
  const isDeviceCredentialRoute = (req: express.Request) => {
    const p = req.path.replace(/\/+$/, '');
    return (req.method === 'POST' && (/^\/devices\/[^/]+\/(redeem|heartbeat)$/.test(p)));
  };
  router.use((req, res, next) => {
    if (isDeviceCredentialRoute(req)) {
      // Workspace authority comes from the device record itself, never from the caller.
      const deviceId = req.path.split('/')[2] ?? '';
      const device = findDeviceById(deviceId);
      if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
      res.locals['workspaceId'] = (getOsDb().prepare('SELECT workspace_id FROM os_devices WHERE id = ?').get(deviceId) as { workspace_id: string }).workspace_id;
      res.locals['actor'] = 'device-agent';
      next();
      return;
    }
    const ws = resolveWorkspace(req, res, production);
    if (!ws) return;
    res.locals['workspaceId'] = ws;
    ensureWorkspaceExtensions(ws);
    next();
  });

  // RBAC v1: every authenticated workspace member resolves to a role.
  // viewer = read-only; member = standard mutations; admin/owner = settings-class mutations.
  router.use((req, res, next) => {
    if (isDeviceCredentialRoute(req)) { next(); return; }
    const ws = res.locals['workspaceId'] as string;
    const role = getWorkspaceRole(ws, (res.locals['actor'] as string) ?? 'user');
    res.locals['role'] = role;
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') { next(); return; }
    if (roleRank(role) < roleRank('member')) { res.status(403).json({ error: 'دور المشاهد للقراءة فقط — Viewer role is read-only' }); return; }
    const path2 = req.path.replace(/\/+$/, '');
    const ADMIN_MUTATIONS: Array<{ method: string; pattern: RegExp }> = [
      { method: 'POST', pattern: /^\/settings\/autonomy$/ },
      { method: 'POST', pattern: /^\/settings\/action-budget$/ },
      { method: 'POST', pattern: /^\/settings\/execution-limits$/ },
      { method: 'POST', pattern: /^\/lessons\/[^/]+\/promote$/ },
      { method: 'POST', pattern: /^\/lessons\/[^/]+\/revoke$/ },
      { method: 'POST', pattern: /^\/code-repair$/ },
      { method: 'POST', pattern: /^\/recovery$/ },
      { method: 'POST', pattern: /^\/code-repair\/inspect$/ },
      { method: 'POST', pattern: /^\/devices\/pair$/ },
      { method: 'POST', pattern: /^\/devices\/[^/]+\/revoke$/ },
      { method: 'DELETE', pattern: /^\/agents\/[^/]+$/ },
      { method: 'DELETE', pattern: /^\/playbooks\/[^/]+$/ },
      { method: 'DELETE', pattern: /^\/board$/ },
      { method: 'DELETE', pattern: /^\/twins\/[^/]+$/ },
    ];
    if (ADMIN_MUTATIONS.some((rule) => rule.method === method && rule.pattern.test(path2)) && roleRank(role) < roleRank('admin')) {
      res.status(403).json({ error: 'يتطلب دور المشرف — Admin role required' }); return;
    }
    next();
  });

  const workspace = (res: Response) => res.locals['workspaceId'] as string;
  const actor = (res: Response) => (res.locals['actor'] as string) ?? 'user';
  const correlation = (res: Response) => (res.locals['correlationId'] as string) ?? undefined;
  const roleOf = (res: Response) => (res.locals['role'] as WorkspaceRole) ?? 'viewer';

  // Interrupted-mission recovery runs once per process boot (idempotent).
  // A writer-lease conflict is fatal: another process owns this database.
  try {
    markInterruptedMissions();
  } catch (err) {
    if (err instanceof Error && err.message.includes('SQLite writer lease')) throw err;
    logger.warn({ err }, 'interrupted-mission recovery failed');
  }

  /* ─── Code repair, recovery and observability ──────── */
  const codeRepairSchema = z.object({
    repoPath: z.string().min(1).max(500), defect: z.string().min(1).max(4_000),
    patch: z.string().min(1).max(256_000), testPath: z.string().min(1).max(500),
    regressionPath: z.string().min(1).max(500).optional(),
  }).strict();
  router.post('/code-repair', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = codeRepairSchema.parse(req.body ?? {});
    const result = await repairRepository({ workspaceId: workspace(res), actor: actor(res), ...body });
    res.status(result.ok ? 200 : 422).json(result);
  }));
  router.post('/code-repair/inspect', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ repoPath: z.string().min(1).max(500) }).strict().parse(req.body ?? {});
    res.json(inspectRepository(workspace(res), body.repoPath));
  }));
  router.get('/recovery', asyncWrap((_req, res) => {
    res.json(recoveryReport(workspace(res)));
  }));
  router.get('/runtime/status', asyncWrap((_req, res) => {
    res.json(workerSnapshot(workspace(res)));
  }));
  router.post('/recovery', asyncWrap((req, res) => {
    if (roleRank(roleOf(res)) < roleRank('admin')) { res.status(403).json({ error: 'Admin role required' }); return; }
    if (!rateLimit(workspace(res), 5, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.json(recoverWorkspace(workspace(res)));
  }));
  router.get('/migrations', asyncWrap((_req, res) => {
    if (roleRank(roleOf(res)) < roleRank('admin')) { res.status(403).json({ error: 'Admin role required' }); return; }
    res.json(migrationStatus(getOsDb()));
  }));
  router.get('/metrics', asyncWrap((_req, res) => {
    if (roleRank(roleOf(res)) < roleRank('admin')) { res.status(403).json({ error: 'Admin role required' }); return; }
    res.json(metricsSnapshot());
  }));
  router.get('/metrics/prometheus', asyncWrap((_req, res) => {
    if (roleRank(roleOf(res)) < roleRank('admin')) { res.status(403).json({ error: 'Admin role required' }); return; }
    res.type('text/plain; version=0.0.4').send(metricsPrometheus());
  }));

  router.get('/state', asyncWrap((_req, res) => {
    res.json(getOsState(workspace(res)));
  }));

  router.get('/sample/employee-schedule', asyncWrap((_req, res) => {
    const { employees, shifts } = sampleEmployeeInput();
    res.json({ sample: true, employees, shifts, note: 'Bundled SAMPLE roster (20 employees × 5 shifts) labeled "sample". Replace with real operational data for production scheduling.' });
  }));

  router.get('/specializations', asyncWrap((_req, res) => {
    res.json(SPECIALIZATIONS.map(({ id, label, description, skills, tools, permissions, modelTier }) => ({ id, label, description, skills, tools, permissions, modelTier })));
  }));

  /* ─── Dynamic capability analysis and team preview ─── */
  const capabilityAnalysisSchema = z.object({
    objective: z.string().trim().min(3).max(4000),
    track: z.string().trim().min(1).max(40).optional(),
  }).strict();

  router.post('/capabilities/analyze', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = capabilityAnalysisSchema.parse(req.body ?? {});
    const problem = understandProblem({ objective: body.objective, track: body.track });
    const plan = buildPlan(body.objective, body.track, workspace(res));
    const requirements = requirementsForPlan(plan, workspace(res));
    const team = previewTeam(workspace(res), plan, problem);
    res.json({ problem, plan, requirements, team });
  }));

  router.get('/capabilities/performance', asyncWrap((req, res) => {
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'] : undefined;
    res.json(performanceReport(workspace(res), agentId));
  }));

  router.get('/missions/:id/team', asyncWrap((req, res) => {
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    res.json({ team: getTeamPlan(workspace(res), detail.id), decisions: listSelectionDecisions(workspace(res), detail.id) });
  }));

  router.get('/tools', asyncWrap((_req, res) => {
    res.json(listTools(workspace(res)));
  }));

  router.get('/algorithms', asyncWrap((_req, res) => {
    res.json({ catalogVersion: '2026-11-24.1', algorithms: listAlgorithms() });
  }));

  router.post('/algorithms/select', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.json(selectAlgorithm(algorithmSelectionInputSchema.parse(req.body ?? {})));
  }));

  router.get('/science/domains', asyncWrap((_req, res) => {
    res.json({ ...scientificCatalogSummary(), domains: listScientificDomains() });
  }));

  router.post('/science/select', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = algorithmSelectionInputSchema.parse(req.body ?? {});
    res.json(selectScientificMethod(body));
  }));

  router.post('/decisions/compare', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      objective: z.string().trim().min(3).max(4000),
      track: z.string().trim().min(1).max(40).optional(),
    }).strict().parse(req.body ?? {});
    const problem = understandProblem({ objective: body.objective, track: body.track });
    const plan = buildPlan(body.objective, body.track, workspace(res));
    res.json({ problem, plan, decision: compareSolutionStrategies(plan, workspace(res), problem) });
  }));

  router.post('/decisions/replan-check', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      failureCategory: z.string().trim().max(80).optional(),
      methodFailed: z.boolean().optional(),
      toolUnavailable: z.boolean().optional(),
      specialistUnavailable: z.boolean().optional(),
      costExceeded: z.boolean().optional(),
      assumptionInvalidated: z.boolean().optional(),
      newEvidence: z.boolean().optional(),
      alternativesAvailable: z.boolean().optional(),
      previousReplans: z.number().int().min(0).max(20).optional(),
    }).strict().parse(req.body ?? {});
    res.json(assessReplan(body));
  }));

  router.get('/missions/:id/decisions', asyncWrap((req, res) => {
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    res.json({ decisions: listDecisionRecords(workspace(res), detail.id) });
  }));

  router.post('/actions/classify', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      action: z.string().trim().min(1).max(500),
      risk: z.enum(['low', 'medium', 'high']),
      reversible: z.boolean().optional(), externalCommitment: z.boolean().optional(), spendsMoney: z.boolean().optional(),
      amountUsd: z.number().finite().min(0).max(100_000_000).optional(), sensitiveData: z.boolean().optional(),
      scope: z.string().trim().min(1).max(200).optional(), expiresAt: z.string().datetime({ offset: true }).optional(),
    }).strict().parse(req.body ?? {});
    res.json(classifyAction(body));
  }));

  router.post('/tools/:id/execute', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const tool = getTool(param(req, 'id'), workspace(res));
    if (!tool) { res.status(404).json({ error: 'Unknown tool' }); return; }
    if (tool.source === 'plugin') { res.status(403).json({ error: 'Plugin tools execute only through an agent capability profile', code: 'CAPABILITY_REQUIRED' }); return; }
    if (tool.risk === 'high') { res.status(403).json({ error: 'High-risk tools execute only through the orchestrator under agent permissions' }); return; }
    const body = z.object({
      input: z.unknown().optional(),
      agentId: z.string().trim().min(1).max(80),
    }).strict().parse(req.body ?? {});
    const agent = getAgent(workspace(res), body.agentId);
    if (!agent) { res.status(404).json({ error: 'Unknown agent', code: 'AGENT_NOT_FOUND' }); return; }
    if (agent.status !== 'active') { res.status(403).json({ error: 'Agent is not active', code: 'AGENT_INACTIVE' }); return; }
    const result = await executeForAgent({
      workspaceId: workspace(res),
      agentId: body.agentId,
      toolId: tool.id,
      toolInput: body.input ?? {},
      actor: actor(res),
    });
    if (!result.ok) {
      const invalidInput = (result.error ?? '').startsWith('Invalid input');
      res.status(invalidInput ? 422 : 403).json(result);
      return;
    }
    res.json(result);
  }));

  /* ─── Agents ─── */
  router.get('/agents', asyncWrap((req, res) => {
    const filter = {
      query: typeof req.query['query'] === 'string' ? req.query['query'].slice(0, 120) : undefined,
      specialization: typeof req.query['specialization'] === 'string' ? req.query['specialization'].slice(0, 60) : undefined,
      status: typeof req.query['status'] === 'string' ? req.query['status'].slice(0, 20) : undefined,
    };
    res.json(listAgents(workspace(res), filter));
  }));


function highRiskAgentCapabilities(permissions: readonly string[], tools: readonly string[], workspaceId: string): string[] {
  const sensitivePermissions = permissions.filter((permission) => {
    const sensitivity = permissionSensitivity(permission);
    return sensitivity === 'high' || sensitivity === 'unknown';
  });
  const highRiskTools = tools.filter((tool) => getTool(tool, workspaceId)?.risk === 'high');
  return [...sensitivePermissions.map((permission) => `permission:${permission}`), ...highRiskTools.map((tool) => `tool:${tool}`)];
}

  const createAgentSchema = z.object({
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(500),
    specialization: z.string().trim().min(1).max(60),
    skills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    tools: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    permissions: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    instructions: z.string().trim().max(4000).optional(),
    model: z.object({ provider: z.string().max(60).optional(), model: z.string().max(120).optional() }).strict().optional(),
  }).strict();

  router.post('/agents', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = createAgentSchema.parse(req.body ?? {});
    const spec = SPECIALIZATIONS.find((entry) => entry.id === body.specialization);
    const requestedPermissions = body.permissions ?? spec?.permissions ?? [];
    const requestedTools = body.tools ?? spec?.tools ?? [];
    const sensitive = highRiskAgentCapabilities(requestedPermissions, requestedTools, workspace(res));
    if (sensitive.length && roleRank(roleOf(res)) < roleRank('admin')) {
      res.status(403).json({ error: 'High-risk agent capabilities require an admin', code: 'HIGH_RISK_CAPABILITY_REQUIRES_ADMIN', capabilities: sensitive });
      return;
    }
    const agent = createAgent({ ...body, workspaceId: workspace(res), actor: actor(res), source: 'user' });
    res.status(201).json(agent);
  }));

  router.get('/agents/:id', asyncWrap((req, res) => {
    const agent = getAgent(workspace(res), param(req, 'id'));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(agent);
  }));

  router.get('/agents/:id/versions', asyncWrap((req, res) => {
    const agent = getAgent(workspace(res), param(req, 'id'));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(listAgentVersions(workspace(res), agent.id));
  }));

  const updateAgentSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.string().trim().min(1).max(500).optional(),
    skills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    tools: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    permissions: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    instructions: z.string().trim().max(4000).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    model: z.object({ provider: z.string().max(60).optional(), model: z.string().max(120).optional() }).strict().optional(),
  }).strict();

  router.patch('/agents/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = updateAgentSchema.parse(req.body ?? {});
    const sensitive = highRiskAgentCapabilities(body.permissions ?? [], body.tools ?? [], workspace(res));
    if (sensitive.length && roleRank(roleOf(res)) < roleRank('admin')) {
      res.status(403).json({ error: 'High-risk agent capabilities require an admin', code: 'HIGH_RISK_CAPABILITY_REQUIRES_ADMIN', capabilities: sensitive });
      return;
    }
    const agent = updateAgent(workspace(res), param(req, 'id'), body, actor(res));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(agent);
  }));

  router.delete('/agents/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const ok = deleteAgent(workspace(res), param(req, 'id'), actor(res));
    res.status(ok ? 204 : 404).end();
  }));

  /* ─── Missions / execution ─── */
  router.get('/missions', asyncWrap((_req, res) => {
    res.json(listMissions(workspace(res)));
  }));

  const createMissionSchema = z.object({
    objective: z.string().trim().min(3).max(4000),
    track: z.string().trim().min(1).max(40).optional(),
    execute: z.boolean().default(true),
  }).strict();

  router.post('/missions', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = createMissionSchema.parse(req.body ?? {});
    const missionId = createMission({ workspaceId: workspace(res), objective: body.objective, actor: actor(res), track: body.track, correlationId: correlation(res) });
    // Execute asynchronously by default; execute:false leaves the mission for a
    // durable worker or an explicit POST /missions/:id/execute.
    if (body.execute) void executeMission(missionId, actor(res)).catch((err) => logger.error({ err, missionId }, 'mission execution failed'));
    res.status(202).json(getMissionDetail(workspace(res), missionId));
  }));

  router.get('/missions/:id', asyncWrap((req, res) => {
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    res.json(detail);
  }));

  router.get('/missions/:id/verifications', asyncWrap((req, res) => {
    res.json(listVerifications(workspace(res), { missionId: param(req, 'id'), limit: 100 }));
  }));

  router.get('/verifications/:id', asyncWrap((req, res) => {
    const record = getVerification(workspace(res), param(req, 'id'));
    if (!record) { res.status(404).json({ error: 'Verification not found' }); return; }
    res.json(record);
  }));

  router.post('/missions/:id/execute', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    const body = z.object({ concurrency: z.number().int().min(1).max(8).optional() }).strict().parse(req.body ?? {});
    await executeMission(detail.id, actor(res), { concurrency: body.concurrency });
    res.json(getMissionDetail(workspace(res), detail.id));
  }));

  router.post('/missions/:id/tasks/:taskId/replan', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).strict().parse(req.body ?? {});
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    const task = detail.tasks.find((candidate) => candidate.id === param(req, 'taskId'));
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    const candidate = alternativeForTask({ tool: task.tool, toolInput: task.toolInput });
    if (!candidate) { res.status(409).json({ error: 'No implemented equivalent alternative exists', code: 'NO_IMPLEMENTED_ALTERNATIVE' }); return; }
    const transition = applyAdaptiveReplan({ workspaceId: workspace(res), missionId: detail.id, taskId: task.id, reason: body.reason, actor: actor(res) });
    res.status(transition.applied ? 200 : 409).json({ transition, mission: getMissionDetail(workspace(res), detail.id) });
  }));

  router.post('/missions/:id/pause', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const changed = pauseMission(workspace(res), param(req, 'id'), actor(res));
    if (!changed) { res.status(404).json({ error: 'Mission not found or not pausable' }); return; }
    res.json(getMissionDetail(workspace(res), param(req, 'id')));
  }));

  router.post('/missions/:id/resume', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const changed = resumeMission(workspace(res), param(req, 'id'), actor(res));
    if (!changed) { res.status(404).json({ error: 'Mission not found or not resumable' }); return; }
    await executeMission(param(req, 'id'), actor(res));
    res.json(getMissionDetail(workspace(res), param(req, 'id')));
  }));

  router.post('/missions/:id/cancel', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const changed = cancelMission(workspace(res), param(req, 'id'), actor(res));
    if (!changed) { res.status(404).json({ error: 'Mission not found or not cancellable' }); return; }
    res.json(getMissionDetail(workspace(res), param(req, 'id')));
  }));

  router.get('/missions/:id/leases', asyncWrap((req, res) => {
    res.json(listTaskLeases(workspace(res), param(req, 'id')));
  }));

  router.get('/tasks/:id/checkpoints', asyncWrap((req, res) => {
    res.json(listTaskCheckpoints(workspace(res), param(req, 'id')));
  }));

  /* ─── AI usage ledger (operator-facing) ─── */
  router.get('/usage', asyncWrap((req, res) => {
    const days = Math.min(Math.max(Number(req.query['days']) || 30, 1), 90);
    if (production) {
      // Deployment-level spend is operator data: requires the admin key.
      if (!ADMIN_API_KEY) { res.status(403).json({ error: 'Set ADMIN_API_KEY to expose the usage ledger in production' }); return; }
      const key = req.header('x-admin-key') ?? '';
      if (!key || !safeEqual(key, ADMIN_API_KEY)) { res.status(401).json({ error: 'x-admin-key required' }); return; }
    }
    res.json(getAiUsageSummary(days));
  }));

  /* ─── Self-built playbooks ─── */
  router.get('/playbooks', asyncWrap((_req, res) => {
    res.json(listPlaybooks(workspace(res)));
  }));

  router.delete('/playbooks/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const ok = deletePlaybook(workspace(res), param(req, 'id'), actor(res));
    res.status(ok ? 204 : 404).end();
  }));

  /* ─── Governance: approvals, autonomy policy, devices ─── */
  router.get('/benchmarks/domains', asyncWrap((_req, res) => {
    res.json(listScientificDomains());
  }));

  router.post('/benchmarks/run', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 5, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.json(await runBenchmarkSuite(workspace(res)));
  }));

  router.get('/benchmarks/runs', asyncWrap((req, res) => {
    res.json(listBenchmarkRuns(workspace(res), 20));
  }));

  router.get('/lessons', asyncWrap((req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'all';
    const allowed = new Set(['candidate', 'tested', 'promoted', 'rejected', 'revoked', 'all']);
    if (!allowed.has(status)) { res.status(400).json({ error: 'Invalid lesson status' }); return; }
    res.json(listLessons(workspace(res), { status: status as 'candidate' | 'tested' | 'promoted' | 'rejected' | 'revoked' | 'all', limit: 100 }));
  }));

  router.get('/lessons/:id', asyncWrap((req, res) => {
    const lesson = getLesson(workspace(res), param(req, 'id'));
    if (!lesson) { res.status(404).json({ error: 'Lesson not found' }); return; }
    res.json(lesson);
  }));

  router.post('/lessons/collect', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ missionId: z.string().trim().min(1).max(100) }).strict().parse(req.body ?? {});
    res.json(collectCandidateLessons(workspace(res), body.missionId, actor(res)));
  }));

  router.get('/lessons/:id/history', asyncWrap((req, res) => {
    const lesson = getLesson(workspace(res), param(req, 'id'));
    if (!lesson) { res.status(404).json({ error: 'Lesson not found' }); return; }
    res.json(listLessonEvents(workspace(res), lesson.id));
  }));

  router.post('/lessons/:id/evaluate', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.json(evaluateLesson(workspace(res), param(req, 'id'), actor(res)));
  }));

  router.post('/lessons/:id/promote', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.json(promoteLesson(workspace(res), param(req, 'id'), actor(res)));
  }));

  router.post('/lessons/:id/reject', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ reason: z.string().trim().max(500).optional().default('') }).strict().parse(req.body ?? {});
    res.json(rejectLesson(workspace(res), param(req, 'id'), actor(res), body.reason));
  }));

  router.post('/lessons/:id/revoke', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).strict().parse(req.body ?? {});
    res.json(revokeLesson(workspace(res), param(req, 'id'), actor(res), body.reason));
  }));

  router.post('/lessons/:id/outcomes', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      success: z.boolean(), missionId: z.string().trim().max(100).optional(), taskId: z.string().trim().max(100).optional(),
      evidence: z.unknown().optional(),
    }).strict().parse(req.body ?? {});
    res.json(recordLessonOutcome(workspace(res), param(req, 'id'), body, actor(res)));
  }));

  router.post('/problems/understand', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      objective: z.string().trim().min(1).max(4000),
      track: z.string().trim().min(1).max(40).optional(),
    }).strict().parse(req.body ?? {});
    res.json(understandProblem(body));
  }));

  router.get('/missions/:id/problem', asyncWrap((req, res) => {
    const profile = getProblemProfile(workspace(res), param(req, 'id'));
    if (!profile) { res.status(404).json({ error: 'Problem profile not found' }); return; }
    res.json(profile);
  }));

  router.get('/missions/:id/plans', asyncWrap((req, res) => {
    res.json(listPlanVersions(workspace(res), param(req, 'id')));
  }));

  router.post('/missions/:id/replan', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).strict().parse(req.body ?? {});
    const version = replanMission(workspace(res), param(req, 'id'), body.reason, actor(res));
    saveDecisionRecord({
      workspaceId: workspace(res), missionId: version.missionId, kind: 'replan',
      comparison: { version: version.version, strategy: version.strategy, plan: version.plan, comparison: version.comparison },
      reason: body.reason, actor: actor(res),
    });
    res.json(version);
  }));

  router.get('/settings/action-budget', asyncWrap((_req, res) => {
    res.json(getActionBudget(workspace(res)));
  }));

  router.get('/settings/execution-limits', asyncWrap((_req, res) => {
    res.json(getExecutionLimits(workspace(res)));
  }));

  router.post('/settings/execution-limits', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      maxConcurrentTasks: z.number().int().min(1).max(8).optional(),
      leaseTtlMs: z.number().int().min(1_000).max(600_000).optional(),
      maxAttempts: z.number().int().min(1).max(5).optional(),
    }).strict().parse(req.body ?? {});
    res.json(setExecutionLimits(workspace(res), body, actor(res)));
  }));

  router.post('/settings/action-budget', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      maxAmountUsd: z.number().finite().min(0).max(100_000_000).optional(),
      maxApprovalsPerMission: z.number().int().min(1).max(100).optional(),
      approvalTtlMinutes: z.number().int().min(1).max(10_080).optional(),
    }).strict().parse(req.body ?? {});
    res.json(setActionBudget(workspace(res), body, actor(res)));
  }));

  router.get('/approvals', asyncWrap((req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'pending';
    const allowed = new Set(['pending', 'approved', 'denied', 'all']);
    res.json(listApprovals(workspace(res), { status: (allowed.has(status) ? status : 'pending') as 'pending' | 'approved' | 'denied' | 'all', limit: 50 }));
  }));

  router.post('/approvals/:id/decide', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      decision: z.enum(['approved', 'denied']),
      note: z.string().trim().max(500).optional().default(''),
    }).strict().parse(req.body ?? {});
    try {
      const approval = getApproval(workspace(res), param(req, 'id'));
      if (!approval) { res.status(404).json({ error: 'Approval not found' }); return; }
      if (approval.risk === 'high' && roleRank(roleOf(res)) < roleRank('admin')) {
        res.status(403).json({ error: 'High-risk approvals require an admin', code: 'HIGH_RISK_APPROVAL_REQUIRES_ADMIN' });
        return;
      }
      const decided = decideApproval(workspace(res), param(req, 'id'), body.decision, body.note, actor(res));
      // Approving the gated action automatically resumes the waiting mission.
      if (decided.status === 'approved' && decided.missionId) {
        void executeMission(decided.missionId, actor(res)).catch((err) => logger.error({ err, missionId: decided.missionId }, 'mission resume after approval failed'));
      }
      res.status(200).json(decided);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل القرار' });
    }
  }));

  router.get('/settings/autonomy', asyncWrap((_req, res) => {
    res.json({ policy: getAutonomyPolicy(workspace(res)) });
  }));

  router.post('/settings/autonomy', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ policy: z.enum(['balanced', 'autopilot']) }).strict().parse(req.body ?? {});
    res.json({ policy: setAutonomyPolicy(workspace(res), body.policy, actor(res)) });
  }));

  router.get('/devices', asyncWrap((_req, res) => {
    res.json(listDevices(workspace(res)));
  }));

  router.post('/devices/:id/heartbeat', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ fingerprint: z.string().trim().min(4).max(128) }).strict().parse(req.body ?? {});
    try {
      res.json(deviceHeartbeat(param(req, 'id'), { fingerprint: body.fingerprint }));
    } catch (err) {
      const code = ((err as { code?: string }).code) ?? 'error';
      const status = code === 'revoked' ? 409 : code === 'not_paired' ? 409 : code === 'fingerprint' ? 403 : 404;
      res.status(status).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل نبض الجهاز' });
    }
  }));

  router.post('/devices/pair', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      name: z.string().trim().min(1).max(80),
      platform: z.string().trim().min(1).max(40),
    }).strict().parse(req.body ?? {});
    const { device, pairingCode } = requestDevicePairing(workspace(res), body, actor(res));
    // pairingCode is returned ONLY here, once; it is stored hashed and single-use.
    res.status(201).json({ ...device, pairingCode, note: 'احفظ الرمز الآن — لن يظهر مرة أخرى. أدخله في وكيل الجهاز المحلي لإتمام الاقتران.' });
  }));

  router.post('/devices/:id/redeem', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      code: z.string().trim().min(4).max(32),
      fingerprint: z.string().trim().min(4).max(128),
    }).strict().parse(req.body ?? {});
    try {
      res.json(redeemDevicePairing(workspace(res), { deviceId: param(req, 'id'), code: body.code, fingerprint: body.fingerprint }, actor(res), true));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إتمام الاقتران' });
    }
  }));

  router.post('/devices/:id/revoke', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    try {
      res.json(revokeDevice(workspace(res), param(req, 'id'), actor(res)));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'الجهاز غير موجود' });
    }
  }));

  /* ─── Optimization & simulation (real solvers) ─── */
  router.post('/optimize/employee-schedule', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      employees: z.array(z.object({
        id: z.string().min(1).max(60), name: z.string().min(1).max(120),
        hourlyCost: z.number().finite().min(0).max(100_000),
        availability: z.array(z.string().min(1).max(60)).max(50),
        maxAssignments: z.number().int().min(1).max(20).optional(),
      })).min(1).max(500),
      shifts: z.array(z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(120), demand: z.number().int().min(0).max(5000) })).min(1).max(100),
    }).strict().parse(req.body ?? {});
    const result = await solveEmployeeSchedule(body);
    res.status(result.feasible ? 200 : 422).json(result);
  }));

  router.post('/optimize/lp', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      sense: z.enum(['minimize', 'maximize']),
      objective: z.array(z.object({ var: z.string().min(1).max(60), coeff: z.number().finite() })).min(1),
      constraints: z.array(z.object({
        name: z.string().max(60).optional(),
        terms: z.array(z.object({ var: z.string().min(1).max(60), coeff: z.number().finite() })).min(1),
        op: z.enum(['<=', '>=', '=']),
        rhs: z.number().finite(),
      })).min(1),
      integerVars: z.array(z.string().min(1).max(60)).optional(),
      binaryVars: z.array(z.string().min(1).max(60)).optional(),
    }).strict().parse(req.body ?? {});
    res.json(await solveLp(body));
  }));

  router.post('/optimize/assignment', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      costMatrix: z.array(z.array(z.number().finite()).min(1)).min(1).max(200),
      rowLabels: z.array(z.string().max(120)).optional(),
      colLabels: z.array(z.string().max(120)).optional(),
    }).strict().parse(req.body ?? {});
    res.json(solveAssignment(body.costMatrix, body.rowLabels, body.colLabels));
  }));

  router.post('/simulate/monte-carlo', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      trials: z.number().int().min(100).max(100_000).default(10_000),
      seed: z.number().int().default(42),
      items: z.array(z.object({ name: z.string().min(1).max(120), optimistic: z.number().finite(), likely: z.number().finite(), pessimistic: z.number().finite() })).min(1).max(100),
    }).strict().parse(req.body ?? {});
    const result = await runTool('sim.monte_carlo', body, { workspaceId: workspace(res), actor: actor(res), permissions: new Set<string>() });
    res.status(result.ok ? 200 : 422).json(result);
  }));

  router.post('/decision/matrix', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      criteria: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), weight: z.number().finite().positive() })).min(1).max(30),
      alternatives: z.array(z.object({ name: z.string().min(1).max(120), scores: z.record(z.string(), z.number().finite().min(0).max(10)) })).min(2).max(50),
    }).strict().parse(req.body ?? {});
    const result = await runTool('decision.weighted_matrix', body, { workspaceId: workspace(res), actor: actor(res), permissions: new Set<string>() });
    res.status(result.ok ? 200 : 422).json(result);
  }));

  /* ─── Memory ─── */
  router.get('/memory', asyncWrap((req, res) => {
    const scope = typeof req.query['scope'] === 'string' ? req.query['scope'] as MemoryScope : undefined;
    const q = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 500) : undefined;
    const limit = Number(req.query['limit'] ?? 50);
    if (q) { res.json(searchMemories(workspace(res), q, { scope, limit, actor: actor(res) })); return; }
    res.json(listMemories(workspace(res), { scope: scope && MEMORY_SCOPES.includes(scope) ? scope : undefined, limit, actor: actor(res) }));
  }));

  router.get('/memory/:id/versions', asyncWrap((req, res) => {
    res.json(listMemoryVersions(workspace(res), param(req, 'id'), actor(res)));
  }));

  router.post('/memory', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      scope: z.enum(MEMORY_SCOPES),
      scopeId: z.string().trim().max(120).optional(),
      content: z.string().trim().min(1).max(20_000),
      tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
      visibility: z.enum(['workspace', 'owner']).optional(),
      ttlDays: z.number().int().min(1).max(3650).nullish(),
    }).strict().parse(req.body ?? {});
    res.status(201).json(addMemory({ workspaceId: workspace(res), scope: body.scope, scopeId: body.scopeId, content: body.content, tags: body.tags, provenance: 'user', actor: actor(res), visibility: body.visibility, ttlDays: body.ttlDays ?? null }));
  }));

  router.delete('/memory/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.status(deleteMemory(workspace(res), param(req, 'id'), actor(res)) ? 204 : 404).end();
  }));

  /* ─── Organizations ─── */
  router.get('/organizations', asyncWrap((_req, res) => {
    res.json(listOrganizations(workspace(res)));
  }));

  router.post('/organizations', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      objective: z.string().trim().min(10).max(4000),
      name: z.string().trim().min(1).max(120).optional(),
    }).strict().parse(req.body ?? {});
    res.status(201).json(await buildOrganization({ workspaceId: workspace(res), objective: body.objective, name: body.name, actor: actor(res) }));
  }));

  /* ─── Audit & artifacts ─── */
  router.get('/audit', asyncWrap((req, res) => {
    const limit = Math.min(Math.max(Number(req.query['limit'] ?? 50) || 50, 1), 200);
    const rows = getOsDb().prepare('SELECT id, actor, action, subject, detail, created_at FROM os_audit WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspace(res), limit) as Array<Record<string, string>>;
    res.json(redactSecrets(rows.map((r) => ({ id: r['id'], actor: r['actor'], action: r['action'], subject: r['subject'], detail: parseJson(r['detail'] as string, {}), createdAt: r['created_at'] }))).value);
  }));

  router.get('/artifacts/:id', asyncWrap((req, res) => {
    const row = getOsDb().prepare('SELECT * FROM os_artifacts WHERE workspace_id = ? AND id = ?').get(workspace(res), param(req, 'id')) as Record<string, string> | undefined;
    if (!row) { res.status(404).json({ error: 'Artifact not found' }); return; }
    res.json(redactSecrets({ id: row['id'], missionId: row['mission_id'], name: row['name'], kind: row['kind'], content: row['content'], createdAt: row['created_at'] }).value);
  }));

  router.get('/handoffs', asyncWrap((req, res) => {
    const missionId = typeof req.query['missionId'] === 'string' ? req.query['missionId'] : null;
    if (!missionId) { res.status(400).json({ error: 'missionId query parameter is required' }); return; }
    const scoped = getOsDb().prepare('SELECT h.* FROM os_handoffs h JOIN os_missions m ON m.id = h.mission_id WHERE m.workspace_id = ? AND h.mission_id = ? ORDER BY h.created_at ASC').all(workspace(res), missionId) as Array<Record<string, string>>;
    res.json(scoped.map((h) => ({ id: h['id'], taskId: h['task_id'], from: h['from_specialization'], to: h['to_specialization'], contract: parseJson(h['contract'] as string, {}), createdAt: h['created_at'] })));
  }));

  /* ─── Project OS board (durable, workspace-scoped) ─── */
  router.get('/board', asyncWrap((_req, res) => {
    res.json(getBoard(workspace(res)) ?? { state: null, updatedAt: null });
  }));

  router.put('/board', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ state: z.record(z.string(), z.unknown()) }).strict().parse(req.body ?? {});
    try {
      res.json(putBoard(workspace(res), body.state, actor(res)));
    } catch (err) {
      res.status(413).json({ error: err instanceof Error ? err.message : 'Board rejected' });
    }
  }));

  router.delete('/board', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    clearBoard(workspace(res), actor(res));
    res.status(204).end();
  }));

  /* ─── Digital twins ─── */
  const driverSchema = z.object({
    name: z.string().trim().min(1).max(120),
    optimistic: z.number().finite(),
    likely: z.number().finite(),
    pessimistic: z.number().finite(),
  }).strict();
  const kpiSchema = z.object({
    id: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(120),
    unit: z.string().trim().max(30).optional().default(''),
    target: z.number().finite().optional(),
  }).strict();

  router.get('/twins', asyncWrap((_req, res) => {
    res.json(listTwins(workspace(res)));
  }));

  router.post('/twins', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      entityType: z.string().trim().min(1).max(60).optional().default('custom'),
      drivers: z.array(driverSchema).min(1).max(50),
      kpis: z.array(kpiSchema).max(30).optional(),
      notes: z.string().trim().max(2000).optional(),
    }).strict().parse(req.body ?? {});
    try {
      res.status(201).json(createTwin({ ...body, kpis: body.kpis as TwinKpi[] | undefined, drivers: body.drivers as TwinDriver[], workspaceId: workspace(res), actor: actor(res) }));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إنشاء التوأم الرقمي' });
    }
  }));

  router.get('/twins/:id', asyncWrap((req, res) => {
    const twin = getTwin(workspace(res), param(req, 'id'));
    if (!twin) { res.status(404).json({ error: 'Twin not found' }); return; }
    res.json(twin);
  }));

  router.delete('/twins/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.status(deleteTwin(workspace(res), param(req, 'id'), actor(res)) ? 204 : 404).end();
  }));

  router.post('/twins/:id/observations', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ payload: z.record(z.string(), z.unknown()) }).strict().parse(req.body ?? {});
    const entry = recordObservation(workspace(res), param(req, 'id'), body.payload, actor(res));
    if (!entry) { res.status(404).json({ error: 'Twin not found' }); return; }
    res.status(201).json(entry);
  }));

  router.post('/twins/:id/scenario', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      adjustments: z.array(z.object({
        driver: z.string().trim().min(1).max(120),
        op: z.enum(['mul', 'add']),
        value: z.number().finite(),
      })).min(1).max(50),
      trials: z.number().int().min(100).max(50_000).optional(),
      seed: z.number().int().optional(),
    }).strict().parse(req.body ?? {});
    try {
      res.json(await runScenario(workspace(res), param(req, 'id'), { ...body, actor: actor(res) }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تشغيل السيناريو';
      res.status(message === 'Twin not found' ? 404 : 422).json({ error: message });
    }
  }));

  /* ─── Workspace roles (RBAC) ─── */
  router.get('/roles', asyncWrap((_req, res) => {
    res.json({ me: { userId: actor(res), role: roleOf(res) }, members: listWorkspaceRoles(workspace(res)) });
  }));

  router.post('/roles', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ userId: z.string().trim().min(1).max(120), role: z.enum(['owner', 'admin', 'member', 'viewer']) }).strict().parse(req.body ?? {});
    try {
      res.json(setWorkspaceRole(workspace(res), body.userId, body.role, actor(res)));
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'تعذر تحديث الدور' });
    }
  }));

  router.delete('/roles/:userId', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20, req.path)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    try {
      res.status(removeWorkspaceRole(workspace(res), param(req, 'userId'), actor(res)) ? 204 : 404).end();
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'تعذر إزالة الدور' });
    }
  }));

  /* ─── Extensions: skills, plugins, marketplaces, MCP, capabilities ─── */
  router.use('/extensions', createExtensionsRouter());

  /* ─── Error handling: zod → 400 JSON, never a stack trace ─── */
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        issues: err.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
      });
      return;
    }
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'Malformed JSON body' }); return; }
    logger.error({ err }, 'os router error');
    res.status(500).json({ error: 'Internal OS router error' });
  });

  return router;
}
