# Plan: Phase 1 — Domain Foundation + Minimal Application

> Generated: 2026-04-29
> Slug: phase-1-domain-foundation
> Source spec: `docs/ARCHITECTURE.md` §3.2, §4.7, §5.4, §6, §7

## Summary

Phase 1 builds the persistence-shaped, AI-free, infrastructure-free skeleton of the Interview/Report domain. We create the two aggregate roots (`Interview`, `Report`), their value objects (`JobDescription`, `CandidateInfo`, `InterviewPlan`, `PlannedTopic`, `TopicScore`, `FileRef`, `TranscriptEntry`), the interview state machine, the two repository ports in domain, the two service ports in application (`IFileStorageService`, `IDocumentExtractionService`), the shared `BaseDto<T>`, and the two AI-free use cases (`UploadCandidateDocuments`, `CreateInterview`) with their Zod 4 DTOs and co-located Vitest suites. No persistence, no Drizzle, no adapters, no AI, no routes — all of those land in Phases 2/3/7.

## Layers touched

| Layer          | Package / Location                      | Scope                                                                                       |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                      | New `entities/{interview,report}/`; new `shared/value-objects/file-ref.ts`; barrel updates  |
| Application    | `packages/application/`                 | New `core/base-dto.ts`; new `ports/`; new `dtos/`; new `use-cases/{interview,documents}/`   |
| Infrastructure | `apps/backend/src/infrastructure/`      | none (Phase 2)                                                                              |
| Presentation   | `apps/backend/src/presentation/`        | none (Phase 7)                                                                              |

## Decision points

These are the explicit design choices made by this plan; an implementer must not deviate without re-planning.

1. **Value-object location strategy.**
   - `JobDescription`, `CandidateInfo`, `InterviewPlan`, `PlannedTopic`, `TranscriptEntry` are **co-located under the `Interview` aggregate** at `packages/domain/src/entities/interview/value-objects/` because they only have meaning inside an interview.
   - `TopicScore` is co-located under the `Report` aggregate at `packages/domain/src/entities/report/value-objects/` because it only appears in a report.
   - `FileRef` is **shared** across aggregates (Interview holds JD/CV refs; future Report may hold audio refs) → lives at `packages/domain/src/shared/value-objects/file-ref.ts`.

2. **`Interview.report` representation.**
   - The `Interview` aggregate does **NOT** embed a `Report`. It carries at most an `Option<ReportId>` (string-tagged) called `reportId`. Crossing aggregate boundaries inside an entity is forbidden — the application layer fetches the report separately when needed.

3. **`CreateInterview` input shape.**
   - `CreateInterview` accepts already-extracted `JobDescription` and `CandidateInfo` value objects directly, plus `clientInstructions`, `scheduledAt`, `jdFileRef`, `cvFileRef`. The use case does NOT call `IDocumentExtractionService` in Phase 1 — that wiring lands in Phase 3 (likely as a separate `ExtractCandidateDocuments` use case or inline inside a future `CreateInterviewFromUploads`). The port interface still ships in Phase 1 so Phase 2/3 can implement the adapter without touching the application layer.

4. **`TranscriptEntry` shape.**
   - Phase 1 needs a minimum-viable shape so the `Interview.transcript` array can typecheck. Defined as `{ speaker: "agent" | "candidate"; text: string; timestamp: Date }`. Exact streaming semantics (tokens, partials) belong to Phase 4/5.

5. **`InterviewPlan` on `Interview`.**
   - Stored as `Option<InterviewPlan>` because it is generated post-creation in `CREATED → SCHEDULED` transition (Phase 3). In Phase 1, every newly created interview has `interviewPlan = Option.None`.

6. **ID generation.**
   - All entity IDs are `string` (UUID v4 produced via `node:crypto.randomUUID()` inside the static `create(...)` factory). No branded types in Phase 1 — keep it simple. `InterviewId` / `ReportId` are type aliases (`type InterviewId = string`) so we can promote to branded types later without churn.

7. **`StorageError` hierarchy.**
   - `StorageError` is a subclass of `ServiceInfraError` (already in `@repo/application` core). Lives at `packages/application/src/ports/storage/storage-error.ts`. Concrete codes: `STORAGE_UNAVAILABLE`, `STORAGE_NOT_FOUND`, `STORAGE_UNKNOWN`.

8. **`DocumentExtractionError` hierarchy.**
   - Same pattern: subclass of `ServiceInfraError`, lives at `packages/application/src/ports/document-extraction/document-extraction-error.ts`. Codes: `EXTRACTION_UNAVAILABLE`, `EXTRACTION_PARSE_FAILED`, `EXTRACTION_UNKNOWN`.

## File tree (Phase 1)

```
packages/domain/src/
├── shared/
│   ├── value-objects/
│   │   ├── file-ref.ts                                      [CREATE]
│   │   └── index.ts                                         [CREATE]
│   └── index.ts                                             [MODIFY]
├── entities/
│   ├── interview/
│   │   ├── interview.entity.ts                              [CREATE]
│   │   ├── interview.entity.test.ts                         [CREATE]
│   │   ├── interview.repository.ts                          [CREATE]
│   │   ├── interview-status.ts                              [CREATE]
│   │   ├── interview-status.test.ts                         [CREATE]
│   │   ├── value-objects/
│   │   │   ├── job-description.ts                           [CREATE]
│   │   │   ├── job-description.test.ts                      [CREATE]
│   │   │   ├── candidate-info.ts                            [CREATE]
│   │   │   ├── candidate-info.test.ts                       [CREATE]
│   │   │   ├── interview-plan.ts                            [CREATE]
│   │   │   ├── interview-plan.test.ts                       [CREATE]
│   │   │   ├── planned-topic.ts                             [CREATE]
│   │   │   ├── transcript-entry.ts                          [CREATE]
│   │   │   └── index.ts                                     [CREATE]
│   │   ├── errors/
│   │   │   └── interview.errors.ts                          [CREATE]
│   │   └── index.ts                                         [CREATE]
│   ├── report/
│   │   ├── report.entity.ts                                 [CREATE]
│   │   ├── report.entity.test.ts                            [CREATE]
│   │   ├── report.repository.ts                             [CREATE]
│   │   ├── value-objects/
│   │   │   ├── topic-score.ts                               [CREATE]
│   │   │   ├── topic-score.test.ts                          [CREATE]
│   │   │   └── index.ts                                     [CREATE]
│   │   ├── errors/
│   │   │   └── report.errors.ts                             [CREATE]
│   │   └── index.ts                                         [CREATE]
│   └── index.ts                                             [CREATE]
└── index.ts                                                 [MODIFY]

packages/application/src/
├── core/
│   ├── base-dto.ts                                          [CREATE]
│   ├── base-dto.test.ts                                     [CREATE]
│   └── index.ts                                             [MODIFY]
├── ports/
│   ├── storage/
│   │   ├── file-storage.port.ts                             [CREATE]
│   │   ├── storage-error.ts                                 [CREATE]
│   │   └── index.ts                                         [CREATE]
│   ├── document-extraction/
│   │   ├── document-extraction.port.ts                      [CREATE]
│   │   ├── document-extraction-error.ts                     [CREATE]
│   │   └── index.ts                                         [CREATE]
│   └── index.ts                                             [CREATE]
├── dtos/
│   ├── upload-candidate-documents.dto.ts                    [CREATE]
│   ├── upload-candidate-documents.dto.test.ts               [CREATE]
│   ├── create-interview.dto.ts                              [CREATE]
│   ├── create-interview.dto.test.ts                         [CREATE]
│   └── index.ts                                             [CREATE]
├── use-cases/
│   ├── documents/
│   │   ├── upload-candidate-documents.use-case.ts           [CREATE]
│   │   ├── upload-candidate-documents.use-case.test.ts      [CREATE]
│   │   └── index.ts                                         [CREATE]
│   ├── interview/
│   │   ├── create-interview.use-case.ts                     [CREATE]
│   │   ├── create-interview.use-case.test.ts                [CREATE]
│   │   └── index.ts                                         [CREATE]
│   └── index.ts                                             [CREATE]
└── index.ts                                                 [MODIFY]
```

---

## Implementation steps

### ─────────── DOMAIN LAYER ───────────

### Step 1 — Domain: shared `FileRef` value object

**File:** `packages/domain/src/shared/value-objects/file-ref.ts` (CREATE)

**What:** Immutable value object describing a file persisted via `IFileStorageService`.

```typescript
import { Result } from "@carbonteq/fp";
import { ValidationError } from "../domain-error.js";

export class InvalidFileRefError extends ValidationError {
  readonly code = "INVALID_FILE_REF";
}

export interface FileRefProps {
  readonly key: string;          // storage key, e.g. "interviews/abc/cv.pdf"
  readonly contentType: string;  // MIME, e.g. "application/pdf"
  readonly sizeBytes: number;
  readonly originalFilename: string;
  readonly uploadedAt: Date;
}

export class FileRef {
  private constructor(
    readonly key: string,
    readonly contentType: string,
    readonly sizeBytes: number,
    readonly originalFilename: string,
    readonly uploadedAt: Date,
  ) {}

  static create(props: FileRefProps): Result<FileRef, InvalidFileRefError> {
    if (!props.key.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.key must not be empty"));
    }
    if (!props.contentType.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.contentType must not be empty"));
    }
    if (!Number.isFinite(props.sizeBytes) || props.sizeBytes < 0) {
      return Result.Err(new InvalidFileRefError("FileRef.sizeBytes must be a non-negative finite number"));
    }
    if (!props.originalFilename.trim()) {
      return Result.Err(new InvalidFileRefError("FileRef.originalFilename must not be empty"));
    }
    return Result.Ok(
      new FileRef(props.key, props.contentType, props.sizeBytes, props.originalFilename, props.uploadedAt),
    );
  }

  serialize(): FileRefProps {
    return {
      key: this.key,
      contentType: this.contentType,
      sizeBytes: this.sizeBytes,
      originalFilename: this.originalFilename,
      uploadedAt: this.uploadedAt,
    };
  }

  static fromSerialized(data: FileRefProps): FileRef {
    // Trusted persistence path — caller guarantees validity.
    return new FileRef(data.key, data.contentType, data.sizeBytes, data.originalFilename, data.uploadedAt);
  }
}
```

**Invariant check:** Domain has zero outward imports. Factory returns `Result<FileRef, ValidationError>`. All props readonly.

---

### Step 2 — Domain: shared value-object barrel

**File:** `packages/domain/src/shared/value-objects/index.ts` (CREATE)

```typescript
export { FileRef, InvalidFileRefError } from "./file-ref.js";
export type { FileRefProps } from "./file-ref.js";
```

---

### Step 3 — Domain: extend shared barrel

**File:** `packages/domain/src/shared/index.ts` (MODIFY)

**Diff:**
```typescript
export { BaseEntity } from "./base.entity.js";
export type { IEntity, CreateEntity, SimpleSerialized } from "./base.entity.js";
export { DomainError, ValidationError, NotFoundError, ConflictError, BusinessRuleViolationError } from "./domain-error.js";
export { DomainEvent } from "./domain-event.js";
+ export * from "./value-objects/index.js";
```

---

### Step 4 — Domain: `InterviewStatus` enum + transition table

**File:** `packages/domain/src/entities/interview/interview-status.ts` (CREATE)

```typescript
export const INTERVIEW_STATUS = {
  CREATED: "CREATED",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  EVALUATED: "EVALUATED",
  CANCELLED: "CANCELLED",
} as const;

export type InterviewStatus = (typeof INTERVIEW_STATUS)[keyof typeof INTERVIEW_STATUS];

/**
 * Allowed transitions (closed set per §5.4):
 *   CREATED      → SCHEDULED
 *   SCHEDULED    → IN_PROGRESS
 *   IN_PROGRESS  → COMPLETED | CANCELLED
 *   COMPLETED    → EVALUATED
 *   EVALUATED    → (terminal)
 *   CANCELLED    → (terminal)
 */
const ALLOWED: Readonly<Record<InterviewStatus, ReadonlyArray<InterviewStatus>>> = {
  CREATED: ["SCHEDULED"],
  SCHEDULED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["EVALUATED"],
  EVALUATED: [],
  CANCELLED: [],
};

export const InterviewStatusPolicy = {
  canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
    return ALLOWED[from].includes(to);
  },
  isTerminal(status: InterviewStatus): boolean {
    return ALLOWED[status].length === 0;
  },
} as const;
```

**Invariant check:** Pure data + pure functions. No I/O. Importable from anywhere in domain.

---

### Step 5 — Domain: Interview-aggregate errors

**File:** `packages/domain/src/entities/interview/errors/interview.errors.ts` (CREATE)

```typescript
import {
  BusinessRuleViolationError,
  NotFoundError,
  ValidationError,
} from "../../../shared/domain-error.js";
import type { InterviewStatus } from "../interview-status.js";

export class InvalidInterviewStateTransitionError extends BusinessRuleViolationError {
  readonly code = "INVALID_INTERVIEW_STATE_TRANSITION";
  constructor(from: InterviewStatus, to: InterviewStatus) {
    super(`Cannot transition Interview from ${from} to ${to}`);
  }
}

export class InterviewPlanRequiredError extends BusinessRuleViolationError {
  readonly code = "INTERVIEW_PLAN_REQUIRED";
  constructor() {
    super("Interview cannot be SCHEDULED without an InterviewPlan");
  }
}

export class InvalidInterviewInputError extends ValidationError {
  readonly code = "INVALID_INTERVIEW_INPUT";
}

export class InterviewNotFoundError extends NotFoundError {
  readonly code = "INTERVIEW_NOT_FOUND";
  constructor(id: string) {
    super(`Interview with id ${id} not found`);
  }
}
```

**Invariant check:** All errors extend the abstract domain hierarchy. SCREAMING_SNAKE_CASE codes.

---

### Step 6 — Domain: `JobDescription` value object

**File:** `packages/domain/src/entities/interview/value-objects/job-description.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface JobDescriptionProps {
  readonly title: string;
  readonly company: string;
  readonly responsibilities: ReadonlyArray<string>;
  readonly requirements: ReadonlyArray<string>;
  readonly rawText: string; // unparsed JD body, kept for traceability
}

export class JobDescription {
  private constructor(
    readonly title: string,
    readonly company: string,
    readonly responsibilities: ReadonlyArray<string>,
    readonly requirements: ReadonlyArray<string>,
    readonly rawText: string,
  ) {}

  static create(props: JobDescriptionProps): Result<JobDescription, InvalidInterviewInputError> {
    if (!props.title.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.title must not be empty"));
    }
    if (!props.company.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.company must not be empty"));
    }
    if (!props.rawText.trim()) {
      return Result.Err(new InvalidInterviewInputError("JobDescription.rawText must not be empty"));
    }
    return Result.Ok(
      new JobDescription(
        props.title,
        props.company,
        Object.freeze([...props.responsibilities]),
        Object.freeze([...props.requirements]),
        props.rawText,
      ),
    );
  }

  serialize(): JobDescriptionProps {
    return {
      title: this.title,
      company: this.company,
      responsibilities: this.responsibilities,
      requirements: this.requirements,
      rawText: this.rawText,
    };
  }

  static fromSerialized(data: JobDescriptionProps): JobDescription {
    return new JobDescription(
      data.title,
      data.company,
      Object.freeze([...data.responsibilities]),
      Object.freeze([...data.requirements]),
      data.rawText,
    );
  }
}
```

---

### Step 7 — Domain: `CandidateInfo` value object

**File:** `packages/domain/src/entities/interview/value-objects/candidate-info.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface CandidateInfoProps {
  readonly fullName: string;
  readonly email: string;
  readonly headline: string;            // e.g. "Senior Backend Engineer"
  readonly yearsOfExperience: number;
  readonly skills: ReadonlyArray<string>;
  readonly education: ReadonlyArray<string>;
  readonly rawText: string;             // unparsed CV body
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CandidateInfo {
  private constructor(
    readonly fullName: string,
    readonly email: string,
    readonly headline: string,
    readonly yearsOfExperience: number,
    readonly skills: ReadonlyArray<string>,
    readonly education: ReadonlyArray<string>,
    readonly rawText: string,
  ) {}

  static create(props: CandidateInfoProps): Result<CandidateInfo, InvalidInterviewInputError> {
    if (!props.fullName.trim()) {
      return Result.Err(new InvalidInterviewInputError("CandidateInfo.fullName must not be empty"));
    }
    if (!EMAIL.test(props.email)) {
      return Result.Err(new InvalidInterviewInputError(`CandidateInfo.email is invalid: ${props.email}`));
    }
    if (!Number.isFinite(props.yearsOfExperience) || props.yearsOfExperience < 0) {
      return Result.Err(new InvalidInterviewInputError("CandidateInfo.yearsOfExperience must be >= 0"));
    }
    return Result.Ok(
      new CandidateInfo(
        props.fullName,
        props.email,
        props.headline,
        props.yearsOfExperience,
        Object.freeze([...props.skills]),
        Object.freeze([...props.education]),
        props.rawText,
      ),
    );
  }

  serialize(): CandidateInfoProps {
    return {
      fullName: this.fullName,
      email: this.email,
      headline: this.headline,
      yearsOfExperience: this.yearsOfExperience,
      skills: this.skills,
      education: this.education,
      rawText: this.rawText,
    };
  }

  static fromSerialized(data: CandidateInfoProps): CandidateInfo {
    return new CandidateInfo(
      data.fullName,
      data.email,
      data.headline,
      data.yearsOfExperience,
      Object.freeze([...data.skills]),
      Object.freeze([...data.education]),
      data.rawText,
    );
  }
}
```

---

### Step 8 — Domain: `PlannedTopic` value object

**File:** `packages/domain/src/entities/interview/value-objects/planned-topic.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export const TOPIC_PRIORITY = {
  MUST_COVER: "must_cover",
  IF_TIME_PERMITS: "if_time_permits",
} as const;

export type TopicPriority = (typeof TOPIC_PRIORITY)[keyof typeof TOPIC_PRIORITY];

export interface PlannedTopicProps {
  readonly name: string;
  readonly questions: ReadonlyArray<string>;
  readonly timeAllocationMinutes: number;
  readonly priority: TopicPriority;
}

export class PlannedTopic {
  private constructor(
    readonly name: string,
    readonly questions: ReadonlyArray<string>,
    readonly timeAllocationMinutes: number,
    readonly priority: TopicPriority,
  ) {}

  static create(props: PlannedTopicProps): Result<PlannedTopic, InvalidInterviewInputError> {
    if (!props.name.trim()) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.name must not be empty"));
    }
    if (props.questions.length === 0) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.questions must contain at least one question"));
    }
    if (!Number.isFinite(props.timeAllocationMinutes) || props.timeAllocationMinutes <= 0) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.timeAllocationMinutes must be > 0"));
    }
    return Result.Ok(
      new PlannedTopic(
        props.name,
        Object.freeze([...props.questions]),
        props.timeAllocationMinutes,
        props.priority,
      ),
    );
  }

  serialize(): PlannedTopicProps {
    return {
      name: this.name,
      questions: this.questions,
      timeAllocationMinutes: this.timeAllocationMinutes,
      priority: this.priority,
    };
  }

  static fromSerialized(data: PlannedTopicProps): PlannedTopic {
    return new PlannedTopic(data.name, Object.freeze([...data.questions]), data.timeAllocationMinutes, data.priority);
  }
}
```

---

### Step 9 — Domain: `InterviewPlan` value object

**File:** `packages/domain/src/entities/interview/value-objects/interview-plan.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import { PlannedTopic, type PlannedTopicProps } from "./planned-topic.js";

export const DEFAULT_TARGET_DURATION_MIN = 15;
export const DEFAULT_MAX_DURATION_MIN = 25;

export interface InterviewPlanProps {
  readonly topics: ReadonlyArray<PlannedTopic>;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly mustAskQuestions: ReadonlyArray<string>;
}

export interface InterviewPlanSerialized {
  readonly topics: ReadonlyArray<PlannedTopicProps>;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly mustAskQuestions: ReadonlyArray<string>;
}

export class InterviewPlan {
  private constructor(
    readonly topics: ReadonlyArray<PlannedTopic>,
    readonly targetDurationMinutes: number,
    readonly maxDurationMinutes: number,
    readonly mustAskQuestions: ReadonlyArray<string>,
  ) {}

  static create(props: InterviewPlanProps): Result<InterviewPlan, InvalidInterviewInputError> {
    if (props.topics.length === 0) {
      return Result.Err(new InvalidInterviewInputError("InterviewPlan.topics must not be empty"));
    }
    if (props.targetDurationMinutes <= 0) {
      return Result.Err(new InvalidInterviewInputError("InterviewPlan.targetDurationMinutes must be > 0"));
    }
    if (props.maxDurationMinutes < props.targetDurationMinutes) {
      return Result.Err(
        new InvalidInterviewInputError("InterviewPlan.maxDurationMinutes must be >= targetDurationMinutes"),
      );
    }
    return Result.Ok(
      new InterviewPlan(
        Object.freeze([...props.topics]),
        props.targetDurationMinutes,
        props.maxDurationMinutes,
        Object.freeze([...props.mustAskQuestions]),
      ),
    );
  }

  serialize(): InterviewPlanSerialized {
    return {
      topics: this.topics.map((t) => t.serialize()),
      targetDurationMinutes: this.targetDurationMinutes,
      maxDurationMinutes: this.maxDurationMinutes,
      mustAskQuestions: this.mustAskQuestions,
    };
  }

  static fromSerialized(data: InterviewPlanSerialized): InterviewPlan {
    return new InterviewPlan(
      Object.freeze(data.topics.map((t) => PlannedTopic.fromSerialized(t))),
      data.targetDurationMinutes,
      data.maxDurationMinutes,
      Object.freeze([...data.mustAskQuestions]),
    );
  }
}
```

---

### Step 10 — Domain: `TranscriptEntry` value object

**File:** `packages/domain/src/entities/interview/value-objects/transcript-entry.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export const SPEAKER = { AGENT: "agent", CANDIDATE: "candidate" } as const;
export type Speaker = (typeof SPEAKER)[keyof typeof SPEAKER];

export interface TranscriptEntryProps {
  readonly speaker: Speaker;
  readonly text: string;
  readonly timestamp: Date;
}

export class TranscriptEntry {
  private constructor(
    readonly speaker: Speaker,
    readonly text: string,
    readonly timestamp: Date,
  ) {}

  static create(props: TranscriptEntryProps): Result<TranscriptEntry, InvalidInterviewInputError> {
    if (!props.text.trim()) {
      return Result.Err(new InvalidInterviewInputError("TranscriptEntry.text must not be empty"));
    }
    return Result.Ok(new TranscriptEntry(props.speaker, props.text, props.timestamp));
  }

  serialize(): TranscriptEntryProps {
    return { speaker: this.speaker, text: this.text, timestamp: this.timestamp };
  }

  static fromSerialized(data: TranscriptEntryProps): TranscriptEntry {
    return new TranscriptEntry(data.speaker, data.text, data.timestamp);
  }
}
```

---

### Step 11 — Domain: Interview value-object barrel

**File:** `packages/domain/src/entities/interview/value-objects/index.ts` (CREATE)

```typescript
export { JobDescription } from "./job-description.js";
export type { JobDescriptionProps } from "./job-description.js";
export { CandidateInfo } from "./candidate-info.js";
export type { CandidateInfoProps } from "./candidate-info.js";
export { PlannedTopic, TOPIC_PRIORITY } from "./planned-topic.js";
export type { PlannedTopicProps, TopicPriority } from "./planned-topic.js";
export {
  InterviewPlan,
  DEFAULT_TARGET_DURATION_MIN,
  DEFAULT_MAX_DURATION_MIN,
} from "./interview-plan.js";
export type { InterviewPlanProps, InterviewPlanSerialized } from "./interview-plan.js";
export { TranscriptEntry, SPEAKER } from "./transcript-entry.js";
export type { TranscriptEntryProps, Speaker } from "./transcript-entry.js";
```

---

### Step 12 — Domain: `Interview` aggregate root

**File:** `packages/domain/src/entities/interview/interview.entity.ts` (CREATE)

```typescript
import { randomUUID } from "node:crypto";
import { Option, Result } from "@carbonteq/fp";
import { BaseEntity } from "../../shared/base.entity.js";
import { FileRef, type FileRefProps } from "../../shared/value-objects/index.js";
import {
  InvalidInterviewStateTransitionError,
  InterviewPlanRequiredError,
} from "./errors/interview.errors.js";
import {
  INTERVIEW_STATUS,
  type InterviewStatus,
  InterviewStatusPolicy,
} from "./interview-status.js";
import {
  CandidateInfo,
  type CandidateInfoProps,
  InterviewPlan,
  type InterviewPlanSerialized,
  JobDescription,
  type JobDescriptionProps,
  TranscriptEntry,
  type TranscriptEntryProps,
} from "./value-objects/index.js";

export type InterviewId = string;
export type RecruiterId = string;
export type ReportId = string;

export interface InterviewCreateProps {
  readonly recruiterId: RecruiterId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly scheduledAt: Date;
  readonly jdFileRef: FileRef;
  readonly cvFileRef: FileRef;
}

export interface InterviewSerialized {
  readonly id: InterviewId;
  readonly recruiterId: RecruiterId;
  readonly status: InterviewStatus;
  readonly jobDescription: JobDescriptionProps;
  readonly candidateInfo: CandidateInfoProps;
  readonly clientInstructions: string;
  readonly interviewPlan: InterviewPlanSerialized | null;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly jdFileRef: FileRefProps;
  readonly cvFileRef: FileRefProps;
  readonly scheduledAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly reportId: ReportId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Interview extends BaseEntity {
  override readonly id: InterviewId;
  override readonly createdAt: Date;
  override readonly updatedAt: Date;

  private constructor(
    id: InterviewId,
    readonly recruiterId: RecruiterId,
    readonly status: InterviewStatus,
    readonly jobDescription: JobDescription,
    readonly candidateInfo: CandidateInfo,
    readonly clientInstructions: string,
    readonly interviewPlan: Option<InterviewPlan>,
    readonly transcript: ReadonlyArray<TranscriptEntry>,
    readonly jdFileRef: FileRef,
    readonly cvFileRef: FileRef,
    readonly scheduledAt: Date,
    readonly startedAt: Option<Date>,
    readonly completedAt: Option<Date>,
    readonly reportId: Option<ReportId>,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super();
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /** Factory for a brand-new interview (always lands in CREATED). */
  static create(props: InterviewCreateProps): Interview {
    const now = new Date();
    return new Interview(
      randomUUID(),
      props.recruiterId,
      INTERVIEW_STATUS.CREATED,
      props.jobDescription,
      props.candidateInfo,
      props.clientInstructions,
      Option.None,
      Object.freeze([]),
      props.jdFileRef,
      props.cvFileRef,
      props.scheduledAt,
      Option.None,
      Option.None,
      Option.None,
      now,
      now,
    );
  }

  // ─── State transitions ─────────────────────────────────────────────

  /** CREATED → SCHEDULED — requires an InterviewPlan. */
  schedule(plan: InterviewPlan): Result<Interview, InvalidInterviewStateTransitionError | InterviewPlanRequiredError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.SCHEDULED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.SCHEDULED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.SCHEDULED, interviewPlan: Option.Some(plan) }));
  }

  /** SCHEDULED → IN_PROGRESS. */
  start(at: Date): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.IN_PROGRESS)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.IN_PROGRESS));
    }
    return Result.Ok(
      this.withChanges({ status: INTERVIEW_STATUS.IN_PROGRESS, startedAt: Option.Some(at) }),
    );
  }

  /** IN_PROGRESS → COMPLETED — captures final transcript. */
  complete(at: Date, transcript: ReadonlyArray<TranscriptEntry>): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.COMPLETED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.COMPLETED));
    }
    return Result.Ok(
      this.withChanges({
        status: INTERVIEW_STATUS.COMPLETED,
        completedAt: Option.Some(at),
        transcript: Object.freeze([...transcript]),
      }),
    );
  }

  /** COMPLETED → EVALUATED — links report. */
  markEvaluated(reportId: ReportId): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.EVALUATED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.EVALUATED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.EVALUATED, reportId: Option.Some(reportId) }));
  }

  /** IN_PROGRESS → CANCELLED. */
  cancel(): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.CANCELLED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.CANCELLED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.CANCELLED }));
  }

  // ─── Persistence ──────────────────────────────────────────────────

  serialize(): InterviewSerialized {
    return {
      id: this.id,
      recruiterId: this.recruiterId,
      status: this.status,
      jobDescription: this.jobDescription.serialize(),
      candidateInfo: this.candidateInfo.serialize(),
      clientInstructions: this.clientInstructions,
      interviewPlan: this.interviewPlan.match({
        Some: (p) => p.serialize(),
        None: () => null,
      }),
      transcript: this.transcript.map((t) => t.serialize()),
      jdFileRef: this.jdFileRef.serialize(),
      cvFileRef: this.cvFileRef.serialize(),
      scheduledAt: this.scheduledAt,
      startedAt: this.startedAt.match({ Some: (d) => d, None: () => null }),
      completedAt: this.completedAt.match({ Some: (d) => d, None: () => null }),
      reportId: this.reportId.match({ Some: (id) => id, None: () => null }),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromSerialized(data: InterviewSerialized): Interview {
    return new Interview(
      data.id,
      data.recruiterId,
      data.status,
      JobDescription.fromSerialized(data.jobDescription),
      CandidateInfo.fromSerialized(data.candidateInfo),
      data.clientInstructions,
      data.interviewPlan === null ? Option.None : Option.Some(InterviewPlan.fromSerialized(data.interviewPlan)),
      Object.freeze(data.transcript.map((t) => TranscriptEntry.fromSerialized(t))),
      FileRef.fromSerialized(data.jdFileRef),
      FileRef.fromSerialized(data.cvFileRef),
      data.scheduledAt,
      data.startedAt === null ? Option.None : Option.Some(data.startedAt),
      data.completedAt === null ? Option.None : Option.Some(data.completedAt),
      data.reportId === null ? Option.None : Option.Some(data.reportId),
      data.createdAt,
      data.updatedAt,
    );
  }

  // ─── Internal cloning helper ──────────────────────────────────────

  private withChanges(patch: Partial<{
    status: InterviewStatus;
    interviewPlan: Option<InterviewPlan>;
    transcript: ReadonlyArray<TranscriptEntry>;
    startedAt: Option<Date>;
    completedAt: Option<Date>;
    reportId: Option<ReportId>;
  }>): Interview {
    return new Interview(
      this.id,
      this.recruiterId,
      patch.status ?? this.status,
      this.jobDescription,
      this.candidateInfo,
      this.clientInstructions,
      patch.interviewPlan ?? this.interviewPlan,
      patch.transcript ?? this.transcript,
      this.jdFileRef,
      this.cvFileRef,
      this.scheduledAt,
      patch.startedAt ?? this.startedAt,
      patch.completedAt ?? this.completedAt,
      patch.reportId ?? this.reportId,
      this.createdAt,
      new Date(),
    );
  }
}
```

**FP chain example (state transition `complete`):**
```typescript
// caller in a use case
return Result.Ok(currentInterview)
  .flatMap((i) => i.complete(new Date(), transcriptEntries))
  .flatMap((i) => repo.save(i).then((r) => r))
  // ... composed via Result combinators
  .toPromise();
```

**Invariant check:** All props readonly. Transitions return new `Interview`. Errors are `BusinessRuleViolationError`. No `throw`. `Option<T>` for nullable. `serialize()` / `fromSerialized()` round-trip-safe.

---

### Step 13 — Domain: `IInterviewRepository` port

**File:** `packages/domain/src/entities/interview/interview.repository.ts` (CREATE)

```typescript
import type { Option, Result } from "@carbonteq/fp";
import type { Interview, InterviewId, RecruiterId } from "./interview.entity.js";

export interface IInterviewRepository {
  /** Insert or update. Returns the persisted entity. */
  save(interview: Interview): Promise<Result<Interview, Error>>;

  findById(id: InterviewId): Promise<Result<Option<Interview>, Error>>;

  listByRecruiter(recruiterId: RecruiterId): Promise<Result<ReadonlyArray<Interview>, Error>>;

  delete(id: InterviewId): Promise<Result<void, Error>>;
}
```

**Invariant check:** Repository query → `Promise<Result<Option<T>, Error>>`. Repository command → `Promise<Result<T, Error>>`. `Error` here is the generic `Error` boundary type — concrete `RepositoryError` lives in infrastructure (Phase 2) and is translated at the boundary by use cases.

---

### Step 14 — Domain: Interview aggregate barrel

**File:** `packages/domain/src/entities/interview/index.ts` (CREATE)

```typescript
export { Interview } from "./interview.entity.js";
export type {
  InterviewCreateProps,
  InterviewSerialized,
  InterviewId,
  RecruiterId,
  ReportId,
} from "./interview.entity.js";
export { INTERVIEW_STATUS, InterviewStatusPolicy } from "./interview-status.js";
export type { InterviewStatus } from "./interview-status.js";
export type { IInterviewRepository } from "./interview.repository.js";
export * from "./value-objects/index.js";
export * from "./errors/interview.errors.js";
```

---

### Step 15 — Domain: Report-aggregate errors

**File:** `packages/domain/src/entities/report/errors/report.errors.ts` (CREATE)

```typescript
import { NotFoundError, ValidationError } from "../../../shared/domain-error.js";

export class InvalidReportInputError extends ValidationError {
  readonly code = "INVALID_REPORT_INPUT";
}

export class ReportNotFoundError extends NotFoundError {
  readonly code = "REPORT_NOT_FOUND";
  constructor(id: string) {
    super(`Report with id ${id} not found`);
  }
}
```

---

### Step 16 — Domain: `TopicScore` value object

**File:** `packages/domain/src/entities/report/value-objects/topic-score.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidReportInputError } from "../errors/report.errors.js";

export interface TopicScoreProps {
  readonly topicName: string;
  readonly score: number;        // 0..5 (rubric scale)
  readonly justification: string;
}

export class TopicScore {
  private constructor(
    readonly topicName: string,
    readonly score: number,
    readonly justification: string,
  ) {}

  static create(props: TopicScoreProps): Result<TopicScore, InvalidReportInputError> {
    if (!props.topicName.trim()) {
      return Result.Err(new InvalidReportInputError("TopicScore.topicName must not be empty"));
    }
    if (!Number.isFinite(props.score) || props.score < 0 || props.score > 5) {
      return Result.Err(new InvalidReportInputError("TopicScore.score must be between 0 and 5"));
    }
    if (!props.justification.trim()) {
      return Result.Err(new InvalidReportInputError("TopicScore.justification must not be empty"));
    }
    return Result.Ok(new TopicScore(props.topicName, props.score, props.justification));
  }

  serialize(): TopicScoreProps {
    return { topicName: this.topicName, score: this.score, justification: this.justification };
  }

  static fromSerialized(data: TopicScoreProps): TopicScore {
    return new TopicScore(data.topicName, data.score, data.justification);
  }
}
```

---

### Step 17 — Domain: Report value-object barrel

**File:** `packages/domain/src/entities/report/value-objects/index.ts` (CREATE)

```typescript
export { TopicScore } from "./topic-score.js";
export type { TopicScoreProps } from "./topic-score.js";
```

---

### Step 18 — Domain: `Report` aggregate

**File:** `packages/domain/src/entities/report/report.entity.ts` (CREATE)

```typescript
import { randomUUID } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { BaseEntity } from "../../shared/base.entity.js";
import type { InterviewId, ReportId } from "../interview/interview.entity.js";
import { InvalidReportInputError } from "./errors/report.errors.js";
import { TopicScore, type TopicScoreProps } from "./value-objects/topic-score.js";

export const RECOMMENDATION = {
  ADVANCE: "advance",
  HOLD: "hold",
  REJECT: "reject",
} as const;

export type Recommendation = (typeof RECOMMENDATION)[keyof typeof RECOMMENDATION];

export interface ReportCreateProps {
  readonly interviewId: InterviewId;
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScore>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
}

export interface ReportSerialized {
  readonly id: ReportId;
  readonly interviewId: InterviewId;
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScoreProps>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
  readonly generatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Report extends BaseEntity {
  override readonly id: ReportId;
  override readonly createdAt: Date;
  override readonly updatedAt: Date;

  private constructor(
    id: ReportId,
    readonly interviewId: InterviewId,
    readonly overallRecommendation: Recommendation,
    readonly topicScores: ReadonlyArray<TopicScore>,
    readonly communicationAssessment: string,
    readonly strengths: ReadonlyArray<string>,
    readonly concerns: ReadonlyArray<string>,
    readonly followUpQuestions: ReadonlyArray<string>,
    readonly generatedAt: Date,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super();
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create(props: ReportCreateProps): Result<Report, InvalidReportInputError> {
    if (!props.communicationAssessment.trim()) {
      return Result.Err(new InvalidReportInputError("Report.communicationAssessment must not be empty"));
    }
    if (props.topicScores.length === 0) {
      return Result.Err(new InvalidReportInputError("Report.topicScores must not be empty"));
    }
    const now = new Date();
    return Result.Ok(
      new Report(
        randomUUID(),
        props.interviewId,
        props.overallRecommendation,
        Object.freeze([...props.topicScores]),
        props.communicationAssessment,
        Object.freeze([...props.strengths]),
        Object.freeze([...props.concerns]),
        Object.freeze([...props.followUpQuestions]),
        now,
        now,
        now,
      ),
    );
  }

  serialize(): ReportSerialized {
    return {
      id: this.id,
      interviewId: this.interviewId,
      overallRecommendation: this.overallRecommendation,
      topicScores: this.topicScores.map((t) => t.serialize()),
      communicationAssessment: this.communicationAssessment,
      strengths: this.strengths,
      concerns: this.concerns,
      followUpQuestions: this.followUpQuestions,
      generatedAt: this.generatedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromSerialized(data: ReportSerialized): Report {
    return new Report(
      data.id,
      data.interviewId,
      data.overallRecommendation,
      Object.freeze(data.topicScores.map((t) => TopicScore.fromSerialized(t))),
      data.communicationAssessment,
      Object.freeze([...data.strengths]),
      Object.freeze([...data.concerns]),
      Object.freeze([...data.followUpQuestions]),
      data.generatedAt,
      data.createdAt,
      data.updatedAt,
    );
  }
}
```

---

### Step 19 — Domain: `IReportRepository` port

**File:** `packages/domain/src/entities/report/report.repository.ts` (CREATE)

```typescript
import type { Option, Result } from "@carbonteq/fp";
import type { InterviewId } from "../interview/interview.entity.js";
import type { Report } from "./report.entity.js";

export interface IReportRepository {
  save(report: Report): Promise<Result<Report, Error>>;
  findById(id: string): Promise<Result<Option<Report>, Error>>;
  findByInterviewId(interviewId: InterviewId): Promise<Result<Option<Report>, Error>>;
}
```

---

### Step 20 — Domain: Report aggregate barrel

**File:** `packages/domain/src/entities/report/index.ts` (CREATE)

```typescript
export { Report, RECOMMENDATION } from "./report.entity.js";
export type { ReportCreateProps, ReportSerialized, Recommendation } from "./report.entity.js";
export type { IReportRepository } from "./report.repository.js";
export * from "./value-objects/index.js";
export * from "./errors/report.errors.js";
```

---

### Step 21 — Domain: entities barrel

**File:** `packages/domain/src/entities/index.ts` (CREATE)

```typescript
export * from "./interview/index.js";
export * from "./report/index.js";
```

---

### Step 22 — Domain: top-level barrel update

**File:** `packages/domain/src/index.ts` (MODIFY)

**Diff:**
```typescript
// Domain layer — entities, value objects, domain errors, domain events, repository interfaces
// This package has zero dependencies on infrastructure, frameworks, or HTTP.

export * from "./shared/index.js";
+ export * from "./entities/index.js";
```

---

### ─────────── APPLICATION LAYER ───────────

### Step 23 — Application: `BaseDto<T>`

**File:** `packages/application/src/core/base-dto.ts` (CREATE)

**What:** Generic Zod-backed DTO base class returning `Result<T, ValidationError>`.

```typescript
import { Result } from "@carbonteq/fp";
import { ValidationError } from "@repo/domain";
import type { ZodSchema, ZodError } from "zod";

export class DtoValidationError extends ValidationError {
  readonly code = "DTO_VALIDATION_FAILED";
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
  ) {
    super(message);
  }

  static fromZod(err: ZodError): DtoValidationError {
    const issues = err.issues.map((i) => ({ path: i.path, message: i.message }));
    return new DtoValidationError(
      issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
      issues,
    );
  }
}

export abstract class BaseDto<T> {
  protected constructor(readonly value: T) {}

  static validate<T>(schema: ZodSchema<T>, input: unknown): Result<T, DtoValidationError> {
    const parsed = schema.safeParse(input);
    if (parsed.success) return Result.Ok(parsed.data);
    return Result.Err(DtoValidationError.fromZod(parsed.error));
  }
}
```

**Invariant check:** Imports only `@repo/domain` (`ValidationError`) and `zod`. Returns `Result<T, ValidationError>`. No `throw`.

---

### Step 24 — Application: extend core barrel

**File:** `packages/application/src/core/index.ts` (MODIFY)

**Diff:**
```typescript
export { UseCase } from "./use-case.js";
export type { IUnitOfWork } from "./unit-of-work.interface.js";
export type { ServiceError } from "./service-error.js";
export { ServiceInfraError, ServiceUnavailableError, ServiceTimeoutError, ServiceUnknownError } from "./service-error.js";
+ export { BaseDto, DtoValidationError } from "./base-dto.js";
```

---

### Step 25 — Application: `StorageError` hierarchy

**File:** `packages/application/src/ports/storage/storage-error.ts` (CREATE)

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class StorageError extends ServiceInfraError {}

export class StorageUnavailableError extends StorageError {
  readonly code = "STORAGE_UNAVAILABLE";
}

export class StorageNotFoundError extends StorageError {
  readonly code = "STORAGE_NOT_FOUND";
  constructor(readonly key: string) {
    super(`Storage object not found for key: ${key}`);
  }
}

export class StorageUnknownError extends StorageError {
  readonly code = "STORAGE_UNKNOWN";
  constructor(message: string, readonly operation: string) {
    super(message);
  }
}
```

---

### Step 26 — Application: `IFileStorageService` port

**File:** `packages/application/src/ports/storage/file-storage.port.ts` (CREATE)

```typescript
import type { Result } from "@carbonteq/fp";
import type { FileRef } from "@repo/domain";
import type { StorageError } from "./storage-error.js";

export interface IFileStorageService {
  upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>>;
  download(key: string): Promise<Result<Buffer, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
  getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>>;
}
```

**Invariant check:** Port definition is the contract; implementation lives in Phase 2 infrastructure. Imports only `@repo/domain` types and `Result`.

---

### Step 27 — Application: storage port barrel

**File:** `packages/application/src/ports/storage/index.ts` (CREATE)

```typescript
export type { IFileStorageService } from "./file-storage.port.js";
export {
  StorageError,
  StorageUnavailableError,
  StorageNotFoundError,
  StorageUnknownError,
} from "./storage-error.js";
```

---

### Step 28 — Application: `DocumentExtractionError` hierarchy

**File:** `packages/application/src/ports/document-extraction/document-extraction-error.ts` (CREATE)

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class DocumentExtractionError extends ServiceInfraError {}

export class DocumentExtractionUnavailableError extends DocumentExtractionError {
  readonly code = "EXTRACTION_UNAVAILABLE";
}

export class DocumentExtractionParseFailedError extends DocumentExtractionError {
  readonly code = "EXTRACTION_PARSE_FAILED";
  constructor(message: string, readonly documentKey: string) {
    super(message);
  }
}

export class DocumentExtractionUnknownError extends DocumentExtractionError {
  readonly code = "EXTRACTION_UNKNOWN";
}
```

---

### Step 29 — Application: `IDocumentExtractionService` port

**File:** `packages/application/src/ports/document-extraction/document-extraction.port.ts` (CREATE)

```typescript
import type { Result } from "@carbonteq/fp";
import type { CandidateInfo, JobDescription } from "@repo/domain";
import type { DocumentExtractionError } from "./document-extraction-error.js";

/**
 * Phase 1 only defines the port. Adapter (`GeminiDocumentExtractionService`) lands in Phase 3.
 *
 * Inputs are raw bytes + content type so the adapter can hand them straight to Gemini's
 * multimodal `generateObject` (per §4.5).
 */
export interface IDocumentExtractionService {
  extractJobDescription(
    file: Buffer,
    contentType: string,
  ): Promise<Result<JobDescription, DocumentExtractionError>>;

  extractCandidateInfo(
    file: Buffer,
    contentType: string,
  ): Promise<Result<CandidateInfo, DocumentExtractionError>>;
}
```

---

### Step 30 — Application: doc-extraction port barrel

**File:** `packages/application/src/ports/document-extraction/index.ts` (CREATE)

```typescript
export type { IDocumentExtractionService } from "./document-extraction.port.js";
export {
  DocumentExtractionError,
  DocumentExtractionUnavailableError,
  DocumentExtractionParseFailedError,
  DocumentExtractionUnknownError,
} from "./document-extraction-error.js";
```

---

### Step 31 — Application: ports barrel

**File:** `packages/application/src/ports/index.ts` (CREATE)

```typescript
export * from "./storage/index.js";
export * from "./document-extraction/index.js";
```

---

### Step 32 — Application: `UploadCandidateDocumentsDto`

**File:** `packages/application/src/dtos/upload-candidate-documents.dto.ts` (CREATE)

```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileInputSchema = z.object({
  buffer: z.instanceof(Buffer),
  contentType: z.string().min(1),
  filename: z.string().min(1),
});

export const UploadCandidateDocumentsInputSchema = z.object({
  recruiterId: z.string().min(1),
  jdFile: FileInputSchema,
  cvFile: FileInputSchema,
});

export type UploadCandidateDocumentsInput = z.infer<typeof UploadCandidateDocumentsInputSchema>;

export class UploadCandidateDocumentsInputDto extends BaseDto<UploadCandidateDocumentsInput> {
  static parse(raw: unknown): Result<UploadCandidateDocumentsInputDto, DtoValidationError> {
    return BaseDto.validate(UploadCandidateDocumentsInputSchema, raw).map(
      (v) => new UploadCandidateDocumentsInputDto(v),
    );
  }
}

// ---------- Output DTO ----------

export interface UploadCandidateDocumentsOutput {
  readonly jdRef: {
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly originalFilename: string;
    readonly uploadedAt: Date;
  };
  readonly cvRef: UploadCandidateDocumentsOutput["jdRef"];
}
```

---

### Step 33 — Application: `CreateInterviewDto`

**File:** `packages/application/src/dtos/create-interview.dto.ts` (CREATE)

```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { InterviewStatus } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileRefSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1),
  uploadedAt: z.date(),
});

const JobDescriptionSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  rawText: z.string().min(1),
});

const CandidateInfoSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  headline: z.string(),
  yearsOfExperience: z.number().nonnegative(),
  skills: z.array(z.string()),
  education: z.array(z.string()),
  rawText: z.string().min(1),
});

export const CreateInterviewInputSchema = z.object({
  recruiterId: z.string().min(1),
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
  clientInstructions: z.string(),
  scheduledAt: z.date(),
  jdFileRef: FileRefSchema,
  cvFileRef: FileRefSchema,
});

export type CreateInterviewInput = z.infer<typeof CreateInterviewInputSchema>;

export class CreateInterviewInputDto extends BaseDto<CreateInterviewInput> {
  static parse(raw: unknown): Result<CreateInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(CreateInterviewInputSchema, raw).map((v) => new CreateInterviewInputDto(v));
  }
}

export interface CreateInterviewOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;
  readonly scheduledAt: Date;
}
```

---

### Step 34 — Application: dtos barrel

**File:** `packages/application/src/dtos/index.ts` (CREATE)

```typescript
export {
  UploadCandidateDocumentsInputDto,
  UploadCandidateDocumentsInputSchema,
} from "./upload-candidate-documents.dto.js";
export type {
  UploadCandidateDocumentsInput,
  UploadCandidateDocumentsOutput,
} from "./upload-candidate-documents.dto.js";
export { CreateInterviewInputDto, CreateInterviewInputSchema } from "./create-interview.dto.js";
export type { CreateInterviewInput, CreateInterviewOutput } from "./create-interview.dto.js";
```

---

### Step 35 — Application: `UploadCandidateDocumentsUseCase`

**File:** `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import type { FileRef } from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import type { ServiceError } from "../../core/service-error.js";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";
import type {
  UploadCandidateDocumentsInput,
  UploadCandidateDocumentsOutput,
} from "../../dtos/upload-candidate-documents.dto.js";

const buildKey = (recruiterId: string, kind: "jd" | "cv", filename: string): string =>
  `recruiters/${recruiterId}/uploads/${kind}/${Date.now()}-${filename}`;

const toOutputRef = (ref: FileRef): UploadCandidateDocumentsOutput["jdRef"] => ({
  key: ref.key,
  contentType: ref.contentType,
  sizeBytes: ref.sizeBytes,
  originalFilename: ref.originalFilename,
  uploadedAt: ref.uploadedAt,
});

export class UploadCandidateDocumentsUseCase extends UseCase<
  UploadCandidateDocumentsInput,
  UploadCandidateDocumentsOutput
> {
  constructor(private readonly storage: IFileStorageService) {
    super();
  }

  async execute(
    input: UploadCandidateDocumentsInput,
  ): Promise<Result<UploadCandidateDocumentsOutput, ServiceError>> {
    const jdKey = buildKey(input.recruiterId, "jd", input.jdFile.filename);
    const cvKey = buildKey(input.recruiterId, "cv", input.cvFile.filename);

    const jdResult = await this.storage.upload(input.jdFile.buffer, jdKey, input.jdFile.contentType);
    const cvResult = await this.storage.upload(input.cvFile.buffer, cvKey, input.cvFile.contentType);

    return Result.all(jdResult, cvResult)
      .map(([jdRef, cvRef]) => ({ jdRef: toOutputRef(jdRef), cvRef: toOutputRef(cvRef) }))
      .mapErr((errs) => errs[0]); // Result.all collects errors; surface first to caller
  }
}
```

**FP chain example (use-case execute, all-async variant):**
```typescript
// Equivalent fully-chained variant (kept for reference; the form above is more readable):
return Result.tryAsyncCatch(
  async () => {
    /* … */
  },
  (e) => new ServiceUnknownError(String(e), "UploadCandidateDocuments"),
).toPromise();
```

**Invariant check:** No `throw`. No `try/catch`. No infrastructure imports. Only `@repo/domain` types + ports. Async chain ends at `Result.all(...).map(...).mapErr(...)`. Returns `Promise<Result<T, ServiceError>>` because `StorageError extends ServiceInfraError extends ServiceError`.

---

### Step 36 — Application: documents use-case barrel

**File:** `packages/application/src/use-cases/documents/index.ts` (CREATE)

```typescript
export { UploadCandidateDocumentsUseCase } from "./upload-candidate-documents.use-case.js";
```

---

### Step 37 — Application: `CreateInterviewUseCase`

**File:** `packages/application/src/use-cases/interview/create-interview.use-case.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  Interview,
  type IInterviewRepository,
  JobDescription,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type {
  CreateInterviewInput,
  CreateInterviewOutput,
} from "../../dtos/create-interview.dto.js";

export class CreateInterviewUseCase extends UseCase<CreateInterviewInput, CreateInterviewOutput> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(input: CreateInterviewInput): Promise<Result<CreateInterviewOutput, ServiceError>> {
    const jdR = JobDescription.create(input.jobDescription);
    const ciR = CandidateInfo.create(input.candidateInfo);
    const jdRefR = FileRef.create(input.jdFileRef);
    const cvRefR = FileRef.create(input.cvFileRef);

    return Result.all(jdR, ciR, jdRefR, cvRefR)
      .mapErr((errs) => errs[0] as ServiceError)
      .map(([jobDescription, candidateInfo, jdFileRef, cvFileRef]) =>
        Interview.create({
          recruiterId: input.recruiterId,
          jobDescription,
          candidateInfo,
          clientInstructions: input.clientInstructions,
          scheduledAt: input.scheduledAt,
          jdFileRef,
          cvFileRef,
        }),
      )
      .flatMap((interview) =>
        Result.fromPromise(
          this.interviews
            .save(interview)
            .then((r) => r.mapErr((e) => new ServiceUnknownError(e.message, "InterviewRepository.save"))),
        ),
      )
      .map((saved) => ({
        interviewId: saved.id,
        status: saved.status,
        scheduledAt: saved.scheduledAt,
      }))
      .toPromise();
  }
}
```

**FP chain decomposition:**
1. `Result.all(jdR, ciR, jdRefR, cvRefR)` aggregates four sync VO factories.
2. `.mapErr` collapses the error array to the first `DomainError` (a `ValidationError` subclass — assignable to `ServiceError`).
3. `.map(...)` builds the immutable `Interview` aggregate in `CREATED` state.
4. `.flatMap(...)` enters async land: persists via the repo port, translating the generic infra `Error` into a concrete `ServiceUnknownError` at the boundary so `RepositoryError` does not leak.
5. `.map(...)` shapes the output DTO.
6. `.toPromise()` resolves the inner `Promise` and returns `Promise<Result<CreateInterviewOutput, ServiceError>>`.

**Invariant check:** No `throw`. No raw `null`. Repository error translated at boundary. `Result` chain only — no early extraction.

---

### Step 38 — Application: interview use-case barrel

**File:** `packages/application/src/use-cases/interview/index.ts` (CREATE)

```typescript
export { CreateInterviewUseCase } from "./create-interview.use-case.js";
```

---

### Step 39 — Application: use-cases barrel

**File:** `packages/application/src/use-cases/index.ts` (CREATE)

```typescript
export * from "./documents/index.js";
export * from "./interview/index.js";
```

---

### Step 40 — Application: top-level barrel update

**File:** `packages/application/src/index.ts` (MODIFY)

**Diff:**
```typescript
// Application layer — use cases, DTOs, query services, application services
// Orchestrates domain logic and infrastructure services.
// Does not implement business rules and does not access infrastructure directly.

export * from "./core/index.js";
+ export * from "./ports/index.js";
+ export * from "./dtos/index.js";
+ export * from "./use-cases/index.js";
```

---

## Pseudo-workflow (`UploadCandidateDocuments`)

1. Caller (eventually a Phase 7 controller) builds raw `unknown` payload.
2. `UploadCandidateDocumentsInputDto.parse(raw)` → `Result<Dto, DtoValidationError>`.
3. Controller passes `dto.value` to `UploadCandidateDocumentsUseCase.execute(...)`.
4. Use case constructs storage keys (`recruiters/{rid}/uploads/{jd|cv}/{ts}-{filename}`).
5. Use case calls `IFileStorageService.upload(buffer, key, contentType)` twice (currently sequentially — concurrent variant possible later).
6. `Result.all` aggregates both `FileRef` results; first error wins.
7. Returns `{ jdRef, cvRef }` (serialized shape). Phase 1 stops here — Phase 7 maps to HTTP 201.

## Pseudo-workflow (`CreateInterview`)

1. Caller builds `CreateInterviewInput` (recruiter ID, parsed JD, parsed CV, instructions, scheduledAt, both FileRefs).
2. `CreateInterviewInputDto.parse(raw)` → `Result<Dto, DtoValidationError>`.
3. `CreateInterviewUseCase.execute(input)`:
   - Builds 4 VOs via `Result.all`.
   - On all-Ok, calls `Interview.create(...)` (always lands in `CREATED`, plan `Option.None`, transcript `[]`, startedAt/completedAt/reportId all `Option.None`).
   - Persists via `IInterviewRepository.save`. Repository error → `ServiceUnknownError("InterviewRepository.save", ...)` at the boundary.
   - Returns `{ interviewId, status: "CREATED", scheduledAt }`.

## Entry points (dependency order, innermost first)

| #  | File                                                                           | Layer         | Op     | Purpose                                              |
| -- | ------------------------------------------------------------------------------ | ------------- | ------ | ---------------------------------------------------- |
| 1  | `packages/domain/src/shared/value-objects/file-ref.ts`                         | domain        | CREATE | Shared `FileRef` VO                                  |
| 2  | `packages/domain/src/shared/value-objects/index.ts`                            | domain        | CREATE | shared VO barrel                                     |
| 3  | `packages/domain/src/shared/index.ts`                                          | domain        | MODIFY | re-export VOs                                        |
| 4  | `packages/domain/src/entities/interview/interview-status.ts`                   | domain        | CREATE | Status enum + transition policy                      |
| 5  | `packages/domain/src/entities/interview/errors/interview.errors.ts`            | domain        | CREATE | Interview domain errors                              |
| 6  | `packages/domain/src/entities/interview/value-objects/job-description.ts`      | domain        | CREATE | JD VO                                                |
| 7  | `packages/domain/src/entities/interview/value-objects/candidate-info.ts`       | domain        | CREATE | CV VO                                                |
| 8  | `packages/domain/src/entities/interview/value-objects/planned-topic.ts`        | domain        | CREATE | PlannedTopic VO                                      |
| 9  | `packages/domain/src/entities/interview/value-objects/interview-plan.ts`       | domain        | CREATE | InterviewPlan VO                                     |
| 10 | `packages/domain/src/entities/interview/value-objects/transcript-entry.ts`     | domain        | CREATE | TranscriptEntry VO                                   |
| 11 | `packages/domain/src/entities/interview/value-objects/index.ts`                | domain        | CREATE | barrel                                               |
| 12 | `packages/domain/src/entities/interview/interview.entity.ts`                   | domain        | CREATE | Interview aggregate                                  |
| 13 | `packages/domain/src/entities/interview/interview.repository.ts`               | domain        | CREATE | Repository port                                      |
| 14 | `packages/domain/src/entities/interview/index.ts`                              | domain        | CREATE | barrel                                               |
| 15 | `packages/domain/src/entities/report/errors/report.errors.ts`                  | domain        | CREATE | Report domain errors                                 |
| 16 | `packages/domain/src/entities/report/value-objects/topic-score.ts`             | domain        | CREATE | TopicScore VO                                        |
| 17 | `packages/domain/src/entities/report/value-objects/index.ts`                   | domain        | CREATE | barrel                                               |
| 18 | `packages/domain/src/entities/report/report.entity.ts`                         | domain        | CREATE | Report aggregate                                     |
| 19 | `packages/domain/src/entities/report/report.repository.ts`                     | domain        | CREATE | Repository port                                      |
| 20 | `packages/domain/src/entities/report/index.ts`                                 | domain        | CREATE | barrel                                               |
| 21 | `packages/domain/src/entities/index.ts`                                        | domain        | CREATE | aggregates barrel                                    |
| 22 | `packages/domain/src/index.ts`                                                 | domain        | MODIFY | export entities                                      |
| 23 | `packages/application/src/core/base-dto.ts`                                    | application   | CREATE | `BaseDto<T>` + `DtoValidationError`                  |
| 24 | `packages/application/src/core/index.ts`                                       | application   | MODIFY | export BaseDto                                       |
| 25 | `packages/application/src/ports/storage/storage-error.ts`                      | application   | CREATE | StorageError hierarchy                               |
| 26 | `packages/application/src/ports/storage/file-storage.port.ts`                  | application   | CREATE | `IFileStorageService` port                           |
| 27 | `packages/application/src/ports/storage/index.ts`                              | application   | CREATE | barrel                                               |
| 28 | `packages/application/src/ports/document-extraction/document-extraction-error.ts` | application | CREATE | DocumentExtractionError hierarchy                    |
| 29 | `packages/application/src/ports/document-extraction/document-extraction.port.ts`  | application | CREATE | `IDocumentExtractionService` port                    |
| 30 | `packages/application/src/ports/document-extraction/index.ts`                  | application   | CREATE | barrel                                               |
| 31 | `packages/application/src/ports/index.ts`                                      | application   | CREATE | barrel                                               |
| 32 | `packages/application/src/dtos/upload-candidate-documents.dto.ts`              | application   | CREATE | DTO                                                  |
| 33 | `packages/application/src/dtos/create-interview.dto.ts`                        | application   | CREATE | DTO                                                  |
| 34 | `packages/application/src/dtos/index.ts`                                       | application   | CREATE | barrel                                               |
| 35 | `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts` | application | CREATE | Use case                                             |
| 36 | `packages/application/src/use-cases/documents/index.ts`                        | application   | CREATE | barrel                                               |
| 37 | `packages/application/src/use-cases/interview/create-interview.use-case.ts`    | application   | CREATE | Use case                                             |
| 38 | `packages/application/src/use-cases/interview/index.ts`                        | application   | CREATE | barrel                                               |
| 39 | `packages/application/src/use-cases/index.ts`                                  | application   | CREATE | barrel                                               |
| 40 | `packages/application/src/index.ts`                                            | application   | MODIFY | export ports/dtos/use-cases                          |

---

## Test plan

All tests are co-located `.test.ts` files. Domain tests are pure (no mocks). Application tests mock the repo and storage ports only.

### Domain tests

#### `packages/domain/src/entities/interview/interview-status.test.ts`
- `it("allows CREATED → SCHEDULED")` 
- `it("allows SCHEDULED → IN_PROGRESS")`
- `it("allows IN_PROGRESS → COMPLETED")`
- `it("allows IN_PROGRESS → CANCELLED")`
- `it("allows COMPLETED → EVALUATED")`
- `it("disallows CREATED → IN_PROGRESS")`
- `it("disallows SCHEDULED → CANCELLED")`
- `it("disallows EVALUATED → anything")`
- `it("disallows CANCELLED → anything")`
- `it("isTerminal returns true for EVALUATED and CANCELLED")`

#### `packages/domain/src/entities/interview/value-objects/job-description.test.ts`
- `it("creates a valid JobDescription")`
- `it("rejects empty title with InvalidInterviewInputError")`
- `it("rejects empty company")`
- `it("rejects empty rawText")`
- `it("round-trips through serialize/fromSerialized")`

#### `packages/domain/src/entities/interview/value-objects/candidate-info.test.ts`
- `it("creates a valid CandidateInfo")`
- `it("rejects empty fullName")`
- `it("rejects malformed email")`
- `it("rejects negative yearsOfExperience")`
- `it("freezes skills and education arrays (mutation has no effect on stored values)")`
- `it("round-trips through serialize/fromSerialized")`

#### `packages/domain/src/entities/interview/value-objects/interview-plan.test.ts`
- `it("creates a plan with one topic")`
- `it("rejects empty topics")`
- `it("rejects targetDurationMinutes <= 0")`
- `it("rejects maxDurationMinutes < targetDurationMinutes")`
- `it("round-trips through serialize/fromSerialized")`

#### `packages/domain/src/entities/interview/interview.entity.test.ts`
- `it("Interview.create lands in CREATED with no plan, no transcript, no times")`
- `it("schedule() requires CREATED state — fails from SCHEDULED")`
- `it("schedule() succeeds, attaches plan, returns new instance with same id")`
- `it("schedule() does not mutate the original instance")`
- `it("start() requires SCHEDULED state — fails from CREATED")`
- `it("start() sets startedAt to provided Date")`
- `it("complete() requires IN_PROGRESS state — fails from CREATED")`
- `it("complete() captures transcript and completedAt")`
- `it("cancel() only works from IN_PROGRESS")`
- `it("markEvaluated() only works from COMPLETED, attaches reportId")`
- `it("rejects markEvaluated from EVALUATED (terminal)")`
- `it("serialize() emits null for absent Option fields")`
- `it("fromSerialized round-trips a fully-populated EVALUATED interview")`

#### `packages/domain/src/entities/report/value-objects/topic-score.test.ts`
- `it("creates a valid TopicScore")`
- `it("rejects score < 0")`
- `it("rejects score > 5")`
- `it("rejects empty topicName")`
- `it("rejects empty justification")`
- `it("round-trips through serialize/fromSerialized")`

#### `packages/domain/src/entities/report/report.entity.test.ts`
- `it("Report.create succeeds with at least one topicScore")`
- `it("rejects empty topicScores")`
- `it("rejects empty communicationAssessment")`
- `it("serialize/fromSerialized round-trips a full report")`

### Application tests

#### `packages/application/src/core/base-dto.test.ts`
- `it("BaseDto.validate returns Ok for matching schema")`
- `it("BaseDto.validate returns DtoValidationError carrying issues for mismatch")`
- `it("DtoValidationError code === 'DTO_VALIDATION_FAILED'")`

#### `packages/application/src/dtos/upload-candidate-documents.dto.test.ts`
- `it("parse() Ok for valid input with two Buffers")`
- `it("parse() Err when jdFile.contentType is empty")`
- `it("parse() Err when recruiterId is empty")`

#### `packages/application/src/dtos/create-interview.dto.test.ts`
- `it("parse() Ok for valid full payload")`
- `it("parse() Err when scheduledAt is not a Date")`
- `it("parse() Err when candidateInfo.email is invalid")`
- `it("parse() Err when jdFileRef.sizeBytes is negative")`

#### `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.test.ts`
- Mock: `IFileStorageService` with `upload` stubs.
- `it("returns Ok with both FileRefs on successful uploads")`
- `it("calls upload twice with correctly-formed keys")`
- `it("returns Err when JD upload fails (StorageUnavailableError)")`
- `it("returns Err when CV upload fails (StorageUnknownError)")`
- `it("does not throw — only returns Result")`

#### `packages/application/src/use-cases/interview/create-interview.use-case.test.ts`
- Mock: `IInterviewRepository` with `save` stub.
- `it("Ok path: returns interviewId, status=CREATED, scheduledAt")`
- `it("calls repo.save with an Interview in CREATED state")`
- `it("Err path: invalid email in candidateInfo → ValidationError, repo.save not called")`
- `it("Err path: invalid jdFileRef sizeBytes → ValidationError, repo.save not called")`
- `it("Err path: repo.save returns Err → ServiceUnknownError surfaced (RepositoryError translated at boundary)")`
- `it("does not throw — only returns Result")`

---

## `@carbonteq/fp` chain reference snippets

### Sync state-transition composition
```typescript
const r: Result<Interview, BusinessRuleViolationError | InterviewPlanRequiredError> = interview
  .schedule(plan)
  .flatMap((scheduled) => scheduled.start(new Date()))
  .flatMap((started) => started.complete(new Date(), transcript))
  .flatMap((completed) => completed.markEvaluated(reportId));
```

### Async use case — repository boundary translation
```typescript
return Result.fromPromise(
  this.interviews
    .save(interview)
    .then((r) => r.mapErr((e) => new ServiceUnknownError(e.message, "InterviewRepository.save"))),
).toPromise();
```

### Multi-VO construction with first-error semantics
```typescript
Result.all(jdR, ciR, jdRefR, cvRefR)
  .mapErr((errs) => errs[0] as ServiceError)
  .map(([jd, ci, jdRef, cvRef]) => Interview.create({ /* ... */ }));
```

---

## Verification checklist

Run in order **after** every step is implemented — never mid-session.

1. `pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application`
2. `pnpm turbo run test --filter=@repo/domain`
3. `pnpm turbo run test --filter=@repo/application`
4. `pnpm turbo run lint --filter=@repo/domain --filter=@repo/application`
5. `/backend-arch-validator domain` — confirms zero outward imports, no `throw`/`try`, no `T | null`, immutability.
6. `/backend-arch-validator application` — confirms only `@repo/domain` imports, ports defined as interfaces, use cases return `Promise<Result<T, ServiceError>>`, repo errors translated at the boundary.
7. `backend-code-reviewer` agent over all 40 files (per CLAUDE.md Rule 7); pass `.claude/plan/phase-1-domain-foundation.md` as context.
8. Iterate until `backend-code-reviewer` returns PASS.

---

## Risk notes

- **`Interview.report` temptation.** Easy to slip and embed a `Report` instance in `Interview`. Don't. Aggregates are loaded independently. Phase 1 keeps this honest by having `reportId: Option<ReportId>` only.
- **Date handling at the persistence boundary.** Drizzle (Phase 2) will return strings/Numbers; `fromSerialized` assumes proper `Date` instances. Phase 2 plan must include coercion at the repo layer.
- **`Result.all` error shape.** `Result.all` returns `Result<T[], E[]>` (array of errors). The use cases above pick the first error; this is acceptable for Phase 1 but documented here so reviewers don't flag it.
- **Buffer in DTOs.** `z.instanceof(Buffer)` works at runtime in Node 22 but is a Zod-level validation only — no Zod coercion. Callers (Phase 7 controllers) must hand actual `Buffer` instances; multipart parsers must produce them.
- **Email regex.** Deliberately permissive — strict RFC validation belongs in a dedicated VO if/when we get spam complaints. Don't over-engineer in Phase 1.
- **`@carbonteq/fp` `Result.all` typing with mixed-error-type results.** All four VO factories in `CreateInterviewUseCase` produce subclasses of `DomainError` so the array-of-errors collapse to `errs[0]` is type-safe; introducing a non-DomainError factory later requires updating the cast.
- **Barrel ordering.** `packages/domain/src/index.ts` must export `shared` before `entities` because entity errors extend abstract classes from `shared/domain-error.ts`. Same logic for `application/index.ts`: `core` before `ports/dtos/use-cases`.
- **Object.freeze on arrays of VOs.** Frozen arrays still allow mutation of element internals; we mitigate by making each VO's own props readonly. Reviewer should not flag this.

---

## Out of scope (Phase 1 — restated)

The following are **explicitly NOT** part of Phase 1. Any plan deviation that touches these must be split into the appropriate later phase:

- Drizzle schema definitions, migrations, or `apps/backend/src/infrastructure/persistence/` (Phase 2).
- Repository implementations: `DrizzleInterviewRepository`, `DrizzleReportRepository` (Phase 2).
- `LocalFileStorageService` adapter implementation (Phase 2).
- Langfuse OTel bootstrap or any observability wiring (Phase 2).
- `GeminiDocumentExtractionService` adapter or any AI SDK integration (Phase 3).
- `GenerateInterviewPlan` / `ConductInterview` / `EvaluateTranscript` / `GenerateReport` use cases (Phases 3/5/6).
- Deepgram, ElevenLabs, AI SDK Google provider, agent tool definitions (Phases 4/5).
- Fastify routes, controllers, WebSocket handlers, HTTP error mapping, auth middleware (Phase 7).
- Frontend wiring of any kind (Phases 8/9).
- WebSocket reconnection / retry / circuit breakers / rate limiting (Phase 10).

If a step in Phase 1 implementation appears to require any of the above, stop and re-plan — Phase 1 must remain self-contained with no `apps/backend/src/` changes.
