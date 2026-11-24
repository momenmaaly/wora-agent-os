# WORA Lesson Lifecycle

**Status:** implemented and tested.
**Source:** `api-server/src/os/lessons.ts`, `lessons.test.ts`.

## States

`candidate → tested → promoted → revoked`

`candidate` or `tested` may also become `rejected`.

Nothing is automatically promoted.

## Collection

A completed mission produces candidate lessons only from verification records that:

- passed;
- include a passed `acceptance-review`;
- include a passed `artifact-integrity` check;
- contain no failed check.

## Evaluation

Evaluation re-reads the real verification record referenced by the lesson evidence. A lesson with fabricated, missing or tampered evidence is rejected. Evaluation changes the state to `tested`; it does not create semantic memory.

## Promotion

Promotion is an admin-gated API action. It is transactional and conditional on `status = 'tested'`, so it cannot double-promote. It writes semantic memory with provenance `lesson:<id>` and records `memory_id` plus a history event.

## Outcomes and effectiveness

`POST /api/os/lessons/:id/outcomes` records a real success or failure. `effectiveness` is `success_count / outcome_count`; it is observed, never invented. Only promoted lessons accept outcomes.

## Revocation

`POST /api/os/lessons/:id/revoke` is admin-gated. It deletes the promoted semantic memory, sets status `revoked`, records the reason and actor, and preserves the event history.

## History

`os_lesson_events` records candidate, evaluate, promote, reject, outcome and revoke events. `GET /api/os/lessons/:id/history` returns them workspace-scoped.

## Limits

- No automatic regression monitor ties later failed missions back to a promoted lesson yet.
- There is no lesson edit/version-content workflow; the version counter records promotion.
- The effectiveness denominator is observed outcomes only, not all uses.
