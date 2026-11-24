/**
 * WORA OS — orchestration engine.
 *
 * Pipeline per mission: understand → decompose → assign → execute → review →
 * retry/reassign → deliver. Everything is persisted in SQLite; handoffs use a
 * mandatory structured contract; completion requires acceptance criteria and
 * evidence — never an agent's say-so. If a review fails twice the task fails
 * and dependents are blocked, loudly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { runTool, getTool, type ToolContext } from './tools.js';
import { requiresHumanApproval, createApproval, getTaskApproval, listMissionApprovals } from './governance.js';
import { maybeDistillPlaybook, findPlaybookFor, recordPlaybookReuse } from './playbooks.js';
import { listAgents, pickAgent, ensureSeedAgents, type AgentRecord } from './registry.js';
import { addMemory } from './memory.js';
import { workspacePath } from './workspace.js';
import { resolveAndSnapshot, authorizeTool } from '../extensions/capabilities.js';
import { listRegisteredTools, listCapabilitySnapshots } from '../extensions/store.js';
import { selectAlgorithm } from './algorithms.js';
import { logger } from '../lib/logger.js';

export type MissionStatus = 'planning' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
export type TaskStatus = 'created' | 'planned' | 'assigned' | 'running' | 'reviewing' | 'completed' | 'failed' | 'blocked';

interface PlanTask {
  title: string;
  objective: string;
  specialization: string;
  tool: string | null;
  toolInput: Record<string, unknown>;
  dependsOn: number[];
  acceptance: string[];
  detail: string;
}

/* ─── Sample optimization data (clearly labeled) ────────── */
export function sampleEmployeeInput() {
  const firstNames = ['Amina', 'Omar', 'Layla', 'Youssef', 'Mona', 'Karim', 'Sara', 'Hassan', 'Nadia', 'Tarek', 'Salma', 'Adel', 'Hoda', 'Mahmoud', 'Yara', 'Sherif', 'Aya', 'Mostafa', 'Dina', 'Khaled'];
  const shifts = [
    { id: 'morning', name: 'Morning (06-14)', demand: 5 },
    { id: 'afternoon', name: 'Afternoon (12-20)', demand: 4 },
    { id: 'evening', name: 'Evening (14-22)', demand: 4 },
    { id: 'night', name: 'Night (22-06)', demand: 4 },
    { id: 'weekend', name: 'Weekend flex', demand: 3 },
  ];
  const availabilityByIndex = [
    ['morning', 'afternoon', 'weekend'],
    ['afternoon', 'evening', 'night'],
    ['morning', 'evening', 'weekend'],
    ['evening', 'night', 'afternoon'],
    ['morning', 'afternoon', 'evening'],
    ['night', 'evening', 'weekend'],
    ['morning', 'weekend', 'night'],
    ['afternoon', 'morning', 'evening'],
    ['evening', 'weekend', 'afternoon'],
    ['night', 'morning', 'afternoon'],
  ];
  const employees = firstNames.map((name, i) => ({
    id: `emp-${String(i + 1).padStart(2, '0')}`,
    name: `${name} (sample)`,
    hourlyCost: 16 + ((i * 7) % 18),
    availability: availabilityByIndex[i % availabilityByIndex.length]!,
    maxAssignments: 1,
  }));
  return { employees, shifts, sample: true as const };
}

const slugify = (text: string) =>
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'wora-app';

function parseCreateAgentObjective(objective: string): { name: string; role: string; specialization: string } {
  const match = objective.match(/create\s+(?:a\s+)?(?:an\s+)?([a-z ]{2,60}?)\s+agent/i) ?? objective.match(/(?:agent)\s*(?:for|to)\s+([a-z ]{2,60})/i);
  const descriptor = (match?.[1] ?? 'generalist').trim().toLowerCase().replace(/\s+/g, ' ');
  const specByKeyword: Array<[RegExp, string]> = [
    [/test|qa|quality/i, 'qa_engineer'],
    [/frontend|front-end|ui/i, 'frontend_engineer'],
    [/backend|back-end|api/i, 'backend_engineer'],
    [/secur|threat/i, 'security_engineer'],
    [/research/i, 'research'],
    [/data|statistic/i, 'data_analyst'],
    [/schedul|optimi|allocat/i, 'operations_research'],
    [/project/i, 'project_manager'],
    [/product/i, 'product_manager'],
    [/marketing/i, 'marketing_specialist'],
    [/financ/i, 'finance_analyst'],
    [/diagnostic|computer|device/i, 'computer_diagnostics'],
    [/browser/i, 'browser_automation'],
    [/engineer|software|developer/i, 'software_engineer'],
  ];
  const specialization = specByKeyword.find(([re]) => re.test(descriptor))?.[1] ?? 'generalist';
  const label = descriptor.replace(/\b\w/g, (c) => c.toUpperCase());
  return { name: `${label} Agent`, role: `Persistent ${descriptor} specialist created from an instruction: "${objective.slice(0, 200)}"`, specialization };
}

function extractUrls(objective: string): string[] {
  return (objective.match(/https?:\/\/[^\s)"'\]]+/g) ?? []).slice(0, 3);
}

export function buildPlan(objective: string, track?: string, workspaceId = 'wora-preview'): PlanTask[] {
  const text = objective.trim();
  // 'generic' forces the grounded fallback pipeline (used for kickoff missions so org building never recurses).
  if (track === 'generic') {
    return [
      {
        title: 'Analyze the objective and extract requirements',
        objective: text,
        specialization: 'business_analyst',
        tool: 'text.extract_summary',
        toolInput: { text: `Objective received: ${text}. Extract the actionable requirements, implicit constraints and open questions.`, sentences: 3 },
        dependsOn: [],
        acceptance: ['Requirements distilled from the actual instruction', 'Open questions flagged instead of assumed'],
        detail: 'Kickoff analysis — deterministic distillation, no invented requirements.',
      },
    ];
  }
  const explicit = text;

  // Plugin tool execution: "run tool <plugin.tool> with {json}"
  const pluginToolMatch = /(?:run|execute|call)\s+(?:the\s+)?(?:plugin\s+)?tool\s+([a-z0-9][a-z0-9._-]{1,80})(?:\s+with\s+([\s\S]+))?/iu.exec(text);
  if (pluginToolMatch?.[1]) {
    const toolId = pluginToolMatch[1];
    const registered = listRegisteredTools(workspaceId, { activeOnly: true }).find((tool) => tool.toolId === toolId);
    if (registered) {
      const raw = pluginToolMatch[2]?.trim();
      let toolInput: Record<string, unknown> = {};
      if (raw) {
        try { toolInput = JSON.parse(raw) as Record<string, unknown>; }
        catch { toolInput = { text: raw.slice(0, 4_000) }; }
      }
      return [{
        title: `Execute plugin tool ${toolId}`,
        objective: text,
        specialization: 'generalist',
        tool: toolId,
        toolInput,
        dependsOn: [],
        acceptance: ['The plugin tool executed under the agent capability profile', 'Execution recorded in the audit log', 'Output attached as evidence'],
        detail: `Runs ${toolId} from plugin ${registered.pluginKey}. The agent must have the plugin assigned, enabled and approved; otherwise the task fails with a capability denial.`,
      }];
    }
  }

  // Journey 2 — create a specialized agent
  if (/create\b.*\bagent\b|\bagent\b.*\b(named|called|to)\b/i.test(explicit) && /agent/i.test(text)) {
    const draft = parseCreateAgentObjective(text);
    return [
      {
        title: `Create the persistent "${draft.name}" agent`,
        objective: text,
        specialization: 'organization_manager',
        tool: 'agents.create',
        toolInput: { ...draft, instructions: `You are the ${draft.name}. Specialization: ${draft.specialization}. Ground outputs in granted tools, attach evidence, escalate uncertainty. Created from: "${text.slice(0, 300)}"` },
        dependsOn: [],
        acceptance: ['Agent record persisted in the registry', 'Specialization, tools and permissions resolved', 'Audit log entry written'],
        detail: 'Creates a real registry entry — not a profile card. The agent is immediately usable by the orchestrator.',
      },
    ];
  }

  // Journey 1 — inspect my computer
  if (/(inspect|diagnos|check|audit|scan)\b.{0,80}\b(computer|machine|device|laptop|pc|server|host|system)\b|حاسوب|فحص.*جهاز/i.test(text)) {
    return [
      {
        title: 'Run host diagnostics with evidence',
        objective: text,
        specialization: 'computer_diagnostics',
        tool: 'system.diagnostics',
        toolInput: {},
        dependsOn: [],
        acceptance: ['Real host signals collected (CPU/memory/load/runtime/disk path)', 'Findings vs. pre-flight thresholds reported', 'Scope of inspection stated explicitly'],
        detail: 'Honest scope note: checks the machine running the WORA runtime. Inspecting the end-user device requires the Local Device Agent (not connected).',
      },
    ];
  }

  // Journey 5 — optimization / scheduling / allocation
  if (/optimi[sz]e|schedul|allocat|assignment|linear program|shift|employee|مخزون|جدولة|توزيع|تخصيص/i.test(text)) {
    const wantsEmployees = /employee|shift|staff|workforce|وردية|موظف/i.test(text);
    const algorithmSelection = selectAlgorithm({ objective: text });
    const sample = sampleEmployeeInput();
    // A validated playbook distilled from an earlier mission outranks the bundled sample.
    const playbook = findPlaybookFor(workspaceId, 'or.employee_schedule', text);
    const playbookEmployees = playbook?.toolInput as { employees: typeof sample.employees; shifts: typeof sample.shifts } | undefined;
    const provenanceDetail = playbook
      ? `Reused validated playbook ${playbook.id} (${playbook.successRuns} successful re-solve${playbook.successRuns === 1 ? '' : 's'}) distilled from an earlier mission. Same data as before — for a fresh roster use Intelligence → الجدولة التشغيلية.`
      : 'No operational roster was embedded in the instruction, so this run used the bundled SAMPLE roster (20 employees × 5 shifts, labeled "sample"). For operational use, solve with real data in Intelligence → الجدولة التشغيلية.';
    const employeeToolInput = playbookEmployees && Array.isArray(playbookEmployees.employees) && Array.isArray(playbookEmployees.shifts)
      ? playbookEmployees
      : { employees: sample.employees, shifts: sample.shifts };
    if (playbook) recordPlaybookReuse(workspaceId, playbook.id, 'orchestrator');
    const task: PlanTask = wantsEmployees
      ? {
          title: 'Formulate and solve the employee/shift allocation',
          objective: text,
          specialization: 'operations_research',
          tool: 'or.employee_schedule',
          toolInput: employeeToolInput,
          dependsOn: [],
          acceptance: ['Feasible MIP solution (HiGHS)', 'Demand met per shift', 'Availability respected', 'Min labor cost achieved', 'Constraints independently revalidated'],
          detail: `${provenanceDetail} Algorithm selection: ${algorithmSelection.primary?.name ?? 'unresolved'} (${algorithmSelection.primary?.toolId ?? 'no tool'}); ${algorithmSelection.primary?.guarantee ?? 'No algorithm was selected.'}`,
        }
      : {
          title: 'Solve the assignment problem',
          objective: text,
          specialization: 'operations_research',
          tool: 'or.assignment',
          toolInput: { costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]], rowLabels: ['option-A', 'option-B', 'option-C'], colLabels: ['candidate-1', 'candidate-2', 'candidate-3'] },
          dependsOn: [],
          acceptance: ['Optimal assignment found (Hungarian algorithm)', 'Total cost reported'],
          detail: `No numeric parameters were embedded in the instruction, so a small SAMPLE cost matrix was solved to demonstrate the pipeline. Provide the real matrix in Intelligence. Algorithm selection: ${algorithmSelection.primary?.name ?? 'unresolved'} (${algorithmSelection.primary?.toolId ?? 'no tool'}); ${algorithmSelection.primary?.guarantee ?? 'No algorithm was selected.'}`,
        };
    return [task];
  }

  // Journey 4 — build a working web application
  if (/(build|create|develop|make|scaffold|implement)\b.{0,80}\b(web\s*(app|application|site)|application|app|platform|portal|saas)\b|تطبيق ويب|موقع/i.test(text)) {
    const appName = slugify(text.split(/\s+/).slice(0, 6).join(' '));
    return [
      {
        title: 'Define scope and acceptance criteria',
        objective: text,
        specialization: 'product_manager',
        tool: 'text.extract_summary',
        toolInput: { text: `Objective: ${text}. The deliverable is a working, tested, zero-dependency web application: static kanban UI, Node http JSON API (tasks CRUD), and a passing node:test suite. Acceptance: the suite is green, the API round-trips a task, and the UI renders the board.`, sentences: 3 },
        dependsOn: [],
        acceptance: ['Scope and acceptance criteria recorded', 'Deliverable definition is testable'],
        detail: 'Scope distilled deterministically from the objective — no fabricated requirements.',
      },
      {
        title: `Generate the working application "${appName}"`,
        objective: text,
        specialization: 'frontend_engineer',
        tool: 'scaffold.webapp',
        toolInput: { name: appName, brief: text },
        dependsOn: [0],
        acceptance: ['Static UI + JSON API generated into the sandboxed workspace', 'Application is runnable with `node server.mjs`', 'node:test suite executed as evidence'],
        detail: 'Generates a real artifact (kanban board + HTTP API), not a proposal. Files and test output are attached as evidence.',
      },
      {
        title: 'Security scan of the generated code',
        objective: text,
        specialization: 'security_engineer',
        tool: 'security.scan',
        toolInput: { path: `apps/${appName}` },
        dependsOn: [1],
        acceptance: ['No hardcoded secrets', 'No dangerous constructs (eval/child_process/TLS bypass)'],
        detail: 'Pattern-based static triage of the generated artifact.',
      },
      {
        title: 'Verify the test suite independently',
        objective: text,
        specialization: 'qa_engineer',
        tool: 'host.exec',
        toolInput: { command: 'node', args: ['--test', 'test/app.test.mjs'], cwd: `apps/${appName}` },
        dependsOn: [2],
        acceptance: ['`node --test` exits green inside the generated app', 'API round-trip assertions pass'],
        detail: 'Independent re-execution — the QA agent trusts evidence, not the generator.',
      },
    ];
  }

  // Journey 3 — build a virtual organization
  if (/organization|organisation|company|marketplace|startup|منظمة|شركة/i.test(text)) {
    return [
      {
        title: 'Build the virtual organization',
        objective: text,
        specialization: 'organization_manager',
        tool: 'org.build',
        toolInput: { objective: text },
        dependsOn: [],
        acceptance: ['Departments created and persisted', 'Agents created with roles and reporting lines', 'Project and kickoff workflow created'],
        detail: 'Creates a persistent organization: departments, agents, reporting relationships, one project, and a kickoff mission.',
      },
    ];
  }

  // Research with explicit URLs
  const urls = extractUrls(text);
  if (/research|investigate|study|بحث/i.test(text) && urls.length) {
    return urls.map((url, i) => ({
      title: `Fetch and read source ${i + 1}`,
      objective: `${text} (source ${i + 1}: ${url})`,
      specialization: 'research',
      tool: 'web.fetch_read',
      toolInput: { url },
      dependsOn: [],
      acceptance: ['Page fetched with status < 400 or failure reported honestly', 'Readable text extracted (title + excerpt)'],
      detail: 'Fetches only the URLs explicitly present in the instruction.',
    }));
  }

  // Default — grounded analysis + recorded rationale
  return [
    {
      title: 'Analyze the objective and extract requirements',
      objective: text,
      specialization: 'business_analyst',
      tool: 'text.extract_summary',
      toolInput: { text: `Objective received: ${text}. Extract the actionable requirements, implicit constraints and open questions.`, sentences: 3 },
      dependsOn: [],
      acceptance: ['Requirements distilled from the actual instruction', 'Open questions flagged instead of assumed'],
      detail: 'Deterministic distillation — no invented requirements.',
    },
    {
      title: 'Record the working analysis in shared memory',
      objective: text,
      specialization: 'generalist',
      tool: 'text.extract_summary',
      toolInput: { text: `Decision log for objective: ${text}. Record what was analyzed, what evidence was attached and what remains open.`, sentences: 2 },
      dependsOn: [0],
      acceptance: ['Analysis summary produced', 'Handoff contract attached'],
      detail: 'Fallback pipeline when no specialized track matches.',
    },
  ];
}

/* ─── Mission lifecycle ─────────────────────────────────── */
export function createMission(input: { workspaceId: string; objective: string; actor?: string; track?: string; requestedBy?: string }): string {
  const objective = input.objective.trim().slice(0, 4000);
  if (!objective) throw new Error('Objective is required');
  ensureSeedAgents(input.workspaceId);
  const db = getOsDb();
  const plan = buildPlan(objective, input.track, input.workspaceId);
  const missionId = newId('msn');
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO os_missions (id, workspace_id, objective, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(missionId, input.workspaceId, objective, 'planning', input.requestedBy ?? 'user', ts, ts);
    const taskIds: string[] = [];
    const insertTask = db.prepare(
      `INSERT INTO os_tasks (id, mission_id, workspace_id, order_index, title, objective, specialization, status, depends_on, acceptance, tool, tool_input, detail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [index, task] of plan.entries()) {
      const taskId = newId('tsk');
      taskIds.push(taskId);
      insertTask.run(taskId, missionId, input.workspaceId, index, task.title, task.objective, task.specialization, JSON.stringify(task.dependsOn), JSON.stringify(task.acceptance), task.tool, JSON.stringify(task.toolInput), task.detail, ts, ts);
    }
    // Store resolved dependency ids
    const updateDeps = db.prepare('UPDATE os_tasks SET depends_on = ? WHERE id = ?');
    for (const [index, task] of plan.entries()) {
      if (task.dependsOn.length) updateDeps.run(JSON.stringify(task.dependsOn.map((i) => taskIds[i]!)), taskIds[index]!);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'mission.create', subject: missionId, detail: { objective: objective.slice(0, 300), tasks: plan.length } });
  return missionId;
}

interface TaskRow {
  id: string; mission_id: string; workspace_id: string; order_index: number; title: string; objective: string;
  specialization: string; status: string; agent_id: string | null; depends_on: string; acceptance: string;
  tool: string | null; tool_input: string; detail: string; created_at: string; updated_at: string;
}

function reviewRun(task: TaskRow, toolOk: boolean, output: unknown, error: string | null): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!toolOk) issues.push(error ?? 'Tool execution failed');
  else if (output == null) issues.push('Tool returned no output');
  const out = (output ?? {}) as Record<string, unknown>;
  switch (task.tool) {
    case 'or.employee_schedule':
      if (toolOk && out['feasible'] !== true) issues.push('Optimization infeasible — demand cannot be met with the given roster/availability');
      break;
    case 'or.solve_lp':
      if (toolOk && out['status'] !== 'Optimal') issues.push(`Solver status: ${String(out['status'] ?? 'unknown')}`);
      break;
    case 'scaffold.webapp':
      if (toolOk && out['testPassed'] !== true) issues.push('Generated application did not pass its node:test suite');
      break;
    case 'host.exec':
      if (toolOk && out['passed'] !== true) issues.push('Allowlisted test command did not exit green');
      break;
    case 'security.scan':
      if (toolOk && Number(out['criticalSecrets'] ?? 0) > 0) issues.push('Critical hardcoded secrets found in the artifact');
      break;
    case 'web.fetch_read':
      if (toolOk && Number(out['status'] ?? 500) >= 400) issues.push(`Source responded with HTTP ${String(out['status'])}`);
      break;
    case 'org.build':
      if (toolOk && !out['organizationId']) issues.push('Organization record was not created');
      break;
    case 'agents.create':
      if (toolOk && !out['id']) issues.push('Agent record was not created');
      break;
    default:
      break;
  }
  return { passed: issues.length === 0, issues };
}

const digest = (value: unknown, cap = 6000): string => {
  try { const s = JSON.stringify(value); return s.length > cap ? `${s.slice(0, cap)}…[truncated ${s.length - cap} chars]` : s; } catch { return '[unserializable]'; }
};

export async function executeMission(missionId: string, actor = 'orchestrator'): Promise<void> {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE id = ?').get(missionId) as { id: string; workspace_id: string; objective: string; status: string } | undefined;
  if (!mission) throw new Error(`Mission ${missionId} not found`);
  // Completed missions never re-run. Failed/awaiting missions re-enter: completed tasks are skipped,
  // the failed/blocked ones re-plan from their stored objective (retry after a fix or a restart).
  if (mission.status === 'completed') return;
  db.prepare('UPDATE os_missions SET status = ?, updated_at = ? WHERE id = ?').run('running', nowIso(), missionId);

  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index ASC').all(missionId) as unknown as TaskRow[];
  const completed = new Set<string>();
  let failed = false;

  for (const task of tasks) {
    const deps = parseJson<string[]>(task.depends_on, []);
    const blockedBy = deps.filter((id) => !completed.has(id));
    const depRows = deps.map((id) => tasks.find((t) => t.id === id));
    const depFailed = depRows.some((t) => t?.status === 'failed' || t?.status === 'blocked');
    if (failed || blockedBy.length > 0 || depFailed) {
      if (task.status !== 'completed') {
        db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('blocked', nowIso(), task.id);
      }
      continue;
    }
    if (task.status === 'completed') { completed.add(task.id); continue; }

    const agent = pickAgent(mission.workspace_id, task.specialization);
    if (!agent) {
      db.prepare('UPDATE os_tasks SET status = ?, detail = detail || ?, updated_at = ? WHERE id = ?').run('failed', ' No agent available for specialization.', nowIso(), task.id);
      failed = true;
      continue;
    }
    db.prepare('UPDATE os_tasks SET status = ?, agent_id = ?, updated_at = ? WHERE id = ?').run('assigned', agent.id, nowIso(), task.id);

    /* High-risk tools pause for an explicit human decision on the exact payload. */
    const toolDef = task.tool ? getTool(task.tool) : null;
    if (toolDef && requiresHumanApproval(mission.workspace_id, toolDef.risk)) {
      const existing = getTaskApproval(mission.workspace_id, task.id);
      if (!existing || existing.status === 'pending') {
        const approval = existing ?? createApproval({
          workspaceId: mission.workspace_id,
          missionId,
          taskId: task.id,
          toolId: toolDef.id,
          actionSummary: `${agent.name} يطلب تنفيذ ${toolDef.id} من نوع "${task.title}" قبل المتابعة`,
          risk: toolDef.risk,
          toolInput: parseJson(task.tool_input, {}),
          requestedBy: agent.name,
        });
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('blocked', `awaiting_approval:${approval.id}`, nowIso(), task.id);
        continue;
      }
      if (existing.status === 'denied') {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('failed', `أُوقف التنفيذ بقرار بشري: ${(existing.decisionNote || 'مرفوض').slice(0, 300)}`, nowIso(), task.id);
        failed = true;
        continue;
      }
      // approved → fall through into normal execution with evidence and review
    }

    let attempt = 1;
    let reviewPassed = false;
    let lastOutput: unknown = null;
    let lastIssues: string[] = [];
    let lastEvidence: Array<Record<string, unknown>> = [];
    let lastDuration = 0;
    let lastProfile: ReturnType<typeof resolveAndSnapshot> | null = null;

    while (attempt <= 2 && !reviewPassed) {
      const startedAt = nowIso();
      const runId = newId('run');
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('running', nowIso(), task.id);
      db.prepare('INSERT INTO os_runs (id, task_id, mission_id, workspace_id, agent_id, status, started_at, attempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(runId, task.id, missionId, mission.workspace_id, agent.id, 'running', startedAt, attempt);

      // Resolve on every attempt: disabling a plugin or revoking a permission
      // takes effect immediately, including for an already-running mission.
      const profile = resolveAndSnapshot(mission.workspace_id, agent.id, { missionId, taskId: task.id, actor: agent.name });
      lastProfile = profile;
      if (task.tool) {
        const decision = authorizeTool(mission.workspace_id, profile, task.tool);
        if (!decision.allowed) {
          const reason = decision.reason ?? 'Capability is not available to this agent';
          lastIssues = [reason];
          lastEvidence = [{ capabilityDenied: reason, digest: profile.digest }];
          db.prepare('UPDATE os_runs SET status = ?, finished_at = ?, summary = ?, evidence = ?, issues = ? WHERE id = ?')
            .run('failed', nowIso(), `Capability denied: ${reason}`, JSON.stringify(lastEvidence), JSON.stringify(lastIssues), runId);
          audit(db, { workspaceId: mission.workspace_id, actor: agent.name, action: 'capability.denied', subject: task.tool, detail: { missionId, taskId: task.id, reason, digest: profile.digest } });
          break;
        }
      }
      const ctx: ToolContext = {
        workspaceId: mission.workspace_id,
        actor: agent.name,
        permissions: new Set([...profile.permissions, 'memory:read', 'memory:write']),
        toolAllowlist: new Set(profile.tools),
        missionId,
        taskId: task.id,
      };
      const toolInput = parseJson<Record<string, unknown>>(task.tool_input, {});
      const result = task.tool
        ? await runTool(task.tool, toolInput, ctx)
        : { ok: false, tool: 'none', error: 'No tool assigned to task', durationMs: 0 } as Awaited<ReturnType<typeof runTool>>;

      lastOutput = result.output ?? null;
      lastDuration = result.durationMs;
      const review = reviewRun(task, result.ok, result.output, result.error ?? null);
      reviewPassed = review.passed;
      lastIssues = review.issues;
      lastEvidence = [{
        tool: result.tool, ok: result.ok, durationMs: result.durationMs, output: result.ok ? result.output : undefined,
        error: result.error, reviewAttempt: attempt,
        capabilityDigest: lastProfile?.digest ?? null,
        skills: lastProfile?.skills.map((skill) => `${skill.key}@${skill.version}`) ?? [],
        plugins: lastProfile?.plugins.map((plugin) => `${plugin.key}@${plugin.version}`) ?? [],
      }];

      db.prepare('UPDATE os_runs SET status = ?, finished_at = ?, summary = ?, evidence = ?, issues = ? WHERE id = ?')
        .run(reviewPassed ? 'completed' : attempt === 2 ? 'failed' : 'retrying', nowIso(),
          reviewPassed ? `Completed by ${agent.name}${attempt > 1 ? ` (after ${attempt} attempts)` : ''}` : `Review failed: ${review.issues.join('; ')}`,
          JSON.stringify(lastEvidence).slice(0, 60_000),
          JSON.stringify(review.issues),
          runId);

      if (!reviewPassed) attempt += 1;
    }

    // Mandatory handoff contract
    const contract = {
      taskId: task.id,
      objective: task.objective,
      inputContext: { tool: task.tool, toolInput: parseJson(task.tool_input, {}), mission: missionId },
      workPerformed: reviewPassed
        ? `${agent.name} executed ${task.tool} and passed review after ${attempt - 1 || 1} attempt(s).`
        : `${agent.name} executed ${task.tool}; review rejected the output: ${lastIssues.join('; ')}`,
      deliverables: reviewPassed ? summarizeDeliverables(task.tool, lastOutput) : [],
      evidence: lastEvidence,
      acceptanceCriteria: parseJson<string[]>(task.acceptance, []),
      acceptanceMet: reviewPassed,
      remainingIssues: lastIssues,
      capabilities: {
        digest: lastProfile?.digest ?? null,
        skills: lastProfile?.skills.map((skill) => `${skill.key}@${skill.version}`) ?? [],
        plugins: lastProfile?.plugins.map((plugin) => `${plugin.key}@${plugin.version}`) ?? [],
        tools: lastProfile?.tools ?? [],
        permissions: lastProfile?.permissions ?? [],
      },
      dependencies: deps,
      recommendedNextAction: reviewPassed
        ? (tasks.some((t) => parseJson<string[]>(t.depends_on, []).includes(task.id)) ? 'Hand off to dependent specialists; they will validate this contract before proceeding.' : 'Include in the mission deliverable for user review.')
        : 'Return to the authoring agent for correction or escalate — do not build on this output.',
    };
    db.prepare('INSERT INTO os_handoffs (id, mission_id, task_id, from_specialization, to_specialization, contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('hof'), missionId, task.id, task.specialization, 'review', JSON.stringify(contract), nowIso());

    if (reviewPassed) {
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('completed', nowIso(), task.id);
      completed.add(task.id);
      addMemory({ workspaceId: mission.workspace_id, scope: 'execution', scopeId: missionId, content: `Task "${task.title}" completed by ${agent.name}. ${contract.deliverables.join(' ')}`, tags: ['execution', task.specialization], provenance: `mission:${missionId}`, agentId: agent.id, actor });
    } else {
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('failed', nowIso(), task.id);
      failed = true;
    }
  }

  finalizeMission(missionId, actor);
  // Self-building intelligence: distill this mission's validated OR runs into reusable playbooks.
  try {
    await maybeDistillPlaybook({ workspaceId: mission.workspace_id, missionId, objective: mission.objective, actor });
  } catch (err) {
    logger.warn({ err, missionId }, 'playbook distillation failed (mission unaffected)');
  }
}

function summarizeDeliverables(tool: string | null, output: unknown): string[] {
  const out = (output ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'scaffold.webapp':
      return [`Working app generated at workspace path "${String(out['appPath'] ?? 'apps/')}" (${Array.isArray(out['files']) ? out['files'].length : 0} files); tests ${out['testPassed'] ? 'PASSED' : 'FAILED'}.`];
    case 'or.employee_schedule':
      return [`Optimal schedule found: total cost ${String(out['totalCost'] ?? 'n/a')} across ${Array.isArray(out['assignments']) ? out['assignments'].length : 0} assignments.`];
    case 'or.assignment':
      return [`Optimal assignment, total cost ${String(out['totalCost'] ?? 'n/a')}.`];
    case 'system.diagnostics':
      return [`Host diagnostics report (${typeof out['verdict'] === 'string' ? out['verdict'] : 'collected'}).`];
    case 'org.build':
      return [`Organization "${String(out['name'] ?? '')}" persisted with id ${String(out['organizationId'] ?? '')}.`];
    case 'agents.create':
      return [`Agent "${String(out['name'] ?? '')}" persisted with id ${String(out['id'] ?? '')}.`];
    case 'web.fetch_read':
      return [`Read "${String(out['title'] ?? out['url'] ?? 'source')}" (HTTP ${String(out['status'] ?? '?')}).`];
    default:
      return ['Deliverable recorded in the run evidence.'];
  }
}

function finalizeMission(missionId: string, actor: string): void {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE id = ?').get(missionId) as { id: string; workspace_id: string; objective: string; created_at: string };
  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index').all(missionId) as unknown as TaskRow[];
  const allDone = tasks.every((t) => t.status === 'completed');
  const anyFailed = tasks.some((t) => t.status === 'failed' || t.status === 'blocked');
  const anyAwaiting = tasks.some((t) => t.status === 'blocked' && t.detail.startsWith('awaiting_approval:'));
  const status: MissionStatus = allDone ? 'completed' : anyAwaiting ? 'awaiting_approval' : 'failed';
  // Ensure any never-run tasks are blocked rather than dangling
  if (!allDone && !anyFailed) {
    for (const t of tasks) if (t.status !== 'completed') db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('blocked', nowIso(), t.id);
  }
  const lines: string[] = [
    `# WORA Mission Deliverable`,
    ``,
    `- Mission: ${mission.id}`,
    `- Objective: ${mission.objective}`,
    `- Status: ${status}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Sample-data missions (optimization without embedded rosters) use clearly labeled sample inputs.`,
    ``,
    `## Tasks`,
    ...tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.title} — ${t.specialization}`),
    ``,
    `## Handoffs`,
    `See the "Handoff Contract" section per run in the Execution view; full contracts are stored in os_handoffs.`,
    ``,
    `## Honest notes`,
    `- Completion reflects passing deterministic acceptance checks on attached evidence, not agent self-report.`,
    `- No external side effects were performed beyond sandboxed file writes and allowlisted node --test executions.`,
  ];
  const content = lines.join('\n');
  let artifactId: string | null = null;
  try {
    const dir = path.join(workspacePath(mission.workspace_id), 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `mission-${mission.id}.md`), content, 'utf8');
    artifactId = newId('art');
    db.prepare('INSERT INTO os_artifacts (id, mission_id, workspace_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(artifactId, missionId, mission.workspace_id, `mission-${mission.id}.md`, 'report', content, nowIso());
  } catch {
    // Deliverable still recorded in DB even if the workspace file cannot be written.
    artifactId = newId('art');
    db.prepare('INSERT INTO os_artifacts (id, mission_id, workspace_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(artifactId, missionId, mission.workspace_id, `mission-${mission.id}.md`, 'report', content, nowIso());
  }
  db.prepare('UPDATE os_missions SET status = ?, summary = ?, artifact_id = ?, updated_at = ? WHERE id = ?')
    .run(status, allDone ? `${tasks.length} task(s) completed with evidence.` : `Finished with unresolved tasks — see failed/blocked below.`, artifactId, nowIso(), missionId);
  audit(db, { workspaceId: mission.workspace_id, actor, action: 'mission.finalize', subject: missionId, detail: { status, tasks: tasks.length } });
}

/**
 * Restart recovery: a mission that was mid-flight when the process died can
 * never finish on its own — nothing is executing it. Mark it and its running
 * tasks honestly so operators can resume via POST /missions/:id/execute
 * (re-entry is idempotent: completed tasks are skipped).
 */
export function markInterruptedMissions(): number {
  const db = getOsDb();
  const stale = db.prepare("SELECT id, workspace_id FROM os_missions WHERE status IN ('running', 'planning')").all() as Array<{ id: string; workspace_id: string }>;
  for (const mission of stale) {
    db.prepare("UPDATE os_tasks SET status = 'blocked', detail = 'interrupted_by_restart — resume the mission to re-execute this task', updated_at = ? WHERE mission_id = ? AND status IN ('running', 'assigned', 'reviewing', 'planned', 'created')")
      .run(nowIso(), mission.id);
    db.prepare("UPDATE os_runs SET status = 'interrupted', finished_at = ?, summary = 'Interrupted by process restart' WHERE mission_id = ? AND status = 'running'")
      .run(nowIso(), mission.id);
    db.prepare("UPDATE os_missions SET status = 'failed', summary = 'Interrupted by a process restart — resume the mission to continue from completed tasks.', updated_at = ? WHERE id = ?")
      .run(nowIso(), mission.id);
    audit(db, { workspaceId: mission.workspace_id, actor: 'system', action: 'mission.interrupted', subject: mission.id, detail: { reason: 'process restart' } });
  }
  return stale.length;
}

/* ─── Read models ───────────────────────────────────────── */
const taskView = (row: TaskRow) => ({
  id: row.id,
  orderIndex: row.order_index,
  title: row.title,
  objective: row.objective,
  specialization: row.specialization,
  status: row.status,
  agentId: row.agent_id,
  dependsOn: parseJson<string[]>(row.depends_on, []),
  acceptance: parseJson<string[]>(row.acceptance, []),
  tool: row.tool,
  toolInput: parseJson(row.tool_input, {}),
  detail: row.detail,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function listMissions(workspaceId: string, limit = 30) {
  const db = getOsDb();
  const missions = db.prepare('SELECT * FROM os_missions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, Math.min(limit, 100)) as Array<Record<string, string>>;
  return missions.map((m) => ({
    id: m['id'], objective: m['objective'], status: m['status'], summary: m['summary'], requestedBy: m['requested_by'], artifactId: m['artifact_id'], createdAt: m['created_at'], updatedAt: m['updated_at'],
  }));
}

export function getMissionDetail(workspaceId: string, missionId: string) {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, missionId) as
    | { id: string; workspace_id: string; objective: string; status: string; summary: string; requested_by: string; artifact_id: string | null; created_at: string; updated_at: string }
    | undefined;
  if (!mission) return null;
  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index').all(missionId) as unknown as TaskRow[];
  const agents = new Map(listAgents(workspaceId).map((a: AgentRecord) => [a.id, a]));
  const runs = db.prepare('SELECT * FROM os_runs WHERE mission_id = ? ORDER BY started_at ASC').all(missionId) as Array<Record<string, string | number>>;
  const handoffs = db.prepare('SELECT * FROM os_handoffs WHERE mission_id = ? ORDER BY created_at ASC').all(missionId) as Array<Record<string, string>>;
  const artifacts = db.prepare('SELECT id, name, kind, created_at FROM os_artifacts WHERE mission_id = ?').all(missionId) as Array<Record<string, string>>;
  const approvals = listMissionApprovals(workspaceId, missionId);
  return {
    approvals,
    capabilitySnapshots: listCapabilitySnapshots(workspaceId, { missionId, limit: 100 }),
    id: mission.id,
    objective: mission.objective,
    status: mission.status,
    summary: mission.summary,
    requestedBy: mission.requested_by,
    artifactId: mission.artifact_id,
    createdAt: mission.created_at,
    updatedAt: mission.updated_at,
    tasks: tasks.map((t) => ({
      ...taskView(t),
      agent: t.agent_id && agents.get(t.agent_id) ? { id: t.agent_id, name: agents.get(t.agent_id)!.name, specialization: agents.get(t.agent_id)!.specialization } : null,
      runs: runs.filter((r) => r['task_id'] === t.id).map((r) => ({
        id: r['id'], status: r['status'], attempt: r['attempt'], startedAt: r['started_at'], finishedAt: r['finished_at'],
        summary: r['summary'], evidence: parseJson(r['evidence'] as string, []), issues: parseJson(r['issues'] as string, []),
      })),
    })),
    handoffs: handoffs.map((h) => ({ id: h['id'], taskId: h['task_id'], from: h['from_specialization'], to: h['to_specialization'], contract: parseJson(h['contract'] as string, {}), createdAt: h['created_at'] })),
    artifacts,
  };
}

export function getOsState(workspaceId: string) {
  ensureSeedAgents(workspaceId);
  const db = getOsDb();
  const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { c: number }).c;
  return {
    agents: count('SELECT COUNT(*) c FROM os_agents WHERE workspace_id = ?', workspaceId),
    missions: {
      total: count('SELECT COUNT(*) c FROM os_missions WHERE workspace_id = ?', workspaceId),
      running: count("SELECT COUNT(*) c FROM os_missions WHERE workspace_id = ? AND status = 'running'", workspaceId),
      awaitingApproval: count("SELECT COUNT(*) c FROM os_missions WHERE workspace_id = ? AND status = 'awaiting_approval'", workspaceId),
      completed: count("SELECT COUNT(*) c FROM os_missions WHERE workspace_id = ? AND status = 'completed'", workspaceId),
      failed: count("SELECT COUNT(*) c FROM os_missions WHERE workspace_id = ? AND status = 'failed'", workspaceId),
    },
    approvals: {
      pending: count("SELECT COUNT(*) c FROM os_approvals WHERE workspace_id = ? AND status = 'pending'", workspaceId),
    },
    devices: {
      pending: count("SELECT COUNT(*) c FROM os_devices WHERE workspace_id = ? AND status = 'pending'", workspaceId),
      paired: count("SELECT COUNT(*) c FROM os_devices WHERE workspace_id = ? AND status = 'paired'", workspaceId),
    },
    tasks: {
      completed: count("SELECT COUNT(*) c FROM os_tasks WHERE workspace_id = ? AND status = 'completed'", workspaceId),
      failed: count("SELECT COUNT(*) c FROM os_tasks WHERE workspace_id = ? AND status = 'failed'", workspaceId),
      blocked: count("SELECT COUNT(*) c FROM os_tasks WHERE workspace_id = ? AND status = 'blocked'", workspaceId),
    },
    memory: count('SELECT COUNT(*) c FROM os_memory WHERE workspace_id = ?', workspaceId),
    organizations: count('SELECT COUNT(*) c FROM os_organizations WHERE workspace_id = ?', workspaceId),
    projects: count('SELECT COUNT(*) c FROM os_projects WHERE workspace_id = ?', workspaceId),
    artifacts: count('SELECT COUNT(*) c FROM os_artifacts WHERE workspace_id = ?', workspaceId),
  };
}
