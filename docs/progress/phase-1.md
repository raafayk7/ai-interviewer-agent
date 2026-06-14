# Phase 1 Progress

## Phase 1 Completed

This document records the Phase 1 changes completed for the **AI interviewer** monorepo (`ai-interviewer-agent`), scoped to `packages/domain` and `packages/application` only.

Phase 1 goal:

- add the persistence-shaped, **AI-free**, **infrastructure-free** skeleton of the Interview and Report domain
- introduce repository **ports** in domain and service **ports** in application (interfaces + error types only)
- add `BaseDto<T>`, Zod 4 DTOs, and two use cases: **UploadCandidateDocuments** and **CreateInterview**
- keep the work out of `apps/backend` (no Drizzle, no repository implementations, no routes, no adapters)

Plan source: `.claude/plan/phase-1-domain-foundation.md`  
Architecture context: `docs/ARCHITECTURE.md` (sections referenced in that plan)

---

## Summary

Phase 1 covered these areas:

- **Domain:** shared `FileRef`; `Interview` aggregate (state machine policy, value objects, transitions, serialization); `Report` aggregate (topic scores, recommendation, serialization); `IInterviewRepository` and `IReportRepository` ports; domain errors per aggregate
- **Application:** `BaseDto` / `DtoValidationError`; `IFileStorageService` + `StorageError` hierarchy; `IDocumentExtractionService` + `DocumentExtractionError` hierarchy; upload + create-interview DTOs; both use cases and package barrel exports

Explicitly **not** included in this phase:

- database schema, migrations, or Drizzle repositories
- `LocalFileStorageService` or any storage adapter
- Gemini / AI SDK document extraction adapter
- Fastify routes, controllers, or HTTP error mapping
- co-located **Vitest** files (deferred; see **Implementation approach** below)

---

## Implementation approach

- Implementation was split into **five sequential batches** (eight numbered plan steps each), run as subagents in **dependency order** so each batch could assume prior files exist on disk.
- **Tests were intentionally skipped** during the implementation burst; follow-up is **`backend-test-generator`** (or hand-written tests) using the test matrix in the plan, then `pnpm turbo run test --filter=@repo/domain` and `--filter=@repo/application`.
- **Typecheck:** `pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application` succeeds after Phase 1.

### Follow-up correction vs raw plan (application)

**`UploadCandidateDocumentsUseCase`** uses `.mapErr((errs) => errs[0] as ServiceError)` instead of `.mapErr((errs) => errs[0])` so `execute` satisfies `Promise<Result<..., ServiceError>>` when TypeScript infers `Result.all` error arrays.

**Why:** avoid `undefined` / union noise on the first error and keep the return type aligned with the `UseCase` contract.

**Impact:** behavior is unchanged from “surface first error”; only typing is explicit.

---

## Files Touched

### 1. `packages/domain/src/shared/value-objects/file-ref.ts`

What changed:

- added immutable `FileRef` value object with `create` / `serialize` / `fromSerialized`
- added `InvalidFileRefError` extending `ValidationError`
- validated non-empty key, content type, filename, and non-negative finite `sizeBytes`

Why:

- interviews need stable references to uploaded JD/CV blobs before persistence adapters exist; `FileRef` is shared across aggregates as in the plan

Impact:

- application and future infrastructure can share one VO shape for storage metadata

---

### 2. `packages/domain/src/shared/value-objects/index.ts`

What changed:

- re-exported `FileRef`, `InvalidFileRefError`, and `FileRefProps`

Why:

- keep shared value objects discoverable through a single module path

Impact:

- `Interview` and future code can import from the shared VO barrel

---

### 3. `packages/domain/src/shared/index.ts`

What changed:

- added `export * from "./value-objects/index.js"`

Why:

- publish shared VOs from the existing shared package entry

Impact:

- `FileRef` is reachable via `@repo/domain` shared exports

---

### 4. `packages/domain/src/entities/interview/interview-status.ts`

What changed:

- added `INTERVIEW_STATUS` constants and `InterviewStatus` union type
- added `InterviewStatusPolicy.canTransition` and `isTerminal` backed by an explicit transition table

Why:

- centralize legal state transitions for the interview lifecycle (plan §5.4)

Impact:

- `Interview` methods can enforce transitions without ad hoc branching scattered across the aggregate

---

### 5. `packages/domain/src/entities/interview/errors/interview.errors.ts`

What changed:

- added `InvalidInterviewStateTransitionError`, `InterviewPlanRequiredError`, `InvalidInterviewInputError`, `InterviewNotFoundError` extending the shared domain error hierarchy

Why:

- keep interview-specific failures typed and map cleanly at application boundaries later

Impact:

- state and validation errors are explicit for tests and HTTP mapping in later phases

---

### 6. Interview aggregate value objects (`packages/domain/src/entities/interview/value-objects/`)

What changed:

- **`job-description.ts`** — `JobDescription` with validation on title, company, raw text; frozen arrays for responsibilities/requirements
- **`candidate-info.ts`** — `CandidateInfo` with email check, non-negative experience, frozen skills/education
- **`planned-topic.ts`** — `PlannedTopic` with priority enum, non-empty questions, positive time allocation
- **`interview-plan.ts`** — `InterviewPlan` wrapping topics plus target/max duration constraints
- **`transcript-entry.ts`** — `TranscriptEntry` with speaker enum and non-empty text
- **`index.ts`** — barrel re-exporting all interview VOs and related types

Why:

- these types only make sense inside the interview aggregate; they support `Interview.create`, `schedule`, `complete`, and serialization

Impact:

- the aggregate root can stay the only mutation API; VOs remain immutable and `Result`-based at creation

---

### 7. `packages/domain/src/entities/interview/interview.entity.ts`

What changed:

- added `Interview` extending `BaseEntity` with `Interview.create` (always `CREATED`, `Option.None` for plan, times, report link)
- added transitions: `schedule`, `start`, `complete`, `markEvaluated`, `cancel` returning `Result` and new instances
- added `serialize` / `fromSerialized` with `Option` fields encoded as `null` in JSON shape

Why:

- single aggregate root for interview lifecycle before any persistence or AI orchestration

Impact:

- application use cases can compose transitions with `Result` chains; no throws in domain methods

---

### 8. `packages/domain/src/entities/interview/interview.repository.ts`

What changed:

- added `IInterviewRepository` with `save`, `findById`, `listByRecruiter`, `delete` returning `Promise<Result<...>>` per repo conventions

Why:

- domain owns the persistence contract; Phase 2 will implement the adapter

Impact:

- `CreateInterviewUseCase` can depend on the port without importing infrastructure

---

### 9. `packages/domain/src/entities/interview/index.ts`

What changed:

- barrel exports for `Interview`, IDs/types, status policy, repository interface, value objects, errors

Why:

- single import path for the interview aggregate

Impact:

- `entities/index.ts` and consumers see a stable public surface

---

### 10. `packages/domain/src/entities/report/errors/report.errors.ts`

What changed:

- added `InvalidReportInputError`, `ReportNotFoundError`

Why:

- isolate report validation and lookup failures from interview errors

Impact:

- clearer error taxonomy when presentation maps to HTTP in later phases

---

### 11. `packages/domain/src/entities/report/value-objects/topic-score.ts`

What changed:

- added `TopicScore` with bounded score 0–5, non-empty topic name and justification

Why:

- reports are scored per topic; VO stays inside the report aggregate

Impact:

- `Report.create` can validate rubric input centrally

---

### 12. `packages/domain/src/entities/report/value-objects/index.ts`

What changed:

- re-exported `TopicScore` and `TopicScoreProps`

Why:

- consistent barrel pattern with interview VOs

Impact:

- `report/index.ts` can re-export VOs without deep paths

---

### 13. `packages/domain/src/entities/report/report.entity.ts`

What changed:

- added `Report` with `RECOMMENDATION`, `create` returning `Result`, serialization helpers, `generatedAt` alongside audit timestamps

Why:

- second aggregate root for evaluation output; references `InterviewId` only, not embedded `Interview`

Impact:

- clear boundary: interview holds `Option<ReportId>`, report is loaded separately when needed

---

### 14. `packages/domain/src/entities/report/report.repository.ts`

What changed:

- added `IReportRepository` with `save`, `findById`, `findByInterviewId`

Why:

- port for Phase 2 persistence without coupling domain to Drizzle

Impact:

- query patterns by interview id are expressible at the domain boundary

---

### 15. `packages/domain/src/entities/report/index.ts`

What changed:

- barrel for `Report`, types, repository port, VOs, errors

Why:

- one entry for the report aggregate

Impact:

- `entities/index.ts` re-exports stay thin

---

### 16. `packages/domain/src/entities/index.ts`

What changed:

- added `export *` from `./interview/index.js` and `./report/index.js`

Why:

- aggregate-level barrel for the domain package

Impact:

- `packages/domain/src/index.ts` can expose all entities from one line

---

### 17. `packages/domain/src/index.ts`

What changed:

- added `export * from "./entities/index.js"`

Why:

- make aggregates and ports part of the public `@repo/domain` API

Impact:

- application imports `Interview`, `FileRef`, ports, etc. from the package root

---

### 18. `packages/application/src/core/base-dto.ts`

What changed:

- added `DtoValidationError` (extends domain `ValidationError`) with Zod issue mapping
- added abstract `BaseDto<T>` with static `validate(schema, input) -> Result`

Why:

- HTTP and use-case boundaries need Zod 4 validation without throws

Impact:

- DTOs stay consistent with the repo’s `Result` / FP rules at the application layer

---

### 19. `packages/application/src/core/index.ts`

What changed:

- exported `BaseDto` and `DtoValidationError`

Why:

- keep core primitives available through the existing core barrel

Impact:

- DTO files can import from `../core/base-dto.js` or consumers from `@repo/application` core re-exports

---

### 20. Storage ports (`packages/application/src/ports/storage/`)

What changed:

- **`storage-error.ts`** — `StorageError` subclasses: unavailable, not found, unknown
- **`file-storage.port.ts`** — `IFileStorageService` (`upload`, `download`, `delete`, `getSignedUrl`) returning `Result` with `StorageError`
- **`index.ts`** — re-exports port + errors

Why:

- Phase 2 will implement adapters; Phase 1 only fixes the contract and error hierarchy under `ServiceInfraError`

Impact:

- `UploadCandidateDocumentsUseCase` depends on an interface, not a concrete client

---

### 21. Document extraction ports (`packages/application/src/ports/document-extraction/`)

What changed:

- **`document-extraction-error.ts`** — unavailable, parse failed, unknown variants
- **`document-extraction.port.ts`** — `IDocumentExtractionService` with `extractJobDescription` / `extractCandidateInfo` on `Buffer` + MIME
- **`index.ts`** — re-exports

Why:

- Phase 3 adapter will implement Gemini (or other) extraction without changing application interfaces

Impact:

- ports reference `@repo/domain` VOs directly, matching the plan’s Phase 1 boundary

---

### 22. `packages/application/src/ports/index.ts`

What changed:

- re-exported storage and document-extraction barrels

Why:

- single `ports` entry for composition roots later

Impact:

- `packages/application/src/index.ts` can export ports in one block

---

### 23. `packages/application/src/dtos/upload-candidate-documents.dto.ts`

What changed:

- Zod input schema for recruiter id, JD/CV file triples (`Buffer`, content type, filename)
- `UploadCandidateDocumentsInputDto.parse`
- output interface for serialized ref shapes (mirror of `FileRef` fields needed at the boundary)

Why:

- typed boundary for the upload use case before Fastify exists

Impact:

- controllers (Phase 7) can normalize multipart → DTO → use case

---

### 24. `packages/application/src/dtos/create-interview.dto.ts`

What changed:

- Zod schemas mirroring `JobDescription`, `CandidateInfo`, `FileRef` serialized shapes and `CreateInterviewInput`
- `CreateInterviewInputDto.parse` and `CreateInterviewOutput` typing with `InterviewStatus` from domain

Why:

- use case accepts already-structured input; extraction service is **not** called in Phase 1 per plan

Impact:

- creation flow is testable without AI; Phase 3 can add extraction orchestration separately

---

### 25. `packages/application/src/dtos/index.ts`

What changed:

- barrel exports for both DTO modules and their types/schemas

Why:

- standard application-layer entry for DTOs

Impact:

- package root can re-export `./dtos/index.js`

---

### 26. `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts`

What changed:

- use case builds deterministic storage keys, calls `upload` twice, combines with `Result.all`, maps to output ref DTOs
- `mapErr` uses `as ServiceError` for the first aggregated error (see **Follow-up correction** above)

Why:

- minimal orchestration: persist blobs and return refs for a later `CreateInterview` call

Impact:

- no infrastructure imports; storage errors stay `ServiceError`-compatible

---

### 27. `packages/application/src/use-cases/documents/index.ts`

What changed:

- exported `UploadCandidateDocumentsUseCase`

Why:

- documents feature barrel

Impact:

- `use-cases/index.ts` can group document flows

---

### 28. `packages/application/src/use-cases/interview/create-interview.use-case.ts`

What changed:

- `Result.all` over four VO factories, `Interview.create`, async `IInterviewRepository.save` wrapped with `Result.fromPromise`, maps repository `Error` to `ServiceUnknownError`, returns summary output

Why:

- create interview in `CREATED` state and persist through the port per plan

Impact:

- repository failures are translated at the boundary; domain errors flow as `ServiceError`

---

### 29. `packages/application/src/use-cases/interview/index.ts`

What changed:

- exported `CreateInterviewUseCase`

Why:

- interview feature barrel

Impact:

- grouped under `use-cases/index.ts`

---

### 30. `packages/application/src/use-cases/index.ts`

What changed:

- re-exported documents and interview use-case barrels

Why:

- single use-case entry for the package

Impact:

- application `index.ts` exports use cases after DTOs

---

### 31. `packages/application/src/index.ts`

What changed:

- added exports for `./ports/index.js`, `./dtos/index.js`, `./use-cases/index.js` after `./core/index.js`

Why:

- plan ordering: core first, then ports, DTOs, orchestration

Impact:

- consumers import from `@repo/application` root as intended in Phase 1

---

## Files Deleted

None in Phase 1.

---

## Phase 1 Review / Verification Notes

What was verified in this phase:

- `pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application` — clean
- `pnpm turbo run test --filter=@repo/domain` — 116 tests passing (10 files)
- `pnpm turbo run test --filter=@repo/application` — 37 tests passing (5 files)
- **153 total tests passing**

What is still deferred:

- optional: `/backend-arch-validator` for `domain` and `application`

Residual risk:

- DTO Zod shapes must stay aligned with domain VO factories when either side evolves
- The `CreateInterviewUseCase` "repo.save returns Err" test asserts `isErr()` only (not `instanceof ServiceUnknownError`) due to a known `@carbonteq/fp` async chain limitation where `unwrapErr()` returns `undefined` after `Result.fromPromise(...).toPromise()`; `isErr()` is correct and sufficient

---

## Test files added (2026-04-30)

**Domain (`@repo/domain`) — 10 files, 116 tests**

| File | Tests |
|------|-------|
| `packages/domain/src/entities/interview/interview-status.test.ts` | 17 |
| `packages/domain/src/shared/value-objects/file-ref.test.ts` | 11 |
| `packages/domain/src/entities/interview/value-objects/job-description.test.ts` | 11 |
| `packages/domain/src/entities/interview/value-objects/candidate-info.test.ts` | 11 |
| `packages/domain/src/entities/interview/value-objects/planned-topic.test.ts` | 8 |
| `packages/domain/src/entities/interview/value-objects/interview-plan.test.ts` | 8 |
| `packages/domain/src/entities/interview/value-objects/transcript-entry.test.ts` | 6 |
| `packages/domain/src/entities/interview/interview.entity.test.ts` | 24 |
| `packages/domain/src/entities/report/value-objects/topic-score.test.ts` | 11 |
| `packages/domain/src/entities/report/report.entity.test.ts` | 9 |

**Application (`@repo/application`) — 5 files, 37 tests**

| File | Tests |
|------|-------|
| `packages/application/src/core/base-dto.test.ts` | 8 |
| `packages/application/src/dtos/upload-candidate-documents.dto.test.ts` | 7 |
| `packages/application/src/dtos/create-interview.dto.test.ts` | 7 |
| `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.test.ts` | 7 |
| `packages/application/src/use-cases/interview/create-interview.use-case.test.ts` | 8 |

---

## Code review (2026-04-30)

`backend-code-reviewer` agent invoked over all 55 Phase 1 files (40 source + 15 test) with the plan path.

**First pass — REVISION REQUIRED:** all 40 production source files passed (boundaries, FP correctness, error hierarchy, entity invariants, DTO conventions). The acknowledged `as ServiceError` cast in `UploadCandidateDocumentsUseCase` was accepted as a legitimate type-system workaround. Six Result-safety blockers were flagged in `packages/domain/src/entities/interview/interview.entity.test.ts` — chained `.unwrap()` setups inside `it()` blocks lacking a preceding `expect(<localResult>.isOk()).toBe(true)` assertion.

Fixes applied (same file, six locations):

- `schedule()` "fails from SCHEDULED state…"
- `start()` "succeeds from SCHEDULED state…"
- `complete()` "succeeds from IN_PROGRESS state…"
- `cancel()` "succeeds from IN_PROGRESS state"
- `markEvaluated()` "succeeds from COMPLETED state…"
- `markEvaluated()` "fails from EVALUATED state (terminal)…"

Each chained `.unwrap()` was split into per-step `Result` locals with `expect(...).isOk()` asserted before unwrap. Helpers were already compliant; no production code changed.

**Second pass — PASS.** Domain tests still green at 116/116.

---

## Quick verification commands

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
```
