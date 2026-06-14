# Phase 6 Progress

## Phase 6 Complete

This document records the Phase 6 changes for the **AI interviewer** monorepo, scoped to post-interview evaluation and report retrieval.

Phase 6 goal:

- evaluate a `COMPLETED` interview with a separate Gemini evaluator call
- produce a structured `Report` from JD, CV, transcript, agent notes, internal scores, and a rubric
- persist the report through the existing report repository
- transition the interview to `EVALUATED` with `reportId` set
- expose a read-only use case for report lookup by interview ID

Plan source: `.claude/plan/phase-6-evaluation-and-reporting.md`  
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:

- [ADR-001](../adr/ADR-001-adopt-clean-architecture-ddd-with-immutable-entities-and-result-option-error-handling.md) - Clean Architecture, DDD, immutable entities, and Result/Option error handling
- [ADR-003](../adr/ADR-003-use-gemini-multimodal-for-document-ingestion.md) - Gemini remains the AI provider for structured interview intelligence
- [ADR-004](../adr/ADR-004-use-langfuse-and-opentelemetry-for-llm-observability.md) - AI calls carry telemetry for Langfuse/OpenTelemetry
- [ADR-007](../adr/ADR-007-persist-extracted-jd-cv-through-interview-aggregate-jsonb-columns.md) - JD/CV context is read from the interview aggregate
- [ADR-013](../adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md) - Phase 5 agent notes and internal scores feed evaluation
- [ADR-014](../adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md) - Evaluation uses the reserved `interview.evaluation` span namespace (D7c fulfilled by ADR-015)

ADRs authored:

- [ADR-015](../adr/ADR-015-phase-6-evaluation-span-schema-explicit-invocation-and-hardcoded-rubric.md) - Span schema for `interview.evaluation` (fulfills ADR-014 D7c), explicit invocation policy, hardcoded rubric strategy

---

## Summary

Completed:

- **Application ports and DTOs:** added `IInterviewEvaluatorService`, `InterviewEvaluatorInput`, evaluator error types, and `EvaluateInterviewInputDto`.
- **Application use cases:** added `EvaluateInterviewUseCase`, `GetReportByInterviewIdUseCase`, and the Phase 6 `EVALUATION_RUBRIC`.
- **Application validation:** `EvaluateInterviewUseCase` loads the interview, guards `COMPLETED`, short-circuits existing reports, invokes the evaluator, re-lifts output through `Report.create`, saves the report, and marks the interview `EVALUATED`.
- **Infrastructure:** added `GeminiInterviewEvaluatorService` using AI SDK `generateText` plus `Output.object(...)`, structured JSON schema validation, Gemini error mapping, topic-score re-lifting through `TopicScore.create`, telemetry metadata, and the `interview.evaluation` OTel span.
- **Composition:** added `buildEvaluateInterviewDeps()` to wire `DrizzleInterviewRepository`, `DrizzleReportRepository`, `GeminiInterviewEvaluatorService`, `EvaluateInterviewUseCase`, and `GetReportByInterviewIdUseCase`.
- **Tests:** added focused DTO, use-case, report retrieval, Gemini evaluator, and composition tests.
- **ADR-015:** authored to fulfill ADR-014 D7c's promise — records the `interview.evaluation` span name and attribute schema, the explicit-invocation policy (Q4), and the hardcoded-rubric strategy (Q3). Added Enforcement block with declarative `forbid_pattern` rules and `llm_judge: true` for nuanced drift detection.

Explicitly **not** included in this work:

- HTTP routes, controllers, or WebSocket plumbing for evaluation/report retrieval
- frontend report viewer
- new database tables, columns, or migrations
- automatic evaluation at the end of `ConductInterviewUseCase`
- rubric persistence or per-recruiter rubric configuration
- retry/circuit-breaker hardening or multi-evaluator workflows

---

## Implementation Notes

The evaluator follows the Phase 3 Gemini convention: AI SDK 6.0.158 with `generateText` and `Output.object(...)`, not the older `generateObject` API still named in the architecture overview.

Evaluator output is deliberately treated as untrusted twice. The infrastructure adapter validates the generated object shape and lifts each topic through `TopicScore.create`; the application use case then lifts the complete payload through `Report.create` before persistence.

Evaluation remains an explicit use case. The completed voice session can close cleanly, and Phase 7 can decide whether evaluation is triggered by a REST call, background job, or later workflow.

---

## Verification

Commands run and passing:

```bash
pnpm --filter=backend test -- src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts src/composition/evaluate-interview.composition.test.ts
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/application --filter=backend
```

Results:

- application tests: **99 passed**
- backend tests: **109 passed**
- focused backend evaluator/composition tests: **13 passed**
- type-check passed for `@repo/domain`, `@repo/application`, and `backend`

Architecture checks:

- application files do not import infrastructure, presentation, Fastify, or Drizzle
- infrastructure evaluator does not import presentation or persistence code
- new production application/infrastructure code has no direct `try/catch`
- expected evaluator failures cross boundaries as `Result.Err(...)`
- the only new boot-time `throw` is in composition, matching the existing Phase 5 composition pattern for fatal missing env

---

## Code Review

Initial review result: **PASS**.

Re-review result (this session — all 20 Phase 6 production and test files): **PASS**.

No boundary violations or FP correctness issues were found in the new application or Gemini infrastructure code. Composition wiring intentionally imports concrete infrastructure adapters and throws only at the boot boundary, consistent with `interview-session.composition.ts`.

Non-blocking style notes from re-review (no action required):
- `evaluate-interview.use-case.ts` uses imperative `if (isErr()) return` blocks consistent with sibling use cases; a chained-pipeline rewrite would be equivalent.
- `gemini-interview-evaluator.service.ts:264` closes the span after `.toPromise()` rather than via `.tap`/`.tapErr` — functionally identical; either style is acceptable.

Final verification after integration: **PASS** with 99 application tests, 109 backend tests, and type-check passing for domain, application, and backend.

---

## Notes

No live Gemini smoke was run for Phase 6. The evaluator adapter is unit-tested with mocked AI SDK responses and telemetry assertions; a live evaluation smoke can be run in Phase 7 once an HTTP surface or operator script exists.
