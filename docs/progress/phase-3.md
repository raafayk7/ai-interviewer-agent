# Phase 3 Progress

## Phase 3 Complete (Batches A–D)

This document records the Phase 3 changes completed for the **AI interviewer** monorepo, scoped to document extraction and interview plan generation contracts, use cases, and Gemini infrastructure adapters.

Phase 3 goal:

- turn uploaded JD/CV file references into structured `JobDescription` and `CandidateInfo` payloads
- generate an `InterviewPlan` for an existing `Interview`
- schedule the interview through the existing domain transition
- keep the AI implementation behind application ports
- trace Gemini calls through AI SDK telemetry and the Phase 2 OpenTelemetry/Langfuse bootstrap

Plan source: `.claude/plan/phase-3-document-extraction-and-plan-generation.md`  
Architecture context: `docs/ARCHITECTURE.md`

---

## Summary

Completed batches:

- **Batch A:** application planner port, planner errors, extraction DTO, generate-plan DTO, and DTO tests
- **Batch B:** `ExtractCandidateDocumentsUseCase`, `GenerateInterviewPlanUseCase`, and use-case tests
- **Batch C:** Gemini provider factory, Gemini document extraction adapter, Gemini interview planner adapter, and backend tests
- **Batch D:** type-check + full test suite verification; ADR-007, ADR-008, ADR-009 authored and linted; `docs/adr/README.md` created

Explicitly not included in this phase:

- Fastify routes/controllers for these use cases
- automatic extraction inside upload
- Deepgram, ElevenLabs, real-time interview agent, evaluation, or reports

---

## Implementation Notes

The original Phase 3 plan referenced AI SDK `generateObject`. Local AI SDK 6 docs mark `generateObject` as deprecated, so the Gemini adapters use the current `generateText` plus `Output.object(...)` structured-output API instead.

The default Gemini model remains `gemini-2.5-pro`, matching the architecture and phase plan. The provider factory fails closed with `Result.Err(ServiceUnavailableError)` when `GOOGLE_GENERATIVE_AI_API_KEY` is missing, so tests can pass without a live key and runtime wiring can surface configuration errors cleanly later.

`ExtractCandidateDocumentsUseCase` accepts a document extractor factory:

- the application port stays narrow (`Buffer` + content type)
- the composition root can create a per-request `GeminiDocumentExtractionService`
- telemetry metadata can include `recruiterId` and the specific document key without widening the port

---

## Files Touched

### 1. `packages/application/src/ports/interview-planner/`

- added `IInterviewPlannerService`
- added `InterviewPlannerInput`
- added `PlannerError`, `PlannerUnavailableError`, `PlannerOutputInvalidError`, and `PlannerUnknownError`
- added a planner barrel export

### 2. `packages/application/src/ports/index.ts`

- exported the new interview planner port barrel

### 3. `packages/application/src/dtos/extract-candidate-documents.dto.ts`

- added `ExtractCandidateDocumentsInputDto`
- validates `recruiterId`, `jdFile.key`, `jdFile.contentType`, `cvFile.key`, and `cvFile.contentType`
- added `ExtractCandidateDocumentsOutput` carrying serialized `JobDescriptionProps` and `CandidateInfoProps`

### 4. `packages/application/src/dtos/generate-interview-plan.dto.ts`

- added `GenerateInterviewPlanInputDto`
- validates `interviewId`
- supports optional `targetDurationMinutes` and `maxDurationMinutes`
- rejects `maxDurationMinutes < targetDurationMinutes`
- added scalar `GenerateInterviewPlanOutput`

### 5. `packages/application/src/dtos/index.ts`

- exported the new Phase 3 DTOs and output types

### 6. `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts`

- downloads JD and CV blobs through `IFileStorageService`
- creates document-specific extractors through `DocumentExtractorFactory`
- calls `extractJobDescription` and `extractCandidateInfo`
- returns serialized domain value-object shapes
- short-circuits storage and extraction errors as `ServiceError`

### 7. `packages/application/src/use-cases/interview/generate-interview-plan.use-case.ts`

- loads an interview through `IInterviewRepository`
- maps repository errors to `ServiceUnknownError`
- maps missing interviews to `InterviewNotFoundError`
- calls `IInterviewPlannerService`
- applies `Interview.schedule(plan)`
- persists the scheduled interview
- returns the scheduled interview summary

### 8. `packages/application/src/use-cases/documents/index.ts`

- exported `ExtractCandidateDocumentsUseCase`
- exported `DocumentExtractorContext` and `DocumentExtractorFactory`

### 9. `packages/application/src/use-cases/interview/index.ts`

- exported `GenerateInterviewPlanUseCase`

### 10. `apps/backend/src/infrastructure/services/gemini/provider.ts`

- added `DEFAULT_GEMINI_MODEL`
- added `buildGeminiProvider`
- added `geminiProviderFromEnv`
- wraps `createGoogleGenerativeAI` behind a `Result`-returning factory

### 11. `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.ts`

- implements `IDocumentExtractionService`
- sends PDF/image/text buffers to Gemini as AI SDK file content parts
- uses `generateText` with `Output.object(...)`
- maps AI SDK errors to `DocumentExtractionError` subclasses
- lifts generated output through `JobDescription.create` and `CandidateInfo.create`
- adds AI SDK telemetry metadata for recruiter id, document key, and document kind

### 12. `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts`

- implements `IInterviewPlannerService`
- builds a prompt from serialized JD, candidate profile, client instructions, and duration overrides
- uses `generateText` with `Output.object(...)`
- maps AI SDK errors to planner error subclasses
- lifts generated topics through `PlannedTopic.create`
- lifts the final plan through `InterviewPlan.create`
- adds AI SDK telemetry metadata for interview id and duration settings

### 13. `apps/backend/src/infrastructure/services/gemini/index.ts`

- exported provider helpers and Gemini services

### 14. `apps/backend/src/infrastructure/services/index.ts`

- exported the Gemini services barrel

### 15. Tests

Added focused tests for:

- extraction DTO validation
- generate-plan DTO validation
- document extraction use case success and failure paths
- interview plan generation use case success and failure paths
- Gemini provider factory
- Gemini document extraction adapter
- Gemini interview planner adapter

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

Results:

- type-check passed for domain, application, and backend
- domain tests: **116 passed**
- application tests: **60 passed**
- backend tests: **49 passed**
- package-scoped targeted lint passed for all new application and backend files

Architecture checks:

- application files do not import infrastructure, presentation, Fastify, or Drizzle
- infrastructure files do not import presentation
- new async external calls are wrapped with `Result.tryAsyncCatch`
- no `throw` or direct `try/catch` in new production files
- AI SDK calls include telemetry settings
- generated AI output is validated again through domain factories before crossing back into the application flow

### Live Smoke Testing

After `GOOGLE_GENERATIVE_AI_API_KEY` was configured in `apps/backend/.env`, two live Gemini smoke checks were run against the compiled backend output.

First smoke:

- loaded the Gemini provider from env
- ran `GeminiDocumentExtractionService.extractJobDescription(...)` with a tiny text JD
- ran `GeminiDocumentExtractionService.extractCandidateInfo(...)` with a tiny text CV
- ran `GeminiInterviewPlannerService.generatePlan(...)`
- result: success with `gemini-2.5-pro`, 5 generated topics, and 2 must-ask questions

Second smoke:

- loaded `.env`
- started `initOtel(...)` so AI SDK telemetry had the Langfuse span processor attached
- ran the same extraction + planning path
- called `otel.shutdown()` to flush spans
- result: success with `gemini-2.5-pro`, 5 generated topics, and 3 must-ask questions
- Langfuse lookup id: `langfuse-smoke-1778339564906`

---

## ADRs

Three ADRs were authored and accepted as part of Batch D. All pass `adr-lint` (9/9 directory-wide).

| ADR | Decision |
|---|---|
| [ADR-007](../adr/ADR-007-persist-extracted-jd-cv-through-interview-aggregate-jsonb-columns.md) | Persist extracted JD/CV through the Interview aggregate's existing JSONB columns — no separate `documents` table, no sidecar files |
| [ADR-008](../adr/ADR-008-two-step-orchestration-extract-then-generate-plan.md) | Two-step orchestration: `ExtractCandidateDocumentsUseCase` then `GenerateInterviewPlanUseCase` — existing use cases unchanged, no extraction inside upload or create |
| [ADR-009](../adr/ADR-009-document-extraction-telemetry-via-factory-closure-not-port-widening.md) | Document-extraction telemetry via `DocumentExtractorFactory` closure — `IDocumentExtractionService` port stays narrow; recruiter/document-key metadata reaches Langfuse spans without contaminating the port contract |

`docs/adr/README.md` was also created as the ADR index for the full directory.

---

## Code Review

`backend-code-reviewer` was run against all Phase 3 files after implementation.

First pass returned **REVISION REQUIRED** with three Result-safety violations, all in test files:

1. `packages/application/src/use-cases/interview/generate-interview-plan.use-case.test.ts` — bare `.unwrap()` on `interview.schedule(makePlan())` without a preceding `expect(...isOk()).toBe(true)`.
2. `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts` — module-level `JobDescription.create(...).unwrap()` not guarded by an `isOk()` assertion.
3. Same file — module-level `CandidateInfo.create(...).unwrap()` not guarded by an `isOk()` assertion.

All three were fixed: the module-level VO constructions were converted to `makeJobDescription()` / `makeCandidateInfo()` helper functions that assert `expect(result.isOk()).toBe(true)` before unwrapping and are called from inside `it()` blocks. The bare `.unwrap()` in the state-transition test was guarded with an explicit `isOk()` assertion.

Second pass returned **PASS**. No further violations.

---

## Follow-Up

- wire these use cases and services in the Phase 7 presentation/composition root
