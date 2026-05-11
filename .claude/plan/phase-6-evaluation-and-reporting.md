# Plan: Phase 6 — Evaluation & Reporting

> Generated: 2026-05-11
> Slug: `phase-6-evaluation-and-reporting`
> Architecture context: `docs/ARCHITECTURE.md` §3.2, §5.3, §5.4, §6, §7 (Phase 6)
> Phase 5 reference: `.claude/plan/phase-5-agent-integration.md`, `docs/progress/phase-5.md`
> Phase 3 reference (Gemini conventions): `.claude/plan/phase-3-document-extraction-and-plan-generation.md`, `docs/progress/phase-3.md`
> ADRs in force: ADR-001, ADR-003, ADR-004, ADR-007, ADR-013, ADR-014

---

## Goal

Close the backend loop for a screening interview. Take a `COMPLETED` interview — JD, CV, full transcript, agent notes, internal scores — and produce a structured `Report` persisted on the `reports` row already provisioned in Phase 1/2, then transition the interview to `EVALUATED` with `reportId` set. The evaluator runs as a single Gemini call via the existing AI SDK `generateText` + `Output.object(...)` pattern (mirroring the Phase 3 document extractor and planner), behind a new `IInterviewEvaluatorService` application port. Evaluator output is **never trusted** — it is re-lifted through `Report.create` / `TopicScore.create`, so a hallucinated empty `communicationAssessment` or out-of-range score becomes a typed error instead of bad data on disk. The use case is invoked explicitly (not auto-fired at end of `ConductInterviewUseCase`), so Phase 7 can wire HTTP surfaces without changing the inner contract. One additional read-only use case (`GetReportByInterviewIdUseCase`) covers retrieval — Phase 6 deliberately does not invent a query service or a richer DTO mapping until a real read consumer (Phase 7 / 8) emerges.

The frontend, REST CRUD, auth, rate limiting, schema migrations, and resilience hardening remain out of scope. The `reports` Drizzle table and `DrizzleReportRepository` are already in place from Phase 2 and are reused without change.

---

## Scope

### In scope

- New application port `IInterviewEvaluatorService` with `EvaluateInterviewInput` shape and `EvaluatorError` hierarchy (`EvaluatorUnavailableError`, `EvaluatorOutputInvalidError`, `EvaluatorUnknownError`).
- New DTO `EvaluateInterviewInputDto` (`BaseDto` + Zod 4); no separate output DTO (use a plain `EvaluateInterviewOutput` interface like the planner, see decision Q1 below).
- New use case `EvaluateInterviewUseCase` orchestrating: load interview → guard `status === COMPLETED` and report-not-already-present → invoke evaluator → lift output through `Report.create` / `TopicScore.create` → `IReportRepository.save` → `interview.markEvaluated(reportId)` → `IInterviewRepository.save` → return summary.
- New read-only use case `GetReportByInterviewIdUseCase` returning the persisted serialized report (Q2 below).
- New infrastructure adapter `GeminiInterviewEvaluatorService` mirroring `GeminiInterviewPlannerService`: AI SDK `generateText` + `Output.object(...)`, JSON-schema-typed evaluator output, `experimental_telemetry` metadata, `Result.tryAsyncCatch` boundary, AI SDK error mapping to evaluator errors.
- One hardcoded `EVALUATION_RUBRIC` constant string (Q3 below) in the application layer (rubric is a prompt input, not a domain concept).
- A single `interview.evaluation` OTel span opened by the evaluator adapter, parented under the `interview.evaluation` root context (Q5 below). Honours ADR-014's `interview.evaluation.*` namespace reservation.
- Composition wiring in the existing root (Q4 below).
- New unit tests for the use case (success, not-found, wrong-status, report-already-exists, evaluator error, repo errors) and the evaluator adapter (success, NoObjectGenerated → invalid output, retry/server → unavailable, generic → unknown, telemetry metadata present, lift failure when score out of range).
- Optional ADR-015 flag (Q6 below): if the auto-eval policy / rubric storage / state-machine surface remains in doubt during implementation, raise ADR-015. Do not author it as part of this plan.

### Out of scope

- HTTP routes / controllers / WebSocket plumbing (Phase 7).
- Frontend (Phases 8/9).
- New persistence tables, columns, or migrations — reuse the existing `reports` table and `DrizzleReportRepository`.
- Resilience hardening, retries, circuit breakers, rate limits (Phase 10).
- Persisting the rubric on the `Interview` aggregate or in a new table (deferred; see Q3).
- Auto-firing evaluation at the end of `ConductInterviewUseCase` (deferred; see Q4).
- Streaming evaluator output. The evaluator is one full `generateText` call returning a single `Output.object` result.
- Multi-evaluator ensembling, per-topic re-prompting, or evaluator self-critique loops.

---

## Layers touched

| Layer          | Package / Location                                            | Scope                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                                            | None. `Interview.markEvaluated`, `INTERVIEW_STATUS.EVALUATED`, `Report.create`, `TopicScore.create`, and `IReportRepository` already exist and meet the Phase 6 requirements. Verified by reading `interview.entity.ts:175-181` and `report.entity.ts:64-87`. |
| Application    | `packages/application/`                                       | New `IInterviewEvaluatorService` port + 4-class evaluator error hierarchy + barrel; new `EvaluateInterviewInputDto` + `EvaluateInterviewOutput`; new `EvaluateInterviewUseCase`; new `GetReportByInterviewIdUseCase`; new `EVALUATION_RUBRIC` constant. Index barrels updated. |
| Infrastructure | `apps/backend/src/infrastructure/`                            | New `GeminiInterviewEvaluatorService` adapter (`gemini-interview-evaluator.service.ts`); Gemini services barrel (`services/gemini/index.ts`) extended. No schema, no migrations, no new repositories.                              |
| Presentation   | `apps/backend/src/presentation/`                              | None. Phase 7 owns route wiring.                                                                                                                                                                                                   |
| Composition    | `apps/backend/src/composition/`                               | New `buildEvaluateInterviewUseCase()` composition helper (separate from the existing `buildInterviewSessionDeps()` since interview sessions and evaluation have different runtime owners and should not share a closure).         |

---

## Architectural decisions (rationale locked in)

### Q1 — Output DTO is a plain interface, not a `BaseDto` class

`EvaluateInterviewOutput` is a plain `interface` mirroring `GenerateInterviewPlanOutput` (`packages/application/src/dtos/generate-interview-plan.dto.ts:33-39`) and `ConductInterviewOutput` (`packages/application/src/dtos/conduct-interview.dto.ts:27-37`). `BaseDto` is for **input** validation only — outputs in this codebase are typed records returned from `UseCase.execute()`. One-sentence rationale: a typed interface is sufficient for trust boundary-crossing on the return path; we already validated via `Report.create` and that is the structured-output contract.

### Q2 — Retrieval is a separate `GetReportByInterviewIdUseCase`, not a query service

`GenerateReport` is **not** a separate use case. After Phase 5's per-turn persistence and after `EvaluateInterviewUseCase.save(report)`, the report is on disk; "generate" and "evaluate" are the same operation. Retrieval becomes a `GetReportByInterviewIdUseCase` returning `Result<Option<ReportSerialized>, ServiceError>`. One-sentence rationale: a query service is overkill for a single-row lookup by foreign key when the existing `IReportRepository.findByInterviewId` already returns the right shape — promote it to a query service only when Phase 7/8 introduces a paginated multi-report read.

### Q3 — Rubric is a hardcoded constant in the application layer for Phase 6

`EVALUATION_RUBRIC` lives at `packages/application/src/use-cases/interview/evaluation-rubric.ts` as an exported constant string. It is concatenated into the evaluator prompt by the adapter (the rubric is prompt input, not domain state). One-sentence rationale: storing the rubric on the `Interview` aggregate or in a new table requires either a schema migration or a domain change — both are deferred until product wants per-recruiter or per-JD rubric variation, at which point an ADR-016 can promote it. Flag for **ADR-015** (see Q6) if reviewers disagree.

### Q4 — Evaluation is an explicit call, not auto-fired at end of conduct

`EvaluateInterviewUseCase` is invoked separately. `ConductInterviewUseCase` returns when the interview is `COMPLETED`; the caller (Phase 7 HTTP route, an offline batch job, a CLI script) decides when to run evaluation. One-sentence rationale: chaining them silently couples the WebSocket connection lifetime to a 5–10s Gemini call that has nothing to do with the candidate's session — the candidate's audio loop must close cleanly before evaluation runs, and the evaluator must not block the WebSocket close response. Flag for **ADR-015** if reviewers want auto-fire instead.

### Q5 — Evaluation OTel span is `interview.evaluation` and **not** parented under any session span

The evaluator adapter opens an `interview.evaluation` OTel span at the top of `evaluate()`, before the first `await`. It is its own root span (no parent context required). ADR-014's D7c reserves the `interview.evaluation.*` namespace; this fills it with the bare name `interview.evaluation`. One-sentence rationale: evaluation happens after the session WebSocket has closed and the `interview.session.agent` span has ended — parenting under it would require either re-opening a closed span (impossible) or holding the session span open across an unknown time window (incorrect). A separate root trace keyed by `interview.id` attribute is the same query pattern ADR-014 endorses for cross-phase Langfuse queries.

### Q6 — ADR-015 flag

Three judgement calls in Phase 6 may warrant a recorded decision: (i) the auto-eval policy in Q4, (ii) the hardcoded rubric in Q3, (iii) the namespace-only OTel choice in Q5. None of them touches code in a mechanically expressible way during Phase 6 (no enforcement block to add yet) — they are policy decisions. **If reviewers contest any of (i)/(ii)/(iii), open ADR-015** before implementation begins. Do not author it speculatively as part of this plan. ADR-014's D7c is already the reservation; if (iii) is contested it amends ADR-014 by superseding.

---

## File-level breakdown

Numbering is the order an implementer should follow. Each step lists the path, operation (CREATE / MODIFY), what is added, and a key code snippet. Every file path is verified against the working tree as of 2026-05-11.

### Step 1 — Application: evaluator port error hierarchy

**File:** `packages/application/src/ports/interview-evaluator/interview-evaluator-error.ts` (CREATE)

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class EvaluatorError extends ServiceInfraError {}

export class EvaluatorUnavailableError extends EvaluatorError {
  readonly code = "EVALUATOR_UNAVAILABLE";
}

export class EvaluatorOutputInvalidError extends EvaluatorError {
  readonly code = "EVALUATOR_OUTPUT_INVALID";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class EvaluatorUnknownError extends EvaluatorError {
  readonly code = "EVALUATOR_UNKNOWN";

  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
```

**Invariant check:** Mirrors `PlannerError` shape (`packages/application/src/ports/interview-planner/interview-planner-error.ts`) exactly. All errors extend `ServiceInfraError` so they cross the boundary as `ServiceError`. No `throw`, no `try/catch`.

---

### Step 2 — Application: evaluator port interface

**File:** `packages/application/src/ports/interview-evaluator/interview-evaluator.port.ts` (CREATE)

```typescript
import type { Result } from "@carbonteq/fp";
import type {
  AgentInternalScore,
  AgentNote,
  CandidateInfo,
  InterviewId,
  JobDescription,
  ReportCreateProps,
  TranscriptEntry,
} from "@repo/domain";
import type { EvaluatorError } from "./interview-evaluator-error.js";

export interface InterviewEvaluatorInput {
  readonly interviewId: InterviewId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  readonly notes: ReadonlyArray<AgentNote>;
  readonly internalScores: ReadonlyArray<AgentInternalScore>;
  readonly rubric: string;
}

export interface IInterviewEvaluatorService {
  /**
   * Run the evaluation pass and return domain-shaped `ReportCreateProps`
   * (sans id and timestamps). The use case re-lifts the result through
   * `Report.create` so evaluator hallucinations re-validate.
   */
  evaluate(
    input: InterviewEvaluatorInput,
  ): Promise<Result<ReportCreateProps, EvaluatorError>>;
}
```

**Invariant check:** Port returns `ReportCreateProps` (the input shape of `Report.create`), not a `Report`. The adapter does not own ID assignment; the use case calls `Report.create` to mint it. This guarantees the evaluator cannot bypass domain invariants (`communicationAssessment` non-empty, `topicScores` non-empty, every `TopicScore.score` in `[0..5]`). Result/Option discipline preserved.

---

### Step 3 — Application: evaluator port barrel

**File:** `packages/application/src/ports/interview-evaluator/index.ts` (CREATE)

```typescript
export type {
  IInterviewEvaluatorService,
  InterviewEvaluatorInput,
} from "./interview-evaluator.port.js";
export {
  EvaluatorError,
  EvaluatorUnavailableError,
  EvaluatorOutputInvalidError,
  EvaluatorUnknownError,
} from "./interview-evaluator-error.js";
```

---

### Step 4 — Application: ports root barrel exports evaluator

**File:** `packages/application/src/ports/index.ts` (MODIFY)

```typescript
export * from "./storage/index.js";
export * from "./document-extraction/index.js";
export * from "./interview-planner/index.js";
export * from "./interview-evaluator/index.js"; // ← add
export * from "./speech-to-text/index.js";
export * from "./text-to-speech/index.js";
export * from "./interview-agent/index.js";
```

---

### Step 5 — Application: rubric constant

**File:** `packages/application/src/use-cases/interview/evaluation-rubric.ts` (CREATE)

```typescript
/**
 * Phase 6 rubric.
 *
 * Concatenated into the evaluator prompt by `GeminiInterviewEvaluatorService`.
 * Promoted to per-interview or per-JD configuration when a real product
 * requirement justifies it (tracked separately; see plan Q3).
 */
export const EVALUATION_RUBRIC = [
  "Score each planned topic on a 0-5 scale where:",
  "  0 = no signal or evasive answer",
  "  1 = surface-level recall, no reasoning",
  "  2 = correct vocabulary, weak structure",
  "  3 = solid working knowledge, some gaps",
  "  4 = strong, with concrete examples and reasoning",
  "  5 = exceptional depth with trade-off awareness",
  "",
  "Communication assessment: comment on clarity, structure of answers,",
  "ability to ask clarifying questions, and signal-to-noise ratio.",
  "",
  "Overall recommendation:",
  "  advance = strong fit, schedule the line manager interview",
  "  hold   = borderline, request more screening or another role",
  "  reject = clear no-go for this role",
  "",
  "Strengths and concerns: 2-5 concise bullets each, anchored in transcript",
  "evidence. Follow-up questions: 2-4 questions the human interviewer should",
  "ask if the candidate advances.",
].join("\n");
```

**Invariant check:** Pure constant, no runtime. Belongs in application, not domain (rubric is prompt input, not domain rule).

---

### Step 6 — Application: input DTO

**File:** `packages/application/src/dtos/evaluate-interview.dto.ts` (CREATE)

```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { ReportSerialized } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const EvaluateInterviewInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type EvaluateInterviewInput = z.infer<typeof EvaluateInterviewInputSchema>;

export class EvaluateInterviewInputDto extends BaseDto<EvaluateInterviewInput> {
  static parse(
    raw: unknown,
  ): Result<EvaluateInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(EvaluateInterviewInputSchema, raw).map(
      (value) => new EvaluateInterviewInputDto(value),
    );
  }
}

/** Use-case output: the freshly persisted report's serialized shape. */
export interface EvaluateInterviewOutput {
  readonly report: ReportSerialized;
}
```

**Invariant check:** Extends `BaseDto<T>`. Zod 4 schema. `BaseDto.validate` returns `Result<T, DtoValidationError>` — no throws. Output type is a plain `interface` returning the existing `ReportSerialized` shape so callers can hand it to a JSON serializer without re-mapping.

---

### Step 7 — Application: DTO barrel exports

**File:** `packages/application/src/dtos/index.ts` (MODIFY)

```typescript
// ...existing exports kept...
export {
  EvaluateInterviewInputDto,
  EvaluateInterviewInputSchema,
} from "./evaluate-interview.dto.js";
export type {
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
} from "./evaluate-interview.dto.js";
```

---

### Step 8 — Application: `EvaluateInterviewUseCase`

**File:** `packages/application/src/use-cases/interview/evaluate-interview.use-case.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  type IInterviewRepository,
  type IReportRepository,
  type Interview,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  Report,
  TopicScore,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type {
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
} from "../../dtos/evaluate-interview.dto.js";
import type { IInterviewEvaluatorService } from "../../ports/interview-evaluator/interview-evaluator.port.js";
import { EvaluatorOutputInvalidError } from "../../ports/interview-evaluator/interview-evaluator-error.js";
import { EVALUATION_RUBRIC } from "./evaluation-rubric.js";

export interface EvaluateInterviewDeps {
  readonly interviews: IInterviewRepository;
  readonly reports: IReportRepository;
  readonly evaluator: IInterviewEvaluatorService;
}

export class EvaluateInterviewUseCase extends UseCase<
  EvaluateInterviewInput,
  EvaluateInterviewOutput
> {
  constructor(private readonly deps: EvaluateInterviewDeps) {
    super();
  }

  async execute(
    input: EvaluateInterviewInput,
  ): Promise<Result<EvaluateInterviewOutput, ServiceError>> {
    // 1. Load interview.
    const loadResult = await this.deps.interviews.findById(input.interviewId);
    if (loadResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          loadResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrError = loadResult.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () =>
        Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }
    const interview = interviewOrError.unwrap();

    // 2. Guard: must be COMPLETED. `markEvaluated` will re-guard, but failing
    //    here gives a clearer error and avoids the evaluator call.
    if (interview.status !== INTERVIEW_STATUS.COMPLETED) {
      return Result.Err(
        new InvalidInterviewStateTransitionError(
          interview.status,
          INTERVIEW_STATUS.EVALUATED,
        ) as ServiceError,
      );
    }

    // 3. Idempotency check: if a report already exists, return it instead of
    //    spending another Gemini call.
    const existingResult = await this.deps.reports.findByInterviewId(
      input.interviewId,
    );
    if (existingResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          existingResult.unwrapErr().message,
          "ReportRepository.findByInterviewId",
        ),
      );
    }
    const existing = existingResult.unwrap();
    if (existing.isSome()) {
      return Result.Ok({ report: existing.unwrap().serialize() });
    }

    // 4. Call evaluator.
    const evalResult = await this.deps.evaluator.evaluate({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      transcript: interview.transcript,
      notes: interview.notes,
      internalScores: interview.internalScores,
      rubric: EVALUATION_RUBRIC,
    });
    if (evalResult.isErr()) {
      return Result.Err(evalResult.unwrapErr() as ServiceError);
    }
    const reportProps = evalResult.unwrap();

    // 5. Re-lift through domain factories so evaluator output is re-validated
    //    (defence-in-depth: the adapter already validates against the JSON
    //    schema, but `Report.create` enforces the *domain* invariants too).
    const reportCreateResult = Report.create(reportProps);
    if (reportCreateResult.isErr()) {
      return Result.Err(
        new EvaluatorOutputInvalidError(
          reportCreateResult.unwrapErr().message,
          interview.id,
        ) as ServiceError,
      );
    }
    const report = reportCreateResult.unwrap();

    // 6. Persist report (cascade FK guarantees interview still exists).
    const saveReportResult = await this.deps.reports.save(report);
    if (saveReportResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          saveReportResult.unwrapErr().message,
          "ReportRepository.save",
        ),
      );
    }
    const savedReport = saveReportResult.unwrap();

    // 7. Transition interview to EVALUATED.
    const markedResult = interview.markEvaluated(savedReport.id);
    if (markedResult.isErr()) {
      return Result.Err(markedResult.unwrapErr() as ServiceError);
    }
    const markedInterview: Interview = markedResult.unwrap();

    // 8. Persist interview transition. Failure here is a *partial* failure —
    //    the report is on disk but interview status lags. The next call to
    //    EvaluateInterviewUseCase will hit the idempotency branch (step 3),
    //    pick up the orphan report, and recover. See plan risk callouts.
    const saveInterviewResult = await this.deps.interviews.save(markedInterview);
    if (saveInterviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          saveInterviewResult.unwrapErr().message,
          "InterviewRepository.save",
        ),
      );
    }

    return Result.Ok({ report: savedReport.serialize() });
  }
}
```

**Invariant check:**

- No `throw`, no `try/catch`, no `T | null`. Every async call goes through Result.
- Errors are mapped at the layer boundary (`RepositoryError` → `ServiceUnknownError`; `EvaluatorError` cast to `ServiceError` since `EvaluatorError extends ServiceInfraError`).
- Evaluator output is **re-lifted** through `Report.create`; an invalid output produces `EvaluatorOutputInvalidError`, not a corrupted row.
- Interview mutation produces a new immutable instance via `markEvaluated`.
- Idempotency branch makes the use case safe to retry without double-evaluating.

---

### Step 9 — Application: `GetReportByInterviewIdUseCase`

**File:** `packages/application/src/use-cases/report/get-report-by-interview-id.use-case.ts` (CREATE — new `report/` subfolder)

```typescript
import { Option, Result } from "@carbonteq/fp";
import {
  type IReportRepository,
  type ReportSerialized,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";

export interface GetReportByInterviewIdInput {
  readonly interviewId: string;
}

export interface GetReportByInterviewIdOutput {
  readonly report: Option<ReportSerialized>;
}

export class GetReportByInterviewIdUseCase extends UseCase<
  GetReportByInterviewIdInput,
  GetReportByInterviewIdOutput
> {
  constructor(private readonly reports: IReportRepository) {
    super();
  }

  async execute(
    input: GetReportByInterviewIdInput,
  ): Promise<Result<GetReportByInterviewIdOutput, ServiceError>> {
    const lookup = await this.reports.findByInterviewId(input.interviewId);
    if (lookup.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          lookup.unwrapErr().message,
          "ReportRepository.findByInterviewId",
        ),
      );
    }
    return Result.Ok({
      report: lookup.unwrap().map((r) => r.serialize()),
    });
  }
}
```

**Invariant check:** Read-only. `Option<ReportSerialized>` preserved across the boundary so the caller distinguishes "no report yet" from "error". No throws.

---

### Step 10 — Application: report use-cases barrel

**File:** `packages/application/src/use-cases/report/index.ts` (CREATE)

```typescript
export {
  GetReportByInterviewIdUseCase,
} from "./get-report-by-interview-id.use-case.js";
export type {
  GetReportByInterviewIdInput,
  GetReportByInterviewIdOutput,
} from "./get-report-by-interview-id.use-case.js";
```

---

### Step 11 — Application: interview use-cases barrel exports evaluator

**File:** `packages/application/src/use-cases/interview/index.ts` (MODIFY)

```typescript
export { CreateInterviewUseCase } from "./create-interview.use-case.js";
export { GenerateInterviewPlanUseCase } from "./generate-interview-plan.use-case.js";
export {
  ConductInterviewUseCase,
  type ConductInterviewDeps,
  type ConductInterviewRuntimeInput,
} from "./conduct-interview.use-case.js";
export {
  EvaluateInterviewUseCase,
  type EvaluateInterviewDeps,
} from "./evaluate-interview.use-case.js"; // ← add
export { EVALUATION_RUBRIC } from "./evaluation-rubric.js"; // ← add
export { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";
export type { SystemPromptInput } from "./system-prompt-assembler.js";
```

---

### Step 12 — Application: use-cases root barrel

**File:** `packages/application/src/use-cases/index.ts` (MODIFY)

```typescript
export * from "./documents/index.js";
export * from "./interview/index.js";
export * from "./report/index.js"; // ← add
```

---

### Step 13 — Infrastructure: `GeminiInterviewEvaluatorService`

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts` (CREATE)

The adapter mirrors `GeminiInterviewPlannerService` (`gemini-interview-planner.service.ts`) line-for-line in shape: JSON schema declaration with a structural `validate`, error mapping (`RetryError` / 5xx → unavailable; `NoObjectGeneratedError` → invalid; default → unknown), prompt assembly, `generateText` + `Output.object`, `experimental_telemetry` metadata, OTel span opened before the first `await`.

```typescript
import { Result } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  type IInterviewEvaluatorService,
  type InterviewEvaluatorInput,
  EvaluatorOutputInvalidError,
  EvaluatorUnavailableError,
  EvaluatorUnknownError,
  type EvaluatorError,
} from "@repo/application";
import {
  RECOMMENDATION,
  type Recommendation,
  type ReportCreateProps,
  TopicScore,
  type TopicScoreProps,
} from "@repo/domain";
import type { GeminiProviderHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.gemini-evaluator");

type RecordValue = Record<string, unknown>;

interface EvaluatorRawOutput {
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScoreProps>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
}

const isRecord = (v: unknown): v is RecordValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const isRecommendation = (v: unknown): v is Recommendation =>
  v === RECOMMENDATION.ADVANCE ||
  v === RECOMMENDATION.HOLD ||
  v === RECOMMENDATION.REJECT;

const isTopicScoreProps = (v: unknown): v is TopicScoreProps =>
  isRecord(v) &&
  typeof v["topicName"] === "string" &&
  typeof v["score"] === "number" &&
  typeof v["justification"] === "string";

const isEvaluatorRawOutput = (v: unknown): v is EvaluatorRawOutput =>
  isRecord(v) &&
  isRecommendation(v["overallRecommendation"]) &&
  Array.isArray(v["topicScores"]) &&
  v["topicScores"].every(isTopicScoreProps) &&
  typeof v["communicationAssessment"] === "string" &&
  isStringArray(v["strengths"]) &&
  isStringArray(v["concerns"]) &&
  isStringArray(v["followUpQuestions"]);

const evaluatorSchema = jsonSchema<EvaluatorRawOutput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      overallRecommendation: {
        type: "string",
        enum: [RECOMMENDATION.ADVANCE, RECOMMENDATION.HOLD, RECOMMENDATION.REJECT],
      },
      topicScores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            topicName: { type: "string", minLength: 1 },
            score: { type: "number", minimum: 0, maximum: 5 },
            justification: { type: "string", minLength: 1 },
          },
          required: ["topicName", "score", "justification"],
        },
      },
      communicationAssessment: { type: "string", minLength: 1 },
      strengths: { type: "array", items: { type: "string" } },
      concerns: { type: "array", items: { type: "string" } },
      followUpQuestions: { type: "array", items: { type: "string" } },
    },
    required: [
      "overallRecommendation",
      "topicScores",
      "communicationAssessment",
      "strengths",
      "concerns",
      "followUpQuestions",
    ],
  },
  {
    validate: (v) =>
      isEvaluatorRawOutput(v)
        ? { success: true, value: v }
        : { success: false, error: new Error("Generated evaluator output did not match the expected shape") },
  },
);

const isServerStatusError = (err: Error): boolean => {
  const record = err as unknown as RecordValue;
  const status = record["status"] ?? record["statusCode"];
  return typeof status === "number" && status >= 500 && status < 600;
};

const isLikelyUnavailableError = (err: unknown): err is Error => {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    RetryError.isInstance(err) ||
    err.name === "AI_RetryError" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    isServerStatusError(err) ||
    /\b5\d\d\b/.test(message)
  );
};

const mapAiError =
  (interviewId: string) =>
  (err: unknown): EvaluatorError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new EvaluatorOutputInvalidError(
        `Evaluator produced no parseable object: ${err.message}`,
        interviewId,
      );
    }
    if (isLikelyUnavailableError(err)) {
      return new EvaluatorUnavailableError(
        `Gemini unavailable during evaluation: ${err.message}`,
      );
    }
    return new EvaluatorUnknownError(
      err instanceof Error ? err.message : String(err),
      "evaluate",
    );
  };

const buildPrompt = (input: InterviewEvaluatorInput): string => {
  return [
    "You are an experienced technical recruiter writing a structured screening report.",
    "Read the job description, candidate profile, client instructions, transcript, agent notes, and the agent's internal per-topic scores, then produce the report.",
    "",
    "Job description:",
    JSON.stringify(input.jobDescription.serialize(), null, 2),
    "",
    "Candidate profile:",
    JSON.stringify(input.candidateInfo.serialize(), null, 2),
    "",
    "Client instructions:",
    input.clientInstructions.trim() ? input.clientInstructions : "(none)",
    "",
    "Transcript (chronological):",
    JSON.stringify(input.transcript.map((t) => t.serialize()), null, 2),
    "",
    "Agent notes (private observations during the interview):",
    JSON.stringify(input.notes.map((n) => n.serialize()), null, 2),
    "",
    "Agent internal scores (recorded mid-interview, 0-5 scale):",
    JSON.stringify(input.internalScores.map((s) => s.serialize()), null, 2),
    "",
    "Rubric:",
    input.rubric,
  ].join("\n");
};

const liftReport = (
  raw: EvaluatorRawOutput,
  interviewId: string,
): Result<ReportCreateProps, EvaluatorOutputInvalidError> => {
  const topicScores: TopicScore[] = [];
  for (const rawTopic of raw.topicScores) {
    const tsResult = TopicScore.create(rawTopic);
    if (tsResult.isErr()) {
      return Result.Err(
        new EvaluatorOutputInvalidError(tsResult.unwrapErr().message, interviewId),
      );
    }
    topicScores.push(tsResult.unwrap());
  }

  return Result.Ok({
    interviewId,
    overallRecommendation: raw.overallRecommendation,
    topicScores,
    communicationAssessment: raw.communicationAssessment,
    strengths: raw.strengths,
    concerns: raw.concerns,
    followUpQuestions: raw.followUpQuestions,
  });
};

export class GeminiInterviewEvaluatorService implements IInterviewEvaluatorService {
  constructor(private readonly handle: GeminiProviderHandle) {}

  async evaluate(
    input: InterviewEvaluatorInput,
  ): Promise<Result<ReportCreateProps, EvaluatorError>> {
    const span: Span = tracer.startSpan("interview.evaluation", {
      attributes: {
        "interview.id": input.interviewId,
        "evaluator.model": this.handle.defaultModel,
        "evaluator.transcript_entries": input.transcript.length,
        "evaluator.notes": input.notes.length,
        "evaluator.internal_scores": input.internalScores.length,
      },
    });

    return Result.tryAsyncCatch(
      async () => {
        const result = await generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: evaluatorSchema,
            name: "InterviewEvaluation",
            description:
              "Structured screening report scored against the supplied rubric, transcript, JD, and CV.",
          }),
          prompt: buildPrompt(input),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewEvaluatorService.evaluate",
            metadata: {
              interviewId: input.interviewId,
              transcriptEntries: input.transcript.length,
              notes: input.notes.length,
              internalScores: input.internalScores.length,
            },
          },
        });
        span.setAttribute("evaluator.stop_reason", "stop");
        return result.output;
      },
      (err) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        return mapAiError(input.interviewId)(err);
      },
    )
      .flatMap((raw) => liftReport(raw, input.interviewId))
      .tap(() => span.end())
      .tapErr(() => span.end())
      .toPromise();
  }
}
```

**Invariant check:**

- Adapter imports only `@repo/application` (port + errors) and `@repo/domain` (`TopicScore`, `RECOMMENDATION`, `ReportCreateProps`) — never presentation, never repositories. Cross-checks ADR-001 dependency direction.
- AI SDK `generateText` + `Output.object(...)` — **NOT** the deprecated `generateObject`. Mirrors Phase 3 planner.
- `Result.tryAsyncCatch` wraps the throwing `generateText` call. `flatMap` re-lifts via `liftReport` so `TopicScore.create` failures become `EvaluatorOutputInvalidError`.
- `experimental_telemetry` metadata present per ADR-004.
- Span opened before first `await`, closed via `tap`/`tapErr` so both success and failure paths terminate the span (ADR-012's adapter-owns-span-lifecycle rule, extended to evaluator namespace per ADR-014 D7c).
- No `throw`, no `try/catch`, no nullable returns.

---

### Step 14 — Infrastructure: Gemini services barrel

**File:** `apps/backend/src/infrastructure/services/gemini/index.ts` (MODIFY)

```typescript
export {
  buildGeminiProvider,
  DEFAULT_GEMINI_AGENT_MODEL,
  DEFAULT_GEMINI_MODEL,
  geminiProviderFromEnv,
} from "./provider.js";
export type { GeminiProviderConfig, GeminiProviderHandle } from "./provider.js";
export { GeminiDocumentExtractionService } from "./gemini-document-extraction.service.js";
export { GeminiInterviewAgentService } from "./gemini-interview-agent.service.js";
export { GeminiInterviewPlannerService } from "./gemini-interview-planner.service.js";
export { GeminiInterviewEvaluatorService } from "./gemini-interview-evaluator.service.js"; // ← add
```

---

### Step 15 — Composition: `buildEvaluateInterviewUseCase`

**File:** `apps/backend/src/composition/evaluate-interview.composition.ts` (CREATE — separate from `interview-session.composition.ts` because evaluation and session-runtime have different lifecycles)

```typescript
import { createRequire } from "node:module";
import {
  EvaluateInterviewUseCase,
  GetReportByInterviewIdUseCase,
} from "@repo/application";
import {
  geminiProviderFromEnv,
  GeminiInterviewEvaluatorService,
} from "../infrastructure/services/gemini/index.js";
import {
  DrizzleInterviewRepository,
  DrizzleReportRepository,
} from "../infrastructure/repositories/index.js";
import type { Database } from "../infrastructure/persistence/db.js";

const require = createRequire(import.meta.url);

export interface EvaluateInterviewCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export interface EvaluateInterviewDepsBundle {
  readonly buildEvaluateUseCase: () => EvaluateInterviewUseCase;
  readonly buildGetReportUseCase: () => GetReportByInterviewIdUseCase;
}

export function buildEvaluateInterviewDeps(
  options: EvaluateInterviewCompositionOptions = {},
): EvaluateInterviewDepsBundle {
  const env = options.env ?? process.env;
  const geminiHandleResult = geminiProviderFromEnv(env);
  if (geminiHandleResult.isErr()) {
    throw new Error(`Boot failed: ${geminiHandleResult.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const interviews = new DrizzleInterviewRepository(db);
  const reports = new DrizzleReportRepository(db);
  const evaluator = new GeminiInterviewEvaluatorService(geminiHandleResult.unwrap());

  return {
    buildEvaluateUseCase: () =>
      new EvaluateInterviewUseCase({ interviews, reports, evaluator }),
    buildGetReportUseCase: () => new GetReportByInterviewIdUseCase(reports),
  };
}
```

**Invariant check:** Boot-time `throw` is intentional (mirrors `buildInterviewSessionDeps`); env failures are fatal at process start, not runtime. ESM-safe `createRequire` for the lazy `db` singleton mirrors Phase 5's pattern. Use cases are fresh per request via factory functions.

---

### Step 16 — Tests (unit)

Tests for each new public surface. See **Test matrix** below for the full table.

| File (CREATE) | Coverage |
|---|---|
| `packages/application/src/dtos/evaluate-interview.dto.test.ts` | DTO valid input, empty `interviewId`, missing field |
| `packages/application/src/use-cases/interview/evaluate-interview.use-case.test.ts` | success, not found, wrong status, report already exists (idempotency), evaluator error propagated, `Report.create` failure mapped to `EvaluatorOutputInvalidError`, interview-save failure mapped to `ServiceUnknownError`, report-save failure mapped to `ServiceUnknownError` |
| `packages/application/src/use-cases/report/get-report-by-interview-id.use-case.test.ts` | found (Some), not found (None), repo error |
| `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts` | success path returns `ReportCreateProps`, `NoObjectGeneratedError` → `EvaluatorOutputInvalidError`, `RetryError` / `fetch failed` / 5xx → `EvaluatorUnavailableError`, generic Error → `EvaluatorUnknownError`, telemetry metadata present, lift failure when `TopicScore.score` > 5 → `EvaluatorOutputInvalidError` |
| `apps/backend/src/composition/evaluate-interview.composition.test.ts` | throws when `GOOGLE_GENERATIVE_AI_API_KEY` missing, returns factories when env + db wired, factories produce fresh use cases per call |

Use the existing `gemini-interview-planner.service.test.ts` (`apps/backend/src/infrastructure/services/gemini/`) and `generate-interview-plan.use-case.test.ts` (`packages/application/src/use-cases/interview/`) as the literal templates for `vi.mock("ai", ...)` shape, repo mock shape, and DTO parse-failure assertions.

---

## Pseudo-workflow

### `EvaluateInterviewUseCase.execute(input)`

```
load interview (repo.findById)
  ↓ (repo error)            → Result.Err(ServiceUnknownError("InterviewRepository.findById"))
  ↓ (Option.None)           → Result.Err(InterviewNotFoundError)
  ↓ (Option.Some(interview))
guard status === COMPLETED
  ↓ (not COMPLETED)         → Result.Err(InvalidInterviewStateTransitionError)
idempotency check (reports.findByInterviewId)
  ↓ (repo error)            → Result.Err(ServiceUnknownError("ReportRepository.findByInterviewId"))
  ↓ (Option.Some(report))   → Result.Ok({ report: existing.serialize() })  // short-circuit
  ↓ (Option.None)
evaluator.evaluate({ JD, CV, clientInstructions, transcript, notes, internalScores, rubric })
  ↓ (EvaluatorError)        → Result.Err(EvaluatorError as ServiceError)
  ↓ (Result.Ok(reportProps))
Report.create(reportProps)                                  // re-validation defence-in-depth
  ↓ (InvalidReportInputError) → Result.Err(EvaluatorOutputInvalidError)
  ↓ (Result.Ok(report))
reports.save(report)
  ↓ (repo error)            → Result.Err(ServiceUnknownError("ReportRepository.save"))
  ↓ (Result.Ok(savedReport))
interview.markEvaluated(savedReport.id)
  ↓ (InvalidInterviewStateTransitionError) → Result.Err(state error as ServiceError)
  ↓ (Result.Ok(markedInterview))
interviews.save(markedInterview)
  ↓ (repo error)            → Result.Err(ServiceUnknownError("InterviewRepository.save"))
  ↓ (Result.Ok(_))
Result.Ok({ report: savedReport.serialize() })
```

### `GeminiInterviewEvaluatorService.evaluate(input)`

```
tracer.startSpan("interview.evaluation", { interview.id, evaluator.model, ... })
Result.tryAsyncCatch(
  async () => generateText({ model, output: Output.object({ schema: evaluatorSchema, ... }), prompt, experimental_telemetry }),
  err => { span.recordException(err); return mapAiError(err); }
)
  .flatMap(raw => liftReport(raw, interviewId))            // TopicScore.create per topic
  .tap(() => span.end()) / .tapErr(() => span.end())
  .toPromise()
```

### `GetReportByInterviewIdUseCase.execute(input)`

```
reports.findByInterviewId(input.interviewId)
  ↓ (repo error)  → Result.Err(ServiceUnknownError)
  ↓ (Result.Ok(Option<Report>))
Result.Ok({ report: option.map(r => r.serialize()) })
```

---

## Test matrix

| # | File | Case | Expectation |
|---|---|---|---|
| 1 | `evaluate-interview.dto.test.ts` | Valid `{ interviewId: "abc" }` | `Result.Ok(dto)`, `dto.value.interviewId === "abc"` |
| 2 | same | `{ interviewId: "" }` | `Result.Err(DtoValidationError)` |
| 3 | same | `{}` (missing) | `Result.Err(DtoValidationError)` |
| 4 | `evaluate-interview.use-case.test.ts` | Happy path: COMPLETED interview, no existing report, evaluator returns valid props | Returns `Ok({ report: serializedReport })`; `interviews.save` called with `status === EVALUATED` and `reportId === report.id`; `reports.save` called once |
| 5 | same | `interviews.findById` returns `Err` | `Err(ServiceUnknownError)` |
| 6 | same | `interviews.findById` returns `Ok(None)` | `Err(InterviewNotFoundError)` |
| 7 | same | Interview status is `SCHEDULED` (or any non-COMPLETED) | `Err(InvalidInterviewStateTransitionError)`; evaluator **not** called |
| 8 | same | Existing report present (idempotency) | `Ok({ report: existing.serialize() })`; evaluator **not** called; no save |
| 9 | same | `reports.findByInterviewId` returns `Err` | `Err(ServiceUnknownError("ReportRepository.findByInterviewId"))` |
| 10 | same | Evaluator returns `Err(EvaluatorUnavailableError)` | `Err(EvaluatorUnavailableError)`; no saves |
| 11 | same | Evaluator returns valid props but `topicScores` is empty | `Err(EvaluatorOutputInvalidError)` (via `Report.create`); no saves |
| 12 | same | Evaluator OK, but `reports.save` returns `Err` | `Err(ServiceUnknownError("ReportRepository.save"))`; `interviews.save` **not** called |
| 13 | same | Evaluator + report-save OK, but `interviews.save` returns `Err` | `Err(ServiceUnknownError("InterviewRepository.save"))`; subsequent retry would hit idempotency branch (covered by case 8) |
| 14 | `get-report-by-interview-id.use-case.test.ts` | Repo returns `Ok(Some(report))` | `Ok({ report: Option.Some(serialized) })` |
| 15 | same | Repo returns `Ok(None)` | `Ok({ report: Option.None })` |
| 16 | same | Repo returns `Err` | `Err(ServiceUnknownError)` |
| 17 | `gemini-interview-evaluator.service.test.ts` | `generateText` resolves with valid output | `Ok(reportProps)`; `output.topicScores` is `TopicScore[]`; `experimental_telemetry.metadata.interviewId` present |
| 18 | same | `generateText` rejects with `NoObjectGeneratedError` (mocked) | `Err(EvaluatorOutputInvalidError)` |
| 19 | same | `generateText` rejects with `RetryError` (mocked) | `Err(EvaluatorUnavailableError)` |
| 20 | same | `generateText` rejects with `Error("fetch failed")` | `Err(EvaluatorUnavailableError)` |
| 21 | same | `generateText` rejects with status 503 (custom error) | `Err(EvaluatorUnavailableError)` |
| 22 | same | `generateText` rejects with generic `Error("boom")` | `Err(EvaluatorUnknownError("boom"))` |
| 23 | same | `generateText` resolves with raw output where one `score` = 6 | `Err(EvaluatorOutputInvalidError)` (via `TopicScore.create`) |
| 24 | same | Span name is `"interview.evaluation"` and `interview.id` attribute set | Asserted via mocked `tracer.startSpan` spy |
| 25 | `evaluate-interview.composition.test.ts` | Missing `GOOGLE_GENERATIVE_AI_API_KEY` | Throws at boot |
| 26 | same | Env + db wired | `buildEvaluateUseCase()` and `buildGetReportUseCase()` both callable; each call returns a fresh instance |

---

## Verification checklist

Run in order **after all edits are complete** (CLAUDE.md Rule 5 — never mid-session):

1. Layer skills already engaged during implementation. For Phase 6:
   - `/backend-application-layer` for the application files (steps 1–12).
   - `/backend-infrastructure-layer` for the Gemini adapter and composition helper (steps 13–15).

2. Per-layer architecture validation (CLAUDE.md Rule 4):
   ```bash
   /backend-arch-validator application
   /backend-arch-validator infrastructure
   ```

3. Generate or extend tests (CLAUDE.md Rule 6):
   ```bash
   /backend-test-suite
   ```
   Confirm coverage of the 26 cases in the test matrix.

4. Type-check and run the test suites:
   ```bash
   pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
   pnpm turbo run test --filter=@repo/application
   pnpm turbo run test --filter=backend
   ```
   Domain tests do **not** need re-running (no domain changes). Re-run if `pnpm turbo` reports the domain package as affected.

5. Adapter-only focused test (smoke):
   ```bash
   pnpm --filter backend test -- --run src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts
   ```

6. Final code review gate (CLAUDE.md Rule 7):
   ```
   backend-code-reviewer  (pass plan path .claude/plan/phase-6-evaluation-and-reporting.md
                          and the full list of created/modified files)
   ```
   Task complete only on `PASS`.

7. Optional live smoke against Gemini (mirrors Phase 3 / Phase 5 patterns):
   - Seed a `COMPLETED` interview with at least 3 transcript entries, 1 note, 1 internal score
   - Boot the backend with provider keys configured
   - Invoke `EvaluateInterviewUseCase.execute({ interviewId })` from a scratch script under `apps/backend/src/scripts/`
   - Inspect the persisted row in `reports` and confirm the interview row's `status === EVALUATED` and `report_id` is set
   - Inspect Langfuse for the `interview.evaluation` root span with the expected attributes

---

## Open questions / decisions made

| # | Question | Decision | Rationale (one sentence) |
|---|---|---|---|
| Q1 | Is a separate output DTO needed? | No — use a plain `EvaluateInterviewOutput` interface returning `{ report: ReportSerialized }` | `BaseDto` is for input validation; outputs are typed records, mirroring `GenerateInterviewPlanOutput` and `ConductInterviewOutput`. |
| Q2 | `GenerateReport` separate use case or retrieval? | Retrieval — `GetReportByInterviewIdUseCase` | After `EvaluateInterviewUseCase` persists, generation and evaluation are the same operation; a query service is overkill for a single-row lookup. |
| Q3 | Rubric source | Hardcoded constant `EVALUATION_RUBRIC` in the application layer | Per-recruiter / per-JD rubric variation is a product decision deferred until justified; promotes to ADR-016 when a real driver emerges. |
| Q4 | Auto-fire eval at end of conduct? | No — explicit invocation | Decouples evaluator latency from the candidate's WebSocket lifecycle; lets Phase 7 expose evaluation as a separate HTTP route. |
| Q5 | OTel span hierarchy | Single root `interview.evaluation` span with `interview.id` attribute, no parent context | Evaluation runs after the session WebSocket closes; the `interview.session.agent` span is already ended, so reparenting is impossible — ADR-014 D7c already endorses this namespace. |
| Q6 | ADR-015 needed? | **Flag, do not author** | The three judgement calls (auto-fire, rubric storage, evaluation span parent) are policy decisions with no code surface — author ADR-015 only if a reviewer contests Q3 or Q4, or if Q5 needs to amend ADR-014 D7c. |

---

## Risk callouts

1. **Evaluator hallucination — wrong recommendation, out-of-range score, empty fields.**
   *Mitigation.* Two defensive layers: (i) the JSON schema in `evaluatorSchema` constrains shape, `enum`, and numeric bounds at the AI SDK layer; (ii) `liftReport` re-runs `TopicScore.create` per topic, and `Report.create` re-validates `topicScores.length > 0` and `communicationAssessment` non-empty. Either failure produces `EvaluatorOutputInvalidError` — no bad row hits the database.

2. **Partial failure between `reports.save(report)` and `interviews.save(markedInterview)`.**
   *Mitigation.* Idempotency check (step 3 of the use case) detects an existing report on retry and returns it without re-evaluating, then proceeds to `markEvaluated` and `interviews.save`. The risk window is therefore "report on disk, interview still `COMPLETED`" — bounded, detectable, and recoverable. Phase 10 may promote this to a Drizzle transaction or a unit-of-work pattern; for Phase 6 the two-write pattern matches existing repository contracts.

3. **Rubric drift.**
   *Mitigation.* Single source `EVALUATION_RUBRIC` constant. Changes are visible in `git log` for one file. If Phase 7 introduces per-JD rubric variation, the constant becomes a function `getRubricForJD(jd)` returning a `string` and the port stays unchanged because rubric is already an input field on `InterviewEvaluatorInput`.

4. **Evaluator unavailable mid-batch.**
   *Mitigation.* `EvaluatorUnavailableError` is a typed error. The caller (Phase 7 HTTP route, future batch job) can retry with backoff. The idempotency check makes retries safe.

5. **Domain mutation order.**
   *Mitigation.* Report is persisted **before** `interview.markEvaluated`. If we did the reverse, an evaluator-output validation failure on the second call would leave a phantom `reportId` pointing at a non-existent row. The current order produces an orphan report at worst, never a dangling FK.

6. **Span lifecycle.**
   *Mitigation.* `tap` / `tapErr` ensure `span.end()` runs on both success and failure paths. The `recordException` call inside the catch maps the raw error to a `RecordedException` event on the span before mapping it through `mapAiError` — Langfuse trace shows both the raw cause and the typed error.

7. **Evaluator output is too long → token budget exceeded.**
   *Mitigation.* Out of Phase 6 scope. Gemini 2.5 Pro's output token cap (8K+) is comfortable for the structured shape; truncation would surface as `NoObjectGeneratedError` → `EvaluatorOutputInvalidError`. Phase 10 may add output-token telemetry on the span and pre-flight token counting.

---

## Entry points (dependency order, innermost first)

| # | File | Package/Layer | Operation | Purpose |
|---|---|---|---|---|
| 1 | `packages/application/src/ports/interview-evaluator/interview-evaluator-error.ts` | @repo/application | CREATE | `EvaluatorError` hierarchy (4 classes) |
| 2 | `packages/application/src/ports/interview-evaluator/interview-evaluator.port.ts` | @repo/application | CREATE | `IInterviewEvaluatorService` + `InterviewEvaluatorInput` |
| 3 | `packages/application/src/ports/interview-evaluator/index.ts` | @repo/application | CREATE | Port barrel |
| 4 | `packages/application/src/ports/index.ts` | @repo/application | MODIFY | Re-export evaluator port barrel |
| 5 | `packages/application/src/use-cases/interview/evaluation-rubric.ts` | @repo/application | CREATE | `EVALUATION_RUBRIC` constant |
| 6 | `packages/application/src/dtos/evaluate-interview.dto.ts` | @repo/application | CREATE | `EvaluateInterviewInputDto` + `EvaluateInterviewOutput` |
| 7 | `packages/application/src/dtos/index.ts` | @repo/application | MODIFY | Export evaluator DTO |
| 8 | `packages/application/src/use-cases/interview/evaluate-interview.use-case.ts` | @repo/application | CREATE | `EvaluateInterviewUseCase` |
| 9 | `packages/application/src/use-cases/report/get-report-by-interview-id.use-case.ts` | @repo/application | CREATE | `GetReportByInterviewIdUseCase` |
| 10 | `packages/application/src/use-cases/report/index.ts` | @repo/application | CREATE | Report use-cases barrel |
| 11 | `packages/application/src/use-cases/interview/index.ts` | @repo/application | MODIFY | Export `EvaluateInterviewUseCase` + `EVALUATION_RUBRIC` |
| 12 | `packages/application/src/use-cases/index.ts` | @repo/application | MODIFY | Re-export `report/` barrel |
| 13 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts` | backend / infra | CREATE | `GeminiInterviewEvaluatorService` |
| 14 | `apps/backend/src/infrastructure/services/gemini/index.ts` | backend / infra | MODIFY | Export evaluator service |
| 15 | `apps/backend/src/composition/evaluate-interview.composition.ts` | backend / composition | CREATE | Boot-time wiring for evaluator + report use cases |
| 16 | `packages/application/src/dtos/evaluate-interview.dto.test.ts` | @repo/application | CREATE | DTO tests |
| 17 | `packages/application/src/use-cases/interview/evaluate-interview.use-case.test.ts` | @repo/application | CREATE | Use-case tests (cases 4–13) |
| 18 | `packages/application/src/use-cases/report/get-report-by-interview-id.use-case.test.ts` | @repo/application | CREATE | Retrieval use-case tests |
| 19 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts` | backend / infra | CREATE | Adapter tests (cases 17–24) |
| 20 | `apps/backend/src/composition/evaluate-interview.composition.test.ts` | backend / composition | CREATE | Composition tests (cases 25–26) |

No changes are required to:

- `packages/domain/**` — `Interview.markEvaluated`, `INTERVIEW_STATUS.EVALUATED`, `Report.create`, `TopicScore.create`, and `IReportRepository` are all present.
- `apps/backend/src/infrastructure/persistence/schema/reports.ts` — the existing schema already covers every field.
- `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts` — `save`, `findById`, `findByInterviewId` already match the use-case needs.
- `apps/backend/src/presentation/**` — Phase 7 owns route exposure.

---

## ADR-015 flag (do not author)

Three judgement calls in this plan may warrant ADR-015 if a reviewer disagrees. Author the ADR only on contestation, not preemptively.

- **Q3 — Hardcoded rubric.** If reviewers want the rubric on the `Interview` aggregate or in a `rubrics` table, ADR-015 is the right place to record that decision and would block the implementation step 5 above.
- **Q4 — Explicit invocation, not auto-fire.** If reviewers want `ConductInterviewUseCase` to auto-fire evaluation at the end of a successful session, ADR-015 records the policy and the implementation chains the two use cases in the composition root.
- **Q5 — Evaluator span as a separate root.** ADR-014 D7c reserves the `interview.evaluation.*` namespace but does not specify the parent context. If reviewers want this nested under the session span (impossible due to span lifetime — but reviewers may prefer a synthetic linkage via `Link` rather than parent-context), ADR-015 supersedes the relevant part of ADR-014 D7c.
