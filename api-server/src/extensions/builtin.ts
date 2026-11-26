/**
 * WORA official catalog — built-in Skills and one reference MCP Plugin.
 *
 * Seeded into a read-only, official-trust marketplace in the same database.
 * Skills are operational knowledge with explicit contracts and verification;
 * none of them claims a capability its declared tools cannot support. The
 * reference MCP plugin exists so the full plugin path (approval → enable →
 * discover → execute) can be exercised without any external service.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getOsDb, newId, nowIso } from '../os/db.js';
import {
  createMarketplace, getMarketplace, listMarketplaces, markMissingPackages, upsertPackage, extensionAudit,
} from './store.js';
import { validateManifest, type PackageManifest, type SkillManifest } from './manifest.js';
import { ensureExtensionSchema } from './schema.js';

export const BUILTIN_MARKETPLACE_URL = 'bundled://wora-official';
export const BUILTIN_VERSION = '1.0.0';

interface BuiltinSkill {
  id: string;
  name: string;
  category: string;
  type: 'knowledge' | 'task' | 'tool' | 'workflow';
  description: string;
  tags: string[];
  capabilities: string[];
  tools: string[];
  permissions: string[];
  knowledge: string[];
  workflow: string[];
  inputs: string[];
  outputs: string[];
  verification: string[];
  failure: string;
  handoff: string;
  security: string;
  risk: 'low' | 'medium' | 'high';
}

const SKILLS: BuiltinSkill[] = [
  {
    id: 'wora.software-architecture',
    name: 'Software Architecture',
    category: 'engineering',
    type: 'knowledge',
    description: 'Produces decision-ready architecture: boundaries, interfaces, data ownership, failure modes and recorded trade-offs.',
    tags: ['architecture', 'design', 'adr', 'systems'],
    capabilities: ['architecture-review', 'module-boundaries', 'trade-off-analysis'],
    tools: ['fs.workspace_read', 'text.extract_summary'],
    permissions: ['workspace:read'],
    knowledge: [
      'Separation of concerns, dependency direction and cohesion/coupling heuristics',
      'Interface contracts, versioning and backward compatibility rules',
      'Failure domains, blast radius, idempotency and retry semantics',
      'Non-functional requirements: latency, throughput, availability, cost, operability',
    ],
    workflow: [
      'Restate the objective and list the constraints that are actually known.',
      'Inventory existing components from the workspace before proposing anything new.',
      'Draw the component boundaries and name every interface with its contract.',
      'Record at least two viable options and the trade-off that decides between them.',
      'Write an ADR: context, decision, consequences, rejected alternatives, revisit trigger.',
      'List the failure modes and the observable signal for each.',
    ],
    inputs: ['Objective and constraints', 'Existing code or component inventory', 'Non-functional targets'],
    outputs: ['Architecture decision record', 'Component/interface map', 'Risk and failure-mode table'],
    verification: [
      'Every proposed interface has an input and output contract',
      'Each decision names the rejected alternative and why',
      'Failure modes have an observable signal, not just a mitigation',
    ],
    failure: 'If constraints are missing, state the assumption explicitly and mark the decision provisional. Never invent load numbers or SLAs.',
    handoff: 'Hand the ADR plus interface contracts to backend/frontend/database engineering skills; they own implementation detail.',
    security: 'Never propose storing secrets in source, logs or client bundles. Call out trust boundaries and authorization checks per interface.',
    risk: 'low',
  },
  {
    id: 'wora.backend-engineering',
    name: 'Backend Engineering',
    category: 'engineering',
    type: 'task',
    description: 'Builds and reviews server-side behaviour: validated APIs, transactional writes, error contracts and auditable side effects.',
    tags: ['backend', 'api', 'node', 'services'],
    capabilities: ['api-design', 'service-implementation', 'error-contracts'],
    tools: ['scaffold.webapp', 'fs.workspace_read', 'security.scan'],
    permissions: ['workspace:read', 'workspace:write'],
    knowledge: [
      'HTTP semantics: status codes, idempotency, pagination and content negotiation',
      'Input validation at the boundary and typed internal models',
      'Transaction boundaries, isolation levels and retry-safe writes',
      'Structured error envelopes that never leak stack traces or secrets',
    ],
    workflow: [
      'Read the existing route and data layers; match their conventions.',
      'Define the request and response contract before writing handlers.',
      'Validate all input at the boundary; reject unknown fields.',
      'Enforce authorization server-side for every route, never in the client only.',
      'Wrap multi-row writes in a transaction and define the failure path.',
      'Add an audit entry for security-relevant mutations.',
      'Run the project tests and a static security scan on the changed files.',
    ],
    inputs: ['Endpoint or service requirement', 'Existing route/data conventions', 'Authorization model'],
    outputs: ['Implemented handler and contract', 'Tests or verification evidence', 'Security scan result'],
    verification: [
      'Invalid input returns 4xx with a safe message',
      'Authorization is enforced in the handler, not only in the UI',
      'Every mutation has a defined failure and rollback path',
    ],
    failure: 'If a dependency is unavailable, fail closed with a clear error and do not silently degrade authorization. Report the missing dependency instead of mocking it in production code.',
    handoff: 'Hand the contract and tests to QA & Testing; hand schema changes to Database Engineering.',
    security: 'Secrets come from the secret store only. Never log request bodies, tokens or personal data. Treat all external input as untrusted.',
    risk: 'medium',
  },
  {
    id: 'wora.frontend-engineering',
    name: 'Frontend Engineering',
    category: 'engineering',
    type: 'task',
    description: 'Implements accessible, responsive interfaces that preserve the product design system and work in both RTL and LTR.',
    tags: ['frontend', 'react', 'accessibility', 'rtl'],
    capabilities: ['ui-implementation', 'accessibility', 'rtl-layout'],
    tools: ['scaffold.webapp', 'fs.workspace_read'],
    permissions: ['workspace:read', 'workspace:write'],
    knowledge: [
      'Semantic HTML, focus management and keyboard interaction',
      'CSS logical properties for direction-agnostic layout',
      'Loading, empty, error, success and permission states as first-class UI states',
      'Design tokens and existing component primitives before new ones',
    ],
    workflow: [
      'Inspect the design system and reuse existing primitives.',
      'Define the states the view must handle before styling it.',
      'Use logical properties (inline-start/end) instead of left/right.',
      'Wire every control to a real operation; remove decorative controls.',
      'Verify keyboard navigation, focus return after dialogs and screen-reader labels.',
      'Check both Arabic (RTL) and English (LTR) rendering.',
    ],
    inputs: ['View or interaction requirement', 'Design tokens and primitives', 'API contract'],
    outputs: ['Implemented view', 'State matrix', 'Accessibility and RTL verification notes'],
    verification: [
      'No action exists without a backend operation',
      'Dialog focus is trapped and restored on close',
      'Layout uses logical properties and mirrors correctly in RTL',
    ],
    failure: 'If an API is unavailable, render an explicit error state with a retry action. Never fake success or hide the failure.',
    handoff: 'Hand interaction states and API assumptions to Backend Engineering; hand the state matrix to QA.',
    security: 'Never render untrusted HTML. Do not place secrets or internal identifiers in client state.',
    risk: 'low',
  },
  {
    id: 'wora.database-engineering',
    name: 'Database Engineering',
    category: 'engineering',
    type: 'knowledge',
    description: 'Designs durable schemas and safe migrations: constraints, indexes, tenant isolation and reversible changes.',
    tags: ['database', 'sqlite', 'schema', 'migrations'],
    capabilities: ['schema-design', 'migration-safety', 'query-review'],
    tools: ['fs.workspace_read', 'stats.describe'],
    permissions: ['workspace:read'],
    knowledge: [
      'Normalization versus deliberate denormalization, and when each is right',
      'Foreign keys, unique constraints and check constraints as invariants',
      'Index selection driven by real query predicates and ordering',
      'Online migration patterns: additive first, backfill, then tighten',
    ],
    workflow: [
      'Read the existing schema and migration mechanism; do not create a parallel store.',
      'Write the invariants as constraints, not only as application checks.',
      'Design the index from the actual query, then verify the plan.',
      'Make the migration additive and reversible; never drop data in one step.',
      'Define the rollback path and the data validation query.',
      'Document the retention and deletion behaviour.',
    ],
    inputs: ['Entity requirements and access patterns', 'Existing schema and migration style', 'Retention policy'],
    outputs: ['Schema/migration plan', 'Constraint and index list', 'Rollback and validation steps'],
    verification: [
      'Every invariant is enforced by a constraint where possible',
      'Each index maps to a named query',
      'The rollback path is written and tested',
    ],
    failure: 'If the data model is ambiguous, stop and list the ambiguity. Never invent tenant keys or delete existing data to make a migration pass.',
    handoff: 'Hand the schema and migration to Backend Engineering; hand data-validation queries to QA.',
    security: 'Scope every row to its tenant/workspace. Encrypt secrets at rest and never select them into general-purpose responses.',
    risk: 'medium',
  },
  {
    id: 'wora.devops-runtime',
    name: 'DevOps & Runtime Engineering',
    category: 'operations',
    type: 'workflow',
    description: 'Operates the runtime: health signals, deployment hygiene, rollback plans and honest capacity reporting.',
    tags: ['devops', 'runtime', 'deployment', 'observability'],
    capabilities: ['runtime-diagnostics', 'deployment-planning', 'observability'],
    tools: ['system.diagnostics', 'fs.workspace_list', 'security.scan'],
    permissions: ['host:read', 'workspace:read'],
    knowledge: [
      'Health versus readiness, and what each probe may depend on',
      'Resource limits, backpressure and graceful shutdown',
      'Configuration hygiene: validated at boot, secrets injected, never logged',
      'Rollback and forward-fix strategies for stateful changes',
    ],
    workflow: [
      'Collect real host and process signals; never fabricate capacity numbers.',
      'Map each service dependency and its failure behaviour.',
      'Define the health and readiness checks and what they prove.',
      'Write the deployment and rollback steps with the exact commands.',
      'State the observability signal for each failure mode.',
      'Flag anything that requires a human decision or a maintenance window.',
    ],
    inputs: ['Deployment target and constraints', 'Runtime diagnostics', 'Dependency inventory'],
    outputs: ['Runtime assessment', 'Deployment/rollback runbook', 'Observability checklist'],
    verification: [
      'Diagnostics are from the real host, with scope stated',
      'Rollback steps are executable and ordered',
      'No secret value appears in any command or output',
    ],
    failure: 'If a probe cannot run, report it as unavailable rather than green. Never mark an unverified deployment healthy.',
    handoff: 'Hand the runbook to the operator; hand security findings to Security Engineering.',
    security: 'Do not weaken TLS, disable authorization or widen CORS to fix an outage. Escalate instead.',
    risk: 'medium',
  },
  {
    id: 'wora.qa-testing',
    name: 'QA & Testing',
    category: 'quality',
    type: 'task',
    description: 'Designs and executes evidence-based verification: test plans, real executions, defect reports and release confidence.',
    tags: ['qa', 'testing', 'regression', 'verification'],
    capabilities: ['test-design', 'test-execution', 'defect-triage'],
    tools: ['host.exec', 'fs.workspace_read'],
    permissions: ['workspace:read', 'host:exec'],
    knowledge: [
      'Equivalence classes, boundary values and risk-based test prioritization',
      'Unit versus integration versus end-to-end evidence',
      'Flaky test diagnosis and deterministic test data',
      'Defect reports that reproduce, not opinions',
    ],
    workflow: [
      'Derive acceptance criteria from the requirement, not from the implementation.',
      'Choose the cheapest test level that can prove each criterion.',
      'Write deterministic tests with explicit fixtures and no network dependence.',
      'Execute the suite and capture the exact command and exit code.',
      'Report failures with reproduction steps and observed versus expected.',
      'State residual risk and what was not tested.',
    ],
    inputs: ['Acceptance criteria', 'Changed surface', 'Test environment constraints'],
    outputs: ['Test plan and cases', 'Execution evidence (command, exit code, output)', 'Defect list with residual risk'],
    verification: [
      'Each acceptance criterion maps to a test',
      'Evidence is a real execution, never a simulated result',
      'Residual risk and untested areas are listed',
    ],
    failure: 'If the environment cannot run the tests, say so and mark the result unverified. Never report a suite as passing without its output.',
    handoff: 'Hand defects to the owning engineering skill; hand release evidence to the reviewer.',
    security: 'Use synthetic data only. Never paste production credentials or personal data into a test fixture.',
    risk: 'medium',
  },
  {
    id: 'wora.security-engineering',
    name: 'Security Engineering',
    category: 'security',
    type: 'task',
    description: 'Threat-models and reviews systems: trust boundaries, authorization gaps, secret handling and supply-chain risk.',
    tags: ['security', 'threat-model', 'review', 'secrets'],
    capabilities: ['threat-modeling', 'secure-review', 'secrets-scan'],
    tools: ['security.scan', 'fs.workspace_read'],
    permissions: ['workspace:read'],
    knowledge: [
      'Trust boundaries and the principle of least privilege',
      'Authentication versus authorization, and server-side enforcement',
      'Injection classes, path traversal, SSRF and unsafe deserialization',
      'Secret lifecycle: storage, rotation, exposure in logs and client state',
    ],
    workflow: [
      'Map entry points and trust boundaries before reading code details.',
      'Check every entry point for authentication and authorization.',
      'Scan for hardcoded secrets and dangerous constructs; confirm each finding.',
      'Assess supply-chain exposure: package provenance, scripts, permissions.',
      'Rank findings by exploitability and impact, with a concrete fix.',
      'State clearly what the review did not cover.',
    ],
    inputs: ['System or change under review', 'Threat model context', 'Deployment model'],
    outputs: ['Prioritized findings with fixes', 'Threat model', 'Residual risk statement'],
    verification: [
      'Every finding names the file and the exploit path',
      'Authorization is checked server-side, not assumed from the UI',
      'Secret findings are reported without printing the secret',
    ],
    failure: 'If exploitability cannot be confirmed, label it as a hypothesis and say what evidence is missing. Do not downgrade a real finding because it is inconvenient.',
    handoff: 'Hand fixes to the owning engineering skill; require re-review after remediation.',
    security: 'Never copy a discovered secret into a report, chat or commit. Recommend revocation and rotation.',
    risk: 'medium',
  },
  {
    id: 'wora.github-engineering',
    name: 'GitHub Engineering',
    category: 'engineering',
    type: 'workflow',
    description: 'Runs repository workflows safely: focused branches, reviewable diffs, PR evidence and rollback notes.',
    tags: ['github', 'git', 'pull-request', 'review'],
    capabilities: ['branch-hygiene', 'pull-request-review', 'release-notes'],
    tools: ['fs.workspace_read', 'security.scan', 'text.extract_summary'],
    permissions: ['workspace:read', 'repository.read'],
    knowledge: [
      'Small, single-purpose commits and reviewable diffs',
      'PR descriptions that state what changed, why, and how it was verified',
      'Protected-branch and required-check expectations',
      'Secret hygiene in history and in CI configuration',
    ],
    workflow: [
      'Inspect the working tree and branch before changing anything.',
      'Create a purpose-named branch; never push to the protected default branch.',
      'Keep the diff scoped to the objective; separate refactors from behaviour changes.',
      'Run the relevant tests and attach the exact result to the PR.',
      'Describe risks, migration steps and rollback in the PR body.',
      'Do not merge or force-push unless explicitly authorized.',
    ],
    inputs: ['Objective and repository state', 'Test evidence', 'Review constraints'],
    outputs: ['Scoped diff', 'PR description with verification', 'Rollback note'],
    verification: [
      'The diff contains only the intended change',
      'Tests were executed and their result is quoted',
      'No secret, credential or environment dump is in the diff',
    ],
    failure: 'If a check cannot run, say so in the PR instead of claiming success. If the branch diverges unexpectedly, stop and report before rewriting history.',
    handoff: 'Hand review findings to the code owner; hand release notes to the release process.',
    security: 'Use least-privilege tokens. Never print a token or embed it in a remote URL that is committed.',
    risk: 'low',
  },
  {
    id: 'wora.agent-architecture',
    name: 'Agent Architecture',
    category: 'ai',
    type: 'knowledge',
    description: 'Designs persistent agents with explicit roles, tool allow-lists, permissions, evaluation criteria and capability profiles.',
    tags: ['agents', 'capability-profile', 'permissions', 'design'],
    capabilities: ['agent-design', 'capability-assignment', 'evaluation-design'],
    tools: ['agents.create', 'text.extract_summary'],
    permissions: ['agents:write', 'memory:read'],
    knowledge: [
      'Role, specialization and the boundary between them',
      'Least-privilege tool and permission allow-lists',
      'Capability profiles: skills, plugins, tools, scopes and limits',
      'Evaluation criteria that can be checked from evidence',
    ],
    workflow: [
      'State the job the agent owns and the jobs it must hand off.',
      'Choose the narrowest tool set that can complete the job.',
      'Grant only the permissions those tools require.',
      'Assign skills/plugins by scope; prefer project or agent scope over instance.',
      'Define measurable evaluation criteria and failure escalation.',
      'Record the resolved capability profile used at first execution.',
    ],
    inputs: ['Agent objective', 'Required tools and data', 'Permission policy'],
    outputs: ['Agent definition', 'Capability profile', 'Evaluation criteria'],
    verification: [
      'The agent cannot exceed its declared tool allow-list',
      'Every permission maps to a concrete tool requirement',
      'Evaluation criteria are observable in evidence',
    ],
    failure: 'If the objective needs a capability that is not installed, report the gap and request installation instead of granting broad permissions.',
    handoff: 'Hand the agent definition to Multi-Agent Orchestration for routing and to Security Engineering for permission review.',
    security: 'Never grant instance-wide scope or wildcard permissions for convenience. Explicit deny always wins.',
    risk: 'high',
  },
  {
    id: 'wora.multi-agent-orchestration',
    name: 'Multi-Agent Orchestration',
    category: 'ai',
    type: 'knowledge',
    description: 'Plans and coordinates specialist agents: decomposition, dependency order, handoff contracts and failure isolation.',
    tags: ['orchestration', 'decomposition', 'handoff', 'coordination'],
    capabilities: ['task-decomposition', 'handoff-contracts', 'dependency-ordering'],
    tools: ['text.extract_summary'],
    permissions: ['memory:read'],
    knowledge: [
      'Decomposition into independently verifiable tasks',
      'Dependency ordering and parallelizable branches',
      'Handoff contracts: inputs, outputs, acceptance, remaining issues',
      'Failure isolation: one failed task blocks only its dependents',
    ],
    workflow: [
      'Decompose the objective into tasks with one owner and one deliverable each.',
      'Name the dependency edges and the acceptance criteria per task.',
      'Assign the narrowest specialist who can satisfy each criterion.',
      'Define the handoff contract before execution starts.',
      'On failure, retry once with a corrected input, then escalate; never build on failed output.',
      'Record the final capability snapshot for the mission.',
    ],
    inputs: ['Objective', 'Available specialists and capabilities', 'Acceptance policy'],
    outputs: ['Task graph', 'Handoff contracts', 'Execution report with evidence'],
    verification: [
      'Every task has acceptance criteria and an owner',
      'Dependent tasks are blocked when a prerequisite fails',
      'Handoff contracts carry evidence, not assertions',
    ],
    failure: 'If no specialist has the required capability, stop and report the capability gap. Do not silently widen permissions.',
    handoff: 'Hand each task contract to its specialist; hand the execution report to the requester.',
    security: 'Do not let one agent inherit another agent\'s credentials or tool grants. Capabilities are per agent.',
    risk: 'low',
  },
  {
    id: 'wora.tool-mcp-engineering',
    name: 'Tool & MCP Engineering',
    category: 'ai',
    type: 'knowledge',
    description: 'Registers tools and MCP servers safely: schemas, permissions, timeouts, health checks and execution audit.',
    tags: ['tools', 'mcp', 'integration', 'schemas'],
    capabilities: ['tool-registration', 'mcp-configuration', 'execution-audit'],
    tools: ['system.diagnostics', 'fs.workspace_read'],
    permissions: ['host:read', 'workspace:read'],
    knowledge: [
      'JSON Schema input/output contracts and bounded validation',
      'Risk tiers, required permissions and human approval gates',
      'MCP transports: stdio child process versus HTTP, and their isolation',
      'Timeout, health and failure semantics for external tools',
    ],
    workflow: [
      'Define the tool contract: input schema, output schema, risk, timeout.',
      'Choose the isolation model: MCP stdio, MCP HTTP or HTTP API.',
      'Map each declared permission to a real capability and mark sensitive ones.',
      'Declare required secrets by name only; never embed values.',
      'Add a health check that fails closed and a timeout for every call.',
      'Verify execution writes an audit entry without logging payload secrets.',
    ],
    inputs: ['Integration requirement', 'External service contract', 'Permission policy'],
    outputs: ['Tool/MCP manifest', 'Permission review', 'Health and timeout policy'],
    verification: [
      'A tool cannot execute without its declared permissions',
      'Health check failure is visible and blocks execution',
      'Audit records exist for success, denial and failure',
    ],
    failure: 'If the external service cannot be reached, report the failure; never return fabricated tool output.',
    handoff: 'Hand the manifest to the package owner and the permission review to Security Engineering.',
    security: 'Treat every MCP server and HTTP integration as untrusted. Pass only declared secrets; never inherit the API process environment.',
    risk: 'medium',
  },
  {
    id: 'wora.cloud-browser-automation',
    name: 'Cloud Computer & Browser Automation',
    category: 'engineering',
    type: 'workflow',
    description: 'Operates real isolated cloud sessions and Chromium browsers for authorized research, interaction and evidence capture.',
    tags: ['cloud', 'browser', 'chromium', 'automation', 'screenshots'],
    capabilities: ['cloud-execution', 'browser-navigation', 'form-interaction', 'screenshot-evidence'],
    tools: ['cloud.computer_start', 'cloud.exec', 'cloud.write_file', 'cloud.read_file', 'cloud.list_files', 'cloud.computer_stop', 'browser.open', 'browser.inspect', 'browser.click', 'browser.type', 'browser.select', 'browser.scroll', 'browser.wait', 'browser.screenshot', 'browser.research', 'browser.close'],
    permissions: ['runtime:read', 'runtime:write', 'runtime:execute', 'browser:read', 'browser:interact'],
    knowledge: [
      'Session TTL, resource limits and provider isolation guarantees',
      'The difference between the Docker provider and the non-isolated process fallback',
      'Browser DOM inspection, accessible selectors and deterministic waits',
      'Evidence capture: real screenshot bytes, artifact IDs and page URL/title provenance',
      'SSRF/private-network blocking and the financial-action refusal policy',
    ],
    workflow: [
      'Select the task-appropriate provider: Docker for commands, browser for web interaction.',
      'Start one bounded session and record its ID; never reuse a stopped session.',
      'Open only authorized public URLs and inspect the real DOM before acting.',
      'Prefer accessible roles/text selectors and bounded waits; verify after each interaction.',
      'Capture a screenshot or Markdown research document and reference the artifact ID.',
      'Stop the session when the task is complete; report provider, limits and artifacts truthfully.',
    ],
    inputs: ['Authorized URL or command', 'Target interaction or extraction goal', 'Evidence requirement'],
    outputs: ['Executed action result', 'Persisted artifact (PNG or Markdown)', 'Session and audit record'],
    verification: [
      'The session reached running and the action returned a real response',
      'Screenshot bytes are non-zero and the artifact is persisted',
      'The final URL/title matches the inspected page and the session is stopped',
    ],
    failure: 'If no provider or Chromium executable is available, report the exact reason and do not simulate a result. On timeout, stop the session and surface the failure.',
    handoff: 'Hand extracted evidence to the research or QA skill; hand implementation changes to the owning engineering skill.',
    security: 'Never open private/metadata addresses, never complete payment/checkout actions, and never pass application secrets into the browser child process.',
    risk: 'medium',
  },
  {
    id: 'wora.memory-engineering',
    name: 'Memory Engineering',
    category: 'ai',
    type: 'knowledge',
    description: 'Designs durable memory: scopes, provenance, retention, access control and retrieval quality.',
    tags: ['memory', 'retrieval', 'provenance', 'retention'],
    capabilities: ['memory-scoping', 'provenance', 'retention-policy'],
    tools: ['text.extract_summary'],
    permissions: ['memory:read'],
    knowledge: [
      'Scope hierarchy: user, workspace, project, agent, organization, execution',
      'Provenance and confidence for every stored fact',
      'TTL, deletion and version history requirements',
      'Retrieval precision versus recall, and the cost of stale memory',
    ],
    workflow: [
      'Decide the narrowest scope that still makes the memory useful.',
      'Record provenance and the timestamp for every entry.',
      'Separate observed facts from hypotheses and decisions.',
      'Define TTL and deletion rules before writing.',
      'Verify that owner-scoped memory is invisible to other actors.',
      'Audit writes and deletions.',
    ],
    inputs: ['Knowledge to persist', 'Access policy', 'Retention requirement'],
    outputs: ['Memory schema and scopes', 'Provenance policy', 'Retention/deletion rules'],
    verification: [
      'Every entry has a scope, provenance and timestamp',
      'Owner-scoped entries are not readable by other actors',
      'Deletion and expiry are enforced, not advisory',
    ],
    failure: 'If the provenance is unknown, label it unknown; do not promote an unverified statement to memory.',
    handoff: 'Hand the memory policy to Agent Architecture; hand access-control checks to Security Engineering.',
    security: 'Never store credentials, tokens or unnecessary personal data in memory. Apply least privilege to reads.',
    risk: 'low',
  },
  {
    id: 'wora.systems-engineering',
    name: 'Systems Engineering',
    category: 'engineering',
    type: 'knowledge',
    description: 'Reasons about whole-system behaviour: interfaces, constraints, feedback loops and verification across components.',
    tags: ['systems', 'interfaces', 'constraints', 'reliability'],
    capabilities: ['system-analysis', 'interface-analysis', 'reliability-review'],
    tools: ['system.diagnostics', 'fs.workspace_list', 'stats.describe'],
    permissions: ['host:read'],
    knowledge: [
      'System boundaries, interfaces and emergent behaviour',
      'Feedback loops, queueing effects and saturation points',
      'Requirements traceability from objective to verification',
      'Whole-system trade-offs versus local optimization',
    ],
    workflow: [
      'Define the system boundary and every external interface.',
      'Enumerate constraints: technical, operational, regulatory, budget.',
      'Identify feedback loops and where they can amplify failure.',
      'Trace each requirement to a component and a verification method.',
      'Model the bottleneck rather than optimizing a non-critical part.',
      'State assumptions and the sensitivity of conclusions to them.',
    ],
    inputs: ['System objective and boundary', 'Interface inventory', 'Constraints'],
    outputs: ['System model', 'Constraint/assumption register', 'Verification trace'],
    verification: [
      'Every requirement traces to a verification method',
      'Assumptions are explicit and testable',
      'The identified bottleneck is supported by evidence',
    ],
    failure: 'If the system boundary is unclear, state it and proceed provisionally. Never present a local fix as a whole-system guarantee.',
    handoff: 'Hand subsystem work to the relevant engineering skill; keep the interface contracts authoritative.',
    security: 'Include the trust boundary in the system model; do not assume the network or the client is trustworthy.',
    risk: 'low',
  },
  {
    id: 'wora.operations-research',
    name: 'Operations Research',
    category: 'quantitative',
    type: 'tool',
    description: 'Formulates and solves allocation, scheduling and assignment problems, then revalidates the solution independently.',
    tags: ['operations-research', 'optimization', 'scheduling', 'assignment'],
    capabilities: ['linear-programming', 'mixed-integer-programming', 'scheduling', 'assignment'],
    tools: ['or.solve_lp', 'or.assignment', 'or.employee_schedule', 'sim.monte_carlo'],
    permissions: [],
    knowledge: [
      'LP/MIP formulation: variables, objective, constraints, bounds',
      'Feasibility versus optimality and how to report each',
      'Assignment and scheduling structure, and when a solver is overkill',
      'Independent validation of a solver solution',
    ],
    workflow: [
      'State decision variables, objective direction and every constraint in words first.',
      'Build the structured model and solve it with the real solver.',
      'Check the solver status; never present an infeasible model as a plan.',
      'Revalidate demand, availability and workload constraints in code.',
      'Report the objective value, the binding constraints and the sensitivity.',
      'Label any sample input as sample; never present it as real data.',
    ],
    inputs: ['Decision variables and constraints', 'Cost/benefit coefficients', 'Operational data or labeled sample'],
    outputs: ['Optimal or infeasible status', 'Solution and objective value', 'Independent validation report'],
    verification: [
      'Solver status is reported verbatim',
      'Constraints are revalidated independently of the solver',
      'Sample data is labeled as sample',
    ],
    failure: 'If the model is infeasible, report which constraint set cannot be met. Do not relax constraints silently to force a solution.',
    handoff: 'Hand the solution and sensitivity to Decision Intelligence; hand data quality issues to Data Engineering.',
    security: 'Do not embed confidential operational data in shared artifacts without authorization.',
    risk: 'low',
  },
  {
    id: 'wora.mathematical-optimization',
    name: 'Mathematical Optimization',
    category: 'quantitative',
    type: 'tool',
    description: 'Builds rigorous optimization models with explicit assumptions, bounds and optimality evidence.',
    tags: ['optimization', 'lp', 'mip', 'modeling'],
    capabilities: ['model-formulation', 'optimality-analysis', 'sensitivity-analysis'],
    tools: ['or.solve_lp', 'or.assignment'],
    permissions: [],
    knowledge: [
      'Convexity, linearity and integrality assumptions',
      'Duality and shadow prices as sensitivity evidence',
      'Numerical scaling and why it causes solver trouble',
      'When a heuristic is more honest than a false optimum',
    ],
    workflow: [
      'Write the mathematical model with units and bounds.',
      'Check that every assumption matches the stated problem.',
      'Solve and report the status and objective value.',
      'Inspect binding constraints and report the shadow price where available.',
      'Test sensitivity to the least certain coefficient.',
      'State clearly what the model does not capture.',
    ],
    inputs: ['Objective function', 'Constraint set', 'Coefficient sources and uncertainty'],
    outputs: ['Model formulation', 'Solution with status', 'Sensitivity and limitation notes'],
    verification: [
      'Units are consistent across the model',
      'Optimality or infeasibility is reported exactly',
      'At least one sensitivity result is shown',
    ],
    failure: 'If coefficients are guesses, label them and run a sensitivity range instead of presenting one number as truth.',
    handoff: 'Hand the model and sensitivity to Operations Research or Decision Intelligence for application.',
    security: 'No special restriction beyond data confidentiality; do not upload proprietary models to external services without authorization.',
    risk: 'low',
  },
  {
    id: 'wora.simulation-digital-twins',
    name: 'Simulation & Digital Twins',
    category: 'quantitative',
    type: 'tool',
    description: 'Runs seeded simulations and what-if scenarios, always labeling simulated output and its assumptions.',
    tags: ['simulation', 'digital-twin', 'monte-carlo', 'scenario'],
    capabilities: ['monte-carlo', 'scenario-analysis', 'forecast-baseline'],
    tools: ['sim.monte_carlo', 'forecast.linear', 'stats.describe'],
    permissions: [],
    knowledge: [
      'Triangular/PERT inputs and the meaning of p10/p50/p90',
      'Seed reproducibility and variance reporting',
      'Baseline versus scenario comparison',
      'The difference between a simulation and a measurement',
    ],
    workflow: [
      'Define drivers with optimistic, likely and pessimistic values and their source.',
      'Run the seeded simulation and report the distribution, not a single point.',
      'Record observations separately from simulated scenarios.',
      'Compare baseline and scenario with the same seed and trials.',
      'State the assumptions and what would invalidate the model.',
      'Label every simulated result as simulated.',
    ],
    inputs: ['Driver estimates', 'KPI definitions', 'Scenario adjustments'],
    outputs: ['Distribution summary (p10/p50/p90)', 'Scenario delta', 'Assumption register'],
    verification: [
      'Simulated results carry `simulated: true` or an explicit label',
      'The seed and trial count are recorded',
      'Baseline and scenario use comparable settings',
    ],
    failure: 'If inputs are fabricated or unknown, refuse to present the output as a forecast; report the missing evidence.',
    handoff: 'Hand scenario results to Decision Intelligence; hand driver data quality to Data Engineering.',
    security: 'Keep operational twin data scoped to its workspace; do not expose it to other tenants.',
    risk: 'low',
  },
  {
    id: 'wora.scientific-computing',
    name: 'Scientific Computing',
    category: 'quantitative',
    type: 'task',
    description: 'Implements numerical methods with stated precision, reproducible seeds and honest error bounds.',
    tags: ['scientific', 'numerical', 'statistics', 'reproducibility'],
    capabilities: ['numerical-methods', 'statistical-analysis', 'reproducibility'],
    tools: ['stats.describe', 'forecast.linear', 'or.solve_lp'],
    permissions: [],
    knowledge: [
      'Floating-point error, conditioning and numerical stability',
      'Descriptive versus inferential statistics',
      'Reproducibility: seeds, versions and exact inputs',
      'Reporting uncertainty alongside point estimates',
    ],
    workflow: [
      'State the numerical method and its assumptions.',
      'Validate on a small case with a known answer.',
      'Report precision, sample size and uncertainty.',
      'Make the run reproducible (seed, version, inputs).',
      'Distinguish correlation from causation in any interpretation.',
      'Attach the exact computation output as evidence.',
    ],
    inputs: ['Numerical problem and data', 'Precision requirement', 'Validation case'],
    outputs: ['Method and implementation', 'Validation result', 'Uncertainty statement'],
    verification: [
      'A known-answer validation was executed',
      'Uncertainty is reported with the estimate',
      'Seeds and versions are recorded',
    ],
    failure: 'If the method is not valid for the data, say so and stop. Never present an unstable result as precise.',
    handoff: 'Hand validated methods to the domain skill that will use them.',
    security: 'Do not execute unreviewed code from untrusted sources; numerical libraries must come from approved packages.',
    risk: 'low',
  },
  {
    id: 'wora.data-engineering-intelligence',
    name: 'Data Engineering & Intelligence',
    category: 'data',
    type: 'task',
    description: 'Profiles, cleans and summarizes data with explicit quality checks and reproducible transformations.',
    tags: ['data', 'quality', 'pipelines', 'analytics'],
    capabilities: ['data-profiling', 'data-quality', 'summarization'],
    tools: ['stats.describe', 'text.extract_summary', 'decision.weighted_matrix'],
    permissions: ['memory:read'],
    knowledge: [
      'Schema and type validation at ingestion',
      'Missingness, duplication and outlier handling',
      'Lineage and reproducibility of transformations',
      'Aggregation pitfalls and Simpson\'s paradox',
    ],
    workflow: [
      'Profile the data: count, types, missingness, duplicates, ranges.',
      'State the quality issues and the handling decision for each.',
      'Transform with reproducible steps and record lineage.',
      'Compute the requested metrics with their denominators.',
      'Cross-check totals and flag inconsistent aggregates.',
      'Report limitations and what the data cannot answer.',
    ],
    inputs: ['Dataset or extract', 'Metric definitions', 'Quality thresholds'],
    outputs: ['Data profile', 'Quality report', 'Metrics with lineage'],
    verification: [
      'Missingness and duplicates are quantified',
      'Every metric states its denominator and time window',
      'Transformations are reproducible',
    ],
    failure: 'If the data cannot support the question, say so instead of extrapolating. Never fill missing values silently.',
    handoff: 'Hand validated metrics to Decision Intelligence; hand schema issues to Database Engineering.',
    security: 'Minimize personal data, never export raw dumps, and respect workspace isolation.',
    risk: 'low',
  },
  {
    id: 'wora.decision-intelligence',
    name: 'Decision Intelligence',
    category: 'quantitative',
    type: 'task',
    description: 'Turns evidence into a ranked, robust recommendation with explicit criteria, weights and reversal conditions.',
    tags: ['decision', 'prioritization', 'robustness', 'trade-offs'],
    capabilities: ['weighted-decision', 'robustness-check', 'recommendation'],
    tools: ['decision.weighted_matrix', 'sim.monte_carlo', 'stats.describe'],
    permissions: [],
    knowledge: [
      'Weighted multi-criteria decision analysis and its limits',
      'Sensitivity analysis of weights and scores',
      'Opportunity cost and reversible versus irreversible decisions',
      'Communicating uncertainty to a decision owner',
    ],
    workflow: [
      'List the criteria and normalize their weights.',
      'Score alternatives with evidence; mark unsupported scores.',
      'Run the weighted matrix and the ±25% weight perturbation.',
      'Report whether the winner survives perturbation.',
      'State the conditions that would reverse the recommendation.',
      'Give one recommendation and the next irreversible step.',
    ],
    inputs: ['Alternatives', 'Criteria and weights', 'Evidence per score'],
    outputs: ['Ranking', 'Robustness result', 'Recommendation and reversal conditions'],
    verification: [
      'Every score has a stated basis',
      'Robustness under weight perturbation is reported',
      'Reversal conditions are explicit',
    ],
    failure: 'If the winner flips under reasonable perturbation, report the decision as contested rather than forcing a recommendation.',
    handoff: 'Hand the recommendation to the decision owner; hand unresolved evidence gaps to the relevant analyst skill.',
    security: 'Do not include confidential alternatives in shared summaries without authorization.',
    risk: 'low',
  },
];

function instructionsFor(skill: BuiltinSkill): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
  const steps = (items: string[]) => items.map((item, index) => `${index + 1}. ${item}`).join('\n');
  return `# ${skill.name}

## Responsibility
${skill.description}

## Scope
Applies to ${skill.category} work inside a WORA workspace. It does not replace the owning engineering skill for implementation, and it never grants permissions the agent does not already hold.

## Required knowledge
${list(skill.knowledge)}

## Operational workflow
${steps(skill.workflow)}

## Required tools
${skill.tools.length ? list(skill.tools) : '- No tool is required; the skill is reasoning-only.'}

## Input contract
${list(skill.inputs)}

## Output contract
${list(skill.outputs)}

## Verification criteria
${list(skill.verification)}

## Failure handling
${skill.failure}

## Handoff
${skill.handoff}

## Security restrictions
${skill.security}
`;
}

function skillManifest(skill: BuiltinSkill): SkillManifest {
  const result = validateManifest('skill', {
    schema_version: '1.0',
    id: skill.id,
    name: skill.name,
    version: BUILTIN_VERSION,
    type: skill.type,
    description: skill.description,
    author: 'WORA',
    maintainer: 'WORA Core',
    category: skill.category,
    tags: skill.tags,
    capabilities: skill.capabilities,
    permissions: skill.permissions,
    scope: ['instance', 'organization', 'project', 'agent', 'user'],
    dependencies: [],
    auto_load: false,
    instructions: instructionsFor(skill),
    requirements: { tools: skill.tools, permissions: skill.permissions, secrets: [] },
    inputs: skill.inputs.map((name) => ({ name: name.slice(0, 80), description: name.slice(0, 300) })),
    outputs: skill.outputs.map((name) => ({ name: name.slice(0, 80), description: name.slice(0, 300) })),
    verification: skill.verification,
    failure_handling: skill.failure,
    handoff: skill.handoff,
    security: { risk_level: skill.risk, network: false, data_access: ['workspace'] },
  }, 'official');
  if (!result.ok || !result.manifest) {
    throw new Error(`Built-in skill ${skill.id} failed validation: ${result.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  }
  return result.manifest as SkillManifest;
}

const ECHO_SERVER = `#!/usr/bin/env node
// WORA reference MCP server: stdio, newline-delimited JSON-RPC 2.0.
// Implements initialize, tools/list and tools/call for one deterministic tool.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!message || message.id === undefined) return;
  const reply = (result) => send({ jsonrpc: '2.0', id: message.id, result });
  const fail = (code, errorMessage) => send({ jsonrpc: '2.0', id: message.id, error: { code, message: errorMessage } });
  switch (message.method) {
    case 'initialize':
      reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wora-echo', version: '1.0.0' } });
      break;
    case 'tools/list':
      reply({
        tools: [{
          name: 'echo',
          description: 'Returns the provided text unchanged. Deterministic, no network, no filesystem.',
          inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 } }, required: ['text'], additionalProperties: false },
        }],
      });
      break;
    case 'tools/call': {
      const args = (message.params && message.params.arguments) || {};
      if (message.params && message.params.name !== 'echo') { fail(-32602, 'Unknown tool'); break; }
      if (typeof args.text !== 'string') { fail(-32602, 'text is required'); break; }
      reply({ content: [{ type: 'text', text: args.text }], isError: false });
      break;
    }
    default:
      fail(-32601, 'Method not found');
  }
});
`;

function echoServerPath(): string {
  const dir = process.env['WORA_EXT_BUNDLED_DIR']?.trim() || path.join(process.cwd(), 'data', 'bundled');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'echo-mcp.mjs');
  writeFileSync(file, ECHO_SERVER, { mode: 0o600 });
  return file;
}

function pluginManifest(): PackageManifest {
  const result = validateManifest('plugin', {
    schema_version: '1.0',
    id: 'wora.echo-mcp',
    name: 'WORA Echo MCP (reference)',
    version: BUILTIN_VERSION,
    type: 'mcp',
    description: 'Reference MCP plugin used to verify the full install → approve → enable → discover → execute path without any external service.',
    author: 'WORA',
    maintainer: 'WORA Core',
    category: 'developer-tools',
    tags: ['mcp', 'reference', 'testing'],
    capabilities: ['echo'],
    permissions: [],
    scope: ['instance', 'organization', 'project', 'agent', 'user'],
    dependencies: [],
    auto_load: false,
    entrypoint: { transport: 'stdio', command: 'node', args: [echoServerPath()], env: [] },
    required_secrets: [],
    configuration: {},
    tools: [{
      id: 'echo',
      name: 'Echo',
      description: 'Returns the provided text unchanged. Deterministic and side-effect free.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      permissions: [],
      timeout_ms: 5_000,
      risk: 'low',
    }],
    health: { type: 'mcp', timeout_ms: 5_000 },
    security: { risk_level: 'low', network: false, data_access: ['none'] },
  }, 'official');
  if (!result.ok || !result.manifest) {
    throw new Error(`Built-in plugin failed validation: ${result.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`);
  }
  return result.manifest;
}

/** Seed the official catalog once per workspace (idempotent). */
export function seedBuiltinCatalog(workspaceId: string, actor = 'system'): { marketplaceId: string; skills: number; plugins: number } {
  ensureExtensionSchema();
  let marketplace = listMarketplaces(workspaceId).find((row) => row.url === BUILTIN_MARKETPLACE_URL);
  if (!marketplace) {
    marketplace = createMarketplace({
      workspaceId,
      name: 'WORA Official',
      url: BUILTIN_MARKETPLACE_URL,
      provider: 'builtin',
      ref: 'bundled',
      refType: 'tag',
      trust: 'official',
      autoLoad: false,
      actor,
    });
  }
  const seen = new Set<string>();
  let skills = 0;
  let plugins = 0;
  for (const skill of SKILLS) {
    const manifest = skillManifest(skill);
    const upserted = upsertPackage({
      workspaceId,
      marketplaceId: marketplace.id,
      kind: 'skill',
      manifest,
      instructions: (manifest as SkillManifest).instructions,
      sourcePath: `bundled/skills/${skill.id}/skill.json`,
      sourceSha: `bundled-${BUILTIN_VERSION}`,
      trust: 'official',
    });
    if (!upserted.conflict) { seen.add(`skill:${manifest.id}`); skills += 1; }
  }
  const plugin = pluginManifest();
  const upserted = upsertPackage({
    workspaceId,
    marketplaceId: marketplace.id,
    kind: 'plugin',
    manifest: plugin,
    instructions: '',
    sourcePath: 'bundled/plugins/wora.echo-mcp/plugin.json',
    sourceSha: `bundled-${BUILTIN_VERSION}`,
    trust: 'official',
  });
  if (!upserted.conflict) { seen.add(`plugin:${plugin.id}`); plugins += 1; }
  markMissingPackages(workspaceId, marketplace.id, seen);
  // Keep the catalog usable even if an earlier sync left it in error.
  const db = getOsDb();
  db.prepare("UPDATE ext_marketplaces SET status = 'ready', trust = 'official', last_sync_at = COALESCE(last_sync_at, ?), package_count = ? WHERE id = ?")
    .run(nowIso(), skills + plugins, marketplace.id);
  if (!getMarketplace(workspaceId, marketplace.id)) throw new Error('Built-in marketplace disappeared');
  return { marketplaceId: marketplace.id, skills, plugins };
}

export function builtinSkillCount(): number {
  return SKILLS.length;
}

export function builtinMarketplaceId(workspaceId: string): string | null {
  ensureExtensionSchema();
  return listMarketplaces(workspaceId).find((row) => row.url === BUILTIN_MARKETPLACE_URL)?.id ?? null;
}

/** Used by the API to show a stable identifier without creating a row. */
export function builtinPackageIds(): string[] {
  return [...SKILLS.map((skill) => skill.id), 'wora.echo-mcp'];
}

export function recordBuiltinSeed(workspaceId: string, actor: string): void {
  extensionAudit(workspaceId, actor, 'extension.catalog.seed', BUILTIN_MARKETPLACE_URL, { skills: SKILLS.length, plugins: 1, id: newId('seed') });
}
