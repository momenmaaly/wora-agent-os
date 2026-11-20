# WORA Agent OS — Phase 0 repository audit and feature-preservation inventory

Audit date: 2026-11-19  
Branch: `arena/43222165-wora-agent-os`  
Base commit: `3521e46c666d800a1cec42a7ece45dcc7f64dd34`  
Audit basis: the actual local Git checkout, tracked file inventory, package manifests, source reads, route/event greps, and deployment configs. The connected Vercel project also confirms the linked repository `momenmaaly/wora-agent-os` (private), production branch `main`, Vite root `client`, and a production deployment built from the base commit.

## 1. Architecture summary

| Layer | Existing implementation | Preservation requirement |
| --- | --- | --- |
| Frontend | React 18.3 + TypeScript + Vite 6.4; Zustand 5; Socket.IO client; Lucide; fontsource; Arabic-first RTL shell | Keep all routes, pages, local stores, theme, session, accessibility, and mobile behaviors |
| Office | `SpatialOffice.tsx` renders a detailed SVG oblique-projection office from `office/layout.ts`, `spatial.ts`, `presentation.ts`, `work.ts`, `models.ts`, and `useOfficeSimulation.ts` | Keep as the verified operational fallback and do not remove routes; add WebGL as an additive capability |
| Backend | Express 5 + TypeScript + Socket.IO; Redis pub/sub adapter; BullMQ AI queue; MongoDB/Mongoose; Zod validation; Pino logging | Keep production service boundaries, auth, tenant isolation, queue, and provider adapters |
| Shared types | `shared/types/index.ts`; `client/src/types.ts` is byte-identical | Keep shared contract as source of truth and extend additively |
| AI | `BrainAdapterFactory` supports Google, OpenAI, Anthropic, and Groq, with streaming; `AiQueue` handles provider timeouts, lifecycle, and stream abort | Never replace real provider execution with simulated behavior in production |
| Deployments | Docker Compose production stack, Nginx TLS reverse proxy + static client, Railway API/client configs, Vercel client config | Preserve existing deployment paths and env contract; do not deploy without evidence |

## 2. Tracked inventory

The checkout contains 120 tracked source/config files and about 12 MB before generated dependencies. Important top-level paths:

- `README.md` — architecture, verification, preview-versus-production distinction, and deployment instructions.
- `client/` — React application, styles, stores, office renderer, pages, tests, Vite config.
- `api-server/` — Express/Socket.IO production server, preview server, models, AI adapters, queues, routers, tests.
- `shared/types/` — shared contracts.
- `design-concepts/` — existing design material.
- `nginx/`, `docker-compose.prod.yml`, Dockerfiles, `client/vercel.json`, `client/railway.json`, `api-server/railway.json` — deployment.
- `.env.example`, `.gitignore` — environment and ignore policy.

### Package manifests and scripts

- `client/package.json`: `dev`, `typecheck`, `build`, `preview`, `test`; dependencies include React, React DOM, Zustand, Socket.IO client, Lucide React, and fontsource.
- `api-server/package.json`: `build`, `typecheck`, `start`, `dev`, `dev:preview`, `seed`, `test`; dependencies include Express 5, Socket.IO, Redis adapter, BullMQ, Mongoose, Zod, Pino, Octokit, and the OpenAI/Anthropic/Gemini/Groq SDKs.

## 3. Existing routes, navigation, and pages

Navigation is hash-based (`pages.ts` / `App.tsx` lazy screens):

| Route/page | Existing behavior | Status |
| --- | --- | --- |
| `#campus` | Main workbench, spatial office, floor plan, room selection, tour, local/connected workspace, task HUD | Preserve; additive 3D view |
| `#director` | Director Office with grounded reports, recommendations, explicit assignment, and execution-status notes | Preserve; future GM/Executive Office extends it |
| `#projects` | Project OS lifecycle, Kanban, ideas, products | Preserve; future workflow engine should read/extend rather than replace |
| `#studio` | Product Studio with local templates and live provider drafts | Preserve |
| `#settings` | Workspace settings, session verification, theme, and settings sections | Preserve |
| `#models` | ModelHub provider/model catalog and model swapping | Preserve; distinguish live from reference-only providers |
| `#integrations` | Integration catalog and local connect/sync/disconnect demo state | Preserve; real OAuth/API connectors remain future work |
| `#pricing` | FREE/PRO plan previews and workspace caps | Preserve; real billing is future work |

Other navigation behaviors: company switcher, Quick Search (`Ctrl/Cmd+K`), chat drawer, mobile menu, notification/help affordances, and direct room links such as `/#campus/zone-engineering`.

## 4. Frontend feature inventory

| Area | Existing feature | Notes / risk |
| --- | --- | --- |
| Internationalization | Arabic-first RTL layout and bilingual content; `index.html` sets `lang="ar" dir="rtl"` | New global UI should remain usable with Arabic/RTL; reference image is LTR |
| Theme | Light/dark tokens, buttons, panels, badges, fields, focus rings, reduced-motion support | Additive design-system tokens only |
| Campus | Expandable workbench, SVG office, 10 mapped rooms, department selection, visitor route/tour, room camera, floor plan, agent/guest markers | Highest-value existing feature; retain as WebGL fallback |
| Office state | `useOfficeSimulation.ts`, `office/work.ts`, task/report helpers, lifecycle/avatar state maps, billable room gates | Real work reports exclude fixtures/signals/expired records; do not invent progress |
| Workspace | Room messages, brain swap, shared workspace entries, dispatch, active tasks, local persistence | Preserve server/local scope distinction |
| Director | Arabic/English report questions, skill-grounded assignment recommendations, gated matches, explicit execution notes | Foundation for GM, not a complete workflow engine |
| Agents | Hire session-local agents, agent skills GitHub metadata import, model swap, profiles | Preserve session-local semantics; persistent company roster is future work |
| Projects | Projects, products, ideas, Kanban tasks, checklists, Studio integration, local persistence | Contains demo seed content; mark as user/demo state, do not label as real execution |
| Studio | Local templates, live API drafts, quota handling, product save states | Preserve live provider path |
| Models | Provider/model catalog, labels, capability metadata, BRAIN_MODELS | Some catalog entries beyond the four supported adapters are reference-only |
| Integrations | Catalog with categories/departments, local connect/sync/disconnect | Local demo state, not OAuth or real external API calls |
| Billing | Plan/preview state, room gates, local Pro preview | No payment/subscription backend in this checkout |
| Session | Session token, serverMode, connection error, preview/server distinction | Preserve fail-closed behavior |
| Mobile | Responsive shell at 320px+, mobile menu, touch/pan hints, floor plan adaptations | WebGL implementation must add touch camera and graceful fallback |
| Tests | `client/tests/campus.test.mjs`, session, studio, work and related tests | Run relevant tests after changes |

## 5. Backend feature inventory

| Area | Existing implementation | Status |
| --- | --- | --- |
| Production config | Requires `AUTH_SECRET`, `MONGO_URI`, `REDIS_URL`, `ALLOWED_ORIGINS`; strict CORS; fail-closed production validation | Preserve |
| Auth/session | HMAC/HS256 expiring signed session tokens; `/api/session`; strict origin/session verification | Preserve; no credentials in frontend |
| Tenant isolation | Per-user `wora-{userId}` Socket.IO rooms; Redis room state; zone isolation; room cleanup on disconnect | Preserve |
| Data | Mongoose `Agent`, `WorkspaceEntry`, `AgentSkills`; `SharedWorkspaceManager` with 24h TTL and optional Mongo persistence; `AgentRuntimeStore` / `PresenceStore` | Extend with backward-compatible migrations |
| AI queue | BullMQ queue, provider timeout, streaming lifecycle, abort/cancel, quota handling | Preserve real execution |
| Providers | Google, OpenAI, Anthropic, Groq adapters; `BrainAdapterFactory`; `isSupportedModel` | Extend routing, do not bypass |
| Director | `director/recommend` grounded recommender and tests | Preserve and extend into GM later |
| Studio | Live provider/quota router | Preserve |
| Skills | GitHub metadata importer, skill router and store | Preserve |
| REST | `/health`, `/ready`, `/api/session`, `/api/agents`, `/api/zones`, `/api/brains`, admin brain swap, room workspace, GitHub skills and Studio routes | Preserve |
| Socket events | `room:join`, `room:leave`, `room:move`, `message:send`, `agent:brain-swap`, `director:recommend`, `workspace:signal`, disconnect cleanup | Preserve; additive events only |
| Preview server | In-memory 4-agent/4-zone preview with explicit simulated replies and no paid provider calls | Preserve and clearly label as preview; never use it as production evidence |
| Tests | Config, session, director, studio, skills, GitHub, Mongo, router tests | Run relevant tests after changes |

## 6. Deployment and environment inventory

- `docker-compose.prod.yml`: Redis (`noeviction`), two API replicas, Nginx TLS reverse proxy, static client Nginx bundle.
- `nginx/nginx.conf` and `client/nginx-client.conf`: proxy/static serving and client headers.
- `client/vercel.json`, `client/railway.json`, `api-server/railway.json`: standalone client/API deploy configs.
- Vite dev/preview proxy uses `127.0.0.1:4000`; Vite allowed hosts include `.e2b.app` for Arena previews.
- README explicitly warns that standalone Vercel without the API is a preview, not a connected production service.
- Connected Vercel project `wora-agent-os` is linked to the private `momenmaaly/wora-agent-os` repository, root `client`, production branch `main`, with the base commit production deployment `READY`.

## 7. Feature/status preservation matrix

Legend: **Working** = implemented in this checkout; **Preview/local** = intentionally scoped demo/local behavior already present; **Reference-only** = catalog/metadata without live backend execution; **Gap** = not present.

| Capability | Status | Constraint |
| --- | --- | --- |
| Auth, session, CORS, tenant isolation | Working | Must remain fail-closed |
| MongoDB/Redis persistence | Working in production mode | Must not be removed or replaced by mock data |
| Real AI provider streaming and queue | Working for 4 providers | Must not be replaced by simulation |
| SVG workbench, floor plan, tours | Working | Preserve as fallback |
| Projects/Kanban/Studio/ModelHub | Working (local + live provider draft paths) | Preserve, then connect richer backend in later phases |
| Integration catalog / billing catalog | Preview/local | Must be clearly labeled; real OAuth/API/payment work is future |
| True WebGL/Three/R3F/GLTF 3D office | Gap | Phase 1 additive foundation |
| 10 backend zones matching 10 client rooms | Gap (backend has 4) | Future additive zone registry/migration |
| Persistent company, GM, workflow engine, approvals | Gap | Phases 4–7 |
| Universal real integrations, OAuth token storage, webhooks | Gap | Later phases; only implemented/tested APIs may be marked connected |
| Admin center, knowledge/memory, reporting subscriptions | Gap | Later phases |
| Mobile WebGL adaptive/fallback | Gap | Must be implemented with Phase 1+ 3D work |

## 8. Technical risks

1. **Visual fidelity risk:** the requested reference is a sophisticated rendered cutaway, while current office is SVG. A true WebGL implementation needs detailed procedural geometry/materials, optimized rendering, and real interaction; it must not become colored cubes or a static image.
2. **Architecture mismatch:** client defines 10 office rooms while backend validates 4 zones. Do not silently reassign production agents; add a compatibility registry/migration in a later controlled phase.
3. **Roster mismatch:** production seed has 4 core agents, while client standalone demo has more. Preserve both sources and clearly communicate mode.
4. **Provider catalog mismatch:** catalogs include DeepSeek, Mistral, Cohere, Qwen, xAI, Perplexity and others; backend adapters currently support Google/OpenAI/Anthropic/Groq. Preserve catalog metadata but do not claim live routing.
5. **Data honesty:** demo projects, integrations, billing, and local tasks exist. Do not turn their display into evidence of real execution, connected OAuth, or payment.
6. **Auth/tenant regression:** new UI/API must never expose provider keys, bypass session verification, or mix per-user rooms.
7. **Performance:** a detailed 3D office must use instancing/shared geometry/materials, capped pixel ratio, adaptive shadows, and mobile fallback. WebGL failure must leave the app operational.
8. **GitHub connector:** the conversation's GitHub app connector is unsupported; local Git/GitHub CLI is available for this checkout. Connector-specific repository/PR operations requiring the app need authorization/access. Do not claim a connected GitHub API audit.
9. **Testing:** no tests/build/typecheck were run during the initial source inspection. Every implementation phase must run relevant checks before reporting completion.

## 9. Controlled implementation roadmap

### Phase 0 — Access and audit (this artifact)

- Exact Drive reference retrieved, inspected, and documented.
- Repository, feature inventory, architecture, risks, and roadmap documented.
- Preserve all tracked source behavior; no production source changes in this phase.

### Phase 1 — Foundation, design system, and 3D reference architecture

- Add Three.js/R3F/Drei dependencies compatible with React 18.
- Add a WebGL-capable 3D office as an **opt-in / fallback-safe** campus view beside the existing SVG office and floor plan.
- Reproduce the reference's composition: open ceiling, central circular lobby, glass radial departments, wood desks, chairs, monitors, plants, shelves, signs, and white/cyan/navy robot family with subtle orange/purple accents.
- Add default isometric camera, zoom/pan/rotate, room focus, reset, touch controls, adaptive quality, and WebGL-unavailable fallback.
- Add design tokens and shell elements (reference-aligned dark frame, top status, Live Activity from real state only, Executive Command foundation, view controls) without removing existing Arabic/RTL shell features.
- Tests/typecheck/build and visual comparison against the retained original.

### Phase 2 — Interactive company, departments, robots, and workstations

- Dynamic department/room/agent registry preserving existing 10 rooms and 4 backend zones; selectable/enterable rooms, workstations, robot profiles, and smooth camera transitions.
- Department creation/configuration and dynamic layout support; robot state animations driven by actual lifecycle/task state.
- No fake progress or productivity.

### Phase 3 — Real agent integration and execution-event synchronization

- Connect 3D robot states to persistent agent records, Socket.IO lifecycle, workspace/task events, profiles, handoffs, deliverables, and activity history.
- Preserve provider adapters/queue; add real event instrumentation rather than simulated activity.

### Phase 4 — Executive Office, General Manager, and workflow engine

- Extend Director Office with company-wide GM context, natural-language planning, structured projects/workflows/dependencies/assignments, approvals, escalation, and cross-department coordination.
- Implement sequential/parallel/conditional workflow execution, retries, failure recovery, deadlines, priority, and auditable handoffs.

### Phase 5 — Provider management, BYOK, routing, usage/cost

- Add secure server-side key management, provider health, connection testing, model selection, capability/cost/context routing, rate-limit handling, fallback, and usage/cost accounting.
- Explain consumer subscriptions versus API access; no secrets in frontend/logs.

### Phase 6 — Universal Integration Center

- Modular official OAuth/API connectors, granular least-privilege permissions, token encryption/storage, provider accounts, authorized agents/actions, test/monitor/error recovery, unified file references and activity logs.
- Only connectors actually implemented and tested may be marked connected.

### Phase 7 — Projects, knowledge, reports, approvals, subscriptions, admin

- Persistent company knowledge/memory, reporting, workload views, approval gates, subscription enforcement/admin, and platform admin center, all built on backward-compatible data migrations.

### Phase 8 — Security, performance, mobile, accessibility, regression, deployment readiness

- Full QA matrix, load/performance evidence, security review, tenant isolation tests, WebGL/mobile fallback, monitoring, backup/recovery, and deployment readiness. No production load test without explicit authorization.

## 10. Phase 0 report

1. **Implemented:** exact-reference retrieval/inspection documentation, repository audit, feature-preservation inventory, architecture assessment, technical risks, and controlled roadmap.
2. **Existing files changed:** `.gitignore` (excludes local analysis scratch files); new untracked docs under `docs/`.
3. **Existing features preserved:** all tracked source files, routes, services, database behavior, auth, provider adapters, SVG office, tests, and deployment configs remain unchanged.
4. **Tests passed:** none run in Phase 0; source inspection only. Relevant tests/build/typecheck are required in each implementation phase.
5. **Integrations actually working:** Google Drive exact-file search/download and credential validation succeeded; Linear and Vercel credential validation succeeded; Vercel project lookup confirmed the linked repository/deployment. These are audit/access integrations, not product connectors implemented in WORA source.
6. **Incomplete features:** all roadmap phases 1–8 remain to be implemented; no true WebGL, GM workflow engine, real universal integrations, persistent knowledge/memory, or billing backend exists yet.
7. **Blockers requiring credentials/approval:** none for Phase 0. Future real provider/OAuth/payment/deployment/production-load work requires appropriate secrets, authorized accounts, and explicit approval; the GitHub conversation connector is unsupported.
