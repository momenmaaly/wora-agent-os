/**
 * WORA OS — digital twins.
 *
 * A twin is a persistent, workspace-scoped model of a real operational entity
 * (a store, a warehouse, a pipeline, a service, a custom process): its drivers
 * (three-point PERT parameters), KPI definitions and an append-only event log.
 * What-if scenarios re-run the seeded Monte Carlo simulator with adjusted
 * drivers and report baseline-vs-scenario deltas. Results are SIMULATED —
 * labeled `simulated: true` — never presented as measurements of live systems.
 * No telemetry is invented; the only real-world inputs are what the operator
 * records (observations/events) on this twin.
 */
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { runTool } from './tools.js';

export type TwinDriver = { name: string; optimistic: number; likely: number; pessimistic: number };
export type TwinKpi = { id: string; label: string; unit: string; target?: number };
export type TwinEvent = { id: string; type: 'observation' | 'scenario' | 'note'; payload: Record<string, unknown>; createdAt: string };

export interface TwinRecord {
  id: string;
  workspaceId: string;
  name: string;
  entityType: string;
  params: { drivers: TwinDriver[]; notes: string };
  kpis: TwinKpi[];
  events: TwinEvent[];
  createdAt: string;
  updatedAt: string;
}

interface TwinRow {
  id: string; workspace_id: string; name: string; entity_type: string;
  params: string; kpis: string; events: string; created_at: string; updated_at: string;
}

const EVENT_CAP = 200;

function rowToTwin(row: TwinRow): TwinRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    entityType: row.entity_type,
    params: parseJson(row.params, { drivers: [], notes: '' }),
    kpis: parseJson(row.kpis, []),
    events: parseJson(row.events, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTwin(input: { workspaceId: string; name: string; entityType: string; drivers: TwinDriver[]; kpis?: TwinKpi[]; notes?: string; actor?: string }): TwinRecord {
  if (!input.name?.trim()) throw new Error('Twin name is required');
  if (!Array.isArray(input.drivers) || input.drivers.length === 0) throw new Error('At least one driver is required');
  for (const d of input.drivers) {
    for (const key of ['optimistic', 'likely', 'pessimistic'] as const) {
      if (!Number.isFinite(d[key])) throw new Error(`Driver "${d.name}" has a non-finite ${key}`);
    }
  }
  const db = getOsDb();
  const id = newId('twin');
  const ts = nowIso();
  db.prepare('INSERT INTO os_twins (id, workspace_id, name, entity_type, params, kpis, events, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.workspaceId, input.name.trim().slice(0, 120), (input.entityType || 'custom').slice(0, 60),
      JSON.stringify({ drivers: input.drivers.slice(0, 50), notes: (input.notes ?? '').slice(0, 2000) }),
      JSON.stringify((input.kpis ?? []).slice(0, 30)), JSON.stringify([]), ts, ts);
  audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'twin.create', subject: id, detail: { name: input.name, drivers: input.drivers.length } });
  return getTwin(input.workspaceId, id)!;
}

export function getTwin(workspaceId: string, id: string): TwinRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_twins WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as unknown as TwinRow | undefined;
  return row ? rowToTwin(row) : null;
}

export function listTwins(workspaceId: string): TwinRecord[] {
  const rows = getOsDb().prepare('SELECT * FROM os_twins WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50').all(workspaceId) as unknown as TwinRow[];
  return rows.map(rowToTwin);
}

export function deleteTwin(workspaceId: string, id: string, actor = 'user'): boolean {
  const db = getOsDb();
  const row = db.prepare('SELECT id FROM os_twins WHERE workspace_id = ? AND id = ?').get(workspaceId, id);
  if (!row) return false;
  db.prepare('DELETE FROM os_twins WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
  audit(db, { workspaceId, actor, action: 'twin.delete', subject: id });
  return true;
}

function appendEvent(twin: TwinRecord, event: Omit<TwinEvent, 'id' | 'createdAt'>, actor: string): TwinEvent {
  const db = getOsDb();
  const entry: TwinEvent = { id: newId('twin_ev'), createdAt: nowIso(), ...event };
  const events = [...twin.events, entry].slice(-EVENT_CAP);
  db.prepare('UPDATE os_twins SET events = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(events), nowIso(), twin.id);
  audit(db, { workspaceId: twin.workspaceId, actor, action: 'twin.event', subject: twin.id, detail: { type: event.type } });
  return entry;
}

export function recordObservation(workspaceId: string, id: string, payload: Record<string, unknown>, actor = 'user'): TwinEvent | null {
  const twin = getTwin(workspaceId, id);
  if (!twin) return null;
  return appendEvent(twin, { type: 'observation', payload: payload ?? {} }, actor);
}

export interface TwinScenarioResult {
  simulated: true;
  baseline: { p10: number; p50: number; p90: number; mean: number };
  scenario: { p10: number; p50: number; p90: number; mean: number };
  deltaP50: number;
  deltaP90: number;
  deltaMeanPct: number;
  adjustments: Array<{ driver: string; op: 'mul' | 'add'; value: number }>;
  trials: number;
  seed: number;
}

/** What-if: re-run the seeded Monte Carlo with adjusted PERT drivers. Simulated, reproducible, labeled. */
export async function runScenario(workspaceId: string, id: string, input: {
  name: string;
  adjustments: Array<{ driver: string; op: 'mul' | 'add'; value: number }>;
  trials?: number;
  seed?: number;
  actor?: string;
}): Promise<TwinScenarioResult> {
  const twin = getTwin(workspaceId, id);
  if (!twin) throw new Error('Twin not found');
  const trials = Math.min(Math.max(Math.floor(input.trials ?? 5000), 100), 50_000);
  const seed = Math.floor(input.seed ?? 42);
  const baselineInput = { trials, seed, items: twin.params.drivers };
  const adjustedDrivers = twin.params.drivers.map((driver) => {
    const adj = input.adjustments.find((a) => a.driver === driver.name);
    if (!adj) return driver;
    const apply = (v: number) => (adj.op === 'mul' ? v * adj.value : v + adj.value);
    return { ...driver, optimistic: apply(driver.optimistic), likely: apply(driver.likely), pessimistic: apply(driver.pessimistic) };
  });
  const [baseRun, scenarioRun] = await Promise.all([
    runTool('sim.monte_carlo', baselineInput, { workspaceId, actor: input.actor ?? 'user', permissions: new Set(['*']) }),
    runTool('sim.monte_carlo', { trials, seed, items: adjustedDrivers }, { workspaceId, actor: input.actor ?? 'user', permissions: new Set(['*']) }),
  ]);
  if (!baseRun.ok || !scenarioRun.ok) throw new Error('Simulation failed');
  const base = baseRun.output as Record<string, number>;
  const scen = scenarioRun.output as Record<string, number>;
  const result: TwinScenarioResult = {
    simulated: true,
    baseline: { p10: base['p10']!, p50: base['p50']!, p90: base['p90']!, mean: base['mean']! },
    scenario: { p10: scen['p10']!, p50: scen['p50']!, p90: scen['p90']!, mean: scen['mean']! },
    deltaP50: Math.round((scen['p50']! - base['p50']!) * 100) / 100,
    deltaP90: Math.round((scen['p90']! - base['p90']!) * 100) / 100,
    deltaMeanPct: base['mean'] ? Math.round(((scen['mean']! - base['mean']!) / base['mean']!) * 10_000) / 100 : 0,
    adjustments: input.adjustments,
    trials,
    seed,
  };
  appendEvent(twin, { type: 'scenario', payload: { name: input.name.slice(0, 120), ...result } }, input.actor ?? 'user');
  return result;
}
