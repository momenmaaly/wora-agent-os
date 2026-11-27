# WORA V2 — Research and Advanced Reasoning Engine

This slice extends the existing WORA mission lifecycle. It does not add a parallel orchestrator, a second reasoning engine, or a separate research database.

## Repository findings

The repository already contained the parts this slice needed:

- **Mission lifecycle** — `createMission` / `executeMission` in `api-server/src/os/orchestrator.ts`.
- **Problem model** — `problem.ts`, `problem-model.ts`, `problem-structure.ts`.
- **Reasoning model** — `reasoning-types.ts`, `reasoning-engine.ts`, `reasoning-store.ts`; persisted as versioned JSON in `os_reasoning_models`.
- **Method catalog** — `algorithms.ts`, `science.ts`, `tools.ts` (`meta.select_algorithm`, `meta.select_scientific_method`).
- **Retrieval tools** — `web.fetch_read`, `browser.research`; both already enforce `safeFetch`, permissions, timeouts and audit.
- **Verification** — `independent-verification.ts`, `outcome-verification.ts`, `semantic-contracts.ts`.
- **Mission detail / UI** — `client/src/os/api.ts`, `BriefZone`, `RunZone`, `ApproachPreview`.

The missing piece was a connected research layer: deciding when external evidence is required, turning open reasoning needs into questions, preserving source provenance, comparing findings, and feeding the result back into the reasoning model. The existing explicit-URL branch planned raw `web.fetch_read` tasks but did not synthesize or attach their output to reasoning.

## Implemented flow

1. `createMission` builds the existing `UnifiedProblem` and deterministic `ReasoningModel`.
2. `planResearch` (`api-server/src/os/research.ts`) decides whether research is needed:
   - explicit URLs in the objective;
   - a `research` problem domain/need;
   - open reasoning needs that can be gathered;
   - an explicit research intent plus a research topic or unresolved unknowns.
3. The plan contains questions, materiality, candidate sources, the existing retrieval tool for each source, and explicit limitations. It never searches or fetches.
4. The plan is attached to `ReasoningModel.research` and saved with the mission. No migration is needed because reasoning is already JSON.
5. `buildPlan` continues to use the existing `web.fetch_read` tasks for explicit URLs. Execution still resolves the research agent, permissions, leases, checkpoints and verification through the normal path.
6. After a real retrieval result, `findingFromToolOutput` records URL, HTTP status, title, retrieval time, excerpt, SHA-256 digest and a heuristic stance.
7. `synthesizeResearch` produces answered/unanswered questions, conflicts, weak evidence and `retrieved-evidence` inputs.
8. The orchestrator feeds those inputs through `updateReasoningWithEvidence`, then saves the updated research state and writes a `research.evidence` audit event.
9. Failed retrievals are recorded as weak evidence and never become claims. A source with no output is not invented.

## Preflight consistency

`POST /api/os/capabilities/analyze` and `POST /api/os/problems/clarify` use the same `planResearch` function as mission creation. `POST /api/os/problems/research` exposes the plan directly.

If research is needed but no source exists, the plan is `unanswered` and clarification adds `research_sources`. The UI shows the gap rather than a fabricated result.

## UI

- `client/src/workspace/ResearchPanel.tsx` — research plan, questions, candidate sources and limitations in Brief (Guided/Advanced).
- `client/src/workspace/RunZone.tsx` — research status, finding count, unanswered count, conflicts and limitations in the Advanced context inspector.
- Arabic-first and English labels are in `client/src/i18n/dictionaries.ts`; RTL/LTR uses the existing document direction.

## Security controls

- Research never executes during planning.
- Retrieval uses the existing tool registry, so agent tool allowlists and permissions still apply.
- URLs with embedded credentials are dropped; token-like query values are redacted.
- Memory content is not copied into the research plan; deletable memory stays in the memory subsystem.
- Findings are `unverified` evidence; synthesis is explicitly extractive and heuristic.
- Secrets are not logged; audit records contain URL, status, digest prefix and counts.
- No new environment variables or external paid services are required.

## Tests

- `api-server/src/os/research.test.ts` — planning, no-source honesty, URL secret protection, conflict detection, failed retrieval, tool-output provenance, causal honesty, optimization non-trigger and a real local HTTP mission integration.
- `client/tests/experience-modes.test.mjs` — research plan is visible before launch, shows no-source state, and creates no mission.
- Existing reasoning, memory-deletion, verification and mission suites continue to pass.

## Known limitations

- No general web search provider; research uses explicit URLs or already-authorized tools.
- Stance detection is lexical and heuristic; it is not truth, causality, or currentness.
- Source publication dates are not parsed or freshness-scored.
- Research does not autonomously re-plan tasks after a conflict; it records the conflict and updates the reasoning model.
- No new database table was added; the research state lives in the existing versioned reasoning JSON.
