# WORA — Phase 1: Critical Security & Mission Correctness Remediation

Date: 2026-11-23
Branch: `fix/phase-1-security-remediation`
Baseline: PR #12 head `750717aa4d440a762df05c76a7a233d241e82a38`
Remediation code/test commit: `6ea6357fd954b2d971af05c3ced45cb89d2c3e1b`
PR target: `feat/wora-cloud-computer-browser` (PR #12 branch), not `main`

## 1. Scope and safety

This phase changed only runtime authorization, extension scope authorization, the
mission resume client contract, the legacy agent roster endpoint, and their tests.
No production infrastructure, deployment, merge, force-push, or `main` change was made.

## 2. P0 — Runtime session ownership

### Vulnerable paths fixed

The audit reproduction used a session created by `alice` and executed by `bob`:

```text
{"owner":"alice","caller":"bob","ok":true,"stdout":"cross-user-exec"}
```

The tool path looked sessions up by workspace and session ID only. The direct HTTP
path checked ownership, but the agent tool path, the session detail route, session
lists, and artifact routes did not consistently do so.

New authorization module: `api-server/src/runtime/auth.ts`.

Every user-facing runtime entry point now passes the authenticated actor through
`assertRuntimeSessionAccess` / `canAccessRuntimeSession`:

| Path | Before | After |
| --- | --- | --- |
| `ensureComputer` | workspace/session only | actor ownership check |
| `ensureRuntimeSession` | workspace/session only | actor ownership check |
| `ensureBrowser` | workspace/session only | actor ownership check |
| `cloud.exec` / `execComputer` | any workspace session | 403 for non-owner/non-admin |
| `cloud.write_file` / `writeSessionFile` | any workspace session | 403 for non-owner/non-admin |
| `cloud.read_file` / `readSessionFile` | any workspace session | 403 for non-owner/non-admin |
| `cloud.list_files` / `listSessionFiles` | any workspace session | 403 for non-owner/non-admin |
| `cloud.computer_stop` / `stopComputerSession` | any workspace session | 403 before stop |
| Browser open/inspect/screenshot/click/type/select/scroll/wait/research | any workspace session | 403 in the shared `action` boundary |
| `browser.close` / `closeBrowserSession` | any workspace session | 403 before close |
| `GET /runtime/sessions` | all workspace sessions | filtered to owned sessions; admins see all |
| `GET /runtime/sessions/:id` | no ownership check | 403 for another user's session |
| `GET /runtime/artifacts` | all workspace artifacts | filtered to owned sessions; admins see all |
| `GET /runtime/artifacts/:id` | no ownership check | 403 for another user's artifact |
| `browser-approvals` | already checked | unchanged |
| Runtime session detail artifacts | no ownership check | detail route is checked first and artifacts are filtered |

### Authorization semantics

- Owner: `session.createdBy === actor`.
- Mission requester: if the session has a `missionId`, the mission's
  `requested_by` is accepted as the owning user. This preserves access for sessions
  created by an agent before this fix, without trusting the agent name.
- Admin/owner role: follows the existing `canControlSession` policy
  (`admin` and `owner` may control another user's session).
- Cross-workspace: the session is looked up inside the requested workspace; a session
  ID from another workspace is not found and is never authorized.
- Internal lifecycle: expiry and mission-finalization pass an explicit code-only
  `internal: true` flag. That flag is not present in any tool schema or HTTP body.
- Agent tools receive `ToolContext.requestedBy` from `os_missions.requested_by`; they
  no longer use the agent's display name as the owning user. `executeForAgent` passes
  the authenticated caller as `requestedBy`.

### Regression proof

`api-server/src/runtime/runtime.test.ts` now covers:

1. Alice creates a computer session and writes a private file and artifact.
2. Bob is rejected by `execComputer`, write, read, list, stop, `getRuntimeArtifact`,
   and the `cloud.exec` tool.
3. Bob is rejected by browser open, inspect, screenshot, click, type, select, scroll,
   wait, research, and close.
4. Alice can still execute, read/write/list, inspect, screenshot, and stop.
5. An admin can execute and inspect the same sessions.
6. A cross-workspace session lookup/execute is rejected or returns no artifact.
7. A legacy session created by `legacy-agent` inside Alice's mission is accessible to
   Alice and rejected for Bob.

Targeted result:

```text
runtime.test.ts: 15 tests, 15 pass, 0 fail
```

The original cross-user reproduction is now rejected by the authorization boundary.

## 3. P1 — Extension scope and target authorization

New module: `api-server/src/extensions/scope-auth.ts`, used by
`api-server/src/extensions/router.ts` on install, update, rollback, enable, disable,
uninstall, health, and agent policy routes.

Rules implemented server-side:

- `instance`: admin/owner only; a target ID is rejected.
- `project`: member or above; the exact project must exist in the same workspace.
- `agent`: member or above; the exact agent must exist in the same workspace.
- `user`: member may target only their own user; admin/owner may target an existing
  workspace member; arbitrary/nonexistent users are rejected.
- `organization`: admin/owner only; the exact organization must exist.
- Missing target for a non-instance scope: `400 SCOPE_TARGET_REQUIRED`.
- Unknown target: `403` with a scope-specific code.
- Agent `projectIds`: every ID must exist in the workspace.
- Agent `organizationId`: admin/owner only and must exist in the workspace.
- Existing installation operations revalidate the installation's stored scope, so a
  member cannot disable/update/uninstall an admin-owned instance installation.

### Regression proof

`api-server/src/extensions/scope-auth.test.ts` covers positive and negative cases for
instance, agent, project, user, organization, viewer, and policy targets:

```text
scope-auth.test.ts: 2 tests, 2 pass, 0 fail
```

The existing `extensions.test.ts` suite remains green, including the prior
member/high-risk-plugin rejection.

## 4. P1 — Mission resume

The client contract was wrong:

```text
before: client/src/os/api.ts resumeMission -> POST /missions/:id/execute
after:  client/src/os/api.ts resumeMission -> POST /missions/:id/resume
```

The server already had a real resume operation and route. The UI was calling the
execute route, which returns immediately for a `paused` mission. Both `RunZone` and
`ExecutionCenter` use this client method.

Regression coverage:

- `api-server/src/os/runtime-api.test.ts`: pause → resume → completed, then a repeated
  resume returns `404` and leaves the mission completed.
- `client/tests/browser-e2e.test.mjs`: pauses through the UI, clicks resume, waits for
  the paused label to disappear, reads `/api/os/missions`, and asserts the persisted
  mission is no longer `paused`.

Targeted results:

```text
runtime-api.test.ts: 4 tests, 4 pass, 0 fail
browser-e2e.test.mjs: 1 test, 1 pass, 0 fail
```

## 5. P1 — Legacy agent roster access

`GET /api/agents` in the production server previously returned the active Mongo agent
roster without authentication. It is now handled by
`api-server/src/legacy-agents.ts`:

- Missing/invalid session: `401`.
- Revoked managed session: `401`; session-store failure: `503`.
- Missing `AUTH_SECRET`: `503` in the HTTP handler.
- Member: only agents whose `assignedRoomIds` contains `wora-{userId}`.
- Admin/owner: full active roster.
- Explicit `ADMIN_API_KEY` (`x-api-key` or bearer): full roster for operational use.
- Internal `loadActiveAgents()` used by Socket.IO and the AI queue is unchanged; the
  socket/queue discovery path is not broken.

Regression proof:

```text
legacy-agents.test.ts: 3 tests, 3 pass, 0 fail
```

The preview server's `/api/agents` remains a local sandbox route and is not the
production server route.

## 6. Verification results

### API

```text
Command: npm test (api-server)
tests 411
pass 407
fail 0
cancelled 0
skipped 4
duration_ms 42378.157266
```

Skipped because the environment has no Docker daemon or MongoDB:

- real Docker cloud computer
- real Docker browser
- secure Chromium sandbox mode
- MongoDB persistence/isolation test

### Client

```text
Command: npm test (client)
tests 66
pass 66
fail 0
cancelled 0
skipped 0
duration_ms 15539.714123
```

### Type checks and builds

```text
api-server: npm run typecheck  -> exit 0
api-server: npm run build      -> exit 0
client:     npm run typecheck  -> exit 0
client:     npm run build      -> exit 0
```

Build notes are unchanged: API `dist/index.mjs` 1.2 MB; client `three` chunk
576.62 kB. Neither is a failure.

### Targeted security/mission tests

```text
runtime.test.ts:            15 pass, 0 fail
scope-auth.test.ts:          2 pass, 0 fail
legacy-agents.test.ts:       3 pass, 0 fail
runtime-api.test.ts:         4 pass, 0 fail
browser-e2e.test.mjs:        1 pass, 0 fail
```

## 7. Remaining security concerns

1. **Project membership is workspace membership.** The repository has `os_projects`
   but no per-project membership/ACL table. The implementation requires the exact
   project to exist and the caller to be a member, but it cannot express "Alice is a
   member of Project A but not Project B." Adding project ACLs is a separate schema
   change.
2. **Low-level list helpers remain internal.** `listComputerSessions`,
   `listBrowserSessions`, and `listRuntimeArtifacts` are exported low-level helpers.
   HTTP routes and tool paths enforce/filter ownership, but a future internal caller
   could pass no actor. The next hardening step is to make the actor required in these
   helpers or move them behind a repository interface.
3. **Legacy sessions without a mission.** A pre-fix session created by an agent name
   and without a `missionId` is accessible only to that agent name or an admin/owner;
   there is no user mapping. New sessions store the initiating user, and mission-linked
   old sessions use `requested_by`.
4. **Legacy preview route.** `api-server/src/scripts/preview-server.ts` keeps its
   public sandbox `/api/agents` route. It is local preview code, not the production
   `wora-server` route, and should not be deployed as production.
5. **Existing policy targets.** Existing agent policies with arbitrary IDs are not
   automatically rewritten. They are rejected on the next policy update; no data was
   deleted or rewritten in this phase.
6. **Docker and MongoDB paths.** They were not executed live in this environment;
   three Docker tests and one Mongo test remain skipped. This phase does not claim
   those runtime paths were exercised.

## 8. Files changed

Code:

- `api-server/src/runtime/auth.ts` (new)
- `api-server/src/runtime/cloud.ts`
- `api-server/src/runtime/browser.ts`
- `api-server/src/runtime/tools.ts`
- `api-server/src/os/router.ts`
- `api-server/src/os/orchestrator.ts`
- `api-server/src/os/tools.ts`
- `api-server/src/extensions/capabilities.ts`
- `api-server/src/extensions/router.ts`
- `api-server/src/extensions/scope-auth.ts` (new)
- `api-server/src/legacy-agents.ts` (new)
- `api-server/src/wora-server.ts`
- `client/src/os/api.ts`

Tests:

- `api-server/src/runtime/runtime.test.ts`
- `api-server/src/runtime/runtime-docker.test.ts`
- `api-server/src/os/runtime-api.test.ts`
- `api-server/src/extensions/scope-auth.test.ts` (new)
- `api-server/src/legacy-agents.test.ts` (new)
- `client/tests/browser-e2e.test.mjs`

Documentation:

- `docs/audits/FINAL-INTEGRATION-AUDIT.md` (baseline audit)
- `docs/audits/PHASE-1-REMEDIATION.md` (this report)

## 9. Commit and delivery confirmation

- Remediation code/test commit:
  `6ea6357fd954b2d971af05c3ced45cb89d2c3e1b`
- Baseline audit commit: `f492a99`
- Branch: `fix/phase-1-security-remediation`
- No commit was made to `main`.
- No PR was merged.
- No deployment occurred.
- No force-push occurred.
- The PR targets `feat/wora-cloud-computer-browser` (the audited PR #12 branch), not
  `main`.
