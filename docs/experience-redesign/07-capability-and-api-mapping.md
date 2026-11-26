# 07 — Capability and API Mapping

**Rule:** no major UI element may claim a capability that the current API cannot support.\
**Legend:**
- **Implemented** — endpoint and persisted data exist; current UI may already use them.
- **Partial** — endpoint exists but does not expose every field the proposed UI needs.
- **Derived** — computed client-side from implemented endpoints.
- **Prototype-only** — interaction is demonstrated but deliberately not wired to a mutation.
- **Not exposed** — no current API; redesign must show an honest gap.

All OS routes are mounted at `/api/os` and the extensions routes at `/api/os/extensions`. The OS router resolves a workspace from the signed session (production) or a shared preview workspace (non-production), and mutating routes are rate-limited per workspace. The UI must keep the existing session/auth layer; it must not invent a second authorization model.

---

## 1. Global shell

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Zone counts: pending approvals | `GET /api/os/state` → `approvals.pending` | Implemented | Also `GET /api/os/approvals` for records |
| Zone counts: artifacts | `GET /api/os/state` → `artifacts` | Implemented | Count only; no artifact list endpoint |
| Zone counts: installed capabilities | `GET /api/os/extensions` → `installed`, `enabled` | Implemented | Summary only |
| Mission switcher | `GET /api/os/missions` | Implemented | No pagination/search parameters visible in current client |
| Active mission | `GET /api/os/missions/:id` | Implemented | Rich detail |
| Runtime strip | `GET /api/os/runtime/status` | Implemented | Mode, leases, checkpoints, recovery, limits, limitations |
| Top-bar attention count | `GET /api/os/state` + `GET /api/os/approvals` | Derived | Count from state; records from approvals |
| Current user / role | session + `GET /api/os/roles` | Implemented | Existing auth/session flow |
| Global search | existing `QuickSearch` data + client routes | Partial | No server-side cross-object search endpoint found |
| Command palette | client actions only | Prototype-only | Navigation/theme/language actions; mutating commands need real endpoints |

---

## 2. Mission workspace

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Mission identity / status / summary | `GET /api/os/missions/:id` | Implemented | `status`, `summary`, timestamps |
| Progress | `tasks` from mission detail | Derived | Completed / total |
| Phase spine | `problemProfile`, `planVersions`, `tasks`, `verifications`, `artifactId` | Derived | Phase is a product model, not a backend field |
| Strategy label | `planVersions[].strategy`, `composition.selectedStrategy` | Partial | Composition may be null; plan strategy may be `direct` |
| Attention banner | pending `approvals`, `blocked` tasks, `outcomeVerification` | Derived | Must not invent blockers |
| Next action | mission status + approvals + blocked tasks + outcome | Derived | Product policy |
| Task ledger | `GET /api/os/missions/:id` → `tasks` | Implemented | Titles, status, agent, tool, dependencies, acceptance |
| Task dependency view | `task.dependsOn` | Implemented | No independent graph endpoint; derive edges |
| Run evidence | `task.runs[].evidence` | Implemented | Some payloads can be large; bound/redact |
| Handoffs | `GET /api/os/missions/:id` → `handoffs` | Implemented | Contracts available |
| Assignments | `task.agent`, `task.specialization`, `GET /api/os/missions/:id/team` | Implemented | Team preview also available |
| Pause / resume | `POST /api/os/missions/:id/pause`, `/resume` | Implemented | Mutating; not enabled in prototype |
| Cancel | `POST /api/os/missions/:id/cancel` | Implemented | Destructive; confirmation required |
| Replan | `POST /api/os/missions/:id/replan`, `/tasks/:taskId/replan` | Implemented | Must show plan preview and conflicts |
| Execute | `POST /api/os/missions/:id/execute` | Implemented | Mutating; not enabled in prototype |
| Leases | `GET /api/os/missions/:id/leases` | Implemented | Also runtime status |
| Checkpoints | `GET /api/os/tasks/:id/checkpoints` | Implemented | Per-task |
| Raw task/run JSON | mission detail | Implemented | Bound and redact |

---

## 3. Evidence and verification

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Outcome verdict | `GET /api/os/missions/:id/outcome` and/or `outcomeVerification` in mission detail | Implemented | Status, checks, reasons, taskEvidence |
| Independent verifications | `GET /api/os/missions/:id/verifications` | Implemented | Verifier, independence, expected/actual, result |
| Single verification | `GET /api/os/verifications/:id` | Implemented | Not currently used by the new UI |
| Evidence chain | task runs + verifications + outcome | Derived | Cross-object view |
| Evidence digests | run evidence `artifactDigest`, approval `payloadDigest` | Implemented | Display truncated; copyable |
| Failure explanation | `outcomeVerification.reasons`, failed checks, task issues | Implemented | Combine with task context |
| Artifact as evidence | `artifactId`, `GET /api/os/artifacts/:id` | Implemented | Artifact content |
| Verification detail for every task | verifications list | Partial | Actual run has 3 verification records for 4 tasks; UI must show missing as not run, not as passed |

---

## 4. Approvals and governance

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Pending approval list | `GET /api/os/approvals` | Implemented | Filter by mission/status supported where current UI uses it |
| Approval review fields | approval record: `actionSummary`, `target`, `consequences`, `resourceImpact`, `risk`, `actionClass`, `scope`, `payloadDigest`, `reviewDigest`, `expiresAt`, `toolInput` | Implemented | Exact payload can be sensitive; show bounded/redacted |
| Approve / reject | `POST /api/os/approvals/:id/decide` | Implemented | Production action; prototype disabled |
| Approval history | `GET /api/os/approvals` | Implemented | Records include status/decision |
| Autonomy policy | `GET/POST /api/os/settings/autonomy` | Implemented | System → Security/Governance |
| Action budget | `GET/POST /api/os/settings/action-budget` | Implemented | System → Security/Governance |
| Execution limits | `GET/POST /api/os/settings/execution-limits` | Implemented | System → Runtime |
| Audit | `GET /api/os/audit` | Implemented | Activity/history |
| Roles / RBAC | `GET/POST/DELETE /api/os/roles` | Implemented | Existing role model; UI mapping must preserve |
| Permission denial display | approval/tool errors, audit | Partial | No dedicated denial feed endpoint |

---

## 5. Artifacts, memory, knowledge

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Artifact reader | `GET /api/os/artifacts/:id` | Implemented | Content is markdown; no list endpoint |
| Artifact metadata | mission detail `artifacts[]` | Partial | Current mission has one linked artifact |
| Artifact library | `state.artifacts` count + mission links | Partial | No global artifact list/search endpoint found |
| Memory list | `GET /api/os/memory` | Implemented | Content and timestamps; memory records lack typed title/kind in captured data |
| Memory versions | `GET /api/os/memory/:id/versions` | Implemented | Inspector disclosure |
| Memory retrievals | `GET /api/os/memory/retrievals` | Implemented | Observability |
| Add/delete memory | `POST /api/os/memory`, `DELETE /api/os/memory/:id` | Implemented | Mutating; not enabled in prototype |
| Knowledge list | no dedicated discovered endpoint | Not exposed | Do not render a fake knowledge library; use an explicit gap state |

---

## 6. Agents and capabilities

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Agent registry | `GET /api/os/agents` | Implemented | 18 agents in captured snapshot |
| Agent detail | `GET /api/os/agents/:id` | Implemented | Role, skills, tools, permissions, model, limits |
| Agent versions | `GET /api/os/agents/:id/versions` | Implemented | Inspector history |
| Agent create/update/delete | `POST/PATCH/DELETE /api/os/agents` | Implemented | Administrative; not prototype-wired |
| Capability profile | `GET /api/os/extensions/agents/:agentId/capabilities` | Implemented | Resolved skills/plugins/tools/permissions |
| Resolve capability profile | `POST /api/os/extensions/agents/:agentId/resolve` | Implemented | Production operation |
| Capability snapshots | mission detail `capabilitySnapshots`; `GET /api/os/extensions/snapshots` | Implemented | 3 snapshots in the current mission |
| Skill contexts | `GET /api/os/extensions/skill-contexts` | Implemented | Current mission has none |
| Capability matching | `POST /api/os/extensions/capabilities/match` | Implemented | Could power “what can do this?” |
| Specializations | `GET /api/os/specializations` | Implemented | Capability vocabulary |
| Agent tool execution | `POST /api/os/extensions/agents/:agentId/tools/:toolId/execute` | Implemented | Authorization enforced; not prototype-wired |
| Direct core tool execution | `POST /api/os/tools/:id/execute` | Implemented | High-risk tools restricted; not prototype-wired |

---

## 7. Skills, plugins, marketplaces, MCP

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Extension summary | `GET /api/os/extensions` | Implemented | marketplaces, skills, plugins, installed, enabled, pendingApproval, tools, mcpServers, secrets, snapshots |
| Package catalog | `GET /api/os/extensions/packages` | Implemented | 20 packages (19 skills + 1 plugin) in snapshot |
| Package detail | `GET /api/os/extensions/packages/:id` | Implemented | Manifest, permissions, versions, security |
| Install plan | `POST /api/os/extensions/packages/:id/plan` | Implemented | Dependencies, conflicts, cycles, missing tools/secrets |
| Install | `POST /api/os/extensions/packages/:id/install` | Implemented | Scope, auto-load, permission approval |
| Installations | `GET /api/os/extensions/installations` | Implemented | **0 installations in snapshot** |
| Enable / disable | `POST /api/os/extensions/installations/:id/enable`, `/disable` | Implemented | Health response on enable |
| Approve installation permissions | `POST /api/os/extensions/installations/:id/approve` | Implemented | |
| Update / rollback | `POST /api/os/extensions/installations/:id/update`, `/rollback` | Implemented | No silent downgrade; plan returned |
| Uninstall | `DELETE /api/os/extensions/installations/:id` | Implemented | Cleanup |
| Health check | `POST /api/os/extensions/installations/:id/health` | Implemented | Plugin/MCP health |
| Marketplaces | `GET /api/os/extensions/marketplaces` | Implemented | 1 built-in marketplace, 20 packages |
| Marketplace preview / add / sync / remove | `POST /preview`, `POST /marketplaces`, `POST /:id/sync`, `DELETE /:id` | Implemented | Git provider adapter; private credential names |
| MCP servers | `GET /api/os/extensions/mcp` | Implemented | **0 servers in snapshot** |
| MCP health | `POST /api/os/extensions/mcp/:id/health` | Implemented | |
| Plugin tools | `GET /api/os/extensions/tools` | Implemented | 22 core tools, 0 plugin tools in snapshot |
| Manifest validation | `POST /api/os/extensions/validate` | Implemented | |
| Create package | `POST /api/os/extensions/packages/create` | Implemented | Authoring |
| Secrets metadata | `GET /api/os/extensions/secrets` | Implemented | Metadata only; values never returned |
| Secrets create/delete/rotate | `POST /api/os/extensions/secrets`, `DELETE /:name`, `POST /rotate` | Implemented | Sensitive; not prototype-wired |
| Audit | `GET /api/os/extensions/audit` | Implemented | Installation/sync/permission history |
| Auto-load | package/installation `autoLoad` fields | Implemented | Must remain subordinate to explicit permission/approval |

---

## 8. Runtime and system

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Runtime mode / durability | `GET /api/os/runtime/status` | Implemented | opt-in worker, durable store, leases, checkpoints |
| Recovery status | `GET /api/os/recovery`, `/runtime/status` recovery block | Implemented | Interrupted missions, blocked tasks, pending approvals |
| Metrics | `GET /api/os/metrics`, `/metrics/prometheus` | Implemented | System observability |
| Usage | `GET /api/os/usage` | Implemented | 0 calls, 0 cost in snapshot; API says not billing-grade |
| Model providers | existing model settings / `llm_profiles` | Partial | Current snapshot does not expose provider routing detail in OS API |
| Workspace roles | `GET /api/os/roles` | Implemented | System governance |
| Organizations | `GET /api/os/organizations` | Implemented | System administration |
| Devices | `GET /api/os/devices` | Implemented | Not central to the redesign |
| Migrations | `GET /api/os/migrations` | Implemented | System diagnostics |
| State summary | `GET /api/os/state` | Implemented | Agents, missions, tasks, approvals, memory, artifacts |
| Activity stream | mission detail + `GET /api/os/audit` | Partial/Derived | No single cross-mission event endpoint found; compose from mission and audit |

---

## 9. Spatial mode

| UI element | Data / API | Status | Notes |
|---|---|---|---|
| Campus / Director / Studio | existing office simulation + local store | Simulated/representational | Preserve as optional mode; do not present as the operational truth |
| Agent positions / room activity | office simulation state | Simulated | The UI must label it as a spatial representation, not live telemetry |

---

## 10. What the prototype actually uses

The prototype is a **read-only recorded snapshot** from the integrated API. It does not call mutation endpoints.

| Data | Source | Use |
|---|---|---|
| Mission | `/api/os/missions/msn_ba1e64fc6a6c403d` | Objective, status, tasks, approvals, verifications, outcome, artifact link |
| Mission detail | same | Tasks, runs, evidence, handoffs, capability snapshots |
| Runtime | `/api/os/runtime/status` | Runtime strip, System → Runtime |
| State | `/api/os/state` | Counts, readiness |
| Agents | `/api/os/agents` | Capability inventory |
| Packages | `/api/os/extensions/packages` | Skills/plugins catalog |
| Marketplaces | `/api/os/extensions/marketplaces` | Marketplace inventory |
| MCP | `/api/os/extensions/mcp` | Empty state |
| Tools | `/api/os/tools` | Core tool inventory |
| Memory | `/api/os/memory` | Library → Memory |
| Artifact | `/api/os/artifacts/art_328a72db79a244a8` | Artifact reader |
| Usage | `/api/os/usage` | System → Usage |

The snapshot is stored at `prototype/data/snapshot.json` and is labeled in the prototype status bar as recorded data.

---

## 11. Mapping conclusion

The proposed experience is achievable with the current API for the core mission, evidence, runtime, agents, packages, and governance surfaces. The largest mapping gaps are:

1. no global artifact-list endpoint;
2. no dedicated knowledge endpoint;
3. no single cross-mission activity endpoint;
4. no server-side “next action” or phase model (must be derived);
5. no provider routing detail in the OS snapshot;
6. no interactive terminal endpoint;
7. no dedicated permission-denial feed.

These gaps are listed in `08-technical-gaps.md` and are handled with explicit empty/not-exposed states rather than simulated functionality.
