# WORA OS Core — what was built and how it behaves

This document is the engineering record for the OS core added to this branch. It lists what
is **real and verified**, what is **real but awaiting external configuration**, and what is
**not implemented yet**. Nothing here is aspirational.

## What this is

An in-process execution platform behind the product surface:

- **Execution engine** (`api-server/src/os/orchestrator.ts`): objective → understand → decompose →
  assign → execute → review → deliver. Every mission/task/run/handoff is persisted in SQLite.
- **Persistent agent registry** (`os/registry.ts`): 18 seeded specializations plus user-created and
  organization-created agents. Agents carry identity, role, skills, tools, permissions, model config,
  limits, instructions, status and evaluation criteria. They are executable entities, not profile cards.
- **Unified tool registry** (`os/tools.ts`, `os/scaffold.ts`, `os/ortools.ts`): 16 tools, each with a
  JSON-schema contract, risk tier, required permission, environment and timeout; audited on every call.
- **Operations Research** (`os/ortools.ts`): HiGHS (WASM LP/MIP solver) behind `or.solve_lp` and
  `or.employee_schedule`; Hungarian algorithm behind `or.assignment`; seeded triangular PERT Monte
  Carlo behind `sim.monte_carlo`. Solver output is **independently revalidated in code** (demand,
  availability, max-workload) before it is accepted.
- **Memory & knowledge** (`os/memory.ts`): scoped records (user/workspace/project/agent/organization/
  execution/episodic/semantic) with provenance, deterministic TF-IDF-ish retrieval, audited write/delete.
- **Virtual organizations** (`os/orgs.ts`): objective → template (commerce-marketplace / software-product /
  general-business) → departments, leadership spine, persistent agents, reporting lines, one project and a
  kickoff mission that starts real work.
- **Artifact generation** (`os/scaffold.ts`): `scaffold.webapp` writes a complete zero-dependency web app
  (kanban UI + Node http JSON API + `node --test` suite) into the sandboxed workspace and **runs the suite**;
  `host.exec` re-runs exactly `node --test` as an allowlisted verification step. The QA gate requires a green
  suite — the app is generated *and* proven, not proposed.
- **System console** (`client/src/components/SystemConsole.tsx`): real `/api/os/state` counts, memory manager,
  audit trail, and an explicit capability matrix (what is live vs. awaiting config vs. not built).

## Screens (new)

| World | Route | Purpose |
| ----- | ----- | ------- |
| مركز التنفيذ / Execution | `#execution` | Launch objectives in natural language; live lifecycle, evidence, handoff contracts, artifact download |
| الوكلاء / Agents & Orgs | `#agents` | Registry: create/pause/delete persistent agents; build a virtual organization from one objective |
| الذكاء التشغيلي / Intelligence | `#intelligence` | Employee-shift MIP (20×5 sample, editable), Monte Carlo, weighted decision matrix with ±25% robustness check, tool registry |
| النظام / System | `#system` | Runtime counts, capability honesty matrix, memory browser, audit log |

The **Executive Command bar** at the bottom of every screen now launches a real mission
(`POST /api/os/missions`) and opens مركز التنفيذ — it no longer just routes to the Director composer.

## Architecture decisions (and why)

1. **SQLite via `node:sqlite`** for OS state. The repo already ships a Mongo/Redis production path for
   chat/catalog; the OS core needs relational, transactional durability with zero external services so the
   product *works* offline and in preview. Access is isolated in `os/db.ts`; a PostgreSQL adapter can replace
   it without touching callers. Set `WORA_OS_DB` (default `./data/wora-os.db`; `:memory:` in tests).
2. **HiGHS (WASM)** instead of Google OR-Tools: no Python/runtime sidecar, runs identically in Docker,
   CI and preview; real LP/MIP (presolve, branch-and-bound), not heuristics. Hungarian algorithm for the
   balanced assignment case; PERT Monte Carlo with `mulberry32` seeding for reproducibility.
3. **In-process orchestration, durable via SQLite** instead of Temporal: a single modular monolith with
   persisted mission/task/run state survives restarts (state is re-read from disk; no in-flight promise is
   required). Temporal/NATS would add operational weight with no user-visible benefit at this scale.
4. **No new microservices.** Everything ships in `api-server` and the existing client.
5. **Permissioned tools, not ambient authority.** Agents only receive tools in their specialization set;
   `runTool` enforces the per-tool permission, zod-validates input, applies a timeout, and writes an audit
   entry. High-risk tools (`host.exec`) are not callable through the REST tool endpoint — only inside the
   orchestrator under agent permissions, and only `node --test` inside the sandboxed workspace.
6. **Honest scope everywhere.** Diagnostics checks the machine running the API runtime and says so; sample
   rosters are labeled SAMPLE both in API output and UI; generated-app QA relies on `node --test` exit codes,
   never on agent self-report. If a review fails twice, the task fails and dependents block — loudly.

## The five mandate journeys — verified end-to-end on this branch

| Journey | Result |
| ------- | ------ |
| 1. "Inspect my computer and identify potential problems" | Mission completes; real `os.cpus`/memory/load/uptime/disk-path signals attached as evidence; scope of inspection stated |
| 2. "Create a software testing agent" | `Software Testing Agent` (qa_engineer specialization) persisted in the registry, reusable immediately |
| 3. "Build an organization … online marketplace" | 8 departments, 9 agents created, reporting lines to a Managing Director, project persisted, kickoff mission executed to completion |
| 4. "Build a working web application" | 4 tasks: scope → scaffold (6 files, `node --test` green) → security scan (0 criticals) → independent QA re-run (green). App runs: `node server.mjs` → `GET /` HTML, `POST /api/tasks` works |
| 5. Employee/shift optimization | HiGHS MIP, total cost 480, demand met per shift, availability respected, independent re-validation printed — via UI (Intelligence) and via mission |

## Security & control

- Workspace scoping mirrors the existing API: production requires a signed session → `wora-{userId}`;
  preview lands in `wora-preview`; admin key bypass available server-side.
- Rate limits: 60/min per workspace on `/api/os` mutations (30/min missions, 10/min org builds).
- All tool executions audited (`os_audit`); memory writes/deletes audited; agent create/update/delete audited.
- No secrets in the client; OS core never sees provider keys. `/api/os/tools/:id/execute` refuses high-risk tools.
- Sandboxed writes: generated apps and reports live under `WORA_WORKSPACE/<workspaceId>`; path traversal rejected.

## Test results (this branch)

- `api-server`: 17 OS tests (solvers, tools, memory isolation, registry, orchestrator journeys 1–5 + failure
  path) pass; full suite 41 pass / 1 skipped (Mongo integration, opt-in) — `npm test`.
- `client`: 27/27 pass — `npm test`; typecheck + production build green.
- Production bundle builds: client `npm run build` (lazy chunks per world), api-server `npm run build`.

## What is NOT implemented (explicitly)

- **Local Device Agent** (inspect *your* computer): architecture and permission model are defined
  (`host:read` tier, revocable), but no authorized device channel exists — the product says so instead of
  fabricating device telemetry.
- **Playwright browser automation**: tool contract and permission slot exist; no browser runtime is bundled.
- **pgvector / semantic retrieval**: memory uses deterministic TF-IDF scoring; vector retrieval is a drop-in
  replacement inside `os/memory.ts` when a Postgres deployment is provisioned.
- **Temporal, BullMQ-backed mission execution**: missions execute in-process; queue-based execution is the
  documented scale-out path, not a current claim.
- **Live LLM planning**: plan generation is deterministic (capability matchers). When `STUDIO_PROVIDER` +
  key are set, the existing Studio path can enrich, but the orchestrator does not require any provider.
- **Multi-tenant production authZ roles**: signed-session workspace isolation exists; per-workspace custom
  role catalogs (RBAC beyond owner/admin) are not implemented.
- **Durable cross-device project Kanban sync**: projects remain browser-persisted (documented behavior);
  OS `os_projects` records projects for the organization builder only.
