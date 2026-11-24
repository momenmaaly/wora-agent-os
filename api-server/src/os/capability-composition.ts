/**
 * WORA OS — capability composition over the real registry.
 *
 * A graph node is executable only when the existing capability registry has an
 * approved, available tool and an eligible agent. The graph never installs a
 * package, invents a tool, or grants a permission. Selected nodes become real
 * PlanTasks and run through the normal orchestrator and Tool Registry.
 */
import { getOsDb, newId, nowIso, parseJson } from './db.js';
import { listRegisteredTools } from '../extensions/store.js';
import { getTool } from './tools.js';
import { listCapabilityCandidates, type CapabilityCandidate } from '../extensions/capability-intelligence.js';
import { modelProblem, type UnifiedProblem } from './problem-model.js';
import { synthesizeCompositionStrategy, type CompositionStrategyDecision } from './strategy-synthesis.js';
import type { PlanTask } from './orchestrator.js';

export const COMPOSITION_SCHEMA_VERSION = '1.0';

export type CompositionRole = 'context' | 'primary' | 'support' | 'integration';
export type CompositionRisk = 'low' | 'medium' | 'high';

export interface CompositionNode {
  id: string;
  title: string;
  objective: string;
  role: CompositionRole;
  capabilityKind: CapabilityCandidate['kind'];
  tool: string;
  skillKeys: string[];
  agentId: string | null;
  specialization: string;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
  preconditions: string[];
  postconditions: string[];
  permissions: string[];
  permissionsApproved: string[];
  available: boolean;
  risk: CompositionRisk;
  costClass: CapabilityCandidate['cost']['class'];
  latencyClass: CapabilityCandidate['cost']['latencyClass'];
  verification: string[];
  fallbackTools: string[];
  reason: string;
}

export interface CompositionGap {
  node: string | null;
  message: string;
  missing: string[];
}

export interface CompositionGraph {
  schemaVersion: typeof COMPOSITION_SCHEMA_VERSION;
  workspaceId: string;
  objective: string;
  nodes: CompositionNode[];
  edges: Array<{ from: string; to: string; kind: 'dependency' | 'data' }>;
  gaps: CompositionGap[];
  explanation: string;
  createdAt: string;
}

export interface ComposedMission {
  model: UnifiedProblem;
  graph: CompositionGraph;
  strategy: CompositionStrategyDecision;
  tasks: PlanTask[];
}

export interface CompositionRecord {
  id: string;
  workspaceId: string;
  missionId: string;
  graph: CompositionGraph;
  selectedStrategy: string;
  strategies: CompositionStrategyDecision['candidates'];
  gaps: CompositionGap[];
  explanation: string;
  createdAt: string;
  updatedAt: string;
}

function explicitSeries(objective: string): number[] {
  const match = /\[([0-9.,\s+-]+)\]/u.exec(objective);
  if (!match?.[1]) return [];
  return match[1].split(',').map((value) => value.trim()).filter(Boolean).map(Number).filter((value) => Number.isFinite(value));
}

function inputFor(tool: string, objective: string): Record<string, unknown> | null {
  if (tool === 'text.extract_summary') return { text: objective, sentences: 3 };
  if (tool === 'stats.describe') {
    const series = explicitSeries(objective);
    return series.length >= 3 ? { series } : null;
  }
  if (/\.echo$/u.test(tool)) return { text: objective };
  return null;
}

function canBuildInput(tool: string, objective: string, workspaceId: string): boolean {
  const input = inputFor(tool, objective);
  const definition = getTool(tool, workspaceId);
  if (!input || !definition) return false;
  const required = definition.inputSchema?.['required'];
  return !Array.isArray(required) || required.every((key) => typeof key === 'string' && key in input);
}

function schemaProperties(tool: string, workspaceId: string): string[] {
  const definition = getTool(tool, workspaceId);
  const properties = definition?.inputSchema?.['properties'];
  return properties && typeof properties === 'object' ? Object.keys(properties as Record<string, unknown>) : [];
}

function compatibleFallbacks(candidate: CapabilityCandidate, candidates: CapabilityCandidate[], workspaceId: string): string[] {
  if (!candidate.tool) return [];
  const target = getTool(candidate.tool, workspaceId);
  if (!target) return [];
  const targetSchema = JSON.stringify(target.inputSchema ?? {});
  const registered = new Map(listRegisteredTools(workspaceId).map((tool) => [tool.toolId, tool]));
  const targetOutput = JSON.stringify(registered.get(candidate.tool)?.outputSchema ?? null);
  return candidates
    .filter((entry) => entry.id !== candidate.id && entry.available && entry.tool && entry.tool !== candidate.tool
      && (entry.kind === 'plugin' || entry.kind === 'mcp') === (candidate.kind === 'plugin' || candidate.kind === 'mcp'))
    .filter((entry) => {
      const fallback = getTool(entry.tool!, workspaceId);
      const output = JSON.stringify(registered.get(entry.tool!)?.outputSchema ?? null);
      return Boolean(fallback) && JSON.stringify(fallback?.inputSchema ?? {}) === targetSchema && output === targetOutput;
    })
    .map((entry) => entry.tool!)
    .filter((tool, index, all) => all.indexOf(tool) === index)
    .slice(0, 3);
}

function nodeFor(candidate: CapabilityCandidate, role: CompositionRole, objective: string, workspaceId: string, dependsOn: string[], candidates: CapabilityCandidate[], skillKeys: string[] = []): CompositionNode {
  const tool = candidate.tool!;
  const definition = getTool(tool, workspaceId)!;
  return {
    id: `node-${role}-${tool.replace(/[^a-z0-9]+/gi, '-')}`,
    title: role === 'context' ? `Analyze requirements with ${candidate.name}` : `Execute ${candidate.name}`,
    objective: role === 'context' ? `Extract the actionable requirements and open questions from: ${objective}` : `Execute ${tool} for: ${objective}`.slice(0, 4_000),
    role,
    capabilityKind: candidate.kind,
    tool,
    skillKeys,
    agentId: candidate.agentId,
    specialization: candidate.specialization ?? 'generalist',
    dependsOn,
    inputs: schemaProperties(tool, workspaceId),
    outputs: ['verified tool output', 'acceptance evidence'],
    preconditions: ['The assigned agent holds the required tool and permissions', 'The tool is enabled and healthy'],
    postconditions: ['The tool executed without an execution error', 'Independent verification accepted the actual output'],
    permissions: [...candidate.permissions],
    permissionsApproved: candidate.available ? [...candidate.permissions] : [],
    available: candidate.available,
    risk: (definition.risk ?? 'low') as CompositionRisk,
    costClass: candidate.cost.class,
    latencyClass: candidate.cost.latencyClass,
    verification: ['Independent artifact and acceptance review', 'Capability snapshot and audit record'],
    fallbackTools: compatibleFallbacks(candidate, candidates, workspaceId),
    reason: `${candidate.kind} selected from the existing registry (trust=${candidate.trust}, health=${candidate.health}, score=${candidate.score}).`,
  };
}

export function buildCompositionGraph(input: { workspaceId: string; objective: string; model?: UnifiedProblem }): CompositionGraph {
  const model = input.model ?? modelProblem({ workspaceId: input.workspaceId, objective: input.objective });
  const candidates = listCapabilityCandidates({ workspaceId: input.workspaceId, objective: input.objective });
  const usable = candidates.filter((candidate) => candidate.available && candidate.tool);
  const gaps: CompositionGap[] = [];
  const nodes: CompositionNode[] = [];
  const byTool = (tool: string) => usable.find((candidate) => candidate.tool === tool);

  const summary = byTool('text.extract_summary');
  const skill = usable.find((candidate) => candidate.kind === 'skill' && candidate.available);
  const skillKeys = skill ? [skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')] : [];
  const contextCandidate = skill
    ? usable.find((candidate) => candidate.tool === 'text.extract_summary' && candidate.agentId === skill.agentId) ?? summary
    : summary;
  const contextNode = contextCandidate ? nodeFor(contextCandidate, 'context', input.objective, input.workspaceId, [], candidates, skillKeys) : null;
  if (contextNode) nodes.push(contextNode);

  const needs = new Set(model.needs);
  let primary: CompositionNode | null = null;
  const primaryTool = model.baseProfile.algorithmSelection.primary?.toolId;
  if (primaryTool && !model.baseProfile.algorithmSelection.missingInputsBlockExecution) {
    const candidate = byTool(primaryTool);
    if (candidate && canBuildInput(primaryTool, input.objective, input.workspaceId)) {
      primary = nodeFor(candidate, 'primary', input.objective, input.workspaceId, contextNode ? [contextNode.id] : [], candidates);
      nodes.push(primary);
    } else {
      gaps.push({ node: null, message: candidate
        ? `The selected scientific tool ${primaryTool} needs structured inputs that were not supplied; it was not executed with invented data.`
        : `The selected scientific tool ${primaryTool} is not authorized for any active agent.`, missing: [primaryTool] });
    }
  }
  if (!primary && needs.has('simulation')) {
    const candidate = byTool('sim.monte_carlo');
    if (candidate) { primary = nodeFor(candidate, 'primary', input.objective, input.workspaceId, contextNode ? [contextNode.id] : [], candidates); nodes.push(primary); }
  }
  if (!primary && needs.has('decision')) {
    const candidate = byTool('decision.weighted_matrix');
    if (candidate) { primary = nodeFor(candidate, 'primary', input.objective, input.workspaceId, contextNode ? [contextNode.id] : [], candidates); nodes.push(primary); }
  }
  if (!primary && needs.has('statistics')) {
    const candidate = byTool('stats.describe');
    if (candidate && canBuildInput('stats.describe', input.objective, input.workspaceId)) {
      primary = nodeFor(candidate, 'primary', input.objective, input.workspaceId, contextNode ? [contextNode.id] : [], candidates);
      nodes.push(primary);
    }
  }

  const integration = needs.has('integration')
    ? usable.find((candidate) => (candidate.kind === 'plugin' || candidate.kind === 'mcp') && candidate.tool
      && canBuildInput(candidate.tool!, input.objective, input.workspaceId))
    : null;
  if (integration) {
    nodes.push(nodeFor(integration, 'integration', input.objective, input.workspaceId, contextNode ? [contextNode.id] : [], candidates));
  }

  const addGap = (need: string, message: string) => {
    if (!gaps.some((gap) => gap.missing.includes(need))) gaps.push({ node: null, message, missing: [need] });
  };
  if (!nodes.some((node) => node.tool === 'text.extract_summary')) addGap('analysis', 'No authorized agent can run the deterministic analysis capability.');
  if (needs.has('integration') && !integration) addGap('integration', 'No approved, enabled plugin/MCP integration is available to the active agents.');
  if (needs.has('statistics') && !nodes.some((node) => node.tool === 'stats.describe')) {
    addGap('statistics', explicitSeries(input.objective).length >= 3
      ? 'No authorized descriptive-statistics capability is available.'
      : 'A descriptive-statistics task needs an explicit numeric series; none was supplied.');
  }
  if (needs.has('simulation') && !nodes.some((node) => node.tool === 'sim.monte_carlo')) addGap('simulation', 'No authorized simulation capability is available.');
  if (needs.has('decision') && !nodes.some((node) => node.tool === 'decision.weighted_matrix')) addGap('decision', 'No authorized multi-criteria decision capability is available.');
  if ((needs.has('optimization') || needs.has('scheduling') || needs.has('assignment')) && !nodes.some((node) => node.role === 'primary')) {
    addGap('optimization', 'No authorized solver matches the stated optimization problem and inputs.');
  }
  if (!nodes.length && !gaps.length) {
    gaps.push({
      node: null,
      message: 'No approved, available executable capability matched this problem. No extension was installed or invoked.',
      missing: [...needs].filter((need) => need !== 'verification'),
    });
  }
  const edges = nodes.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id, kind: 'dependency' as const })));
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    objective: input.objective,
    nodes,
    edges,
    gaps,
    explanation: nodes.length
      ? `Composed ${nodes.length} executable node(s): ${nodes.map((node) => `${node.role}:${node.tool}`).join(' → ')}. ${gaps.length ? `Gaps: ${gaps.map((gap) => gap.message).join('; ')}` : 'All selected capabilities are approved and available.'}`
      : `Capability gap: ${gaps.map((gap) => gap.message).join('; ')}`,
    createdAt: new Date().toISOString(),
  };
}

function planFromGraph(graph: CompositionGraph, selectedIds: string[]): PlanTask[] {
  const selected = graph.nodes.filter((node) => selectedIds.includes(node.id));
  const order = new Map(selected.map((node, index) => [node.id, index]));
  return selected.map((node) => ({
    title: node.title,
    objective: node.objective,
    specialization: node.specialization,
    agentId: node.agentId ?? undefined,
    tool: node.tool,
    toolInput: inputFor(node.tool, graph.objective) ?? {}, 
    dependsOn: node.dependsOn.map((id) => order.get(id)).filter((index): index is number => index !== undefined),
    acceptance: [
      `${node.tool} executes without an execution error`,
      'The actual output satisfies the deterministic acceptance review',
      'Independent verification records a passed result',
      ...(node.skillKeys.length ? ['Selected skill knowledge is recorded with version and digest'] : []),
    ],
    detail: `composition:${node.id}; role=${node.role}; kind=${node.capabilityKind}; ${node.reason}${node.fallbackTools.length ? `; compatible fallback(s): ${node.fallbackTools.join(', ')}` : ''}`,
    fallbackTools: node.fallbackTools,
  }));
}

export function composeMissionPlan(input: { workspaceId: string; objective: string; track?: string; model?: UnifiedProblem }): ComposedMission {
  const model = input.model ?? modelProblem({ workspaceId: input.workspaceId, objective: input.objective, track: input.track });
  const graph = buildCompositionGraph({ workspaceId: input.workspaceId, objective: input.objective, model });
  const strategy = synthesizeCompositionStrategy(graph, model);
  const selectedIds = strategy.selected?.nodeIds ?? [];
  let tasks = planFromGraph(graph, selectedIds);
  if (graph.gaps.length) {
    const gapText = `CAPABILITY GAP — ${graph.gaps.map((gap) => `${gap.missing.join(', ')}: ${gap.message}`).join(' | ')}. No unapproved capability was installed or invoked.`;
    tasks.push({
      title: 'Report the capability gap honestly',
      objective: input.objective,
      specialization: 'generalist',
      tool: 'text.extract_summary',
      toolInput: { text: gapText, sentences: 4 },
      dependsOn: [],
      acceptance: ['The gap is stated explicitly', 'No unapproved capability is invoked', 'The missing capabilities are recorded'],
      detail: `composition-gap: ${graph.gaps.map((gap) => gap.message).join('; ')}`,
    });
  }
  if (!tasks.length) {
    tasks = [{
      title: 'Report the capability gap honestly',
      objective: input.objective,
      specialization: 'generalist',
      tool: 'text.extract_summary',
      toolInput: {
        text: `CAPABILITY GAP — ${strategy.gap ?? graph.gaps.map((gap) => gap.message).join('; ')}. No unapproved capability was installed or invoked.`,
        sentences: 3,
      },
      dependsOn: [],
      acceptance: ['The gap is stated explicitly', 'No unapproved capability is invoked', 'The missing capabilities are recorded'],
      detail: `composition-gap: ${graph.gaps.map((gap) => gap.message).join('; ')}`,
    }];
  }
  return { model, graph, strategy, tasks };
}

export function saveComposition(workspaceId: string, missionId: string, composed: Pick<ComposedMission, 'graph' | 'strategy'>): CompositionRecord {
  const db = getOsDb();
  const existing = db.prepare('SELECT id, created_at FROM os_capability_compositions WHERE workspace_id = ? AND mission_id = ?').get(workspaceId, missionId) as { id?: string; created_at?: string } | undefined;
  const ts = nowIso();
  const values = [
    JSON.stringify(composed.graph).slice(0, 120_000),
    composed.strategy.selected?.id ?? '',
    JSON.stringify(composed.strategy.candidates).slice(0, 80_000),
    JSON.stringify(composed.graph.gaps).slice(0, 20_000),
    composed.strategy.explanation.slice(0, 4_000),
    ts,
  ] as const;
  if (existing?.id) {
    db.prepare('UPDATE os_capability_compositions SET graph = ?, selected_strategy = ?, strategies = ?, gaps = ?, explanation = ?, updated_at = ? WHERE workspace_id = ? AND mission_id = ?')
      .run(...values, workspaceId, missionId);
    return getComposition(workspaceId, missionId)!;
  }
  db.prepare('INSERT INTO os_capability_compositions (id, workspace_id, mission_id, graph, selected_strategy, strategies, gaps, explanation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('cmp'), workspaceId, missionId, ...values.slice(0, 5), ts, ts);
  return getComposition(workspaceId, missionId)!;
}

export function getComposition(workspaceId: string, missionId: string): CompositionRecord | null {
  const row = getOsDb().prepare('SELECT * FROM os_capability_compositions WHERE workspace_id = ? AND mission_id = ?')
    .get(workspaceId, missionId) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    id: String(row['id']), workspaceId: String(row['workspace_id']), missionId: String(row['mission_id']),
    graph: parseJson<CompositionGraph>(String(row['graph'] ?? '{}'), {} as CompositionGraph),
    selectedStrategy: String(row['selected_strategy'] ?? ''),
    strategies: parseJson<CompositionStrategyDecision['candidates']>(String(row['strategies'] ?? '[]'), []),
    gaps: parseJson<CompositionGap[]>(String(row['gaps'] ?? '[]'), []),
    explanation: String(row['explanation'] ?? ''),
    createdAt: String(row['created_at']), updatedAt: String(row['updated_at']),
  };
}
