# WORA — Final Integration Audit (PRs #9–#12)

Date: 2026-11-23
Audited branch: `feat/wora-cloud-computer-browser`
Audited HEAD: `750717a`
Base: `main` at `e7f9939`
Mode: read-only code/test audit. No product code was changed.

## 1. Verdict

The four PRs do not yet form a coherent, production-ready system, although the core
WORA OS, the extensions subsystem, and the production workspace are substantially real
and tested.

The subsystem tests are green, but the shipped deployment artifacts cannot run the
headline PR #12 capabilities (Docker cloud computers and browser automation), and
several cross-layer contracts are broken:

- The compose image has no `git` or Docker CLI and no browser runtime service, so Git
  marketplace sync and PR #12's Docker runtime cannot work in the supplied deployment.
- The compose environment does not pass a production secret keyring, so extension
  secrets and private-repository credentials fail closed.
- An agent tool path can execute in another user's runtime session; the direct HTTP
  path enforces ownership, but the tool path does not.
- The UI "resume" action calls the execute endpoint instead of the resume endpoint;
  a paused mission cannot be resumed from the UI.
- Mission reasoning is always deterministic; the optional model provider is exposed
  only through an unused `/problems/reason` endpoint.
- There are two parallel agent-skill systems (legacy Mongo `/api/agents/:id/skills`
  and the new SQLite extensions system).

**Do not merge or deploy this stack as-is.** The subsystem is a strong foundation, but
the P1 items below must be fixed and the deployment must be exercised before the
Definition of Done can be claimed.

## 2. Scope and ancestry

The current branch is a four-PR stack:

| PR | Head | Base | State | Scope |
| --- | --- | --- | --- | --- |
| #9 | `feat/wora-complete-integration` (`f2e44e0`) | `main` | Draft | Extensions ecosystem, design system, technical workspace |
| #10 | `feat/wora-experience-redesign` (`1a0f8b8`) | #9 | Draft | UX architecture and static prototype; not production UI |
| #11 | `feat/wora-production-workspace` (`fb425b6`) | #10 | Open | Real API-driven five-zone workspace |
| #12 | `feat/wora-cloud-computer-browser` (`750717a`) | #11 | Open | Cloud computer, browser automation, Docker runtime |

Ancestry is linear: `main` → `#9` → `#10` → `#11` → `#12`. Cumulative diff against
`main`: **336 files, +44,679 / −780**. There are no merge conflicts reported by GitHub.
PRs #9 and #10 are still drafts, so the stack cannot land through the normal review path
until they are marked ready.

PR #10 is explicitly a static prototype and review packet; it does not change production
UI/API/database. PR #11 replaces that prototype with the real workspace. The current
branch therefore contains both the production workspace and the unused prototype files.

## 3. What is real and verified

These are implemented and exercised by the test suite or by direct inspection, not
just documented:

- SQLite OS core with versioned migrations 1–17, workspace-scoped missions, agents,
  memory, plans, leases, approvals, evidence, verifications, lessons, and artifacts.
- Extension schema with marketplaces, packages, versions, installations, dependency
  graph, agent policies, registered tools, MCP servers, secrets, audit logs, capability
  snapshots, and skill contexts. All are workspace-scoped and use foreign keys where
  applicable.
- Git marketplace preview/registration/sync for HTTPS and allow-listed local repositories.
  Manifests are parsed as inert data; unknown fields are rejected; invalid manifests are
  skipped; published content changes are detected by checksum; installed versions are not
  silently replaced.
- Skill and plugin manifests with schema version, permissions, dependencies, scope,
  compatibility, requirements, verification, failure handling, handoff, and security
  metadata. Lifecycle hooks are recorded but never executed.
- Dependency resolution with missing/conflicting/circular dependency reporting, install
  previews, update, rollback, uninstall cleanup, and dependents protection.
- Agent capability resolution with global defaults, agent policies, scopes, denied
  packages/tools/permissions, explicit approval, capability snapshots, and skill context
  budgeting.
- Plugin tool registration and execution through the existing tool registry, including
  input validation, permission checks, timeouts, HTTP hardening, MCP stdio/http support,
  health checks, and audit records.
- Secret encryption at rest with AES-256-GCM, workspace/name/purpose AAD binding, key
  IDs, legacy migration, rotation, dry-run, and metadata-only HTTP responses.
- SSRF protection with DNS resolution, private/loopback/link-local/metadata blocking,
  redirect revalidation, pinned connections, bounded responses, and a browser proxy.
- Approval binding to action class, payload digest, scope, expiry, and single-use
  consumption; high-risk tools cannot bypass it at the tool boundary.
- Production workspace zones (Brief, Run, Library, Capabilities, System) reading and
  writing real OS APIs, with Arabic RTL default and complete English LTR.
- Real mission execution, task leases, worker recovery, checkpoints, approval waits,
  independent verification, and evidence. The mission e2e completed with
  `WORA_TEST_STAGE` checkpoints through `after-task-completed`.
- Cloud computer and browser implementations for Docker and a development-only process
  fallback. Docker paths are implemented but were not run in this environment.

## 4. Findings

Severity is about production impact. P1 items are release blockers. P2 items are
material defects or integration gaps. P3 items are smaller correctness/quality issues.

### P1 — Production deployment cannot run the headline runtime

Evidence:

- `api-server/Dockerfile` is a plain `node:22-alpine` runner. It copies `dist`,
  `node_modules`, and `package.json`; it never installs `git` or the Docker CLI.
- `docker-compose.prod.yml` mounts no Docker socket and defines no browser runtime
  service or browser image. The only services are Redis, API, client, Nginx, and an
  optional Redis UI.
- `api-server/src/extensions/git.ts` shells out to `git` for marketplace fetches.
- `api-server/src/runtime/providers.ts` and `browser-docker.ts` shell out to `docker`.
- The compose API environment does not pass `WORA_BROWSER_*`, `WORA_CLOUD_*`,
  `WORA_MCP_STDIO_MODE`, `WORA_EXTENSIONS_LOCAL_ROOTS`, or `WORA_SECRET_KEYS`.

Impact:

- Git marketplace registration/sync will fail in the supplied API image because `git`
  is not present.
- Cloud computer and browser sessions cannot start: Docker is unavailable, the browser
  image is not built, and the API cannot reach a Docker daemon.
- The bundled official MCP reference plugin (`wora.echo-mcp`) cannot run by default
  because stdio MCP is disabled unless `WORA_MCP_STDIO_MODE=official` is set.
- Private marketplace credentials and plugin secrets cannot be written because the
  production keyring is not configured. Direct reproduction with a missing key file:

  ```text
  {"error":"No managed secret keyring is configured; set WORA_SECRET_KEYS, WORA_SECRET_KEY or WORA_SECRET_KEY_FILE"}
  ```

- `nginx/nginx.conf` uses `proxy_read_timeout 30s` for `/api/`. `POST
  /api/os/missions/:id/execute` and `/resume` await `executeMission`, which can exceed
  30 seconds for real tools. Nginx will return 504 while the mission may still be
  running. The async `POST /missions` path is safe because it returns 202.

This is the largest gap between PR #12's claims and the deployment that ships with it.

### P1 — Agent tool path bypasses runtime session ownership

Evidence:

- `api-server/src/runtime/tools.ts:40-68`: `ensureComputer`, `ensureRuntimeSession`,
  and `ensureBrowser` look up a session only by `workspaceId` and `sessionId`. They do
  not compare `session.createdBy` with `ctx.actor`.
- `api-server/src/runtime/cloud.ts:201-215`: `execComputer` accepts any running
  workspace session. `writeSessionFile` and `readSessionFile` follow the same pattern.
- `api-server/src/runtime/browser.ts:300-345`: browser actions and file access use the
  same workspace-only lookup.
- The direct HTTP route does enforce ownership:
  `api-server/src/os/router.ts` uses `canControlSession` (creator or admin) for
  `/runtime/sessions/:id/*`.

Reproduction (development process provider, no Docker):

```text
{"owner":"alice","caller":"bob","ok":true,"stdout":"cross-user-exec"}
```

The session was created by `alice`; `bob` executed `cloud.exec` with the session ID and
the call succeeded. This also applies to browser actions, file read/write, and stop.
An agent assigned `runtime:execute` or `browser:*` can therefore reach another user's
session if it learns the ID. The workspace runtime list exposes those IDs to members.

Required direction: enforce the same `createdBy`/admin check in the tool path (or in
`requireRunningSession`/`action`), and pass the actor through every runtime tool.

### P1 — UI resume does not resume a paused mission

Evidence:

- `client/src/os/api.ts:381` defines `resumeMission` as `POST /missions/:id/execute`.
- `api-server/src/os/orchestrator.ts:682` and `:717` make `executeMission` return
  immediately when the mission is `paused`.
- The server has a real resume operation at `api-server/src/os/orchestrator.ts:1473`
  and a route `POST /missions/:id/resume`, but the client never calls it.
- `client/src/workspace/RunZone.tsx:249` and
  `client/src/components/ExecutionCenter.tsx:347` both use the broken client method.

Reproduction:

```text
{"before":"paused","afterExecute":"paused","afterResume":"completed"}
```

The first execute is exactly what the UI sends. The mission stays paused. The second
sequence explicitly calls `resumeMission` on the server and then executes, and it
completes. The existing API test "pause, resume, cancel..." tests the server route, not
the client contract, which is why this was missed.

### P1 — Mission "Agent Brain" is deterministic, not model-driven

Evidence:

- `api-server/src/os/orchestrator.ts:524` always calls `buildDeterministicReasoning`
  during mission creation.
- The optional model path is `analyzeProblemReasoning`, exposed only through
  `POST /api/os/problems/reason` with `useModel: true`
  (`api-server/src/os/router.ts:751-785`).
- No client code calls `reasonProblem`; the workspace displays the persisted
  deterministic reasoning.
- `client/src/components/ExtensionsHub.tsx:588` marks "Agent Brain" available whenever
  agents exist, regardless of whether any model provider is configured or used.

Impact: WORA is an execution platform with deterministic planning, not an LLM-driven
agent brain in the mission path. This is acceptable as an explicit design choice, but
the UI claim and the PR narrative overstate it. It should either be wired into mission
creation (with deterministic checks remaining authoritative) or described as
deterministic.

### P1 — Two parallel skill systems remain mounted

Evidence:

- New system: SQLite tables `ext_*`, `/api/os/extensions`, `client/src/components/
  ExtensionsHub.tsx`, `AgentCapabilitiesDialog`.
- Legacy system: Mongo-backed `/api/agents/:agentId/skills`
  (`api-server/src/wora-server.ts:667`, `api-server/src/skills/router.ts`) and the
  always-mounted `AgentSkillsDialog` (`client/src/App.tsx:212`).
- The legacy dialog is still reachable through the legacy office/agent surface, while
  the new capability assignment lives in the OS workspace.

Impact: two skill catalogs, two permission/assignment models, and two UIs. A user can
change one and see no effect in the other. This is an integration-coherence defect, not
just dead code. The legacy system should be removed, redirected to the new system, or
explicitly isolated as a legacy feature.

### P1 — Scope targets are not validated against the actor

Evidence:

- `installSchema` accepts any `scope` and `scopeId` with only a length limit
  (`api-server/src/extensions/router.ts:64-70`).
- `POST /packages/:id/install` requires `member` and only escalates to `admin` for
  high-risk plugin approval (`:405-425`). A member can install a low-risk package at
  `instance` scope, or at a `project`/`user`/`agent` scope with an arbitrary ID.
- `PUT /agents/:agentId/policy` requires `member`; only `extraPermissions` requires
  admin (`:678-690`). A member can set `projectIds` and `organizationId` arbitrarily.
- `marketplace` scope is stored but not used to constrain package visibility.

Impact: a member can install or assign a package for the whole instance or for another
project/user without an admin decision. Low-risk instructions are not code, but this
breaks the intended scope/isolation policy. Instance-scope changes should be admin-only,
and scope IDs should be validated against the workspace's projects/users/agents.

### P1 — No functional UI for cloud computer or browser commands

Evidence:

- `client/src/components/RuntimePanel.tsx:100-116` only starts/stops sessions and lists
  sessions/artifacts.
- `TerminalPage` is explicitly read-only; there is no command input or exec action in
  the UI.
- Browser start is exposed, but there is no URL/open/click/type control in the client;
  browser actions exist only in API/agent tools.
- The runtime e2e test drives browser actions through the API, not through the UI.

Impact: a user can start a cloud computer or browser but cannot use it from the
workspace. The API/agent path works, but the product surface promised by the "cloud
computer" and "browser automation" PR is incomplete.

### P2 — Marketplace auto-load is stored but never acted on

- `api-server/src/extensions/marketplace.ts:132` stores `autoLoad`.
- No sync path reads `marketplace.autoLoad` to load approved metadata or eligible
  capabilities. `applySnapshot` only discovers/upserts packages.
- Installation auto-load is used for skill selection
  (`api-server/src/extensions/capabilities.ts:160`,
  `api-server/src/extensions/skill-intelligence.ts:128`) but plugin auto-load is not
  used to decide whether a plugin is initialized; enabled approved plugins are included
  regardless (`capabilities.ts:193-199`).
- The UI exposes marketplace auto-load and a per-package auto-load hint, so the setting
  appears functional.

### P2 — Update/rollback do not refresh the dependency graph

- `POST /installations/:id/update` builds a plan but applies only a version update
  (`api-server/src/extensions/router.ts:520-534`); it does not call `applyInstallPlan`
  or replace `ext_installation_deps`.
- Rollback has the same shape.
- A new version with new dependencies can be installed without those dependencies being
  installed, and an old dependency can remain after it is no longer needed.

### P2 — Seeded agents advertise tools they cannot execute

Direct check against the seeded registry:

```json
[
  {
    "agent": "Research Agent",
    "specialization": "research",
    "missing": ["browser.research:missing browser:interact"]
  },
  {
    "agent": "System Administrator",
    "specialization": "system_administrator",
    "missing": ["fs.workspace_list:missing workspace:read"]
  }
]
```

These are default seed definitions (`api-server/src/os/specializations.ts`). The tool
registry test only checks that advertised tools exist; it does not check that the
agent's permissions satisfy every advertised tool. Either add the permissions or remove
the tools from the seed.

### P2 — Legacy `/api/agents` roster is unauthenticated

`api-server/src/wora-server.ts:757-771` exposes `GET /api/agents` with no session or
workspace check. It returns the active Mongo agent roster, including `profile`,
`brainConfig` (public form), status, and zone. It does not expose private keys, but it
is a cross-workspace information leak in a multi-tenant deployment. The OS has its own
workspace-scoped `/api/os/agents`.

### P2 — Runtime sessions started from the workspace are orphaned

- `client/src/runtime/api.ts:70` starts a session with only `{ kind, ttlMinutes }`.
- `client/src/components/RuntimePanel.tsx:101-102` calls it from a mission-scoped panel.
- The server creates the session with `missionId: undefined`
  (`api-server/src/os/router.ts:1163-1165`).
- The Run panel filters sessions/artifacts by the selected mission, so a session started
  there is not visible in that panel, is not cleaned up by mission finalization, and can
  consume the workspace session limit.

The UI should pass the mission/task IDs, or the server should associate the session
with the current mission when started from a mission context.

### P2 — Runtime TTL cleanup is request-driven only

`expireRuntimeSessions`/`expireBrowserSessions` are called from `/runtime/status`.
There is no periodic sweeper. A session whose UI is closed can keep a container/process
alive until the next status request or process restart. The Docker `--rm` and boot
cleanup reduce the window, but the contract is not enforced.

### P2 — Extension schema is not versioned like the OS schema

The OS has versioned migrations 1–17 with a registry and rollback policy
(`api-server/src/os/migrations.ts`). The extensions schema is a separate
`CREATE TABLE IF NOT EXISTS` block plus ad-hoc `ALTER TABLE` helpers
(`api-server/src/extensions/schema.ts:240-250`). It has no extension migration version,
no rollback record, and no reconciliation for future column/table changes. The
requirement for versioned migrations is only met for the OS tables.

### P2 — MCP stdio is not a real sandbox and is disabled by default

- `api-server/src/extensions/sandbox.ts` uses `prlimit` for CPU/address-space/file/PID
  limits and runs in a private temp home, but it does not isolate the filesystem or
  network. The module documents this limitation.
- `api-server/src/extensions/mcp.ts` only starts stdio for `official` trust and only
  when `WORA_MCP_STDIO_MODE=official`; default is disabled.
- The bundled echo MCP is stdio, so the only built-in plugin is unavailable by default
  in production.

HTTP MCP and HTTP plugin tools are available and tested. This is a documented partial
implementation, not a complete sandbox.

### P2 — Browser container hardening is weaker than the cloud container

`browserContainerSecurityArgs` in `api-server/src/runtime/browser-docker.ts` uses
`--read-only`, `--cap-drop ALL`, memory/PID/CPU limits, an internal network, and a
non-root user. `--security-opt no-new-privileges` is added only in `container`
sandbox mode; the default Chromium-sandbox mode relies on Chromium's own sandbox and
does not add that container flag. The browser is isolated at the container/network
level, but it is not equivalent to the cloud computer's hardening. This should be
reviewed against the threat model before production.

### P2 — Marketplace sync reports the wrong removed count

`applySnapshot` computes `removed` from `markMissingPackages` but returns only
`added`/`changed`/`warnings`. `syncMarketplace` then computes
`removed = snapshot.files.length - added - changed`
(`api-server/src/extensions/marketplace.ts:205-215`). That is the number of files that
were invalid, duplicate, or skipped, not the number of packages removed. The sync log
can misreport removals.

### P2 — UI capability status is optimistic

- `ExtensionsHub` marks Agent Brain available from agent count only
  (`:588`), not from a configured/used model provider.
- Browser automation is marked available whenever the browser is available, even when
  it is the non-isolated process provider; the runtime panel marks the same state
  partial.
- Long-running work is marked partial whenever `/runtime/status` responds, without
  checking whether an opt-in worker is actually running. The compose file has no worker
  service; crash recovery depends on an operator starting one.

These are status/claim problems rather than execution bugs, but they affect operator
trust.

### P2 — Secret and session edge cases

- `readSessionFile` does `statSync` then `readFileSync` without `O_NOFOLLOW`; a
  concurrent symlink swap in a writable session directory can cause a read outside the
  intended path. This is local-FS TOCTOU, not a remote primitive, but it should be
  hardened with `O_NOFOLLOW`/`fstat` on an opened descriptor.
- `dockerProvider.exec` checks `cwd.startsWith('/workspace/')` but not
  `cwd === '/workspace'`; a caller asking for `/workspace` gets the default `/workspace`.
  Minor.
- Session count enforcement is a check-then-create without a transaction; concurrent
  starts can exceed the limit. Low impact.
- Financial browser approvals default to a zero budget when no amount is extracted;
  an approval that should carry an amount can fail closed. Safe, but it needs operator
  configuration or a better amount extractor.

### P2 — Production auth/startup checks are incomplete

`AUTH_SECRET` is required for `/api/os` and session verification, but the API process
starts even when it is absent; `/api/os` returns 503 and the health endpoint may still
be reachable. The compose file requires `AUTH_SECRET`, but the API image has no startup
validation for `WORA_SECRET_KEYS` or runtime providers. A fail-fast startup check would
turn a late 500/503 into a clear deployment error.

### P3 — Smaller issues

- `nginx.conf` has no Content-Security-Policy or Permissions-Policy. The static client
  sets X-Frame-Options and nosniff, but CSP is missing.
- `server_name your-domain.com` is a placeholder in the production Nginx config.
- `GET /runtime/status` performs expiry side effects; a GET should be safe/idempotent
  from the caller's perspective. It is tolerable but surprising.
- `browser-runner` masks only password fields in screenshots; payment/card fields are
  protected by the financial action classifier, not by screenshot masking.
- `ext_marketplaces.scope`/`scope_id` are stored but not used to constrain package
  visibility or sync.
- `POST /packages/create` returns 501 for `publish: true`; the UI correctly says
  publishing is unsupported. This is an honest limitation, not a fake control, but it
  means "publish to an authorized marketplace" from the product brief is not delivered.
- The create-package dialog supports manifest JSON from scratch, not importing a
  package directory from a repository. Marketplace registration covers repository
  discovery, but the create workflow's "import from repository" is absent.
- `ext_secrets` rows are not deleted on package uninstall; they remain workspace-level
  credentials. This may be intentional (shared credentials), but it is not "uninstall
  cleanup" in the strict sense.

## 5. Definition-of-Done flow matrix

| Step | Status | Evidence / gap |
| --- | --- | --- |
| 1. Register a Git marketplace | Pass in tests | API test uses a real local Git repo; production image lacks `git` |
| 2. Synchronize it | Pass in tests | Change detection, invalid manifests, removals tested; production blocked by `git` |
| 3. Discover a Skill and Plugin | Pass | Marketplace preview/discovery tests |
| 4. Inspect manifests and permissions | Pass | Manifest validation, permission sensitivity, UI details |
| 5. Install them | Pass | Install plan, approval, dependency tests |
| 6. Assign them to a specialized Agent | Pass | Capability scope tests and UI dialog |
| 7. Start a real task | Pass | Mission e2e, production workspace e2e |
| 8. Resolve the Agent's capabilities | Pass | `resolveAndSnapshot`, capability tests |
| 9. Load the assigned Skill | Pass | "selected skill changes real execution output" test |
| 10. Initialize the authorized Plugin | Pass in test env | Echo MCP test with official stdio; default production config does not enable it |
| 11. Discover and execute an authorized tool | Pass | MCP/HTTP plugin tests; tool authorization tests |
| 12. Record execution and audit data | Pass | Runtime/tool/extension audit tests |
| 13. Verify the task result | Pass with limits | Independent verification; outcome can remain partially verified |
| 14. Disable the Plugin and verify access is revoked | Pass | API and UI e2e revocation tests |
| 15. Update or uninstall a package safely | Pass | Update/rollback/uninstall tests; dependency refresh gap |

The subsystem flow is real in the test environment. The production deployment flow is
not demonstrated because of the P1 deployment gaps.

## 6. Tests, type checks and builds

### API

```text
tests 408
pass 404
fail 0
skipped 4
duration_ms 40978.811123
```

Skipped tests:

- `real Docker cloud computer: create, exec, files, isolation, limits and cleanup`
- `real Docker browser: internal network, proxy-only page access, screenshot and cleanup`
- `secure Chromium sandbox mode fails closed when the host cannot provide it`
- `MongoDB persists revisions, isolates workspaces, and deduplicates concurrent imports`

The Docker skips are because `/var/run/docker.sock` is not available in this
environment. The Mongo skip is because no MongoDB service is available. These paths
were inspected statically but not executed live.

### Client

```text
tests 66
pass 66
fail 0
skipped 0
```

The client suite includes the real API-driven production workspace e2e, which exercises
Brief launch, Run pause/resume/cancel/replan, approval, artifact download, Library
memory, Capabilities install/assign/execute/disable/uninstall, and System diagnostics.

### Type checks and builds

```text
api-server: npm run typecheck  -> exit 0
api-server: npm run build      -> exit 0
client:     npm run typecheck  -> exit 0
client:     npm run build      -> exit 0
```

The API build emits a 1.2 MB `index.mjs` warning. The client build emits a 576 KB
`three` chunk warning. Neither is a failure.

### Manual browser checks

Using the real client at 390×844 against the preview API:

- Brief, Run, Library, Capabilities, System: `scrollWidth - innerWidth = 0` on every
  route; no horizontal overflow.
- `dir=rtl`, `lang=ar` by default.
- Theme toggle sets `data-theme=dark` and body background `rgb(17, 17, 19)`.
- Language toggle sets `dir=ltr`, `lang=en`.
- No page errors or console errors (excluding favicon/socket noise).

This verifies the responsive/RTL/theme claims for the routes tested. It does not replace
a full accessibility audit.

### Manual mission and security checks

- Mission e2e: `WORA_TEST_STAGE` checkpoints reached `after-start-checkpoint`,
  `after-verification`, `after-completed-checkpoint`, `after-handoff`,
  `after-task-completed`; mission completed, outcome partially verified (expected).
- Resume: `{"before":"paused","afterExecute":"paused","afterResume":"completed"}`.
- Cross-user runtime session: `{"owner":"alice","caller":"bob","ok":true,
  "stdout":"cross-user-exec"}`.
- Production secret write without a keyring:
  `No managed secret keyring is configured; set WORA_SECRET_KEYS, WORA_SECRET_KEY or
  WORA_SECRET_KEY_FILE`.

## 7. Exact manual configuration still required

These are not optional if the full PR #12 product is expected in production:

1. **Secret keyring**: set `WORA_SECRET_KEYS` (JSON keyring) or
   `WORA_SECRET_KEY_FILE` with a 32-byte base64 key, mode `0600`; pass it through
   `docker-compose.prod.yml`. Without it, all extension secret writes fail.
2. **Git in the API image**: install `git` in `api-server/Dockerfile` (or use a base
   image that includes it) and rebuild. Otherwise marketplace sync cannot run.
3. **Docker runtime**: mount `/var/run/docker.sock`, install the Docker CLI in the API
   image, build the browser image, add a browser runtime service/network, and set
   `WORA_CLOUD_PROVIDER=docker` and `WORA_BROWSER_PROVIDER=docker`. Without these,
   cloud computer and browser are unavailable.
4. **MCP stdio**: set `WORA_MCP_STDIO_MODE=official` to enable the bundled echo MCP;
   install `prlimit` if resource limits are expected. HTTP MCP/HTTP plugins work
   without this.
5. **Local marketplaces**: set `WORA_EXTENSIONS_LOCAL_ROOTS` only if local paths are
   intentionally allowed; HTTPS Git remains the normal path.
6. **Reasoning provider**: setting `WORA_REASONING_PROVIDER` and a key is not enough to
   make mission reasoning model-driven; the mission path does not call the provider.
   A code change is required if that is the intended behavior.
7. **Nginx timeout**: raise `proxy_read_timeout` for `/api/os/missions/*/execute` and
   `/resume`, or use the async execute path consistently. The current 30s limit can
   504 long missions.
8. **Legacy stack**: `MONGO_URI`, `REDIS_URL`, `AUTH_SECRET`, `ALLOWED_ORIGINS`,
   `ADMIN_API_KEY`, and provider keys are still required for the legacy `/api/agents`
   roster, socket rooms, and the AI queue. The OS itself uses SQLite and does not need
   Mongo for missions.
9. **Worker**: no worker service is in compose. Long-running/crash-recovery claims
   require an operator to run `os-worker` with `WORA_OS_ROLE=worker` (and the same
   SQLite volume).

## 8. Known limitations of this audit

- Docker daemon was unavailable, so real container creation, browser networking,
  screenshot cleanup, and cloud isolation were not executed live. Three Docker tests
  skipped.
- MongoDB was unavailable, so the legacy skill import/store path was not executed live.
- No external model provider was called; the model-assisted reasoning path and BYOK
  model routing were not exercised.
- No production compose stack was run; deployment findings are static analysis of the
  Dockerfile, compose file, Nginx config, and code paths.
- No real private Git repository was used; the tests use local Git repositories and
  mocked HTTP services.
- The audit did not perform a full accessibility audit, load test, or penetration test.

## 9. Files and commits

- Audited HEAD: `750717a` on `feat/wora-cloud-computer-browser`.
- No product code was modified.
- This report is the only new file:
  `docs/audits/FINAL-INTEGRATION-AUDIT.md`.
- The working tree was clean before this report was written.
- No merge, push, deployment, or force-push was performed.

## 10. Recommended order of remediation

1. Fix the runtime session ownership bypass in the tool path and add a regression test
   that creates a session as one actor and attempts `cloud.exec`/browser actions as
   another.
2. Fix `client/src/os/api.ts` to call `/missions/:id/resume` (or add a server endpoint
   that resumes and executes), and add a client-level regression test for paused
   missions.
3. Make the deployment honest: add `git` and Docker runtime support to the API image
   and compose, or explicitly disable PR #12 features in the production profile and
   document that they are unavailable. Add the secret keyring and startup validation.
4. Remove or redirect the legacy `AgentSkillsDialog` and `/api/agents/:id/skills` so
   there is one skill system.
5. Decide whether "Agent Brain" means deterministic planning or model-assisted
   reasoning; wire the provider into the mission path if the latter, and make the UI
   status reflect the actual mode.
6. Validate scope targets and make instance-scope installation admin-only; add
   project/user/agent membership checks.
7. Implement auto-load semantics and dependency refresh on update/rollback, or remove
   the UI controls that imply they work.
8. Add the worker service or remove long-running/crash-recovery claims from the
   production profile.
9. Add a real cloud/browser command UI if the product is expected to expose those
   capabilities to operators, not only to agents.
10. Then rerun the full API/client suites, the Docker tests on a Docker-capable host,
    the Mongo tests on a Mongo-capable host, and a production compose smoke test.
