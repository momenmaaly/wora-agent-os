# WORA Experience Learning

**Status:** candidate collection, explicit evaluation, promotion and rejection implemented. Nothing is auto-promoted.
**Source:** `api-server/src/os/lessons.ts`, `memory.ts`, `verification.ts`, `orchestrator.ts`, `router.ts`.

## 1. Lifecycle

1. A completed mission may produce **candidate** lessons.
2. A candidate must contain a passed verification with artifact-integrity evidence.
3. Evaluation is explicit; it marks the lesson `tested` only when the evidence is sufficient.
4. Promotion is an explicit operator action; it writes a semantic memory record with provenance.
5. Rejection is explicit and leaves no promoted memory.

Candidate collection happens after a completed mission, but promotion never happens automatically.

## 2. Data

`os_lessons` records title, content, evidence, status, confidence, version, provenance, creator and promotion metadata. Promotion increments the lesson version and writes memory provenance `lesson:<id>`.

## 3. APIs

- `GET /api/os/lessons`
- `GET /api/os/lessons/:id`
- `POST /api/os/lessons/collect`
- `POST /api/os/lessons/:id/evaluate`
- `POST /api/os/lessons/:id/promote` (admin)
- `POST /api/os/lessons/:id/reject`

## 4. Tests

`api-server/src/os/lessons.test.ts` verifies candidate-only collection, no semantic memory before promotion, evaluation-before-promotion, semantic memory provenance, rejection and refusal to evaluate unverified content.

## 5. Limits

- Evaluation is evidence-presence and deterministic validation, not a new independent re-execution of the original task.
- There is no monitoring of promoted lessons after later failures.
- There is no lesson revocation endpoint yet; memory records remain governed by the existing memory API.
