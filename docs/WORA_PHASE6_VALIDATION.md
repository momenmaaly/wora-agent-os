# WORA Phase 6 — Autonomous Intelligence Validation & Reliability

**Status:** implemented and verified vertical slice. This phase validates and hardens the unified problem-solving system; it does not claim general intelligence or universal correctness.

## What this phase adds

Phase 6 closes gaps found while exercising the Phase 5 composition and execution path:

- **Semantic capability contracts** (`api-server/src/os/semantic-contracts.ts`). A fallback is accepted only when its machine-readable contract matches the primary capability on semantic identity, input/output meaning, units, types, side effects, determinism, precision, permissions, verification and evidence confidence. The pure comparator is used by composition, fallback selection, evaluation and tests.
- **Independent mission outcome verification** (`api-server/src/os/outcome-verification.ts`). Mission completion is no longer inferred only from task status. The verifier inspects actual run output, task verification records, artifact digests, capability gaps and secret-safety checks, then records `outcome_status` and `outcome_evidence` on `os_missions`.
- **Honest outcome states:** `verified`, `partially_verified`, `unverified`, `failed`, `blocked`, `requires_human_review`. A missing outcome check is `not_run` and produces a partial or unverified result, never a silent success.
- **Outcome API and UI:** `GET /api/os/missions/:id/outcome`, `outcomeStatus`/`outcomeVerification` in mission detail, and an Arabic-first independent-verification panel in `ExecutionCenter`.
- **Evaluation framework** (`api-server/src/os/evaluation-framework.ts`). Scenarios provide only an objective, facts, constraints and resources. WORA builds its own model and composition; the evaluator checks domain classification, provenance separation, approved-only capabilities, dependency ordering, honest gaps, semantic fallbacks and estimated cost/latency classes.
- **Reliability fixes found by the evaluation and fault tests:**
  - fallback index was not reset after a replacement, preventing a second compatible fallback from being attempted;
  - outcome verification compared a plugin's actual output with the original sealed task input instead of the resolved upstream binding;
  - MCP-style `content[].text` output was not recognized by the echo outcome check;
  - a terminal mission could remain visible as `completed` while its mission lease still existed;
  - empty `outcome_evidence` (`{}`) reached the UI as a partial object and crashed rendering.
- **Fault coverage:** incompatible semantic fallback refusal, missing upstream output blocking, protected approval action, missing capability gap, optimization solver verification, recovery after a real SIGKILL, and revocation/deny paths from the existing suites.

## Evaluation method

The development set contains 13 scenarios across business, software, data, optimization, allocation, scheduling, scientific uncertainty, incomplete decisions, multi-agent coordination, troubleshooting, capability failure, missing capability and ambiguity. These scenarios were used during hardening, so their 13/13 result is a development result, not an independent blind result.

After the implementation was frozen, four held-out scenarios were added and run without further model/composition changes: clinic nurse allocation, customer churn with a missing dataset, a TLA+ proof with no model checker, and an Arabic ambiguous request. The held-out result was **4/4 passed**.

| Measure | Development | Held-out |
|---|---:|---:|
| Scenarios passed | 13/13 | 4/4 |
| Domain classification | 1.00 | 1.00 |
| Provenance separation | 1.00 | 1.00 |
| Approved-only capabilities | 1.00 | 1.00 |
| Dependency ordering | 1.00 | 1.00 |
| Honest gaps/ambiguity | 1.00 | 1.00 |
| Semantic fallbacks only | 1.00 | 1.00 |
| Estimated tool calls | 25 | 7 |

The framework does not hardcode a plan per scenario. A `plan` scenario passes only if WORA constructs a real plan or an honest gap; `gap` scenarios must produce a gap; `clarify` scenarios must preserve ambiguity and unknowns.

## End-to-end scenarios executed

All of the following run against real SQLite, a real local Git marketplace, real HTTP plugin fixtures, the real Tool Registry, authorization, orchestrator, verification and outcome persistence.

1. **Multi-capability dependency** — summary → plugin echo → statistics. The plugin receives the summary produced by the upstream task, not the original objective; statistics report the exact seven observations; the mission is `verified`.
2. **Failure recovery** — a primary plugin fails, the fallback index is reset, a semantically compatible fallback runs, upstream evidence is preserved, and the replacement is recorded as a decision.
3. **Missing capability** — an SMT/model-checker request produces a `formal_verification` gap, no fabricated solver task, and a `partially_verified` outcome with the gap reason.
4. **Protected action** — a web-app mission stops at `awaiting_approval`; `host.exec` has zero runs before approval; after explicit approval it completes and the outcome is recorded.
5. **Optimization** — the employee-schedule solver produces a feasible schedule, the independent property check passes, and the outcome is `verified`.
6. **Incompatible fallback** — a currency-shaped lookalike is refused; the original tool remains; a `capability-replacement-gap` decision records the semantic reason.
7. **Missing upstream output** — a dependent plugin task is `blocked` with `input_binding_failed` instead of running on stale or invented input.
8. **Recovery/faults inherited and re-run** — SIGKILL after verification/handoff/start checkpoint, side-effect uncertainty, approval-wait recovery, two-worker exclusion, verification failure, denied specialist reassignment, and secret redaction.

## Exact verification results

- API suite: **318 tests, 317 passed, 1 skipped, 0 failed** (`npm test` in `api-server`).
- Phase 6 suite: **10/10 passed** (`src/os/phase6.test.ts`).
- Extension suite: **27/27 passed**.
- Client unit suite: **50/50 passed**.
- Browser end-to-end journey: **1/1 passed** (real API + Vite + Chromium).
- API typecheck: exit 0.
- Client typecheck: exit 0.
- API production build: exit 0.
- Client production build: exit 0.
- `git diff --check`: clean.

## Security and governance evidence

- Every capability still runs through the resolved agent profile and Tool Registry; a plugin does not bypass authorization.
- Fallback substitution requires schema equivalence, semantic compatibility and current authorization.
- High-risk actions stop at a pending approval and cannot be approved by a free-form sentence; the existing payload/scope/expiry/single-use tests remain green.
- Plugin/MCP output remains untrusted; secret-shaped output is redacted, and verification records secret-leak checks.
- Missing capability or missing input is reported as a gap/block; it is not converted into a fabricated result.
- No new external paid service is required; the test marketplace and plugins are local fixtures.

## Known limitations

- Understanding and method selection remain deterministic rules and structured features, not a semantic model.
- The held-out set is small (four scenarios); it is a check against overfitting, not a statistical benchmark.
- Generic plugin outputs without a tool-specific invariant are `partially_verified`, not `verified`.
- Business plans can verify internal arithmetic, dependencies and feasibility, but external market success remains `partially_verified` because no authoritative market evidence is available.
- Native plugin isolation is still process/HTTP/MCP-boundary isolation, not a full OS sandbox; Node permissions do not restrict network.
- SQLite remains a single-writer store; there is no cross-host queue or consensus.
- No provider-specific model routing or usage billing is introduced in this phase.
- Recovered tasks that were marked completed without retained run evidence are reported as `unverified`, not upgraded to verified.

## Manual configuration required

None for the automated tests. A deployment that wants a real external marketplace must still supply its Git URL, ref and credentials through the existing marketplace/secret APIs; no test credential or paid service is embedded.
