# Plan: Phase 3 — Document Extraction & Plan Generation

> Generated: 2026-05-09
> Slug: phase-3-document-extraction-and-plan-generation
> Repo: `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent`
> Branch: `phase-3`
> Source documents read by the planner:
> - `docs/ARCHITECTURE.md` (full — §4.5, §4.6, §5.1, §6, §7 in particular)
> - `docs/progress/phase-1.md`, `docs/progress/phase-2.md`
> - `packages/application/src/ports/document-extraction/document-extraction.port.ts`
> - `packages/application/src/ports/document-extraction/document-extraction-error.ts`
> - `packages/domain/src/entities/interview/value-objects/interview-plan.ts`
> - `packages/domain/src/entities/interview/value-objects/planned-topic.ts`
> - `packages/domain/src/entities/interview/value-objects/job-description.ts`
> - `packages/domain/src/entities/interview/value-objects/candidate-info.ts`
> - `packages/domain/src/entities/interview/interview.entity.ts`
> - `packages/domain/src/entities/interview/interview.repository.ts`
> - `packages/domain/src/entities/interview/errors/interview.errors.ts`
> - `packages/application/src/use-cases/interview/create-interview.use-case.ts`
> - `packages/application/src/dtos/create-interview.dto.ts`
> - `packages/application/src/dtos/upload-candidate-documents.dto.ts`
> - `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts`
> - `packages/application/src/core/{service-error,base-dto,use-case}.ts`
> - `apps/backend/src/infrastructure/observability/otel.ts`
> - `apps/backend/src/infrastructure/services/local-file-storage.service.ts`
> - `apps/backend/src/infrastructure/repositories/{drizzle-interview.repository,errors/repository-error}.ts`
> - `apps/backend/package.json`, `apps/backend/.env`
> - AI SDK 6 typings: `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/.../dist/index.d.ts` (`generateObject`, `TelemetrySettings`, `NoObjectGeneratedError`)
> - AI SDK Google provider 3.x: `node_modules/.pnpm/@ai-sdk+google@3.0.61_zod@4.3.6/.../dist/index.d.ts` (`createGoogleGenerativeAI`)

---

## Summary

Phase 3 is the **first AI surface** in the backend. It turns raw uploaded JD/CV blobs into structured `JobDescription` / `CandidateInfo` value objects via Gemini, generates an `InterviewPlan` for an existing `Interview` aggregate, and persists the new plan via the existing state-machine transition (`Interview.schedule(plan)`).

Specifically Phase 3 introduces:

1. A **`GeminiDocumentExtractionService`** infrastructure adapter implementing the existing application port `IDocumentExtractionService`. It uses AI SDK 6's multimodal `generateObject` with `@ai-sdk/google` — one call for JD, one for CV — and translates output via the existing domain factories (`JobDescription.create` / `CandidateInfo.create`).
2. A **new application port `IInterviewPlannerService`** (input: extracted JD + CV + client instructions + optional duration overrides; output: `InterviewPlan` VO) plus its `PlannerError` hierarchy (subclass of `ServiceInfraError`).
3. A **`GeminiInterviewPlannerService`** infrastructure adapter implementing the planner port, again via AI SDK `generateObject` with a Zod 4 schema mirroring `InterviewPlanSerialized`/`PlannedTopicProps`.
4. A **`GenerateInterviewPlanUseCase`** application use case that loads the `Interview` by id, calls the planner port, applies `Interview.schedule(plan)`, and persists via `IInterviewRepository`. Returns the updated interview summary DTO.
5. A **`GenerateInterviewPlanInputDto`** (Zod 4, `BaseDto<T>`) carrying `interviewId` plus optional `targetDurationMinutes` / `maxDurationMinutes` overrides.
6. **Langfuse telemetry** wired through every Gemini call via AI SDK's native `experimental_telemetry: { isEnabled, functionId, metadata }` — using the OTel SDK that Phase 2 already starts in `main.ts`.
7. **Co-located Vitest suites** for every new file: extraction service, planner service, planner port input DTO, and the new use case. All AI SDK calls are mocked at the module boundary (`vi.mock("ai", ...)`).

After Phase 3 the backend can answer: "given an interview already in state `CREATED`, generate a plan and move it to `SCHEDULED`."

### Explicitly NOT in Phase 3

The following are out of scope and belong to later phases. The plan will not introduce them:

- **STT (Deepgram), TTS (ElevenLabs), the conversational interview agent** — Phases 4 and 5.
- **Evaluation pass / report generation** — Phase 6.
- **Fastify routes, controllers, or HTTP error mapping** for any of the new use cases — Phase 7.
- **Auto-extraction inside `UploadCandidateDocumentsUseCase`** (one of the architectural choices; see ADR call-out C below). We add a separate `ExtractCandidateDocumentsUseCase` instead.
- **Persisting structured extraction in a dedicated `documents` table.** Phase 3 does NOT extend the Phase-2 schema. Structured payloads ride the existing `interviews.job_description` / `interviews.candidate_info` JSONB columns through `Interview.serialize()` (the sole persistence shape). See ADR call-out A.
- **Modifying any existing Phase-1/Phase-2 production source file other than barrel exports.** All new behaviour is additive.

---

## Layers touched

| Layer          | Package / Location                      | Scope                                                                                                                                |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Domain         | `packages/domain/`                      | none — `Interview.schedule(plan)` already exists                                                                                     |
| Application    | `packages/application/`                 | New planner port + error hierarchy; new `GenerateInterviewPlanInputDto`; new `ExtractCandidateDocumentsUseCase`; new `GenerateInterviewPlanUseCase`; barrel updates |
| Infrastructure | `apps/backend/src/infrastructure/`      | New `GeminiDocumentExtractionService`, new `GeminiInterviewPlannerService`, new shared Gemini provider factory; barrel updates       |
| Presentation   | `apps/backend/src/presentation/`        | none (Phase 7)                                                                                                                       |

---

## Decision points / ADR call-outs

These choices are explicit and architecturally significant. Each should be captured as an ADR via `/adr-kit:adr` once the implementer ratifies them.

**A. Where do extracted JD/CV live?** *(ADR-worthy — this is the single biggest design call in Phase 3.)*

- **Chosen:** Store the structured `JobDescription` and `CandidateInfo` shapes through the **existing `interviews.job_description` and `interviews.candidate_info` JSONB columns** that Phase 2 already created. We do NOT introduce a separate `documents` table or sidecar JSON file.
- **Why:** Phase 2's `interviews` schema already mirrors `Interview.serialize()` 1:1 (`docs/progress/phase-2.md` §1). The aggregate root is the only owner of the structured JD/CV shape — these are domain value objects. Persisting them anywhere else duplicates state and creates a sync hazard. The existing `jdFileRef` / `cvFileRef` columns already hold the storage pointer to the raw blob, so the "structured alongside raw" requirement from `docs/ARCHITECTURE.md` §4.5 is satisfied (the `FileRef.key` resolves to the raw bytes; the JSONB column holds the structured extraction).
- **Implication on Phase-1 wiring:** `CreateInterviewUseCase` already accepts `JobDescription` and `CandidateInfo` directly (verified in `create-interview.use-case.ts` and `create-interview.dto.ts`). Phase 3 does not change that contract.
- **Consequence — flow:** Extraction must happen **before** `CreateInterviewUseCase`. The presentation layer (Phase 7) will:
  1. Call `UploadCandidateDocumentsUseCase` → get `FileRef`s for JD + CV blobs.
  2. Call new `ExtractCandidateDocumentsUseCase` → get `JobDescription` + `CandidateInfo` VOs (downloads each blob via `IFileStorageService`, hands bytes to `IDocumentExtractionService`).
  3. Call existing `CreateInterviewUseCase` → persist Interview in `CREATED`.
  4. Call new `GenerateInterviewPlanUseCase(interviewId)` → generate plan, transition `CREATED → SCHEDULED`, persist.
- **Alternative considered:** Extend `UploadCandidateDocumentsUseCase` to call extraction inline. **Rejected** because (a) it widens that use case from a pure storage operation into a multi-AI orchestration; (b) it makes the use case fail on extraction errors that have nothing to do with storage; (c) it couples upload latency to Gemini latency. Keeping the use cases composable and single-purpose is more in line with Clean Architecture.
- **Alternative considered:** Sidecar JSON file at `{key}.extracted.json` next to the raw blob. **Rejected** — adds a third source of truth (DB JSONB, raw blob, sidecar) without buying anything; storage adapter already abstracts away the raw blob; and the structured form is not a "file artefact" but a domain VO.

**B. New port `IInterviewPlannerService` lives in application, not domain.**

- The planner is an *external service* (it calls Gemini). Its interface belongs in `@repo/application/src/ports/`, mirroring `IDocumentExtractionService`. Its error type extends `ServiceInfraError` (not `DomainError`) — same pattern as `DocumentExtractionError` and `StorageError`.
- **Rejected alternative:** Make `InterviewPlan` capable of "creating itself from JD/CV" via a static method on the VO. That would either pull AI into the domain (violating §3.2) or require passing a port into the domain (also forbidden).

**C. Two-step orchestration (Extract, then Generate Plan), not one.** *(ADR-worthy — keeps composition clean.)*

- We add **`ExtractCandidateDocumentsUseCase`** that takes `FileRef`s + the `IFileStorageService` + `IDocumentExtractionService` and returns `{ jobDescription: JobDescriptionProps, candidateInfo: CandidateInfoProps }` (serialized, not VO instances — DTOs cross the use-case boundary in serialized form, mirroring `UploadCandidateDocumentsOutput`).
- We add **`GenerateInterviewPlanUseCase`** that takes only an `interviewId` (plus optional duration overrides), loads the Interview, reads `interview.jobDescription` / `interview.candidateInfo` / `interview.clientInstructions` from the loaded aggregate, calls the planner, applies the transition, and persists.
- **Why two:** Each is a discrete, testable orchestration. The planner has no business downloading files; the extractor has no business knowing about an `Interview` aggregate.

**D. `experimental_telemetry` is mandatory on every Gemini call.**

- Each `generateObject` invocation passes `{ isEnabled: true, functionId: "<adapter>.<method>", metadata: { interviewId?: string, kind?: "jd"|"cv" } }`. AI SDK 6's `TelemetrySettings` (verified in `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/.../index.d.ts:1104-1142`) emits OTel spans that the Langfuse `LangfuseSpanProcessor` from Phase 2 picks up automatically. No new OTel wiring is needed.
- **Implication:** The extraction adapter does not have an `interviewId` available (extraction runs before the Interview is created). Its telemetry metadata uses `recruiterId` and a synthetic `documentKey` (the `FileRef.key`) instead. The planner adapter has `interviewId`. This is documented per-adapter in Steps 6 and 8.

**E. Gemini model and provider factory.**

- Single shared factory: `apps/backend/src/infrastructure/services/gemini/provider.ts` exports a `getGeminiProvider()` that wraps `createGoogleGenerativeAI({ apiKey })`, returning a `Result<GoogleGenerativeAIProvider, ServiceInfraError>` so a missing `GOOGLE_GENERATIVE_AI_API_KEY` fails closed instead of throwing at import time.
- Default model: `gemini-2.5-pro` (per `docs/ARCHITECTURE.md` §4.5 — "Gemini 2.5 Pro accepts PDF and image input directly"). Both adapters allow override via constructor config so tests can pass a mock model.
- **Why a factory:** Lets the composition root (Phase 7) create one provider once and inject it into both adapters, instead of two adapters each instantiating the SDK with their own API-key probe.

**F. Error mapping.**

- AI SDK errors thrown from `generateObject` are caught with `Result.tryAsyncCatch` and mapped through a small per-adapter `mapAiError(operation, ctx)` translator into the right `ServiceInfraError` subclass:
  - `NoObjectGeneratedError` (model produced no JSON) → `DocumentExtractionParseFailedError` / `PlannerOutputInvalidError`
  - Any error whose name/message indicates network failure (e.g. `AI_RetryError` after exhausted retries, `fetch failed`, status 5xx) → `DocumentExtractionUnavailableError` / `PlannerUnavailableError`
  - Anything else → `DocumentExtractionUnknownError` / `PlannerUnknownError`
- Domain factory failures (`JobDescription.create` returning `Err(InvalidInterviewInputError)`) are translated by the *adapter* — the model output passed schema validation but failed domain invariants (e.g. blank title). The mapping is `InvalidInterviewInputError` → `DocumentExtractionParseFailedError` / `PlannerOutputInvalidError` because the adapter is the boundary between AI and domain.

**G. Repository errors at the boundary.**

- `GenerateInterviewPlanUseCase` calls `interviews.findById(...)` and `interviews.save(...)`. Both return `Promise<Result<…, Error>>` per the existing port contract. The use case translates any `Error` to `ServiceUnknownError(message, "InterviewRepository.<op>")` exactly as `CreateInterviewUseCase` does today. `RepositoryError` never crosses the application boundary (Rule from `CLAUDE.md`).

---

## Pre-flight checks (run before coding)

These verify the environment has the prerequisites Phase 3 assumes. None of these create files; they're sanity checks.

```bash
# 1. AI SDK + Google provider + Langfuse OTel are installed in apps/backend
node -e "console.log(require('./apps/backend/package.json').dependencies)" \
  | grep -E '"ai"|"@ai-sdk/google"|"@langfuse/otel"|"@opentelemetry/sdk-node"'

# 2. Phase 2 OTel bootstrap is in place — extracts/planner adapter rely on it
test -f apps/backend/src/infrastructure/observability/otel.ts && echo "OTel OK"

# 3. Existing port surface is unchanged (we only IMPLEMENT it)
rg -n "interface IDocumentExtractionService" packages/application/src

# 4. Required env vars (load order: process.env → .env)
#    - GOOGLE_GENERATIVE_AI_API_KEY    (Gemini auth — currently commented out in .env, must be uncommented before runtime)
#    - LANGFUSE_PUBLIC_KEY             (verified present in apps/backend/.env)
#    - LANGFUSE_SECRET_KEY             (verified present in apps/backend/.env)
#    - LANGFUSE_BASE_URL               (verified present in apps/backend/.env)
#    - DATABASE_URL                    (verified present in apps/backend/.env)
grep -E "^GOOGLE_GENERATIVE_AI_API_KEY|^LANGFUSE_" apps/backend/.env

# 5. Type-check baseline is currently clean
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
```

If `GOOGLE_GENERATIVE_AI_API_KEY` is still commented out in `.env`, the tests will pass (they mock `ai`), but runtime startup of any Phase 7 controller wiring these adapters will return `Result.Err(ServiceUnavailableError)` from `getGeminiProvider()`. This is the correct fail-closed behaviour, not a bug.

---

## Verified facts about Phase 1/2 surface area

(re-stated so each implementation step is self-checking)

- `IDocumentExtractionService` is **already defined** at `packages/application/src/ports/document-extraction/document-extraction.port.ts` with `extractJobDescription(file: Buffer, contentType: string)` and `extractCandidateInfo(file: Buffer, contentType: string)`, both returning `Promise<Result<JobDescription | CandidateInfo, DocumentExtractionError>>`. **Phase 3 implements the adapter only — the port stays untouched.**
- `DocumentExtractionError` already has three subclasses: `DocumentExtractionUnavailableError`, `DocumentExtractionParseFailedError(message, documentKey)`, `DocumentExtractionUnknownError`. Phase 3 reuses them as-is.
- `Interview.schedule(plan: InterviewPlan)` is already implemented and returns `Result<Interview, InvalidInterviewStateTransitionError | InterviewPlanRequiredError>`. It enforces `CREATED → SCHEDULED` only. **Phase 3 calls it; does not modify it.**
- `IInterviewRepository.save(interview)` upserts (verified in `drizzle-interview.repository.ts:60-80`); the second save by the planner use case will land on `onConflictDoUpdate`.
- `IInterviewRepository.findById(id)` returns `Promise<Result<Option<Interview>, Error>>` — the use case must use `Option.match` (or `flatMap` over it) and translate `Option.None` to `InterviewNotFoundError` (already defined at `packages/domain/src/entities/interview/errors/interview.errors.ts:26`).
- `IFileStorageService.download(key)` returns `Promise<Result<Buffer, StorageError>>` — exactly what the extraction adapter consumes.
- `BaseDto.validate(schema, raw)` returns `Result<T, DtoValidationError>`. `DtoValidationError extends ValidationError extends DomainError`, so it's `ServiceError`-assignable.
- `ServiceUnknownError(message, operation)` is the standard "translated repository error" — used by `CreateInterviewUseCase` already; we mirror that pattern.
- AI SDK `generateObject` accepts `experimental_telemetry?: TelemetrySettings` (verified at `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/.../index.d.ts:5193`). `TelemetrySettings` includes `isEnabled`, `functionId`, `metadata: Record<string, AttributeValue>`.
- AI SDK 6 multimodal input shape: pass `messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "file", data: buffer, mediaType: contentType }] }]` (verified in `ai@6.0.158` docs — content parts of type `"file"` accept `Uint8Array | Buffer | URL | string`). We use `data: buffer` and `mediaType: contentType`.
- `@ai-sdk/google@3.0.61` exports `createGoogleGenerativeAI({ apiKey })` returning a `GoogleGenerativeAIProvider` that is callable as `provider("gemini-2.5-pro")` to produce a `LanguageModel`.

---

## File tree (Phase 3)

```
packages/application/src/
├── ports/
│   ├── interview-planner/                                   [CREATE]
│   │   ├── interview-planner.port.ts                        [CREATE]
│   │   ├── interview-planner-error.ts                       [CREATE]
│   │   └── index.ts                                         [CREATE]
│   └── index.ts                                             [MODIFY  — add planner barrel re-export]
├── dtos/
│   ├── extract-candidate-documents.dto.ts                   [CREATE]
│   ├── extract-candidate-documents.dto.test.ts              [CREATE]
│   ├── generate-interview-plan.dto.ts                       [CREATE]
│   ├── generate-interview-plan.dto.test.ts                  [CREATE]
│   └── index.ts                                             [MODIFY  — re-export both new DTOs]
├── use-cases/
│   ├── documents/
│   │   ├── extract-candidate-documents.use-case.ts          [CREATE]
│   │   ├── extract-candidate-documents.use-case.test.ts     [CREATE]
│   │   └── index.ts                                         [MODIFY]
│   └── interview/
│       ├── generate-interview-plan.use-case.ts              [CREATE]
│       ├── generate-interview-plan.use-case.test.ts         [CREATE]
│       └── index.ts                                         [MODIFY]
└── (no other application files change)

apps/backend/src/infrastructure/services/
├── gemini/
│   ├── provider.ts                                          [CREATE]
│   ├── provider.test.ts                                     [CREATE]
│   ├── gemini-document-extraction.service.ts                [CREATE]
│   ├── gemini-document-extraction.service.test.ts           [CREATE]
│   ├── gemini-interview-planner.service.ts                  [CREATE]
│   ├── gemini-interview-planner.service.test.ts             [CREATE]
│   └── index.ts                                             [CREATE]
└── index.ts                                                 [MODIFY  — re-export ./gemini barrel]
```

No domain files change. No schema files change. No `apps/backend/src/main.ts` or `app.ts` change (composition root for the new adapters lands in Phase 7).

---

## Implementation steps

Steps are grouped into **four batches**. Each batch is self-contained and type-checks on its own once finished:

- **Batch A — Application port + DTOs.** No infrastructure, no use cases yet. Lays the contracts.
- **Batch B — Application use cases.** Depends only on Batch A and existing Phase-1 ports. Uses `vi.fn()` mocks throughout the tests.
- **Batch C — Gemini infrastructure adapters.** Depends only on the existing application ports (Phase 1 + Batch A). Mocks `ai` and `@ai-sdk/google` modules in tests.
- **Batch D — Verification.** Type-check, full test suite, ADR drafts.

Within a batch, steps are listed in the order they should be implemented.

---

### ─────────── BATCH A — Application contracts ───────────

### Step 1 — App: `IInterviewPlannerService` port

**File:** `packages/application/src/ports/interview-planner/interview-planner.port.ts` (CREATE)

**What:** Defines the contract for any service that synthesizes an `InterviewPlan` from extracted JD/CV plus client instructions. Lives in the application layer per Decision B.

**Code:**
```typescript
import type { Result } from "@carbonteq/fp";
import type {
  CandidateInfo,
  InterviewId,
  InterviewPlan,
  JobDescription,
} from "@repo/domain";
import type { PlannerError } from "./interview-planner-error.js";

/**
 * Input to the planner. All fields are domain-level (VOs or scalars). The adapter
 * is free to translate these to whatever prompt shape the underlying model wants.
 *
 * `interviewId` is included for telemetry only (so per-interview spans can be filtered
 * in Langfuse). The planner does NOT load or persist anything itself — that is the
 * GenerateInterviewPlanUseCase's job.
 */
export interface InterviewPlannerInput {
  readonly interviewId: InterviewId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly targetDurationMinutes?: number;
  readonly maxDurationMinutes?: number;
}

export interface IInterviewPlannerService {
  generatePlan(input: InterviewPlannerInput): Promise<Result<InterviewPlan, PlannerError>>;
}
```

**Invariant check:**
- Input/output types reference only `@repo/domain` exports (`InterviewId`, `JobDescription`, `CandidateInfo`, `InterviewPlan`).
- Return type is `Promise<Result<…, PlannerError>>` — no throws, no `T | null`.
- Application layer does not import infrastructure.

---

### Step 2 — App: `PlannerError` hierarchy

**File:** `packages/application/src/ports/interview-planner/interview-planner-error.ts` (CREATE)

**What:** Subclasses of `ServiceInfraError` mirroring the shape of `DocumentExtractionError`. Three concrete codes: unavailable, output invalid (model returned something we cannot lift to a valid `InterviewPlan` VO), unknown.

**Code:**
```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class PlannerError extends ServiceInfraError {}

export class PlannerUnavailableError extends PlannerError {
  readonly code = "PLANNER_UNAVAILABLE";
}

/**
 * Raised when the model returns output that does not satisfy the schema OR
 * that cannot be lifted into an `InterviewPlan` VO via domain factories
 * (e.g. blank topic name, zero topics, target > max).
 */
export class PlannerOutputInvalidError extends PlannerError {
  readonly code = "PLANNER_OUTPUT_INVALID";
  constructor(message: string, readonly interviewId: string) {
    super(message);
  }
}

export class PlannerUnknownError extends PlannerError {
  readonly code = "PLANNER_UNKNOWN";
  constructor(message: string, readonly operation: string) {
    super(message);
  }
}
```

**Invariant check:**
- All errors extend `ServiceInfraError` (assignable to `ServiceError`).
- Each has a stable string `code` for HTTP mapping in Phase 7.

---

### Step 3 — App: planner port barrel

**File:** `packages/application/src/ports/interview-planner/index.ts` (CREATE)

```typescript
export type { IInterviewPlannerService, InterviewPlannerInput } from "./interview-planner.port.js";
export {
  PlannerError,
  PlannerUnavailableError,
  PlannerOutputInvalidError,
  PlannerUnknownError,
} from "./interview-planner-error.js";
```

**File:** `packages/application/src/ports/index.ts` (MODIFY)

Append one line so the new barrel is exposed through `@repo/application`:

```typescript
export * from "./storage/index.js";
export * from "./document-extraction/index.js";
export * from "./interview-planner/index.js";   // ← added
```

**Invariant check:** Barrel export is mandatory per `CLAUDE.md` ("New public types in `@repo/domain` or `@repo/application` must be exported from the package barrel").

---

### Step 4 — App: `ExtractCandidateDocumentsInputDto`

**File:** `packages/application/src/dtos/extract-candidate-documents.dto.ts` (CREATE)

**What:** Input DTO for the new `ExtractCandidateDocumentsUseCase`. Carries the storage keys for the JD and CV (already-uploaded blobs), plus their content types so the adapter can pick the right MIME for Gemini.

**Code:**
```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { CandidateInfoProps, JobDescriptionProps } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileRefLikeSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
});

export const ExtractCandidateDocumentsInputSchema = z.object({
  recruiterId: z.string().min(1),
  jdFile: FileRefLikeSchema,
  cvFile: FileRefLikeSchema,
});

export type ExtractCandidateDocumentsInput = z.infer<typeof ExtractCandidateDocumentsInputSchema>;

export class ExtractCandidateDocumentsInputDto extends BaseDto<ExtractCandidateDocumentsInput> {
  static parse(raw: unknown): Result<ExtractCandidateDocumentsInputDto, DtoValidationError> {
    return BaseDto.validate(ExtractCandidateDocumentsInputSchema, raw).map(
      (v) => new ExtractCandidateDocumentsInputDto(v),
    );
  }
}

/** Output: serialized VO shapes — VOs themselves are domain-internal. */
export interface ExtractCandidateDocumentsOutput {
  readonly jobDescription: JobDescriptionProps;
  readonly candidateInfo: CandidateInfoProps;
}
```

**Invariant check:**
- Extends `BaseDto<T>` with Zod 4 schema and `BaseDto.validate(...)`.
- Output type uses `JobDescriptionProps` / `CandidateInfoProps` (the serialized shape) so callers don't need to import VO classes; mirrors how `UploadCandidateDocumentsOutput` returns ref shapes, not `FileRef` instances.

---

### Step 5 — App: `GenerateInterviewPlanInputDto`

**File:** `packages/application/src/dtos/generate-interview-plan.dto.ts` (CREATE)

**What:** Input DTO for `GenerateInterviewPlanUseCase`. Only mandatory field is `interviewId`. Optional duration overrides allow recruiters (later, in Phase 7/8) to nudge the planner toward a shorter or longer interview.

**Code:**
```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { InterviewStatus } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const GenerateInterviewPlanInputSchema = z
  .object({
    interviewId: z.string().min(1),
    targetDurationMinutes: z.number().int().positive().optional(),
    maxDurationMinutes: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.targetDurationMinutes === undefined ||
      v.maxDurationMinutes === undefined ||
      v.maxDurationMinutes >= v.targetDurationMinutes,
    { message: "maxDurationMinutes must be >= targetDurationMinutes", path: ["maxDurationMinutes"] },
  );

export type GenerateInterviewPlanInput = z.infer<typeof GenerateInterviewPlanInputSchema>;

export class GenerateInterviewPlanInputDto extends BaseDto<GenerateInterviewPlanInput> {
  static parse(raw: unknown): Result<GenerateInterviewPlanInputDto, DtoValidationError> {
    return BaseDto.validate(GenerateInterviewPlanInputSchema, raw).map(
      (v) => new GenerateInterviewPlanInputDto(v),
    );
  }
}

/** Mirrors the existing CreateInterviewOutput shape so callers see a consistent summary. */
export interface GenerateInterviewPlanOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;       // expected to be "SCHEDULED" on success
  readonly topicCount: number;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
}
```

**Invariant check:**
- Refinement enforces the same domain rule that `InterviewPlan.create` enforces (target ≤ max).
- Output type carries only scalars — VO instances are not serialized to clients.

---

### Step 6 — App: barrel updates for new DTOs

**File:** `packages/application/src/dtos/index.ts` (MODIFY)

Append these exports (preserving existing two blocks):

```typescript
export {
  ExtractCandidateDocumentsInputDto,
  ExtractCandidateDocumentsInputSchema,
} from "./extract-candidate-documents.dto.js";
export type {
  ExtractCandidateDocumentsInput,
  ExtractCandidateDocumentsOutput,
} from "./extract-candidate-documents.dto.js";

export {
  GenerateInterviewPlanInputDto,
  GenerateInterviewPlanInputSchema,
} from "./generate-interview-plan.dto.js";
export type {
  GenerateInterviewPlanInput,
  GenerateInterviewPlanOutput,
} from "./generate-interview-plan.dto.js";
```

---

### ─────────── BATCH B — Application use cases ───────────

### Step 7 — App: `ExtractCandidateDocumentsUseCase`

**File:** `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts` (CREATE)

**What:** Downloads JD and CV blobs from `IFileStorageService`, hands the buffers to `IDocumentExtractionService`, returns the serialized VO shapes. Errors short-circuit the chain.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import type { CandidateInfo, JobDescription } from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import type { ServiceError } from "../../core/service-error.js";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";
import type { IDocumentExtractionService } from "../../ports/document-extraction/document-extraction.port.js";
import type {
  ExtractCandidateDocumentsInput,
  ExtractCandidateDocumentsOutput,
} from "../../dtos/extract-candidate-documents.dto.js";

export class ExtractCandidateDocumentsUseCase extends UseCase<
  ExtractCandidateDocumentsInput,
  ExtractCandidateDocumentsOutput
> {
  constructor(
    private readonly storage: IFileStorageService,
    private readonly extractor: IDocumentExtractionService,
  ) {
    super();
  }

  async execute(
    input: ExtractCandidateDocumentsInput,
  ): Promise<Result<ExtractCandidateDocumentsOutput, ServiceError>> {
    const jdBytesR = await this.storage.download(input.jdFile.key);
    const cvBytesR = await this.storage.download(input.cvFile.key);

    return Result.all(jdBytesR, cvBytesR)
      .mapErr((errs) => errs[0] as ServiceError)
      .toAsyncResult()                                              // chain → AsyncResult for downstream awaits
      .flatMap(async ([jdBytes, cvBytes]) => {
        const jdR = await this.extractor.extractJobDescription(jdBytes, input.jdFile.contentType);
        const ciR = await this.extractor.extractCandidateInfo(cvBytes, input.cvFile.contentType);
        return Result.all(jdR, ciR).mapErr((errs) => errs[0] as ServiceError);
      })
      .map(([jd, ci]: [JobDescription, CandidateInfo]) => ({
        jobDescription: jd.serialize(),
        candidateInfo: ci.serialize(),
      }))
      .toPromise();
  }
}
```

**Notes for the implementer:**
- If `Result.toAsyncResult()` is not available in `@carbonteq/fp@0.9.1`, use the following equivalent pattern (already used by `CreateInterviewUseCase`):
  ```typescript
  return Result.all(jdBytesR, cvBytesR)
    .mapErr((errs) => errs[0] as ServiceError)
    .flatMap((bufs) =>
      Result.fromPromise(
        Promise.all([
          this.extractor.extractJobDescription(bufs[0], input.jdFile.contentType),
          this.extractor.extractCandidateInfo(bufs[1], input.cvFile.contentType),
        ]).then(([jdR, ciR]) =>
          Result.all(jdR, ciR).mapErr((errs) => errs[0] as ServiceError),
        ),
      ),
    )
    /* …unwrap one Result level if Result.fromPromise wraps to Result<Result<>>… */
    .toPromise();
  ```
  Validate which pattern the existing codebase uses by re-reading `create-interview.use-case.ts` lines 38–43 and `upload-candidate-documents.use-case.ts` lines 38–42; mirror that idiom (`Result.all` over already-awaited results is the simplest and matches `UploadCandidateDocumentsUseCase` exactly).
- **No try/catch.** Both port methods already return `Result`; we never need to catch.

**Invariant check:**
- No `@ai-sdk/*` import in application. Adapter implementations live in infrastructure.
- `RepositoryError` not referenced — this use case doesn't touch a repo.
- `StorageError` and `DocumentExtractionError` are already `ServiceInfraError`-subclasses, so `as ServiceError` is sound.

---

### Step 8 — App: `GenerateInterviewPlanUseCase`

**File:** `packages/application/src/use-cases/interview/generate-interview-plan.use-case.ts` (CREATE)

**What:** Loads an Interview by id, calls the planner, applies `Interview.schedule(plan)`, persists the result via the existing repository port. Returns a summary DTO.

**Code:**
```typescript
import { Option, Result } from "@carbonteq/fp";
import {
  type IInterviewRepository,
  Interview,
  InterviewNotFoundError,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import type { IInterviewPlannerService } from "../../ports/interview-planner/interview-planner.port.js";
import type {
  GenerateInterviewPlanInput,
  GenerateInterviewPlanOutput,
} from "../../dtos/generate-interview-plan.dto.js";

export class GenerateInterviewPlanUseCase extends UseCase<
  GenerateInterviewPlanInput,
  GenerateInterviewPlanOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly planner: IInterviewPlannerService,
  ) {
    super();
  }

  async execute(
    input: GenerateInterviewPlanInput,
  ): Promise<Result<GenerateInterviewPlanOutput, ServiceError>> {
    // ── 1. Load the interview, translate repo Error → ServiceUnknownError, None → NotFound ──
    const loadedR = (await this.interviews.findById(input.interviewId))
      .mapErr((e): ServiceError => new ServiceUnknownError(e.message, "InterviewRepository.findById"))
      .flatMap((maybe: Option<Interview>) =>
        maybe.match<Result<Interview, ServiceError>>({
          Some: (iv) => Result.Ok(iv),
          None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
        }),
      );

    if (loadedR.isErr()) return loadedR as Result<never, ServiceError>;
    const interview = loadedR.unwrap();

    // ── 2. Call the planner (await once; planner returns Result<InterviewPlan, PlannerError>) ──
    const planR = await this.planner.generatePlan({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      targetDurationMinutes: input.targetDurationMinutes,
      maxDurationMinutes: input.maxDurationMinutes,
    });

    // ── 3. Apply the state-machine transition. Domain returns Result<Interview, DomainError>. ──
    return planR
      .mapErr((e): ServiceError => e)                              // PlannerError ⊆ ServiceInfraError ⊆ ServiceError
      .flatMap((plan) => interview.schedule(plan).mapErr((e): ServiceError => e))
      .toAsyncResult()
      .flatMap(async (scheduled) =>
        (await this.interviews.save(scheduled)).mapErr(
          (e): ServiceError => new ServiceUnknownError(e.message, "InterviewRepository.save"),
        ),
      )
      .map((saved): GenerateInterviewPlanOutput => {
        const planVo = saved.interviewPlan.match({
          Some: (p) => p,
          None: () => {
            // Should be impossible — `schedule(plan)` sets it. Guard for TS exhaustiveness.
            throw new Error("invariant: scheduled interview missing plan");
          },
        });
        return {
          interviewId: saved.id,
          status: saved.status,
          topicCount: planVo.topics.length,
          targetDurationMinutes: planVo.targetDurationMinutes,
          maxDurationMinutes: planVo.maxDurationMinutes,
        };
      })
      .toPromise();
  }
}
```

**Notes for the implementer:**
- The `throw new Error("invariant: …")` in the final `.map(...)` is a TypeScript exhaustiveness guard for an Option that we know is `Some` because we just called `.schedule(plan)` two lines up. Two acceptable alternatives if you want to honor the no-throws rule strictly:
  - **(a)** Restructure: pull `planVo` from the local `plan` variable instead of re-reading from `saved.interviewPlan`. This is cleaner — the plan we just generated is in scope.
  - **(b)** Match into a sentinel and return zeros — but that hides a real invariant violation. Don't.
  - **Recommended:** option (a). The implementer rewrite:
    ```typescript
    .flatMap((plan) =>
      interview
        .schedule(plan)
        .mapErr((e): ServiceError => e)
        .map((scheduled) => ({ scheduled, plan })),
    )
    .toAsyncResult()
    .flatMap(async ({ scheduled, plan }) =>
      (await this.interviews.save(scheduled))
        .mapErr((e): ServiceError => new ServiceUnknownError(e.message, "InterviewRepository.save"))
        .map((saved) => ({ saved, plan })),
    )
    .map(({ saved, plan }) => ({
      interviewId: saved.id,
      status: saved.status,
      topicCount: plan.topics.length,
      targetDurationMinutes: plan.targetDurationMinutes,
      maxDurationMinutes: plan.maxDurationMinutes,
    }))
    .toPromise();
    ```
- If `Result.toAsyncResult()` is unavailable, replace with the `Result.fromPromise(... .then(...))` pattern from `CreateInterviewUseCase`. Either way, end the chain with `.toPromise()`.
- `interview.schedule(plan)` enforces `CREATED → SCHEDULED` only (verified at `interview.entity.ts:113-118`). If the interview is already `SCHEDULED` or further along, the transition returns `Err(InvalidInterviewStateTransitionError)` which flows through unchanged as a `ServiceError`. **The test matrix below covers this case.**

**Invariant check:**
- `RepositoryError` translated at use-case boundary (`ServiceUnknownError`).
- `Option.None` translated to `InterviewNotFoundError` (a `DomainError` subclass — assignable to `ServiceError`).
- No `try/catch`, no thrown exceptions in the happy path.
- All async ops `await`ed and re-wrapped, ending in `.toPromise()`.

---

### Step 9 — App: use-case barrel updates

**File:** `packages/application/src/use-cases/documents/index.ts` (MODIFY)

```typescript
export { UploadCandidateDocumentsUseCase } from "./upload-candidate-documents.use-case.js";
export { ExtractCandidateDocumentsUseCase } from "./extract-candidate-documents.use-case.js";   // ← added
```

**File:** `packages/application/src/use-cases/interview/index.ts` (MODIFY)

```typescript
export { CreateInterviewUseCase } from "./create-interview.use-case.js";
export { GenerateInterviewPlanUseCase } from "./generate-interview-plan.use-case.js";   // ← added
```

No change needed in `packages/application/src/use-cases/index.ts` — it already re-exports the per-feature barrels.

No change needed in `packages/application/src/index.ts` — it already aggregates `./ports`, `./dtos`, `./use-cases`.

---

### ─────────── BATCH C — Gemini infrastructure adapters ───────────

### Step 10 — Infra: shared Gemini provider factory

**File:** `apps/backend/src/infrastructure/services/gemini/provider.ts` (CREATE)

**What:** A single bottleneck for AI SDK Google provider construction. Returns a `Result` so a missing API key fails closed; both adapters call this and never instantiate `createGoogleGenerativeAI` themselves.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

export interface GeminiProviderConfig {
  readonly apiKey: string;
  /**
   * Default `LanguageModel` id used by adapters when no per-call override is supplied.
   * Defaults to `gemini-2.5-pro`. Override in tests with a recording fake.
   */
  readonly defaultModel?: string;
}

export interface GeminiProviderHandle {
  readonly provider: GoogleGenerativeAIProvider;
  readonly defaultModel: string;
}

export const buildGeminiProvider = (config: GeminiProviderConfig): GeminiProviderHandle => ({
  provider: createGoogleGenerativeAI({ apiKey: config.apiKey }),
  defaultModel: config.defaultModel ?? DEFAULT_GEMINI_MODEL,
});

/**
 * Composition-root convenience: read the API key from env and produce a Result
 * so missing config fails closed instead of throwing on import.
 */
export const geminiProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<GeminiProviderHandle, ServiceUnavailableError> => {
  const apiKey = env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    return Result.Err(
      new ServiceUnavailableError(
        "GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini adapters",
      ),
    );
  }
  const defaultModel = env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL;
  return Result.Ok(buildGeminiProvider({ apiKey, defaultModel }));
};
```

**Invariant check:**
- Imports only `@ai-sdk/google` (allowed in infra) and `@repo/application` for the error type. No domain imports needed.
- No throw, no try/catch — invalid env returns `Err`.

---

### Step 11 — Infra: `GeminiDocumentExtractionService`

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.ts` (CREATE)

**What:** Implements `IDocumentExtractionService`. Two methods, each does:
1. `Result.tryAsyncCatch` around `generateObject({ model, schema, messages, experimental_telemetry })`.
2. Translate AI SDK errors → `DocumentExtractionError` subclass via `mapAiError`.
3. Lift validated JSON into the domain VO via `JobDescription.create` / `CandidateInfo.create`; map `InvalidInterviewInputError` → `DocumentExtractionParseFailedError`.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import { generateObject, NoObjectGeneratedError } from "ai";
import {
  type IDocumentExtractionService,
  DocumentExtractionParseFailedError,
  DocumentExtractionUnavailableError,
  DocumentExtractionUnknownError,
  type DocumentExtractionError,
} from "@repo/application";
import {
  CandidateInfo,
  type CandidateInfoProps,
  JobDescription,
  type JobDescriptionProps,
} from "@repo/domain";
import { z } from "zod";
import type { GeminiProviderHandle } from "./provider.js";

// ── Zod schemas mirror the domain VO `Props` shapes 1:1 ─────────────────────

const JdSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  rawText: z.string().min(1),
});

const CvSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  headline: z.string().default(""),
  yearsOfExperience: z.number().nonnegative(),
  skills: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  rawText: z.string().min(1),
});

// ── Error translation ──────────────────────────────────────────────────────

const isLikelyNetworkError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    err.name === "AI_RetryError" ||
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("timeout") ||
    /\b5\d\d\b/.test(m)                                            // 5xx status text
  );
};

const mapAiError =
  (operation: "extractJobDescription" | "extractCandidateInfo", documentKey: string) =>
  (err: unknown): DocumentExtractionError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new DocumentExtractionParseFailedError(
        `Gemini produced no parseable object for ${operation}: ${err.message}`,
        documentKey,
      );
    }
    if (isLikelyNetworkError(err)) {
      return new DocumentExtractionUnavailableError(
        `Gemini unreachable during ${operation}: ${(err as Error).message}`,
      );
    }
    return new DocumentExtractionUnknownError(
      err instanceof Error ? err.message : String(err),
    );
  };

// ── Adapter ────────────────────────────────────────────────────────────────

export interface GeminiDocumentExtractionConfig {
  readonly handle: GeminiProviderHandle;
  /**
   * Logical document key used in telemetry metadata (e.g. the `FileRef.key`).
   * The adapter has no other way to know it; the use case will set it via wrap()
   * if needed. For the default constructor we accept it on a per-call basis.
   *
   * NOTE: the IDocumentExtractionService port does not carry a key, so we use
   * a fixed `"unknown"` placeholder. If we want real per-document telemetry,
   * the use case can re-wrap the adapter with the FileRef.key (see Step 12 note).
   */
}

export class GeminiDocumentExtractionService implements IDocumentExtractionService {
  constructor(
    private readonly handle: GeminiProviderHandle,
    private readonly documentKey: string = "unknown",
    private readonly recruiterId: string = "unknown",
  ) {}

  async extractJobDescription(
    file: Buffer,
    contentType: string,
  ): Promise<Result<JobDescription, DocumentExtractionError>> {
    return Result.tryAsyncCatch(
      () =>
        generateObject({
          model: this.handle.provider(this.handle.defaultModel),
          schema: JdSchema,
          schemaName: "JobDescription",
          schemaDescription:
            "Structured job description extracted from a JD document (PDF/text/image).",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Extract a structured job description from this document. " +
                    "Populate every field. `rawText` should be the document's full text content. " +
                    "If responsibilities or requirements are not enumerated, return empty arrays.",
                },
                { type: "file", data: file, mediaType: contentType },
              ],
            },
          ],
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiDocumentExtractionService.extractJobDescription",
            metadata: {
              recruiterId: this.recruiterId,
              documentKey: this.documentKey,
              kind: "jd",
            },
          },
        }),
      mapAiError("extractJobDescription", this.documentKey),
    )
      .flatMap((res) =>
        JobDescription.create(res.object as JobDescriptionProps).mapErr(
          (e) => new DocumentExtractionParseFailedError(e.message, this.documentKey),
        ),
      )
      .toPromise();
  }

  async extractCandidateInfo(
    file: Buffer,
    contentType: string,
  ): Promise<Result<CandidateInfo, DocumentExtractionError>> {
    return Result.tryAsyncCatch(
      () =>
        generateObject({
          model: this.handle.provider(this.handle.defaultModel),
          schema: CvSchema,
          schemaName: "CandidateInfo",
          schemaDescription:
            "Structured candidate profile extracted from a CV (PDF/text/image).",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Extract a structured candidate profile from this CV. " +
                    "Populate every field. `rawText` should be the CV's full text content. " +
                    "Use the candidate's most recent role for the `headline`. " +
                    "If years of experience is not stated, infer it from listed roles (>=0).",
                },
                { type: "file", data: file, mediaType: contentType },
              ],
            },
          ],
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiDocumentExtractionService.extractCandidateInfo",
            metadata: {
              recruiterId: this.recruiterId,
              documentKey: this.documentKey,
              kind: "cv",
            },
          },
        }),
      mapAiError("extractCandidateInfo", this.documentKey),
    )
      .flatMap((res) =>
        CandidateInfo.create(res.object as CandidateInfoProps).mapErr(
          (e) => new DocumentExtractionParseFailedError(e.message, this.documentKey),
        ),
      )
      .toPromise();
  }
}
```

**Notes for the implementer:**
- `Result.tryAsyncCatch(fn, errorMapper)` returns `Result<Promise<T>, E>` — `.flatMap` chains over the resolved value, `.toPromise()` materializes the final `Promise<Result<T, E>>`. Verified usage matches `drizzle-interview.repository.ts:63-83`.
- The telemetry `documentKey` and `recruiterId` defaults are `"unknown"` because the port signature does not include them. **Phase 7 (composition root) will inject a per-request adapter instance with the actual key/recruiter** — for now the production code path uses defaults, and `ExtractCandidateDocumentsUseCase` constructs a *new adapter per call* so the metadata is meaningful (see Step 12 update).
- `res.object as JobDescriptionProps`: `generateObject`'s inferred return type is `z.infer<typeof JdSchema>` which structurally matches `JobDescriptionProps` (both are the same field set). The cast is sound; if Zod's inferred shape diverges from the domain type later, the `JobDescription.create` factory will still gate it.

**Update to Step 7 — adapter scoping per call:**

Because the document key and recruiter id are useful telemetry metadata but the port signature doesn't include them, the *use case* should construct a fresh adapter per call with the right metadata, rather than reusing one global instance. Replace the constructor in Step 7 to take a *factory* instead of an instance:

```typescript
// In ExtractCandidateDocumentsUseCase:
constructor(
  private readonly storage: IFileStorageService,
  private readonly extractorFactory: (ctx: { recruiterId: string; documentKey: string }) => IDocumentExtractionService,
) { super(); }
```

Then in `execute(...)` create one adapter for JD with `documentKey: input.jdFile.key` and another for CV with `documentKey: input.cvFile.key`. **Composition root in Phase 7** wires the factory closure so it builds `new GeminiDocumentExtractionService(handle, documentKey, recruiterId)` per call.

> *Decision deferred to ADR:* whether to widen the port signature to accept telemetry context (`extractJobDescription(buffer, contentType, ctx?)`) or keep the factory pattern. **Recommended:** keep the port narrow; do the factory pattern. ADR call-out C-2.

**Invariant check:**
- Imports: `ai` (allowed in infra), `@ai-sdk/google` (transitively), `@repo/domain`, `@repo/application`, `zod`. No presentation imports.
- All async ops wrapped in `Result.tryAsyncCatch` and chained — no try/catch, no throws.
- Domain factories run on the model output → boundary correctness.
- `experimental_telemetry.isEnabled: true` on both calls.

---

### Step 12 — Infra: `GeminiInterviewPlannerService`

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts` (CREATE)

**What:** Implements `IInterviewPlannerService`. Single `generateObject` call, output schema mirrors `InterviewPlanSerialized`, output lifted to `InterviewPlan` VO via the existing `InterviewPlan.create` + per-topic `PlannedTopic.create` factories.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import { generateObject, NoObjectGeneratedError } from "ai";
import {
  type IInterviewPlannerService,
  type InterviewPlannerInput,
  PlannerOutputInvalidError,
  PlannerUnavailableError,
  PlannerUnknownError,
  type PlannerError,
} from "@repo/application";
import {
  DEFAULT_MAX_DURATION_MIN,
  DEFAULT_TARGET_DURATION_MIN,
  InterviewPlan,
  PlannedTopic,
  TOPIC_PRIORITY,
} from "@repo/domain";
import { z } from "zod";
import type { GeminiProviderHandle } from "./provider.js";

const TopicSchema = z.object({
  name: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
  timeAllocationMinutes: z.number().positive(),
  priority: z.enum([TOPIC_PRIORITY.MUST_COVER, TOPIC_PRIORITY.IF_TIME_PERMITS]),
});

const PlanSchema = z.object({
  topics: z.array(TopicSchema).min(1),
  targetDurationMinutes: z.number().int().positive(),
  maxDurationMinutes: z.number().int().positive(),
  mustAskQuestions: z.array(z.string().min(1)).default([]),
});

const isLikelyNetworkError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    err.name === "AI_RetryError" ||
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("timeout") ||
    /\b5\d\d\b/.test(m)
  );
};

const mapAiError =
  (interviewId: string) =>
  (err: unknown): PlannerError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new PlannerOutputInvalidError(
        `Planner produced no parseable object: ${err.message}`,
        interviewId,
      );
    }
    if (isLikelyNetworkError(err)) {
      return new PlannerUnavailableError(`Gemini unreachable during planner: ${(err as Error).message}`);
    }
    return new PlannerUnknownError(err instanceof Error ? err.message : String(err), "generatePlan");
  };

const buildPrompt = (input: InterviewPlannerInput): string => {
  const target = input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN;
  const max = input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN;
  return [
    "You are designing the plan for a short technical screening interview.",
    `Target duration: ${target} minutes (soft). Maximum duration: ${max} minutes (hard ceiling).`,
    "",
    "Job description (structured):",
    JSON.stringify(input.jobDescription.serialize(), null, 2),
    "",
    "Candidate profile (structured):",
    JSON.stringify(input.candidateInfo.serialize(), null, 2),
    "",
    "Client instructions:",
    input.clientInstructions || "(none)",
    "",
    "Produce 3-6 topics, each with 2-5 questions and a time allocation that sums to <= target.",
    "Mark high-signal topics as 'must_cover'; nice-to-haves as 'if_time_permits'.",
    "Surface any role-critical questions in `mustAskQuestions`.",
  ].join("\n");
};

export class GeminiInterviewPlannerService implements IInterviewPlannerService {
  constructor(private readonly handle: GeminiProviderHandle) {}

  async generatePlan(
    input: InterviewPlannerInput,
  ): Promise<Result<InterviewPlan, PlannerError>> {
    return Result.tryAsyncCatch(
      () =>
        generateObject({
          model: this.handle.provider(this.handle.defaultModel),
          schema: PlanSchema,
          schemaName: "InterviewPlan",
          schemaDescription:
            "Structured plan for a screening interview, scoped to the provided JD and candidate profile.",
          prompt: buildPrompt(input),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewPlannerService.generatePlan",
            metadata: {
              interviewId: input.interviewId,
              targetDurationMinutes: input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN,
              maxDurationMinutes: input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN,
            },
          },
        }),
      mapAiError(input.interviewId),
    )
      .flatMap((res) => {
        const raw = res.object;
        // Lift each topic VO → first error short-circuits via Result.all.
        const topicResults = raw.topics.map((t) =>
          PlannedTopic.create({
            name: t.name,
            questions: t.questions,
            timeAllocationMinutes: t.timeAllocationMinutes,
            priority: t.priority,
          }),
        );
        return Result.all(...topicResults)
          .mapErr((errs) => new PlannerOutputInvalidError(errs[0].message, input.interviewId))
          .flatMap((topics) =>
            InterviewPlan.create({
              topics,
              targetDurationMinutes: raw.targetDurationMinutes,
              maxDurationMinutes: raw.maxDurationMinutes,
              mustAskQuestions: raw.mustAskQuestions,
            }).mapErr((e) => new PlannerOutputInvalidError(e.message, input.interviewId)),
          );
      })
      .toPromise();
  }
}
```

**Invariant check:**
- Adapter runs domain factories (`PlannedTopic.create`, `InterviewPlan.create`) on model output — no shortcuts, no `as InterviewPlan` casts on raw JSON.
- Telemetry includes `interviewId` so per-interview spans can be filtered in Langfuse (Decision D).
- `Result.all(...topicResults)` short-circuits on the first invalid topic.

---

### Step 13 — Infra: services barrel updates

**File:** `apps/backend/src/infrastructure/services/gemini/index.ts` (CREATE)

```typescript
export {
  buildGeminiProvider,
  geminiProviderFromEnv,
  DEFAULT_GEMINI_MODEL,
} from "./provider.js";
export type { GeminiProviderConfig, GeminiProviderHandle } from "./provider.js";
export { GeminiDocumentExtractionService } from "./gemini-document-extraction.service.js";
export { GeminiInterviewPlannerService } from "./gemini-interview-planner.service.js";
```

**File:** `apps/backend/src/infrastructure/services/index.ts` (MODIFY)

Append:

```typescript
export * from "./gemini/index.js";
```

(preserving the existing `LocalFileStorageService` re-export)

---

### ─────────── BATCH D — Verification ───────────

### Step 14 — Type-check, run tests, draft ADRs

After Steps 1–13 are implemented, run:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
# Domain tests should still pass — Phase 3 didn't touch domain.
pnpm turbo run test --filter=@repo/domain
```

Then draft ADRs for the architectural choices flagged above:

- **ADR-NNN — Phase 3: Persist extracted JD/CV through the Interview aggregate's existing JSONB columns** (Decision A)
- **ADR-NNN — Phase 3: Two-step orchestration `Extract` then `GeneratePlan`** (Decision C)
- **ADR-NNN — Phase 3: Document-extraction telemetry is per-call via factory closure, not via port widening** (Decision C-2 in Step 11 update)

Use `/adr-kit:adr` for each. Each ADR should include an Enforcement block — at minimum, a `forbid_pattern` in `forbid_import` blocking `from ['"]ai['"];?` and `from ['"]@ai-sdk/google['"];?` inside `packages/domain/**` and `packages/application/**`.

---

## Per-step error mapping table

| Source error / condition                                                           | Mapped to                                                                       | Site                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `NoObjectGeneratedError` (AI SDK)                                                  | `DocumentExtractionParseFailedError(msg, documentKey)`                          | `GeminiDocumentExtractionService.mapAiError` |
| `NoObjectGeneratedError` (AI SDK)                                                  | `PlannerOutputInvalidError(msg, interviewId)`                                   | `GeminiInterviewPlannerService.mapAiError`   |
| Network / fetch / timeout / 5xx (heuristic on `Error.name` and `.message`)         | `DocumentExtractionUnavailableError`                                            | `GeminiDocumentExtractionService.mapAiError` |
| Network / fetch / timeout / 5xx                                                    | `PlannerUnavailableError`                                                       | `GeminiInterviewPlannerService.mapAiError`   |
| Any other `Error` from `generateObject`                                            | `DocumentExtractionUnknownError(msg)`                                           | `GeminiDocumentExtractionService.mapAiError` |
| Any other `Error` from `generateObject`                                            | `PlannerUnknownError(msg, "generatePlan")`                                      | `GeminiInterviewPlannerService.mapAiError`   |
| `JobDescription.create(...)` returns `Err(InvalidInterviewInputError)`             | `DocumentExtractionParseFailedError(domainErr.message, documentKey)`            | `GeminiDocumentExtractionService.extractJobDescription` boundary |
| `CandidateInfo.create(...)` returns `Err(InvalidInterviewInputError)`              | `DocumentExtractionParseFailedError(domainErr.message, documentKey)`            | `GeminiDocumentExtractionService.extractCandidateInfo` boundary |
| `PlannedTopic.create(...)` or `InterviewPlan.create(...)` returns `Err`            | `PlannerOutputInvalidError(domainErr.message, interviewId)`                     | `GeminiInterviewPlannerService.generatePlan` boundary |
| `IInterviewRepository.findById(id)` returns `Err(Error)`                           | `ServiceUnknownError(e.message, "InterviewRepository.findById")`                | `GenerateInterviewPlanUseCase.execute`        |
| `IInterviewRepository.findById(id)` returns `Ok(Option.None)`                      | `InterviewNotFoundError(id)` (a `DomainError`, assignable to `ServiceError`)    | `GenerateInterviewPlanUseCase.execute`        |
| `IInterviewRepository.save(interview)` returns `Err(Error)`                        | `ServiceUnknownError(e.message, "InterviewRepository.save")`                    | `GenerateInterviewPlanUseCase.execute`        |
| `Interview.schedule(plan)` returns `Err(InvalidInterviewStateTransitionError)`     | unchanged — `BusinessRuleViolationError` ⊆ `DomainError` ⊆ `ServiceError`       | `GenerateInterviewPlanUseCase.execute`        |
| `IFileStorageService.download(key)` returns `Err(StorageError)`                    | unchanged — `StorageError` ⊆ `ServiceInfraError` ⊆ `ServiceError`               | `ExtractCandidateDocumentsUseCase.execute`    |
| `IDocumentExtractionService.extractJobDescription(...)` returns `Err`              | unchanged — `DocumentExtractionError` ⊆ `ServiceInfraError` ⊆ `ServiceError`    | `ExtractCandidateDocumentsUseCase.execute`    |

---

## Pseudo-workflow (end-to-end, post-Phase-3 + post-Phase-7 wiring view)

This is informational — Phase 7 does the HTTP plumbing. Phase 3 only delivers the use cases the routes will call.

1. Recruiter POSTs JD + CV to `POST /api/interviews/uploads` → `UploadCandidateDocumentsUseCase` writes both blobs to `LocalFileStorageService`, returns `{ jdRef, cvRef }`.
2. Frontend POSTs `{ recruiterId, jdRef, cvRef }` to `POST /api/interviews/extract` → **`ExtractCandidateDocumentsUseCase`**:
   1. Validates input via `ExtractCandidateDocumentsInputDto.parse` → `Result<…, DtoValidationError>`.
   2. `storage.download(jdRef.key)` and `storage.download(cvRef.key)` in parallel → `Result.all` → first error short-circuits.
   3. Composition root constructs `new GeminiDocumentExtractionService(handle, jdRef.key, recruiterId)` and `new GeminiDocumentExtractionService(handle, cvRef.key, recruiterId)`.
   4. `extractor.extractJobDescription(jdBytes, jdRef.contentType)` → AI SDK `generateObject` → telemetry span → `JobDescription.create` lift.
   5. Same for CV → `CandidateInfo.create`.
   6. Returns `{ jobDescription, candidateInfo }` (serialized props).
3. Frontend POSTs `{ recruiterId, jobDescription, candidateInfo, clientInstructions, scheduledAt, jdFileRef, cvFileRef }` to `POST /api/interviews` → `CreateInterviewUseCase` (existing) persists in `CREATED`.
4. Frontend POSTs `{ interviewId }` (or implicit chained call from controller) to `POST /api/interviews/:id/plan` → **`GenerateInterviewPlanUseCase`**:
   1. Validate via `GenerateInterviewPlanInputDto.parse`.
   2. `interviews.findById(id)` → repo `Error` → `ServiceUnknownError`; `Option.None` → `InterviewNotFoundError`.
   3. `planner.generatePlan({ interviewId, jobDescription, candidateInfo, clientInstructions, ...overrides })` → AI SDK `generateObject` → telemetry span → `InterviewPlan.create` lift.
   4. `interview.schedule(plan)` → `Result<Interview, BusinessRuleViolationError>`.
   5. `interviews.save(scheduled)` → upsert via Drizzle.
   6. Returns `{ interviewId, status: "SCHEDULED", topicCount, targetDurationMinutes, maxDurationMinutes }`.
5. Phase 7 controller maps `ServiceError` → HTTP status (out of scope for this plan).

---

## Test matrix

Co-located `*.test.ts` files. Vitest 3. Mocks only at the boundary. Pattern follows the Phase-1 `create-interview.use-case.test.ts` (mock the port methods with `vi.fn()`; the rest is real wiring).

### Application

| File                                                                                                                | Test cases (minimum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/application/src/dtos/extract-candidate-documents.dto.test.ts`                                             | parse Ok with valid recruiterId + two file refs · parse Err on missing recruiterId · parse Err on empty key · parse Err on empty contentType · parse Err on missing field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/application/src/dtos/generate-interview-plan.dto.test.ts`                                                 | parse Ok with only `interviewId` · parse Ok with both overrides · parse Err when target > max · parse Err when target ≤ 0 · parse Err on missing interviewId · parse Err on non-integer duration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.test.ts`                         | success — returns `{ jobDescription, candidateInfo }` matching what extractor returned (factory builds adapter once per call) · storage.download(jd) Err → returns Err, extractor not called · storage.download(cv) Err → returns Err · extractor.extractJobDescription Err → returns Err · extractor.extractCandidateInfo Err → returns Err · does not throw on storage failure · does not throw on extractor failure · output type is serialized props (not VO instances)                                                                                                                                                                                                                                |
| `packages/application/src/use-cases/interview/generate-interview-plan.use-case.test.ts`                             | success — Interview goes from CREATED → SCHEDULED, save called once, output has correct topicCount/durations · findById returns Err → ServiceUnknownError, planner not called · findById returns Ok(None) → InterviewNotFoundError, planner not called · planner returns Err(PlannerOutputInvalidError) → returned Err, save not called · planner returns Err(PlannerUnavailableError) → returned Err, save not called · interview already SCHEDULED → schedule returns Err(InvalidInterviewStateTransitionError), save not called · save returns Err → ServiceUnknownError · does not throw on planner failure · does not throw on repo failure · planner is called with the loaded interview's VOs verbatim |

### Infrastructure

For Gemini adapters, **mock the `ai` module** at the file top:
```typescript
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});
```
Then `import { generateObject } from "ai"` in the test and cast to `Mock` to control behaviour. `NoObjectGeneratedError` is preserved from `actual` so `instanceof` checks still work.

For the provider tests, do not mock `@ai-sdk/google`; just verify the factory's `Result` branches.

| File                                                                                                                | Test cases (minimum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/src/infrastructure/services/gemini/provider.test.ts`                                                  | `geminiProviderFromEnv({})` → Err(ServiceUnavailableError) · `geminiProviderFromEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "x" })` → Ok with `defaultModel === "gemini-2.5-pro"` · custom `GEMINI_MODEL` env overrides default · `buildGeminiProvider` is pure (no env access) · returned handle has `.provider` and `.defaultModel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.test.ts`                        | `extractJobDescription` success → `JobDescription` instance with all fields populated · model returns `{ object: { title: "" } }` (blank title) → `DocumentExtractionParseFailedError` (boundary lift fail) · `generateObject` throws `NoObjectGeneratedError` → `DocumentExtractionParseFailedError` · `generateObject` throws `Error("fetch failed")` → `DocumentExtractionUnavailableError` · `generateObject` throws unknown error → `DocumentExtractionUnknownError` · `experimental_telemetry.isEnabled === true` and `functionId === "GeminiDocumentExtractionService.extractJobDescription"` (assert via the mock spy's call-args) · telemetry metadata includes the constructor's `documentKey` and `recruiterId` · `extractCandidateInfo` mirror tests for the CV path · `messages[0].content[1].mediaType` matches the passed `contentType` |
| `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts`                          | success → returns `InterviewPlan` instance with topics matching model output · model returns `{ topics: [] }` → `PlannerOutputInvalidError` (lift fails on empty topics) · model returns topic with empty name → `PlannerOutputInvalidError` · model returns target > max → `PlannerOutputInvalidError` · `generateObject` throws `NoObjectGeneratedError` → `PlannerOutputInvalidError` · throws `Error("ETIMEDOUT")` → `PlannerUnavailableError` · throws unknown → `PlannerUnknownError` · `experimental_telemetry.isEnabled === true` and `metadata.interviewId === input.interviewId` · prompt contains JD JSON and CV JSON (smoke check on the call's `prompt` arg) · respects `targetDurationMinutes` / `maxDurationMinutes` overrides in telemetry metadata                                                                                                                                                                                                                                                                                                                                                                                |

**Test fixtures recap:**
- All tests follow the existing convention from `create-interview.use-case.test.ts`: build a `validInput()` helper, build mock ports with `vi.fn()`, assert `result.isOk()` / `isErr()` before any `unwrap()`, and prefer `instanceof` over string-matching on errors.
- For the use-case tests, construct a real `Interview` (via `Interview.create({...})`) before passing it to the mocked `findById` so domain invariants are exercised end-to-end.

---

## Entry points (innermost first)

| #   | File                                                                                                                | Layer       | Operation | Purpose                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------- |
| 1   | `packages/application/src/ports/interview-planner/interview-planner.port.ts`                                        | application | CREATE    | Defines `IInterviewPlannerService` + `InterviewPlannerInput`                       |
| 2   | `packages/application/src/ports/interview-planner/interview-planner-error.ts`                                       | application | CREATE    | `PlannerError` hierarchy (3 codes)                                                 |
| 3   | `packages/application/src/ports/interview-planner/index.ts`                                                         | application | CREATE    | Barrel for new port                                                                |
| 4   | `packages/application/src/ports/index.ts`                                                                           | application | MODIFY    | Re-export interview-planner barrel                                                 |
| 5   | `packages/application/src/dtos/extract-candidate-documents.dto.ts`                                                  | application | CREATE    | DTO for new use case                                                               |
| 6   | `packages/application/src/dtos/generate-interview-plan.dto.ts`                                                      | application | CREATE    | DTO for new use case                                                               |
| 7   | `packages/application/src/dtos/index.ts`                                                                            | application | MODIFY    | Barrel: re-export both new DTOs                                                    |
| 8   | `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts`                              | application | CREATE    | Orchestrate storage download + extractor calls                                     |
| 9   | `packages/application/src/use-cases/documents/index.ts`                                                             | application | MODIFY    | Barrel                                                                             |
| 10  | `packages/application/src/use-cases/interview/generate-interview-plan.use-case.ts`                                  | application | CREATE    | Load interview, call planner, schedule, save                                       |
| 11  | `packages/application/src/use-cases/interview/index.ts`                                                             | application | MODIFY    | Barrel                                                                             |
| 12  | `apps/backend/src/infrastructure/services/gemini/provider.ts`                                                       | infra       | CREATE    | Shared `createGoogleGenerativeAI` factory + `geminiProviderFromEnv`                |
| 13  | `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.ts`                             | infra       | CREATE    | Implements `IDocumentExtractionService` via `generateObject`                       |
| 14  | `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts`                               | infra       | CREATE    | Implements `IInterviewPlannerService` via `generateObject`                         |
| 15  | `apps/backend/src/infrastructure/services/gemini/index.ts`                                                          | infra       | CREATE    | Barrel                                                                             |
| 16  | `apps/backend/src/infrastructure/services/index.ts`                                                                 | infra       | MODIFY    | Re-export `./gemini`                                                               |
| 17  | (per file in entries 5–14) co-located `*.test.ts`                                                                   | application + infra | CREATE | Vitest suites — see test matrix                                                |

---

## Verification commands

Run in this order **after** all of Steps 1–13 are written:

```bash
# 1. Type-check the entire backend stack
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# 2. Tests — domain should stay green (no domain changes)
pnpm turbo run test --filter=@repo/domain

# 3. Application tests — must include the new DTO + use-case suites
pnpm turbo run test --filter=@repo/application

# 4. Backend tests — must include the new Gemini adapter suites
pnpm turbo run test --filter=backend

# 5. Architecture validator (per Rule 4 of CLAUDE.md)
/backend-arch-validator application
/backend-arch-validator infrastructure
```

Expected outcomes:

- All four type-checks pass with zero errors.
- Domain tests: still 116 passing (Phase-1 baseline).
- Application tests: Phase-1 baseline (37) + new tests for two DTOs (~10) + new tests for two use cases (~18) ≈ **65+ tests**.
- Backend tests: Phase-2 baseline (29) + new tests for provider (~5) + extractor adapter (~12) + planner adapter (~10) ≈ **56+ tests**.
- `/backend-arch-validator application` reports no boundary violations: `@repo/application` does not import from `apps/backend`, from `ai`, or from `@ai-sdk/google`.
- `/backend-arch-validator infrastructure` reports no boundary violations: infra does not import presentation; `RepositoryError` not referenced in new code (planner use case only catches generic `Error`).

---

## Risk notes

1. **AI SDK version skew.** `ai@6.0.158` is current at planning time. The multimodal content-part API (`{ type: "file", data: Buffer, mediaType: string }`) changed between 4.x and 5.x. If `ai` is upgraded mid-implementation, re-verify the `messages` shape. The shape used here is verified against `ai@6.0.158` typings.
2. **`Result.toAsyncResult()` may not exist** in `@carbonteq/fp@0.9.1`. The fallback pattern using `Result.fromPromise(... .then(...))` is documented in Step 7's "Notes for the implementer". Mirror whichever pattern `CreateInterviewUseCase` uses today (verified: `Result.fromPromise(...)` is the established idiom).
3. **`unwrapErr()` vs `isErr()` after async chains.** Phase 1 documented (`docs/progress/phase-1.md` §"Residual risk") that `unwrapErr()` returns `undefined` after `Result.fromPromise(...).toPromise()`. Tests must assert `result.isErr()` (not `instanceof` on the unwrapped error) for the *infrastructure-error* paths in `GenerateInterviewPlanUseCase.test.ts`. For *domain-error* paths (e.g. `InvalidInterviewStateTransitionError`), tests can `instanceof`-check because they don't pass through `Result.fromPromise`.
4. **Telemetry per-call adapter construction.** Step 11's pattern (one adapter instance per document, scoped by the use case's factory) is correct but increases adapter allocation. If profiling shows this matters at scale (it shouldn't — these are short-lived JS objects), revisit by widening the port signature in a follow-up ADR. Right now: prefer narrow ports.
5. **Gemini cost.** Each interview now costs ~3 Gemini calls (JD extract + CV extract + plan). Langfuse will surface unit cost in dashboards; if it's above target, the planner could be downgraded to `gemini-2.5-flash` via `GEMINI_MODEL` env without code changes.
6. **`InterviewNotFoundError` is a `NotFoundError` (DomainError).** Phase 7's HTTP mapper must map it to 404, not 500. Tag for the presentation-layer plan when written.
7. **Schedule transition pre-check.** `Interview.schedule(plan)` enforces `CREATED` only. If the use case is called twice in a row, the second call returns `Err(InvalidInterviewStateTransitionError)` — which is correct behaviour but Phase 7 should map it to 409 Conflict, not 500.
8. **`docs/progress/phase-2.md`'s non-blocking style notes** (`db as never` cast in repo tests, `await import` inside tests, `as StorageError` widening) are unrelated to Phase 3 and should be left alone unless the implementer is already touching those files.
