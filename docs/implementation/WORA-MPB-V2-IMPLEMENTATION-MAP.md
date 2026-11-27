# WORA MPB V2 — Implementation Map

**Baseline:** `release/wora-v1` at `87c4399` (PR #14)
**Scope:** audit against WORA-MPB-001 Parts 1–2; extend, do not rebuild.
**Current slice:** Track B — Simple / Guided / Advanced experience, connected to the existing intelligence APIs.

## 1. Existing capabilities reused

| Capability | Implementation | Status |
| --- | --- | --- |
| Agent registry and specializations | `api-server/src/os/registry.ts`, `specializations.ts`, `roles.ts` | implemented foundation |
| Mission orchestration, plans, handoffs, review gates | `api-server/src/os/orchestrator.ts`, `planning.ts`, `multi-agent.test.ts` | implemented foundation |
| Problem understanding and unified model | `api-server/src/os/problem.ts`, `problem-model.ts`, `problem-structure.ts` | implemented foundation |
| Reasoning, hypotheses, evidence | `api-server/src/os/reasoning-engine.ts`, `reasoning-store.ts`, `reasoning-evaluation.ts` | implemented foundation; model assistance provider-dependent |
| Algorithm and scientific method selection | `api-server/src/os/algorithms.ts`, `science.ts` | implemented catalogs and deterministic selection |
| Decision comparison and replan assessment | `api-server/src/os/decision.ts`, `adaptive-replan.ts` | implemented foundation |
| Capability composition and strategy synthesis | `api-server/src/os/capability-composition.ts`, `strategy-synthesis.ts` | implemented foundation |
| OR solvers and assignment/scheduling | `api-server/src/os/ortools.ts`, `tools.ts` | LP, scheduling and assignment foundations |
| Simulation and digital twins | `api-server/src/os/twins.ts`, `tools.ts` | limited/partial; no full digital-twin engine |
| Memory, lessons and playbooks | `api-server/src/os/memory.ts`, `lessons.ts`, `playbooks.ts` | memory/lessons implemented; semantic graph incomplete |
| Independent and outcome verification | `api-server/src/os/independent-verification.ts`, `outcome-verification.ts` | implemented foundation |
| Governance, approvals, budgets, devices | `api-server/src/os/governance.ts` | implemented foundation; local runtime execution incomplete |
| Durable execution, leases, recovery | `api-server/src/os/worker.ts`, `task-queue.ts`, `recovery.ts`, `lease-probe.ts` | implemented foundation |
| Cloud computer and browser runtime | `api-server/src/runtime/cloud.ts`, `browser.ts`, `browser-docker.ts`, `browser-proxy.ts` | Docker CI passed |
| Skills, plugins, marketplaces, MCP | `api-server/src/extensions/*`, `client/src/components/ExtensionsHub.tsx` | implemented foundation |
| Operating workspace | `client/src/workspace/BriefZone.tsx`, `RunZone.tsx`, `LibraryZone.tsx`, `SystemZone.tsx` | implemented; experience levels missing |
| Runtime deployment contract | `docker-compose.prod.yml`, `docs/releases/WORA-V1-DEPLOYMENT.md` | host validation outstanding |

## 2. Part 2 track mapping

| Track | Existing implementation | Genuine gap | This slice |
| --- | --- | --- | --- |
| A — V1 closure | PR #14, CI green, deployment contract | deployment-host validation | unchanged |
| B — Original experience | five primary zones, hidden legacy routes, AR/EN RTL | no Simple/Guided/Advanced mode; no preflight approach disclosure | **implementing** |
| C — Universal Intelligence Core | problem model, reasoning, method selection, planning, replan | intelligence not visible before mission launch | **exposing real preflight analysis** |
| D — Scientific Intelligence | algorithm/science catalogs, OR tools, twins, benchmarks | model construction remains structured/limited | next slice |
| E — Autonomous organization | dynamic selection, teams, handoffs, worker | local runtime execution incomplete | later |
| F — Learning/self-evolution | lessons, memory, benchmarks | knowledge graph and evolution sandbox absent | later |
| G — Marketing/media | none | no brand/content/publishing engine | later |

## 3. This implementation slice

### Goal

Make the default WORA experience simple while making the existing intelligence inspectable and controllable through three explicit levels:

- **Simple:** objective only; no preflight internals; no composition checkbox; no raw context or replan controls.
- **Guided:** preview the real problem profile, plan, selected team and method before launch; adjust the objective and preview again.
- **Advanced:** all guided detail plus scientific method rationale, rejected alternatives, capability requirements/gaps and the Run context inspector.

### Integration points

- `client/src/experience/mode.ts` — shared persisted mode.
- `client/src/components/ExperienceModeControl.tsx` — accessible segmented control.
- `client/src/workspace/BriefZone.tsx` — preflight preview through `POST /api/os/capabilities/analyze`.
- `client/src/workspace/RunZone.tsx` — mode-aware context and replan disclosure.
- `client/src/os/api.ts` — typed preflight client.
- `client/src/i18n/dictionaries.ts` — complete Arabic and English copy.
- `client/src/styles/operating.css` — responsive RTL/LTR layout.

No new backend registry, database table or parallel intelligence engine is introduced. The preview uses the existing OS analysis endpoint and does not create a mission or execute a tool.

### Acceptance for this slice

- Simple is the default on a clean profile.
- Guided preview shows a real domain, plan, team and method from the API.
- Advanced reveals scientific rationale/alternatives and capability requirements.
- Simple hides raw context and replan controls; Advanced exposes them.
- Arabic RTL and English LTR remain coherent; no horizontal overflow.
- Typecheck, build, API tests and client tests pass.
- No mission is created by previewing an approach.

## 4. Verification for this slice

- Client typecheck and production build pass (`tsc --noEmit`, API/deployment contract, Vite build).
- Client suite on Node 24: 68 tests, 68 pass.
- API suite on Node 24: 413 tests, 409 pass, 4 skipped (Docker/Mongo integrations when the environment is absent).
- New Playwright journey `client/tests/experience-modes.test.mjs` exercises the real preview API, the no-mission guarantee, Advanced scientific disclosure, and Simple/Advanced Run context visibility.
- Existing production workspace and mobile RTL/LTR journeys still pass.

## 5. Deferred work

- OR model construction from natural-language formulations with inspectable constraints.
- Semantic/knowledge graph and provenance-aware retrieval.
- Local runtime execution beyond pairing.
- Controlled self-evolution sandbox and benchmark promotion.
- Marketing/media engine and external publishing.
- Production host validation (Docker, Mongo, Redis, TLS, Chromium sandbox).
