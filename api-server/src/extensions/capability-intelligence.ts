/**
 * WORA capability intelligence — choose a real capability for a problem.
 *
 * Candidates come from the existing registry only: core tools, approved
 * skills, installed plugin/MCP tools, and registered specialists. The result
 * explains why a candidate is available, what it costs, and what is missing.
 * Unknown or unverified plugins are never marked trusted; a gap is returned
 * instead of inventing a capability.
 */
import { getOsDb, parseJson } from '../os/db.js';
import { listAgents, type AgentRecord } from '../os/registry.js';
import { getTool } from '../os/tools.js';
import { SPECIALIZATION_BY_ID } from '../os/specializations.js';
import { resolveCapabilities, type CapabilityProfile } from './capabilities.js';
import { findPackageByKey, listRegisteredTools, getPackage } from './store.js';
import { permissionSensitivity, type TrustLevel } from './manifest.js';

export type CapabilityKind = 'core_tool' | 'skill' | 'plugin' | 'mcp' | 'solver' | 'specialist' | 'combination';

export interface CapabilityCandidate {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  agentId: string | null;
  specialization: string | null;
  tool: string | null;
  version: string | null;
  source: string;
  trust: TrustLevel | 'core';
  permissions: string[];
  network: boolean;
  filesystem: boolean;
  health: 'healthy' | 'error' | 'unknown';
  available: boolean;
  reasons: string[];
  score: number;
  reliability: { executions: number; successes: number; averageLatencyMs: number | null };
  cost: { class: 'free' | 'local' | 'external'; latencyClass: 'low' | 'medium' | 'high' };
}

export interface CapabilityMatch {
  workspaceId: string;
  objective: string;
  agentId: string | null;
  selected: CapabilityCandidate | null;
  candidates: CapabilityCandidate[];
  gap: { missing: string[]; message: string; searchTerms: string[] } | null;
  explanation: string;
  evaluatedAt: string;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'using', 'use', 'run', 'find', 'select', 'best', 'capability', 'capabilities', 'tool', 'tools', 'skill', 'skills', 'extension', 'extensions', 'plugin', 'plugins', 'missing', 'available', 'need', 'needs', 'please']);

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/u).filter((token) => token.length >= 3 && !STOP.has(token)))];
}

function reliability(workspaceId: string, subject: string): CapabilityCandidate['reliability'] {
  const rows = getOsDb().prepare("SELECT detail FROM ext_audit WHERE workspace_id = ? AND subject = ? AND action = 'extension.tool.execute' ORDER BY created_at DESC LIMIT 50").all(workspaceId, subject) as Array<{ detail: string }>;
  let successes = 0; let duration = 0; let measured = 0;
  for (const row of rows) {
    const detail = parseJson<Record<string, unknown>>(row.detail, {});
    if (detail['ok'] === true) successes += 1;
    if (typeof detail['durationMs'] === 'number') { duration += detail['durationMs']; measured += 1; }
  }
  return { executions: rows.length, successes, averageLatencyMs: measured ? Math.round(duration / measured) : null };
}

function trustRank(trust: CapabilityCandidate['trust']): number {
  return trust === 'official' || trust === 'core' ? 4 : trust === 'verified' ? 3 : trust === 'community' ? 1 : -3;
}

function scoreCandidate(candidate: CapabilityCandidate, objective: string, required: string[]): number {
  const text = terms(`${candidate.id} ${candidate.name} ${candidate.description} ${candidate.kind} ${candidate.tool ?? ''}`);
  const objectiveTerms = terms(objective);
  let score = trustRank(candidate.trust) + (candidate.health === 'healthy' ? 2 : candidate.health === 'error' ? -4 : 0);
  let relevance = 0;
  for (const term of objectiveTerms) if (text.includes(term)) { score += 2; relevance += 1; }
  for (const capability of required) {
    if (text.includes(capability.toLowerCase())) { score += 5; relevance += 1; }
    else score -= 1;
  }
  if (candidate.tool) score += 2;
  if (!relevance) score -= 20;
  if (!candidate.available) score -= 10;
  if (candidate.reliability.executions >= 3 && candidate.reliability.successes === candidate.reliability.executions) score += 2;
  if (candidate.reliability.executions >= 3 && candidate.reliability.successes / candidate.reliability.executions < 0.5) score -= 2;
  return score;
}

function pluginMetadata(workspaceId: string, toolId: string): { trust: TrustLevel; network: boolean; filesystem: boolean; version: string | null; description: string } {
  const registered = listRegisteredTools(workspaceId).find((tool) => tool.toolId === toolId);
  if (!registered) return { trust: 'untrusted', network: false, filesystem: false, version: null, description: '' };
  const pkg = getPackage(workspaceId, registered.packageId);
  const manifest = pkg?.manifest as { security?: { network?: boolean; data_access?: string[] }; version?: string; description?: string } | undefined;
  return {
    trust: (pkg?.trust ?? 'untrusted') as TrustLevel,
    network: manifest?.security?.network === true,
    filesystem: (manifest?.security?.data_access ?? []).some((entry) => /file|workspace|disk/i.test(entry)),
    version: pkg?.latestVersion ?? null,
    description: manifest?.description ?? registered.description,
  };
}

function candidatesForAgent(workspaceId: string, agent: AgentRecord, profile: CapabilityProfile, objective: string, required: string[]): CapabilityCandidate[] {
  const registered = new Map(listRegisteredTools(workspaceId, { activeOnly: true }).map((tool) => [tool.toolId, tool]));
  const out: CapabilityCandidate[] = [];
  for (const toolId of profile.tools) {
    const tool = getTool(toolId, workspaceId);
    if (!tool) continue;
    const plugin = registered.get(toolId);
    const meta = plugin ? pluginMetadata(workspaceId, toolId) : null;
    const kind: CapabilityKind = plugin ? (meta?.trust === 'official' ? 'plugin' : (toolId.includes('.mcp.') ? 'mcp' : 'plugin')) : /^or\.|^sim\.|^forecast\./u.test(toolId) ? 'solver' : 'core_tool';
    const missing = [...new Set([...(tool.permissions ?? []), ...(tool.permission ? [tool.permission] : [])])].filter((permission) => !profile.permissions.includes(permission));
    const candidate: CapabilityCandidate = {
      id: `${agent.id}:${toolId}`, kind, name: tool.name, description: plugin?.description ?? tool.description,
      agentId: agent.id, specialization: agent.specialization, tool: toolId,
      version: plugin ? meta?.version ?? null : null, source: plugin ? `plugin:${plugin.pluginKey}` : 'core',
      trust: meta?.trust ?? 'core', permissions: [...new Set([...(tool.permissions ?? []), ...(tool.permission ? [tool.permission] : [])])],
      network: meta?.network ?? false, filesystem: meta?.filesystem ?? false,
      health: plugin?.health ?? 'unknown', available: missing.length === 0,
      reasons: missing.length ? [`missing permission(s): ${missing.join(', ')}`] : [],
      score: 0, reliability: { executions: 0, successes: 0, averageLatencyMs: null },
      cost: { class: plugin ? 'local' : 'free', latencyClass: 'low' },
    };
    candidate.reliability = reliability(workspaceId, toolId);
    candidate.cost = { class: plugin ? 'local' : 'free', latencyClass: candidate.reliability.averageLatencyMs !== null && candidate.reliability.averageLatencyMs > 2_000 ? 'high' : 'low' };
    candidate.score = scoreCandidate(candidate, objective, required);
    out.push(candidate);
  }
  for (const skill of profile.skills) {
    const pkg = findPackageByKey(workspaceId, 'skill', skill.key);
    const toolId = skill.tools.find((tool) => profile.tools.includes(tool)) ?? null;
    const candidate: CapabilityCandidate = {
      id: `${agent.id}:skill:${skill.key}`, kind: 'skill', name: skill.name,
      description: `${skill.description} Selected knowledge; requires ${skill.tools.join(', ') || 'no tool'}.`,
      agentId: agent.id, specialization: agent.specialization, tool: toolId,
      version: skill.version, source: 'skill', trust: (pkg?.trust ?? 'community') as TrustLevel,
      permissions: skill.permissions, network: false, filesystem: false, health: 'healthy',
      available: Boolean(toolId), reasons: toolId ? [] : ['the skill declares no executable tool available to this agent'],
      score: 0, reliability: { executions: 0, successes: 0, averageLatencyMs: null },
      cost: { class: 'free', latencyClass: 'low' },
    };
    candidate.score = scoreCandidate(candidate, objective, required);
    out.push(candidate);
  }
  const spec = SPECIALIZATION_BY_ID.get(agent.specialization);
  if (spec) {
    const candidate: CapabilityCandidate = {
      id: `${agent.id}:specialist`, kind: 'specialist', name: agent.name,
      description: `${spec.label}: ${spec.description}`, agentId: agent.id, specialization: agent.specialization,
      tool: null, version: null, source: 'agent', trust: 'core', permissions: agent.permissions,
      network: false, filesystem: false, health: agent.status === 'active' ? 'healthy' : 'error',
      available: agent.status === 'active', reasons: agent.status === 'active' ? [] : [`agent is ${agent.status}`],
      score: 0, reliability: { executions: 0, successes: 0, averageLatencyMs: null },
      cost: { class: 'free', latencyClass: 'low' },
    };
    candidate.score = scoreCandidate(candidate, objective, required);
    out.push(candidate);
  }
  return out;
}

export function matchCapabilities(input: { workspaceId: string; objective: string; agentId?: string | null; requiredCapabilities?: string[] }): CapabilityMatch {
  const required = (input.requiredCapabilities ?? []).filter(Boolean).slice(0, 12);
  const agents = input.agentId
    ? listAgents(input.workspaceId).filter((agent) => agent.id === input.agentId)
    : listAgents(input.workspaceId).filter((agent) => agent.status === 'active');
  const candidates: CapabilityCandidate[] = [];
  for (const agent of agents.slice(0, 40)) {
    try { candidates.push(...candidatesForAgent(input.workspaceId, agent, resolveCapabilities(input.workspaceId, agent.id), input.objective, required)); }
    catch { /* an invalid/archived agent cannot contribute */ }
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = candidates.find((candidate) => candidate.available && candidate.tool && candidate.score >= 3) ?? null;
  const gap = selected ? null : {
    missing: required.length ? required : terms(input.objective).slice(0, 8),
    message: 'No approved, available and executable capability matched this objective. No extension was installed or invoked.',
    searchTerms: terms(input.objective).slice(0, 8),
  };
  const explanation = selected
    ? `Selected ${selected.kind} ${selected.tool ?? selected.name} via ${selected.agentId} (trust=${selected.trust}, score=${selected.score}); ${selected.reliability.executions} prior execution(s).`
    : `Capability gap: ${gap?.message ?? 'no candidate'} Install or authorize a suitable extension before planning execution.`;
  return { workspaceId: input.workspaceId, objective: input.objective, agentId: selected?.agentId ?? null, selected, candidates: candidates.slice(0, 40), gap, explanation, evaluatedAt: new Date().toISOString() };
}

export function requiredPermissionReview(candidate: CapabilityCandidate) {
  return candidate.permissions.map((permission) => ({ permission, sensitivity: permissionSensitivity(permission) }));
}
