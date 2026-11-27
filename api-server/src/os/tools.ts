/**
 * WORA OS — unified tool registry & execution interface.
 *
 * Every tool exposes identity, description, a JSON-schema-shaped input
 * contract, a risk level, a required permission, an execution environment,
 * a timeout and a single async execute(). Agents and the orchestrator reach
 * the outside world ONLY through this registry. Results are structured;
 * errors are normalized; every execution is auditable.
 */
import { repairRepository } from './code-repair.js';
import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import { closeSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOsDb, audit, newId, nowIso } from './db.js';
import { openWorkspaceFile, resolveInWorkspace, workspacePath } from './workspace.js';
import { safeFetch } from '../lib/safe-fetch.js';
import { solveAssignment, solveEmployeeSchedule, solveLp, type LpModel } from './ortools.js';
import { solveShortestPath, type GraphModel } from './graph.js';
import { solveMaxFlow, solveMinCostFlow, solveBipartiteMatching, type MaxFlowModel, type MinCostFlowModel, type BipartiteModel } from './network-flow.js';
import { solveTsp, solveVrp, type TspModel, type VrpModel } from './routing.js';
import { solvePareto, type ParetoModel } from './multi-objective.js';
import { solveBayes, type BayesModel } from './bayesian.js';
import { simulatePert, simulateQueue, type QueueModel } from './simulation.js';
import { solveScenarios, type ScenarioModel } from './simulation-advanced.js';
import { FORMULATION_KINDS, formulateScientificProblem, type FormulationKind } from './scientific-formulation.js';
import { PROBLEM_KINDS, selectAlgorithm, algorithmSelectionInputSchema } from './algorithms.js';
import { classifyAction } from './actions.js';
import { understandProblem } from './problem.js';
import { selectScientificMethod } from './science.js';
import { getApproval, consumeApproval, payloadDigest, actionScope, isApprovalExpired } from './governance.js';
import { financialIntent } from '../runtime/financial.js';
import type { SemanticContract } from './semantic-contracts.js';

const execFileAsync = promisify(execFile);

export type ToolRisk = 'low' | 'medium' | 'high';

export interface ToolContext {
  workspaceId: string;
  /** The executing agent's name, used for agent-level audit and attribution. */
  actor: string;
  /** The authenticated user who initiated the mission. Never set from tool input. */
  requestedBy?: string;
  permissions: Set<string>;
  /** When present, the tool must be explicitly enabled for the executing agent. */
  toolAllowlist?: ReadonlySet<string>;
  /** Aborted by runTool on timeout; plugin and network tools must honor it. */
  signal?: AbortSignal;
  missionId?: string;
  taskId?: string;
  /** The orchestrator's classification for this action; class C always needs a consumed approval. */
  actionClass?: 'A' | 'B' | 'C';
  /** True only after the orchestrator validated and consumed a class C financial approval for this exact action. */
  financialApproved?: boolean;
  /** Set only after a class C approval was consumed by the orchestrator. */
  approvedAction?: { approvalId: string; payloadDigest: string; scope: string };
  correlationId?: string;
  /** Untrusted, approved skill knowledge selected for this task. Never authority. */
  skillContext?: {
    digest: string; tokensUsed: number; tokenBudget: number;
    governance: string; text: string; policy: Record<string, unknown>;
    selected: Array<{ key: string; version: string; instructionDigest: string; scope: string; scopeId: string; score: number }>;
  };
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: z.ZodTypeAny;
  permission: string | null;
  /** Additional permissions a plugin tool requires; all of them must be held. */
  permissions?: string[];
  risk: ToolRisk;
  environment: 'host';
  source?: 'core' | 'plugin';
  pluginId?: string;
  timeoutMs: number;
  /** True only when repeating the tool after an uncertain interruption is safe. */
  idempotent?: boolean;
  /** Runtime risk refinement for inputs that can become class C (for example a financial browser click). */
  riskForInput?: (input: unknown) => { risk: ToolRisk; spendsMoney?: boolean; amountUsd?: number; reason?: string };
  /** Machine-readable meaning/units/side effects used for semantic fallback checks. */
  semanticContract?: SemanticContract;
  // `any` because tools are stored heterogeneously; runTool validates via `schema` before invoking.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(input: any, ctx: ToolContext): unknown | Promise<unknown>;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  code?: string;
  durationMs: number;
  tool: string;
}

/* ─── system.diagnostics ───────────────────────────────── */
const diagnosticsSchema = z.object({}).strict();

const diagnosticsTool: ToolDefinition = {
  id: 'system.diagnostics',
  name: 'Host Diagnostics',
  description: 'Reads real host health signals: CPU count, load, memory pressure, disk path availability, platform, Node runtime and uptime. Never fabricates device state.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: diagnosticsSchema,
  permission: 'host:read',
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(_input: z.infer<typeof diagnosticsSchema>, ctx) {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10;
    const load = os.loadavg();
    const cpus = os.cpus();
    const disk = (() => {
      try {
        const root = path.parse(process.cwd()).root;
        const s = statSync(root);
        return { checked: root, readable: s.isDirectory(), note: 'statSync check only; byte-level capacity requires statfs(2), not available portably' };
      } catch (err) {
        return { checked: null, readable: false, note: String(err) };
      }
    })();
    const findings: string[] = [];
    if (usedPct > 90) findings.push(`Memory pressure high: ${usedPct}% used`);
    if (load[0]! > cpus.length) findings.push(`Load average (${load.map((v) => v.toFixed(2)).join(', ')}) exceeds CPU count (${cpus.length})`);
    if (freeMem < 512 * 1024 * 1024) findings.push('Less than 512 MB free memory');
    const report = {
      host: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpus: cpus.length,
      cpuModel: cpus[0]?.model ?? 'unknown',
      loadAverage: load,
      memory: { totalMB: Math.round(totalMem / 1048576), freeMB: Math.round(freeMem / 1048576), usedPercent: usedPct, processRSSMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576) },
      uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
      nodeVersion: process.version,
      pid: process.pid,
      disk,
      findings,
      verdict: findings.length === 0 ? 'No critical host problems detected by the available checks.' : `${findings.length} potential problem(s) detected — see findings.`,
      scope: 'diagnostics ran on the machine executing the WORA API/runtime. Inspecting the end-user device requires the Local Device Agent, which is not connected.',
    };
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.execute', subject: 'system.diagnostics', detail: { findings: findings.length } });
    return report;
  },
};

/* ─── fs.workspace_list / fs.workspace_read ────────────── */
const workspaceListSchema = z.object({ dir: z.string().max(500).optional() }).strict();

const workspaceListTool: ToolDefinition = {
  id: 'fs.workspace_list',
  name: 'List Workspace Files',
  description: 'Lists files and directories inside the sandboxed WORA workspace for this workspace.',
  inputSchema: { type: 'object', properties: { dir: { type: 'string' } }, additionalProperties: false },
  schema: workspaceListSchema,
  permission: 'workspace:read',
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof workspaceListSchema>, ctx) {
    const dir = resolveInWorkspace(ctx.workspaceId, input.dir ?? '.');
    const entries = readdirSync(dir, { withFileTypes: true }).slice(0, 500).map((entry) => {
      const full = path.join(dir, entry.name);
      let size: number | null = null;
      try { size = entry.isFile() ? statSync(full).size : null; } catch { size = null; }
      return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size };
    });
    return { dir: path.relative(workspacePath(ctx.workspaceId), dir) || '.', entries, count: entries.length };
  },
};

const workspaceReadSchema = z.object({ path: z.string().min(1).max(500), maxBytes: z.number().int().positive().max(1_000_000).optional() }).strict();

const workspaceReadTool: ToolDefinition = {
  id: 'fs.workspace_read',
  name: 'Read Workspace File',
  description: 'Reads a UTF-8 file inside the sandboxed WORA workspace (size-capped).',
  inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'], additionalProperties: false },
  schema: workspaceReadSchema,
  permission: 'workspace:read',
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof workspaceReadSchema>, ctx) {
    const cap = input.maxBytes ?? 200_000;
    const opened = openWorkspaceFile(ctx.workspaceId, input.path, 'read');
    let raw: Buffer;
    try { raw = readFileSync(opened.fd); } finally { closeSync(opened.fd); }
    const truncated = raw.byteLength > cap;
    return { path: path.relative(workspacePath(ctx.workspaceId), opened.path), bytes: raw.byteLength, truncated, content: raw.subarray(0, cap).toString('utf8') };
  },
};

/* ─── or.* solvers ─────────────────────────────────────── */
const assignmentModelSchema = z.object({
  costMatrix: z.array(z.array(z.number().finite()).min(1)).min(1).max(200),
  rowLabels: z.array(z.string().max(120)).optional(),
  colLabels: z.array(z.string().max(120)).optional(),
}).strict();

const assignmentSchema = z.object({
  model: assignmentModelSchema.optional(),
  costMatrix: z.array(z.array(z.number().finite()).min(1)).min(1).max(200).optional(),
  rowLabels: z.array(z.string().max(120)).optional(),
  colLabels: z.array(z.string().max(120)).optional(),
}).strict().refine((input) => Boolean(input.model || input.costMatrix), { message: 'Provide a model or costMatrix' });

const assignmentTool: ToolDefinition = {
  id: 'or.assignment',
  name: 'Assignment Solver (Hungarian)',
  description: 'Solves balanced rectangular assignment problems to optimality with the Hungarian algorithm.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, costMatrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, rowLabels: { type: 'array', items: { type: 'string' } }, colLabels: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  schema: assignmentSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof assignmentSchema>) {
    const resolved = input.model ?? { costMatrix: input.costMatrix!, rowLabels: input.rowLabels, colLabels: input.colLabels };
    return solveAssignment(resolved.costMatrix, resolved.rowLabels, resolved.colLabels);
  },
};

const employeeModelSchema = z.object({
  employees: z.array(z.object({
    id: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    hourlyCost: z.number().finite().min(0).max(100_000),
    availability: z.array(z.string().min(1).max(60)).max(50),
    maxAssignments: z.number().int().min(1).max(20).optional(),
  })).min(1).max(500),
  shifts: z.array(z.object({
    id: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    demand: z.number().int().min(0).max(5000),
  })).min(1).max(100),
}).strict();

const employeeSchema = z.object({
  model: employeeModelSchema.optional(),
  employees: z.array(z.object({
    id: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    hourlyCost: z.number().finite().min(0).max(100_000),
    availability: z.array(z.string().min(1).max(60)).max(50),
    maxAssignments: z.number().int().min(1).max(20).optional(),
  })).min(1).max(500).optional(),
  shifts: z.array(z.object({
    id: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    demand: z.number().int().min(0).max(5000),
  })).min(1).max(100).optional(),
}).strict().refine((input) => Boolean(input.model || (input.employees && input.shifts)), { message: 'Provide a model or employees and shifts' });

const employeeTool: ToolDefinition = {
  id: 'or.employee_schedule',
  name: 'Employee Shift Scheduler (HiGHS MIP)',
  description: 'Minimizes labor cost assigning employees to shifts under availability, demand and workload constraints. Returns the schedule, cost and an independent constraint validation.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, employees: { type: 'array' }, shifts: { type: 'array' } }, additionalProperties: false },
  schema: employeeSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  async execute(input: z.infer<typeof employeeSchema>) {
    const resolved = input.model ?? { employees: input.employees!, shifts: input.shifts! };
    return solveEmployeeSchedule(resolved);
  },
};

const lpModelSchema = z.object({
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
  bounds: z.record(z.string(), z.object({ lower: z.number().finite().optional(), upper: z.number().finite().optional() })).optional(),
}).strict();

const lpSchema = z.object({
  model: lpModelSchema.optional(),
  sense: z.enum(['minimize', 'maximize']).optional(),
  objective: z.array(z.object({ var: z.string().min(1).max(60), coeff: z.number().finite() })).min(1).optional(),
  constraints: z.array(z.object({
    name: z.string().max(60).optional(),
    terms: z.array(z.object({ var: z.string().min(1).max(60), coeff: z.number().finite() })).min(1),
    op: z.enum(['<=', '>=', '=']),
    rhs: z.number().finite(),
  })).min(1).optional(),
  integerVars: z.array(z.string().min(1).max(60)).optional(),
  binaryVars: z.array(z.string().min(1).max(60)).optional(),
  bounds: z.record(z.string(), z.object({ lower: z.number().finite().optional(), upper: z.number().finite().optional() })).optional(),
}).strict().refine((input) => Boolean(input.model || (input.sense && input.objective && input.constraints)), {
  message: 'Provide a complete model or sense, objective and constraints',
});

const lpTool: ToolDefinition = {
  id: 'or.solve_lp',
  name: 'LP / MIP Solver (HiGHS)',
  description: 'Solves linear and mixed-integer linear programs from a structured model (objective, constraints, bounds). Returns an independent constraint/objective/bounds verification alongside the HiGHS result.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, sense: { enum: ['minimize', 'maximize'] }, objective: { type: 'array' }, constraints: { type: 'array' }, integerVars: { type: 'array', items: { type: 'string' } }, binaryVars: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  schema: lpSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  async execute(input: z.infer<typeof lpSchema>) {
    const model: LpModel = input.model ?? {
      sense: input.sense!, objective: input.objective!, constraints: input.constraints!,
      ...(input.integerVars ? { integerVars: input.integerVars } : {}),
      ...(input.binaryVars ? { binaryVars: input.binaryVars } : {}),
      ...(input.bounds ? { bounds: input.bounds } : {}),
    };
    return solveLp(model);
  },
};

const graphEdgeSchema = z.object({ from: z.string().min(1).max(120), to: z.string().min(1).max(120), weight: z.number().finite(), id: z.string().max(160).optional() }).strict();
const graphSchema = z.object({
  model: z.object({
    nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
    edges: z.array(graphEdgeSchema).min(1).max(5_000),
    start: z.string().min(1).max(120),
    goal: z.string().min(1).max(120),
    directed: z.boolean().optional(),
    heuristic: z.record(z.string(), z.number().finite().min(0)).optional(),
    algorithm: z.enum(['auto', 'dijkstra', 'a_star']).optional(),
  }).strict().optional(),
  nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
  edges: z.array(graphEdgeSchema).min(1).max(5_000).optional(),
  start: z.string().min(1).max(120).optional(),
  goal: z.string().min(1).max(120).optional(),
  directed: z.boolean().optional(),
  heuristic: z.record(z.string(), z.number().finite().min(0)).optional(),
  algorithm: z.enum(['auto', 'dijkstra', 'a_star']).optional(),
}).strict().refine((input) => Boolean(input.model || (input.edges && input.start && input.goal)), { message: 'Provide a complete model or edges, start and goal' });

const shortestPathTool: ToolDefinition = {
  id: 'graph.shortest_path',
  name: 'Shortest Path (Dijkstra / A*)',
  description: 'Finds a minimum-weight path in an explicit weighted graph using Dijkstra or A*. Rejects negative weights and verifies A* against an independent Dijkstra baseline.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, nodes: { type: 'array' }, edges: { type: 'array' }, start: { type: 'string' }, goal: { type: 'string' }, directed: { type: 'boolean' }, heuristic: { type: 'object' }, algorithm: { enum: ['auto', 'dijkstra', 'a_star'] } }, additionalProperties: false },
  schema: graphSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof graphSchema>) {
    const model: GraphModel = input.model ?? {
      ...(input.nodes ? { nodes: input.nodes } : {}), edges: input.edges!, start: input.start!, goal: input.goal!,
      ...(input.directed !== undefined ? { directed: input.directed } : {}),
      ...(input.heuristic ? { heuristic: input.heuristic } : {}),
      ...(input.algorithm ? { algorithm: input.algorithm } : {}),
    };
    return solveShortestPath(model);
  },
};

const formulateSchema = z.object({
  kind: z.enum(FORMULATION_KINDS),
  model: z.unknown().optional(),
  objective: z.string().max(4_000).optional(),
}).strict();

const formulateTool: ToolDefinition = {
  id: 'meta.formulate_scientific_problem',
  name: 'Scientific Problem Formulation',
  description: 'Builds an explicit, inspectable formulation (variables, data, objective, constraints, assumptions, solver, outputs and verification) for a supported scientific problem. It does not invent missing numeric inputs.',
  inputSchema: { type: 'object', properties: { kind: { enum: [...FORMULATION_KINDS] }, model: { type: 'object' }, objective: { type: 'string' } }, required: ['kind'], additionalProperties: false },
  schema: formulateSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof formulateSchema>) {
    return formulateScientificProblem({ kind: input.kind as FormulationKind, model: input.model, objective: input.objective });
  },
};

/* ─── sim.monte_carlo ──────────────────────────────────── */
const monteCarloModelSchema = z.object({
  trials: z.number().int().min(100).max(100_000).default(10_000),
  seed: z.number().int().default(42),
  items: z.array(z.object({
    name: z.string().min(1).max(120),
    optimistic: z.number().finite(),
    likely: z.number().finite(),
    pessimistic: z.number().finite(),
  })).min(1).max(100),
}).strict();

const monteCarloSchema = z.object({
  model: monteCarloModelSchema.optional(),
  trials: z.number().int().min(100).max(100_000).optional(),
  seed: z.number().int().optional(),
  items: z.array(z.object({
    name: z.string().min(1).max(120),
    optimistic: z.number().finite(),
    likely: z.number().finite(),
    pessimistic: z.number().finite(),
  })).min(1).max(100).optional(),
}).strict().refine((input) => Boolean(input.model || input.items), { message: 'Provide a model or items' });

const monteCarloTool: ToolDefinition = {
  id: 'sim.monte_carlo',
  name: 'Monte Carlo PERT Simulation',
  description: 'Estimates the distribution of a total (cost/duration/effort) from triangular PERT three-point estimates. Seeded and reproducible. Results are simulated estimates, not observed measurements.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, trials: { type: 'number' }, seed: { type: 'number' }, items: { type: 'array' } }, additionalProperties: false },
  schema: monteCarloSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 15_000,
  execute(input: z.infer<typeof monteCarloSchema>) {
    const resolved = input.model ?? { trials: input.trials ?? 10_000, seed: input.seed ?? 42, items: input.items! };
    return simulatePert(resolved.items, resolved.trials, resolved.seed);
  },
};

/* ─── forecast.linear ──────────────────────────────────── */
const forecastModelSchema = z.object({
  series: z.array(z.number().finite()).min(8).max(10_000),
  steps: z.number().int().min(1).max(90).default(3),
}).strict();

const forecastSchema = z.object({
  model: forecastModelSchema.optional(),
  series: z.array(z.number().finite()).min(8).max(10_000).optional(),
  steps: z.number().int().min(1).max(90).optional(),
}).strict().refine((input) => Boolean(input.model || input.series), { message: 'Provide a model or series' });

const forecastTool: ToolDefinition = {
  id: 'forecast.linear',
  name: 'Linear Trend Forecast with Backtest',
  description: 'Naive least-squares trend projection with an honest holdout backtest (last 20% of points predicted vs observed). Reports R², holdout MAE and residual-stddev bands. NOT a guarantee — a transparent baseline to beat, never presented as causal prediction.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, series: { type: 'array', items: { type: 'number' } }, steps: { type: 'number', minimum: 1, maximum: 90 } }, additionalProperties: false },
  schema: forecastSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof forecastSchema>) {
    const resolved = input.model ?? { series: input.series!, steps: input.steps ?? 3 };
    const xs = [...resolved.series];
    const n = xs.length;
    const xMean = (n - 1) / 2;
    const yMean = xs.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (xs[i]! - yMean); den += (i - xMean) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;
    const predict = (i: number) => intercept + slope * i;
    // R² over the fitted window
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) { ssRes += (xs[i]! - predict(i)) ** 2; ssTot += (xs[i]! - yMean) ** 2; }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    // Honest holdout backtest: fit on the first 80%, measure error on the last 20%
    const holdoutStart = Math.max(2, Math.floor(n * 0.8));
    const fitN = holdoutStart;
    const fxMean = (fitN - 1) / 2;
    const fyMean = xs.slice(0, fitN).reduce((a, b) => a + b, 0) / fitN;
    let fNum = 0, fDen = 0;
    for (let i = 0; i < fitN; i++) { fNum += (i - fxMean) * (xs[i]! - fyMean); fDen += (i - fxMean) ** 2; }
    const fSlope = fDen === 0 ? 0 : fNum / fDen;
    const fIntercept = fyMean - fSlope * fxMean;
    const holdout = xs.slice(fitN);
    const holdoutMae = holdout.reduce((acc, v, j) => acc + Math.abs(v - (fIntercept + fSlope * (fitN + j))), 0) / holdout.length;
    const residuals = xs.map((v, i) => v - predict(i));
    const residualStddev = Math.sqrt(residuals.reduce((acc, v) => acc + v * v, 0) / n);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const projections = Array.from({ length: resolved.steps }, (_, s) => {
      const i = n + s;
      const point = predict(i);
      return { step: s + 1, index: i, point: round(point), bandLow: round(point - residualStddev), bandHigh: round(point + residualStddev) };
    });
    return {
      method: 'least-squares linear trend with 80/20 holdout backtest',
      slope: round(slope),
      intercept: round(intercept),
      r2: round(r2),
      holdoutMae: round(holdoutMae),
      residualStddev: round(residualStddev),
      projections,
      disclaimer: 'Naive linear extrapolation from the provided series. R²/holdout MAE describe fit on THIS series only; they are not a promise of future accuracy. For anything with stakes, compare against a domain forecaster with real exogenous data.',
    };
  },
};

/* ─── stats.describe ───────────────────────────────────── */
const statsSchema = z.object({ series: z.array(z.number().finite()).min(2).max(100_000) }).strict();

const statsTool: ToolDefinition = {
  id: 'stats.describe',
  name: 'Descriptive Statistics',
  description: 'Count, mean, sample stddev, quartiles, IQR outliers and least-squares trend slope for a numeric series.',
  inputSchema: { type: 'object', properties: { series: { type: 'array', items: { type: 'number' } } }, required: ['series'], additionalProperties: false },
  schema: statsSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof statsSchema>) {
    const xs = [...input.series];
    const n = xs.length;
    const sorted = [...xs].sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
    const q = (p: number) => {
      const pos = (n - 1) * p;
      const base = Math.floor(pos);
      const rest = pos - base;
      return sorted[base]! + (sorted[base + 1] !== undefined ? rest * (sorted[base + 1]! - sorted[base]!) : 0);
    };
    const q1 = q(0.25), median = q(0.5), q3 = q(0.75);
    const iqr = q3 - q1;
    const outliers = xs.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
    const xMean = (n - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (xs[i]! - mean); den += (i - xMean) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return {
      count: n,
      mean: round(mean),
      stddev: round(Math.sqrt(variance)),
      min: round(sorted[0]!),
      q1: round(q1),
      median: round(median),
      q3: round(q3),
      max: round(sorted[n - 1]!),
      iqr: round(iqr),
      outliers: outliers.map(round),
      trendSlopePerStep: round(slope),
    };
  },
};

/* ─── decision.weighted_matrix ─────────────────────────── */
const decisionModelSchema = z.object({
  criteria: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), weight: z.number().finite().positive() })).min(1).max(30),
  alternatives: z.array(z.object({ name: z.string().min(1).max(120), scores: z.record(z.string(), z.number().finite().min(0).max(10)) })).min(2).max(50),
}).strict();

const decisionSchema = z.object({
  model: decisionModelSchema.optional(),
  criteria: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), weight: z.number().finite().positive() })).min(1).max(30).optional(),
  alternatives: z.array(z.object({ name: z.string().min(1).max(120), scores: z.record(z.string(), z.number().finite().min(0).max(10)) })).min(2).max(50).optional(),
}).strict().refine((input) => Boolean(input.model || (input.criteria && input.alternatives)), { message: 'Provide a model or criteria and alternatives' });

const decisionTool: ToolDefinition = {
  id: 'decision.weighted_matrix',
  name: 'Weighted Decision Matrix',
  description: 'Scores alternatives against weighted criteria, ranks them and stress-tests the winner with ±25% weight perturbations.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, criteria: { type: 'array' }, alternatives: { type: 'array' } }, additionalProperties: false },
  schema: decisionSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof decisionSchema>) {
    const resolved = input.model ?? { criteria: input.criteria!, alternatives: input.alternatives! };
    for (const alt of resolved.alternatives) {
      for (const c of resolved.criteria) {
        if (alt.scores[c.id] === undefined) throw new Error(`Alternative "${alt.name}" is missing a score for criterion "${c.id}"`);
      }
    }
    const totalWeight = resolved.criteria.reduce((acc, c) => acc + c.weight, 0);
    const score = (alt: (typeof resolved.alternatives)[number], weights: Map<string, number>) =>
      resolved.criteria.reduce((acc, c) => acc + (weights.get(c.id) ?? c.weight / totalWeight) * (alt.scores[c.id] ?? 0), 0);
    const normalized = new Map(resolved.criteria.map((c) => [c.id, c.weight / totalWeight]));
    const ranked = [...resolved.alternatives]
      .map((alt) => ({ name: alt.name, score: Math.round(score(alt, normalized) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);
    // Robustness: perturb each criterion weight ±25%, renormalize, check if the winner survives.
    let robust = true;
    const perturbations: string[] = [];
    for (const c of resolved.criteria) {
      for (const factor of [0.75, 1.25]) {
        const perturbed = new Map(normalized);
        perturbed.set(c.id, normalized.get(c.id)! * factor);
        const sum = [...perturbed.values()].reduce((a, b) => a + b, 0);
        for (const [k, v] of perturbed) perturbed.set(k, v / sum);
        const perturbedRanking = [...resolved.alternatives].map((alt) => ({ name: alt.name, s: score(alt, perturbed) })).sort((a, b) => b.s - a.s);
        if (perturbedRanking[0]!.name !== ranked[0]!.name) {
          robust = false;
          perturbations.push(`${Math.round((factor - 1) * 100)}% on "${c.id}" flips the winner to "${perturbedRanking[0]!.name}"`);
        }
      }
    }
    return {
      ranking: ranked,
      winner: ranked[0]!.name,
      normalizedWeights: Object.fromEntries(normalized),
      robust,
      perturbationNotes: perturbations,
      methodology: 'Weighted sum of 0-10 scores with weight normalization; robustness via one-at-a-time ±25% weight perturbation.',
    };
  },
};

/* ─── text.extract_summary ─────────────────────────────── */
const SUMMARY_STOP = new Set('the a an and or of to in for on with is are was were be been it its this that as at by from you your we our i he she they not but have has had will would can could should about into over after before between under more most other some such only also than then them those these when where which who whom'.split(' '));
const stopwords = new Set([...SUMMARY_STOP, 'في', 'من', 'على', 'إلى', 'عن', 'أن', 'لا', 'ما', 'هو', 'هي', 'التي', 'هذا', 'هذه', 'مع', 'كل', 'كان', 'قد']);

const summarySchema = z.object({ text: z.string().min(1).max(200_000), sentences: z.number().int().min(1).max(20).default(3) }).strict();

/* ─── network flow, routing, Pareto, Bayes, advanced simulation ─── */
const flowEdgeInput = z.object({
  id: z.string().max(160).optional(),
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  capacity: z.number().finite().min(0),
}).strict();
const maxFlowModelSchema = z.object({
  nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
  edges: z.array(flowEdgeInput).min(1).max(5_000),
  source: z.string().min(1).max(120),
  sink: z.string().min(1).max(120),
}).strict();
const maxFlowSchema = z.object({
  model: maxFlowModelSchema.optional(),
  nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
  edges: z.array(flowEdgeInput).min(1).max(5_000).optional(),
  source: z.string().min(1).max(120).optional(),
  sink: z.string().min(1).max(120).optional(),
}).strict().refine((input) => Boolean(input.model || (input.edges && input.source && input.sink)), { message: 'Provide a model or edges, source and sink' });

const maxFlowTool: ToolDefinition = {
  id: 'graph.max_flow',
  name: 'Maximum Flow (Dinic)',
  description: 'Computes maximum single-commodity flow and the min-cut on a capacitated network, with independent conservation, capacity and max-flow/min-cut verification.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, nodes: { type: 'array' }, edges: { type: 'array' }, source: { type: 'string' }, sink: { type: 'string' } }, additionalProperties: false },
  schema: maxFlowSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof maxFlowSchema>) {
    const model: MaxFlowModel = input.model ?? { edges: input.edges!, source: input.source!, sink: input.sink!, ...(input.nodes ? { nodes: input.nodes } : {}) };
    return solveMaxFlow(model);
  },
};

const costEdgeInput = flowEdgeInput.extend({ cost: z.number().finite() });
const minCostFlowModelSchema = z.object({
  nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
  edges: z.array(costEdgeInput).min(1).max(5_000),
  source: z.string().min(1).max(120),
  sink: z.string().min(1).max(120),
  demand: z.number().finite().min(0),
}).strict();
const minCostFlowSchema = z.object({
  model: minCostFlowModelSchema.optional(),
  nodes: z.array(z.string().min(1).max(120)).max(2_000).optional(),
  edges: z.array(costEdgeInput).min(1).max(5_000).optional(),
  source: z.string().min(1).max(120).optional(),
  sink: z.string().min(1).max(120).optional(),
  demand: z.number().finite().min(0).optional(),
}).strict().refine((input) => Boolean(input.model || (input.edges && input.source && input.sink && input.demand !== undefined)), { message: 'Provide a model or edges, source, sink and demand' });

const minCostFlowTool: ToolDefinition = {
  id: 'graph.min_cost_flow',
  name: 'Minimum Cost Flow (Successive Shortest Paths)',
  description: 'Delivers an exact demand at minimum linear cost on a capacitated network, with independent conservation, capacity, cost and residual-optimality verification.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, nodes: { type: 'array' }, edges: { type: 'array' }, source: { type: 'string' }, sink: { type: 'string' }, demand: { type: 'number' } }, additionalProperties: false },
  schema: minCostFlowSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 15_000,
  execute(input: z.infer<typeof minCostFlowSchema>) {
    const model: MinCostFlowModel = input.model ?? { edges: input.edges!, source: input.source!, sink: input.sink!, demand: input.demand!, ...(input.nodes ? { nodes: input.nodes } : {}) };
    return solveMinCostFlow(model);
  },
};

const bipartiteEdgeInput = z.object({ left: z.string().min(1).max(120), right: z.string().min(1).max(120) }).strict();
const bipartiteModelSchema = z.object({
  left: z.array(z.string().min(1).max(120)).min(1).max(2_000),
  right: z.array(z.string().min(1).max(120)).min(1).max(2_000),
  edges: z.array(bipartiteEdgeInput).min(1).max(10_000),
}).strict();
const bipartiteSchema = z.object({
  model: bipartiteModelSchema.optional(),
  left: z.array(z.string().min(1).max(120)).min(1).max(2_000).optional(),
  right: z.array(z.string().min(1).max(120)).min(1).max(2_000).optional(),
  edges: z.array(bipartiteEdgeInput).min(1).max(10_000).optional(),
}).strict().refine((input) => Boolean(input.model || (input.left && input.right && input.edges)), { message: 'Provide a model or left, right and edges' });

const bipartiteTool: ToolDefinition = {
  id: 'graph.bipartite_matching',
  name: 'Bipartite Maximum Matching',
  description: 'Finds a maximum-cardinality one-to-one matching in a bipartite graph and verifies validity, uniqueness and the absence of augmenting paths.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, left: { type: 'array' }, right: { type: 'array' }, edges: { type: 'array' } }, additionalProperties: false },
  schema: bipartiteSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof bipartiteSchema>) {
    const model: BipartiteModel = input.model ?? { left: input.left!, right: input.right!, edges: input.edges! };
    return solveBipartiteMatching(model);
  },
};

const routePointInput = z.object({ id: z.string().min(1).max(120), x: z.number().finite(), y: z.number().finite() }).strict();
const tspModelSchema = z.object({
  points: z.array(routePointInput).min(1).max(200).optional(),
  distanceMatrix: z.array(z.array(z.number().finite().min(0)).min(1).max(200)).min(1).max(200).optional(),
  labels: z.array(z.string().min(1).max(120)).max(200).optional(),
  start: z.string().min(1).max(120).optional(),
  exactLimit: z.number().int().min(2).max(14).optional(),
}).strict().refine((model) => Boolean(model.points?.length || model.distanceMatrix?.length), { message: 'Provide points or a distance matrix' });
const tspSchema = z.object({
  model: tspModelSchema.optional(),
  points: z.array(routePointInput).min(1).max(200).optional(),
  distanceMatrix: z.array(z.array(z.number().finite().min(0)).min(1).max(200)).min(1).max(200).optional(),
  labels: z.array(z.string().min(1).max(120)).max(200).optional(),
  start: z.string().min(1).max(120).optional(),
  exactLimit: z.number().int().min(2).max(14).optional(),
}).strict().refine((input) => Boolean(input.model || input.points?.length || input.distanceMatrix?.length), { message: 'Provide a model, points or a distance matrix' });

const tspTool: ToolDefinition = {
  id: 'routing.tsp',
  name: 'Traveling Salesperson (Exact DP / 2-opt)',
  description: 'Solves a closed TSP tour with Held-Karp exact dynamic programming for small instances and nearest-neighbour + 2-opt for larger ones. Heuristic results are labelled approximate, never optimal.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, points: { type: 'array' }, distanceMatrix: { type: 'array' }, labels: { type: 'array' }, start: { type: 'string' }, exactLimit: { type: 'number' } }, additionalProperties: false },
  schema: tspSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  execute(input: z.infer<typeof tspSchema>) {
    const model: TspModel = input.model ?? {
      ...(input.points ? { points: input.points } : {}), ...(input.distanceMatrix ? { distanceMatrix: input.distanceMatrix } : {}),
      ...(input.labels ? { labels: input.labels } : {}), ...(input.start ? { start: input.start } : {}), ...(input.exactLimit ? { exactLimit: input.exactLimit } : {}),
    };
    return solveTsp(model);
  },
};

const depotInput = z.object({ id: z.string().min(1).max(120), x: z.number().finite(), y: z.number().finite() }).strict();
const customerInput = z.object({ id: z.string().min(1).max(120), x: z.number().finite(), y: z.number().finite(), demand: z.number().finite().min(0), depot: z.string().min(1).max(120).optional() }).strict();
const vehicleInput = z.object({ id: z.string().min(1).max(120), capacity: z.number().finite().positive(), depot: z.string().min(1).max(120).optional() }).strict();
const vrpModelSchema = z.object({
  depots: z.array(depotInput).min(1).max(100),
  customers: z.array(customerInput).min(1).max(2_000),
  vehicles: z.array(vehicleInput).min(1).max(500),
}).strict();
const vrpSchema = z.object({
  model: vrpModelSchema.optional(),
  depots: z.array(depotInput).min(1).max(100).optional(),
  customers: z.array(customerInput).min(1).max(2_000).optional(),
  vehicles: z.array(vehicleInput).min(1).max(500).optional(),
}).strict().refine((input) => Boolean(input.model || (input.depots && input.customers && input.vehicles)), { message: 'Provide a model or depots, customers and vehicles' });

const vrpTool: ToolDefinition = {
  id: 'routing.vrp',
  name: 'Vehicle Routing (Clarke–Wright)',
  description: 'Builds capacity-feasible multi-depot routes with Clarke–Wright savings. Reports feasible/approximate or infeasible; never claims global optimality.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, depots: { type: 'array' }, customers: { type: 'array' }, vehicles: { type: 'array' } }, additionalProperties: false },
  schema: vrpSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  execute(input: z.infer<typeof vrpSchema>) {
    const model: VrpModel = input.model ?? { depots: input.depots!, customers: input.customers!, vehicles: input.vehicles! };
    return solveVrp(model);
  },
};

const objectiveInput = z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), direction: z.enum(['minimize', 'maximize']) }).strict();
const candidateInput = z.object({ name: z.string().min(1).max(120), values: z.record(z.string(), z.number().finite()) }).strict();
const paretoModelSchema = z.object({
  objectives: z.array(objectiveInput).min(2).max(20),
  candidates: z.array(candidateInput).min(2).max(2_000),
  weights: z.record(z.string(), z.number().finite().min(0)).optional(),
}).strict();
const paretoSchema = z.object({
  model: paretoModelSchema.optional(),
  objectives: z.array(objectiveInput).min(2).max(20).optional(),
  candidates: z.array(candidateInput).min(2).max(2_000).optional(),
  weights: z.record(z.string(), z.number().finite().min(0)).optional(),
}).strict().refine((input) => Boolean(input.model || (input.objectives && input.candidates)), { message: 'Provide a model or objectives and candidates' });

const paretoTool: ToolDefinition = {
  id: 'decision.pareto',
  name: 'Pareto Multi-Objective Analysis',
  description: 'Computes the Pareto frontier for an explicit candidate set, explains trade-offs, ranks under declared weights and stress-tests the winner. Exact only for the supplied candidate set.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, objectives: { type: 'array' }, candidates: { type: 'array' }, weights: { type: 'object' } }, additionalProperties: false },
  schema: paretoSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof paretoSchema>) {
    const model: ParetoModel = input.model ?? { objectives: input.objectives!, candidates: input.candidates!, ...(input.weights ? { weights: input.weights } : {}) };
    return solvePareto(model);
  },
};

const betaPriorInput = z.object({ alpha: z.number().finite().positive(), beta: z.number().finite().positive() }).strict();
const betaAlternativeInput = z.object({ label: z.string().min(1).max(120).optional(), alpha: z.number().finite().positive(), beta: z.number().finite().positive() }).strict();
const betaModelInput = z.object({
  type: z.literal('beta_binomial'),
  prior: betaPriorInput,
  successes: z.number().int().min(0),
  trials: z.number().int().min(0),
  credibleLevel: z.number().finite().gt(0.5).lt(1).optional(),
  alternativePriors: z.array(betaAlternativeInput).max(20).optional(),
}).strict().refine((model) => model.successes <= model.trials, { message: 'successes must not exceed trials' });
const normalPriorInput = z.object({ mean: z.number().finite(), sd: z.number().finite().positive() }).strict();
const normalAlternativeInput = z.object({ label: z.string().min(1).max(120).optional(), mean: z.number().finite(), sd: z.number().finite().positive() }).strict();
const normalModelInput = z.object({
  type: z.literal('normal_normal'),
  prior: normalPriorInput,
  observations: z.array(z.number().finite()).min(1).max(100_000),
  knownSd: z.number().finite().positive(),
  credibleLevel: z.number().finite().gt(0.5).lt(1).optional(),
  alternativePriors: z.array(normalAlternativeInput).max(20).optional(),
}).strict();
const bayesModelInput = z.discriminatedUnion('type', [betaModelInput, normalModelInput]);
const bayesSchema = z.object({ model: bayesModelInput }).strict();

const bayesTool: ToolDefinition = {
  id: 'stats.bayes_update',
  name: 'Bayesian Posterior Update',
  description: 'Conjugate Beta–Binomial and Normal–Normal posterior updates with credible intervals and prior-sensitivity checks. Credible intervals are model-conditional, not real-world guarantees.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, type: { enum: ['beta_binomial', 'normal_normal'] }, prior: { type: 'object' }, successes: { type: 'number' }, trials: { type: 'number' }, observations: { type: 'array' }, knownSd: { type: 'number' }, credibleLevel: { type: 'number' }, alternativePriors: { type: 'array' } }, additionalProperties: false },
  schema: bayesSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof bayesSchema>) {
    return solveBayes(input.model as BayesModel);
  },
};

const queueSchema = z.object({
  model: z.object({
    customers: z.number().int().min(1).max(100_000),
    interarrivalMean: z.number().finite().positive(),
    serviceMean: z.number().finite().positive(),
    servers: z.number().int().min(1).max(100),
    seed: z.number().int(),
  }).strict().optional(),
  customers: z.number().int().min(1).max(100_000).optional(),
  interarrivalMean: z.number().finite().positive().optional(),
  serviceMean: z.number().finite().positive().optional(),
  servers: z.number().int().min(1).max(100).optional(),
  seed: z.number().int().optional(),
}).strict().refine((input) => Boolean(input.model || (input.customers && input.interarrivalMean && input.serviceMean && input.servers && input.seed !== undefined)), { message: 'Provide a model or complete queue inputs' });

const queueTool: ToolDefinition = {
  id: 'sim.queue',
  name: 'Discrete-Event Queue Simulation',
  description: 'Runs a seeded FCFS multi-server queue with exponential interarrival and service times. Reports waits, utilization and makespan as simulated results, not observations.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, customers: { type: 'number' }, interarrivalMean: { type: 'number' }, serviceMean: { type: 'number' }, servers: { type: 'number' }, seed: { type: 'number' } }, additionalProperties: false },
  schema: queueSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 15_000,
  execute(input: z.infer<typeof queueSchema>) {
    const model: QueueModel = input.model ?? { customers: input.customers!, interarrivalMean: input.interarrivalMean!, serviceMean: input.serviceMean!, servers: input.servers!, seed: input.seed! };
    return simulateQueue(model);
  },
};

const scenarioItemInput = z.object({ name: z.string().min(1).max(120), optimistic: z.number().finite(), likely: z.number().finite(), pessimistic: z.number().finite() }).strict();
const scenarioAdjustmentInput = z.object({ item: z.string().min(1).max(120), op: z.enum(['mul', 'add']), value: z.number().finite() }).strict();
const scenarioInput = z.object({ name: z.string().min(1).max(120), items: z.array(scenarioItemInput).min(1).max(100), adjustments: z.array(scenarioAdjustmentInput).max(100).optional() }).strict();
const scenarioModelSchema = z.object({ scenarios: z.array(scenarioInput).min(2).max(20), trials: z.number().int().min(100).max(100_000).optional(), seed: z.number().int().optional() }).strict();
const scenarioSchema = z.object({
  model: scenarioModelSchema.optional(),
  scenarios: z.array(scenarioInput).min(2).max(20).optional(),
  trials: z.number().int().min(100).max(100_000).optional(),
  seed: z.number().int().optional(),
}).strict().refine((input) => Boolean(input.model || input.scenarios), { message: 'Provide a model or scenarios' });

const scenarioTool: ToolDefinition = {
  id: 'sim.scenario_compare',
  name: 'Scenario Comparison Simulation',
  description: 'Runs the same seeded PERT model under multiple scenarios, reports baseline deltas and ranks by median. Reproducibility is verified by rerunning with the same seed.',
  inputSchema: { type: 'object', properties: { model: { type: 'object' }, scenarios: { type: 'array' }, trials: { type: 'number' }, seed: { type: 'number' } }, additionalProperties: false },
  schema: scenarioSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 30_000,
  execute(input: z.infer<typeof scenarioSchema>) {
    const model: ScenarioModel = input.model ?? { scenarios: input.scenarios!, ...(input.trials !== undefined ? { trials: input.trials } : {}), ...(input.seed !== undefined ? { seed: input.seed } : {}) };
    return solveScenarios(model);
  },
};


const summaryTool: ToolDefinition = {
  id: 'text.extract_summary',
  name: 'Extractive Summarizer',
  description: 'Deterministic frequency-based extractive summary: scores sentences by salient term frequency and returns the top sentences in original order.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' }, sentences: { type: 'number' } }, required: ['text'], additionalProperties: false },
  schema: summarySchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof summarySchema>) {
    const rawSentences = input.text.match(/[^.!?\n]+[.!?]?/g) ?? [input.text];
    const sentences = rawSentences.map((s) => s.trim()).filter(Boolean).slice(0, 2_000);
    if (sentences.length <= input.sentences) return { summary: sentences.join(' '), sentenceCount: sentences.length, method: 'passthrough (text shorter than requested summary)' };
    const freq = new Map<string, number>();
    for (const s of sentences) {
      for (const token of s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        if (token.length < 3 || stopwords.has(token)) continue;
        freq.set(token, (freq.get(token) ?? 0) + 1);
      }
    }
    const scored = sentences.map((s, index) => {
      const tokens = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const score = tokens.reduce((acc, t) => acc + (freq.get(t) ?? 0), 0) / Math.max(tokens.length, 1);
      return { s, index, score };
    });
    const picked = [...scored].sort((a, b) => b.score - a.score).slice(0, input.sentences).sort((a, b) => a.index - b.index);
    return { summary: picked.map((p) => p.s).join(' '), sentenceCount: picked.length, method: 'frequency-based extractive (deterministic)' };
  },
};

/* ─── web.fetch_read ───────────────────────────────────── */
const fetchReadSchema = z.object({ url: z.string().url().max(2000) }).strict();

const fetchReadTool: ToolDefinition = {
  id: 'web.fetch_read',
  name: 'Fetch & Read Web Page',
  description: 'Fetches one http(s) URL with an 8-second deadline, strips markup to readable text and returns title + first 4,000 characters. For already-authorized pages only.',
  inputSchema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } }, required: ['url'], additionalProperties: false },
  schema: fetchReadSchema,
  permission: 'web:read',
  risk: 'medium',
  environment: 'host',
  timeoutMs: 12_000,
  async execute(input: z.infer<typeof fetchReadSchema>) {
    const response = await safeFetch(input.url, { timeoutMs: 8_000, maxBytes: 512 * 1024 });
    const text = response.body.toString('utf8');
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() ?? null;
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { url: response.url, status: response.status, title, text: stripped.slice(0, 4000), truncated: stripped.length > 4000 };
  },
};

/* ─── security.scan ────────────────────────────────────── */
const securityScanSchema = z.object({ path: z.string().max(500).optional() }).strict();

const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { id: 'openai-key', re: /sk-[A-Za-z0-9]{20,}/ },
  { id: 'generic-password-assignment', re: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];
const DANGER_PATTERNS: Array<{ id: string; re: RegExp; severity: 'high' | 'medium' }> = [
  { id: 'eval-use', re: /\beval\s*\(/, severity: 'high' },
  { id: 'child-process', re: /child_process/, severity: 'high' },
  { id: 'dynamic-function', re: /new Function\s*\(/, severity: 'high' },
  { id: 'inner-html', re: /innerHTML\s*=/, severity: 'medium' },
  { id: 'disabled-tls', re: /NODE_TLS_REJECT_UNAUTHORIZED/, severity: 'high' },
];

function walkFiles(dir: string, limit = 400): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const current = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(current, { withFileTypes: true }) as never; } catch { continue; }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile() && /\.(mjs|cjs|js|ts|tsx|json|html|md|css|env|yml|yaml)$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

const securityScanTool: ToolDefinition = {
  id: 'security.scan',
  name: 'Static Security Scan',
  description: 'Scans workspace files for hardcoded secrets and dangerous constructs (eval, child_process, TLS bypass, innerHTML). Pattern-based triage, not a substitute for expert review.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
  schema: securityScanSchema,
  permission: 'workspace:read',
  risk: 'low',
  environment: 'host',
  timeoutMs: 15_000,
  execute(input: z.infer<typeof securityScanSchema>, ctx) {
    const root = resolveInWorkspace(ctx.workspaceId, input.path ?? '.');
    const files = walkFiles(root);
    const findings: Array<{ file: string; pattern: string; severity: string }> = [];
    for (const file of files) {
      let text = '';
      try { text = readFileSync(file, 'utf8').slice(0, 512_000); } catch { continue; }
      for (const { id, re } of SECRET_PATTERNS) {
        if (re.test(text)) findings.push({ file: path.relative(root, file), pattern: id, severity: 'critical' });
      }
      for (const { id, re, severity } of DANGER_PATTERNS) {
        if (re.test(text)) findings.push({ file: path.relative(root, file), pattern: id, severity });
      }
    }
    return {
      scannedFiles: files.length,
      findings,
      criticalSecrets: findings.filter((f) => f.severity === 'critical').length,
      verdict: findings.length === 0 ? 'No hardcoded secrets or dangerous constructs matched.' : `${findings.length} finding(s) require review.`,
    };
  },
};

/* ─── org.build (delegates to the organization builder) ── */
const orgBuildSchema = z.object({
  objective: z.string().min(10).max(2000),
  name: z.string().min(1).max(120).optional(),
}).strict();

const orgBuildTool: ToolDefinition = {
  id: 'org.build',
  name: 'Build Virtual Organization',
  description: 'Creates a persistent virtual organization for an objective: departments, reporting relationships, specialized agents, a project and seeded workflow.',
  inputSchema: { type: 'object', properties: { objective: { type: 'string' }, name: { type: 'string' } }, required: ['objective'], additionalProperties: false },
  schema: orgBuildSchema,
  permission: 'org:write',
  risk: 'medium',
  environment: 'host',
  timeoutMs: 30_000,
  async execute(input: z.infer<typeof orgBuildSchema>, ctx) {
    const { buildOrganization } = await import('./orgs.js');
    return buildOrganization({ workspaceId: ctx.workspaceId, objective: input.objective, name: input.name, actor: ctx.actor });
  },
};

/* ─── agents.create (Journey: create a specialized agent) ─ */
const agentsCreateSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(160),
  specialization: z.string().min(1).max(60),
  skills: z.array(z.string().min(1).max(60)).max(40).default([]),
  instructions: z.string().max(4000).optional(),
}).strict();

const agentsCreateTool: ToolDefinition = {
  id: 'agents.create',
  name: 'Create Persistent Agent',
  description: 'Creates a reusable, persisted WORA agent with role, specialization, skills, tools, permissions and evaluation criteria.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, specialization: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, instructions: { type: 'string' } }, required: ['name', 'role', 'specialization'], additionalProperties: false },
  schema: agentsCreateSchema,
  permission: 'agents:write',
  risk: 'medium',
  environment: 'host',
  timeoutMs: 10_000,
  async execute(input: z.infer<typeof agentsCreateSchema>, ctx) {
    const { createAgent } = await import('./registry.js');
    return createAgent({
      workspaceId: ctx.workspaceId,
      name: input.name,
      role: input.role,
      specialization: input.specialization,
      skills: input.skills,
      instructions: input.instructions,
      actor: ctx.actor,
      source: 'orchestrator',
    });
  },
};

/* ─── meta.select_algorithm ────────────────────────────── */
const algorithmSelectSchema = algorithmSelectionInputSchema;

const algorithmSelectTool: ToolDefinition = {
  id: 'meta.select_algorithm',
  name: 'Algorithm Selection',
  description: 'Selects an implemented WORA algorithm from an explicit problem kind, structured features or objective text. Returns required inputs, verification checks, limitations and alternatives; it never invents an unsupported solver.',
  inputSchema: {
    type: 'object',
    properties: {
      objective: { type: 'string', maxLength: 4000 },
      kind: { enum: PROBLEM_KINDS },
      features: { type: 'object' },
    },
    additionalProperties: false,
  },
  schema: algorithmSelectSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof algorithmSelectSchema>) {
    return selectAlgorithm(input);
  },
};

/* ─── meta.select_scientific_method ────────────────────── */
const scientificSelectTool: ToolDefinition = {
  id: 'meta.select_scientific_method',
  name: 'Scientific Method Selection',
  description: 'Selects an implemented scientific method from structured problem features, explains the domain, assumptions, rejected alternatives and gaps. It never claims an unimplemented method is executable.',
  inputSchema: {
    type: 'object',
    properties: { objective: { type: 'string' }, kind: { enum: PROBLEM_KINDS }, features: { type: 'object' } },
    additionalProperties: false,
  },
  schema: algorithmSelectionInputSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof algorithmSelectionInputSchema>) {
    return selectScientificMethod(input);
  },
};

/* ─── meta.classify_action ─────────────────────────────── */
const actionClassifySchema = z.object({
  action: z.string().trim().min(1).max(500),
  risk: z.enum(['low', 'medium', 'high']),
  reversible: z.boolean().optional(),
  externalCommitment: z.boolean().optional(),
  spendsMoney: z.boolean().optional(),
  amountUsd: z.number().finite().min(0).max(100_000_000).optional(),
  sensitiveData: z.boolean().optional(),
  scope: z.string().trim().min(1).max(200).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const problemUnderstandSchema = z.object({
  objective: z.string().trim().min(1).max(4000),
  track: z.string().trim().min(1).max(40).optional(),
}).strict();

const problemUnderstandTool: ToolDefinition = {
  id: 'meta.understand_problem',
  name: 'Structured Problem Understanding',
  description: 'Extracts explicit constraints, dependencies, resources, uncertainty, success criteria and algorithm features from an objective. Deterministic rules only; it does not claim semantic understanding.',
  inputSchema: {
    type: 'object',
    properties: { objective: { type: 'string' }, track: { type: 'string' } },
    required: ['objective'],
    additionalProperties: false,
  },
  schema: problemUnderstandSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof problemUnderstandSchema>) {
    return understandProblem(input);
  },
};

const actionClassifyTool: ToolDefinition = {
  id: 'meta.classify_action',
  name: 'Action Classification',
  description: 'Classifies a proposed action as A (safe automatic), B (controlled policy check) or C (explicit payload-bound approval). It does not grant authority or execute the action.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' }, risk: { enum: ['low', 'medium', 'high'] },
      reversible: { type: 'boolean' }, externalCommitment: { type: 'boolean' }, spendsMoney: { type: 'boolean' },
      amountUsd: { type: 'number' }, sensitiveData: { type: 'boolean' }, scope: { type: 'string' }, expiresAt: { type: 'string' },
    },
    required: ['action', 'risk'],
    additionalProperties: false,
  },
  schema: actionClassifySchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof actionClassifySchema>) {
    return classifyAction(input);
  },
};


/* ─── code.repair ──────────────────────────────────────── */
const codeRepairSchema = z.object({
  repoPath: z.string().min(1).max(500),
  defect: z.string().min(1).max(4_000),
  patch: z.string().min(1).max(256_000),
  testPath: z.string().min(1).max(500),
  regressionPath: z.string().min(1).max(500).optional(),
}).strict();

const codeRepairTool: ToolDefinition = {
  id: 'code.repair',
  name: 'Repair Repository Defect',
  description: 'Copies a workspace repository to a temporary directory, reproduces a failing Node test, applies a bounded unified diff, runs targeted and regression tests, verifies the diff, and never edits the source repository.',
  inputSchema: {
    type: 'object',
    properties: {
      repoPath: { type: 'string' }, defect: { type: 'string' }, patch: { type: 'string' },
      testPath: { type: 'string' }, regressionPath: { type: 'string' },
    },
    required: ['repoPath', 'defect', 'patch', 'testPath'], additionalProperties: false,
  },
  schema: codeRepairSchema,
  permission: 'workspace:write',
  risk: 'medium',
  environment: 'host',
  timeoutMs: 120_000,
  execute(input: z.infer<typeof codeRepairSchema>, ctx) {
    return repairRepository({ workspaceId: ctx.workspaceId, actor: ctx.actor, ...input });
  },
};

/* ─── Registry ─────────────────────────────────────────── */
import { scaffoldWebappTool, hostExecTool } from './scaffold.js';
import { RUNTIME_TOOLS } from '../runtime/tools.js';
import { incrementMetric, observeDuration } from '../lib/observability.js';

/* ─── Plugin tool provider (extensions) ────────────────── */
export interface PluginToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: string[];
  risk: ToolRisk;
  timeoutMs: number;
  idempotent?: boolean;
  semanticContract?: SemanticContract;
  pluginId: string;
}

type PluginToolLister = (workspaceId: string) => PluginToolDefinition[];
type PluginToolRunner = (workspaceId: string, toolId: string, input: unknown, ctx: ToolContext) => Promise<unknown>;

let pluginToolLister: PluginToolLister | null = null;
let pluginToolRunner: PluginToolRunner | null = null;

/** Wired once at boot by the extensions module; keeps this registry free of plugin imports. */
export function registerPluginToolProvider(lister: PluginToolLister, runner: PluginToolRunner): void {
  pluginToolLister = lister;
  pluginToolRunner = runner;
}

function pluginTools(workspaceId: string | undefined): PluginToolDefinition[] {
  if (!workspaceId || !pluginToolLister) return [];
  try { return pluginToolLister(workspaceId); } catch { return []; }
}

function pluginToolAsDefinition(tool: PluginToolDefinition): ToolDefinition {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    schema: z.unknown(),
    permission: null,
    permissions: tool.permissions,
    risk: tool.risk,
    environment: 'host',
    timeoutMs: tool.timeoutMs,
    idempotent: tool.idempotent === true,
    semanticContract: tool.semanticContract,
    source: 'plugin',
    pluginId: tool.pluginId,
    async execute(input, ctx) {
      if (!pluginToolRunner) throw new Error(`No plugin runtime is registered for ${tool.id}`);
      return pluginToolRunner(ctx.workspaceId, tool.id, input, ctx);
    },
  };
}

const ALL_TOOLS: ToolDefinition[] = [
  diagnosticsTool,
  workspaceListTool,
  workspaceReadTool,
  assignmentTool,
  employeeTool,
  lpTool,
  shortestPathTool,
  formulateTool,
  monteCarloTool,
  statsTool,
  forecastTool,
  decisionTool,
  maxFlowTool,
  minCostFlowTool,
  bipartiteTool,
  tspTool,
  vrpTool,
  paretoTool,
  bayesTool,
  queueTool,
  scenarioTool,
  summaryTool,
  fetchReadTool,
  securityScanTool,
  scaffoldWebappTool,
  hostExecTool,
  codeRepairTool,
  orgBuildTool,
  agentsCreateTool,
  algorithmSelectTool,
  scientificSelectTool,
  problemUnderstandTool,
  actionClassifyTool,
  ...RUNTIME_TOOLS,
];

const toolMap = new Map(ALL_TOOLS.map((tool) => [tool.id, tool]));

/** Tools with no external side effect may be safely retried after a crash. */
const IDEMPOTENT_TOOL_IDS = new Set([
  'system.diagnostics', 'fs.workspace_list', 'fs.workspace_read',
  'or.assignment', 'or.employee_schedule', 'or.solve_lp', 'graph.shortest_path', 'meta.formulate_scientific_problem', 'sim.monte_carlo',
  'stats.describe', 'forecast.linear', 'decision.weighted_matrix', 'text.extract_summary',
  'web.fetch_read', 'security.scan', 'meta.select_algorithm', 'meta.select_scientific_method',
  'meta.understand_problem', 'meta.classify_action',
  'cloud.read_file', 'cloud.list_files', 'browser.inspect', 'browser.wait',
]);

export function isIdempotentTool(id: string | null, workspaceId?: string): boolean {
  if (!id) return true;
  if (toolMap.has(id)) return IDEMPOTENT_TOOL_IDS.has(id);
  const plugin = workspaceId ? pluginTools(workspaceId).find((tool) => tool.id === id) : null;
  return plugin?.idempotent === true;
}

export function listTools(workspaceId?: string) {
  const core = ALL_TOOLS.map(({ id, name, description, inputSchema, permission, risk, environment, timeoutMs }) =>
    ({ id, name, description, inputSchema, permission, risk, environment, timeoutMs, source: 'core' as const, pluginId: null }));
  const plugins = pluginTools(workspaceId).map(({ id, name, description, inputSchema, permissions, risk, timeoutMs, pluginId }) =>
    ({ id, name, description, inputSchema, permission: null, permissions, risk, environment: 'host' as const, timeoutMs, source: 'plugin' as const, pluginId }));
  return [...core, ...plugins];
}

export function getTool(id: string, workspaceId?: string): ToolDefinition | null {
  const core = toolMap.get(id);
  if (core) return core;
  const plugin = pluginTools(workspaceId).find((tool) => tool.id === id);
  return plugin ? pluginToolAsDefinition(plugin) : null;
}

export function effectiveToolRisk(tool: ToolDefinition, input: unknown): { risk: ToolRisk; spendsMoney: boolean; amountUsd?: number; reason?: string } {
  const refined = tool.riskForInput?.(input);
  return { risk: refined?.risk ?? tool.risk, spendsMoney: refined?.spendsMoney === true, ...(refined?.amountUsd !== undefined ? { amountUsd: refined.amountUsd } : {}), ...(refined?.reason ? { reason: refined.reason } : {}) };
}

/** Execute a tool with zod validation, permission check, timeout and audit. */
export async function runTool(id: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  const tool = getTool(id, ctx.workspaceId);
  if (!tool) return { ok: false, tool: id, error: `Unknown tool "${id}"`, durationMs: 0 };
  if (ctx.toolAllowlist && !ctx.toolAllowlist.has(id)) {
    incrementMetric('wora_tool_denied_total', { tool: id, reason: 'not_enabled_for_agent' });
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { reason: 'not_enabled_for_agent', missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null, correlationId: ctx.correlationId ?? null } });
    return { ok: false, tool: id, error: `Tool "${id}" is not enabled for this agent`, durationMs: Date.now() - started };
  }
  if (tool.permission && !ctx.permissions.has(tool.permission) && !ctx.permissions.has('*')) {
    return { ok: false, tool: id, error: `Permission "${tool.permission}" is required for ${id}`, durationMs: Date.now() - started };
  }
  const missing = (tool.permissions ?? []).filter((permission) => !ctx.permissions.has(permission) && !ctx.permissions.has('*'));
  if (missing.length) {
    incrementMetric('wora_tool_denied_total', { tool: id, reason: 'missing_permission' });
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { missing, correlationId: ctx.correlationId ?? null } });
    return { ok: false, tool: id, error: `Missing permission(s) for ${id}: ${missing.join(', ')}`, durationMs: Date.now() - started };
  }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, tool: id, error: `Invalid input for ${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, durationMs: Date.now() - started };
  }
  const inputRisk = effectiveToolRisk(tool, rawInput ?? {});
  if (tool.risk === 'high' || inputRisk.risk === 'high' || ctx.actionClass === 'C') {
    const approved = ctx.approvedAction;
    const expectedScope = actionScope(ctx.missionId, ctx.taskId, id);
    const approval = approved?.approvalId ? getApproval(ctx.workspaceId, approved.approvalId) : null;
    const valid = Boolean(
      approved &&
      approval &&
      approval.status === 'approved' &&
      !approval.consumedAt &&
      approval.actionClass === 'C' &&
      approval.toolId === id &&
      approval.scope === expectedScope &&
      approval.payloadDigest === payloadDigest(rawInput ?? {}) &&
      (!ctx.missionId || approval.missionId === ctx.missionId) &&
      (!ctx.taskId || approval.taskId === ctx.taskId) &&
      !isApprovalExpired(approval.expiresAt),
    );
    if (!valid) {
      audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { reason: 'approval_required_or_invalid', missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null } });
      return { ok: false, tool: id, error: 'This action requires a valid, payload-bound approval', code: 'APPROVAL_REQUIRED', durationMs: Date.now() - started };
    }
    try {
      consumeApproval(ctx.workspaceId, approval!.id, {
        payload: rawInput ?? {}, scope: expectedScope, actionClass: 'C', actor: ctx.actor,
        missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null,
      });
    } catch (err) {
      audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { reason: 'approval_consume_failed', error: err instanceof Error ? err.message : String(err), missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null } });
      return { ok: false, tool: id, error: 'This action requires a valid, payload-bound approval', code: 'APPROVAL_REQUIRED', durationMs: Date.now() - started };
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  const executionCtx: ToolContext = { ...ctx, signal: controller.signal };
  try {
    const output = await Promise.race([
      Promise.resolve(tool.execute(parsed.data, executionCtx)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Tool ${id} timed out after ${tool.timeoutMs}ms`));
        }, tool.timeoutMs);
      }),
    ]);
    const durationMs = Date.now() - started;
    incrementMetric('wora_tool_executions_total', { tool: id, outcome: 'ok' });
    observeDuration('wora_tool_duration_ms', durationMs, { tool: id });
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.execute', subject: id, detail: { ok: true, durationMs, missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null, correlationId: ctx.correlationId ?? null } });
    return { ok: true, output, tool: id, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    incrementMetric('wora_tool_executions_total', { tool: id, outcome: 'error' });
    observeDuration('wora_tool_duration_ms', durationMs, { tool: id });
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.execute', subject: id, detail: { ok: false, error: message.slice(0, 500), durationMs, missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null, correlationId: ctx.correlationId ?? null } });
    return { ok: false, tool: id, error: message, durationMs };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
