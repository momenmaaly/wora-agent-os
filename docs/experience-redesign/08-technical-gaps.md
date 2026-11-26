# 08 — Technical Gaps Preventing the Intended Experience

**Purpose:** distinguish design intent from backend reality. None of these are hidden in the prototype.

| # | Gap | Current evidence | UX consequence | Required backend/API work | Priority |
|---|---|---|---|---|---|
| 1 | No global artifact list | `GET /api/os/state` exposes only `artifacts` count; `GET /api/os/artifacts/:id` needs an ID; mission detail links artifacts | Library can show artifacts linked to missions but cannot browse/search all artifacts reliably | Add `GET /api/os/artifacts` with workspace scoping, pagination, mission filter, kind, created time | P0 |
| 2 | No dedicated knowledge endpoint | No discovered knowledge list/API; `KnowledgePage` exists but full data path not present in OS API | The proposed Library → Knowledge cannot be real without an endpoint | Define knowledge entities or map to memory/documents; add list/search endpoints | P1 |
| 3 | No single cross-mission activity endpoint | Mission detail exposes per-mission events; `/api/os/audit` is audit-centric | The System → Activity view must merge data or show audit only | Add normalized activity feed with actor, mission, type, subject, time, digest | P1 |
| 4 | Phase and “next action” are derived | No `phase` or `nextAction` field in mission detail | Phase can be wrong if data is incomplete | Either formalize a phase/next-action projection server-side or keep a well-tested client derivation with explicit “not exposed” fallbacks | P1 |
| 5 | Artifact list lacks typed metadata | Artifact record has `id`, `missionId`, `name`, `kind`, `content`, `createdAt` | Library filters cannot include richer status/format without inference | Add `status`, `mimeType`, `size`, `taskId`, `digest`, `preview` metadata | P2 |
| 6 | Memory records lack typed title/kind in captured data | Memory API returns content and timestamps; captured records have no title/kind | Memory list must show content excerpts, not invented titles | Add `kind`, `title`, `scope`, `sourceTaskId`, `sourceMissionId`, `confidence` where applicable | P1 |
| 7 | No interactive terminal channel | Current Terminal page is a read-only mission event log; no exec/session endpoint exposed | A real terminal panel cannot be promised; it should remain an “Activity / technical stream” with raw detail | Add a sandboxed PTY/session service with explicit authorization, audit, timeout, and resource limits | P2 |
| 8 | No dedicated permission-denial feed | Denials appear in approval/tool errors and audit records, but no denial list endpoint | Security surface cannot show a complete denial queue | Add a query over authorization decisions with actor, tool, mission, policy, time | P1 |
| 9 | No provider/model routing detail in OS snapshot | `/api/os/usage` reports aggregate calls/cost; model profiles live outside the OS snapshot | System → Models cannot show per-mission provider routing without another API | Expose model profile and provider route per run/task or add a run-level routing record | P1 |
| 10 | Capability snapshot does not include every run | Mission has 3 snapshots for 4 tasks; a blocked task has no run and no snapshot in the captured data | The UI must show “not resolved/not run” for missing tasks, not a blank | Snapshot resolution before execution, including blocked tasks; or expose explicit “unresolved” state | P1 |
| 11 | No installed skills/plugins in the current workspace | `extensions.installed: 0`, `enabled: 0`, `mcpServers: 0`, `pluginTools: 0` | The prototype cannot demonstrate a skill/plugin actually influencing a mission in this workspace | Install a safe test package and resolve it into a mission; keep the empty state honest until then | P0 for end-to-end capability demo |
| 12 | Composition may be null | Mission detail `composition` is null; `planVersions[0].strategy` is `direct` | A “strategy graph” could be invented if the UI assumes composition always exists | Render the plan ledger when composition is absent; do not fabricate a graph | P1 |
| 13 | No run-level evidence size limits in API contract | Evidence can contain tool output and paths; current client slices strings | Large evidence can degrade UI or leak sensitive paths | Add normalized, bounded evidence summaries and secret-redaction guarantees | P1 |
| 14 | No explicit approval decision concurrency control in UI | Decision endpoint exists; no visible version/etag in the reviewed payload | Two reviewers could race | Return approval version/digest; enforce optimistic concurrency and audit both attempts | P1 |
| 15 | Outcome `requires_human_review` is a terminal-looking status | Real mission ends `awaiting_approval` with `outcomeStatus: requires_human_review` | User may think approval automatically verifies the outcome | Model “outcome review” separately from “action approval”; surface both next steps | P1 |
| 16 | No workflow/queue visualization endpoint | Runtime exposes limits/leases, but no queue depth or scheduled work endpoint | System → Runtime cannot show a true queue | Add queue depth, active runs, pending tasks, retry schedule | P2 |
| 17 | No artifact rendering service | Artifact content is markdown stored as a string | Rich artifact previews (HTML, code, data) require client rendering and safety rules | Add sanitized artifact rendering or declared mime types; never render untrusted HTML directly | P1 |
| 18 | No server-side “mission search” | Mission list client exists; no query parameters found | Mission switcher cannot scale to many missions | Add pagination/filter/search on missions | P2 |
| 19 | No cross-mission capability assignment view | Capability profiles are per agent; mission snapshots are per task | “Who can use this skill?” requires N+1 queries | Add capability assignment index and policy endpoint | P1 |
| 20 | Auto-load semantics need explicit UI contract | Manifests/installations expose `autoLoad`; current UX does not show it per mission | Users could assume installed means auto-used | Surface `autoLoad` and resolved snapshot per task; never imply execution from installation alone | P0 |

---

## What the prototype does about these gaps

- It uses only recorded real data from the integrated API.
- It marks the data source in the status bar and README.
- It does not call mutation endpoints.
- It shows `Not installed`, `No MCP connections`, `0 calls / not billing-grade`, and `requires human review` explicitly.
- It does not render a fake terminal, fake agent activity, or fake skill assignment.
- It does not claim an approval was approved.
- It shows the missing artifact list and knowledge surfaces as honest gaps, not populated fake libraries.

---

## Minimum backend work for a production vertical slice

1. Artifact list endpoint + artifact metadata.
2. Memory list enrichment (kind/title/source).
3. A normalized mission projection with `phase`, `nextAction`, and missing-state booleans.
4. A cross-mission activity/approval feed.
5. Capability snapshot for every task, including unresolved/blocked.
6. One safe installed test skill and one test plugin/MCP server to prove the capability chain.
7. Artifact sanitization/rendering policy.
8. Approval concurrency/version.
9. Permission-denial query.
10. Model/provider routing per run.

The UI redesign can ship without all ten, but the “capability → mission → evidence → artifact” demo requires at least items 1, 5, and 6 in a test workspace.
