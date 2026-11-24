# WORA — Full Repository Audit and Modern Architecture Assessment

**Date:** 2026-11-24  
**Branch:** `feat/extensions-subsystem`  
**HEAD:** `e7f9939` — Add verified skills, plugins, marketplaces and MCP extensions subsystem  
**Origin main:** `a1ca08c`  
**Auditor:** OpenHands, acting as senior architect / autonomous repository agent  
**Method:** direct source inspection, build and test execution, live API smoke on an isolated temporary database, and read-through of existing audit documents. No feature was assumed to exist because a page, README or prior report mentioned it.

---

## 1. Executive verdict

WORA is no longer an empty prototype. It contains two real, working systems:

1. A legacy realtime office and chat system: React + Three.js + Socket.IO + Redis + BullMQ + MongoDB, with real LLM text replies for the four seeded office agents when provider keys are configured.
2. A newer WORA OS execution core: React pages plus an Express API on SQLite, with a persistent agent registry, deterministic mission orchestrator, real optimization solvers, approvals, memory, audit, device pairing, and a genuinely functional Skills/Plugins/Marketplaces/MCP subsystem.

The extensions subsystem is the strongest part of the repository. Its install-to-revocation path was verified live in this audit: discover the bundled plugin, approve permissions, install it to an agent, resolve the capability profile, discover the MCP tool, execute it, record audit data, disable the installation, observe a 403, uninstall, and observe the tool removed. Git marketplace registration, synchronization, change detection, dependency resolution, version conflicts and rollback are covered by the extension integration tests against a real temporary Git repository; they were not re-run through a browser in this audit.

The central problem is not missing features. It is **architectural split-brain**:

- Two agent registries that do not share data.
- Two skill systems with different schemas and different lifetimes.
- Two task/project models, one of which is write-only.
- Two persistence stacks (MongoDB/Redis and SQLite) with different transactions and different scale limits.
- Two execution modes: real-LLM text chat versus deterministic tool orchestration.
- Two deployment shapes (same-origin Compose versus split Vercel/Railway), with a frontend base-URL bug that breaks the OS pages on the split shape.
- Multiple authorization mechanisms layered without one tenancy model.

The product is therefore best described today as **a capable agent-operations workbench with a real execution kernel**, not yet as an **AI operating and execution platform**. The modernization work is primarily consolidation, durability, identity/tenancy, and sandboxing, not a rewrite of the domain logic.

### Highest-priority findings

| Priority | Finding | Why it matters |
| --- | --- | --- |
| P0 | No real identity/login; tokens are self-issued HMAC sessions from a shared `AUTH_SECRET` | Any holder of the secret can mint a session for any user id; no MFA, directory, revocation, or organization membership |
| P0 | `web.fetch_read` is a server-side request forgery primitive (redirects followed, no private-address block) | A member can reach cloud metadata and internal services through a normal tool call |
| P0 | Plugin, MCP, and generated-test code execute on the API host, not in a sandbox | A malicious marketplace package or generated app can read host files and use host network |
| P0 | SQLite is placed behind a two-replica production shape; each replica also marks running missions as interrupted on boot | Data corruption, lock contention, and cross-replica mission failure |
| P1 | Tool allowlists are not enforced at execution; the REST tool endpoint uses `permissions: *` | Tool access is permission-only, contradicting the documented specialization allowlist |
| P1 | Organizations/projects cannot be shared between users; workspace id is always `wora-{userId}` | The organization product cannot become a team product without a tenancy model |
| P1 | Skills are loaded into a capability profile but never injected into planning or model context; auto-load is a flag only | Installed knowledge skills do not change agent behavior today |
| P1 | Organization/project/user scopes are only partially wired; user scope compares a package scope id to an agent name | Scope UI promises behavior the runtime does not deliver |
| P1 | Split deployment is broken for OS pages: client uses `VITE_OS_API`, but Docker/Vercel/README only configure `VITE_API_URL` | A documented deployment path produces non-functional OS and Extensions pages |
| P2 | No CI, no migration versioning, no OpenTelemetry, no browser E2E suite | Regressions and schema drift are not caught automatically |

### Phase 1 remediation addendum (2026-11-23)

The findings above are the baseline at `e7f9939`. Phase 1 implemented containment for the P0/P1 items that could be fixed without a tenancy or sandbox rewrite. It did not claim the remaining architecture work as complete.

| Baseline finding | Phase 1 status | Implementation and evidence |
| --- | --- | --- |
| P0 `web.fetch_read` SSRF | Fixed | `api-server/src/lib/safe-fetch.ts` validates scheme, credentials, port and hostname; rejects loopback, private, CGNAT, link-local, reserved, multicast, documentation, IPv4-mapped and metadata ranges; validates every DNS answer through a pinned lookup callback; follows redirects manually with revalidation and HTTPS-downgrade rejection; caps redirects, bytes and time. `web.fetch_read` now uses it. Tests: `src/lib/safe-fetch.test.ts` (blocked/allowed IPv4 and IPv6, alternate loopback encodings, redirects, DNS lookup, no network request on blocked targets). |
| P0 SQLite behind two replicas | Contained | `docker-compose.prod.yml` now runs one API replica and documents the SQLite single-writer constraint. `api-server/src/os/db.ts` adds `os_runtime_leases` and a 30-second heartbeat lease; a second process sharing the file fails fast instead of competing for writes or marking another process's missions interrupted. Tests: `src/os/sqlite-lease.test.ts` (active lease, renewal, expiry takeover, `getOsDb` integration, compose shape). Boot-time `markInterruptedMissions` remains intentional for a single writer after a crash; graceful drain is still not implemented. |
| P1 tool allowlists not enforced | Fixed | `runTool` accepts an optional `toolAllowlist`; `executeForAgent` and the orchestrator pass the resolved profile tools; `authorizeTool` now denies core tools outside the profile. `POST /api/os/tools/:id/execute` requires an `agentId`, rejects unknown/inactive agents and executes through the agent profile instead of wildcard permissions. Tests: `src/os/os.test.ts` (wildcard permission cannot bypass allowlist), `src/extensions/extensions.test.ts` (missing agent, wrong agent, allowed agent, high-risk gate). |
| P1 symlink workspace escape | Fixed | `resolveInWorkspace` resolves the deepest existing component with `lstat`, canonicalizes it with `realpath`, re-checks containment, and rejects broken symlinks. Tests: `src/os/os.test.ts` (traversal, directory/file symlink, broken symlink, new file). |
| P1 split deployment base URL | Fixed | `client/src/lib/apiBase.ts` makes `VITE_API_URL` the shared fallback and keeps `VITE_OS_API` as an optional OS-only override. Docker, Compose, `.env.example`, `vite-env.d.ts` and README now pass/document both. `npm run build` runs `client/scripts/check-api-contract.mjs`, which fails on drift; `client/tests/deploymentConfig.test.mjs` exercises the check and `client/tests/apiBase.test.mjs` covers origin validation and fallback. |
| Local marketplace symlink escape | Fixed | `api-server/src/extensions/git.ts` canonicalizes allow-listed local roots, subpaths and manifest discovery roots, and rejects symlinks that resolve outside the root. Tests: `src/extensions/extensions.test.ts` (root symlink and subpath symlink). |
| P0 plugin/MCP/generated-test host execution | Not fixed in Phase 1 | Still executes on the API host. This requires a sandbox/runtime boundary and is the next containment item, not something the Skills UI can solve. |
| P0 real identity/login, P1 tenancy and skill context injection | Not fixed in Phase 1 | Out of scope for this containment pass; the audit sections below remain the plan. |

---

## 2. Repository state and evidence

### 2.1 Git state

- Repository: `momenmaaly/wora-agent-os`, public, default branch `main`.
- Local `feat/extensions-subsystem` and local `main` both point at `e7f9939`.
- `origin/main` is `a1ca08c`; the extensions commit is exactly one commit ahead.
- Working tree was clean before and after this audit; no source changes were made.
- The extensions commit is a clean fast-forward candidate over `origin/main`; no merge conflict was found by inspection.
- The commit adds 33 files and 7,998 lines, removes 15 lines. It does not include the temporary preview harness that a prior session mentioned; that harness is not tracked.

### 2.2 Monorepo

```text
wora-agent-os/
├── api-server/        Express 5 + TypeScript, esbuild bundle, Node >= 22
├── client/            React 18 + Vite 6, Arabic-first RTL, English toggle
├── device-agent/      Zero-dependency local device reference agent
├── shared/            Shared legacy TypeScript contracts
├── docs/              Architecture, extensions and audit records
├── nginx/             TLS reverse proxy
├── docker-compose.prod.yml
└── README.md
```

### 2.3 Inventory

| Item | Count | Note |
| --- | ---: | --- |
| API TypeScript files | 65 | Includes tests and scripts |
| Client `.tsx` files | 40 | Includes legacy and OS pages |
| Client components | 35 | Several legacy components remain globally mounted |
| Primary + settings + legacy pages | 16 | 9 primary, 4 settings, 3 legacy |
| REST routes | 101 | 9 legacy, 53 OS, 39 extension |
| Socket.IO events | 8 | Legacy realtime office only |
| SQLite tables | 33 | 20 OS + 12 extension + 1 runtime lease (Phase 1) |
| Core tools | 17 | Plus one reference MCP plugin tool |
| OS specializations | 18 | Seeded roster |
| Built-in skills | 19 | Seeded official catalog |
| Reference plugins | 1 | Echo MCP |

### 2.4 Verified commands and results

| Check | Result |
| --- | --- |
| API `npm test` | **80 tests: 79 pass, 0 fail, 1 skipped** (MongoDB integration, opt-in), 3.29 s |
| Client `npm test` | **41/41 pass**, 1.72 s |
| API `npm run typecheck` | Pass |
| Client `npm run typecheck` | Pass |
| API `npm run build` | Pass |
| Client `npm run build` | Pass, 3.34 s |
| API `npm audit --omit=dev` | 0 vulnerabilities |
| Client `npm audit --omit=dev` | 0 vulnerabilities |
| Client bundle | `three` 576.62 kB (154.17 gzip), `index` 173.42 kB (54.87 gzip), `vendor` 153.80 kB (50.33 gzip), `Office3D` 64.31 kB, `ExtensionsHub` 34.77 kB |
| Live smoke | Isolated preview server on port 4100 with a temporary SQLite database; 18 OS agents, 19 skills, 1 plugin; install, MCP health, tool execution, mission, disable, uninstall all behaved correctly |
| CI | None; no `.github`, GitLab CI, Azure Pipelines or Jenkins configuration is tracked |

The live smoke is the strongest evidence of the extensions path. It did not use a browser; it used real HTTP calls against the real router, real SQLite schema, real manifest validation, a real child MCP process, and real audit rows. Git marketplace discovery and synchronization were exercised by the integration tests, not by this live smoke. Legacy chat remains simulated in the preview server by design.

---

## 3. What the product actually is today

### 3.1 Working capabilities, verified

- Persistent agent registry with 18 seeded specializations and custom agents.
- Mission creation, deterministic planning, task execution, review gates, handoff contracts, approvals, resume and evidence persistence.
- Real optimization: HiGHS LP/MIP, Hungarian assignment, 20-employee x 5-shift scheduling with independent validation, PERT Monte Carlo, decision matrix, descriptive statistics, linear forecast with holdout.
- Digital twins as explicitly labelled simulations with driver scenarios and event logs.
- Scoped memory with versions, visibility, TTL and audit.
- Organization builder that creates departments, agents and a kickoff mission from one objective.
- Project board with server-durable JSON state and last-write-wins sync.
- RBAC v1 with owner/admin/member/viewer, plus audit and usage views.
- Device pairing with hashed one-time codes and terminal revocation; no remote command channel.
- Extensions: Git marketplace registration and sync, manifest validation, dependency plans, install/update/rollback/uninstall, agent capability resolution, secrets at rest, plugin tool registry, MCP STDIO/HTTP, execution audit, and a real management UI.
- Legacy realtime office: real WebGL scene, room navigation, chat, model swap, and LLM text replies when provider keys are configured.
- Arabic-first shell and several new pages, with an English dictionary and RTL/LTR switching.

### 3.2 What is presented but not actually true

These are not minor documentation nits; each one affects product claims or security expectations.

1. **Skills do not influence execution.** The capability resolver returns skill instructions and digests, and the orchestrator records a snapshot, but no prompt or planner consumes those instructions. Knowledge/task/workflow skills are metadata-only today. The one reference plugin tool works; skills do not.
2. **Auto-load is a flag, not runtime behavior.** Marketplace and installation `auto_load` values are stored and exposed. The orchestrator never reads `profile.autoLoad`.
3. **Organization, project and user scopes are only partially wired.** Organization and project scopes require `organizationId` and `projectIds` on the agent policy; the UI has no way to set them. User scope compares the installation scope id to the actor passed by the orchestrator, which is the agent name, so it does not select a user installation.
4. **Tool allowlists are not enforced.** `os/tools.ts` checks permissions and high-risk gating, not membership in the agent specialization tool list. The REST tool endpoint executes with `permissions: new Set(['*'])`. The docs claim agents only receive their specialization tools.
5. **Generated code is not sandboxed.** Generated apps and tests live under a workspace directory, but `node --test` runs as a normal host process. The workspace is a path boundary, not a security boundary.
6. **MCP/plugin code is not sandboxed.** STDIO MCP commands (`node`, `npx`, `python3`, `uvx`, `deno`) run as child processes of the API host with a filtered environment, not in a container or microVM.
7. **Billing is not implemented.** Pricing is a local demo/preview gate. No payment gateway, entitlement enforcement or invoice exists.
8. **English mode is incomplete.** Home, Organizations, Workspaces, Extensions and the shell are key-driven. Execution, Agents, Intelligence, System, Projects, Campus, Director, Models, Integrations and Pricing still contain hardcoded Arabic.
9. **The legacy hire dialog is local-only.** `HireAgentModal` calls `useWoraStore.hireAgent`, which creates a client-side agent object. It does not persist to the server and disappears on reload.
10. **Split deployment is not configured for OS pages.** OS and extension clients use `VITE_OS_API`; the Dockerfile, Compose file, README and Vercel rewrite only handle `VITE_API_URL`. On a Vercel frontend + Railway API deployment, OS calls go to the Vercel origin and fail.

---

## 4. Page-by-page audit

| Route | Purpose today | Verdict | Concrete gaps |
| --- | --- | --- | --- |
| `#home` Command Center | Hero mission input, three paths, live missions, agents | **Real and well designed** | The planner is deterministic; the page does not say so. Mission results are not summarized on the card. |
| `#execution` | Mission lifecycle, evidence, approvals, handoffs | **Real backend, incomplete experience** | No durable worker; synchronous execute can time out; no step graph, token/cost timeline, retry policy, or live streaming; hardcoded Arabic. |
| `#agents` | OS agent registry, create/pause/archive, versions, capability dialog | **Real CRUD** | No real model binding at execution; no performance history from actual runs; duplicate legacy hire path elsewhere; hardcoded Arabic. |
| `#projects` | Kanban board, products, ideas, tasks | **Partially real** | Board JSON is durable but last-write-wins. `os_projects` rows are written by the org builder and never read by an API. No project detail, membership, link to missions, or org linkage. |
| `#organizations` | Org builder and cards | **Real creation, not a living organization** | No department detail, reporting line editor, team membership, meetings, cadence, KPIs from real events, budgets, or multi-user access. |
| `#intelligence` | Solvers, twins, playbooks, tool registry | **Real solvers** | No generic model builder, sensitivity analysis, CP-SAT, discrete-event simulation, queueing, or causal analysis. Mixed language; simulated labels must stay visible. |
| `#extensions` | Skills/plugins/marketplaces/tools | **Real end-to-end management** | Skills inert at runtime; auto-load unused; scope gaps; no signed provenance; no sandbox; no browser E2E. |
| `#workspaces` | Honest single-workspace explanation | **Honest** | No team workspace, invitations, membership, or shared project. The page states this. |
| `#system` | State, governance, memory, audit, roles, usage | **Real admin surface** | Two audit tables are not unified; no queue/worker health; no OTel; hardcoded Arabic. |
| `#settings` | Workspace session, language, theme | **Real but thin** | Session is a pasted token. No SSO, member management, retention, or secret policy. |
| `#models` / `#integrations` / `#pricing` | Model catalog, demo integrations, plans | **Presentation/config** | Model selection is not enforced by OS runs; integrations are demo; pricing is not a payment system. |
| `#campus` / `#director` | Legacy 3D office and director chat | **Real but separate** | Mongo agents, text-only LLM, no tools, no mission link, no skill execution. Hidden from primary nav but still mounted globally. |
| `#studio` | Product pack generation | **Optional provider path** | Without provider keys it is local/demo; it is not an execution platform feature. |

### 4.1 Localization evidence

Hardcoded Arabic characters versus `t()` calls in representative pages:

| Component | Arabic characters | `t()` calls |
| --- | ---: | ---: |
| `ExtensionsHub` | 0 | 193 |
| `CommandCenter` | 15 | 33 |
| `OrganizationsPage` | 32 | 16 |
| `ExecutionCenter` | 628 | 0 |
| `AgentRegistry` | 505 | 2 |
| `ProjectOSBoard` | 1,363 | 0 |
| `IntelligenceHub` | 2,385 | 0 |
| `SystemConsole` | 3,164 | 0 |
| `Campus` | 631 | 0 |
| `DirectorOffice` | 953 | 0 |
| `ModelHub` | 436 | 0 |
| `IntegrationsHub` | 434 | 0 |
| `PricingPlans` | 645 | 0 |

The i18n parity test passes because both dictionaries have the same keys; it does not prove that pages use the dictionary.

---

## 5. Backend and API audit

### 5.1 Shape

- Express 5, TypeScript, Zod validation on modern routes, esbuild bundle, ESM.
- `wora-server.ts` boots a single process that owns Redis, Mongo, BullMQ, Socket.IO, legacy REST, Studio, Director recommendation, GitHub skills, OS router and extension router.
- Production config requires `AUTH_SECRET`, `MONGO_URI`, `REDIS_URL` and `ALLOWED_ORIGINS`, even if the operator only wants the SQLite OS core. The OS cannot boot independently in production.
- `/health` and `/ready` depend on Redis and Mongo; `/ready` also requires seeded Mongo agents and an active session. A Mongo incident takes down the OS health signal even when SQLite is healthy.
- OS and extension routes are mounted before the global JSON parser; their own parsers apply. Legacy routes use the 16 kB global parser.
- Rate limiting is in-process and per-workspace for OS/extension mutations; Redis-backed for legacy chat/Studio. Replicas do not share OS buckets.

### 5.2 API surface

| Group | Routes | Notes |
| --- | ---: | --- |
| Legacy HTTP | 9 | Session, agents, zones, brains, room workspace; mostly read-only views of Mongo |
| Socket.IO | 8 events | Room join/leave, movement, message send, brain swap, workspace updates |
| OS | 53 | State, missions, tasks, approvals, agents, memory, twins, board, roles, tools, devices, audit, usage |
| Extensions | 39 | Marketplaces, syncs, packages, plans, installs, updates, rollback, tools, MCP, policies, secrets, audit, snapshots |

### 5.3 Gaps

- No API versioning. No OpenAPI contract. The client hand-writes types in `client/src/os/api.ts`, `client/src/extensions/api.ts` and `shared/types`.
- Error responses are not uniform across legacy, OS and extension routers.
- No request id, no idempotency key, no `ETag`/optimistic concurrency for most mutations.
- No pagination on several list endpoints; audit and tool lists are capped but not cursor-based.
- No background execution endpoint semantics: `POST /missions/:id/execute` runs in the request and has no lease or duplicate-execution lock.
- No outbox/event stream; state changes are not published as durable events.
- `markInterruptedMissions()` runs at router construction, which means every new replica marks all currently running missions across all workspaces as failed.
- No queue health endpoint, no worker status, no per-tool execution metrics beyond audit rows.

---

## 6. Data and persistence audit

### 6.1 Current persistence

| Store | Used for | Durability | Scale limit |
| --- | --- | --- | --- |
| SQLite via `node:sqlite` | OS agents, missions, tasks, runs, handoffs, memory, orgs, projects, artifacts, audit, approvals, devices, settings, playbooks, roles, versions, boards, twins, usage, extensions | WAL, single file | Single writer; not safe for multiple containers on a shared volume |
| MongoDB | Legacy agents, skills, room workspace entries | External | Requires Mongo even for OS-only use |
| Redis | Chat history, presence, runtime state, rate limits, queues | External, eviction-sensitive | Legacy path; not the OS source of truth |
| Filesystem | Generated apps, artifacts, workspace files | Volume | No object storage, no signed URLs, no retention policy |
| Browser localStorage | Language, board cache, preview token, billing flag | Per browser | Not authoritative; can diverge |

### 6.2 Schema problems

- 32 SQLite tables, but no migration table and no versioned migration runner. `os/db.ts` uses `CREATE TABLE IF NOT EXISTS` plus a few ad-hoc `ALTER TABLE` checks; extension schema is a single idempotent string.
- OS tables have almost no foreign keys despite `PRAGMA foreign_keys = ON`. Referential integrity is application-enforced.
- Extension tables are workspace-scoped and have unique constraints, but there is no organization/project/member table to anchor real tenancy.
- `os_projects` is written by `orgs.ts` and counted by `getOsState`, but there is no read endpoint or UI. It is effectively write-only.
- Two task models: `os_tasks` for mission execution and board `tasks` inside `os_boards` JSON. They have different ids, statuses and lifecycles.
- Two project models: `os_projects` rows and board `projects` JSON.
- Two memory models: legacy room history in Redis/Mongo and `os_memory` in SQLite.
- Two audit models: `os_audit` and `ext_audit`, with different actions and no unified view.
- Secrets are AES-256-GCM encrypted with a key derived from `AUTH_SECRET` or a local 0600 key file. There is no key version, envelope encryption, KMS, or rotation path; changing `AUTH_SECRET` makes existing secrets unreadable.

### 6.3 Transaction and concurrency problems

- Mission creation is transactional; task/run updates are mostly individual writes. A crash can leave a mission in `running` with partial task state.
- `executeMission` has no per-mission lease or duplicate-request guard. Two concurrent execute calls can run the same tasks twice.
- Board sync is last-write-wins over the whole document; two devices overwrite each other.
- SQLite WAL on a shared Docker volume with two API replicas is not a supported multi-writer configuration. The Compose file nevertheless declares two replicas.
- In-memory seeding and rate-limit maps are per process; replicas disagree.

---

## 7. Agent, orchestration and capability audit

### 7.1 What exists

- `os_agents`: id, name, role, specialization, skills, tools, permissions, model, limits, status, version.
- Specializations: 18 entries with skills, tools, permissions, model tier and keyword matchers.
- Planner: deterministic regex/keyword routing for a finite set of intents (diagnostics, agent creation, organization build, web app build, optimization, generic).
- Missions: plan -> tasks -> runs -> review -> handoff -> artifacts -> approval.
- Handoffs: typed contracts stored in `os_handoffs`.
- Approvals: high-risk tool payload pauses the mission; approve resumes; deny fails loudly.
- Memory: scoped, versioned, TTL, audit, deterministic TF-IDF retrieval.
- Capability resolution: merges agent permissions, policy grants/denials, installation scopes, package requirements, tools and plugin tools; produces blocked reasons and an immutable snapshot.
- Plugin execution: only through an agent profile; direct plugin tool endpoint refuses.

### 7.2 What is missing or misleading

- **No LLM planner.** The orchestrator does not call a model to understand an arbitrary objective. It matches keywords and known playbooks. This is honest in `OS_CORE.md` but not visible in the hero UI.
- **No tool calling loop.** There is no model-driven ReAct/plan-act-observe loop. A mission executes a predetermined task graph.
- **No skill prompt injection.** Skill instructions are resolved and hashed but never inserted into a prompt. Task/workflow skills do not change execution.
- **No auto-load.** `autoLoad` is resolved into an array and then ignored.
- **No project/org context in resolution.** `executeMission` resolves capabilities with `{ missionId, taskId, actor: agent.name }`; it does not pass a project or organization. Even if policy rows existed, mission context could not select project-scoped capabilities reliably.
- **User scope is effectively broken.** The actor passed is the agent name, not the human user.
- **Tool allowlist not enforced.** `runTool` checks `ctx.permissions`; it does not check `agent.tools`. The REST tool endpoint uses `*`.
- **Model not bound.** Agent `model` is a label; OS execution has no model call. Studio and legacy chat have their own provider paths.
- **No independent verifier model.** Review is rule-based for some paths; generated-app QA uses `node --test` exit codes, which is real but not a semantic review.
- **No retry/backoff policy per tool.** A single timeout exists; failures fail the task.
- **No cost/budget enforcement per mission.** Usage is recorded separately; there is no hard budget stop.
- **No cancellation.** A running mission cannot be cancelled; process restart marks it failed.

---

## 8. Extensions subsystem audit

### 8.1 What was added

- 12 extension tables in the same SQLite database: marketplaces, syncs, packages, versions, installations, installation dependencies, agent policies, tools, MCP servers, secrets, audit, capability snapshots.
- Git adapter with HTTPS/file/local allow-list, depth-1 fetch, pinned ref, bounded manifest reads, symlink skipping, and credential via child environment rather than argv.
- Manifest schemas and validation for skill/plugin, permissions catalog, sensitivity flags, version and compatibility checks.
- Dependency planning with semver constraints, conflicts, cycles, missing tools/secrets, and an installation preview.
- Install/update/rollback/uninstall lifecycle with immutable published versions and checksum comparison.
- Capability resolver with scopes, explicit deny, permission checks, blocked reasons and snapshots.
- Runtime for HTTP plugins and STDIO/HTTP MCP, with timeouts, output caps, origin pinning for HTTP tools, and secret injection.
- REST surface with viewer/member/admin gates, workspace rate limits and audit.
- UI: Skills/Plugins tabs, filters, details, install/enable/disable/update/rollback/uninstall, marketplaces, sync, secrets, validation, create-from-manifest, tools/MCP views, agent capability dialog.

### 8.2 Verified live path

1. Preview server booted with a temporary database.
2. `GET /api/os/agents` returned 18 agents.
3. `GET /api/os/extensions` returned 19 skills, 1 plugin, 1 marketplace.
4. `POST /packages/:id/plan` produced a valid plan.
5. `POST /packages/:id/install` installed the reference echo MCP plugin to an agent.
6. `GET /agents/:id/capabilities` showed the plugin and `wora.echo-mcp.echo`.
7. `POST /installations/:id/health` returned `ok: true`, one discovered tool, 29 ms.
8. `POST /agents/:id/tools/wora.echo-mcp.echo/execute` returned `audit-live` from a real child MCP process.
9. A mission created a persistent testing agent and completed.
10. Disable returned 403 `TOOL_FORBIDDEN` on the next execution.
11. Uninstall returned 204 and the plugin tool disappeared from the registry.

This is a real, working vertical slice.

### 8.3 Extension gaps

- **Skills are inert.** See section 7.
- **Auto-load unused.** Marketplace and installation flags are metadata.
- **Scope wiring.** Organization/project require policy fields the UI cannot set; user scope is compared to the wrong actor.
- **Trust is self-declared.** Marketplace trust levels are stored, but no signature, publisher identity, or transparency log proves them. Checksums cover manifest plus instruction text, not plugin code fetched at runtime.
- **No package archive.** A marketplace package is a manifest plus instructions; plugin code is resolved from an entrypoint (npx, URL, MCP). There is no immutable package blob to verify.
- **Sandbox.** MCP and HTTP plugin calls run from the API host. The MCP command allowlist is a speed bump, not isolation.
- **Secrets.** Only the first required secret is used as a bearer token for HTTP plugins. Multiple secrets are supported for MCP env but not for HTTP auth schemes.
- **No secret rotation.** Re-encrypting all secrets after an `AUTH_SECRET` change is not implemented.
- **No marketplace auto-sync scheduler.** Sync is manual; `autoLoad` does not schedule it.
- **No code signing or revocation list.** A package can be marked revoked, but there is no global advisory feed.
- **No browser E2E.** The UI is wired to real APIs, but interactions are not exercised in a browser test.

---

## 9. Security and tenancy audit

### 9.1 P0 — must fix before any external users

1. **Identity and session issuance.** `issue-session.mjs` mints HMAC tokens from `AUTH_SECRET`; there is no login, user directory, MFA, password policy, OAuth/OIDC, refresh flow, or revocation list. Session subjects are arbitrary ids. This is an operator-issued capability token, not an identity system.
2. **SSRF through `web.fetch_read`.** The tool accepts any http(s) URL, follows redirects, has no DNS/private-IP block, and returns the body. A member can call it through `POST /api/os/tools/web.fetch_read/execute`, which uses wildcard permissions. Cloud metadata endpoints are reachable if the API runs in a cloud network.
3. **No execution sandbox.** MCP STDIO commands, HTTP plugins, and generated `node --test` suites execute on the API host. Environment filtering and command allowlists reduce accidental exposure but do not contain a malicious package.
4. **SQLite + replicas.** The Compose file declares two API replicas over one SQLite volume. This is not safe. Each boot also marks running missions failed, so a rolling deploy destroys in-flight work.

### 9.2 P1 — high

- Tool allowlist bypass at execution; wildcard permission set on the REST tool endpoint.
- No organization/team tenancy; workspace is always derived from the user id. Shared organizations, projects, and role assignments are impossible.
- Symlink escape: `resolveInWorkspace` uses `path.resolve` and a string prefix check, then `readFileSync` follows symlinks. A generated app can create a symlink inside the workspace and read outside it through `fs.workspace_read`.
- Marketplace trust and provenance are not cryptographically established.
- Secrets key rotation and multi-secret HTTP authentication are incomplete.
- No CSP or Permissions-Policy. nginx adds HSTS, Referrer-Policy, `nosniff` and `X-Frame-Options`; the API itself does not.
- Rate limits are per process for OS/extensions; horizontal scaling weakens them.
- `ADMIN_API_KEY` grants cross-workspace access through `x-workspace`; it is a single static key with no rotation or scoping.
- Git child process inherits the full API environment (`...process.env`) in addition to the credential header; least-privilege environment construction is needed.
- Plugin HTTP entrypoints can be plain `http` URLs; no TLS enforcement.

### 9.3 P2 — medium

- CORS allows requests with no `Origin` (non-browser clients); authentication still applies, but it widens the API surface.
- Audit logs are split and not tamper-evident.
- No dependency/container scanning in CI.
- No data retention or deletion policy for memories, artifacts, audit rows, or secrets.
- No per-tenant encryption keys.
- No request-level tracing or anomaly detection.
- Device pairing is single-use and hashed, but there is no remote command channel; this is correctly documented.

---

## 10. Architecture conflicts and duplicate systems

| Duplicate | Evidence | Consequence | Recommended resolution |
| --- | --- | --- | --- |
| Agent registries | Mongo `models/Agent.ts` vs SQLite `os/registry.ts` | Campus shows seeded Mongo agents; Agents page shows 18 SQLite agents; capabilities bind only to SQLite | One `agents` table in Postgres; migrate Mongo rows; legacy office reads the same registry |
| Skill systems | Mongo `AgentSkillSet` + GitHub importer vs extension skills | Two import flows, two schemas, two UIs; neither drives execution | One package model; legacy GitHub import becomes a marketplace source adapter |
| Project/task models | `os_projects` + `os_tasks` vs board JSON projects/tasks | Write-only project rows; board tasks not linked to missions | Relational projects/tasks; board becomes a view over them |
| Execution modes | Legacy LLM chat vs deterministic OS missions | Users see two different products; tools only work in one | Unified runtime with a model adapter; legacy chat becomes a collaboration surface |
| Persistence | Mongo/Redis vs SQLite | Two backup/restore stories, two scale limits, two failure modes | Postgres + Redis + object storage; SQLite only for local dev |
| Authorization | Session token, admin key, workspace roles, extension permissions, device credentials | Inconsistent enforcement and unclear tenancy | OIDC identity + org/project RBAC + ABAC policy + scoped service accounts |
| Deployment | Compose same-origin vs Vercel/Railway split | OS base URL bug; CORS and cookie assumptions differ | One documented contract: same-origin reverse proxy or explicit API origin for all clients |
| UI workflows | Legacy Hire/Model/Skills dialogs vs OS Agent pages | Fake local hire; duplicate skill import; confusing navigation | Retire or adapt legacy modals to the OS APIs |
| Audit | `os_audit` vs `ext_audit` | No single investigation trail | One append-only audit/event table with source and tenant |

---

## 11. Technical debt inventory

### 11.1 Code structure

- `wora-server.ts` is a 1,269-line composition root that owns too many concerns: Redis, Mongo, queues, sockets, auth, legacy REST, Studio, skills, OS and extensions.
- `os/orchestrator.ts` mixes planning, execution, review, artifacts, snapshots and state transitions.
- `ExtensionsHub.tsx` is 720 lines; `IntelligenceHub.tsx` 574; `SystemConsole.tsx` 437; `ExecutionCenter.tsx` 322. These are page-sized components with multiple responsibilities.
- `client/src/store/useWoraStore.ts` is a large legacy store with importers still used across many components.
- `client/src/three/architecture.ts` is unreachable from the entry graph.
- No shared contract package; `shared/types` serves legacy code, while OS/extensions define their own types.
- No root workspace or task runner; builds are run per package.

### 11.2 Testing

- Backend tests are strong for solvers, tools, memory, approvals, RBAC, config, session, Studio, Director, skills, extensions.
- The Mongo integration test is skipped unless `WORA_TEST_MONGO_URL` is set.
- No tests for the legacy Socket.IO message path, BrainAdapter provider adapters, queue failure/retry, workspace manager, or production boot with real Redis/Mongo.
- No tests for organization/project/user extension scopes, auto-load behavior, or skill prompt injection (because they are not implemented).
- Client tests are mostly pure logic/string assertions; only Campus has a DOM interaction test. No ExtensionsHub, AgentRegistry, ExecutionCenter, or SystemConsole interaction test.
- No browser E2E, no visual regression, no accessibility automation, no load test.
- No CI, so the strong tests are not enforced on pull requests.

### 11.3 Operations

- No migration framework.
- No backup/restore automation.
- No OpenTelemetry, metrics, traces, or dashboards.
- No queue/worker health.
- No structured audit export.
- No graceful shutdown draining of missions/tools.
- No feature flags for the legacy/modern split.
- No SLOs or error budgets.

---

## 12. Target architecture: WORA AI Operating and Execution Platform

### 12.1 Design principles

1. **One tenant model.** Organization -> team -> project -> user/service account. Every record carries an organization id; row-level security enforces isolation.
2. **One agent registry.** Agents, versions, profiles, capabilities and assignments are first-class relational entities.
3. **One package model.** Skills, plugins, MCP servers and tools are packages with immutable versions and provenance.
4. **One execution runtime.** A durable state machine with a worker, leases, retries, approvals, snapshots and event history.
5. **Tools are capabilities, not ambient authority.** Every tool call passes through a gateway that checks agent assignment, permission, tenant, secrets and approval.
6. **Untrusted code never runs in the API process.** Plugins, MCP servers and generated tests run in isolated workers.
7. **Provider-independent models.** A model registry and router choose providers by capability, cost, latency and policy; usage is metered.
8. **Evidence over assertion.** Every result links to a run step, tool output, artifact or verifier record.
9. **Arabic-first, fully bilingual.** Every page uses the dictionary; RTL/LTR is tested.
10. **No fake controls.** Planned features are labelled and disabled, not simulated.

### 12.2 Logical planes

```text
Experience plane
  React app, React Router, TanStack Query, i18n, org graph, execution console, marketplace

Control plane
  OIDC identity, organizations/teams/projects, RBAC/ABAC, capability catalog,
  policy, approvals, audit, quotas

Execution plane
  Mission API -> durable workflow -> planner -> tool gateway -> sandbox workers
  MCP gateway, plugin runner, artifact service, capability snapshots, model router

Data plane
  PostgreSQL + pgvector, Redis, object storage, event/outbox stream, analytics
```

### 12.3 Recommended stack decisions

| Concern | Recommendation | Rationale |
| --- | --- | --- |
| Language | Keep TypeScript end to end | Existing investment; shared contracts; no rewrite |
| API | Keep Express 5, modularize by domain; add OpenAPI from Zod | Express is not the bottleneck; a framework migration adds risk without product value |
| Database | PostgreSQL 16 + pgvector; Drizzle ORM and versioned migrations | Relational tenancy, real transactions, vector memory, managed backups |
| Local DB | Keep SQLite behind a repository adapter for tests/dev | Fast offline development without dual production semantics |
| Queue | BullMQ on Redis now; Temporal only when multi-day workflows and compensation are required | Existing Redis/BullMQ; avoid premature Temporal operations |
| Identity | OIDC provider (Keycloak, Authentik, Auth.js or managed IdP) | Real login, MFA, sessions, groups; replace CLI token issuance |
| Authorization | Organization/project RBAC + policy checks; scoped API keys | Multi-user organizations and auditable access |
| Sandbox | Containerized worker service (Docker/K8s), gVisor/Firecracker for hostile code | Plugin/MCP/generated code must not share the API host |
| Artifacts | S3-compatible object storage (MinIO locally) | Durable, signed URLs, retention, no shared filesystem |
| Observability | OpenTelemetry traces/metrics/logs, pino redaction, Prometheus/Grafana or hosted | Debuggable distributed execution and SLOs |
| Optimization | Keep HiGHS for LP/MIP; add Python OR-Tools CP-SAT and SimPy service | Best tool per problem class; isolate Python runtime |
| Frontend | React Router + TanStack Query + Testing Library + Playwright | Real routing, cache, component and E2E coverage |
| Contracts | Shared Zod/OpenAPI package, generated client types | Remove hand-written duplicate types |
| CI | GitHub Actions: typecheck, test, build, audit, secret scan, container scan, migration check | Enforce quality and security |

### 12.4 Do not do

- Do not build a second registry beside the extension registry. Extend the existing one.
- Do not replace Express with NestJS solely for structure.
- Do not add Kafka/Temporal/microservices before tenancy and durable jobs are needed.
- Do not claim a sandbox because a path is under a workspace directory.
- Do not present deterministic keyword planning as an LLM planner.
- Do not keep Mongo and SQLite as equal production sources of truth.

---

## 13. Target data model (conceptual)

All tenant-scoped tables carry `organization_id`, `created_by`, `created_at`, `updated_at`, `version`, and soft-delete where appropriate. Unique constraints are tenant-scoped.

```text
Identity and tenancy
  users, organizations, org_members, teams, team_members,
  projects, project_members, service_accounts, api_keys

Agents and capabilities
  agents, agent_versions, agent_profiles, agent_capabilities,
  capability_assignments, agent_policies, capability_snapshots

Work and execution
  missions, mission_events, tasks, task_dependencies, runs, run_steps,
  tool_calls, handoffs, approvals, artifacts, outbox_events

Extensions
  marketplaces, marketplace_syncs, packages, package_versions,
  package_dependencies, package_installations, installation_dependencies,
  package_scopes, package_permissions, package_secrets,
  tool_registrations, mcp_servers, package_audit_logs

Memory and intelligence
  memories, memory_versions, memory_embeddings (pgvector),
  models, model_routes, usage_events, quotas,
  optimization_models, optimization_solves, twins, twin_events
```

Key constraints:

- `agents.organization_id` and `agents.project_id` (nullable for shared agents).
- `package_installations` unique on `(organization_id, package_id, scope, scope_id)`.
- `capability_assignments` unique on `(agent_id, capability_id, scope, scope_id)`.
- `runs` unique active lease per task; `run_steps` ordered and idempotent.
- `tool_calls` stores input hash, output hash, permission decision, approval id, latency and error code.
- `outbox_events` is the transactional bridge to the queue; consumers are idempotent.

---

## 14. Target execution model

### 14.1 Mission lifecycle

1. API validates the request and writes `mission.requested` plus an outbox row in one transaction.
2. Returns `202` with a mission id. No long work in the request.
3. A dispatcher publishes the event; a worker leases the mission with `FOR UPDATE SKIP LOCKED`.
4. The worker resolves an immutable capability snapshot: agent version, skills, plugins, tool schemas, permissions, model, limits, policy.
5. The planner receives objective, context, memory, skill instructions and available tool schemas. It returns a structured plan validated by a schema.
6. Each step executes through the tool gateway. The gateway checks tenant, agent assignment, tool allowlist, permission, secret access, approval requirement, timeout and rate limit.
7. Step results, artifacts and events are persisted. Retries use idempotency keys and bounded backoff.
8. A verifier checks acceptance criteria using tests, independent review, or explicit evidence. A failed review can retry, hand off, or fail loudly.
9. Human approval suspends the mission; approval resumes from the persisted step, not from the beginning.
10. Revocation is checked at every step. Disabling a plugin or removing a permission affects the next step immediately.
11. Completion records the final snapshot, usage, cost, artifacts and audit trail.

### 14.2 Skill semantics

| Skill type | Runtime meaning |
| --- | --- |
| Knowledge | Instructions are injected into the system/planning context under a token budget; no execution |
| Task | A structured procedure with inputs, outputs and verification; may call tools |
| Tool-enabled | Declares required tool ids and permissions; tool gateway enforces them |
| Workflow | Declares a step graph or handoff contract; the runtime schedules it |

A skill installation never grants a tool or permission by itself. It declares requirements; the agent profile and policy must already satisfy them.

### 14.3 Auto-load semantics

- Marketplace auto-load may synchronize metadata on a schedule and mark new versions available. It must not execute package code.
- Installation auto-load may include an enabled, approved package in a new mission snapshot.
- Auto-load must never override an explicit deny, a disabled installation, a missing permission, or a required approval.

### 14.4 Model routing

- Model registry: provider, model id, context window, tool-calling support, cost per input/output token, latency class, data residency.
- Router: choose by task class, required capability, policy, budget and fallback order.
- Every call records provider, model, tokens, cost, latency, cache hit and error.
- No unlimited usage promise; quotas and hard budget stops are explicit.
- Providers sit behind adapters; the runtime does not import provider SDKs directly.

---

## 15. Living organization model

The current organization builder creates records; it does not operate an organization. The target model adds:

- **Org chart:** departments, sub-departments, roles, reporting lines, managers, spans and controls.
- **Membership:** humans and agents as members with contracts, skills, capacity and permissions.
- **Work:** projects, missions, tasks, dependencies, recurring rituals, meetings and decisions.
- **Cadence:** scheduled standups, reviews, planning and retrospectives as workflow templates, with real outputs.
- **Performance:** completion rate, cycle time, review pass rate, rework, cost, blocked time and handoff quality, computed from actual events.
- **Governance:** policies, approvals, budgets, escalation paths and audit.
- **Activity:** a durable event feed, not a client-side animation.
- **Collaboration:** multiple humans in one organization with roles and project membership.

An agent is not "living" because it has an avatar. It is living when it has a contract, assigned work, a schedule, measurable outcomes and an auditable history.

---

## 16. Optimization, simulation and decision intelligence

### 16.1 Already real

- HiGHS LP/MIP, including employee scheduling with independent re-validation.
- Hungarian assignment.
- PERT Monte Carlo with seeded reproducibility.
- Decision matrix, descriptive statistics, linear forecast with holdout.
- Digital twins as labelled PERT scenarios.

### 16.2 Target phases

1. **Formalize models:** JSON Schema for LP/MIP/assignment/scheduling, validation, infeasibility explanations, sensitivity ranges, solve metadata.
2. **CP-SAT service:** Python OR-Tools for scheduling, routing, packing, rostering and multi-objective models; async job API.
3. **Simulation service:** SimPy discrete-event, queueing, inventory, service operations; scenario comparison and calibration.
4. **Digital twin adapters:** telemetry ingestion from real systems, versioned twin models, drift and calibration reports. Until telemetry exists, keep the `simulated: true` label.
5. **Decision intelligence:** MCDA, value of information, risk/uncertainty, portfolio and policy evaluation; assumptions and evidence explicit.
6. **Scientific computing:** numerical methods, optimization, statistics and reproducible experiment tracking in the Python service.

Do not claim causal inference, real-time optimization or autonomous control without the corresponding data and verification.

---

## 17. UI and UX target

### 17.1 Navigation

- Home / Command Center.
- Execution.
- Agents.
- Organizations.
- Projects.
- Intelligence.
- Extensions.
- System.
- Settings (models, integrations, members, security, billing).

Legacy Campus and Director become optional visualization/collaboration surfaces, not primary navigation. Remove or adapt legacy global modals so there is one create-agent flow, one skill flow and one model flow.

### 17.2 Required page behavior

| Page | Target |
| --- | --- |
| Home | Real mission launch, provider/model status, live queue, recent outcomes, meaningful empty states |
| Execution | Run graph, step timeline, tool calls, approvals, artifacts, cost, errors, cancel/retry, snapshot diff |
| Agents | Profile, contract, assigned skills/plugins/tools, permission preview, model, limits, performance, versions |
| Organizations | Org chart, departments, members, projects, rituals, KPIs, policies, activity stream |
| Projects | Real project entity, tasks, board, milestones, mission links, membership |
| Intelligence | Model builder, solver runs, sensitivity, simulation scenarios, twin calibration, evidence |
| Extensions | Existing strong UI plus assignment matrix, scope editor, auto-load policy, provenance, audit |
| System | Unified audit, queue/worker health, MCP health, secrets metadata, usage, SLOs |
| Settings | SSO, members, roles, retention, API keys, integrations |

### 17.3 UI quality rules

- Every control calls a real endpoint or is visibly disabled with a reason.
- Loading, empty, error, success and permission-denied states are distinct.
- Arabic and English dictionaries have parity; pages do not contain hardcoded copy.
- RTL/LTR layout uses logical properties; test both directions.
- Accessibility: keyboard, focus order, labels, contrast, reduced motion.
- Responsive: desktop workspace-dominant; mobile single-column; no hidden critical actions.
- No decorative gradients, glass, glow or fake KPIs.

---

## 18. Security target controls

| Control | Target |
| --- | --- |
| Identity | OIDC authorization code + PKCE, MFA, session rotation, logout, device code for CLI |
| Tenancy | Organization membership, project membership, row-level security, tenant-scoped keys |
| Authorization | RBAC + policy checks on every route and tool call; no wildcard tool execution |
| Service accounts | Hashed API keys, scopes, expiry, rotation, audit |
| Tool gateway | Agent allowlist + permission + tenant + secret + approval + timeout + rate limit |
| Sandbox | Isolated worker per plugin/MCP/generated-code execution; no host filesystem or metadata access |
| Marketplace | Signed manifests, publisher identity, immutable package blobs, checksum verification, revocation feed, trust policy |
| Secrets | Envelope encryption with KMS, key versions, rotation, per-tenant keys, no plaintext in logs or responses |
| Network | Egress allowlist, private-IP block, DNS rebinding protection, TLS enforcement |
| Audit | Append-only, tamper-evident, unified, exportable, retention policy |
| Supply chain | Dependency and container scanning, SBOM, pinned images, provenance |
| Headers | CSP, HSTS, frame denial, content-type protection, permissions policy |
| Rate limits | Distributed Redis limits per tenant/user/tool |
| Data | Encryption at rest, backup encryption, retention, deletion, export |

---

## 19. Observability and reliability

- OpenTelemetry traces for API requests, mission steps, tool calls, MCP sessions and model calls.
- Metrics: queue depth, lease age, mission duration, step failure rate, tool latency/error rate, approval wait time, MCP health, model cost, token usage.
- Structured logs with request id, tenant id, mission id, task id, run id, tool id; secret redaction.
- Audit event stream separate from debug logs.
- SLOs: API availability, mission start latency, step success rate, tool timeout rate, recovery time.
- Backup/restore drills for Postgres, object storage and Redis (queue state should be reconstructible from the outbox).
- Graceful shutdown: stop leasing, finish or release current step, persist state.
- Dead-letter queue and operator replay.

---

## 20. Testing strategy

| Layer | Target |
| --- | --- |
| Unit | Manifest validation, semver, dependency graph, policy resolution, model routing, tool gateway |
| Integration | Postgres repositories, Redis queue, marketplace sync against a real fixture Git repository, MCP child process, HTTP plugin fixture |
| API | Every route authorization matrix: owner/admin/member/viewer/cross-tenant/service account |
| Runtime | Mission survives restart, duplicate execute, retry/backoff, approval suspend/resume, revocation mid-run, snapshot immutability |
| Security | SSRF corpus, symlink escape, secret leakage in logs/errors/responses, plugin sandbox escape attempts, permission denial |
| Frontend | Testing Library for pages/dialogs; Playwright for marketplace install, agent assignment, mission execution, disable/revoke |
| Migration | Dry-run counts, checksums, rollback, dual-read comparison |
| Load | Concurrent missions, tool calls, marketplace sync, SSE/WebSocket fanout |
| CI | Typecheck, tests, build, audit, secret scan, container scan, migration check on every PR |

Current baseline: 80 API tests, 41 client tests, typecheck and build green, no CI. The extension tests are genuinely integration-level (real Git fixture, real HTTP fixture, real MCP child process). That standard should be extended to the unified runtime.

---

## 21. Migration plan (zero data loss)

### Phase A — Freeze and baseline

- Tag the current commit; make a SQLite backup and a Mongo dump.
- Add CI that runs the existing checks.
- Fix P0 SSRF, split-deployment base URL, SQLite replica shape, and the boot-time interrupted-mission behavior.
- Remove or clearly disable the fake local hire path.

### Phase B — Schema and tenancy

- Introduce Postgres and a migration runner.
- Create organization/user/member/project tables.
- Migrate OS tables 1:1 with preserved ids; add tenant columns and backfill.
- Migrate extension tables 1:1; preserve ids, checksums and audit rows.
- Migrate Mongo agents and skills into unified agents/package tables; keep the legacy read path behind a flag.
- Migrate board JSON into projects/tasks, or store it as a versioned legacy document until the new board is ready.

### Phase C — Runtime

- Add the outbox and BullMQ worker.
- Make mission execution lease-based and idempotent.
- Add capability snapshots, step events and cancellation.
- Add the tool gateway and remove wildcard execution.
- Add the model router and prompt builder; inject skills under budget.

### Phase D — Sandbox and extensions

- Move plugin/MCP execution to a worker service with container isolation.
- Add signed manifests, immutable package blobs and provenance.
- Add secret envelope encryption and rotation.
- Add marketplace auto-sync with explicit approval.

### Phase E — Organization and UX

- Add org chart, membership, projects, rituals and performance.
- Complete i18n and React Router migration.
- Retire legacy duplicate flows.
- Add Playwright coverage.

### Phase F — Intelligence and scale

- Add CP-SAT/SimPy Python service.
- Add twinning telemetry adapters and calibration.
- Add SLOs, load tests and cost controls.

Rollback strategy: keep the SQLite file and Mongo dump for the cutover window; run dual-read comparisons; keep the legacy path behind a feature flag; never delete source data until the new path has passed acceptance tests.

---

## 22. Manual configuration still required

### Current code

| Variable / action | Purpose |
| --- | --- |
| `AUTH_SECRET` (>= 32 bytes) | Session signing and extension secret key derivation |
| `ADMIN_API_KEY` (optional) | Cross-workspace operator access and usage ledger |
| `MONGO_URI` | Legacy agents, skills, workspace entries; required for production boot |
| `REDIS_URL` | Chat history, presence, rate limits, BullMQ |
| `ALLOWED_ORIGINS` | CORS allowlist |
| `WORA_OS_DB` | SQLite path |
| `WORA_WORKSPACE` | Generated apps and artifacts |
| `WORA_EXT_KEY_FILE` | Fallback extension secret key file if no `AUTH_SECRET` |
| `WORA_EXTENSIONS_LOCAL_ROOTS` | Allow-listed local marketplace roots |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Legacy chat and Studio providers |
| `STUDIO_PROVIDER`, `STUDIO_MODEL` | Optional Studio generation |
| `GITHUB_SKILLS_TOKEN` | Optional GitHub skill import quota |
| `VITE_API_URL`, `VITE_SOCKET_URL` | Legacy/Studio/session client origins |
| `VITE_OS_API` | Optional OS/extensions-only origin; falls back to `VITE_API_URL` (Phase 1). Passed by Docker and Compose and checked at build time. |
| TLS certificate and domain | nginx |
| Mongo seed | `npm run seed` to create the four legacy agents |
| Volume permissions | SQLite, workspace, nginx certs |

### Target platform

- OIDC issuer/client id/secret, redirect URIs, MFA policy.
- Postgres connection, migration role, backup bucket.
- Redis connection and key prefix.
- Object storage bucket, credentials, lifecycle policy.
- KMS key for envelope encryption.
- Sandbox runtime (Kubernetes namespace, gVisor/Firecracker, network policy).
- Model provider keys and budget limits.
- SMTP for invitations and alerts.
- Billing provider, if billing becomes real.

---

## 23. Known limitations and remaining blockers

### Known limitations (current)

- No real authentication, SSO, MFA, directory, or user management.
- No multi-user organization or project membership.
- No durable worker; missions run in-process and can be marked failed by a replica boot.
- No LLM planner or tool-calling loop in the OS core.
- Skills are inert; auto-load is metadata; org/project/user scopes are partial.
- No sandbox for plugins, MCP, or generated tests.
- No signed marketplace provenance; checksums cover manifests and instructions only.
- No Postgres/pgvector; memory retrieval is TF-IDF.
- No Playwright/browser E2E; client tests are mostly static.
- No CI, migrations, OpenTelemetry, backups, or SLOs.
- English mode is incomplete.
- Billing is not implemented.
- Legacy Campus/Director and OS pages are separate products sharing a shell.

### Remaining blockers (decisions and infrastructure)

1. Choose the identity provider and tenancy model (organization membership, invitations, roles).
2. Choose the model routing/budget policy and whether OS missions may call providers.
3. Provision Postgres, Redis, object storage, and an isolated sandbox runtime.
4. Approve the marketplace trust model and code-execution policy.
5. Decide whether legacy realtime chat is retired, kept as a collaboration adapter, or migrated to the unified runtime.
6. Establish backup/restore and incident response ownership.
7. Resolve repository write credentials if a PR is required; the current environment previously rejected pushes with 403. No source changes were made in this audit.

---

## 24. Definition of done for the modernization

The platform is modernized when all of the following are true and verified:

1. A user signs in through OIDC, belongs to an organization, and can be granted a project role.
2. Two users in one organization can see the same agents, projects and missions, with row-level isolation from other organizations.
3. A mission is accepted asynchronously, survives an API restart, and resumes without duplicate side effects.
4. The planner uses a model with structured output; skills are injected under a token budget; tools are selected through a gateway.
5. A revoked plugin or permission stops affecting the next step of a running mission.
6. A malicious plugin or MCP server cannot read host files, cloud metadata, or the API environment; the attempt is contained and audited.
7. Marketplace packages have signed provenance and immutable versions; install shows a permission and dependency preview.
8. A multi-user organization operates with departments, members, projects, rituals and performance computed from real events.
9. Arabic and English are complete on every page; RTL/LTR and accessibility pass automated checks.
10. CI runs typecheck, unit, integration, API authorization, security, frontend and E2E tests; migrations are tested; images are scanned.
11. Dashboards show mission, tool, MCP, queue and model health; alerts fire on SLO breaches.
12. Backup and restore are rehearsed; no data is lost during the migration.

Until then, the honest description is: **WORA has a real execution kernel and a real extensions subsystem, but the platform layer is still being assembled.**

---

## 25. File and commit references

### Extensions commit

- `api-server/src/extensions/` — 15 source/test files, 5,707 lines.
- `api-server/src/os/orchestrator.ts`, `router.ts`, `scaffold.ts`, `tools.ts` — integration points.
- `api-server/src/wora-server.ts` — boot integration.
- `client/src/extensions/`, `client/src/components/ExtensionsHub.tsx`, `AgentCapabilitiesDialog.tsx` — UI.
- `client/src/App.tsx`, `AgentRegistry.tsx`, `i18n/dictionaries.ts`, `main.tsx`, `pages.ts` — shell/nav.
- `docs/EXTENSIONS.md` — subsystem documentation.

### Key audit references

- `api-server/src/wora-server.ts` — legacy composition root, auth, CORS, health, Socket.IO.
- `api-server/src/lib/config.ts` — production config gates.
- `api-server/src/lib/session.ts` — HMAC session format.
- `api-server/src/os/db.ts` — OS schema and ad-hoc migrations.
- `api-server/src/os/router.ts` — OS REST surface, RBAC, workspace resolution.
- `api-server/src/os/orchestrator.ts` — deterministic planning and mission execution.
- `api-server/src/os/tools.ts` — tool registry, permissions, SSRF tool, host exec.
- `api-server/src/os/workspace.ts` — path-boundary workspace helper.
- `api-server/src/extensions/schema.ts` — 12 extension tables.
- `api-server/src/extensions/capabilities.ts` — scope and permission resolution.
- `api-server/src/extensions/runtime.ts` — plugin and MCP execution.
- `api-server/src/extensions/mcp.ts` — child process transport.
- `api-server/src/extensions/secrets.ts` — AES-GCM secret storage.
- `api-server/src/extensions/git.ts` — marketplace Git adapter.
- `client/src/os/api.ts`, `client/src/extensions/api.ts` — client API bases.
- `client/src/App.tsx` — global legacy mounts and page routing.
- `client/src/components/HireAgentModal.tsx` — local-only hire path.
- `client/src/components/ProjectOSBoard.tsx` — board and legacy store coupling.
- `docs/audits/PRODUCT_AUDIT_AND_RESET_PLAN.md` — prior product audit.
- `docs/OS_CORE.md` — OS design decisions and documented limitations.

---

## 26. Exact commands used in this audit

```bash
# Repository state
git status --short --branch
git log --oneline -3
git rev-parse --short origin/main

# API
cd api-server
npm test
npm run typecheck
npm run build
npm audit --omit=dev

# Client
cd ../client
npm test
npm run typecheck
npm run build
npm audit --omit=dev

# Live extensions smoke (isolated temporary SQLite, no production data)
PORT=4100 PREVIEW_HOST=127.0.0.1 NODE_ENV=development \
WORA_OS_DB=/tmp/wora-audit.db WORA_WORKSPACE=/tmp/wora-audit-ws \
npx tsx src/scripts/preview-server.ts
# then: GET /api/os/agents, GET /api/os/extensions, plan/install echo MCP,
# GET capabilities, health, execute, create mission, disable, uninstall
```

No production data was modified. The temporary database and workspace were removed after the smoke test.

---

## 27. Final recommendation

Proceed in this order:

1. **Contain:** fix SSRF, tool allowlist bypass, symlink escape, split base URL, and the SQLite-replica/boot recovery behavior.
2. **Unify identity and data:** choose OIDC and Postgres; create organization/project tenancy; migrate agents, skills, OS and extensions with preserved ids.
3. **Unify execution:** durable worker, capability snapshots, tool gateway, skill injection, model router, approvals, cancellation.
4. **Isolate untrusted code:** sandboxed plugin/MCP/test workers with signed provenance.
5. **Operate the organization:** real org chart, membership, projects, rituals, performance from events.
6. **Complete the experience:** full i18n, one create-agent flow, one skill flow, real execution console, Playwright and CI.
7. **Add intelligence depth:** CP-SAT, simulation, twin telemetry, decision analysis, with explicit uncertainty.

The domain logic and extension work are worth preserving. The main risk is continuing to add features on top of two incompatible foundations. Consolidation is the highest-leverage engineering work.

---

## 28. Required delivery checklist

| Requested item | Where it is answered |
| --- | --- |
| 1. Repository and architecture findings | Sections 2, 3, 5, 6, 10 |
| 2. Existing capabilities reused | Section 3.1 and the final recommendation |
| 3. New capabilities implemented | Section 3.1, 8.1, 8.2 |
| 4. Database changes | Sections 6, 13 |
| 5. API endpoints | Section 5.2 |
| 6. UI pages and interactions | Sections 4, 17 |
| 7. Custom Skills created | Section 2.3, 8.1, 8.2 |
| 8. Plugins and MCP integrations implemented | Sections 8.1, 8.2 |
| 9. Security controls | Section 9, 18 |
| 10. Tests executed and exact results | Sections 2.4, 8.2, 20 |
| 11. Build and type-check results | Section 2.4 |
| 12. Known limitations | Section 23 |
| 13. Remaining blockers | Section 23 |
| 14. Files and commits changed | Section 2.1, 25 |
| 15. Exact manual configuration still required | Section 22 |

### Current delta added by this audit

- Added this audit document.
- No source code was modified.
- No commit or push was performed.
- No production data was created, modified or deleted.

### Immediate next change set, if implementation is authorized

1. Block private/link-local/metadata targets and redirects in `web.fetch_read`; add a URL policy test corpus.
2. Remove wildcard execution from the core tool REST endpoint; require an agent capability profile or an explicit operator scope.
3. Reject symlink escapes in `resolveInWorkspace` using `realpath` containment after resolution.
4. Remove the two-replica SQLite production shape; either single-writer with a volume or move to Postgres before scaling.
5. Remove boot-time global `markInterruptedMissions`; replace it with per-lease expiry.
6. Add `VITE_OS_API` to the client Docker build, Compose, README and Vercel contract; or make OS clients fall back to `VITE_API_URL`.
7. Inject skills into the planner/model context, or label them metadata-only in the UI until the runtime consumes them.
8. Wire organization/project/user scopes through mission context and policy editing, or hide those scopes.
9. Add CI with the existing test, typecheck, build and audit commands before the next feature branch.
