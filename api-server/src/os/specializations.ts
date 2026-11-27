/**
 * WORA OS — specialization catalog.
 *
 * First-class specializations the orchestrator can plan against and users can
 * instantiate as persistent agents. Each entry declares the default skills,
 * tool allow-list, permission set and a least-privilege risk ceiling. Agents
 * created from these presets remain ordinary editable records.
 */

export interface Specialization {
  id: string;
  label: string;
  description: string;
  skills: string[];
  tools: string[];
  permissions: string[];
  modelTier: 'planning' | 'coding' | 'analysis' | 'general';
  keywords: RegExp[];
}

export const SPECIALIZATIONS: Specialization[] = [
  { id: 'research', label: 'Research Agent', description: 'Gathers, verifies and synthesizes information from authorized sources, including real browser research.', skills: ['research', 'source-verification', 'synthesis', 'browser-research'], tools: ['web.fetch_read', 'text.extract_summary', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.research', 'browser.close', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'], permissions: ['web:read', 'browser:read', 'runtime:read', 'runtime:write', 'memory:read'], modelTier: 'analysis', keywords: [/research/i, /investigate/i, /market (study|analysis)/i, /بحث/i] },
  { id: 'software_engineer', label: 'Software Engineering Agent', description: 'Designs architectures, writes and reviews production code.', skills: ['architecture', 'code-review', 'implementation'], tools: ['fs.workspace_read', 'security.scan', 'host.exec', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'], permissions: ['workspace:read', 'workspace:write', 'host:exec', 'runtime:read', 'runtime:write', 'runtime:execute'], modelTier: 'coding', keywords: [/architect/i, /design.*(system|software)/i] },
  { id: 'frontend_engineer', label: 'Frontend Engineer', description: 'Builds responsive, accessible user interfaces.', skills: ['react', 'css', 'ux-implementation', 'accessibility'], tools: ['scaffold.webapp', 'fs.workspace_read'], permissions: ['workspace:read', 'workspace:write'], modelTier: 'coding', keywords: [/frontend/i, /front-end/i, /ui\b/i, /واجهة/i] },
  { id: 'backend_engineer', label: 'Backend Engineer', description: 'Builds APIs, data models and server-side logic.', skills: ['api-design', 'databases', 'node'], tools: ['scaffold.webapp', 'fs.workspace_read'], permissions: ['workspace:read', 'workspace:write'], modelTier: 'coding', keywords: [/backend/i, /back-end/i, /api\b/i, /server/i] },
  { id: 'qa_engineer', label: 'QA Engineer', description: 'Writes and runs tests; validates acceptance criteria with evidence.', skills: ['test-design', 'test-execution', 'bug-triage'], tools: ['host.exec', 'fs.workspace_read', 'cloud.exec', 'cloud.read_file', 'cloud.list_files'], permissions: ['workspace:read', 'host:exec', 'runtime:read', 'runtime:execute'], modelTier: 'coding', keywords: [/test/i, /qa\b/i, /quality/i, /اختبار/i] },
  { id: 'security_engineer', label: 'Security Engineer', description: 'Threat-models, reviews and hardens systems and code.', skills: ['threat-modeling', 'secure-review', 'secrets-scan'], tools: ['security.scan', 'fs.workspace_read'], permissions: ['workspace:read'], modelTier: 'analysis', keywords: [/security/i, /secure/i, /vulnerab/i, /أمن/i] },
  { id: 'business_analyst', label: 'Business Analyst', description: 'Turns objectives into requirements and process models.', skills: ['requirements', 'process-modeling', 'stakeholder-analysis'], tools: ['text.extract_summary'], permissions: ['memory:read'], modelTier: 'analysis', keywords: [/requirement/i, /business/i, /process/i, /requirements/i] },
  { id: 'operations_research', label: 'Operations Research Specialist', description: 'Formulates and solves LP/MIP/CP models; validates feasibility.', skills: ['linear-programming', 'mip', 'assignment', 'scheduling', 'simulation'], tools: ['or.solve_lp', 'or.assignment', 'or.employee_schedule', 'graph.shortest_path', 'graph.max_flow', 'graph.min_cost_flow', 'graph.bipartite_matching', 'routing.tsp', 'routing.vrp', 'decision.pareto', 'stats.bayes_update', 'sim.queue', 'sim.scenario_compare', 'meta.formulate_scientific_problem', 'sim.monte_carlo', 'forecast.linear', 'decision.weighted_matrix'], permissions: [], modelTier: 'analysis', keywords: [/optimi[sz]e/i, /schedul/i, /allocation/i, /assignment/i, /shift/i, /linear program/i, /shortest\s*path/i, /dijkstra/i, /graph\s+(?:route|path|network)/i, /جدولة/i, /توزيع/i, /تخصيص/i, /أقصر\s+مسار/i] },
  { id: 'data_analyst', label: 'Data Analyst', description: 'Profiles data, computes statistics and KPIs, finds anomalies.', skills: ['statistics', 'kpi-tracking', 'anomaly-detection'], tools: ['stats.describe', 'stats.bayes_update', 'forecast.linear', 'text.extract_summary'], permissions: ['memory:read'], modelTier: 'analysis', keywords: [/data/i, /analy/i, /kpi/i, /statistic/i, /بيانات/i, /تحليل/i] },
  { id: 'project_manager', label: 'Project Manager', description: 'Plans, sequences and tracks delivery; manages dependencies.', skills: ['planning', 'dependency-management', 'delivery-tracking'], tools: ['text.extract_summary'], permissions: ['memory:read'], modelTier: 'general', keywords: [/project/i, /roadmap/i, /milestone/i, /مشروع/i] },
  { id: 'product_manager', label: 'Product Manager', description: 'Defines scope, priorities and acceptance criteria.', skills: ['scoping', 'prioritization', 'acceptance-criteria'], tools: ['text.extract_summary'], permissions: [], modelTier: 'general', keywords: [/product/i, /feature/i, /scope/i, /منتج/i] },
  { id: 'marketing_specialist', label: 'Marketing Specialist', description: 'Positioning, messaging and go-to-market plans.', skills: ['positioning', 'messaging', 'launch-planning'], tools: ['text.extract_summary'], permissions: [], modelTier: 'general', keywords: [/marketing/i, /launch/i, /campaign/i, /تسويق/i] },
  { id: 'finance_analyst', label: 'Finance Analyst', description: 'Costing, margins, budgets and financial trade-off analysis.', skills: ['costing', 'budgeting', 'margin-analysis'], tools: ['stats.describe', 'decision.weighted_matrix'], permissions: [], modelTier: 'analysis', keywords: [/finance/i, /cost/i, /budget/i, /margin/i, /تكلفة/i, /مالي/i] },
  { id: 'system_administrator', label: 'System Administrator', description: 'Infrastructure, deployment and operations hygiene.', skills: ['infrastructure', 'deployment', 'monitoring'], tools: ['system.diagnostics', 'fs.workspace_list', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'], permissions: ['host:read', 'runtime:read', 'runtime:write', 'runtime:execute'], modelTier: 'general', keywords: [/deploy/i, /infrastructure/i, /server/i, /devops/i] },
  { id: 'computer_diagnostics', label: 'Computer Diagnostics Agent', description: 'Inspects host health: CPU, memory, disk, load and runtime.', skills: ['diagnostics', 'performance-analysis', 'triage'], tools: ['system.diagnostics'], permissions: ['host:read'], modelTier: 'general', keywords: [/computer/i, /diagnos/i, /machine/i, /laptop/i, /device/i, /inspect/i, /فحص/i, /حاسوب/i, /جهاز/i] },
  { id: 'browser_automation', label: 'Browser Automation Agent', description: 'Operates real Chromium sessions for authorized web navigation, inspection, form interaction and evidence capture.', skills: ['playwright', 'web-automation', 'evidence-capture', 'browser-research'], tools: ['web.fetch_read', 'browser.open', 'browser.inspect', 'browser.screenshot', 'browser.click', 'browser.type', 'browser.select', 'browser.scroll', 'browser.wait', 'browser.research', 'browser.close', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files'], permissions: ['web:read', 'browser:read', 'browser:interact', 'runtime:read', 'runtime:write', 'runtime:execute'], modelTier: 'general', keywords: [/browser/i, /website|web page/i, /automate.*web/i] },
  { id: 'generalist', label: 'Generalist Agent', description: 'Handles well-defined tasks outside specialist domains.', skills: ['execution', 'coordination'], tools: ['text.extract_summary'], permissions: ['memory:read', 'memory:write'], modelTier: 'general', keywords: [] },
  { id: 'organization_manager', label: 'Organization Manager', description: 'Builds and operates virtual organizations and departments.', skills: ['org-design', 'role-design', 'coordination'], tools: ['org.build', 'agents.create'], permissions: ['org:write', 'agents:write', 'memory:write'], modelTier: 'planning', keywords: [/organization/i, /organisation/i, /company/i, /marketplace/i, /startup/i, /شركة/i, /منظمة/i] },
];

export const SPECIALIZATION_BY_ID = new Map(SPECIALIZATIONS.map((s) => [s.id, s]));

export function matchSpecializations(objective: string, limit = 3): Specialization[] {
  const scored = SPECIALIZATIONS.map((spec) => ({
    spec,
    score: spec.keywords.reduce((acc, re) => (re.test(objective) ? acc + 1 : acc), 0),
  })).filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.spec);
}
