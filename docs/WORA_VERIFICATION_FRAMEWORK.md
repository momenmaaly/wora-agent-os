# WORA Verification and Evidence Framework

**Status:** first durable slice implemented and locally tested.
**Source:** `api-server/src/os/verification.ts`, `api-server/src/os/independent-verification.ts`, `api-server/src/os/orchestrator.ts`, `api-server/src/os/db.ts`.

## 1. Principle

An agent saying "completed" is not evidence. A mission task is accepted only when the deterministic acceptance review passes over the actual output and attached evidence. The verification record preserves what was checked, what failed, and which verifier produced the result.

## 2. Persisted record

`os_verifications` stores one row per run attempt:

| Field | Meaning |
| --- | --- |
| `id` | Verification record identifier |
| `workspace_id` | Tenant/workspace boundary |
| `mission_id`, `task_id` | Foreign keys to the real execution records |
| `run_id` | Unique run attempt |
| `objective` | Task objective at verification time |
| `acceptance_criteria` | Structured criteria copied from the task |
| `expected_output` | What should have been produced |
| `actual_output` | Actual tool output (bounded JSON) |
| `evidence` | Evidence bundle used by the verifier (bounded JSON) |
| `checks` | Structured check results with kind, status and evidence |
| `result` | `passed`, `failed` or `blocked` |
| `independence` | `deterministic-review`, `external` or `none` |
| `failure_reason` | Explicit failure reason; never empty on failure |
| `verifier` | Verifier identity |
| `created_at` | Timestamp |

Indexes cover `(workspace_id, mission_id, created_at)` and `(workspace_id, task_id, created_at)`.

## 3. Current checks

Every normal run records:

1. **Tool execution** — did the assigned tool complete without an execution error?
2. **Acceptance review** — did the deterministic review pass over the actual output and evidence?

A capability denial records a **blocked** verification with a failed authorization check and the denial reason. A failed first attempt records a failed verification; a retry records a separate attempt. No verification row is overwritten.

## 4. API

```http
GET /api/os/missions/:id/verifications
GET /api/os/verifications/:id
```

Both are workspace-scoped by the same session/workspace resolution as the rest of `/api/os`. Mission detail also includes `verifications`.

## 5. What this does not yet do

- It does not run external third-party audits; `independence` says `deterministic-review`, not `external`.
- Property and API-contract checks exist for the current tool surface; broader property-based, database-integrity and performance check families remain future work.
- It computes an artifact digest but does not yet bind it to a signed capability snapshot or an external signature. That is a next step.
- It does not replace domain-specific solver revalidation; those checks remain inside the solver and the deterministic review.
- It does not make a failed mission successful. It records failure honestly.

## 6. Acceptance evidence

`api-server/src/os/verification.test.ts` and `independent-verification.test.ts` verify:

- a completed mission produces a passed record with checks and evidence;
- a failed record preserves the failure reason;
- records are isolated by workspace;
- the HTTP API returns the mission list and a single record;
- contract, property, secret-leak and artifact-integrity checks fail closed.
