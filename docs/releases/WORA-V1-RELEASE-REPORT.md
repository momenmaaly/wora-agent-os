# WORA V1 — Release Candidate Report

**Branch:** `release/wora-v1` (based on `main` at `a1ca08c`)
**Consolidation:** PR #9 → #10 → #11 → #12 → #13 merged in order
**PR #13 head merged:** `f76d14ded648b3f75b4ab46b93ede91774e5b647`
**Release candidate head before this report:** `34d22e8`
**Status:** tested release candidate; not merged, not deployed, not tagged.

## 1. Repository findings reused

- Existing Agent Core, 18-agent registry, mission orchestrator, handoff contracts, review gates and durable task leases were reused.
- Existing SQLite OS store (`os-data`), migrations and single-writer lease were reused; no second database was created.
- Existing Tool Registry, permissions, approvals, audit events, extension scope authorization and secret keyring were reused.
- Existing Skills/Plugins/Marketplaces, MCP and agent capability assignment APIs and UI were reused.
- Existing cloud-computer and browser runtime providers, artifacts, screenshots and research documents were reused.
- Existing Node 22/24 CI matrix, API tests and Playwright client journeys were extended.

## 2. Release V1 changes

### Execution boundary

- Added production runtime validation in `api-server/src/lib/config.ts` and `api-server/src/runtime/readiness.ts`.
- Production now fails fast unless:
  - `WORA_CLOUD_PROVIDER=docker` and `WORA_BROWSER_PROVIDER=docker`;
  - the process provider override is absent;
  - `DOCKER_HOST` is the dedicated runtime endpoint with TLS (the host socket requires an explicit `WORA_ALLOW_HOST_DOCKER_SOCKET=1` escape hatch);
  - `WORA_RUNTIME_ROOT` is absolute and writable;
  - `WORA_OS_DB` is file-backed;
  - a managed secret keyring is configured;
  - Git, the Docker runtime and the isolated browser probe succeed.
- `/ready` now reports runtime and browser readiness. `/health` remains liveness-only.

### Isolated runtime deployment

- Added `runtime-docker` (dedicated privileged DinD), `runtime-bootstrap` (builds the pinned browser image inside that daemon), `keyring-init` (0600 keyring once) and `os-worker` (durable worker) to `docker-compose.prod.yml`.
- The API receives only the TLS Docker endpoint; it does not mount the host socket.
- Added a shared `runtime-data` volume so API, worker and runtime daemon see session workspaces and artifacts.
- Added `DOCKER_HOST`, TLS settings and `WORA_OS_WORKSPACE_ID` to `.env.example`.
- Added Docker CLI, Git, util-linux and the browser Dockerfile to the API image.

### Browser proxy

- Production browser proxy now listens on a per-session Unix socket in the shared runtime volume.
- The browser container mounts only that session directory and bridges the socket to Chromium on loopback.
- This removes the previous Docker-bridge-gateway assumption, which cannot work with a dedicated DinD runtime.
- Added a real Unix-socket proxy test; existing SSRF, DNS-rebinding, redirect, Host-header, subnet and WebSocket tests remain green.

### Runtime authorization hardening

- `listComputerSessions`, `listBrowserSessions`, `listRuntimeArtifacts` and `runtimeSessionsForWorkspace`/`runtimeArtifactsForWorkspace` now require an actor and filter by runtime ownership.
- Internal cleanup paths use an explicit `internal: true` bypass.
- `ensureBrowser` now reuses only a browser session visible to the current actor.
- Added cross-user list assertions for computer sessions, browser sessions and artifacts.

### Operations

- Nginx now allows long-running OS/runtime requests (600s for `/api/os/...`, 300s for other API calls) and bounds request bodies.
- Added `docs/releases/WORA-V1-DEPLOYMENT.md` with prerequisites, startup order, readiness checks, backup/restore, rollback and limitations.

## 3. Acceptance journeys

| Journey | Evidence | Status |
| --- | --- | --- |
| Mission creation, plan, execution, evidence, lessons, benchmarks | `client/tests/browser-e2e.test.mjs` | passed |
| Pause → resume → cancel; retry and checkpoint recovery | API OS tests + `browser-e2e` | passed |
| Agent handoff and evidence/verification | `api-server/src/runtime/runtime.test.ts`, OS orchestrator tests | passed |
| Cloud computer start → command → file write/read → artifact → stop | `runtime.test.ts` process-provider path; Docker path present in `runtime-docker.test.ts` | process passed; Docker skipped locally |
| Browser start → open → inspect → screenshot → close | `runtime.test.ts` real Chromium child; Docker path in `runtime-docker.test.ts` | process passed; Docker skipped locally |
| Skill/plugin install → assign → execute tool → disable → revoke → uninstall | `client/tests/production-workspace.test.mjs` | passed |
| Arabic RTL and English LTR on mobile without horizontal overflow | new `client/tests/mobile-i18n.test.mjs` (390×844) | passed |

## 4. Exact test results

Run in this worktree on 2026-11-26.

### Node 24.22.2

- API: `npm test` → **413 tests, 409 pass, 0 fail, 4 skipped, 42.9s**.
- Client: `npm test` → **67 tests, 67 pass, 0 fail, 15.5s**.
- API `npm run typecheck` → exit 0.
- API `npm run build` → exit 0 (`dist/index.mjs`, `dist/seed.mjs`, `dist/issue-session.mjs`, `dist/os-worker.mjs`, `dist/browser-runner.mjs`, `dist/init-keyring.mjs`).
- Client `npm run typecheck` → exit 0.
- Client `npm run build` → exit 0 (Vite production bundle).

### Node 22.23.5

- API: `npm test` → **413 tests, 409 pass, 0 fail, 4 skipped, 48.0s**.
- Client: `npm test` → **67 tests, 67 pass, 0 fail, 16.9s**.
- API typecheck/build → exit 0.
- Client typecheck/build → exit 0.

### Skipped / not passed

The 4 API skips are environment-backed integration tests. They are **not
counted as passed**:

- `real Docker cloud computer: create, exec, files, isolation, limits and cleanup` — no Docker daemon.
- `real Docker browser: internal network, proxy-only page access, screenshot and cleanup` — no Docker daemon.
- `secure Chromium sandbox mode fails closed when the host cannot provide it` — host sandbox probe is unavailable.
- `MongoDB persists revisions, isolates workspaces, and deduplicates concurrent imports` — no MongoDB/`mongosh`.

Docker Compose, nginx TLS, MongoDB, Redis and a real Chromium sandbox were not
started in this environment. The compose file was parsed as YAML and its
services/volumes/networks were checked, but `docker compose config`/`up` and a
live container start were not executed. Do not claim live production readiness
until the deployment-host checks in `docs/releases/WORA-V1-DEPLOYMENT.md` pass.

## 5. Security controls verified

- API runtime access requires authenticated actor ownership or a permitted
  workspace role; cross-user list/read/stop/artifact access is rejected.
- Extension installation scope authorization remains enforced.
- Production refuses process runtime/browser providers and insecure Docker
  endpoints; it never mounts the host Docker socket in the API service.
- Keyring creation is 0600 and idempotent; no key material is printed.
- Browser proxy remains SSRF-hardened and now has no open TCP listener in
  production.
- Secrets remain redacted from runtime events, logs and browser child env.
- High-risk financial browser actions remain payload-bound, single-use and
  audited.

## 6. Known limitations / blockers

1. **Docker runtime not live-tested here.** Docker is unavailable in this
   environment. `runtime-docker.test.ts` remains skipped. Run it on the
   deployment host before production sign-off.
2. **MongoDB/Redis not live-tested here.** Mongo-backed tests are skipped. The
   compose deployment requires both.
3. **No project-level ACL entity.** Project capability rows exist, but runtime
   isolation is workspace/agent-scoped; project-level authorization remains a
   product limitation.
4. **SQLite single writer.** One API replica and one worker per database. No
   PostgreSQL adapter, distributed mission lease or horizontal scheduler.
5. **No full graphical desktop control.** The cloud computer is command/file
   execution; browser control is Chromium automation. Do not describe it as a
   general remote desktop.
6. **No autonomous continuous work beyond queued/resumable missions.** The
   worker resumes failed missions; it is not an always-on proactive scheduler.
7. **Model/provider availability is external.** Provider-independent routing and
   usage visibility exist, but no provider keys or paid services are included.
8. **Chromium sandbox requires host support.** The runtime fails closed if the
   probe fails; container-only mode is not equivalent.

## 7. Exact manual configuration still required

- Set `AUTH_SECRET`, `ADMIN_API_KEY`, `MONGO_URI`, `REDIS_PASSWORD`,
  `ALLOWED_ORIGINS` and `WORA_OS_WORKSPACE_ID`.
- Provide a public DNS name and nginx TLS certificate/key.
- Provide a Docker host capable of privileged DinD (or an equivalent dedicated
  TLS Docker runtime endpoint).
- Ensure the host permits Chromium's user-namespace/setuid sandbox.
- Ensure `runtime-docker` can pull `node:22-alpine` or replace
  `WORA_CLOUD_IMAGE` with an internal registry image.
- Back up the generated keyring separately from the SQLite volume.
- Run `docker compose -f docker-compose.prod.yml build` and `up -d` on the
  deployment host; then run `node dist/seed.mjs` once.
- Run the skipped Docker and Mongo integration tests on that host.

## 8. Changed files

- `.env.example`
- `README.md`
- `api-server/Dockerfile`
- `api-server/package.json`
- `api-server/src/lib/config.ts`, `config.test.ts`
- `api-server/src/os/orchestrator.ts`
- `api-server/src/runtime/browser.ts`, `browser-docker.ts`, `browser-proxy.ts`,
  `browser-proxy.test.ts`, `browser-runner.ts`, `cloud.ts`, `tools.ts`,
  `runtime.test.ts`, new `readiness.ts`
- `api-server/src/scripts/init-keyring.ts` (new)
- `api-server/src/wora-server.ts`
- `client/tests/mobile-i18n.test.mjs` (new)
- `docker-compose.prod.yml`
- `nginx/nginx.conf`
- `docs/releases/WORA-V1-DEPLOYMENT.md` (new)
- `docs/releases/WORA-V1-RELEASE-REPORT.md` (new)

## 9. Release state

- No merge to `main`, no deployment, no tag, no force-push.
- PR #13 remains the security-remediation PR in the stacked chain; the
  consolidated branch is `release/wora-v1`.
- Observed GitHub stack state at report time: #9 open/draft, #10 open/draft,
  #11 open/non-draft, #12 open/non-draft, #13 open/draft; all five report
  `mergeable: true` and target their intended predecessor branches.
- The next action is a final review of the release candidate and a PR from
  `release/wora-v1` to `main`, only after the deployment-host checks above.
