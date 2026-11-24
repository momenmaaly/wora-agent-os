/**
 * WORA OS — unified tool registry & execution interface.
 *
 * Every tool exposes identity, description, a JSON-schema-shaped input
 * contract, a risk level, a required permission, an execution environment,
 * a timeout and a single async execute(). Agents and the orchestrator reach
 * the outside world ONLY through this registry. Results are structured;
 * errors are normalized; every execution is auditable.
 */
import { z } from 'zod';
import os from 'node:os';
import path from 'node:path';
import { closeSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOsDb, audit, newId, nowIso } from './db.js';
import { openWorkspaceFile, resolveInWorkspace, workspacePath } from './workspace.js';
import { safeFetch } from '../lib/safe-fetch.js';
import { solveAssignment, solveEmployeeSchedule, solveLp } from './ortools.js';
import { PROBLEM_KINDS, selectAlgorithm } from './algorithms.js';

const execFileAsync = promisify(execFile);

export type ToolRisk = 'low' | 'medium' | 'high';

export interface ToolContext {
  workspaceId: string;
  actor: string;
  permissions: Set<string>;
  /** When present, the tool must be explicitly enabled for the executing agent. */
  toolAllowlist?: ReadonlySet<string>;
  /** Aborted by runTool on timeout; plugin and network tools must honor it. */
  signal?: AbortSignal;
  missionId?: string;
  taskId?: string;
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
const assignmentSchema = z.object({
  costMatrix: z.array(z.array(z.number().finite()).min(1)).min(1).max(200),
  rowLabels: z.array(z.string().max(120)).optional(),
  colLabels: z.array(z.string().max(120)).optional(),
}).strict();

const assignmentTool: ToolDefinition = {
  id: 'or.assignment',
  name: 'Assignment Solver (Hungarian)',
  description: 'Solves balanced rectangular assignment problems to optimality with the Hungarian algorithm.',
  inputSchema: { type: 'object', properties: { costMatrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, rowLabels: { type: 'array', items: { type: 'string' } }, colLabels: { type: 'array', items: { type: 'string' } } }, required: ['costMatrix'], additionalProperties: false },
  schema: assignmentSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 10_000,
  execute(input: z.infer<typeof assignmentSchema>) {
    return solveAssignment(input.costMatrix, input.rowLabels, input.colLabels);
  },
};

const employeeSchema = z.object({
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

const employeeTool: ToolDefinition = {
  id: 'or.employee_schedule',
  name: 'Employee Shift Scheduler (HiGHS MIP)',
  description: 'Minimizes labor cost assigning employees to shifts under availability, demand and workload constraints. Returns the schedule, cost and an independent constraint validation.',
  inputSchema: { type: 'object', properties: { employees: { type: 'array' }, shifts: { type: 'array' } }, required: ['employees', 'shifts'], additionalProperties: false },
  schema: employeeSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  async execute(input: z.infer<typeof employeeSchema>) {
    return solveEmployeeSchedule(input);
  },
};

const lpSchema = z.object({
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

const lpTool: ToolDefinition = {
  id: 'or.solve_lp',
  name: 'LP / MIP Solver (HiGHS)',
  description: 'Solves linear and mixed-integer linear programs from a structured model (objective, constraints, bounds). HiGHS engine, runs locally.',
  inputSchema: { type: 'object', properties: { sense: { enum: ['minimize', 'maximize'] }, objective: { type: 'array' }, constraints: { type: 'array' }, integerVars: { type: 'array', items: { type: 'string' } }, binaryVars: { type: 'array', items: { type: 'string' } } }, required: ['sense', 'objective', 'constraints'], additionalProperties: false },
  schema: lpSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 20_000,
  async execute(input: z.infer<typeof lpSchema>) {
    return solveLp(input);
  },
};

/* ─── sim.monte_carlo ──────────────────────────────────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const monteCarloSchema = z.object({
  trials: z.number().int().min(100).max(100_000).default(10_000),
  seed: z.number().int().default(42),
  items: z.array(z.object({
    name: z.string().min(1).max(120),
    optimistic: z.number().finite(),
    likely: z.number().finite(),
    pessimistic: z.number().finite(),
  })).min(1).max(100),
}).strict();

const monteCarloTool: ToolDefinition = {
  id: 'sim.monte_carlo',
  name: 'Monte Carlo PERT Simulation',
  description: 'Estimates the distribution of a total (cost/duration/effort) from triangular PERT three-point estimates. Seeded and reproducible. Results are simulated estimates, not observed measurements.',
  inputSchema: { type: 'object', properties: { trials: { type: 'number' }, seed: { type: 'number' }, items: { type: 'array' } }, required: ['items'], additionalProperties: false },
  schema: monteCarloSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 15_000,
  execute(input: z.infer<typeof monteCarloSchema>) {
    const rand = mulberry32(input.seed);
    const triangular = (a: number, m: number, b: number) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const mode = Math.min(Math.max(m, lo), hi);
      const u = rand();
      const fc = (mode - lo) / (hi - lo || 1e-9);
      return u < fc ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    };
    const totals: number[] = [];
    for (let t = 0; t < input.trials; t++) {
      let sum = 0;
      for (const item of input.items) sum += triangular(item.optimistic, item.likely, item.pessimistic);
      totals.push(sum);
    }
    totals.sort((a, b) => a - b);
    const q = (p: number) => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))]!;
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance = totals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / totals.length;
    const min = totals[0]!, max = totals[totals.length - 1]!;
    const buckets = 12;
    const histogram: Array<{ from: number; to: number; count: number }> = [];
    const width = (max - min) / buckets || 1;
    for (let b = 0; b < buckets; b++) histogram.push({ from: min + b * width, to: min + (b + 1) * width, count: 0 });
    for (const v of totals) {
      const idx = Math.min(buckets - 1, Math.floor((v - min) / width));
      histogram[idx]!.count += 1;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      simulated: true,
      method: 'triangular PERT Monte Carlo',
      trials: input.trials,
      seed: input.seed,
      mean: round(mean),
      stddev: round(Math.sqrt(variance)),
      p10: round(q(0.1)),
      p50: round(q(0.5)),
      p90: round(q(0.9)),
      min: round(min),
      max: round(max),
      histogram: histogram.map((h) => ({ ...h, from: round(h.from), to: round(h.to) })),
      disclaimer: 'Simulated estimate from the provided three-point inputs — not a measurement of actual performance.',
    };
  },
};

/* ─── forecast.linear ──────────────────────────────────── */
const forecastSchema = z.object({
  series: z.array(z.number().finite()).min(8).max(10_000),
  steps: z.number().int().min(1).max(90).default(3),
}).strict();

const forecastTool: ToolDefinition = {
  id: 'forecast.linear',
  name: 'Linear Trend Forecast with Backtest',
  description: 'Naive least-squares trend projection with an honest holdout backtest (last 20% of points predicted vs observed). Reports R², holdout MAE and residual-stddev bands. NOT a guarantee — a transparent baseline to beat, never presented as causal prediction.',
  inputSchema: { type: 'object', properties: { series: { type: 'array', items: { type: 'number' } }, steps: { type: 'number', minimum: 1, maximum: 90 } }, required: ['series'], additionalProperties: false },
  schema: forecastSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof forecastSchema>) {
    const xs = [...input.series];
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
    const projections = Array.from({ length: input.steps }, (_, s) => {
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
const decisionSchema = z.object({
  criteria: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120), weight: z.number().finite().positive() })).min(1).max(30),
  alternatives: z.array(z.object({ name: z.string().min(1).max(120), scores: z.record(z.string(), z.number().finite().min(0).max(10)) })).min(2).max(50),
}).strict();

const decisionTool: ToolDefinition = {
  id: 'decision.weighted_matrix',
  name: 'Weighted Decision Matrix',
  description: 'Scores alternatives against weighted criteria, ranks them and stress-tests the winner with ±25% weight perturbations.',
  inputSchema: { type: 'object', properties: { criteria: { type: 'array' }, alternatives: { type: 'array' } }, required: ['criteria', 'alternatives'], additionalProperties: false },
  schema: decisionSchema,
  permission: null,
  risk: 'low',
  environment: 'host',
  timeoutMs: 5_000,
  execute(input: z.infer<typeof decisionSchema>) {
    for (const alt of input.alternatives) {
      for (const c of input.criteria) {
        if (alt.scores[c.id] === undefined) throw new Error(`Alternative "${alt.name}" is missing a score for criterion "${c.id}"`);
      }
    }
    const totalWeight = input.criteria.reduce((acc, c) => acc + c.weight, 0);
    const score = (alt: (typeof input.alternatives)[number], weights: Map<string, number>) =>
      input.criteria.reduce((acc, c) => acc + (weights.get(c.id) ?? c.weight / totalWeight) * (alt.scores[c.id] ?? 0), 0);
    const normalized = new Map(input.criteria.map((c) => [c.id, c.weight / totalWeight]));
    const ranked = [...input.alternatives]
      .map((alt) => ({ name: alt.name, score: Math.round(score(alt, normalized) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);
    // Robustness: perturb each criterion weight ±25%, renormalize, check if the winner survives.
    let robust = true;
    const perturbations: string[] = [];
    for (const c of input.criteria) {
      for (const factor of [0.75, 1.25]) {
        const perturbed = new Map(normalized);
        perturbed.set(c.id, normalized.get(c.id)! * factor);
        const sum = [...perturbed.values()].reduce((a, b) => a + b, 0);
        for (const [k, v] of perturbed) perturbed.set(k, v / sum);
        const perturbedRanking = [...input.alternatives].map((alt) => ({ name: alt.name, s: score(alt, perturbed) })).sort((a, b) => b.s - a.s);
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
const algorithmSelectSchema = z.object({
  objective: z.string().trim().max(4000).optional(),
  kind: z.enum(PROBLEM_KINDS).optional(),
  features: z.object({
    hasCostMatrix: z.boolean().optional(),
    matrixRows: z.number().int().positive().max(200).optional(),
    matrixCols: z.number().int().positive().max(200).optional(),
    hasEmployees: z.boolean().optional(),
    hasShifts: z.boolean().optional(),
    hasUncertainty: z.boolean().optional(),
    hasTimeSeries: z.boolean().optional(),
    hasCriteria: z.boolean().optional(),
    hasAlternatives: z.boolean().optional(),
    integerVariables: z.boolean().optional(),
    nonlinear: z.boolean().optional(),
  }).strict().optional(),
}).strict();

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

/* ─── Registry ─────────────────────────────────────────── */
import { scaffoldWebappTool, hostExecTool } from './scaffold.js';

/* ─── Plugin tool provider (extensions) ────────────────── */
export interface PluginToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: string[];
  risk: ToolRisk;
  timeoutMs: number;
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
  monteCarloTool,
  statsTool,
  forecastTool,
  decisionTool,
  summaryTool,
  fetchReadTool,
  securityScanTool,
  scaffoldWebappTool,
  hostExecTool,
  orgBuildTool,
  agentsCreateTool,
  algorithmSelectTool,
];

const toolMap = new Map(ALL_TOOLS.map((tool) => [tool.id, tool]));

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

/** Execute a tool with zod validation, permission check, timeout and audit. */
export async function runTool(id: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  const tool = getTool(id, ctx.workspaceId);
  if (!tool) return { ok: false, tool: id, error: `Unknown tool "${id}"`, durationMs: 0 };
  if (ctx.toolAllowlist && !ctx.toolAllowlist.has(id)) {
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { reason: 'not_enabled_for_agent', missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null } });
    return { ok: false, tool: id, error: `Tool "${id}" is not enabled for this agent`, durationMs: Date.now() - started };
  }
  if (tool.permission && !ctx.permissions.has(tool.permission) && !ctx.permissions.has('*')) {
    return { ok: false, tool: id, error: `Permission "${tool.permission}" is required for ${id}`, durationMs: Date.now() - started };
  }
  const missing = (tool.permissions ?? []).filter((permission) => !ctx.permissions.has(permission) && !ctx.permissions.has('*'));
  if (missing.length) {
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.denied', subject: id, detail: { missing } });
    return { ok: false, tool: id, error: `Missing permission(s) for ${id}: ${missing.join(', ')}`, durationMs: Date.now() - started };
  }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, tool: id, error: `Invalid input for ${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, durationMs: Date.now() - started };
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
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.execute', subject: id, detail: { ok: true, durationMs, missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null } });
    return { ok: true, output, tool: id, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'tool.execute', subject: id, detail: { ok: false, error: message.slice(0, 500), durationMs, missionId: ctx.missionId ?? null, taskId: ctx.taskId ?? null } });
    return { ok: false, tool: id, error: message, durationMs };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
