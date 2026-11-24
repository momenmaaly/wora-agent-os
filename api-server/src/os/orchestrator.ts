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
import os from 'node:os';
import { getOsDb, newId, nowIso, parseJson, audit } from './db.js';
import { runTool, getTool, isIdempotentTool, type ToolContext } from './tools.js';
import { requiresHumanApproval, createApproval, getTaskApproval, listMissionApprovals, actionScope, extractAmount } from './governance.js';
import { classifyAction } from './actions.js';
import { maybeDistillPlaybook, findPlaybookFor, recordPlaybookReuse } from './playbooks.js';
import { listAgents, getAgent, ensureSeedAgents, type AgentRecord } from './registry.js';
import { addMemory } from './memory.js';
import { workspacePath } from './workspace.js';
import { resolveAndSnapshot, authorizeTool } from '../extensions/capabilities.js';
import { listRegisteredTools, listCapabilitySnapshots, listSkillContexts } from '../extensions/store.js';
import { applySkillPolicy, persistSkillContext, selectSkillsForTask, skillContextForTool } from '../extensions/skill-intelligence.js';
import { selectAlgorithm } from './algorithms.js';
import { recordVerification, listVerifications } from './verification.js';
import { claimTask, heartbeatTask, releaseTaskLease, checkpointTask, latestTaskCheckpoint, listTaskLeases, clearMissionLeases, clearMissionLease, recoverExpiredTaskLeases, getExecutionLimits, getTaskLease, claimMissionLease, heartbeatMissionLease, releaseMissionLease, getMissionLease, recoverExpiredMissionLeases } from './task-queue.js';
import { understandProblem, saveProblemProfile, getProblemProfile } from './problem.js';
import { verifyIndependently } from './independent-verification.js';
import { redactSecrets } from './secrets.js';
import { openTaskToolInput, sealTaskToolInput } from '../security/task-fields.js';
import { collectCandidateLessons } from './lessons.js';
import { comparePlans, savePlanVersion, listPlanVersions, verifyPlanExecution, replanMission } from './planning.js';
import { compareSolutionStrategies, saveDecisionRecord, listDecisionRecords, assessReplan } from './decision.js';
import { applyAdaptiveReplan, alternativeForTask } from './adaptive-replan.js';
import { composeMissionPlan, saveComposition, getComposition } from './capability-composition.js';
import { modelProblem, saveProblemModel, getProblemModel } from './problem-model.js';
import { evaluateSemanticCompatibility } from './semantic-contracts.js';
import { verifyMissionOutcome, getMissionOutcome } from './outcome-verification.js';
import { buildDeterministicReasoning, summarizeReasoning } from './reasoning-engine.js';
import { saveReasoningModel, getReasoningModel, recordOutcomeReasoningEvidence } from './reasoning-store.js';
import { matchCapabilities } from '../extensions/capability-intelligence.js';
import { persistTeamPlan, resolveTaskAgent, selectReplacement, recordAgentPerformance, getTeamPlan, listSelectionDecisions } from './selection.js';
import { logger } from '../lib/logger.js';

export type MissionStatus = 'planning' | 'running' | 'awaiting_approval' | 'paused' | 'cancelled' | 'completed' | 'failed';
export type TaskStatus = 'created' | 'planned' | 'assigned' | 'running' | 'reviewing' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface PlanTask {
  title: string;
  objective: string;
  specialization: string;
  tool: string | null;
  toolInput: Record<string, unknown>;
  dependsOn: number[];
  acceptance: string[];
  detail: string;
  /** Optional persisted assignment for capability-guided plans. */
  agentId?: string;
  /** Only schema-compatible, already-authorized alternatives; never a silent substitution. */
  fallbackTools?: string[];
  /** Values copied from an earlier task's verified output before execution. */
  inputBindings?: InputBinding[];
}

export interface InputBinding {
  key: string;
  /** Zero-based plan position of the upstream task. */
  taskIndex: number;
  /** Path into the upstream structured output; defaults to the whole output. */
  path?: string[];
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
  if (track === 'composite') return composeMissionPlan({ workspaceId, objective: text, track }).tasks;
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

  // Capability-guided mission: derive required capability, search the existing
  // registry, check trust/permissions, then either select one executable
  // capability or record an honest gap. Never installs or invokes a package.
  if (track === 'capability' || /\b(?:find|select|discover|use)\b.{0,40}\b(?:capability|extension|best\s+(?:tool|skill|plugin)|missing\s+capability)\b/i.test(text)) {
    const match = matchCapabilities({ workspaceId, objective: text });
    const selectedTool = match.selected?.tool ?? null;
    if (selectedTool) {
      const selected = match.selected!;
      const rawJson = /with\s+(\{[\s\S]+\})/u.exec(text)?.[1];
      let toolInput: Record<string, unknown> = {};
      if (rawJson) { try { toolInput = JSON.parse(rawJson) as Record<string, unknown>; } catch { toolInput = { text: text.slice(0, 4_000) }; } }
      else if (/\.echo$/u.test(selectedTool) || selectedTool.includes('echo')) toolInput = { text: text.slice(0, 4_000) };
      return [{
        title: `Use ${selected.kind} capability ${selectedTool}`,
        objective: text,
        specialization: selected.specialization ?? 'generalist',
        agentId: selected.agentId ?? undefined,
        tool: selectedTool,
        toolInput,
        dependsOn: [],
        acceptance: [
          'The selected capability is approved, enabled and authorized for the assigned agent',
          'The capability is executable (not just discoverable)',
          'Execution is recorded in the audit trail and independently verified',
        ],
        detail: `${match.explanation} Trust=${selected.trust}; permissions=${selected.permissions.join(', ') || 'none'}; health=${selected.health}.`,
      }];
    }
    return [{
      title: 'Report the capability gap honestly',
      objective: text,
      specialization: 'generalist',
      tool: 'text.extract_summary',
      toolInput: {
        text: `CAPABILITY GAP — no approved executable capability matched this objective. Missing/requested: ${(match.gap?.missing ?? []).join(', ') || 'unknown'}. Search terms for an operator: ${(match.gap?.searchTerms ?? []).join(', ') || 'none'}. No extension was installed or invoked.`,
        sentences: 3,
      },
      dependsOn: [],
      acceptance: ['The gap is stated explicitly', 'No unverified extension is installed or invoked', 'The missing capability and search terms are recorded'],
      detail: match.explanation,
    }];
  }

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
export function createMission(input: { workspaceId: string; objective: string; actor?: string; track?: string; requestedBy?: string; correlationId?: string }): string {
  const objective = input.objective.trim().slice(0, 4000);
  if (!objective) throw new Error('Objective is required');
  ensureSeedAgents(input.workspaceId);
  const db = getOsDb();
  const composed = input.track === 'composite' ? composeMissionPlan({ workspaceId: input.workspaceId, objective, track: input.track }) : null;
  const unified = composed?.model ?? modelProblem({ workspaceId: input.workspaceId, objective, track: input.track });
  const reasoning = buildDeterministicReasoning({ workspaceId: input.workspaceId, objective, track: input.track, baseProblem: unified });
  unified.reasoning = summarizeReasoning(reasoning);
  const problem = unified.baseProfile;
  const plan = composed?.tasks ?? buildPlan(objective, input.track, input.workspaceId);
  const planComparison = comparePlans(plan, input.workspaceId, problem);
  const decision = compareSolutionStrategies(plan, input.workspaceId, problem);
  const missionId = newId('msn');
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO os_missions (id, workspace_id, objective, status, requested_by, correlation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(missionId, input.workspaceId, objective, 'planning', input.requestedBy ?? 'user', input.correlationId ?? null, ts, ts);
    const taskIds: string[] = [];
    const insertTask = db.prepare(
      `INSERT INTO os_tasks (id, mission_id, workspace_id, order_index, title, objective, specialization, agent_id, status, depends_on, acceptance, tool, tool_input, fallback_tools, input_bindings, detail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [index, task] of plan.entries()) {
      const taskId = newId('tsk');
      taskIds.push(taskId);
      insertTask.run(taskId, missionId, input.workspaceId, index, task.title, task.objective, task.specialization, task.agentId ?? null, JSON.stringify(task.dependsOn), JSON.stringify(task.acceptance), task.tool, sealTaskToolInput(input.workspaceId, taskId, task.toolInput), JSON.stringify(task.fallbackTools ?? []), JSON.stringify(task.inputBindings ?? []), task.detail, ts, ts);
    }
    // Store resolved dependency ids
    const updateDeps = db.prepare('UPDATE os_tasks SET depends_on = ? WHERE id = ?');
    for (const [index, task] of plan.entries()) {
      if (task.dependsOn.length) updateDeps.run(JSON.stringify(task.dependsOn.map((i) => taskIds[i]!)), taskIds[index]!);
    }
    saveProblemProfile(input.workspaceId, missionId, problem);
    saveProblemModel(input.workspaceId, missionId, unified);
    saveReasoningModel({ ...reasoning, missionId });
    const chosenPlan = planComparison.plans.find((candidate) => candidate.strategy === decision.preferredPlan.planStrategy) ?? planComparison.preferred;
    savePlanVersion({ workspaceId: input.workspaceId, missionId, plan: chosenPlan, comparison: { ...planComparison, decision }, reason: 'initial deterministic plan with scientific method comparison', actor: input.actor ?? 'user' });
    saveDecisionRecord({ workspaceId: input.workspaceId, missionId, kind: 'initial', comparison: decision, reason: decision.reason, actor: input.actor ?? 'user' });
    if (composed) {
      saveComposition(input.workspaceId, missionId, composed);
      saveDecisionRecord({
        workspaceId: input.workspaceId, missionId, kind: 'composition-strategy',
        comparison: { selected: composed.strategy.selected, candidates: composed.strategy.candidates, rejected: composed.strategy.rejected, graph: composed.graph },
        reason: composed.strategy.explanation, actor: input.actor ?? 'user',
      });
    }
    try {
      persistTeamPlan({ workspaceId: input.workspaceId, missionId, plan, taskIds, problem, actor: input.actor ?? 'user' });
    } catch (err) {
      logger.warn({ err, missionId }, 'dynamic team selection failed; mission remains executable by capability resolution');
      audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'team.plan.failed', subject: missionId, detail: { reason: err instanceof Error ? err.message.slice(0, 300) : 'unknown' } });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit(db, { workspaceId: input.workspaceId, actor: input.actor ?? 'user', action: 'mission.create', subject: missionId, detail: { objective: objective.slice(0, 300), tasks: plan.length, domain: problem.domain, algorithmStatus: problem.algorithmSelection.status } });
  return missionId;
}

interface TaskRow {
  id: string; mission_id: string; workspace_id: string; order_index: number; title: string; objective: string;
  specialization: string; status: string; agent_id: string | null; depends_on: string; acceptance: string;
  tool: string | null; tool_input: string; fallback_tools: string; input_bindings: string; detail: string; created_at: string; updated_at: string;
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

function maybeTestStage(stage: string): void {
  if (process.env['NODE_ENV'] !== 'test') return;
  try { process.stdout.write(`WORA_TEST_STAGE:${stage}\n`); } catch { /* stdout may be closed */ }
  if (process.env['WORA_TEST_KILL_AT'] === stage) process.kill(process.pid, 'SIGKILL');
}

function resolveInputBindings(workspaceId: string, missionId: string, task: TaskRow, input: Record<string, unknown>): { input: Record<string, unknown>; error: string | null } {
  const bindings = parseJson<InputBinding[]>(task.input_bindings ?? '[]', []);
  if (!bindings.length) return { input, error: null };
  const db = getOsDb();
  const resolved = { ...input };
  for (const binding of bindings) {
    if (!binding.key || !Number.isInteger(binding.taskIndex) || binding.taskIndex < 0) return { input, error: `invalid input binding for ${binding.key ?? 'unknown'}` };
    const upstream = db.prepare('SELECT id, status FROM os_tasks WHERE mission_id = ? AND order_index = ?').get(missionId, binding.taskIndex) as { id?: string; status?: string } | undefined;
    if (!upstream?.id || upstream.status !== 'completed') return { input, error: `upstream task ${binding.taskIndex} is not completed` };
    const run = db.prepare("SELECT evidence FROM os_runs WHERE task_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1").get(upstream.id) as { evidence?: string } | undefined;
    if (!run?.evidence) return { input, error: `upstream task ${binding.taskIndex} has no completed evidence` };
    const evidence = parseJson<Array<Record<string, unknown>>>(run.evidence, []);
    const output = evidence.find((entry) => entry['output'] !== undefined)?.['output'];
    let value: unknown = output;
    for (const segment of binding.path ?? []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { value = undefined; break; }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value === undefined || value === null) return { input, error: `upstream output has no value at ${binding.path?.join('.') ?? '<root>'}` };
    resolved[binding.key] = value;
  }
  return { input: resolved, error: null };
}

const digest = (value: unknown, cap = 6000): string => {
  try { const s = JSON.stringify(value); return s.length > cap ? `${s.slice(0, cap)}…[truncated ${s.length - cap} chars]` : s; } catch { return '[unserializable]'; }
};

export async function executeMission(missionId: string, actor = 'orchestrator', options: { workerId?: string; leaseTtlMs?: number; maxAttempts?: number; concurrency?: number; workerMode?: boolean; missionLeaseOwner?: string; missionLeaseTtlMs?: number; skipMissionLease?: boolean } = {}): Promise<void> {
  const db = getOsDb();
  const mission = db.prepare('SELECT id, workspace_id, status FROM os_missions WHERE id = ?').get(missionId) as { id: string; workspace_id: string; status: string } | undefined;
  if (!mission) throw new Error(`Mission ${missionId} not found`);
  if (['completed', 'paused', 'cancelled'].includes(mission.status)) return;
  const workerId = options.missionLeaseOwner ?? options.workerId ?? `wora-worker:${os.hostname()}:${process.pid}`;
  const missionTtlMs = options.missionLeaseTtlMs ?? options.leaseTtlMs ?? getExecutionLimits(mission.workspace_id).leaseTtlMs;
  const ownsMissionLease = !options.skipMissionLease;
  if (ownsMissionLease) {
    const lease = claimMissionLease({ workspaceId: mission.workspace_id, missionId, ownerId: workerId, ttlMs: missionTtlMs });
    if (!lease) return;
  }
  const missionHeartbeat = setInterval(() => {
    try {
      heartbeatMissionLease({ workspaceId: mission.workspace_id, missionId, ownerId: workerId, ttlMs: missionTtlMs });
    } catch { /* lease expiry is handled by the next worker */ }
  }, Math.max(250, Math.floor(missionTtlMs / 3)));
  missionHeartbeat.unref?.();
  try {
    await executeMissionInner(missionId, actor, { ...options, missionLeaseOwner: workerId, skipMissionLease: true });
  } finally {
    clearInterval(missionHeartbeat);
    if (ownsMissionLease) releaseMissionLease({ workspaceId: mission.workspace_id, missionId, ownerId: workerId });
  }
}

async function executeMissionInner(missionId: string, actor = 'orchestrator', options: { workerId?: string; leaseTtlMs?: number; maxAttempts?: number; concurrency?: number; workerMode?: boolean; missionLeaseOwner?: string; missionLeaseTtlMs?: number; skipMissionLease?: boolean } = {}): Promise<void> {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE id = ?').get(missionId) as { id: string; workspace_id: string; objective: string; status: string; correlation_id?: string | null } | undefined;
  if (!mission) throw new Error(`Mission ${missionId} not found`);
  // Completed, paused and cancelled missions never run. Failed/awaiting missions
  // re-enter: completed tasks are skipped and the failed/blocked ones retry.
  if (mission.status === 'completed' || mission.status === 'paused' || mission.status === 'cancelled') return;
  const workerId = options.workerId ?? `wora-worker:${os.hostname()}:${process.pid}`;
  const limits = getExecutionLimits(mission.workspace_id);
  const leaseTtlMs = Math.min(Math.max(options.leaseTtlMs ?? limits.leaseTtlMs, 1_000), 10 * 60_000);
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? limits.maxAttempts, 1), 5);
  const concurrency = Math.min(Math.max(options.concurrency ?? 1, 1), limits.maxConcurrentTasks, 8);
  if (concurrency > 1 && !options.workerMode) {
    recoverExpiredTaskLeases(mission.workspace_id);
    const workers = Array.from({ length: concurrency }, (_, index) => `${workerId}:${index}`);
    const rounds = Math.max(2, (db.prepare('SELECT COUNT(*) AS c FROM os_tasks WHERE mission_id = ?').get(missionId) as { c: number }).c + 1);
    for (let round = 0; round < rounds; round += 1) {
      await Promise.all(workers.map((owner) => executeMission(missionId, actor, {
        ...options, concurrency: 1, workerMode: true, workerId: `${owner}:r${round}`,
        missionLeaseOwner: options.missionLeaseOwner ?? workerId, skipMissionLease: true,
      })));
      const status = db.prepare('SELECT status FROM os_missions WHERE id = ?').get(missionId) as { status?: string } | undefined;
      if (!status || ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(status.status ?? '')) break;
    }
    await afterMission(missionId, actor, mission);
    return;
  }
  db.prepare('UPDATE os_missions SET status = ?, updated_at = ? WHERE id = ?').run('running', nowIso(), missionId);

  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index ASC').all(missionId) as unknown as TaskRow[];
  const completed = new Set<string>();
  let failed = false;

  for (const task of tasks) {
    const liveMission = db.prepare('SELECT status FROM os_missions WHERE id = ?').get(missionId) as { status?: string } | undefined;
    if (!liveMission || liveMission.status === 'paused' || liveMission.status === 'cancelled' || liveMission.status === 'completed') return;
    const deps = parseJson<string[]>(task.depends_on, []);
    const liveTasks = db.prepare('SELECT id, status, detail FROM os_tasks WHERE mission_id = ?').all(missionId) as Array<{ id: string; status: string; detail: string }>;
    const byId = new Map(liveTasks.map((entry) => [entry.id, entry]));
    const blockedBy = deps.filter((id) => byId.get(id)?.status !== 'completed');
    const depRows = deps.map((id) => byId.get(id));
    const depFailed = depRows.some((entry) => entry?.status === 'failed' || entry?.status === 'blocked' || entry?.status === 'cancelled');
    if ((!options.workerMode && failed) || depFailed) {
      if (task.status !== 'completed') db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('blocked', nowIso(), task.id);
      continue;
    }
    if (blockedBy.length > 0) {
      if (!options.workerMode && task.status !== 'completed') db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('blocked', nowIso(), task.id);
      continue;
    }
    if (task.status === 'completed') { completed.add(task.id); continue; }
    if (task.status === 'cancelled') continue;
    const recoveredCheckpoint = latestTaskCheckpoint(mission.workspace_id, task.id);
    if (recoveredCheckpoint?.status === 'completed' && task.status !== 'completed') {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('completed', 'recovered_from_completed_checkpoint — verification completed before interruption', nowIso(), task.id);
        const handoff = db.prepare('SELECT 1 FROM os_handoffs WHERE mission_id = ? AND task_id = ? LIMIT 1').get(missionId, task.id);
        if (!handoff) {
          const contract = {
            taskId: task.id, taskState: 'completed_verified', recovered: true,
            objective: task.objective, evidenceReferences: [],
            workPerformed: 'Recovered from a durable completed checkpoint after a process interruption.',
            recommendedNextAction: 'Dependents may proceed; inspect the verification record for evidence.',
          };
          db.prepare('INSERT INTO os_handoffs (id, mission_id, task_id, from_specialization, to_specialization, contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(newId('hof'), missionId, task.id, task.specialization, 'review', JSON.stringify(contract), nowIso());
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* preserve original */ }
        throw error;
      }
      audit(db, { workspaceId: mission.workspace_id, actor: 'orchestrator', action: 'task.recovered', subject: task.id, detail: { missionId, checkpointId: recoveredCheckpoint.id } });
      completed.add(task.id);
      continue;
    }
    if (options.workerMode && task.status === 'failed') continue;
    if (options.workerMode && task.status === 'blocked' && /side_effect_uncertain/i.test(task.detail)) continue;

    const selection = resolveTaskAgent(mission.workspace_id, {
      id: task.id, title: task.title, objective: task.objective, specialization: task.specialization,
      tool: task.tool, acceptance: parseJson<string[]>(task.acceptance, []), dependsOn: [], agentId: task.agent_id,
    }, missionId);
    let agent = selection.agent;
    if (!agent && task.agent_id) {
      // Keep the persisted assignee for an authorization-denial audit when a
      // capability was revoked after planning. Execution still re-resolves the
      // profile and refuses the tool; this is not a permission bypass.
      const persisted = getAgent(mission.workspace_id, task.agent_id);
      const persistedCandidate = selection.decision.candidates.find((candidate) => candidate.agentId === task.agent_id);
      const revokedCapability = persistedCandidate?.rejectionReasons.some((reason) => /missing (tool|permission)/iu.test(reason));
      if (persisted?.status === 'active' && revokedCapability) agent = persisted;
    }
    if (!agent) {
      db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
        .run('failed', `capability_gap: ${selection.decision.gap ?? 'no eligible agent'}`, nowIso(), task.id);
      failed = true;
      continue;
    }
    db.prepare('UPDATE os_tasks SET status = ?, agent_id = ?, updated_at = ? WHERE id = ?').run('assigned', agent.id, nowIso(), task.id);

    /* Governance: classify the action, bind any approval to the exact payload,
       scope and expiry, and fail closed on uncertainty. High-risk actions
       always require approval; autopilot cannot bypass class C. */
    const toolDef = task.tool ? getTool(task.tool) : null;
    let taskInput = openTaskToolInput<Record<string, unknown>>(mission.workspace_id, task.id, task.tool_input, {});
    const bound = resolveInputBindings(mission.workspace_id, missionId, task, taskInput);
    if (bound.error) {
      db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
        .run('blocked', `input_binding_failed: ${bound.error}`.slice(0, 500), nowIso(), task.id);
      failed = true;
      continue;
    }
    taskInput = bound.input;
    const scope = toolDef ? actionScope(missionId, task.id, toolDef.id) : actionScope(missionId, task.id, null);
    const amountUsd = extractAmount(taskInput);
    const actionClass = toolDef
      ? classifyAction({ action: task.title, risk: toolDef.risk, reversible: toolDef.risk !== 'high', scope, amountUsd })
      : null;
    let approvedAction: ToolContext['approvedAction'] | undefined;
    if (toolDef && requiresHumanApproval(mission.workspace_id, toolDef.risk, {
      action: task.title, reversible: toolDef.risk !== 'high', scope, amountUsd,
    })) {
      const existing = getTaskApproval(mission.workspace_id, task.id);
      if (existing?.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('failed', 'Approval expired before execution — request a new approval', nowIso(), task.id);
        failed = true;
        continue;
      }
      if (!existing || existing.status === 'pending') {
        let approval;
        try {
          approval = existing ?? createApproval({
            workspaceId: mission.workspace_id,
            missionId,
            taskId: task.id,
            toolId: toolDef.id,
            actionSummary: `${agent.name} يطلب تنفيذ ${toolDef.id} من نوع "${task.title}" قبل المتابعة`,
            toolDescription: toolDef.description,
            toolPermissions: [toolDef.permission, ...(toolDef.permissions ?? [])].filter((permission): permission is string => Boolean(permission)),
            risk: toolDef.risk,
            toolInput: taskInput,
            requestedBy: agent.name,
            actionClass: actionClass?.class ?? 'C',
            scope,
            amountUsd,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'Approval could not be created';
          db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
            .run('failed', `Approval blocked: ${reason}`.slice(0, 500), nowIso(), task.id);
          audit(db, { workspaceId: mission.workspace_id, actor: agent.name, action: 'approval.blocked', subject: task.id, detail: { missionId, reason, scope } });
          failed = true;
          continue;
        }
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('blocked', `awaiting_approval:${approval.id}`, nowIso(), task.id);
        maybeTestStage('after-approval-wait');
        continue;
      }
      if (existing.status === 'denied') {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('failed', `أُوقف التنفيذ بقرار بشري: ${(existing.decisionNote || 'مرفوض').slice(0, 300)}`, nowIso(), task.id);
        failed = true;
        continue;
      }
      if (existing.consumedAt) {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('failed', 'Approval was already consumed by another attempt; request a new approval', nowIso(), task.id);
        failed = true;
        continue;
      }
      if (existing.actionClass !== 'C') {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('failed', 'Approval is not a class C approval', nowIso(), task.id);
        failed = true;
        continue;
      }
      // The tool boundary consumes the approval atomically after schema validation.
      approvedAction = { approvalId: existing.id, payloadDigest: existing.payloadDigest, scope: existing.scope };
    }

    const lease = claimTask({ workspaceId: mission.workspace_id, taskId: task.id, missionId, ownerId: workerId, ttlMs: leaseTtlMs });
    if (!lease) continue;
    const heartbeat = setInterval(() => {
      try { heartbeatTask({ workspaceId: mission.workspace_id, taskId: task.id, ownerId: workerId, ttlMs: leaseTtlMs }); } catch { /* lease recovery handles failure */ }
    }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
    heartbeat.unref?.();
    try {
      const priorCheckpoint = latestTaskCheckpoint(mission.workspace_id, task.id);
      if (priorCheckpoint?.status === 'started' && !isIdempotentTool(task.tool, mission.workspace_id)) {
        db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ?')
          .run('blocked', 'side_effect_uncertain — a prior attempt started but did not record completion; manual review is required', nowIso(), task.id);
        failed = true;
        continue;
      }
      if (priorCheckpoint?.status === 'started') {
        db.prepare("UPDATE os_runs SET status = 'interrupted', finished_at = ?, summary = 'Interrupted before completion; safe retry because the tool is idempotent' WHERE task_id = ? AND status = 'running'")
          .run(nowIso(), task.id);
        audit(db, { workspaceId: mission.workspace_id, actor: 'orchestrator', action: 'task.safe_retry', subject: task.id, detail: { missionId, tool: task.tool, priorCheckpoint: priorCheckpoint.id } });
      }

    let attempt = 1;
    let reassignments = 0;
    let adaptiveReplans = 0;
    let fallbackAttempts = 0;
    let fallbackTools = parseJson<string[]>(task.fallback_tools ?? '[]', []);
    let reviewPassed = false;
    let lastOutput: unknown = null;
    let lastIssues: string[] = [];
    let lastEvidence: Array<Record<string, unknown>> = [];
    let lastDuration = 0;
    let lastProfile: ReturnType<typeof resolveAndSnapshot> | null = null;
    let cancelledMidRun = false;

    while (attempt <= maxAttempts && !reviewPassed) {
      const startedAt = nowIso();
      const runId = newId('run');
      checkpointTask({ workspaceId: mission.workspace_id, taskId: task.id, missionId, runId, attempt, status: 'started', checkpoint: { tool: task.tool, attempt } });
      maybeTestStage('after-start-checkpoint');
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
          checkpointTask({ workspaceId: mission.workspace_id, taskId: task.id, missionId, runId, attempt, status: 'blocked', evidence: lastEvidence, checkpoint: { reason } });
          recordVerification({
            workspaceId: mission.workspace_id, missionId, taskId: task.id, runId,
            objective: task.objective, acceptanceCriteria: parseJson<string[]>(task.acceptance, []),
            expectedOutput: `A successful ${task.tool ?? 'task'} result satisfying the acceptance criteria`,
            actualOutput: null, evidence: lastEvidence,
            checks: [{ id: 'capability-authorization', kind: 'authorization', description: 'The agent is authorized for the assigned tool', status: 'failed', evidence: reason }],
            result: 'blocked', failureReason: reason, verifier: 'wora.orchestrator/capability-check',
          });
          if (reassignments < 1) {
            const replacement = selectReplacement(mission.workspace_id, {
              id: task.id, title: task.title, objective: task.objective, specialization: task.specialization,
              tool: task.tool, acceptance: parseJson<string[]>(task.acceptance, []), dependsOn: [], agentId: agent.id,
            }, missionId, agent.id);
            if (replacement.agent) {
              audit(db, { workspaceId: mission.workspace_id, actor: 'orchestrator', action: 'task.reassign', subject: task.id, detail: { missionId, from: agent.id, to: replacement.agent.id, reason: `authorization: ${reason}`.slice(0, 300) } });
              saveDecisionRecord({
                workspaceId: mission.workspace_id, missionId, kind: 'authorization-reassignment',
                comparison: { from: agent.id, to: replacement.agent.id, reason, selectedBy: 'dynamic-selection' },
                reason: 'Authorization failed; a qualified alternate agent was available.', actor: 'orchestrator',
              });
              agent = replacement.agent;
              task.agent_id = agent.id;
              db.prepare('UPDATE os_tasks SET agent_id = ?, updated_at = ? WHERE id = ?').run(agent.id, nowIso(), task.id);
              reassignments += 1;
              attempt = 1;
              continue;
            }
          }
          break;
        }
      }
      // Select only task-relevant, approved and auto-loadable skills. The
      // context is untrusted data with a strict token budget and is recorded
      // with versions/digests before the tool runs. Revocation is re-evaluated
      // on every attempt because the profile is resolved above.
      const skillSelection = selectSkillsForTask(profile, task, { missionId, taskId: task.id });
      const policyResult = applySkillPolicy(task, taskInput, skillSelection);
      const skillContextId = persistSkillContext(skillSelection, agent.name);
      const ctx: ToolContext = {
        workspaceId: mission.workspace_id,
        actor: agent.name,
        permissions: new Set([...profile.permissions, 'memory:read', 'memory:write']),
        toolAllowlist: new Set(profile.tools),
        missionId,
        taskId: task.id,
        actionClass: actionClass?.class,
        approvedAction,
        correlationId: mission.correlation_id ?? undefined,
        skillContext: skillSelection.selected.length ? skillContextForTool(skillSelection) : undefined,
      };
      const toolInput = policyResult.input;
      const result = task.tool
        ? await runTool(task.tool, toolInput, ctx)
        : { ok: false, tool: 'none', error: 'No tool assigned to task', durationMs: 0 } as Awaited<ReturnType<typeof runTool>>;

      lastOutput = result.output ?? null;
      lastDuration = result.durationMs;
      const review = reviewRun(task, result.ok, result.output, result.error ?? null);
      const independent = verifyIndependently({ tool: task.tool, toolInput, toolOk: result.ok, output: result.output, error: result.error ?? null, evidence: lastEvidence });
      reviewPassed = review.passed && independent.passed;
      lastOutput = redactSecrets(result.output ?? null).value;
      const safeError = redactSecrets(result.error ?? '').value;
      lastIssues = redactSecrets([...review.issues, ...independent.failures]).value;
      lastEvidence = [{
        tool: result.tool, ok: result.ok, durationMs: result.durationMs, output: result.ok ? lastOutput : undefined,
        error: safeError, reviewAttempt: attempt,
        artifactDigest: independent.artifactDigest,
        independentChecks: redactSecrets(independent.checks).value,
        capabilityDigest: lastProfile?.digest ?? null,
        skills: skillSelection.selected.map((entry) => `${entry.skill.key}@${entry.skill.version}`),
        plugins: lastProfile?.plugins.map((plugin) => `${plugin.key}@${plugin.version}`) ?? [],
        skillContext: skillSelection.selected.length ? {
          id: skillContextId, digest: skillSelection.digest, tokensUsed: skillSelection.tokensUsed,
          tokenBudget: skillSelection.tokenBudget, appliedPolicy: policyResult.applied,
          selected: skillSelection.selected.map((entry) => ({
            key: entry.skill.key, version: entry.skill.version,
            instructionDigest: entry.skill.instructionDigest, score: entry.score,
          })),
          omitted: skillSelection.omitted,
        } : null,
      }];

      const liveAfterRun = db.prepare('SELECT status FROM os_missions WHERE id = ?').get(missionId) as { status?: string } | undefined;
      if (liveAfterRun?.status === 'cancelled') {
        db.prepare('UPDATE os_runs SET status = ?, finished_at = ?, summary = ?, evidence = ?, issues = ? WHERE id = ?')
          .run('cancelled', nowIso(), 'Mission cancelled during execution; result not accepted', JSON.stringify(lastEvidence), JSON.stringify(['Mission cancelled']), runId);
        db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), task.id);
        checkpointTask({ workspaceId: mission.workspace_id, taskId: task.id, missionId, runId, attempt, status: 'blocked', output: lastOutput, evidence: lastEvidence, checkpoint: { cancelled: true } });
        audit(db, { workspaceId: mission.workspace_id, actor: agent.name, action: 'mission.cancel.observed', subject: task.id, detail: { missionId, runId } });
        cancelledMidRun = true;
        break;
      }
      db.prepare('UPDATE os_runs SET status = ?, finished_at = ?, summary = ?, evidence = ?, issues = ? WHERE id = ?')
        .run(reviewPassed ? 'completed' : attempt === maxAttempts ? 'failed' : 'retrying', nowIso(),
          reviewPassed ? `Completed by ${agent.name}${attempt > 1 ? ` (after ${attempt} attempts)` : ''}` : `Review failed: ${review.issues.join('; ')}`,
          JSON.stringify(lastEvidence).slice(0, 60_000),
          JSON.stringify(redactSecrets(review.issues).value),
          runId);
      if (!reviewPassed) {
        checkpointTask({
          workspaceId: mission.workspace_id, taskId: task.id, missionId, runId, attempt,
          status: 'failed', output: lastOutput, evidence: lastEvidence,
          checkpoint: { tool: result.tool, ok: result.ok, reviewPassed, issues: review.issues },
        });
      }

      recordVerification({
        workspaceId: mission.workspace_id, missionId, taskId: task.id, runId,
        objective: task.objective,
        acceptanceCriteria: parseJson<string[]>(task.acceptance, []),
        expectedOutput: task.tool ? `A successful ${task.tool} result satisfying the task acceptance criteria` : 'Task output satisfying the acceptance criteria',
        actualOutput: lastOutput,
        evidence: lastEvidence,
        checks: [
          { id: 'tool-execution', kind: 'runtime', description: 'The assigned tool completed without an execution error', status: result.ok ? 'passed' : 'failed', evidence: result.ok ? `${result.tool} returned in ${result.durationMs} ms` : (result.error ?? 'unknown tool error') },
          { id: 'acceptance-review', kind: 'acceptance', description: 'Deterministic acceptance review over the actual output and evidence', status: review.passed ? 'passed' : 'failed', evidence: review.issues.join('; ') || 'All deterministic acceptance checks passed.' },
          { id: 'dependency-satisfaction', kind: 'planning', description: 'Every dependency was completed before this task ran', status: deps.every((id) => (db.prepare('SELECT status FROM os_tasks WHERE id = ?').get(id) as { status?: string } | undefined)?.status === 'completed') ? 'passed' : 'failed', evidence: deps.length ? deps.join(', ') : 'No dependencies declared.' },
          { id: 'lease-ownership', kind: 'concurrency', description: 'The executing worker held the durable lease for this task', status: getTaskLease(mission.workspace_id, task.id)?.ownerId === workerId ? 'passed' : 'failed', evidence: `worker ${workerId}` },
          { id: 'checkpoint-continuity', kind: 'recovery', description: 'The run did not silently continue an uncertain prior side effect', status: 'passed', evidence: priorCheckpoint ? `prior checkpoint ${priorCheckpoint.status}` : 'no prior checkpoint' },
          {
            id: 'skill-context-provenance', kind: 'provenance',
            description: 'Approved skill knowledge was selected with version and instruction digest, within the token budget',
            status: skillSelection.selected.length ? 'passed' : 'not_run',
            evidence: skillSelection.selected.length
              ? `${skillSelection.selected.map((entry) => `${entry.skill.key}@${entry.skill.version}:${entry.skill.instructionDigest}`).join(', ')} (${skillSelection.tokensUsed}/${skillSelection.tokenBudget} tokens)`
              : 'No task-relevant auto-load skill was selected.',
          },
          ...independent.checks,
        ],
        result: reviewPassed ? 'passed' : 'failed',
        failureReason: reviewPassed ? '' : lastIssues.join('; '),
        verifier: 'wora.verifier/independent',
      });
      maybeTestStage('after-verification');
      if (reviewPassed) {
        checkpointTask({
          workspaceId: mission.workspace_id, taskId: task.id, missionId, runId, attempt,
          status: 'completed', output: lastOutput, evidence: lastEvidence,
          checkpoint: { tool: result.tool, ok: result.ok, reviewPassed, issues: review.issues },
        });
        maybeTestStage('after-completed-checkpoint');
      }

      recordAgentPerformance({
        workspaceId: mission.workspace_id, agentId: agent.id, taskCategory: task.specialization,
        result: reviewPassed ? 'passed' : 'failed', durationMs: lastDuration,
      });
      // Capability replacement: only a schema-compatible, already-authorized
      // alternative may replace a failed capability. Completed tasks are not
      // touched, the original failure stays in the decision record, and the
      // replacement still runs through authorization and independent review.
      if (!reviewPassed && attempt >= maxAttempts && fallbackAttempts < fallbackTools.length) {
        const failedTool = task.tool;
        const failureCategory = classifyFailure(lastIssues);
        let replacement: { tool: string; remaining: string[] } | null = null;
        let replacementSemantic: ReturnType<typeof evaluateSemanticCompatibility> | null = null;
        let rejection = 'No schema-compatible fallback was available.';
        while (fallbackAttempts < fallbackTools.length) {
          const candidateTool = fallbackTools[fallbackAttempts]!;
          fallbackAttempts += 1;
          const currentDef = failedTool ? getTool(failedTool, mission.workspace_id) : null;
          const candidateDef = getTool(candidateTool, mission.workspace_id);
          const registered = new Map(listRegisteredTools(mission.workspace_id).map((tool) => [tool.toolId, tool]));
          const outputEquivalent = JSON.stringify(registered.get(failedTool ?? '')?.outputSchema ?? null)
            === JSON.stringify(registered.get(candidateTool)?.outputSchema ?? null);
          const structural = Boolean(currentDef && candidateDef && outputEquivalent
            && JSON.stringify(currentDef.inputSchema ?? {}) === JSON.stringify(candidateDef.inputSchema ?? {}));
          const semantic = failedTool && candidateDef
            ? evaluateSemanticCompatibility({ primaryTool: failedTool, fallbackTool: candidateTool, workspaceId: mission.workspace_id, risk: candidateDef.risk })
            : null;
          const authorized = Boolean(lastProfile && authorizeTool(mission.workspace_id, lastProfile, candidateTool).allowed);
          if (structural && semantic?.compatible && authorized) {
            replacement = { tool: candidateTool, remaining: fallbackTools.slice(fallbackAttempts) };
            replacementSemantic = semantic;
            break;
          }
          rejection = !candidateDef ? `Fallback ${candidateTool} is not registered.`
            : !structural ? `Fallback ${candidateTool} has a different input/output contract; substitution refused.`
              : !semantic?.compatible ? `Fallback ${candidateTool} failed semantic compatibility: ${semantic?.reasons.slice(0, 3).join('; ') ?? 'no contract'}.`
                : `Fallback ${candidateTool} is not authorized for ${agent.name}.`;
        }
        if (replacement) {
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare("UPDATE os_tasks SET tool = ?, fallback_tools = ?, status = 'planned', detail = ?, updated_at = ? WHERE id = ?")
              .run(replacement.tool, JSON.stringify(replacement.remaining),
                `capability_replacement: ${failedTool ?? 'none'} -> ${replacement.tool}; input schema verified equivalent and agent authorized`.slice(0, 500),
                nowIso(), task.id);
            db.exec('COMMIT');
          } catch (error) {
            try { db.exec('ROLLBACK'); } catch { /* preserve original */ }
            throw error;
          }
          saveDecisionRecord({
            workspaceId: mission.workspace_id, missionId, kind: 'capability-replacement',
            comparison: {
              taskId: task.id, fromTool: failedTool, toTool: replacement.tool,
              failureCategory, previousFailure: lastIssues.slice(0, 12), inputSchemaEquivalent: true, outputSchemaEquivalent: true, semanticCompatible: true, semanticChecks: replacementSemantic?.checks ?? [],
              authorizedForAgent: agent.id, remainingFallbacks: replacement.remaining,
            },
            reason: `Compatible capability replacement ${failedTool ?? 'none'} -> ${replacement.tool}; original failure preserved.`,
            actor: 'orchestrator',
          });
          audit(db, { workspaceId: mission.workspace_id, actor: 'orchestrator', action: 'task.capability_replacement', subject: task.id, detail: { missionId, from: failedTool, to: replacement.tool, failureCategory } });
          try { replanMission(mission.workspace_id, missionId, `capability replacement ${failedTool ?? 'none'} -> ${replacement.tool}`, 'orchestrator'); } catch { /* plan version is best-effort; execution graph is already persisted */ }
          task.tool = replacement.tool;
          task.fallback_tools = JSON.stringify(replacement.remaining);
          taskInput = openTaskToolInput<Record<string, unknown>>(mission.workspace_id, task.id, task.tool_input, {});
          attempt = 1;
          reassignments = 0;
          lastOutput = null;
          lastIssues = [];
          lastEvidence = [];
          fallbackTools = replacement.remaining;
          fallbackAttempts = 0;
          continue;
        }
        saveDecisionRecord({
          workspaceId: mission.workspace_id, missionId, kind: 'capability-replacement-gap',
          comparison: { taskId: task.id, fromTool: failedTool, rejection, fallbackTools },
          reason: rejection, actor: 'orchestrator',
        });
      }
      if (!reviewPassed && attempt >= maxAttempts && reassignments < 1) {
        const replacement = selectReplacement(mission.workspace_id, {
          id: task.id, title: task.title, objective: task.objective, specialization: task.specialization,
          tool: task.tool, acceptance: parseJson<string[]>(task.acceptance, []), dependsOn: [], agentId: agent.id,
        }, missionId, agent.id);
        if (replacement.agent) {
          audit(db, { workspaceId: mission.workspace_id, actor: 'orchestrator', action: 'task.reassign', subject: task.id, detail: { missionId, from: agent.id, to: replacement.agent.id, reason: lastIssues.join('; ').slice(0, 300) } });
          agent = replacement.agent;
          task.agent_id = agent.id;
          db.prepare('UPDATE os_tasks SET agent_id = ?, updated_at = ? WHERE id = ?').run(agent.id, nowIso(), task.id);
          reassignments += 1;
          attempt = 1;
          continue;
        }
      }
      if (!reviewPassed) {
        const adaptiveCandidate = alternativeForTask({ tool: task.tool, toolInput: taskInput });
        const assessment = assessReplan({
          failureCategory: classifyFailure(lastIssues),
          methodFailed: true,
          alternativesAvailable: Boolean(adaptiveCandidate),
          previousReplans: adaptiveReplans,
        });
        saveDecisionRecord({
          workspaceId: mission.workspace_id, missionId, kind: 'failure-assessment',
          comparison: { ...assessment, candidate: adaptiveCandidate?.tool ?? null },
          reason: assessment.reason,
          actor: 'orchestrator',
        });
        if (assessment.action === 'replan' && adaptiveReplans < 1) {
          db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('failed', nowIso(), task.id);
          const transition = applyAdaptiveReplan({
            workspaceId: mission.workspace_id, missionId, taskId: task.id,
            reason: `method ${task.tool ?? 'none'} failed: ${lastIssues.join('; ').slice(0, 300)}`,
            actor: 'orchestrator',
          });
          if (transition.applied) {
            const fresh = db.prepare('SELECT tool, tool_input FROM os_tasks WHERE id = ?').get(task.id) as { tool: string | null; tool_input: string };
            task.tool = fresh.tool;
            task.tool_input = fresh.tool_input;
            taskInput = openTaskToolInput<Record<string, unknown>>(mission.workspace_id, task.id, fresh.tool_input, {});
            adaptiveReplans += 1;
            attempt = 1;
            reassignments = 0;
            lastOutput = null;
            lastIssues = [];
            lastEvidence = [];
            maybeTestStage('after-adaptive-replan');
            continue;
          }
          saveDecisionRecord({
            workspaceId: mission.workspace_id, missionId, kind: 'adaptive-replan-gap',
            comparison: transition, reason: transition.reason, actor: 'orchestrator',
          });
        }
        attempt += 1;
      }
    }
    if (cancelledMidRun) continue;
    const liveBeforeHandoff = db.prepare('SELECT status FROM os_missions WHERE id = ?').get(missionId) as { status?: string } | undefined;
    if (liveBeforeHandoff?.status === 'cancelled') {
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), task.id);
      continue;
    }

    // Mandatory handoff contract
    const failureCategory = reviewPassed ? null : classifyFailure(lastIssues);
    const contract = {
      taskId: task.id,
      fromAgent: { id: agent.id, name: agent.name, specialization: agent.specialization },
      taskState: reviewPassed ? 'completed_verified' : 'failed_review',
      failureCategory,
      reassignmentCount: reassignments,
      objective: task.objective,
      inputContext: { tool: task.tool, toolInput: openTaskToolInput(mission.workspace_id, task.id, task.tool_input, {}), mission: missionId },
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
      evidenceReferences: lastEvidence.map((entry) => entry['artifactDigest']).filter(Boolean),
      recommendedNextAction: reviewPassed
        ? (tasks.some((t) => parseJson<string[]>(t.depends_on, []).includes(task.id)) ? 'Hand off to dependent specialists; they will validate this contract before proceeding.' : 'Include in the mission deliverable for user review.')
        : 'Return to the authoring agent for correction or escalate — do not build on this output.',
    };
    db.prepare('INSERT INTO os_handoffs (id, mission_id, task_id, from_specialization, to_specialization, contract, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('hof'), missionId, task.id, task.specialization, 'review', JSON.stringify(contract), nowIso());
    maybeTestStage('after-handoff');

    if (reviewPassed) {
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('completed', nowIso(), task.id);
      maybeTestStage('after-task-completed');
      completed.add(task.id);
      addMemory({ workspaceId: mission.workspace_id, scope: 'execution', scopeId: missionId, content: redactSecrets(`Task "${task.title}" completed by ${agent.name}. ${contract.deliverables.join(' ')}`).value, tags: ['execution', task.specialization], provenance: `mission:${missionId}`, agentId: agent.id, actor });
    } else {
      db.prepare('UPDATE os_tasks SET status = ?, updated_at = ? WHERE id = ?').run('failed', nowIso(), task.id);
      failed = true;
    }
    } finally {
      clearInterval(heartbeat);
      releaseTaskLease({ workspaceId: mission.workspace_id, taskId: task.id, ownerId: workerId });
    }
  }

  if (options.workerMode) return;
  await afterMission(missionId, actor, mission);
}

async function afterMission(missionId: string, actor: string, mission: { workspace_id: string; objective: string }): Promise<void> {
  recoverExpiredTaskLeases(mission.workspace_id);
  // Another worker may still hold tasks from this mission; never finalize over it.
  if (listTaskLeases(mission.workspace_id, missionId).length > 0) return;
  finalizeMission(missionId, actor);
  try {
    await maybeDistillPlaybook({ workspaceId: mission.workspace_id, missionId, objective: mission.objective, actor });
    if (getMissionDetail(mission.workspace_id, missionId)?.status === 'completed') {
      collectCandidateLessons(mission.workspace_id, missionId, actor);
    }
  } catch (err) {
    logger.warn({ err, missionId }, 'playbook or lesson collection failed (mission unaffected)');
  }
}

function classifyFailure(issues: string[]): string {
  const text = issues.join('; ').toLowerCase();
  if (/permission|not enabled|not assigned|not available|authoriz|denied/u.test(text)) return 'authorization';
  if (/timed out|timeout/u.test(text)) return 'timeout';
  if (/invalid input|schema/u.test(text)) return 'invalid_input';
  if (/no output|empty/u.test(text)) return 'empty_output';
  if (/infeasible|solver|status:/u.test(text)) return 'solver_failure';
  return 'verification_failed';
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
  const mission = db.prepare('SELECT * FROM os_missions WHERE id = ?').get(missionId) as { id: string; workspace_id: string; objective: string; status: string; created_at: string };
  if (mission.status === 'cancelled' || mission.status === 'paused' || mission.status === 'completed') return;
  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index').all(missionId) as unknown as TaskRow[];
  const pending = tasks.filter((t) => ['planned', 'created', 'assigned', 'running'].includes(t.status));
  if (pending.length) {
    if (listTaskLeases(mission.workspace_id, missionId).length > 0) return;
    for (const task of pending) {
      db.prepare('UPDATE os_tasks SET status = ?, detail = ?, updated_at = ? WHERE id = ? AND status IN (?, ?, ?, ?)')
        .run('blocked', 'orphaned_assignment — no worker held a lease for this task', nowIso(), task.id, 'planned', 'created', 'assigned', 'running');
      task.status = 'blocked';
      task.detail = 'orphaned_assignment — no worker held a lease for this task';
    }
  }
  const allDone = tasks.every((t) => t.status === 'completed');
  const anyFailed = tasks.some((t) => t.status === 'failed' || t.status === 'blocked');
  const anyAwaiting = tasks.some((t) => t.status === 'blocked' && t.detail.startsWith('awaiting_approval:'));
  let status: MissionStatus = allDone ? 'completed' : anyAwaiting ? 'awaiting_approval' : 'failed';
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
  const content = redactSecrets(lines.join('\n')).value;
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
  const outcome = verifyMissionOutcome(mission.workspace_id, missionId);
  // Completed work without retained verification is reported as an unverified
  // outcome, not silently upgraded to verified. Missing evidence does not make
  // already-completed work disappear; the outcome field carries that caveat.
  if (allDone && !['verified', 'partially_verified', 'unverified'].includes(outcome.status)) status = 'failed';
  const outcomeNote = outcome.status === 'verified'
    ? 'Outcome independently verified.'
    : outcome.status === 'partially_verified'
      ? `Partially verified: ${outcome.reasons.join(' ') || 'some outcome evidence is not externally observable.'}`
      : `Outcome not verified: ${outcome.status}. ${outcome.reasons.join(' ')}`.trim();
  // A terminal mission must not retain a lease. Clear it before publishing the
  // terminal status so an observer cannot see `completed` with a live lease.
  clearMissionLeases(mission.workspace_id, missionId);
  clearMissionLease(mission.workspace_id, missionId);
  db.prepare('UPDATE os_missions SET status = ?, summary = ?, artifact_id = ?, outcome_status = ?, outcome_evidence = ?, updated_at = ? WHERE id = ?')
    .run(status, allDone ? `${tasks.length} task(s) completed with evidence. ${outcomeNote}` : `Finished with unresolved tasks — see failed/blocked below. ${outcomeNote}`, artifactId, outcome.status, JSON.stringify(outcome).slice(0, 120_000), nowIso(), missionId);
  try {
    recordOutcomeReasoningEvidence({ workspaceId: mission.workspace_id, missionId, status: outcome.status, taskEvidence: outcome.taskEvidence });
  } catch (err) {
    logger.warn({ err, missionId }, 'outcome evidence could not be attached to the reasoning model');
  }
  audit(db, { workspaceId: mission.workspace_id, actor, action: 'mission.finalize', subject: missionId, detail: { status, tasks: tasks.length, reasoning: getReasoningModel(mission.workspace_id, missionId)?.version ?? null } });
}

/**
 * Restart recovery: a mission that was mid-flight when the process died can
 * never finish on its own — nothing is executing it. Mark it and its running
 * tasks honestly so operators can resume via POST /missions/:id/execute
 * (re-entry is idempotent: completed tasks are skipped).
 */
export function markInterruptedMissions(workspaceId?: string): number {
  const db = getOsDb();
  recoverExpiredTaskLeases();
  recoverExpiredMissionLeases(workspaceId);
  const stale = (workspaceId
    ? db.prepare("SELECT id, workspace_id FROM os_missions WHERE workspace_id = ? AND status IN ('running', 'planning')").all(workspaceId)
    : db.prepare("SELECT id, workspace_id FROM os_missions WHERE status IN ('running', 'planning')").all()) as Array<{ id: string; workspace_id: string }>;
  for (const mission of stale) {
    // A live mission lease means another process is actively executing it.
    // Boot recovery must never mark a worker's mission interrupted.
    if (getMissionLease(mission.workspace_id, mission.id)) continue;
    clearMissionLeases(mission.workspace_id, mission.id);
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

/** Pause before the next task boundary. Running tool calls are not aborted. */
export function pauseMission(workspaceId: string, missionId: string, actor: string): boolean {
  const db = getOsDb();
  const result = db.prepare("UPDATE os_missions SET status = 'paused', updated_at = ? WHERE workspace_id = ? AND id = ? AND status NOT IN ('completed', 'cancelled')")
    .run(nowIso(), workspaceId, missionId);
  if (Number(result.changes) > 0) audit(db, { workspaceId, actor, action: 'mission.pause', subject: missionId, detail: {} });
  return Number(result.changes) > 0;
}

/** Resume a paused or failed mission; the caller then invokes executeMission. */
export function resumeMission(workspaceId: string, missionId: string, actor: string): boolean {
  const db = getOsDb();
  const result = db.prepare("UPDATE os_missions SET status = 'running', updated_at = ? WHERE workspace_id = ? AND id = ? AND status IN ('paused', 'failed', 'awaiting_approval')")
    .run(nowIso(), workspaceId, missionId);
  if (Number(result.changes) > 0) audit(db, { workspaceId, actor, action: 'mission.resume', subject: missionId, detail: {} });
  return Number(result.changes) > 0;
}

/** Cancel a mission and invalidate any task leases so no worker can continue it. */
export function cancelMission(workspaceId: string, missionId: string, actor: string): boolean {
  const db = getOsDb();
  const result = db.prepare("UPDATE os_missions SET status = 'cancelled', summary = 'Cancelled by an operator.', updated_at = ? WHERE workspace_id = ? AND id = ? AND status NOT IN ('completed', 'cancelled')")
    .run(nowIso(), workspaceId, missionId);
  if (Number(result.changes) > 0) {
    clearMissionLeases(workspaceId, missionId);
    db.prepare("UPDATE os_tasks SET status = 'cancelled', updated_at = ? WHERE mission_id = ? AND status NOT IN ('completed', 'cancelled')").run(nowIso(), missionId);
    audit(db, { workspaceId, actor, action: 'mission.cancel', subject: missionId, detail: {} });
  }
  return Number(result.changes) > 0;
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
  toolInput: openTaskToolInput(String(row.workspace_id), String(row.id), row.tool_input, {}),
  fallbackTools: parseJson<string[]>(row.fallback_tools ?? '[]', []),
  inputBindings: parseJson<InputBinding[]>(row.input_bindings ?? '[]', []),
  detail: row.detail,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function listMissions(workspaceId: string, limit = 30) {
  const db = getOsDb();
  const missions = db.prepare('SELECT * FROM os_missions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, Math.min(limit, 100)) as Array<Record<string, string>>;
  return redactSecrets(missions.map((m) => ({
    id: m['id'], objective: m['objective'], status: m['status'], outcomeStatus: m['outcome_status'] ?? 'unverified', summary: m['summary'], requestedBy: m['requested_by'], correlationId: m['correlation_id'] ?? null, artifactId: m['artifact_id'], createdAt: m['created_at'], updatedAt: m['updated_at'],
  }))).value;
}

export function getMissionDetail(workspaceId: string, missionId: string) {
  const db = getOsDb();
  const mission = db.prepare('SELECT * FROM os_missions WHERE workspace_id = ? AND id = ?').get(workspaceId, missionId) as
    | { id: string; workspace_id: string; objective: string; status: string; summary: string; requested_by: string; correlation_id?: string | null; artifact_id: string | null; outcome_status?: string; outcome_evidence?: string; created_at: string; updated_at: string }
    | undefined;
  if (!mission) return null;
  const tasks = db.prepare('SELECT * FROM os_tasks WHERE mission_id = ? ORDER BY order_index').all(missionId) as unknown as TaskRow[];
  const agents = new Map(listAgents(workspaceId).map((a: AgentRecord) => [a.id, a]));
  const runs = db.prepare('SELECT * FROM os_runs WHERE mission_id = ? ORDER BY started_at ASC').all(missionId) as Array<Record<string, string | number>>;
  const handoffs = db.prepare('SELECT * FROM os_handoffs WHERE mission_id = ? ORDER BY created_at ASC').all(missionId) as Array<Record<string, string>>;
  const artifacts = db.prepare('SELECT id, name, kind, created_at FROM os_artifacts WHERE mission_id = ?').all(missionId) as Array<Record<string, string>>;
  const approvals = listMissionApprovals(workspaceId, missionId);
  return redactSecrets({
    approvals,
    problemProfile: getProblemProfile(workspaceId, missionId),
    planVersions: listPlanVersions(workspaceId, missionId),
    planVerification: verifyPlanExecution(tasks.map((task) => ({ id: task.id, status: task.status, dependsOn: parseJson<string[]>(task.depends_on, []) }))),
    teamPlan: getTeamPlan(workspaceId, missionId),
    selectionDecisions: listSelectionDecisions(workspaceId, missionId),
    decisions: listDecisionRecords(workspaceId, missionId),
    verifications: listVerifications(workspaceId, { missionId, limit: 100 }),
    capabilitySnapshots: listCapabilitySnapshots(workspaceId, { missionId, limit: 100 }),
    skillContexts: listSkillContexts(workspaceId, { missionId, limit: 100 }),
    problemModel: getProblemModel(workspaceId, missionId),
    composition: getComposition(workspaceId, missionId),
    outcomeStatus: mission.outcome_status ?? 'unverified',
    outcomeVerification: getMissionOutcome(workspaceId, missionId),
    reasoning: getReasoningModel(workspaceId, missionId),
    id: mission.id,
    objective: mission.objective,
    status: mission.status,
    summary: mission.summary,
    requestedBy: mission.requested_by,
    correlationId: mission.correlation_id ?? null,
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
  }).value;
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
