# WORA Security Architecture — Phase 1

This document records what was inspected, what was reused, and what was built in the
security/autonomous-engineering phase. It separates verified behavior from deployment
requirements and known limitations.

## 1. Repository findings (before this phase)

- API: Express 5 + TypeScript (`api-server/src/wora-server.ts`, `src/os/router.ts`), SQLite through `node:sqlite`.
- Agent Core: `src/os/orchestrator.ts` with deterministic plans, task leases, retries, checkpoints and capability snapshots.
- Extensions: `src/extensions/*` already provided Git marketplaces, manifests, installs, scopes, agent capability resolution, MCP and encrypted package secrets.
- Approvals: `src/os/governance.ts` already bound approvals to `payload_digest`, `scope`, `expires_at`, `action_class` and `amount_usd`, with single-use consumption.
- Redaction: `src/os/secrets.ts` already removed known credential signatures and secret-named environment values from views and audit writes.
- Existing gaps: extension secrets were encrypted but had no keyring, rotation, key ids or AAD binding; approvals stored their exact payload in plaintext; task tool inputs were plaintext; sessions could not be revoked; stdio MCP had a temporary HOME but no OS resource limit; there was no bounded code-repair workflow; no CI workflow; no versioned migration registry.

## 2. Reused capabilities

- SQLite schema, writer lease and `getOsDb` singleton.
- Existing extension manifest validation, install/dependency resolution, scopes, capability resolution and MCP client.
- Existing approval model, action classification and `payloadDigest` canonicalization.
- Existing workspace path sandbox (`resolveInWorkspace`) and process tool timeout handling.
- Existing `redactSecrets` and audit tables.
- Existing task lease/checkpoint/retry machinery.

No second registry, database or approval system was created.

## 3. Implemented controls

### 3.1 Keyring and field encryption

- `security/keyring.ts` loads deployment keys from, in order:
  - `WORA_SECRET_KEYS` JSON: `{"active":"v1","keys":{"v1":"<base64 32 bytes>","v2":"..."}}`
  - `WORA_SECRET_KEY`: one base64 32-byte key, label `env-v1`
  - `WORA_SECRET_KEY_FILE`: 0600 JSON file with the same shape; group/other-readable files are refused in production
- Keys are validated as exactly 32 bytes. The active key id is stored with each ciphertext.
- `security/field-crypto.ts` provides AES-256-GCM envelope encryption:
  - field format: `wora:enc:v1:<keyId>:<base64 iv>:<base64 tag>:<base64 ciphertext>`
  - AAD binds the field to its context (for example `wora-field:v1|secret|workspace|name|purpose`).
  - legacy plaintext values remain readable for migration; decryption failures return `null` or throw, never ciphertext-as-plaintext.
- New secrets, approval payloads and task tool inputs are encrypted. Legacy rows are migrated only by an explicit audited operation.

### 3.2 Secret lifecycle

`extensions/secrets.ts` now supports:

- `putSecret` / `revealSecret` / `revealSecretOrThrow` / metadata-only `listSecrets`.
- AAD binding to workspace, name and purpose; renaming or cross-workspace reads fail authentication.
- `migrateLegacySecrets({workspaceId, dryRun})` and `rotateSecrets({workspaceId, toKeyId, dryRun})`.
- Rotation aborts before writing if any row cannot be decrypted.
- Key material is never returned by status or listing APIs.
- Admin endpoints: `GET /api/os/extensions/secrets/key-status`, `POST /api/os/extensions/secrets/rotate` (`dryRun`, `migrateLegacy`, `toKeyId`).

Operational rule: keep the old key in the keyring until every row reports the new key id.

### 3.3 Approval transparency

- `os/action-summary.ts` generates the review from the actual tool id and payload, never from a free-form agent sentence.
- Every approval stores target, consequences, resource impact, summary version and a review digest.
- Unknown/high-risk actions with no reviewable target are refused before an approval row exists.
- Approval payloads are encrypted with AAD bound to workspace and approval id.
- `consumeApproval` verifies the stored payload digest and review digest before execution.
- The UI shows target, consequences and resource impact next to the payload digest.

### 3.4 Revocable sessions

- `lib/session-store.ts` stores a session registry (`security_sessions`) and issues tokens with a `sid` claim.
- API and Socket.IO reject a token whose session is revoked, expired or belongs to another subject.
- `POST /api/session/revoke` revokes the current managed session.
- Legacy tokens without `sid` remain accepted for migration; new managed sessions always carry one.
- Cross-site browser mutations (`Sec-Fetch-Site: cross-site`) are rejected in addition to the exact origin allowlist.

### 3.5 Plugin/MCP isolation

- Stdio MCP commands are launched through `prlimit` when available (`extensions/sandbox.ts`):
  - address space (default 2 GiB), CPU seconds (60), file size (32 MiB), open files (1024), process count (1024).
  - limits are configurable with `WORA_MCP_*`; `WORA_MCP_RESOURCE_LIMITS=0` disables the wrapper.
- This is resource isolation, not a filesystem/network sandbox. The health response reports the exact enforced limits and states the remaining limitations.
- Stdio remains disabled by default; community stdio remains refused; only the bundled reference server is allowed in `official` mode.

### 3.6 Bounded code repair

`os/code-repair.ts` and `POST /api/os/code-repair` implement:

1. Validate repository path inside the workspace.
2. Refuse protected branches (`main`, `master`, `production`, `release`).
3. Validate a unified diff: relative paths only, no protected paths, max 12 files, 256 KB, 1,500 lines, no binary patches.
4. Copy the repository to a temporary directory (source untouched).
5. Require the targeted test to fail before the patch.
6. Apply the patch, run targeted tests and a regression path.
7. Independently produce and scan the diff; reject credential-shaped content.
8. Delete the temporary copy on every path. A failed verification is a rollback by discard.
9. Record audit events and checks; return the patch, not a claimed source edit.

### 3.7 Versioned migrations and recovery

- `os/migrations.ts` records versions in `os_schema_migrations` and `PRAGMA user_version`; each migration is transactional and idempotent.
- Additive migrations are not destructively rolled back; the documented strategy is restoring the pre-migration backup. `rollbackLastMigration` reports this instead of dropping data.
- `os/recovery.ts` reports interrupted missions, expired leases, started checkpoints and pending approvals, and provides a workspace-scoped recovery operation.
- `GET /api/os/migrations` (admin) reports applied and pending versions; `POST /api/os/recovery` (admin) reports interrupted work and performs the workspace-scoped recovery.
- Existing task leases, checkpoints and retry policy remain the durable execution mechanism.

### 3.8 Observability

- `lib/observability.ts` provides correlation ids, in-process counters/timings, Prometheus text and log redaction.
- `X-Correlation-Id` is accepted/propagated by the OS router; mission and tool audit records include it.
- `GET /api/os/metrics` (JSON) and `GET /api/os/metrics/prometheus` are admin-only.
- No secrets are logged; `redactForLog` is available for structured log payloads.

## 4. Threat model (summary)

| Threat | Control | Residual risk |
|---|---|---|
| Database file theft | AES-256-GCM field encryption; keyring outside DB | Keys on same host if operator chooses `WORA_SECRET_KEY_FILE` |
| Cross-workspace secret read | AAD includes workspace/name/purpose | A process with the keyring can decrypt all workspaces |
| Approval payload swap | Encrypted payload + payload/review digests + scope/expiry | Compromised API process can still read the keyring |
| Stolen session token | Short expiry + session registry revocation | Legacy sid-less tokens cannot be revoked |
| Malicious marketplace package | Manifest validation, trust levels, no automatic code execution | Git marketplace content is still untrusted input |
| MCP process abuse | Allowlisted command, resource limits, temp HOME, timeout, kill | No filesystem/network namespace |
| Unbounded patch | Size/file/line limits, protected paths, test-first workflow | A valid patch can still introduce a logic bug |
| Log leakage | Redaction + no secret-bearing response fields | Heuristic redaction is not a proof |

## 5. Manual configuration required

Generate two independent 32-byte keys and keep them outside the database:

```bash
openssl rand -base64 32   # v1
openssl rand -base64 32   # v2, for rotation
```

```env
WORA_SECRET_KEYS={"active":"v1","keys":{"v1":"<base64>","v2":"<base64>"}}
# or a 0600 file:
# WORA_SECRET_KEY_FILE=/run/secrets/wora-secret-keys.json
AUTH_SECRET=<separate signing secret>
```

Then:

1. Back up the SQLite database.
2. Run the explicit secret migration/rotation for each workspace (`migrateLegacySecrets`, then `rotateSecrets`).
3. Keep old keys in the keyring until all rows use the new key id.
4. Set `WORA_MCP_STDIO_MODE=official` only if the bundled reference server is intended.
5. Set `WORA_MCP_RESOURCE_LIMITS=1` (default) and tune `WORA_MCP_*` for the workload.
6. Restrict `WORA_EXTENSIONS_LOCAL_ROOTS` to absolute, operator-owned paths.

## 6. Verified tests (this phase)

- `src/security/secrets.test.ts`: 8/8 — key ids, AAD, tampering, legacy read/migration, rotation, missing key, keyring status, sealed fields.
- `src/lib/session-store.test.ts`: 5/5 — managed sessions, expiry, legacy tokens, no token storage, revocation.
- `src/lib/http-security.test.ts`: 2/2 — cross-site mutations, production origin allowlist.
- `src/lib/observability.test.ts`: 3/3 — correlation ids, counters/timings, log redaction.
- `src/os/code-repair.test.ts`: 5/5 — reproduction, real patch, failed patch rollback, protected branch/path, inspection.
- `src/os/migrations.test.ts`: 3/3 — recorded versions, idempotency, additive rollback safety.
- `src/os/recovery.test.ts`: 2/2 — interrupted mission/lease/checkpoint report and workspace isolation.
- `src/os/action-summary.test.ts`: 3/3 — review derived from the payload, refusal of incomplete high-risk actions, target changes with the payload.
- `src/os/security-api.test.ts`: 3/3 — admin-gated recovery/metrics routes and real code-repair API execution.
- `src/os/session-router.test.ts`: 2/2 — revoked managed sessions rejected by the OS API; legacy sid-less tokens still readable.
- Existing `src/extensions/extensions.test.ts`: 26/26 with the MCP resource wrapper.
- Full API suite: **246 tests, 245 passed, 1 skipped, 0 failed** (the skip is the pre-existing MongoDB integration test).

## 7. Known limitations

- `prlimit` is resource limiting, not a real sandbox; no user namespaces or capabilities are available in this environment.
- Additive SQLite migrations cannot be rolled back without a backup; no destructive down migrations were added.
- Legacy sid-less sessions cannot be revoked until reissued.
- Legacy plaintext secret rows remain readable until an operator runs migration.
- The code-repair workflow returns a verified patch but does not apply it to the source repository.
- Metrics are per-process and in-memory; no OTel exporter or long-term store.
- Redaction is heuristic; encrypted fields are the primary control, not redaction.
