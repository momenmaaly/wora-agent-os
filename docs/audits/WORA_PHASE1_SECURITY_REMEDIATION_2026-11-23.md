# WORA Phase 1 — Security Remediation Report

Date: 2026-11-23  
Branch: `feat/extensions-subsystem`  
Scope: independent review findings F1–F13 from commit `b488832`.

## Summary

All findings received a code fix and a regression test, except where noted as partial. The changes establish one outbound policy, one execution-authorization boundary, one writer-lease boundary, and explicit RBAC boundaries for high-risk capabilities.

Verification in this environment:

- API: `npm test` → **111 tests, 110 passed, 1 skipped (MongoDB opt-in), 0 failed**
- API typecheck: exit 0
- Client tests and typecheck: run separately in the delivery report
- Multi-process SQLite race and stale-owner tests: passed

## Finding status

| Finding | Status | Fix | Regression evidence |
|---|---|---|---|
| F1 extension high-risk execution | Fixed | `executeForAgent` rejects `risk: high` with `HIGH_RISK_APPROVAL_REQUIRED`; the extension route maps it to 403. High-risk work remains orchestrator-only. | API flow calls extension `host.exec` and receives 403. |
| F2 MCP health checks | Fixed | `checkInstallationHealth` requires installed + enabled + approved + non-revoked package before any manifest/probe. | Marker-based test proves no process starts for pending, disabled, revoked, removed, or untrusted states. |
| F3 stdio MCP isolation | Partially fixed (safe default) | No verified container sandbox exists in this environment. Stdio is disabled by default. `official` mode permits only the bundled trusted reference server; community stdio is refused before spawn. Process groups are killed on close/timeout. | Marker test proves no spawn; untrusted trust test returns `MCP_STDIO_UNTRUSTED`; bundled echo remains covered only when explicitly opted in. |
| F4 plugin/MCP SSRF | Fixed | Plugin HTTP and HTTP MCP use `safeFetch`; private/metadata blocking, pinned DNS, redirects disabled for secret-bearing calls, cross-origin auth stripping, streaming/decompressed caps. | Safe-fetch socket/redirect/compression tests; plugin HTTP test fails closed when private outbound is disallowed. |
| F5 SQLite lease | Fixed | `BEGIN IMMEDIATE` + conditional upsert, monotonic epoch fencing, renewal expiry check, pre-schema acquisition, busy timeout, lease-loss closes the DB and refuses writes. | Two-process race yields exactly one writer; stale owner cannot renew after takeover. |
| F6 inactive agent execution | Fixed | `executeForAgent` rejects any non-`active` agent before resolving capabilities. | API flow pauses an agent and receives 403 `AGENT_INACTIVE`. |
| F7 RBAC/self-approval | Fixed | High-risk agent permissions/tools require admin; high-risk plugin install/update/rollback/enable require admin; high-risk approvals require admin; requester cannot decide own approval. | Member API tests; self-approval unit test; existing RBAC route tests. |
| F8 marketplace refs/local Git | Fixed | Ref validation on PATCH and at Git execution; leading-dash refs rejected; `file://` enforced against local roots; private Git destinations blocked; Git child env minimized. | PATCH `--upload-pack` test; `file:///etc` test; `https://127.0.0.1` test. |
| F9 response buffering | Fixed | Streaming byte cap after gzip/deflate/br decompression in `safeFetch`; plugin/MCP use it. | Oversized normal and gzip response tests. |
| F10 cancellation | Fixed | `runTool` aborts on timeout; `ToolContext.signal` reaches plugin HTTP/MCP; MCP closes and kills the process group; safeFetch aborts sockets. | AbortSignal safe-fetch test; MCP process-group cleanup path. |
| F11 workspace TOCTOU | Partially fixed | `openWorkspaceFile` uses `O_NOFOLLOW` and descriptor realpath verification for reads/writes. Ancestor directory swap remains a local-filesystem residual risk. | Final-symlink read/write test. |
| F12 wildcard internal solver calls | Fixed | Internal solver calls use empty permission sets, not `*`. | Existing solver tests; no production wildcard call sites remain. |
| F13 safe-fetch regression coverage | Fixed | Added actual-socket, method/body/header, redirect, cross-origin header stripping, disabled redirect, gzip cap, DNS-rebinding, and abort tests. | Expanded `safe-fetch.test.ts`. |

## Operational requirements

1. Keep exactly one API replica against a SQLite `os-data` volume. PostgreSQL is still required before horizontal scaling.
2. Leave `WORA_MCP_STDIO_MODE=disabled` unless the operator explicitly trusts the bundled official catalog. There is no verified community sandbox yet.
3. Never set `WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS` in production. It is honored only when `NODE_ENV=test`.
4. High-risk approvals require an admin and a different actor from the requester.
5. The Git DNS precheck blocks private destinations, but DNS rebinding between precheck and the `git` child remains a residual risk; use an egress firewall or a pinned Git proxy for hostile networks.
6. Workspace descriptor checks close final-component races; ancestor directory swaps are still a local-filesystem risk when untrusted code can write to the workspace.

## Remaining risks

- No verified container/namespace sandbox for untrusted stdio MCP. The secure default is disabled execution, not a claim of isolation.
- SQLite remains a single-writer store. The lease prevents accidental multi-process use but is not a replacement for a multi-writer database.
- The outbound test-only private allowance is a test harness, not a production feature.
- No real remote malicious marketplace/MCP network test was run; local fixtures and policy tests cover the code paths.
