# ADR-007 Persist Extracted JD/CV Through the Interview Aggregate's Existing JSONB Columns

## Status

Accepted. Date: 2026-05-09.

## Context

Phase 3 adds `GeminiDocumentExtractionService`, which turns raw PDF/image blobs into typed domain value objects (`JobDescription`, `CandidateInfo`). Once extracted, those structured payloads must live somewhere in the database.

Phase 2 created an `interviews` table whose columns mirror `Interview.serialize()` 1:1. Two of those columns — `job_description` (JSONB) and `candidate_info` (JSONB) — already hold the serialized shape of the same VOs (`JobDescriptionProps`, `CandidateInfoProps`). Two additional columns — `jd_file_ref` and `cv_file_ref` — hold the storage keys pointing to the raw uploaded blobs.

The `Interview` aggregate is the only domain object that owns both the file references and the extracted content; there is no other aggregate that needs these VOs independently at this phase.

The decision is where to write the structured extraction result:

1. Into the existing `interviews.job_description` / `interviews.candidate_info` JSONB columns (the current `Interview` aggregate state), or
2. Into a separate `documents` table with its own rows, or
3. Into sidecar JSON files on disk next to the raw blob.

This choice directly affects Phase 7 wiring (how many DB writes the controller orchestration requires), Phase 5 (how the interview agent loads context), and any future multi-interview CV reuse scenario.

ADR-001 (Clean Architecture + DDD) mandates that aggregates are the sole owners of their state. ADR-005 (File Storage Abstraction) defines the raw-blob storage layer; its port does not include structured-payload storage.

## Decision

Store the structured `JobDescription` and `CandidateInfo` shapes through the existing `interviews.job_description` and `interviews.candidate_info` JSONB columns. No new `documents` table and no sidecar file are introduced in Phase 3.

The flow after this decision is:

1. `UploadCandidateDocumentsUseCase` — writes raw blobs to `IFileStorageService`; returns `FileRef`s. No DB write to `interviews`.
2. `ExtractCandidateDocumentsUseCase` — downloads blobs, calls `IDocumentExtractionService`, returns serialized VO shapes. No DB write.
3. `CreateInterviewUseCase` — creates `Interview` with the serialized VOs and file refs; persists via `IInterviewRepository`. The `interviews` row is written once, already containing the structured extraction.
4. `GenerateInterviewPlanUseCase` — loads the existing `Interview`, reads `interview.jobDescription` / `interview.candidateInfo` directly from the already-persisted aggregate, calls the planner, applies `Interview.schedule(plan)`, persists the updated row.

`Interview.serialize()` / `Interview.fromSerialized()` already handle the persistence shape. The Drizzle repository introduced in Phase 2 handles the round-trip without modification.

## Alternatives Considered

### Alternative A: Standalone `documents` table

Add a `documents` table (columns: `id`, `type` (`"jd"` | `"cv"`), `interview_id`, `file_ref`, `extracted_payload` JSONB, `created_at`). Write one row per extracted document. The `CreateInterviewUseCase` reads from this table to populate the `Interview` aggregate on creation.

Rejected because:

- **Duplicated ownership.** The Interview aggregate already holds `JobDescription` and `CandidateInfo` as value objects — they are part of its invariant set. A `documents` table would hold a second copy, creating two authorities for the same fact with no clear reconciliation policy.
- **Sync hazard.** If either side is written independently (by a background job, a retry, or a bug), they can diverge. The aggregate's value objects would reflect stale extraction while the `documents` table holds the fresher one, or vice versa.
- **Join cost on every load.** Every use case that loads an `Interview` to conduct or evaluate an interview would need to join or lookup the `documents` table to hydrate the VOs — a round-trip with no benefit given that the `interviews` row already carries the same data.
- **No independent consumer at this phase.** The only consumer of the extracted JD/CV data is the `Interview` aggregate. A separate table is justified when multiple aggregates reference the same document — that use case does not exist in Phases 3–7.

### Alternative B: Sidecar JSON file

Write `{fileRef.key}.extracted.json` next to the raw blob in `LocalFileStorageService` (and any future S3/R2 adapter). The extraction service writes the structured payload alongside the blob; the use case reads the sidecar at runtime.

Rejected because:

- **Third source of truth.** The system would then have three representations of the same data: the DB row (the `Interview` aggregate state), the raw blob, and the sidecar JSON. Any divergence between the DB row and the sidecar is an invisible bug.
- **Storage adapter scope creep.** `IFileStorageService` is defined in the application layer with four operations: `upload`, `download`, `delete`, `getSignedUrl`. Writing structured-domain payloads into the file-storage layer couples a domain concern (extraction result) to an infrastructure concern (object storage). This violates ADR-001's layer discipline.
- **Structured payloads are not file artefacts.** A `JobDescriptionProps` object is a domain value object, not a document. Storing it in a file system conflates content-addressable binary artefacts with typed business data.

### Alternative C: Widen `UploadCandidateDocumentsUseCase` to call extraction inline

Keep one table (the existing `interviews` table), but trigger document extraction inside the upload use case so that structured data is available when the interview is created.

Rejected at the use-case composition level (this is the subject of ADR-008). The data model outcome is the same as the chosen approach; the rejection here is about coupling rather than storage location.

## Consequences

**Benefits**

- Zero schema changes. The `interviews` table already has the right columns. Phase 3 ships with no new migrations.
- Single source of truth. The Interview aggregate is the one place that holds both the file reference and the structured extraction. No reconciliation logic required.
- `Interview.serialize()` / `Interview.fromSerialized()` already handle the round-trip. The Drizzle repository (`drizzle-interview.repository.ts`) is unchanged.
- The extraction result is available wherever the `Interview` aggregate is loaded — in the plan generation use case, the interview-conduct use case, and the evaluation use case — with no additional query.

**Trade-offs**

- Cross-interview CV reuse is not directly supported. If the same candidate applies to two roles, extraction runs twice and two `interviews` rows store separate (but identical) copies of the candidate's profile. At the current scale (a few hundred interviews per month) the duplication cost is negligible. A `documents` table becomes the better model if multi-interview CV reuse is ever required.
- The `interviews` table row grows larger as more JSONB columns are added. For very long CVs or JDs this may increase row size beyond typical PostgreSQL inline storage thresholds (~2 KB per TOAST threshold). Monitoring Langfuse token counts per extraction call provides an early signal.

**Risks and mitigations**

- *Risk*: Future phases introduce a CV reuse feature that requires the same candidate profile to be referenced from multiple interviews, making the per-interview copy approach expensive to change. *Mitigation*: The decision is explicit and reversible. A new ADR can supersede this one, add a `documents` table, and migrate the JSONB columns to foreign-key references. The port/adapter layer means use cases need only minor changes (load from `IDocumentRepository` instead of from the Interview aggregate).
- *Risk*: A large CV JSONB payload causes the `interviews` row to exceed PostgreSQL's TOAST inline threshold and be stored out-of-line, increasing load latency for row-wide queries. *Mitigation*: Enforce an upload size cap at the presentation layer (configurable, default 10 MB) before extraction is called. Monitor extracted payload sizes via Langfuse token counts per extraction span.

## Related Decisions

- **ADR-001 (Clean Architecture + DDD with Immutable Entities and Result/Option Error Handling)**: The Interview aggregate as sole owner of `JobDescription` and `CandidateInfo` is a direct application of ADR-001's rule that aggregates own their state. The JSONB persistence is mediated through `Interview.serialize()` / `Interview.fromSerialized()` as ADR-001 mandates.
- **ADR-003 (Use Gemini Multimodal for Document Ingestion)**: Documents the extraction port/adapter design. This ADR governs where the extraction result is stored after the adapter produces it.
- **ADR-005 (Abstract File Storage via Port and Adapter)**: Documents `IFileStorageService`. This ADR explicitly leaves raw-blob storage in the file-storage adapter and structured-payload storage in the aggregate — the two concerns are not conflated.
- **ADR-008 (Two-Step Orchestration: Extract Then Generate Plan)**: Documents the use-case composition that this storage decision enables. The two-step flow works because `CreateInterviewUseCase` accepts pre-extracted VOs, which are persisted into the aggregate's JSONB columns.

## References

- `packages/domain/src/entities/interview/interview.entity.ts` — `Interview.serialize()` and `Interview.fromSerialized()` methods; the canonical persistence shape.
- `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts` lines 60-80 — upsert via `onConflictDoUpdate`; writes `job_description` and `candidate_info` JSONB columns directly from `interview.serialize()`.
- `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts` — returns serialized `JobDescriptionProps` / `CandidateInfoProps`; does not write to the DB.
- `packages/application/src/use-cases/interview/create-interview.use-case.ts` — receives the serialized props via DTO and creates the `Interview` aggregate; the single DB write that stores the extraction result.
- `docs/ARCHITECTURE.md` §4.5 lines 188-197 — "Extraction happens once at upload time and the structured result is persisted alongside the raw file."
- `docs/progress/phase-2.md` §1 — Phase 2 schema design: `interviews` table mirrors `Interview.serialize()` 1:1.
- `docs/progress/phase-3.md` — Phase 3 implementation notes confirming no schema changes were introduced.
- `.claude/plan/phase-3-document-extraction-and-plan-generation.md` Decision A (lines 77-88) — original decision rationale from the plan generator.

## Enforcement

The critical invariant is that extraction results must not be written to a standalone `documents` table or to sidecar files in the storage adapter — they belong to the Interview aggregate's JSONB columns. `llm_judge: true` evaluates whether a staged diff adds a new `documents` table or writes structured-payload JSON through the storage adapter.

```json
{
  "forbid_pattern": [
    {
      "pattern": "CREATE TABLE.*\\bdocuments\\b",
      "path_glob": "apps/backend/src/infrastructure/db/**/*.ts",
      "message": "Structured JD/CV payloads live in interviews.job_description / interviews.candidate_info (ADR-007). Do not add a standalone documents table without superseding this ADR."
    },
    {
      "pattern": "\\.extracted\\.json",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Structured extraction results must not be written as sidecar JSON files (ADR-007). Persist through the Interview aggregate."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
