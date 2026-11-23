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
import { isProductionEnv, sanitizeEnv } from '../lib/config.js';
import { getOsDb, parseJson } from './db.js';
import { getAiUsageSummary } from './usage.js';
import { listPlaybooks, deletePlaybook } from './playbooks.js';
import { listTools, runTool, getTool } from './tools.js';
import { SPECIALIZATIONS } from './specializations.js';
import {
  createAgent, listAgents, getAgent, updateAgent, deleteAgent, ensureSeedAgents,
} from './registry.js';
import {
  createMission, executeMission, getMissionDetail, listMissions, getOsState, markInterruptedMissions,
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
  getAutonomyPolicy, setAutonomyPolicy, listApprovals, decideApproval,
  requestDevicePairing, redeemDevicePairing, revokeDevice, listDevices, deviceHeartbeat, findDeviceById,
} from './governance.js';
import { logger } from '../lib/logger.js';

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
function rateLimit(workspaceId: string, limit = 60): boolean {
  const now = Date.now();
  const bucket = buckets.get(workspaceId);
  if (!bucket || bucket.resetAt < now) { buckets.set(workspaceId, { count: 1, resetAt: now + 60_000 }); return true; }
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
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

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
  const roleOf = (res: Response) => (res.locals['role'] as WorkspaceRole) ?? 'viewer';

  // Interrupted-mission recovery runs once per process boot (idempotent).
  try { markInterruptedMissions(); } catch (err) { logger.warn({ err }, 'interrupted-mission recovery failed'); }

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

  router.get('/tools', asyncWrap((_req, res) => {
    res.json(listTools());
  }));

  router.post('/tools/:id/execute', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const tool = getTool(param(req, 'id'));
    if (!tool) { res.status(404).json({ error: 'Unknown tool' }); return; }
    if (tool.risk === 'high') { res.status(403).json({ error: 'High-risk tools execute only through the orchestrator under agent permissions' }); return; }
    const body = z.object({ input: z.unknown().optional() }).strict().parse(req.body ?? {});
    const result = await runTool(tool.id, body.input ?? {}, {
      workspaceId: workspace(res),
      actor: actor(res),
      permissions: new Set(['*']),
    });
    res.status(result.ok ? 200 : 422).json(result);
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
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = createAgentSchema.parse(req.body ?? {});
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
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = updateAgentSchema.parse(req.body ?? {});
    const agent = updateAgent(workspace(res), param(req, 'id'), body, actor(res));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(agent);
  }));

  router.delete('/agents/:id', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
  }).strict();

  router.post('/missions', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = createMissionSchema.parse(req.body ?? {});
    const missionId = createMission({ workspaceId: workspace(res), objective: body.objective, actor: actor(res), track: body.track });
    // Execute asynchronously; the client polls GET /missions/:id for lifecycle updates.
    void executeMission(missionId, actor(res)).catch((err) => logger.error({ err, missionId }, 'mission execution failed'));
    res.status(202).json(getMissionDetail(workspace(res), missionId));
  }));

  router.get('/missions/:id', asyncWrap((req, res) => {
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    res.json(detail);
  }));

  router.post('/missions/:id/execute', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const detail = getMissionDetail(workspace(res), param(req, 'id'));
    if (!detail) { res.status(404).json({ error: 'Mission not found' }); return; }
    await executeMission(detail.id, actor(res));
    res.json(getMissionDetail(workspace(res), detail.id));
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
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const ok = deletePlaybook(workspace(res), param(req, 'id'), actor(res));
    res.status(ok ? 204 : 404).end();
  }));

  /* ─── Governance: approvals, autonomy policy, devices ─── */
  router.get('/approvals', asyncWrap((req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'pending';
    const allowed = new Set(['pending', 'approved', 'denied', 'all']);
    res.json(listApprovals(workspace(res), { status: (allowed.has(status) ? status : 'pending') as 'pending' | 'approved' | 'denied' | 'all', limit: 50 }));
  }));

  router.post('/approvals/:id/decide', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      decision: z.enum(['approved', 'denied']),
      note: z.string().trim().max(500).optional().default(''),
    }).strict().parse(req.body ?? {});
    try {
      const approval = decideApproval(workspace(res), param(req, 'id'), body.decision, body.note, actor(res));
      // Approving the gated action automatically resumes the waiting mission.
      if (approval.status === 'approved' && approval.missionId) {
        void executeMission(approval.missionId, actor(res)).catch((err) => logger.error({ err, missionId: approval.missionId }, 'mission resume after approval failed'));
      }
      res.status(200).json(approval);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تسجيل القرار' });
    }
  }));

  router.get('/settings/autonomy', asyncWrap((_req, res) => {
    res.json({ policy: getAutonomyPolicy(workspace(res)) });
  }));

  router.post('/settings/autonomy', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ policy: z.enum(['balanced', 'autopilot']) }).strict().parse(req.body ?? {});
    res.json({ policy: setAutonomyPolicy(workspace(res), body.policy, actor(res)) });
  }));

  router.get('/devices', asyncWrap((_req, res) => {
    res.json(listDevices(workspace(res)));
  }));

  router.post('/devices/:id/heartbeat', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      name: z.string().trim().min(1).max(80),
      platform: z.string().trim().min(1).max(40),
    }).strict().parse(req.body ?? {});
    const { device, pairingCode } = requestDevicePairing(workspace(res), body, actor(res));
    // pairingCode is returned ONLY here, once; it is stored hashed and single-use.
    res.status(201).json({ ...device, pairingCode, note: 'احفظ الرمز الآن — لن يظهر مرة أخرى. أدخله في وكيل الجهاز المحلي لإتمام الاقتران.' });
  }));

  router.post('/devices/:id/redeem', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    try {
      res.json(revokeDevice(workspace(res), param(req, 'id'), actor(res)));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'الجهاز غير موجود' });
    }
  }));

  /* ─── Optimization & simulation (real solvers) ─── */
  router.post('/optimize/employee-schedule', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      costMatrix: z.array(z.array(z.number().finite()).min(1)).min(1).max(200),
      rowLabels: z.array(z.string().max(120)).optional(),
      colLabels: z.array(z.string().max(120)).optional(),
    }).strict().parse(req.body ?? {});
    res.json(solveAssignment(body.costMatrix, body.rowLabels, body.colLabels));
  }));

  router.post('/simulate/monte-carlo', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      trials: z.number().int().min(100).max(100_000).default(10_000),
      seed: z.number().int().default(42),
      items: z.array(z.object({ name: z.string().min(1).max(120), optimistic: z.number().finite(), likely: z.number().finite(), pessimistic: z.number().finite() })).min(1).max(100),
    }).strict().parse(req.body ?? {});
    const result = await runTool('sim.monte_carlo', body, { workspaceId: workspace(res), actor: actor(res), permissions: new Set(['*']) });
    res.status(result.ok ? 200 : 422).json(result);
  }));

  router.post('/decision/matrix', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({
      criteria: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), weight: z.number().finite().positive() })).min(1).max(30),
      alternatives: z.array(z.object({ name: z.string().min(1).max(120), scores: z.record(z.string(), z.number().finite().min(0).max(10)) })).min(2).max(50),
    }).strict().parse(req.body ?? {});
    const result = await runTool('decision.weighted_matrix', body, { workspaceId: workspace(res), actor: actor(res), permissions: new Set(['*']) });
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
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res))) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.status(deleteMemory(workspace(res), param(req, 'id'), actor(res)) ? 204 : 404).end();
  }));

  /* ─── Organizations ─── */
  router.get('/organizations', asyncWrap((_req, res) => {
    res.json(listOrganizations(workspace(res)));
  }));

  router.post('/organizations', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    res.json(rows.map((r) => ({ id: r['id'], actor: r['actor'], action: r['action'], subject: r['subject'], detail: parseJson(r['detail'] as string, {}), createdAt: r['created_at'] })));
  }));

  router.get('/artifacts/:id', asyncWrap((req, res) => {
    const row = getOsDb().prepare('SELECT * FROM os_artifacts WHERE workspace_id = ? AND id = ?').get(workspace(res), param(req, 'id')) as Record<string, string> | undefined;
    if (!row) { res.status(404).json({ error: 'Artifact not found' }); return; }
    res.json({ id: row['id'], missionId: row['mission_id'], name: row['name'], kind: row['kind'], content: row['content'], createdAt: row['created_at'] });
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
    if (!rateLimit(workspace(res), 60)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ state: z.record(z.string(), z.unknown()) }).strict().parse(req.body ?? {});
    try {
      res.json(putBoard(workspace(res), body.state, actor(res)));
    } catch (err) {
      res.status(413).json({ error: err instanceof Error ? err.message : 'Board rejected' });
    }
  }));

  router.delete('/board', asyncWrap((_req, res) => {
    if (!rateLimit(workspace(res), 10)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 30)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 20)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    res.status(deleteTwin(workspace(res), param(req, 'id'), actor(res)) ? 204 : 404).end();
  }));

  router.post('/twins/:id/observations', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 60)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ payload: z.record(z.string(), z.unknown()) }).strict().parse(req.body ?? {});
    const entry = recordObservation(workspace(res), param(req, 'id'), body.payload, actor(res));
    if (!entry) { res.status(404).json({ error: 'Twin not found' }); return; }
    res.status(201).json(entry);
  }));

  router.post('/twins/:id/scenario', asyncWrap(async (req, res) => {
    if (!rateLimit(workspace(res), 20)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
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
    if (!rateLimit(workspace(res), 20)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    const body = z.object({ userId: z.string().trim().min(1).max(120), role: z.enum(['owner', 'admin', 'member', 'viewer']) }).strict().parse(req.body ?? {});
    try {
      res.json(setWorkspaceRole(workspace(res), body.userId, body.role, actor(res)));
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'تعذر تحديث الدور' });
    }
  }));

  router.delete('/roles/:userId', asyncWrap((req, res) => {
    if (!rateLimit(workspace(res), 20)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
    try {
      res.status(removeWorkspaceRole(workspace(res), param(req, 'userId'), actor(res)) ? 204 : 404).end();
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'تعذر إزالة الدور' });
    }
  }));

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
