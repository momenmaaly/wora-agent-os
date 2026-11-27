# WORA Structured Problem Understanding

**Status:** deterministic interpretation and persistence implemented; no semantic-model claim.
**Source:** `api-server/src/os/problem.ts`, `orchestrator.ts`, `tools.ts`, `router.ts`.

## 1. Profile

`understandProblem` returns a versioned profile containing:

- objective, detected domain and planner track;
- explicit constraints, dependencies, resources, uncertainty and success criteria;
- missing information and ambiguity;
- structured features for algorithm selection;
- algorithm selection result;
- deterministic fallback and source (`deterministic-rules`).

It uses explicit keyword and sentence rules. It does not use an LLM, embeddings or a semantic classifier. Confidence reflects rule strength, not model certainty.

## 2. Algorithm selection

The profile derives features such as `hasCostMatrix`, `hasEmployees`, `hasShifts`, `hasUncertainty`, `hasTimeSeries`, `hasCriteria`, `hasAlternatives`, `integerVariables` and `nonlinear`, then calls the existing deterministic selector. This connects planning to the real algorithm catalog without duplicating it.

## 3. Persistence and APIs

- `os_problem_profiles` stores one profile per `(workspace_id, mission_id)`.
- Mission creation persists the profile atomically with the mission.
- `GET /api/os/missions/:id/problem` returns it.
- `POST /api/os/problems/understand` previews it.
- `meta.understand_problem` exposes it as a low-risk core tool.

## 4. Tests

`api-server/src/os/problem.test.ts` covers operations/software/diagnostics classification, structured features, missing-information honesty, unsupported nonlinear problems, mission persistence, tool execution and the HTTP route.

## 5. Limits

- The rule set is intentionally conservative and English/Arabic keyword based.
- It does not resolve contradictory constraints or invent missing values.
- The planner still uses deterministic plan templates; the profile is persisted and used for algorithm features, not a general semantic planner.
