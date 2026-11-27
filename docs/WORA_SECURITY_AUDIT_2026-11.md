# WORA Security & Reliability Audit — November 2026

**Scope:** branch `feat/extensions-subsystem`, commits `fe75fbd`, `8898e75`, `1cc70f2`, and the dynamic-orchestration work that follows.
**Method:** source inspection plus executable tests against real SQLite, real HTTP routes, real tool registry and real MCP processes.

## Findings

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| SEC-01 | High | A real secret rotation returned `failed > 0` when every row failed to decrypt instead of aborting. An operator could read that as success. | `extensions/secrets.ts` returned before the failure check; reproduced by tampering a row. | Fixed; rotation now throws before any write. |
| SEC-02 | High | Rotation selected and decrypted rows outside the write transaction, so a concurrent write could be overwritten with stale plaintext. | Previous select/decrypt then `BEGIN IMMEDIATE` sequence. | Fixed; select/decrypt/rewrite run in one write transaction. |
| SEC-03 | Medium | Authenticated but malformed JSON in a sealed field fell back to `{}`, which could execute a tool with a different payload. | `security/field-crypto.ts` `openJson` catch branch. | Fixed; sealed malformed JSON now throws. |
| SEC-04 | Medium | `prlimit` is a resource limit, not a filesystem/network sandbox. | `extensions/sandbox.ts` limitations. | Confirmed limitation; no false sandbox claim. |
| SEC-05 | Medium | Legacy plaintext fields remain readable and have no cryptographic integrity. | `openField` plaintext passthrough; approval digest protects approvals, not legacy task input. | Accepted migration risk; new writes are sealed. |
| SEC-06 | Medium | Legacy session tokens without `sid` cannot be revoked. | `lib/session-store.ts` only checks managed sessions. | Documented; new sessions carry `sid`. |
| SEC-07 | Low | `fieldAad` concatenates IDs with `:`. Generated IDs contain no colon, but workspace IDs are not validated for ambiguity. | `security/field-crypto.ts`. | Low; no collision found. |
| SEC-08 | Low | Duplicate status guard in `finalizeMission`. | `os/orchestrator.ts`. | Cosmetic. |

## Cryptography verification

- AES-256-GCM with a fresh 12-byte random IV per write.
- Authentication tags are verified by `decipher.final()`; tampered ciphertext fails.
- Extension-secret AAD binds workspace, name and purpose. Operational-field AAD binds kind, workspace and record ID.
- Key IDs are stored with ciphertext. Missing keys fail closed, never return ciphertext.
- Keyring files must be `0600`; production refuses group/other-readable files and generated development keys.
- Rotation is explicit, audited, dry-runnable, target-key-aware and all-or-nothing.
- Status/list/audit/error/API responses tested for key or secret leakage.

## Approval and governance verification

- Reviews are generated from tool ID, description, permissions and payload; high-risk actions without a reviewable target are refused.
- Approval payloads are encrypted; payload and review digests are verified at consumption.
- Scope binds mission, task and tool; payload digest binds canonical input.
- Replay, substitution, transfer to another workspace/task/tool and expiry fail closed.
- High-risk actions always require class C approval; autopilot cannot bypass this.

## Session, HTTP, migrations and MCP

- Managed sessions are durable, expiring and revocable; HTTP and Socket.IO reject revoked sessions.
- Cross-site browser mutations are rejected; production origin allowlisting remains separate.
- Versioned migrations are transactional and idempotent. Additive rollback requires a backup; recovery marks interrupted work honestly and resume is explicit.
- Stdio MCP is disabled by default; only official bundled servers run. `prlimit` limits memory/CPU/file/process resources. It does not isolate filesystem or network; a container/bubblewrap/nsjail is still required.

## Residual risks

1. No genuine OS sandbox for untrusted stdio MCP or plugin code.
2. Legacy plaintext rows have no integrity until rewritten.
3. Legacy sid-less sessions are not revocable.
4. A keyring on the database host is weaker than an external KMS.
5. In-process metrics/audit are not tamper-evident against a host-level attacker.
6. No automated backup before additive migrations.

## Reproduce

```bash
cd api-server
npx tsc --noEmit
npx tsx --test src/security/secrets.test.ts
npx tsx --test src/os/governance-enforcement.test.ts src/os/security-adversarial.test.ts src/os/security-api.test.ts
npx tsx --test src/os/session-router.test.ts src/lib/http-security.test.ts src/lib/session-store.test.ts
npx tsx --test src/os/migrations.test.ts src/os/recovery.test.ts src/extensions/extensions.test.ts
```
