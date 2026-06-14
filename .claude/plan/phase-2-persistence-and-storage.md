# Plan: Phase 2 — Persistence & Storage

> Generated: 2026-05-06
> Slug: phase-2-persistence-and-storage
> Repo: `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent`
> Branch: `phase-2`
> Source documents read by the planner:
> - `docs/ARCHITECTURE.md` (full)
> - `docs/progress/phase-1.md` (full)
> - `packages/domain/src/entities/interview/interview.entity.ts`
> - `packages/domain/src/entities/report/report.entity.ts`
> - `packages/domain/src/entities/interview/interview.repository.ts`
> - `packages/domain/src/entities/report/report.repository.ts`
> - `packages/domain/src/entities/interview/value-objects/*` (all five)
> - `packages/domain/src/entities/report/value-objects/topic-score.ts`
> - `packages/domain/src/entities/interview/interview-status.ts`
> - `packages/domain/src/shared/value-objects/file-ref.ts`
> - `packages/application/src/ports/storage/file-storage.port.ts`
> - `packages/application/src/ports/storage/storage-error.ts`
> - `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.ts`
> - `packages/application/src/use-cases/interview/create-interview.use-case.ts`
> - `apps/backend/package.json`, `apps/backend/drizzle.config.ts`
> - `apps/backend/src/infrastructure/persistence/db.ts`
> - `apps/backend/src/infrastructure/persistence/schema/index.ts`
> - `apps/backend/src/main.ts`, `apps/backend/src/app.ts`
> - `apps/backend/vitest.config.ts`

---

## Summary

Phase 2 makes Phase-1's contracts real. It introduces:

1. A **Drizzle/Postgres schema** for the two aggregate roots (`interviews`, `reports`) — one table per aggregate, JSONB columns mirror exactly what `entity.serialize()` returns.
2. **Repository implementations** (`DrizzleInterviewRepository`, `DrizzleReportRepository`) that satisfy the domain ports `IInterviewRepository` / `IReportRepository`, using `entity.serialize()` and `Entity.fromSerialized()` with **no** mapper files. Drizzle/postgres exceptions never escape the repository — they are caught with `Result.tryAsyncCatch` and translated to a new `RepositoryError` hierarchy.
3. A **`LocalFileStorageService`** adapter under `apps/backend/src/infrastructure/services/` implementing `IFileStorageService`. It writes files at `{FILE_STORAGE_ROOT}/{key}`, generates HMAC-signed URLs (the verifying route lands in Phase 7), and translates Node `fs` errors to the `StorageError` subclasses already defined in `@repo/application`.
4. A **minimal Langfuse OTel bootstrap** in a new `apps/backend/src/infrastructure/observability/otel.ts`, called from `main.ts`. NodeSDK is initialized with the Langfuse span processor, a graceful shutdown hook is wired to SIGTERM/SIGINT, but no instrumentation calls are emitted yet — Phase 3 is the first consumer.

After Phase 2 the backend can persist Interview/Report aggregates to Postgres, write candidate uploads to disk, generate signed download URLs, and start cleanly with OTel/Langfuse wired (no traces yet).

No presentation layer is added in this phase — Fastify routes/controllers are Phase 7.

---

## Layers touched

| Layer          | Package / Location                                       | Scope                                                                                                          |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                                       | none                                                                                                           |
| Application    | `packages/application/`                                  | none                                                                                                           |
| Infrastructure | `apps/backend/src/infrastructure/`                       | Drizzle schema, generated migration SQL, two repositories, `RepositoryError` hierarchy, `LocalFileStorageService`, OTel bootstrap |
| Presentation   | `apps/backend/src/presentation/`                         | none (deferred to Phase 7)                                                                                     |

---

## Architectural invariants to enforce in every step

(re-stated so implementation agents do not need to chase `CLAUDE.md`)

1. **Dependency direction.** Infrastructure may import `@repo/domain` and `@repo/application`. It must NOT import from `apps/backend/src/presentation/`. Domain must remain free of any infrastructure import.
2. **No throws, no try/catch, no `T | null` outside `Result` / `Option`.** Wrap all Drizzle queries with `Result.tryAsyncCatch`; wrap all `node:fs/promises` calls similarly. End async chains with `.toPromise()`.
3. **Repository return shapes** (matching the existing ports verbatim):
   - `save(...)` → `Promise<Result<Entity, Error>>`
   - `findById(...)` / `findByInterviewId(...)` → `Promise<Result<Option<Entity>, Error>>`
   - `listByRecruiter(...)` → `Promise<Result<ReadonlyArray<Entity>, Error>>`
   - `delete(...)` → `Promise<Result<void, Error>>`
   The error type in the port is `Error`, but we will return `RepositoryError` subclasses (assignable to `Error`) so the application layer can `mapErr` without a wider type.
4. **Storage service return shapes** (matching the existing port verbatim):
   - `upload(...)` → `Promise<Result<FileRef, StorageError>>`
   - `download(...)` → `Promise<Result<Buffer, StorageError>>`
   - `delete(...)` → `Promise<Result<void, StorageError>>`
   - `getSignedUrl(...)` → `Promise<Result<string, StorageError>>`
5. **Entity (de)serialization** — repos call `entity.serialize()` and `Entity.fromSerialized()`. Postgres JSONB columns hold the exact shape returned by `serialize()`. **No separate mapper files.**
6. **Errors don't leak.** `RepositoryError` lives only in `apps/backend/src/infrastructure/`. Use cases (already in Phase 1) translate any repo `Error` to `ServiceUnknownError` (see `create-interview.use-case.ts`) — this Phase does not change that.
7. **Co-located tests** (`*.test.ts` next to source) per `CLAUDE.md`.

---

## Verified facts about Phase-1 surface area (used by this plan)

- `Interview.serialize()` returns `InterviewSerialized`:
  - scalar columns: `id` (uuid string), `recruiterId` (string), `status` (`InterviewStatus` literal), `clientInstructions` (string), `scheduledAt` (Date), `startedAt` (Date | null), `completedAt` (Date | null), `reportId` (string | null), `createdAt` (Date), `updatedAt` (Date)
  - JSONB columns: `jobDescription` (`JobDescriptionProps`), `candidateInfo` (`CandidateInfoProps`), `interviewPlan` (`InterviewPlanSerialized` | null), `transcript` (`ReadonlyArray<TranscriptEntryProps>`), `jdFileRef` (`FileRefProps`), `cvFileRef` (`FileRefProps`)
  - **`Option<T>` is encoded as `T | null` on the wire** — confirmed in `interview.entity.ts:170-180` (`match({ Some, None: () => null })`).
- `Report.serialize()` returns `ReportSerialized`:
  - scalar columns: `id`, `interviewId`, `overallRecommendation` (literal `"advance" | "hold" | "reject"`), `communicationAssessment` (string), `generatedAt`, `createdAt`, `updatedAt`
  - JSONB columns: `topicScores` (`ReadonlyArray<TopicScoreProps>`), `strengths`, `concerns`, `followUpQuestions` (all `ReadonlyArray<string>`)
- `InterviewStatus` literals: `CREATED | SCHEDULED | IN_PROGRESS | COMPLETED | EVALUATED | CANCELLED`.
- `Recommendation` literals: `advance | hold | reject`.
- The repository **port error type is `Error`** (verified — `interview.repository.ts:6` → `Promise<Result<Interview, Error>>`). Returning `RepositoryError extends Error` satisfies the type.
- `Result.tryAsyncCatch(fn, errorMapper?)` returns `Result<Promise<T>, E>`; `Result.fromPromise(p)` returns `Result<Promise<T>, F>`; both terminate with `.toPromise()`. (Verified from `node_modules/.pnpm/@carbonteq+fp@0.9.1/.../result.d.mts`.)
- `FileRef.create(...)` is `Result`-returning — the storage service must propagate that `Result`, not throw.
- `LocalFileStorageService` keys arriving from `UploadCandidateDocumentsUseCase` look like `recruiters/{recruiterId}/uploads/jd/{ts}-{filename}` — they may contain `/`, so the adapter must `mkdir -p` parent directories under the storage root.
- Backend deps already include `drizzle-orm@0.44`, `postgres@3.4.7`, `@langfuse/otel@5.1`, `@opentelemetry/sdk-node@0.214`, `@opentelemetry/auto-instrumentations-node@0.72`, `@opentelemetry/api@1.9` — verified in `apps/backend/package.json`.
- `drizzle.config.ts` already points at `./src/infrastructure/persistence/schema/index.ts` and writes migrations to `./drizzle`. The `drizzle/` directory does NOT yet exist; `db:generate` will create it.

---

## Implementation steps

Steps are grouped into **seven independent batches**. Each batch is self-contained — once a batch is finished and type-checks pass, the next batch can be started.

### Step 1 — Schema: `interviews` table

**File:** `apps/backend/src/infrastructure/persistence/schema/interviews.ts` (CREATE)

**What:** Defines the Drizzle table for the Interview aggregate. Single row per `Interview.serialize()` output. JSONB columns hold the value-object collections verbatim.

**Code:**
```typescript
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  CandidateInfoProps,
  FileRefProps,
  InterviewPlanSerialized,
  InterviewStatus,
  JobDescriptionProps,
  TranscriptEntryProps,
} from "@repo/domain";

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey(),
  recruiterId: text("recruiter_id").notNull(),
  status: text("status").$type<InterviewStatus>().notNull(),
  jobDescription: jsonb("job_description").$type<JobDescriptionProps>().notNull(),
  candidateInfo: jsonb("candidate_info").$type<CandidateInfoProps>().notNull(),
  clientInstructions: text("client_instructions").notNull(),
  // null when the plan has not been generated yet (CREATED state).
  interviewPlan: jsonb("interview_plan").$type<InterviewPlanSerialized | null>(),
  // Default empty array — Drizzle stores literal JSONB '[]'.
  transcript: jsonb("transcript")
    .$type<ReadonlyArray<TranscriptEntryProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  jdFileRef: jsonb("jd_file_ref").$type<FileRefProps>().notNull(),
  cvFileRef: jsonb("cv_file_ref").$type<FileRefProps>().notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  // FK to reports.id; nullable because it is set only at EVALUATED. Defined as text (not uuid)
  // since `ReportId = string` in the domain — keep it loose; FK constraint added after reports table exists.
  reportId: uuid("report_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type InterviewRow = typeof interviews.$inferSelect;
export type InterviewInsertRow = typeof interviews.$inferInsert;
```

**Notes for the implementer:**
- `recruiter_id` is `text` — Phase 2 does not introduce a `recruiters` table. Add a foreign key when recruiter persistence lands.
- `report_id` deliberately omits `references(() => reports.id)` here to avoid a circular import between `interviews.ts` and `reports.ts`. Either (a) add the FK in a follow-up SQL migration **after** `reports` is created in the same `db:generate` run, or (b) add the FK via `references` only on the `reports.interview_id` side (preferred — see Step 2). We go with (b).
- `mode: "date"` makes Drizzle hand back JS `Date` objects — matches `InterviewSerialized.scheduledAt: Date` exactly.
- We **do not** define a Postgres enum for `status` — the domain owns that union. `text` plus `$type<InterviewStatus>()` is sufficient. (A check constraint may be added later; not in Phase 2.)

**Invariant check:** Schema mirrors `serialize()` shape 1:1; no normalized child tables; types come from `@repo/domain` (infrastructure → domain is allowed).

---

### Step 2 — Schema: `reports` table

**File:** `apps/backend/src/infrastructure/persistence/schema/reports.ts` (CREATE)

**What:** Drizzle table for the Report aggregate.

**Code:**
```typescript
import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Recommendation, TopicScoreProps } from "@repo/domain";
import { interviews } from "./interviews.js";

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey(),
  // FK to the owning interview; on delete the report goes too.
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  overallRecommendation: text("overall_recommendation").$type<Recommendation>().notNull(),
  topicScores: jsonb("topic_scores")
    .$type<ReadonlyArray<TopicScoreProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  communicationAssessment: text("communication_assessment").notNull(),
  strengths: jsonb("strengths").$type<ReadonlyArray<string>>().notNull().default(sql`'[]'::jsonb`),
  concerns: jsonb("concerns").$type<ReadonlyArray<string>>().notNull().default(sql`'[]'::jsonb`),
  followUpQuestions: jsonb("follow_up_questions")
    .$type<ReadonlyArray<string>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type ReportRow = typeof reports.$inferSelect;
export type ReportInsertRow = typeof reports.$inferInsert;
```

**Invariant check:** One table per aggregate; arrays of value objects live as JSONB; FK constraint expresses the cross-aggregate reference (interview → report) only on the `reports` side, breaking the circular import.

---

### Step 3 — Schema barrel update

**File:** `apps/backend/src/infrastructure/persistence/schema/index.ts` (MODIFY — currently just a comment)

**What:** Re-export the two tables so `drizzle-kit` and `db.ts` can pick them up via `import * as schema from "./schema/index.js"`.

**Code:**
```typescript
// Drizzle schema definitions — one file per aggregate root.
export * from "./interviews.js";
export * from "./reports.js";
```

**Invariant check:** Single barrel keeps `db.ts` and `drizzle.config.ts` import paths stable.

---

### Step 4 — Generate the initial migration

**Operation:** Shell command (no source file written by the agent — `drizzle-kit` writes them).

```bash
# In repo root:
DATABASE_URL=postgres://placeholder pnpm --filter backend db:generate
```

**What you get:**
- `apps/backend/drizzle/0000_<adjective>_<noun>.sql` — the migration SQL
- `apps/backend/drizzle/meta/_journal.json`
- `apps/backend/drizzle/meta/0000_snapshot.json`

**Verification:**
- Read the generated `.sql` file. It must contain:
  - `CREATE TABLE "interviews"` with all eleven columns (`id`, `recruiter_id`, `status`, `job_description`, `candidate_info`, `client_instructions`, `interview_plan`, `transcript`, `jd_file_ref`, `cv_file_ref`, `scheduled_at`, `started_at`, `completed_at`, `report_id`, `created_at`, `updated_at`)
  - `CREATE TABLE "reports"` with all ten columns
  - A FK constraint `reports_interview_id_interviews_id_fk ... ON DELETE CASCADE`
  - Default values `'[]'::jsonb` for the array JSONB columns
- File is not empty; no errors in `drizzle-kit` stdout.

**Commit the generated SQL** — it is part of the deliverable.

**Invariant check:** The placeholder `DATABASE_URL` is fine for `db:generate` (it does not connect). For `db:migrate` (Step 18) a real DB is required.

---

### Step 5 — `RepositoryError` hierarchy

**File:** `apps/backend/src/infrastructure/repositories/errors/repository-error.ts` (CREATE)

**What:** Infrastructure-only error hierarchy. Subclasses extend `Error` so they fit the existing port signatures (`Promise<Result<..., Error>>`). Use cases already translate `Error` → `ServiceUnknownError` at the boundary, so this stays inside infra.

**Code:**
```typescript
/**
 * Errors emitted by repository implementations. They satisfy the `Error` slot
 * of the domain repository ports (`IInterviewRepository`, `IReportRepository`)
 * but never leak past the application layer — use cases translate them via
 * `ServiceUnknownError` (see `create-interview.use-case.ts`).
 */
export abstract class RepositoryError extends Error {
  abstract readonly code: string;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class RepositoryConnectionError extends RepositoryError {
  readonly code = "REPO_CONNECTION_ERROR";
}

export class RepositoryConflictError extends RepositoryError {
  /** Unique-violation, FK violation, etc. */
  readonly code = "REPO_CONFLICT";
}

export class RepositoryNotFoundError extends RepositoryError {
  /**
   * NB: For *query* methods we return `Result.Ok(Option.None)` — this error is for
   * commands like `delete` / `save` (UPDATE) where 0 rows affected is unexpected.
   */
  readonly code = "REPO_NOT_FOUND";
  constructor(readonly entity: string, readonly id: string) {
    super(`${entity} with id ${id} not found`);
  }
}

export class RepositoryUnknownError extends RepositoryError {
  readonly code = "REPO_UNKNOWN";
  constructor(message: string, readonly operation: string, cause?: unknown) {
    super(message, cause);
  }
}
```

**Invariant check:** Lives in infrastructure; `extends Error` keeps the port signature satisfied; no `throw` paths.

---

### Step 6 — Postgres error → `RepositoryError` translator

**File:** `apps/backend/src/infrastructure/repositories/errors/translate-pg-error.ts` (CREATE)

**What:** Pure function turning an `unknown` thrown by `postgres` / Drizzle into a typed `RepositoryError`. Used as the second argument to `Result.tryAsyncCatch` inside every repo method.

**Code:**
```typescript
import {
  RepositoryConflictError,
  RepositoryConnectionError,
  RepositoryUnknownError,
  type RepositoryError,
} from "./repository-error.js";

interface PgErrorShape {
  readonly code?: string;
  readonly message?: string;
}

const isPgError = (e: unknown): e is PgErrorShape =>
  typeof e === "object" && e !== null && ("code" in e || "message" in e);

/**
 * Translate a thrown value from the `postgres` driver into a RepositoryError.
 * Postgres SQLSTATE codes:
 *   23505 — unique_violation
 *   23503 — foreign_key_violation
 *   23502 — not_null_violation
 *   08*   — connection_exception family
 */
export const translatePgError = (operation: string) =>
  (e: unknown): RepositoryError => {
    if (!isPgError(e)) {
      return new RepositoryUnknownError(
        e instanceof Error ? e.message : String(e),
        operation,
        e,
      );
    }
    const code = e.code ?? "";
    const msg = e.message ?? "Postgres error";
    if (code === "23505" || code === "23503" || code === "23502") {
      return new RepositoryConflictError(msg, e);
    }
    if (code.startsWith("08")) {
      return new RepositoryConnectionError(msg, e);
    }
    return new RepositoryUnknownError(msg, operation, e);
  };
```

**Invariant check:** No throws; function returns a new error, does not raise; pure.

---

### Step 7 — `DrizzleInterviewRepository`

**File:** `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts` (CREATE)

**What:** Implements `IInterviewRepository` using the `db` client from `infrastructure/persistence/db.ts`. Calls `entity.serialize()` on writes and `Interview.fromSerialized()` on reads. Wraps every `await`/Drizzle call in `Result.tryAsyncCatch(..., translatePgError(...))`.

**Code (full skeleton):**
```typescript
import { Option, Result } from "@carbonteq/fp";
import { eq } from "drizzle-orm";
import {
  Interview,
  type IInterviewRepository,
  type InterviewId,
  type InterviewSerialized,
  type RecruiterId,
} from "@repo/domain";
import type { Database } from "../persistence/db.js";
import { interviews, type InterviewInsertRow, type InterviewRow } from "../persistence/schema/interviews.js";
import { translatePgError } from "./errors/translate-pg-error.js";
import type { RepositoryError } from "./errors/repository-error.js";

const rowToSerialized = (row: InterviewRow): InterviewSerialized => ({
  id: row.id,
  recruiterId: row.recruiterId,
  status: row.status,
  jobDescription: row.jobDescription,
  candidateInfo: row.candidateInfo,
  clientInstructions: row.clientInstructions,
  interviewPlan: row.interviewPlan,
  transcript: row.transcript,
  jdFileRef: row.jdFileRef,
  cvFileRef: row.cvFileRef,
  scheduledAt: row.scheduledAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  reportId: row.reportId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const serializedToInsertRow = (s: InterviewSerialized): InterviewInsertRow => ({
  id: s.id,
  recruiterId: s.recruiterId,
  status: s.status,
  jobDescription: s.jobDescription,
  candidateInfo: s.candidateInfo,
  clientInstructions: s.clientInstructions,
  interviewPlan: s.interviewPlan,
  transcript: s.transcript,
  jdFileRef: s.jdFileRef,
  cvFileRef: s.cvFileRef,
  scheduledAt: s.scheduledAt,
  startedAt: s.startedAt,
  completedAt: s.completedAt,
  reportId: s.reportId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export class DrizzleInterviewRepository implements IInterviewRepository {
  constructor(private readonly db: Database) {}

  async save(interview: Interview): Promise<Result<Interview, RepositoryError>> {
    const serialized = interview.serialize();
    const insertRow = serializedToInsertRow(serialized);

    return Result.tryAsyncCatch(
      () =>
        this.db
          .insert(interviews)
          .values(insertRow)
          .onConflictDoUpdate({
            target: interviews.id,
            set: {
              status: insertRow.status,
              jobDescription: insertRow.jobDescription,
              candidateInfo: insertRow.candidateInfo,
              clientInstructions: insertRow.clientInstructions,
              interviewPlan: insertRow.interviewPlan,
              transcript: insertRow.transcript,
              jdFileRef: insertRow.jdFileRef,
              cvFileRef: insertRow.cvFileRef,
              scheduledAt: insertRow.scheduledAt,
              startedAt: insertRow.startedAt,
              completedAt: insertRow.completedAt,
              reportId: insertRow.reportId,
              updatedAt: insertRow.updatedAt,
            },
          })
          .returning(),
      translatePgError("InterviewRepository.save"),
    )
      .map((rows) => Interview.fromSerialized(rowToSerialized(rows[0]!)))
      .toPromise();
  }

  async findById(id: InterviewId): Promise<Result<Option<Interview>, RepositoryError>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(interviews).where(eq(interviews.id, id)).limit(1),
      translatePgError("InterviewRepository.findById"),
    )
      .map((rows) =>
        rows.length === 0
          ? Option.None
          : Option.Some(Interview.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }

  async listByRecruiter(
    recruiterId: RecruiterId,
  ): Promise<Result<ReadonlyArray<Interview>, RepositoryError>> {
    return Result.tryAsyncCatch(
      () =>
        this.db.select().from(interviews).where(eq(interviews.recruiterId, recruiterId)),
      translatePgError("InterviewRepository.listByRecruiter"),
    )
      .map((rows) => rows.map((r) => Interview.fromSerialized(rowToSerialized(r))))
      .toPromise();
  }

  async delete(id: InterviewId): Promise<Result<void, RepositoryError>> {
    return Result.tryAsyncCatch(
      () => this.db.delete(interviews).where(eq(interviews.id, id)),
      translatePgError("InterviewRepository.delete"),
    )
      .map(() => undefined)
      .toPromise();
  }
}
```

**Notes for the implementer:**
- The `rowToSerialized` and `serializedToInsertRow` helpers live **inside this file** — they are not "mappers", they are the trivial bridge between Drizzle's row type and the entity's serialized type. Drizzle's `$type<…>()` already enforces structural equality so these are essentially identity functions; they exist only to give TypeScript a single place to verify the row layout.
- `onConflictDoUpdate({ target: interviews.id, set: { … } })` makes `save()` an upsert — required because the port doc says "Insert or update".
- `rows[0]!` is safe because `.returning()` after a successful insert/update returns at least one row; if Drizzle ever returns zero we want a runtime error to bubble through `tryAsyncCatch` rather than silently returning a stale entity. **Implementation note:** if the team prefers to be paranoid, replace `rows[0]!` with a guard that returns `Result.Err(new RepositoryUnknownError("…", "save"))` and lift the whole chain through `flatMap`.
- `Promise<Result<…, RepositoryError>>` is a *narrower* return than the port's `Promise<Result<…, Error>>`, which is allowed by TS variance (return-position covariance). Callers see `Error`, repo callers in tests see `RepositoryError`.

**Invariant check:** No throws; no try/catch; uses `entity.serialize()` / `Entity.fromSerialized()`; no mapper file; ends every chain with `.toPromise()`.

---

### Step 8 — `DrizzleReportRepository`

**File:** `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts` (CREATE)

**What:** Same shape as Step 7, for `IReportRepository`. Three methods: `save`, `findById`, `findByInterviewId`.

**Code:**
```typescript
import { Option, Result } from "@carbonteq/fp";
import { eq } from "drizzle-orm";
import {
  type IReportRepository,
  type InterviewId,
  Report,
  type ReportSerialized,
} from "@repo/domain";
import type { Database } from "../persistence/db.js";
import { reports, type ReportInsertRow, type ReportRow } from "../persistence/schema/reports.js";
import { translatePgError } from "./errors/translate-pg-error.js";
import type { RepositoryError } from "./errors/repository-error.js";

const rowToSerialized = (row: ReportRow): ReportSerialized => ({
  id: row.id,
  interviewId: row.interviewId,
  overallRecommendation: row.overallRecommendation,
  topicScores: row.topicScores,
  communicationAssessment: row.communicationAssessment,
  strengths: row.strengths,
  concerns: row.concerns,
  followUpQuestions: row.followUpQuestions,
  generatedAt: row.generatedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const serializedToInsertRow = (s: ReportSerialized): ReportInsertRow => ({
  id: s.id,
  interviewId: s.interviewId,
  overallRecommendation: s.overallRecommendation,
  topicScores: s.topicScores,
  communicationAssessment: s.communicationAssessment,
  strengths: s.strengths,
  concerns: s.concerns,
  followUpQuestions: s.followUpQuestions,
  generatedAt: s.generatedAt,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export class DrizzleReportRepository implements IReportRepository {
  constructor(private readonly db: Database) {}

  async save(report: Report): Promise<Result<Report, RepositoryError>> {
    const serialized = report.serialize();
    const insertRow = serializedToInsertRow(serialized);

    return Result.tryAsyncCatch(
      () =>
        this.db
          .insert(reports)
          .values(insertRow)
          .onConflictDoUpdate({
            target: reports.id,
            set: {
              overallRecommendation: insertRow.overallRecommendation,
              topicScores: insertRow.topicScores,
              communicationAssessment: insertRow.communicationAssessment,
              strengths: insertRow.strengths,
              concerns: insertRow.concerns,
              followUpQuestions: insertRow.followUpQuestions,
              generatedAt: insertRow.generatedAt,
              updatedAt: insertRow.updatedAt,
            },
          })
          .returning(),
      translatePgError("ReportRepository.save"),
    )
      .map((rows) => Report.fromSerialized(rowToSerialized(rows[0]!)))
      .toPromise();
  }

  async findById(id: string): Promise<Result<Option<Report>, RepositoryError>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(reports).where(eq(reports.id, id)).limit(1),
      translatePgError("ReportRepository.findById"),
    )
      .map((rows) =>
        rows.length === 0
          ? Option.None
          : Option.Some(Report.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }

  async findByInterviewId(
    interviewId: InterviewId,
  ): Promise<Result<Option<Report>, RepositoryError>> {
    return Result.tryAsyncCatch(
      () =>
        this.db.select().from(reports).where(eq(reports.interviewId, interviewId)).limit(1),
      translatePgError("ReportRepository.findByInterviewId"),
    )
      .map((rows) =>
        rows.length === 0
          ? Option.None
          : Option.Some(Report.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }
}
```

**Invariant check:** Same as Step 7.

---

### Step 9 — Repositories barrel

**File:** `apps/backend/src/infrastructure/repositories/index.ts` (CREATE)

**What:** Public surface of the repositories layer.

**Code:**
```typescript
export { DrizzleInterviewRepository } from "./drizzle-interview.repository.js";
export { DrizzleReportRepository } from "./drizzle-report.repository.js";
export {
  RepositoryError,
  RepositoryConnectionError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryUnknownError,
} from "./errors/repository-error.js";
```

**Invariant check:** `RepositoryError` is exported from infra only; no leak into `@repo/application`.

---

### Step 10 — `LocalFileStorageService` adapter

**File:** `apps/backend/src/infrastructure/services/local-file-storage.service.ts` (CREATE)

**What:** Disk-backed `IFileStorageService`. Reads `FILE_STORAGE_ROOT` and `FILE_STORAGE_SIGNING_SECRET` from env at construction. Errors translate to `StorageNotFoundError` / `StorageUnavailableError` / `StorageUnknownError`. HMAC-signed URLs: `GET /files/:key?token=<base64url-hmac>&expires=<unixSec>`.

**Code:**
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { Result } from "@carbonteq/fp";
import { FileRef } from "@repo/domain";
import {
  type IFileStorageService,
  StorageNotFoundError,
  StorageUnavailableError,
  StorageUnknownError,
  type StorageError,
} from "@repo/application";

export interface LocalFileStorageConfig {
  /** Absolute path to the storage root directory. Created on first write if missing. */
  readonly rootPath: string;
  /** HMAC secret for signed URLs. Phase 7 verifies with the same secret. */
  readonly signingSecret: string;
  /** Optional base URL for signed URLs. Default: "/files". */
  readonly signedUrlPrefix?: string;
}

const DEFAULT_PREFIX = "/files";

const isNodeError = (e: unknown): e is NodeJS.ErrnoException =>
  typeof e === "object" && e !== null && "code" in e;

const translateFsError = (operation: string, key: string) =>
  (e: unknown): StorageError => {
    if (isNodeError(e)) {
      if (e.code === "ENOENT") return new StorageNotFoundError(key);
      if (e.code === "EACCES" || e.code === "EPERM" || e.code === "ENOSPC") {
        return new StorageUnavailableError(`${operation} failed: ${e.message}`);
      }
    }
    return new StorageUnknownError(
      e instanceof Error ? e.message : String(e),
      operation,
    );
  };

/**
 * Resolve `key` against `rootPath` and refuse anything that escapes the root
 * (`../` traversal). Returns null when traversal is detected.
 */
const safeResolve = (rootPath: string, key: string): string | null => {
  const normalizedRoot = resolve(rootPath) + sep;
  const candidate = resolve(rootPath, normalize(key));
  return candidate.startsWith(normalizedRoot) || resolve(rootPath) === candidate
    ? candidate
    : null;
};

export class LocalFileStorageService implements IFileStorageService {
  private readonly rootPath: string;
  private readonly signingSecret: string;
  private readonly prefix: string;

  constructor(cfg: LocalFileStorageConfig) {
    if (!cfg.rootPath?.trim()) {
      throw new Error("LocalFileStorageService: rootPath is required");
    }
    if (!cfg.signingSecret?.trim()) {
      throw new Error("LocalFileStorageService: signingSecret is required");
    }
    this.rootPath = resolve(cfg.rootPath);
    this.signingSecret = cfg.signingSecret;
    this.prefix = cfg.signedUrlPrefix ?? DEFAULT_PREFIX;
  }

  /**
   * Static constructor that reads env vars and returns a Result instead of
   * throwing — preferred entry point for composition roots.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Result<LocalFileStorageService, Error> {
    const root = env["FILE_STORAGE_ROOT"];
    const secret = env["FILE_STORAGE_SIGNING_SECRET"];
    if (!root) return Result.Err(new Error("FILE_STORAGE_ROOT is not set"));
    if (!secret) return Result.Err(new Error("FILE_STORAGE_SIGNING_SECRET is not set"));
    return Result.Ok(new LocalFileStorageService({ rootPath: root, signingSecret: secret }));
  }

  async upload(
    file: Buffer,
    key: string,
    contentType: string,
  ): Promise<Result<FileRef, StorageError>> {
    const absolute = safeResolve(this.rootPath, key);
    if (absolute === null) {
      return Result.Err(new StorageUnknownError(`Invalid key: ${key}`, "upload"));
    }
    const filename = key.split("/").pop() ?? key;
    return Result.tryAsyncCatch(
      async () => {
        await fs.mkdir(dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, file);
      },
      translateFsError("upload", key),
    )
      .flatMap(() =>
        FileRef.create({
          key,
          contentType,
          sizeBytes: file.byteLength,
          originalFilename: filename,
          uploadedAt: new Date(),
        }).mapErr(
          (e) => new StorageUnknownError(e.message, "upload") as StorageError,
        ),
      )
      .toPromise();
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    const absolute = safeResolve(this.rootPath, key);
    if (absolute === null) {
      return Result.Err(new StorageNotFoundError(key));
    }
    return Result.tryAsyncCatch(
      () => fs.readFile(absolute),
      translateFsError("download", key),
    ).toPromise();
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    const absolute = safeResolve(this.rootPath, key);
    if (absolute === null) {
      return Result.Err(new StorageNotFoundError(key));
    }
    return Result.tryAsyncCatch(
      async () => {
        await fs.unlink(absolute);
      },
      (e) => {
        // Treat "already gone" as success-shaped error or success? Spec leaves
        // this open. We surface ENOENT as StorageNotFoundError; callers decide.
        return translateFsError("delete", key)(e);
      },
    ).toPromise();
  }

  async getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>> {
    if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
      return Result.Err(
        new StorageUnknownError("expiresInSec must be a positive finite number", "getSignedUrl"),
      );
    }
    const expires = Math.floor(Date.now() / 1000) + Math.floor(expiresInSec);
    const token = this.sign(key, expires);
    const path = join(this.prefix, encodeURIComponent(key)).replace(/\\/g, "/");
    const url = `${path}?token=${token}&expires=${expires}`;
    return Result.Ok(url);
  }

  // ─── HMAC scheme (documented for Phase 7 verifying handler) ────────────
  // signedToken = base64url( HMAC_SHA256(signingSecret, `${key}.${expires}`) )
  // Verifier:
  //   1. parse `expires` from query; reject if NaN or < now
  //   2. recompute token from `key` + `expires` + same secret
  //   3. timingSafeEqual(received, recomputed); reject on mismatch

  private sign(key: string, expires: number): string {
    const mac = createHmac("sha256", this.signingSecret).update(`${key}.${expires}`).digest();
    return mac.toString("base64url");
  }

  /** Exposed for tests + Phase-7 route handler. */
  verify(key: string, expires: number, token: string): boolean {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(key, expires);
    const a = Buffer.from(expected, "base64url");
    const b = Buffer.from(token, "base64url");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
```

**Notes for the implementer:**
- The constructor throws on missing config because constructor failure is caught at composition root (Phase 7) — but we *also* expose `fromEnv` returning `Result` so application/use-case wiring stays in `Result`-land.
- `FileRef.create` is a `Result`; we lift it into the chain with `.flatMap` and remap its `InvalidFileRefError` to `StorageUnknownError`. The cast `as StorageError` is required because TypeScript widens unions inside `.mapErr` lambdas.
- Path-traversal protection (`safeResolve`) is mandatory — keys come from user input and may contain `../`.
- `DEFAULT_PREFIX = "/files"` matches the Phase 7 route shape `GET /files/:key`.
- `verify` is **not** part of `IFileStorageService` — it is only used by the Phase-7 route handler. Exposing it here keeps the HMAC scheme symmetric and prevents the route from re-implementing it.

**Invariant check:** No throw on the `Result`-returning paths; constructor throw is on misconfiguration only and is documented; all `fs` calls go through `Result.tryAsyncCatch`.

---

### Step 11 — Services barrel

**File:** `apps/backend/src/infrastructure/services/index.ts` (CREATE)

**Code:**
```typescript
export { LocalFileStorageService, type LocalFileStorageConfig } from "./local-file-storage.service.js";
```

**Invariant check:** None broken; clean barrel.

---

### Step 12 — OTel + Langfuse bootstrap

**File:** `apps/backend/src/infrastructure/observability/otel.ts` (CREATE)

**What:** A single function that initializes the NodeSDK with the Langfuse span processor and returns it so `main.ts` can register a graceful-shutdown hook. No-op if Langfuse env vars are missing — we want `pnpm dev` to keep working with an empty `.env`.

**Code:**
```typescript
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface OtelHandle {
  /** Flush spans + shutdown the SDK. Safe to call multiple times. */
  shutdown(): Promise<void>;
}

/**
 * Initialize OpenTelemetry with the Langfuse span processor.
 *
 * - Skips bootstrap entirely (returns a no-op handle) if Langfuse env vars are
 *   missing — keeps local dev frictionless.
 * - Uses `auto-instrumentations-node` so HTTP / fetch / pg are covered for
 *   future phases without per-call code.
 * - Phase 2 emits no manual spans — this exists to validate env wiring and to
 *   provide the shutdown hook for clean SIGTERM handling.
 *
 * Required env:
 *   LANGFUSE_PUBLIC_KEY
 *   LANGFUSE_SECRET_KEY
 *   LANGFUSE_BASE_URL  (e.g. https://cloud.langfuse.com)
 */
export function initOtel(env: NodeJS.ProcessEnv = process.env): OtelHandle {
  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  const baseUrl = env["LANGFUSE_BASE_URL"];

  if (!publicKey || !secretKey || !baseUrl) {
    // No-op handle; log once for visibility.
    // Use console (no app logger here) to avoid pulling Fastify upward.
    // eslint-disable-next-line no-console
    console.warn(
      "[otel] Langfuse env vars missing; OpenTelemetry bootstrap skipped.",
    );
    return { shutdown: async () => {} };
  }

  const langfuseProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl,
  });

  const sdk = new NodeSDK({
    spanProcessors: [langfuseProcessor],
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  let shut = false;
  return {
    async shutdown() {
      if (shut) return;
      shut = true;
      await sdk.shutdown();
    },
  };
}
```

**Notes:**
- The exact constructor name on `@langfuse/otel` is `LangfuseSpanProcessor` (default export pattern in 5.1). If the package exposes `LangfuseExporter` instead, the implementer should adjust accordingly (see Open Questions §1).
- `getNodeAutoInstrumentations()` returns an array; pass it directly. No options needed in Phase 2.
- We deliberately do NOT call any tracer here — Phase 3 is the first emitter.

**Invariant check:** Side-effectful but isolated; failure to init is non-fatal to the server (env-missing path returns a no-op handle).

---

### Step 13 — Wire OTel into `main.ts`

**File:** `apps/backend/src/main.ts` (MODIFY)

**What:** Initialize OTel **before** importing/building the Fastify app (so auto-instrumentations can patch HTTP). Register a graceful shutdown handler.

**Code (full file):**
```typescript
import { initOtel } from "./infrastructure/observability/otel.js";

// IMPORTANT: init OTel before importing the app so auto-instrumentations
// can patch http / pg modules at load time.
const otel = initOtel();

const PORT = Number(process.env["PORT"] ?? 3002);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function main() {
  const { buildApp } = await import("./app.js");
  const app = await buildApp();

  const shutdown = async (signal: NodeJS.Signals) => {
    // eslint-disable-next-line no-console
    console.log(`[main] received ${signal}, shutting down…`);
    try {
      await app.close();
    } finally {
      await otel.shutdown();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: PORT, host: HOST });
  // eslint-disable-next-line no-console
  console.log(`Server listening on ${HOST}:${PORT}`);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  await otel.shutdown();
  process.exit(1);
});
```

**Invariant check:** `app.ts` is unchanged; OTel side-effects stay in main; presentation untouched.

---

### Step 14 — Test infra: docker-compose for tests + helper

**File:** `apps/backend/docker-compose.test.yml` (CREATE)

**What:** Disposable Postgres for repository integration tests. We choose docker-compose over testcontainers to avoid pulling another runtime dep and to allow developers to keep the container running between test runs.

**Code:**
```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    container_name: ai_interviewer_test_pg
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: ai_interviewer_test
    ports:
      - "54329:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d ai_interviewer_test"]
      interval: 1s
      timeout: 1s
      retries: 30
```

**Notes:**
- Port `54329` chosen to avoid colliding with a developer's local Postgres on `5432`.
- `tmpfs` for the data volume — tests are stateless and the container is disposable.
- Developer command: `docker compose -f apps/backend/docker-compose.test.yml up -d`.
- CI command: identical, plus `docker compose down -v` after the run.
- The `TEST_DATABASE_URL` env var convention used in test setup (Step 15) is `postgres://test:test@localhost:54329/ai_interviewer_test`.

**Invariant check:** N/A (config file).

---

### Step 15 — Test helper: DB lifecycle

**File:** `apps/backend/src/infrastructure/persistence/__test-helpers__/test-db.ts` (CREATE)

**What:** Helper that connects to the test Postgres, runs migrations, exposes the Drizzle client, and provides a per-test truncation function. Imported by every repository `*.test.ts`.

**Code:**
```typescript
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import * as schema from "../schema/index.js";

const TEST_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgres://test:test@localhost:54329/ai_interviewer_test";

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_FOLDER = resolve(dirname(__filename), "../../../../drizzle");

let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedDb: PostgresJsDatabase<typeof schema> | null = null;

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export async function getTestDb(): Promise<TestDatabase> {
  if (cachedDb) return cachedDb;
  cachedClient = postgres(TEST_URL, { max: 4 });
  cachedDb = drizzle(cachedClient, { schema });
  await migrate(cachedDb, { migrationsFolder: MIGRATIONS_FOLDER });
  return cachedDb;
}

export async function truncateAll(db: TestDatabase): Promise<void> {
  await db.execute(
    // CASCADE handles the FK from reports -> interviews.
    // RESTART IDENTITY is harmless for uuid PKs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {
      sql: 'TRUNCATE TABLE "reports", "interviews" RESTART IDENTITY CASCADE',
      params: [],
    } as any,
  );
}

export async function closeTestDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end({ timeout: 1 });
    cachedClient = null;
    cachedDb = null;
  }
}
```

**Notes:**
- Migrations are applied on first call; subsequent `getTestDb()` returns the cached client. Tests can call `truncateAll(db)` in `beforeEach`.
- The `as any` cast is regrettable; the cleanest alternative is `db.execute(sql.raw('TRUNCATE …'))` from `drizzle-orm`. Implementer should prefer:
  ```typescript
  import { sql } from "drizzle-orm";
  await db.execute(sql.raw('TRUNCATE TABLE "reports", "interviews" RESTART IDENTITY CASCADE'));
  ```
  This snippet is the recommended replacement — adopt it during implementation.

**Invariant check:** Helper file under `__test-helpers__/` — never imported by production code.

---

### Step 16 — Repository tests (interview)

**File:** `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts` (CREATE)

**Test matrix:**
| Test                                           | Asserts                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `save inserts a new interview`                 | After `repo.save(i)`, `findById(i.id)` returns `Some(i)` with all fields equal via `serialize()` deep-equal. |
| `save upserts on conflicting id`               | Save twice; second save persists updated `status`/`updatedAt`; row count = 1.                            |
| `findById returns None for missing id`         | Returns `Result.Ok(Option.None)` (NOT an error).                                                         |
| `listByRecruiter returns only matching rows`   | Insert 3 interviews across 2 recruiters; query one recruiter; assert array length and ids.               |
| `listByRecruiter returns empty for new recruiter` | `Result.Ok([])`.                                                                                       |
| `delete removes the row`                       | After delete, `findById` returns `None`; cascade to `reports` if any was attached.                       |
| `JSONB round-trip preserves nested shapes`     | Build a complex `Interview` (with plan, transcript entries), save, reload, assert deep equality.         |
| `pg unique-violation translates to RepositoryConflictError` | Insert two rows with the same id (manually skipping upsert); call private save path or use raw insert; assert the returned `Err` is `instanceof RepositoryConflictError`. |

**Skeleton:**
```typescript
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Option } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  Interview,
  JobDescription,
} from "@repo/domain";
import { DrizzleInterviewRepository } from "./drizzle-interview.repository.js";
import { closeTestDb, getTestDb, truncateAll } from "../persistence/__test-helpers__/test-db.js";

const buildInterview = () => {
  const jd = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme",
    responsibilities: ["Build APIs"],
    requirements: ["5y TS"],
    rawText: "JD body",
  }).unwrap();
  const ci = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "Senior Backend Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript"],
    education: ["BSc CS"],
    rawText: "CV body",
  }).unwrap();
  const jdRef = FileRef.create({
    key: "interviews/x/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 1234,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  }).unwrap();
  const cvRef = FileRef.create({
    key: "interviews/x/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 4321,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  }).unwrap();
  return Interview.create({
    recruiterId: "rec-1",
    jobDescription: jd,
    candidateInfo: ci,
    clientInstructions: "Focus on systems design",
    scheduledAt: new Date("2026-02-01T10:00:00Z"),
    jdFileRef: jdRef,
    cvFileRef: cvRef,
  });
};

describe("DrizzleInterviewRepository", () => {
  // ... tests as in matrix above
  afterAll(closeTestDb);
});
```

**Each test must wrap `.unwrap()` setup with an `expect(result.isOk()).toBe(true)` assertion before `unwrap()` — per the Phase-1 review note (`docs/progress/phase-1.md` §"Code review (2026-04-30)").**

**Invariant check:** Real Postgres only; no mocks; co-located.

---

### Step 17 — Repository tests (report)

**File:** `apps/backend/src/infrastructure/repositories/drizzle-report.repository.test.ts` (CREATE)

**Test matrix:**
| Test                                              | Asserts                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `save inserts a new report`                       | Round-trip via `findById`; deep equality on serialized shape.                            |
| `save upserts on conflicting id`                  | Update changes scores; reload returns updated values.                                    |
| `findById returns None for missing id`            | `Result.Ok(Option.None)`.                                                                |
| `findByInterviewId returns the linked report`     | After saving an interview + report, `findByInterviewId(interview.id)` returns `Some(r)`. |
| `findByInterviewId returns None when none linked` | `Result.Ok(Option.None)` for an interview with no report.                                |
| `JSONB round-trip preserves topicScores array`    | Build a report with 3 topic scores, save, reload, assert array equality.                 |
| `FK violation when interviewId is unknown`        | Save a report whose `interviewId` does not exist → `RepositoryConflictError` (23503).    |

**Invariant check:** Same as Step 16.

---

### Step 18 — `LocalFileStorageService` tests

**File:** `apps/backend/src/infrastructure/services/local-file-storage.service.test.ts` (CREATE)

**Test matrix (uses `os.tmpdir()` + `fs.mkdtemp` for isolation):**
| Test                                                  | Asserts                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `upload writes file under root and returns FileRef`   | File exists on disk; returned `FileRef.key`/`sizeBytes`/`contentType` match input.   |
| `upload creates nested dirs (interviews/abc/cv.pdf)`  | Parent dirs are created via `mkdir -p`; file written.                                |
| `upload rejects path traversal`                       | Key like `../etc/passwd` returns `Err` with `StorageUnknownError`; no file written.  |
| `download returns Buffer for existing key`            | Buffer content equals what was uploaded.                                             |
| `download missing key returns StorageNotFoundError`   | `Err instanceof StorageNotFoundError`; `error.key === key`.                          |
| `delete removes existing file`                        | `fs.access` after delete throws ENOENT.                                              |
| `delete missing file returns StorageNotFoundError`    | (Phase decision; see Open Questions §3 — confirm before implementing.)               |
| `getSignedUrl returns URL with token + expires`       | Token is base64url; `expires` is a unix-ts > now.                                    |
| `verify accepts token from getSignedUrl`              | `verify(key, expires, token)` returns `true`.                                        |
| `verify rejects expired token`                        | Token with `expires` in the past returns `false`.                                    |
| `verify rejects tampered token`                       | Mutating one byte returns `false`.                                                   |
| `fromEnv: missing FILE_STORAGE_ROOT returns Err`      | `Result.isErr() === true`.                                                           |
| `fromEnv: missing FILE_STORAGE_SIGNING_SECRET returns Err` | Same.                                                                              |
| `fromEnv: both present returns Ok`                    | Result holds a `LocalFileStorageService`.                                            |

**Invariant check:** No real network; only filesystem; tmpdir teardown in `afterEach`.

---

### Step 19 — Run migrations against the test DB once

**Operation:** Manual sanity check (not a code file).

```bash
docker compose -f apps/backend/docker-compose.test.yml up -d
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm --filter backend db:migrate
```

**Verify:**
- Output: `Applied migration ...0000....` with 0 errors.
- `psql` (optional): `\d interviews` shows all 16 columns; `\d reports` shows all 11 columns; FK `reports_interview_id_interviews_id_fk` exists.

---

## Pseudo-workflow

End-to-end shape after Phase 2 lands (no controllers yet — illustrate via a hypothetical caller):

1. Composition root (added in Phase 7) reads env: `FILE_STORAGE_ROOT`, `FILE_STORAGE_SIGNING_SECRET`, `DATABASE_URL`, `LANGFUSE_*`.
2. `initOtel()` is called (Step 12) before app build. NodeSDK is started; auto-instrumentations patch HTTP/pg.
3. `db` (existing in `infrastructure/persistence/db.ts`) is imported; the schema barrel (Step 3) is loaded, so `db.query.*` and table refs are available.
4. `new DrizzleInterviewRepository(db)` is constructed and injected into `CreateInterviewUseCase` (Phase 1 already declared the dependency).
5. Use case calls `interviews.save(interview)`:
   - Repo serializes via `interview.serialize()`.
   - `Result.tryAsyncCatch(() => db.insert(...).onConflictDoUpdate(...).returning(), translatePgError("InterviewRepository.save"))` runs.
   - On success: `Interview.fromSerialized(rowToSerialized(rows[0]))`.
   - On error: a `RepositoryError` subclass.
   - `.toPromise()` flattens the inner Promise.
6. The use case maps any error via `mapErr(e => new ServiceUnknownError(e.message, "InterviewRepository.save"))`. (No change in this Phase; Phase 1 wired this.)
7. For uploads (Phase 7 controller will call `UploadCandidateDocumentsUseCase`):
   - Use case calls `storage.upload(buffer, key, contentType)` with key like `recruiters/{id}/uploads/jd/{ts}-{filename}`.
   - `LocalFileStorageService` `safeResolve`s the absolute path under `FILE_STORAGE_ROOT`, `mkdir -p`'s parents, writes the file, calls `FileRef.create(...)` and returns it.
   - On `fs` errors: `StorageNotFoundError` / `StorageUnavailableError` / `StorageUnknownError`.
8. `getSignedUrl(key, 600)` returns `/files/{encodedKey}?token=…&expires=…`. The Phase-7 route (`GET /files/:key`) calls `storage.verify(key, expires, token)` and streams the file.
9. On SIGTERM: `app.close()` then `otel.shutdown()` flushes any pending Langfuse spans (none in Phase 2; will matter from Phase 3 on).

---

## Entry points

Files in dependency order (innermost first):

| #  | File                                                                                                | Layer                | Operation     | Purpose                                                                                  |
| -- | --------------------------------------------------------------------------------------------------- | -------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| 1  | `apps/backend/src/infrastructure/persistence/schema/interviews.ts`                                  | infra/persistence    | CREATE        | Drizzle table `interviews`; JSONB columns mirror `Interview.serialize()`                 |
| 2  | `apps/backend/src/infrastructure/persistence/schema/reports.ts`                                     | infra/persistence    | CREATE        | Drizzle table `reports`; FK to `interviews.id` (cascade)                                 |
| 3  | `apps/backend/src/infrastructure/persistence/schema/index.ts`                                       | infra/persistence    | MODIFY        | Re-export `interviews`, `reports`                                                        |
| 4  | `apps/backend/drizzle/0000_<name>.sql` + `meta/`                                                    | infra/persistence    | CREATE (gen)  | Initial migration generated by `drizzle-kit generate`                                    |
| 5  | `apps/backend/src/infrastructure/repositories/errors/repository-error.ts`                           | infra/repositories   | CREATE        | `RepositoryError` hierarchy (Connection / Conflict / NotFound / Unknown)                 |
| 6  | `apps/backend/src/infrastructure/repositories/errors/translate-pg-error.ts`                         | infra/repositories   | CREATE        | Map postgres errors to `RepositoryError`                                                 |
| 7  | `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts`                      | infra/repositories   | CREATE        | Implements `IInterviewRepository`                                                        |
| 8  | `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts`                         | infra/repositories   | CREATE        | Implements `IReportRepository`                                                           |
| 9  | `apps/backend/src/infrastructure/repositories/index.ts`                                             | infra/repositories   | CREATE        | Barrel for repositories + error types                                                    |
| 10 | `apps/backend/src/infrastructure/services/local-file-storage.service.ts`                            | infra/services       | CREATE        | Implements `IFileStorageService` against local disk + HMAC signed URLs                   |
| 11 | `apps/backend/src/infrastructure/services/index.ts`                                                 | infra/services       | CREATE        | Barrel for services                                                                      |
| 12 | `apps/backend/src/infrastructure/observability/otel.ts`                                             | infra/observability  | CREATE        | NodeSDK + Langfuse span processor; `initOtel` → `OtelHandle`                             |
| 13 | `apps/backend/src/main.ts`                                                                          | app entry            | MODIFY        | Call `initOtel()` first; SIGTERM/SIGINT graceful shutdown                                |
| 14 | `apps/backend/docker-compose.test.yml`                                                              | repo root            | CREATE        | Disposable Postgres on port 54329 for integration tests                                  |
| 15 | `apps/backend/src/infrastructure/persistence/__test-helpers__/test-db.ts`                           | infra/persistence    | CREATE        | `getTestDb` / `truncateAll` / `closeTestDb`                                              |
| 16 | `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts`                 | infra/repositories   | CREATE        | Integration tests for interview repo                                                     |
| 17 | `apps/backend/src/infrastructure/repositories/drizzle-report.repository.test.ts`                    | infra/repositories   | CREATE        | Integration tests for report repo                                                        |
| 18 | `apps/backend/src/infrastructure/services/local-file-storage.service.test.ts`                       | infra/services       | CREATE        | Tests for upload/download/delete/getSignedUrl/verify                                     |

---

## Step-ordered batches

Each batch is independently runnable; later batches assume earlier batches are merged.

### Batch A — Schema (Steps 1–3)

- Steps 1, 2, 3.
- Verify with `pnpm turbo run check-types --filter=backend`.

### Batch B — Migration generation (Step 4)

- Run `DATABASE_URL=postgres://placeholder pnpm --filter backend db:generate`.
- Inspect `apps/backend/drizzle/0000_*.sql`; commit it.

### Batch C — Repository plumbing + repos (Steps 5–9)

- Steps 5, 6, 7, 8, 9.
- Verify with `pnpm turbo run check-types --filter=backend`.

### Batch D — File storage adapter (Steps 10–11)

- Steps 10, 11.
- Verify with `pnpm turbo run check-types --filter=backend`.

### Batch E — Observability bootstrap (Steps 12–13)

- Steps 12, 13.
- Verify with `pnpm turbo run check-types --filter=backend` and `pnpm --filter backend dev` boots cleanly with Langfuse env vars unset (warns + continues) and with them set (no warning).

### Batch F — Test infrastructure (Steps 14–15)

- Steps 14, 15.
- Verify by running `docker compose -f apps/backend/docker-compose.test.yml up -d` and `pnpm --filter backend db:migrate` against `TEST_DATABASE_URL`.

### Batch G — Tests (Steps 16–18)

- Steps 16, 17, 18.
- Verify with `pnpm turbo run test --filter=backend` (with the test DB running). Target ≥ 85% statements / ≥ 80% branches per `CLAUDE.md`.

### Batch H — Migration applied + final verification (Step 19 + Verification checklist)

- Apply migration.
- Run full backend test suite + type-check.

---

## Verification checklist

Run in order after each batch and at the end:

```bash
# 1. Type-check (after every batch)
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# 2. Drizzle: generated SQL is non-empty
test -s apps/backend/drizzle/0000_*.sql && echo "OK" || echo "FAIL: empty migration"

# 3. Drizzle: snapshot + journal exist
ls apps/backend/drizzle/meta/_journal.json apps/backend/drizzle/meta/0000_snapshot.json

# 4. Bring up test Postgres
docker compose -f apps/backend/docker-compose.test.yml up -d
docker compose -f apps/backend/docker-compose.test.yml ps  # postgres-test should be (healthy)

# 5. Migrations apply against fresh DB
DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm --filter backend db:migrate

# 6. Tests
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm turbo run test --filter=backend

# 7. Phase-1 tests still green
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application

# 8. Manual sanity: server boots with OTel
LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk LANGFUSE_BASE_URL=http://localhost \
  FILE_STORAGE_ROOT=/tmp/aii FILE_STORAGE_SIGNING_SECRET=devsecret \
  DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm --filter backend dev
# expect: no "Langfuse env vars missing" warning; "Server listening on …"

# 9. Manual sanity: env-rejection
FILE_STORAGE_ROOT="" pnpm exec tsx -e \
  "import('./apps/backend/dist/infrastructure/services/local-file-storage.service.js')\
   .then(m => console.log(m.LocalFileStorageService.fromEnv().isErr()))"
# expect: true
```

**Done criterion:** All 9 checks pass; total test count ≥ 153 (Phase 1) + ~25 (Phase 2 new tests).

---

## Risk notes / open questions

1. **`@langfuse/otel` API surface (v5.1).** The plan assumes `LangfuseSpanProcessor` is the public class and accepts `{ publicKey, secretKey, baseUrl }`. If the actual export is different (e.g. `LangfuseExporter` + a manual `BatchSpanProcessor`), the implementer should consult the package's `dist/index.d.ts` and adjust Step 12 — the rest of the plan is unaffected.

2. **`Result.tryAsyncCatch` interaction with `.returning()` empty rows.** Drizzle returns `[]` from `.returning()` if no row was actually upserted (rare but possible on certain race conditions). The current snippet does `rows[0]!`. Acceptable for now; the implementer may harden by lifting an explicit `if (rows.length === 0)` branch into the `Result` chain. Document the chosen behavior.

3. **Semantics of `delete(missingKey)`.** `IFileStorageService.delete(key)` returns `Result<void, StorageError>`. Choices: (a) return `Ok` when the file is already gone (idempotent delete), or (b) return `Err(StorageNotFoundError)`. The current adapter does (b) because it surfaces all `fs.unlink` errors. **Recommendation:** clarify with the use-case author; if idempotency is required, swallow `ENOENT` in `delete` and return `Result.Ok(undefined)`. Adjust Step 18 test matrix accordingly.

4. **`DrizzleInterviewRepository.delete` vs cascade.** `reports.interview_id` cascades on delete, so deleting an interview also drops its report. This matches "aggregate boundary" thinking but the domain port doesn't say anything about it. Acceptable; document in commit message.

5. **`RecruiterId` is just `string`.** No `recruiters` table, no FK on `interviews.recruiter_id`. When a Recruiter aggregate lands (post Phase 7 most likely) we will add the FK and migrate the column type to `uuid`. Until then `text` is correct.

6. **Path-traversal on storage keys.** `safeResolve` rejects `../`. But the upload use case currently never validates keys — they are constructed by the use case itself, so traversal cannot happen in practice today. The check is defense-in-depth for Phase 7, where keys may come from user input.

7. **`Option.None` vs `Option<T>` typing in `findById`.** `Option.None` from `@carbonteq/fp` has type `Option<never>` which widens to `Option<T>` at the use site. Verified to work in Phase 1 (`interview.entity.ts` does the same). If TypeScript complains, fall back to `Option.None as Option<Interview>`.

8. **Test DB port collision.** Port `54329` was chosen to avoid `5432`. If a developer's environment has another service bound there, override via `TEST_DATABASE_URL` env var.

9. **Migrations folder in `migrate()`.** The relative resolver in `test-db.ts` (`../../../../drizzle`) is fragile — it assumes 4 levels up from `apps/backend/src/infrastructure/persistence/__test-helpers__/`. Prefer reading the path from a config or using `import.meta.url` + a known anchor; the path string in the snippet is correct for the proposed layout but worth double-checking when implementing.

10. **No transactions in repos.** Each repo method is a single statement — no `BEGIN`/`COMMIT` wrapping. Acceptable today: every persisted operation is one row in one table. Multi-aggregate writes (e.g. "complete interview AND save report") will require a Unit-of-Work, which `packages/application/src/core/unit-of-work.interface.ts` already declares as a port. Implementing it is out of scope for Phase 2 and is properly Phase 6's responsibility.

11. **Coverage of `Result.tryAsyncCatch` error paths in tests.** Forcing a `23505` unique-violation requires bypassing `onConflictDoUpdate`. The plan suggests doing a *raw* insert via `db.insert(...).values({...}).onConflictDoNothing()` followed by an unconditional second insert — but a simpler approach: temporarily monkey-patch the repo to use plain `.insert(...).values(...).returning()` for that one test, asserting against the resulting `Err`. The implementer may prefer a different harness; the assertion remains: "pg unique-violation → `RepositoryConflictError`".

---

## Saved plan path

`.claude/plan/phase-2-persistence-and-storage.md`
