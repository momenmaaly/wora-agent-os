/**
 * WORA OS — virtual organization builder.
 *
 * Turns an objective into a persisted organization: departments, a leadership
 * spine, specialist agents with reporting lines, one backing project and a
 * kickoff mission whose plan starts real work. Structure adapts to the
 * objective via three templates (marketplace/commerce, software/product,
 * general business) — never a fixed one-size chart.
 */
import { getOsDb, newId, nowIso, audit } from './db.js';
import { createAgent, listAgents } from './registry.js';
import { createMission, executeMission } from './orchestrator.js';

export interface OrgDepartment {
  id: string;
  name: string;
  mission: string;
  managerRole: string;
  managerAgentId: string | null;
  agentIds: string[];
  kpis: string[];
}
export interface OrgStructure {
  template: string;
  objective: string;
  leadership: Array<{ title: string; agentId: string | null }>;
  departments: OrgDepartment[];
  reporting: Array<{ from: string; to: string }>;
  createdAt: string;
}

interface DeptSpec { name: string; mission: string; specialization: string; kpis: string[] }

const TEMPLATES: Array<{ id: string; match: RegExp; leadership: string; departments: DeptSpec[] }> = [
  {
    id: 'commerce-marketplace',
    match: /marketplace|e-?commerce|online store|سوق|تجارة/i,
    leadership: 'Managing Director — Marketplace',
    departments: [
      { name: 'Product', mission: 'Marketplace scope, roadmap and acceptance criteria', specialization: 'product_manager', kpis: ['scope signed off', 'weekly delivery'] },
      { name: 'Engineering', mission: 'Platform, API and storefront delivery', specialization: 'software_engineer', kpis: ['uptime', 'cycle time', 'defect rate'] },
      { name: 'Design & Frontend', mission: 'Buyer/seller experience', specialization: 'frontend_engineer', kpis: ['task success rate'] },
      { name: 'Operations', mission: 'Logistics, fulfillment and capacity planning', specialization: 'operations_research', kpis: ['delivery SLA', 'cost per order'] },
      { name: 'Marketing', mission: 'Launch and demand generation', specialization: 'marketing_specialist', kpis: ['CAC', 'activation rate'] },
      { name: 'Finance', mission: 'Unit economics, budget and pricing', specialization: 'finance_analyst', kpis: ['contribution margin'] },
      { name: 'Security & Trust', mission: 'Fraud, payments and platform security', specialization: 'security_engineer', kpis: ['incidents', 'audit pass rate'] },
      { name: 'Customer Support', mission: 'Buyer and seller support operations', specialization: 'generalist', kpis: ['first response time'] },
    ],
  },
  {
    id: 'software-product',
    match: /software|application|app\b|platform|saas|product|تطبيق|برمج/i,
    leadership: 'Engineering Director',
    departments: [
      { name: 'Product', mission: 'Scope, priorities and acceptance criteria', specialization: 'product_manager', kpis: ['scope clarity', 'delivery cadence'] },
      { name: 'Engineering', mission: 'Architecture and implementation', specialization: 'software_engineer', kpis: ['cycle time', 'defect escape rate'] },
      { name: 'Frontend', mission: 'User experience implementation', specialization: 'frontend_engineer', kpis: ['accessibility score'] },
      { name: 'Backend & Data', mission: 'APIs, data model and reliability', specialization: 'backend_engineer', kpis: ['p95 latency', 'error budget'] },
      { name: 'Quality', mission: 'Test strategy, execution and release confidence', specialization: 'qa_engineer', kpis: ['coverage', 'escaped defects'] },
      { name: 'Security', mission: 'Threat modeling and hardening', specialization: 'security_engineer', kpis: ['open criticals', 'review coverage'] },
    ],
  },
  {
    id: 'general-business',
    match: /.*/,
    leadership: 'Managing Director',
    departments: [
      { name: 'Operations', mission: 'Process execution and optimization', specialization: 'operations_research', kpis: ['throughput', 'cost per unit'] },
      { name: 'Delivery', mission: 'Project planning and execution', specialization: 'project_manager', kpis: ['on-time delivery', 'budget adherence'] },
      { name: 'Analysis', mission: 'Data, reporting and decision support', specialization: 'data_analyst', kpis: ['decision latency'] },
      { name: 'Finance', mission: 'Budgeting, costing and margins', specialization: 'finance_analyst', kpis: ['budget variance'] },
      { name: 'Research', mission: 'Market and competitive intelligence', specialization: 'research', kpis: ['insight coverage'] },
      { name: 'Security & IT', mission: 'Infrastructure and access hygiene', specialization: 'system_administrator', kpis: ['patch currency', 'uptime'] },
    ],
  },
];

export interface BuildOrgInput {
  workspaceId: string;
  objective: string;
  name?: string;
  actor?: string;
}

export interface BuildOrgResult {
  organizationId: string;
  name: string;
  template: string;
  projectId: string;
  kickoffMissionId: string;
  departments: OrgDepartment[];
  agentsCreated: number;
  agentsReused: number;
  reporting: Array<{ from: string; to: string }>;
}

function getOrCreateAgent(workspaceId: string, role: string, specialization: string, actor: string): { id: string; created: boolean } {
  const existing = listAgents(workspaceId, { specialization }).find((a) => a.role === role);
  if (existing) return { id: existing.id, created: false };
  const agent = createAgent({
    workspaceId,
    name: role,
    role: `${role} — part of the virtual organization. Specialization: ${specialization}.`,
    specialization,
    source: 'organization',
    actor,
  });
  return { id: agent.id, created: true };
}

export async function buildOrganization(input: BuildOrgInput): Promise<BuildOrgResult> {
  const objective = input.objective.trim();
  if (objective.length < 10) throw new Error('Describe the organization objective in at least 10 characters');
  const template = TEMPLATES.find((t) => t.match.test(objective)) ?? TEMPLATES[TEMPLATES.length - 1]!;
  const name = (input.name?.trim() || objective.split(/[.!?\n]/)[0]!.trim().slice(0, 60) || 'WORA Organization');
  const db = getOsDb();
  const ts = nowIso();
  const actor = input.actor ?? 'user';

  const leadershipAgent = createAgent({
    workspaceId: input.workspaceId,
    name: template.leadership,
    role: `Executive owner of "${name}". Objective: ${objective.slice(0, 300)}`,
    specialization: 'organization_manager',
    source: 'organization',
    actor,
  });

  let agentsCreated = 1, agentsReused = 0;
  const departments: OrgDepartment[] = [];
  const reporting: Array<{ from: string; to: string }> = [];
  for (const spec of template.departments) {
    const managerRole = `${spec.name} Manager`;
    const result = getOrCreateAgent(input.workspaceId, managerRole, spec.specialization, actor);
    if (result.created) agentsCreated += 1; else agentsReused += 1;
    const deptId = newId('dep');
    departments.push({
      id: deptId,
      name: spec.name,
      mission: spec.mission,
      managerRole,
      managerAgentId: result.id,
      agentIds: [result.id],
      kpis: spec.kpis,
    });
    reporting.push({ from: result.id, to: leadershipAgent.id });
  }

  const structure: OrgStructure = {
    template: template.id,
    objective,
    leadership: [{ title: template.leadership, agentId: leadershipAgent.id }],
    departments,
    reporting,
    createdAt: ts,
  };
  const organizationId = newId('org');
  db.prepare('INSERT INTO os_organizations (id, workspace_id, name, objective, structure, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(organizationId, input.workspaceId, name, objective, JSON.stringify(structure), ts);

  const projectId = newId('prj');
  db.prepare('INSERT INTO os_projects (id, workspace_id, org_id, name, objective, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, input.workspaceId, organizationId, `${name} — Delivery`, objective.slice(0, 500), 'active', ts);

  // Kickoff mission: real, tracked work starting now. Track forced to the
  // default analysis pipeline so this never recurses into org.build.
  const kickoffMissionId = createMission({
    workspaceId: input.workspaceId,
    objective: `Kickoff for "${name}": review the objective, extract requirements and record the execution plan. Objective: ${objective}`,
    actor,
    track: 'generic',
    requestedBy: 'organization',
  });
  // Fire and forget; failures are recorded on the mission itself.
  void executeMission(kickoffMissionId, actor).catch(() => { /* surfaced in mission status */ });

  audit(db, { workspaceId: input.workspaceId, actor, action: 'organization.build', subject: organizationId, detail: { name, template: template.id, departments: departments.length, agentsCreated, agentsReused } });

  return { organizationId, name, template: template.id, projectId, kickoffMissionId, departments, agentsCreated, agentsReused, reporting };
}

export function listOrganizations(workspaceId: string) {
  const db = getOsDb();
  const rows = db.prepare('SELECT id, name, objective, structure, created_at FROM os_organizations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20').all(workspaceId) as Array<{ id: string; name: string; objective: string; structure: string; created_at: string }>;
  return rows.map((row) => {
    let structure: OrgStructure | null = null;
    try { structure = JSON.parse(row.structure) as OrgStructure; } catch { structure = null; }
    return { id: row.id, name: row.name, objective: row.objective, template: structure?.template ?? 'unknown', departments: structure?.departments ?? [], leadership: structure?.leadership ?? [], createdAt: row.created_at };
  });
}
