# ADR-008 Two-Step Orchestration: Extract Then Generate Plan

## Status

Accepted. Date: 2026-05-09.

## Context

Phase 3 adds AI-driven document extraction (`IDocumentExtractionService`) and interview plan generation (`IInterviewPlannerService`). Both are expensive external calls (Gemini `generateObject` / `generateText + Output.object`) that happen before a voice interview can begin.

The question is how to compose these operations relative to the existing use cases (`UploadCandidateDocumentsUseCase`, `CreateInterviewUseCase`):

- Should extraction run inside the upload use case, inline with the file write?
- Should plan generation run inside the create-interview use case?
- Or should each step be its own discrete use case, chained by the presentation layer?

Clean Architecture mandates single-purpose use cases. This decision also affects error attribution, testability, and Phase 7 controller design.

ADR-001 (Clean Architecture + DDD) is the governing rule. ADR-003 (Gemini Multimodal Extraction) and ADR-007 (Persist Extracted JD/CV Through Aggregate JSONB) establish what each step produces and where the output lives.

## Decision

Introduce two new, single-purpose use cases and keep the existing ones unchanged:

1. **`ExtractCandidateDocumentsUseCase`** — takes `{ recruiterId, jdFile: { key, contentType }, cvFile: { key, contentType } }`. Downloads both blobs via `IFileStorageService`, calls `IDocumentExtractionService` for each, returns serialized `{ jobDescription: JobDescriptionProps, candidateInfo: CandidateInfoProps }`. No DB write.
2. **`GenerateInterviewPlanUseCase`** — takes `{ interviewId, targetDurationMinutes?, maxDurationMinutes? }`. Loads the `Interview` aggregate from `IInterviewRepository`, reads `interview.jobDescription` / `interview.candidateInfo` / `interview.clientInstructions` from the already-persisted aggregate, calls `IInterviewPlannerService`, applies `Interview.schedule(plan)`, and persists the updated aggregate. Returns a summary DTO.

The presentation layer (Phase 7) chains these calls in a four-step controller flow:

1. `UploadCandidateDocumentsUseCase` → `FileRef` pair (blob written to storage)
2. `ExtractCandidateDocumentsUseCase` → `{ jobDescription, candidateInfo }` (extraction, no DB write)
3. `CreateInterviewUseCase` → `Interview` in `CREATED` state (DB write, includes extracted VOs)
4. `GenerateInterviewPlanUseCase` → `Interview` in `SCHEDULED` state (DB write, plan attached)

Each step is independently retryable. A Gemini outage at step 2 does not affect the blob that was written at step 1. A plan-generation failure at step 4 does not require re-extraction.

## Alternatives Considered

### Alternative A: Extract inside `UploadCandidateDocumentsUseCase`

Add `IDocumentExtractionService` as a dependency of `UploadCandidateDocumentsUseCase`. After writing the blob, call the extraction service and return `{ fileRef, jobDescription }` or `{ fileRef, candidateInfo }` from the same use case.

Rejected because:

- **Violates single-responsibility.** `UploadCandidateDocumentsUseCase` is currently a pure storage operation: write a file, return a reference. Adding extraction couples blob persistence latency (~50ms local disk write) to Gemini latency (~1–3 seconds per document). A storage failure and an extraction failure are now indistinguishable from the caller's perspective.
- **Error attribution is wrong.** If the upload succeeds but extraction fails, the presentation layer receives a `DocumentExtractionUnavailableError` from what the caller believes is a storage operation. HTTP mapping becomes ambiguous: is this a 502 (AI service down) or a 500 (storage error)?
- **Forces re-upload on extraction retry.** If extraction fails transiently, the caller must re-upload the file to retry — even though the blob was already written successfully. With separate use cases, extraction can be retried independently by re-calling `ExtractCandidateDocumentsUseCase` with the existing `FileRef`.
- **Test complexity.** The existing `upload-candidate-documents.use-case.test.ts` is a focused unit test with one mock (storage). Adding an extraction mock conflates two failure dimensions.

### Alternative B: Extract inside `CreateInterviewUseCase`

Add `IDocumentExtractionService` as a dependency of `CreateInterviewUseCase`. The DTO carries raw file refs; the use case downloads and extracts before constructing the `Interview` aggregate.

Rejected because:

- **Use case knows too much.** `CreateInterviewUseCase`'s responsibility is to construct and persist a valid `Interview` aggregate. Orchestrating file downloads and AI extraction is a different concern. The use case would hold three dependency ports: a repository, a storage service, and an extraction service.
- **Forces re-extraction on plan retry.** If `GenerateInterviewPlanUseCase` is ever called again (for example if the initial plan generation times out), the controller would need to re-call `CreateInterviewUseCase` (which would re-extract), overwriting the `Interview` row — even though extraction already succeeded.
- **Breaks the existing DTO contract.** `CreateInterviewInputDto` already accepts pre-structured `JobDescriptionProps` and `CandidateInfoProps` (verified at `packages/application/src/dtos/create-interview.dto.ts`). Changing it to accept raw file refs is a breaking change to the public DTO surface and requires updating all existing tests.

### Alternative C: Single `InitiateInterviewUseCase` that does all four steps

Combine upload, extract, create, and plan generation into one use case. The recruiter calls one endpoint; all four Gemini calls and DB writes happen in a single transaction-like flow.

Rejected because:

- **A partial failure anywhere requires re-doing everything.** If plan generation times out after extraction already succeeded, the caller has no way to resume from step 4 — they must restart from step 1, incurring two additional Gemini calls.
- **No intermediate state is observable.** The recruiter UI cannot show "uploading..." → "extracting..." → "creating..." → "generating plan..." progress if these steps are opaque inside one use case.
- **Cannot be composed differently.** A future workflow where the recruiter reviews and edits the extracted JD before creating the interview becomes impossible without decomposing the monolith anyway.

## Consequences

**Benefits**

- Each use case is independently testable with a single mock boundary. `extract-candidate-documents.use-case.test.ts` mocks only `IFileStorageService` and `IDocumentExtractionService`; `generate-interview-plan.use-case.test.ts` mocks only `IInterviewRepository` and `IInterviewPlannerService`.
- Failures are attributable. A `StorageError` can only come from steps 1 and 2; a `DocumentExtractionError` only from step 2; a `PlannerError` only from step 4. The HTTP mapper in Phase 7 can produce exact status codes without ambiguity.
- Steps 1–3 are idempotent with respect to step 2: if extraction fails, the blob is already stored and can be re-extracted without re-uploading. If plan generation fails, the `Interview` row is already in `CREATED` state and can be re-planned by re-calling `GenerateInterviewPlanUseCase(interviewId)` with no other side effects.
- The existing `CreateInterviewUseCase` and `UploadCandidateDocumentsUseCase` are untouched. Phase 3 is purely additive.

**Trade-offs**

- Four HTTP round-trips from the frontend instead of one. The Phase 7 controller can mitigate this by providing a single composite endpoint that calls all four use cases server-side, returning after step 4 — the decomposition is internal to the backend, not necessarily visible to the frontend.
- The recruiter-facing flow has more latency exposed. A composite controller call still serialises four sequential operations (two Gemini calls for extraction, one Gemini call for planning). Total expected latency: 3–9 seconds. Acceptable for a pre-interview setup step; not acceptable for a real-time interview turn.

**Risks and mitigations**

- *Risk*: The presentation layer (Phase 7) implements the four-step chain incorrectly — for example calling `GenerateInterviewPlanUseCase` before `CreateInterviewUseCase`, which would return `InterviewNotFoundError`. *Mitigation*: The domain enforces state: `GenerateInterviewPlanUseCase` calls `Interview.schedule(plan)` which enforces `CREATED → SCHEDULED` only, returning `Err(InvalidInterviewStateTransitionError)` on any other state. The use case returns a typed error; the controller must map it to HTTP 409 Conflict (tagged for Phase 7).
- *Risk*: Extraction is called twice for the same document (race condition or user double-submit). *Mitigation*: `CreateInterviewUseCase` is idempotent at the domain level. If a duplicate `Interview` row is blocked by a unique constraint, the repository returns an error that the controller maps to HTTP 409. The extraction itself is stateless (downloads the blob, calls Gemini, returns VOs) and can run twice without side effects.

## Related Decisions

- **ADR-001 (Clean Architecture + DDD)**: Single-responsibility use cases are mandated by ADR-001's Clean Architecture rules. This ADR is a concrete application of that rule to the extraction/planning flow.
- **ADR-003 (Use Gemini Multimodal for Document Ingestion)**: The `IDocumentExtractionService` port that `ExtractCandidateDocumentsUseCase` depends on.
- **ADR-007 (Persist Extracted JD/CV Through Interview Aggregate JSONB)**: Documents where the output of `ExtractCandidateDocumentsUseCase` is eventually persisted. The two-step flow in this ADR is only coherent because the extraction output is handed to `CreateInterviewUseCase` as pre-structured VOs.
- **ADR-009 (Document-Extraction Telemetry via Factory Closure)**: Documents how `ExtractCandidateDocumentsUseCase` passes per-document telemetry context to the extraction adapter without widening the port interface.

## References

- `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts` — the new use case introduced by this decision.
- `packages/application/src/use-cases/interview/generate-interview-plan.use-case.ts` — the new plan-generation use case.
- `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts` — unchanged; no extraction added.
- `packages/application/src/use-cases/interview/create-interview.use-case.ts` — unchanged; accepts pre-structured VOs via DTO.
- `packages/application/src/dtos/extract-candidate-documents.dto.ts` — input DTO for the new extraction use case.
- `packages/application/src/dtos/generate-interview-plan.dto.ts` — input DTO for the new plan-generation use case.
- `.claude/plan/phase-3-document-extraction-and-plan-generation.md` Decision C (lines 95-99) — original two-step rationale from the plan generator.
- `docs/ARCHITECTURE.md` §3.2 (Clean Architecture Mapping) — layer responsibility boundaries.

## Enforcement

The critical invariant is that `UploadCandidateDocumentsUseCase` and `CreateInterviewUseCase` must not acquire `IDocumentExtractionService` or `IInterviewPlannerService` as dependencies. `llm_judge: true` evaluates whether a staged diff adds these ports to the constructor of either existing use case.

```json
{
  "forbid_pattern": [
    {
      "pattern": "IDocumentExtractionService",
      "path_glob": "packages/application/src/use-cases/interview/create-interview.use-case.ts",
      "message": "CreateInterviewUseCase must not depend on IDocumentExtractionService (ADR-008). Use ExtractCandidateDocumentsUseCase before calling CreateInterviewUseCase."
    },
    {
      "pattern": "IDocumentExtractionService",
      "path_glob": "packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts",
      "message": "UploadCandidateDocumentsUseCase must not depend on IDocumentExtractionService (ADR-008). Keep upload and extraction as separate use cases."
    },
    {
      "pattern": "IInterviewPlannerService",
      "path_glob": "packages/application/src/use-cases/interview/create-interview.use-case.ts",
      "message": "CreateInterviewUseCase must not depend on IInterviewPlannerService (ADR-008). Use GenerateInterviewPlanUseCase after CreateInterviewUseCase."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
