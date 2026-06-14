# Plan: Phase 10 — ElevenLabs Session Integrity (Backend)

> Generated: 2026-06-13
> Slug: phase-10-session-integrity-backend
> Source of truth: ADR-035 (extends/partially supersedes ADR-034)
> Scope: BACKEND ONLY. Frontend reload-guard / modal / transcript-scroll are OUT (separate plan).

## Summary

Implements the five coupled session-integrity mechanisms of ADR-035 across all backend layers:
(1) idempotent session binding so a page-reload cannot mint a second ElevenLabs conversation;
(2) best-transcript-wins / never-shrink completion so an empty/shorter duplicate cannot overwrite a richer transcript;
(3) atomic report-invalidation when a strictly-better transcript arrives after EVALUATED (revert to COMPLETED + delete stale report in one DB transaction);
(4) a reconciliation sweep use case that re-pulls the transcript from ElevenLabs REST for interviews stuck IN_PROGRESS past a threshold and completes or FAILs them, exposed via a recruiter-triggered endpoint;
(5) a new terminal `FAILED` interview status with a `fail(reason)` entity transition, serialization, a Drizzle migration, and recruiter-visible surfacing.

All work obeys Clean Architecture + DDD, `@carbonteq/fp` `Result`/`Option` only (no throw/try-catch/`T|null` in domain/app/infra), immutable entities with `serialize()`/`fromSerialized()`, and per-boundary error mapping (DomainError → ServiceError → HttpError).

## IMPORTANT discovery notes (read before implementing)

- **`getTranscript` already exists** on `IConversationalAgentService` (`conversational-agent.port.ts:40-47`) AND on `ElevenLabsConversationalService` (`elevenlabs-conversational.service.ts:64-87`), returning `ReadonlyArray<ConversationalTranscriptRow>` with `{ speaker, text, timestamp }`. The task brief's "re-introduce getTranscript" is **already satisfied** — Mechanism 4 reuses it as-is. Do NOT re-add it. `ConversationalTranscriptFetchFailedError` already exists too.
- **`IUnitOfWork`** already exists (`core/unit-of-work.interface.ts`): `transaction<T>(work: () => Promise<Result<T, Error>>): Promise<Result<T, Error>>`. Mechanism 3 uses it. Confirm whether a Drizzle implementation exists; if not, one must be created (see Step 8 / Risk notes).
- **`recomplete` cannot reuse `complete()`**: `complete()` gates on `canTransition(status, COMPLETED)`. From COMPLETED or EVALUATED that returns `false`. `recomplete` must be a distinct method that bypasses the transition gate and is guarded only by the strictly-better invariant.
- Interview entity Options: `transcript` is `ReadonlyArray<TranscriptEntry>`; `reportId`/`startedAt`/`completedAt`/`elevenLabsSessionId` are `Option<...>`. `withChanges` already supports `reportId`, `completedAt`, `transcript`, `status`.
- `withChanges` currently CANNOT clear `reportId` back to `Option.None` via `patch.reportId ?? this.reportId` (a passed `Option.None` is falsy-safe because `Option.None ?? x` returns `Option.None` — `??` only short-circuits on null/undefined, and `Option.None` is an object, so it IS passed through correctly). Verify with a unit test in Step 1.

## Layers touched

| Layer          | Package / Location                  | Scope                                                                                                  |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Domain         | `packages/domain/`                  | `FAILED` status + transitions; `recomplete(at, transcript)`, `fail(reason)`, `revertToCompleted()` entity methods; `SessionAlreadyActiveError`; barrel exports |
| Application    | `packages/application/`             | Idempotent guard in StartCandidateSession; best-transcript-wins + atomic report-invalidation in PersistCompletedTranscript; new ReconcileStuckInterviews use case; (port unchanged — getTranscript present) |
| Infrastructure | `apps/backend/src/infrastructure/`  | Drizzle migration for `FAILED`; `findStuckInProgress` repo method; Drizzle `IUnitOfWork` impl + report `delete`; service adapter unchanged |
| Presentation   | `apps/backend/src/presentation/`    | 409 mapping for `SESSION_ALREADY_ACTIVE`; recruiter reconcile endpoint + controller method; FAILED surfaced in recruiter interview DTO |

## Implementation steps

### Step 1 — Domain: add FAILED status + transitions

**File:** `packages/domain/src/entities/interview/interview-status.ts` (MODIFY)

**What:** Add `FAILED` as a new terminal status; allow `IN_PROGRESS -> FAILED`.

**Code:**
```typescript
export const INTERVIEW_STATUS = {
  CREATED: "CREATED",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  EVALUATED: "EVALUATED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;

const ALLOWED: Readonly<Record<InterviewStatus, ReadonlyArray<InterviewStatus>>> = {
  CREATED: ["SCHEDULED"],
  SCHEDULED: ["IN_PROGRESS"],          // (SCHEDULED -> FAILED deferred; not Tranche-A per ADR-035 §5)
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "FAILED"],
  COMPLETED: ["EVALUATED"],
  EVALUATED: [],
  CANCELLED: [],
  FAILED: [],                          // terminal
};
```

**Decision (per ADR-035 §5 + Risks):** Only `IN_PROGRESS -> FAILED`. Do NOT allow `COMPLETED -> FAILED` or `EVALUATED -> FAILED` — once a transcript exists the interview is recoverable, not failed. `fail()` therefore only transitions from IN_PROGRESS (matches the Risk-mitigation bullet "fail() only transitions from IN_PROGRESS"). `recomplete`/`revertToCompleted` deliberately bypass `canTransition` (they are not modelled as status-machine edges — see Steps 2-3).

**Invariant check:** ADR-035 Enforcement #3 — `FAILED` present in both `INTERVIEW_STATUS` and `ALLOWED` as terminal.

---

### Step 2 — Domain: `recomplete(at, transcript)` entity method (best-transcript-wins)

**File:** `packages/domain/src/entities/interview/interview.entity.ts` (MODIFY, insert after `complete()` ~line 155)

**What:** Re-completion that replaces the stored transcript ONLY when the incoming transcript has strictly more non-empty entries. Bypasses the IN_PROGRESS precondition of `complete()`.

**Code:**
```typescript
/**
 * COMPLETED/EVALUATED re-completion (ADR-035 Mechanism 2). Replaces the stored
 * transcript ONLY when `incoming` has strictly more non-empty entries than the
 * stored transcript. Returns a TranscriptNotStrictlyBetterError otherwise.
 * Does NOT change status (caller handles report-invalidation / revert).
 */
recomplete(
  at: Date,
  incoming: ReadonlyArray<TranscriptEntry>,
): Result<Interview, TranscriptNotStrictlyBetterError> {
  const incomingCount = countNonEmpty(incoming);
  const storedCount = countNonEmpty(this.transcript);
  if (incomingCount <= storedCount) {
    return Result.Err(new TranscriptNotStrictlyBetterError(this.id, storedCount, incomingCount));
  }
  return Result.Ok(
    this.withChanges({
      status: INTERVIEW_STATUS.COMPLETED,
      completedAt: Option.Some(at),
      transcript: Object.freeze([...incoming]),
    }),
  );
}
```

Add a private module-level helper in the same file (TranscriptEntry exposes `.text`; "non-empty" = trimmed text length > 0):
```typescript
function countNonEmpty(entries: ReadonlyArray<TranscriptEntry>): number {
  return entries.filter((e) => e.text.trim().length > 0).length;
}
```

**Notes:** `recomplete` always lands in COMPLETED (clears EVALUATED). When called from EVALUATED, the USE CASE additionally clears `reportId` and deletes the report atomically (Step 3 + Step 7). To clear `reportId`, add a sibling method (Step 3) rather than overloading `recomplete`, so `recomplete` stays single-responsibility.

**Invariant check:** ADR-035 Enforcement #4 — re-completion guarded by strictly-better precondition. ADR-001 — immutable, returns `Result<Interview, DomainError>`.

---

### Step 3 — Domain: `revertToCompleted()` + `fail(reason)` entity methods

**File:** `packages/domain/src/entities/interview/interview.entity.ts` (MODIFY)

**What:** `revertToCompleted()` clears `reportId` and sets status COMPLETED (used by Mechanism 3 after a better transcript arrives post-EVALUATED). `fail(reason)` transitions IN_PROGRESS -> FAILED and records the reason as an AgentNote.

**Code:**
```typescript
/** EVALUATED -> COMPLETED, clearing the stale reportId (ADR-035 Mechanism 3). */
revertToCompleted(): Result<Interview, InvalidInterviewStateTransitionError> {
  if (this.status !== INTERVIEW_STATUS.EVALUATED) {
    return Result.Err(
      new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.COMPLETED),
    );
  }
  return Result.Ok(
    this.withChanges({ status: INTERVIEW_STATUS.COMPLETED, reportId: Option.None }),
  );
}

/** IN_PROGRESS -> FAILED (ADR-035 Mechanism 5). Records reason as an AgentNote. */
fail(reason: string): Result<Interview, InvalidInterviewStateTransitionError> {
  if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.FAILED)) {
    return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.FAILED));
  }
  const noteResult = AgentNote.create({
    note: `[failed] ${reason}`,
    recordedAtTurn: 0,
    recordedAt: new Date(),
  });
  const notes = noteResult.isOk()
    ? Object.freeze([...this.notes, noteResult.unwrap()])
    : this.notes;
  return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.FAILED, notes }));
}
```

**CRITICAL `withChanges` fix:** `withChanges` uses `patch.reportId ?? this.reportId`. `Option.None` is a non-null object, so `Option.None ?? this.reportId` evaluates to `Option.None` (correct — `??` only falls through on null/undefined). This means clearing reportId WORKS. Add a unit test asserting `revertToCompleted()` yields `reportId.isNone() === true` to lock this in. `notes` is already in the `withChanges` patch shape — no signature change needed. `AgentNote` is already imported in the entity.

**Invariant check:** ADR-035 §5 risk-mitigation — `fail()` only from IN_PROGRESS via the policy gate. ADR-001 immutability.

---

### Step 4 — Domain: new errors + barrel exports

**File:** `packages/domain/src/entities/interview/errors/interview.errors.ts` (MODIFY)

**What:** Add `SessionAlreadyActiveError` (Mechanism 1) and `TranscriptNotStrictlyBetterError` (Mechanism 2).

**Code:**
```typescript
export class SessionAlreadyActiveError extends BusinessRuleViolationError {
  readonly code = "SESSION_ALREADY_ACTIVE";
  constructor(interviewId: string) {
    super(`Interview ${interviewId} already has an active ElevenLabs session`);
  }
}

export class TranscriptNotStrictlyBetterError extends BusinessRuleViolationError {
  readonly code = "TRANSCRIPT_NOT_STRICTLY_BETTER";
  constructor(interviewId: string, storedCount: number, incomingCount: number) {
    super(
      `Incoming transcript (${incomingCount} entries) is not strictly better than stored (${storedCount}) for interview ${interviewId}`,
    );
  }
}
```

**File:** `packages/domain/src/entities/interview/interview.entity.ts` (MODIFY) — import the two new errors at top.
**File:** `packages/domain/src/entities/interview/index.ts` — already does `export * from "./errors/interview.errors.js"` (line 13), so new errors auto-export. Verify the package root barrel `packages/domain/src/index.ts` re-exports the interview barrel (it does today via `@repo/domain`). No extra export edit needed beyond the errors file.

**Invariant check:** Barrel rule — new public domain types reachable from `@repo/domain`.

---

### Step 5 — Application: idempotent guard in StartCandidateSessionUseCase (Mechanism 1)

**File:** `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` (MODIFY, insert BEFORE the `issueSignedUrl` call ~line 80)

**What:** Refuse a second conversation when IN_PROGRESS AND a session id is already bound. Re-issuance allowed only when `elevenLabsSessionId.isNone()`.

**Code:**
```typescript
// ADR-035 Mechanism 1 — idempotent binding. Block re-issuance only when the
// interview is already IN_PROGRESS *and* a session id is bound (substantive
// connection already happened). isNone() => first-connect retry, allow.
const alreadyActive =
  interview.status === INTERVIEW_STATUS.IN_PROGRESS &&
  interview.elevenLabsSessionId.isSome();
if (alreadyActive) {
  return Result.Err(new SessionAlreadyActiveError(interview.id) as ServiceError);
}

const issued = await this.agent.issueSignedUrl({ agentId: input.agentId });
```

Add `SessionAlreadyActiveError` to the existing `@repo/domain` import block.

**Invariant check:** ADR-035 Enforcement #1 — `issueSignedUrl` is NOT called when IN_PROGRESS with a bound id. The guard sits above the call. Error mapped DomainError -> ServiceError via `as ServiceError` (consistent with the file's existing pattern lines 53/66/73).

---

### Step 6 — Application: best-transcript-wins + report-invalidation in PersistCompletedTranscriptUseCase (Mechanisms 2 & 3)

**File:** `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` (MODIFY)

**What:** Replace the first-writer-wins early return (lines 65-69) with a best-transcript-wins branch. On COMPLETED, `recomplete`. On EVALUATED, `recomplete` + atomically `revertToCompleted` + delete report via `IUnitOfWork`.

**Constructor change:** inject `reports: IReportRepository` and `uow: IUnitOfWork`:
```typescript
constructor(
  private readonly interviews: IInterviewRepository,
  private readonly reports: IReportRepository,
  private readonly uow: IUnitOfWork,
) { super(); }
```

**Replace the early-return block + the final complete/save block** with status-aware logic. Build `entries` first (existing lines 91-114 stay), then branch:
```typescript
const entries = entriesResult.unwrap();

// IN_PROGRESS path — first completion (existing behaviour, unchanged).
if (interview.status === INTERVIEW_STATUS.IN_PROGRESS) {
  const completed = intermediate.complete(input.occurredAt, entries);
  if (completed.isErr()) return Result.Ok({ applied: false, entryCount: 0 });
  const saved = await this.interviews.save(completed.unwrap());
  if (saved.isErr()) {
    return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
  }
  return Result.Ok({ applied: true, entryCount: entries.length });
}

// COMPLETED path — best-transcript-wins re-completion (Mechanism 2).
if (interview.status === INTERVIEW_STATUS.COMPLETED) {
  const recompleted = intermediate.recomplete(input.occurredAt, entries);
  if (recompleted.isErr()) return Result.Ok({ applied: false, entryCount: 0 }); // not strictly better
  const saved = await this.interviews.save(recompleted.unwrap());
  if (saved.isErr()) {
    return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
  }
  return Result.Ok({ applied: true, entryCount: entries.length });
}

// EVALUATED path — better transcript invalidates the report (Mechanism 3, ATOMIC).
if (interview.status === INTERVIEW_STATUS.EVALUATED) {
  const recompleted = intermediate.recomplete(input.occurredAt, entries);
  if (recompleted.isErr()) return Result.Ok({ applied: false, entryCount: 0 });
  const reverted = recompleted.unwrap().revertToCompleted();
  if (reverted.isErr()) return Result.Err(reverted.unwrapErr() as ServiceError);
  const next = reverted.unwrap();

  const tx = await this.uow.transaction(async () => {
    const saved = await this.interviews.save(next);
    if (saved.isErr()) return saved;
    return this.reports.deleteByInterviewId(interview.id); // see Step 8
  });
  if (tx.isErr()) {
    return Result.Err(new ServiceUnknownError(tx.unwrapErr().message, "PersistCompletedTranscript.invalidateReport"));
  }
  return Result.Ok({ applied: true, entryCount: entries.length });
}

return Result.Ok({ applied: false, entryCount: 0 });
```

Add `IReportRepository` to the `@repo/domain` import block and `IUnitOfWork` from the application core. `recomplete`/`revertToCompleted` read the stored count from the SAME `findById` (Risk: concurrent retransmits — deterministic last-writer-of-identical-content, no correctness risk per ADR-035 Risks).

**Invariant check:** ADR-035 Enforcement #2 — no short-circuit on COMPLETED/EVALUATED without a length comparison (the comparison now lives in `recomplete`). Mechanism 3 atomicity via single `uow.transaction`. The repos used inside `transaction` must run on the transactional connection — see Step 8 caveat.

---

### Step 7 — Application: ReconcileStuckInterviewsUseCase (Mechanism 4)

**File:** `packages/application/src/use-cases/interview/reconcile-stuck-interviews.use-case.ts` (CREATE)
**File:** `packages/application/src/index.ts` (MODIFY) — export the new use case + IO types.

**What:** Find interviews stuck IN_PROGRESS past `startedAt + thresholdMinutes`; for each, pull transcript from ElevenLabs and `recomplete`+save, else `fail()`.

**Code (signatures + core loop):**
```typescript
export interface ReconcileStuckInterviewsInput {
  readonly thresholdMinutes: number; // default wired in composition: 2 * maxDuration + 30 buffer
  readonly now?: Date;
}
export interface ReconcileStuckInterviewsOutput {
  readonly scanned: number;
  readonly completed: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
}

export class ReconcileStuckInterviewsUseCase extends UseCase<
  ReconcileStuckInterviewsInput,
  ReconcileStuckInterviewsOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
  ) { super(); }

  async execute(input: ReconcileStuckInterviewsInput): Promise<Result<ReconcileStuckInterviewsOutput, ServiceError>> {
    const now = input.now ?? new Date();
    const cutoff = new Date(now.getTime() - input.thresholdMinutes * 60_000);

    const stuckResult = await this.interviews.findStuckInProgress(cutoff); // Step 8
    if (stuckResult.isErr()) {
      return Result.Err(new ServiceUnknownError(stuckResult.unwrapErr().message, "InterviewRepository.findStuckInProgress"));
    }
    const stuck = stuckResult.unwrap();
    const completed: string[] = [];
    const failed: string[] = [];

    for (const interview of stuck) {
      const sessionId = interview.elevenLabsSessionId.match({ Some: (s) => s, None: () => null });
      if (sessionId === null) {
        await this.failInterview(interview, "no elevenLabsSessionId bound", failed);
        continue;
      }
      const fetched = await this.agent.getTranscript(sessionId);
      if (fetched.isErr()) {
        await this.failInterview(interview, fetched.unwrapErr().message, failed);
        continue;
      }
      const rows = fetched.unwrap();
      const entries = rows
        .filter((r) => r.text.trim().length > 0)
        .map((r) => TranscriptEntry.create({ speaker: r.speaker, text: r.text, timestamp: r.timestamp }));
      const entriesResult = entries.length === 0 ? Result.Ok([]) : Result.all(...entries);
      if (entriesResult.isErr() || (entriesResult.unwrap() as ReadonlyArray<TranscriptEntry>).length === 0) {
        await this.failInterview(interview, "transcript empty or invalid", failed);
        continue;
      }
      // interview is IN_PROGRESS here, so use complete() not recomplete().
      const done = interview.complete(now, entriesResult.unwrap() as ReadonlyArray<TranscriptEntry>);
      if (done.isErr()) { await this.failInterview(interview, "complete() rejected", failed); continue; }
      const saved = await this.interviews.save(done.unwrap());
      if (saved.isErr()) {
        return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
      }
      completed.push(interview.id);
    }
    return Result.Ok({ scanned: stuck.length, completed, failed });
  }

  private async failInterview(interview: Interview, reason: string, sink: string[]): Promise<void> {
    const failed = interview.fail(reason);
    if (failed.isOk()) {
      const saved = await this.interviews.save(failed.unwrap());
      if (saved.isOk()) sink.push(interview.id);
    }
  }
}
```

Imports: `Interview`, `TranscriptEntry`, `IInterviewRepository` from `@repo/domain`; `IConversationalAgentService` from the port barrel; `UseCase`, `ServiceUnknownError`, `ServiceError` from core.

**Note (reuse of Mechanism 2):** reconciliation operates on IN_PROGRESS interviews only (`findStuckInProgress` filters status), so the first completion uses `complete()`. Best-transcript-wins (`recomplete`) is the webhook path; reconciliation is the missing-webhook path — they do not overlap.

**Invariant check:** ADR-035 Mechanism 4 — threshold anchored to startedAt vs cutoff (not wall clock alone). Result/Option throughout; getTranscript already on the port.

---

### Step 8 — Infrastructure: repo additions + UnitOfWork impl + migration

**File A:** `apps/backend/src/infrastructure/persistence/schema/interviews.ts` (NO CHANGE) — `status` is a plain `text` column typed via `$type<InterviewStatus>()`. Because it is NOT a Postgres enum/check today, adding `FAILED` needs no schema-type edit. To match ADR-035's "enum/check constraint" intent and the existing 0003 migration style (a bare `ALTER TABLE`), add a CHECK constraint covering the full status set (see migration below). If no constraint currently exists, the migration ADDs one including FAILED.

**File B (migration):** `apps/backend/drizzle/0004_<name>.sql` (CREATE) — generated via `pnpm --filter backend db:generate` after schema annotation, OR hand-authored to match 0003's bare-ALTER style:
```sql
-- ADR-035 Mechanism 5: allow FAILED terminal status
ALTER TABLE "interviews" DROP CONSTRAINT IF EXISTS "interviews_status_check";
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_status_check"
  CHECK ("status" IN ('CREATED','SCHEDULED','IN_PROGRESS','COMPLETED','EVALUATED','CANCELLED','FAILED'));
```
Update `apps/backend/drizzle/meta/_journal.json` only via `db:generate` (do not hand-edit meta). If the team prefers Drizzle to own the constraint, annotate the column with `.$type<InterviewStatus>()` + a table-level `check(...)` in `interviews.ts` and run `db:generate`; either path is acceptable — pick generate-from-schema if a check already exists, hand-author if not.

**File C:** `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts` (MODIFY) — add `findStuckInProgress(cutoff)`:
```typescript
async findStuckInProgress(cutoff: Date): Promise<Result<ReadonlyArray<Interview>, Error>> {
  return Result.tryAsyncCatch(
    () =>
      this.db
        .select()
        .from(interviews)
        .where(and(eq(interviews.status, "IN_PROGRESS"), lt(interviews.startedAt, cutoff))),
    translatePgError("InterviewRepository.findStuckInProgress"),
  )
    .map((rows) => rows.map((row) => Interview.fromSerialized(rowToSerialized(row))))
    .toPromise();
}
```
Add `and`, `lt` to the `drizzle-orm` import. Add the method to `IInterviewRepository` (Step 9).

**File D:** `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts` (MODIFY) — add `deleteByInterviewId`:
```typescript
async deleteByInterviewId(interviewId: InterviewId): Promise<Result<void, Error>> {
  return Result.tryAsyncCatch(
    () => this.db.delete(reports).where(eq(reports.interviewId, interviewId)),
    translatePgError("ReportRepository.deleteByInterviewId"),
  )
    .map(() => undefined)
    .toPromise();
}
```
Add to `IReportRepository` (Step 9). Import `InterviewId` is already present in this file.

**File E (UnitOfWork impl):** `apps/backend/src/infrastructure/persistence/drizzle-unit-of-work.ts` (CREATE if absent — confirm first with `rg "implements IUnitOfWork" apps/backend/src -l`):
```typescript
import { Result } from "@carbonteq/fp";
import type { IUnitOfWork } from "@repo/application";
import type { Database } from "./db.js";

export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: Database) {}
  async transaction<T>(work: () => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    return Result.tryAsyncCatch(
      () =>
        this.db.transaction(async (tx) => {
          const r = await work();
          if (r.isErr()) throw r.unwrapErr(); // force rollback
          return r.unwrap();
        }),
      (err) => (err instanceof Error ? err : new Error(String(err))),
    )
      .map((value) => value)
      .toPromise() as Promise<Result<T, Error>>;
  }
}
```

**Transactional-connection caveat (IMPORTANT):** the simple `IUnitOfWork` above runs `work()` against the OUTER `db`, NOT the `tx` handle — so the two repo calls inside `work` are NOT actually in the same transaction. To make Mechanism 3 truly atomic, EITHER (a) have `transaction` build tx-scoped repo instances and pass them to `work`, OR (b) widen `IUnitOfWork.transaction` to `work(ctx) => ...` where `ctx` exposes tx-bound repos, OR (c) implement Mechanism 3 as a dedicated infra application-service that opens `db.transaction(tx => { ...tx.update(interviews)...; tx.delete(reports)... })` directly and translates errors at the boundary. **Recommended: option (c)** — least churn to the existing `IUnitOfWork` shape, keeps the atomic block in one infra method. If (c) is chosen, the use case (Step 6) calls a small `IReportInvalidationService` port instead of `uow` + two repos. Flag this decision in the explore/implement handoff; do not ship the cosmetic-only `uow` wrapper.

**Invariant check:** RepositoryError translated via `translatePgError` and never leaks past application. Atomicity is real, not cosmetic.

---

### Step 9 — Domain: repository interface additions

**File:** `packages/domain/src/entities/interview/interview.repository.ts` (MODIFY)
```typescript
findStuckInProgress(cutoff: Date): Promise<Result<ReadonlyArray<Interview>, Error>>;
```
**File:** `packages/domain/src/entities/report/report.repository.ts` (MODIFY)
```typescript
deleteByInterviewId(interviewId: InterviewId): Promise<Result<void, Error>>;
```
(`InterviewId` import already present in report.repository.ts.)

**Invariant check:** Ports live in domain; infra implements them. Done BEFORE infra so types align.

---

### Step 10 — Presentation: 409 mapping for SESSION_ALREADY_ACTIVE

**File:** `apps/backend/src/presentation/errors/http-error-mapper.ts` (MODIFY) — add to `STATUS_BY_CODE`:
```typescript
SESSION_ALREADY_ACTIVE: 409,
TRANSCRIPT_NOT_STRICTLY_BETTER: 409, // defensive; this error is swallowed to {applied:false} in the use case and should not reach HTTP
```
Per ADR-018 by-code table: a BusinessRuleViolation that signals "resource already in active state" maps to 409 Conflict (consistent with existing `INVALID_INTERVIEW_STATE_TRANSITION: 409`).

**Invariant check:** ADR-035 Enforcement / Risk — new error mapped to clean 4xx, not 500. The existing `candidate-session.controller.ts` already routes errors through `mapServiceErrorToHttp` (line 115), so no controller edit is needed for Mechanism 1 — only the map entry.

---

### Step 11 — Presentation: recruiter reconcile endpoint

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (MODIFY)
- Add to `RecruiterInterviewControllerDeps`:
  ```typescript
  readonly reconcileStuckInterviewsUseCase: UseCaseLike<
    { readonly thresholdMinutes: number },
    { readonly scanned: number; readonly completed: ReadonlyArray<string>; readonly failed: ReadonlyArray<string> }
  >;
  readonly reconcileThresholdMinutes: number;
  ```
- Add controller method:
  ```typescript
  async reconcileStuck(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // recruiter-scoped admin op; ownership not per-interview (sweep is global). requireRecruiter gate suffices.
    const result = await this.deps.reconcileStuckInterviewsUseCase.execute({
      thresholdMinutes: this.deps.reconcileThresholdMinutes,
    });
    if (result.isErr()) { sendError(reply, result.unwrapErr()); return; }
    await reply.code(200).send(result.unwrap());
  }
  ```

**File:** `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts` (MODIFY) — add route:
```typescript
app.post(
  "/interviews/reconcile-stuck",
  { preHandler: requireRecruiter },
  (req, reply) => controller.reconcileStuck(req, reply),
);
```
Place this route BEFORE the `/interviews/:id` param routes so `reconcile-stuck` is not captured as an `:id`.

**Cron wiring (NOTE only, not implemented here):** the same `ReconcileStuckInterviewsUseCase` instance can be invoked from a scheduled job (e.g. a node-cron / external scheduler hitting the endpoint, or a boot-time interval in `apps/backend/src/index.ts`). Out of scope for this tranche; the recruiter endpoint is the must-have trigger.

**Surfacing FAILED to recruiters:** `ListInterviewsByRecruiterUseCase` / `GetInterviewByIdUseCase` already return the interview's `status` field verbatim (no enum allow-list filtering found in the controller). Confirm the recruiter list/detail DTO passes `status` through unchanged — `FAILED` will surface automatically. Add a verification assertion (Step: tests) that a FAILED interview appears in `list` output with `status: "FAILED"`. If the DTO has a status enum (Zod), extend it to include `FAILED` — check `rg "FAILED|INTERVIEW_STATUS|status:" packages/application/src/dtos -n`.

**Invariant check:** Presentation imports only `@repo/application`/`@repo/domain`; error mapping at boundary.

---

### Step 12 — Composition wiring

**File:** `apps/backend/src/composition/candidate-session.composition.ts` (MODIFY) — no new deps for Mechanism 1 (guard is internal to the use case). No change required.

**File:** `apps/backend/src/composition/recruiter-interview.composition.ts` (MODIFY) — wire the reconcile use case + threshold:
```typescript
const conversational = /* build ElevenLabsConversationalService from env, as in candidate-session.composition */;
// ...
reconcileStuckInterviewsUseCase: new ReconcileStuckInterviewsUseCase(interviews, conversational),
reconcileThresholdMinutes: Number(env["RECONCILE_THRESHOLD_MINUTES"] ?? 90), // >= 2*maxDuration + 30 buffer
```
Import `ReconcileStuckInterviewsUseCase` from `@repo/application` and reuse the ElevenLabs provider builders already used by `candidate-session.composition.ts` (`conversationalClientFromEnv`, `ElevenLabsConversationalService`).

**File:** `apps/backend/src/composition/elevenlabs-webhook.composition.ts` (MODIFY — find via `rg "PersistCompletedTranscriptUseCase" apps/backend/src/composition -l`) — `PersistCompletedTranscriptUseCase` now needs `reports` + the report-invalidation service/uow. Add `new DrizzleReportRepository(db)` and the chosen atomicity mechanism (Step 8 option c -> a `DrizzleReportInvalidationService` or direct service). Update the constructor call to the new 3-arg signature.

**Invariant check:** Composition is the only place concrete infra meets use cases; rebuild caveat applies (Verification).


## Step ordering & parallelization

Strict layer order (domain -> application -> infra -> presentation -> composition). Within domain and within presentation there are disjoint file-sets that can be fanned out.

1. **Domain (do first, fan out into 2 disjoint sets):**
   - Set D1 (status + entity): Steps 1, 2, 3 — all in `interview-status.ts` + `interview.entity.ts` (same 2 files, ONE worker).
   - Set D2 (errors + repo ports): Steps 4 (errors file), 9 (both repo interfaces) — disjoint files from D1, can run in PARALLEL with D1, but D1's entity imports the Step-4 errors, so merge D2 before compiling D1. Practically: do Step 4 + Step 9 first, then Steps 1-3.
2. **REBUILD GATE 1:** `pnpm turbo run build --filter=@repo/domain` (application compiles against dist).
3. **Application (after domain dist exists):** Steps 5, 6, 7. Step 5 (start-candidate) and Step 7 (reconcile, new file) are disjoint from each other and can fan out. Step 6 (persist-completed) depends on Step 8's atomicity decision — sequence Step 6 after the Step 8 option is chosen, or stub the report-invalidation port first.
4. **REBUILD GATE 2:** `pnpm turbo run build --filter=@repo/application`.
5. **Infrastructure:** Step 8 (migration + repo methods + uow/service). Files C, D, E are disjoint and can fan out; the migration (File B) is independent.
6. **Presentation:** Steps 10, 11. Step 10 (error map) and Step 11 (controller+routes) are disjoint — fan out.
7. **Composition:** Step 12 — wire everything (single integration worker, last).
8. Run the **DB migration** (`db:migrate`) before any test that exercises FAILED status against the real test DB.

Parallelizable disjoint file-sets: {Step4, Step9} ∥ then {Step5, Step7} ∥ then {Step8-C, Step8-D, Step8-E, Step8-B} ∥ then {Step10, Step11}.

## Pseudo-workflow per mechanism

**M1 Idempotent binding:** `POST /c/:id/session?token=…` -> `CandidateSessionController.start` -> verify token -> `StartCandidateSessionUseCase.execute` -> `findById` -> if `status===IN_PROGRESS && elevenLabsSessionId.isSome()` => `Result.Err(SessionAlreadyActiveError)` (skips `issueSignedUrl`) -> controller `mapServiceErrorToHttp` => **409**. Else proceeds to issue + bind + (SCHEDULED->IN_PROGRESS) as today.

**M2 Best-transcript-wins:** post-call webhook -> `PersistCompletedTranscriptUseCase.execute` -> `findById` -> build `entries` -> if `COMPLETED`: `interview.recomplete(occurredAt, entries)`; on `TranscriptNotStrictlyBetterError` => `{applied:false}` (no write); else `save` => `{applied:true}`.

**M3 Report invalidation:** same use case, `status===EVALUATED` branch -> `recomplete` (strictly-better gate) -> `revertToCompleted()` (status COMPLETED, reportId cleared) -> `uow.transaction`/invalidation-service: `interviews.save(next)` + `reports.deleteByInterviewId(id)` atomically -> rollback on either failure -> `{applied:true}`.

**M4 Reconciliation:** `POST /interviews/reconcile-stuck` (recruiter) -> `RecruiterInterviewController.reconcileStuck` -> `ReconcileStuckInterviewsUseCase.execute({thresholdMinutes})` -> `findStuckInProgress(now - threshold)` -> per interview: no sessionId => `fail`; `getTranscript(sessionId)` err => `fail`; rows -> entries empty => `fail`; else `complete(now, entries)` + `save` => completed. Returns `{scanned, completed[], failed[]}` => 200.

**M5 FAILED terminal:** reached via M4 `failInterview` -> `interview.fail(reason)` (IN_PROGRESS->FAILED, reason as AgentNote) -> `save`. Recruiters see `status:"FAILED"` in `list`/`get`.

## Entry points

Innermost-first, in dependency order:

| #  | File | Layer | Op | Purpose |
|----|------|-------|----|---------|
| 1  | `packages/domain/src/entities/interview/errors/interview.errors.ts` | @repo/domain | MODIFY | Add `SessionAlreadyActiveError`, `TranscriptNotStrictlyBetterError` |
| 2  | `packages/domain/src/entities/interview/interview.repository.ts` | @repo/domain | MODIFY | Add `findStuckInProgress(cutoff)` |
| 3  | `packages/domain/src/entities/report/report.repository.ts` | @repo/domain | MODIFY | Add `deleteByInterviewId(interviewId)` |
| 4  | `packages/domain/src/entities/interview/interview-status.ts` | @repo/domain | MODIFY | Add `FAILED` + `IN_PROGRESS->FAILED` |
| 5  | `packages/domain/src/entities/interview/interview.entity.ts` | @repo/domain | MODIFY | Add `recomplete`, `revertToCompleted`, `fail`; import new errors; `countNonEmpty` helper |
| 6  | `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` | @repo/application | MODIFY | M1 idempotent guard |
| 7  | `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` | @repo/application | MODIFY | M2 + M3; inject reports + uow/invalidation-service |
| 8  | `packages/application/src/use-cases/interview/reconcile-stuck-interviews.use-case.ts` | @repo/application | CREATE | M4 use case |
| 9  | `packages/application/src/index.ts` | @repo/application | MODIFY | Export reconcile use case + IO types |
| 10 | `apps/backend/drizzle/0004_*.sql` | infra | CREATE | FAILED status migration |
| 11 | `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts` | infra | MODIFY | `findStuckInProgress` impl |
| 12 | `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts` | infra | MODIFY | `deleteByInterviewId` impl |
| 13 | `apps/backend/src/infrastructure/persistence/drizzle-unit-of-work.ts` (or report-invalidation service) | infra | CREATE | M3 atomic boundary |
| 14 | `apps/backend/src/presentation/errors/http-error-mapper.ts` | presentation | MODIFY | `SESSION_ALREADY_ACTIVE: 409` |
| 15 | `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` | presentation | MODIFY | `reconcileStuck` method + deps |
| 16 | `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts` | presentation | MODIFY | `POST /interviews/reconcile-stuck` |
| 17 | `apps/backend/src/composition/recruiter-interview.composition.ts` | composition | MODIFY | wire reconcile use case + threshold |
| 18 | `apps/backend/src/composition/elevenlabs-webhook.composition.ts` | composition | MODIFY | wire reports + invalidation into PersistCompletedTranscript |

NOTE: getTranscript on the port/adapter already exists — NO file change there.

## Tests required (Rule 6)

**Domain unit (no mocks) — `packages/domain`:**
- `interview-status.test.ts`: `canTransition(IN_PROGRESS, FAILED)===true`; `isTerminal(FAILED)===true`; `canTransition(COMPLETED, FAILED)===false`; `canTransition(EVALUATED, FAILED)===false`.
- `interview.entity.test.ts`:
  - `recomplete`: strictly-better incoming replaces transcript + status COMPLETED; equal count => `TranscriptNotStrictlyBetterError`; shorter => error; empty incoming vs non-empty stored => error.
  - `revertToCompleted`: from EVALUATED => COMPLETED with `reportId.isNone()===true` (locks the `withChanges` reportId-clear behaviour); from non-EVALUATED => `InvalidInterviewStateTransitionError`.
  - `fail`: from IN_PROGRESS => FAILED + AgentNote appended with reason; from SCHEDULED/COMPLETED/EVALUATED => error.
  - serialize/fromSerialized round-trip with `status:"FAILED"`.

**Application integration (mock repos + port) — `packages/application`:**
- `start-candidate-session.use-case.test.ts`: IN_PROGRESS + bound id => `SessionAlreadyActiveError`, `issueSignedUrl` NOT called (assert mock not invoked); IN_PROGRESS + no bound id => proceeds; SCHEDULED => proceeds + transitions.
- `persist-completed-transcript.use-case.test.ts`: COMPLETED + strictly-better => `applied:true` + save called; COMPLETED + equal/shorter => `applied:false` + save NOT called; EVALUATED + better => `revertToCompleted` + `reports.deleteByInterviewId` called inside one transaction (assert both, assert rollback when delete fails via `uow`/service mock); IN_PROGRESS first completion unchanged.
- `reconcile-stuck-interviews.use-case.test.ts`: stuck with good transcript => completed; stuck with no sessionId => failed; `getTranscript` error => failed; empty transcript => failed; `findStuckInProgress` returns `[]` => `{scanned:0}`; cutoff computed from `now - threshold`.

**Infrastructure — `apps/backend` (test DB):**
- `drizzle-interview.repository.test.ts`: `findStuckInProgress` returns only IN_PROGRESS with `startedAt < cutoff`; excludes recent/other statuses; FAILED row round-trips (migration applied).
- `drizzle-report.repository.test.ts`: `deleteByInterviewId` removes the row; idempotent on missing.
- atomicity test: report-invalidation rolls back interview save when report delete throws (failure injected between the two ops).
- (presentation) recruiter route test: `POST /interviews/reconcile-stuck` returns 200 with summary; candidate session returns 409 for `SESSION_ALREADY_ACTIVE`; FAILED interview appears in `GET /interviews` with `status:"FAILED"`.

## Verification checklist

Run in order AFTER all edits (never mid-session):

1. **Rebuild domain + application (REBUILD CAVEAT — backend runs from dist/, tsx watch ignores dist):**
   ```bash
   pnpm turbo run build --filter=@repo/domain --filter=@repo/application
   ```
2. **Type-check all three:**
   ```bash
   pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
   ```
3. **Apply migration to the (test) DB before backend tests touching FAILED:**
   ```bash
   pnpm --filter backend db:generate   # if schema-driven; else hand-author 0004_*.sql
   pnpm --filter backend db:migrate
   ```
4. **Tests, narrowest-first:**
   ```bash
   pnpm turbo run test --filter=@repo/domain
   pnpm turbo run test --filter=@repo/application
   pnpm turbo run test --filter=backend
   ```
5. **Arch validators per layer** (`/backend-arch-validator domain|application|infrastructure|presentation`).
6. **Restart the backend** (it runs from `dist/`): after the domain/application rebuild, restart so `apps/backend` picks up the new dist. `apps/backend/src` changes are picked up by tsx watch automatically; `@repo/*` changes are NOT.
7. **ADR judge:** ADR-035 has `llm_judge: true`; the pre-commit hook will evaluate Enforcement #1–#4 against the diff. Ensure: no unconditional `issueSignedUrl`, no COMPLETED/EVALUATED short-circuit without comparison, `FAILED` present in status map, `recomplete` keeps the strictly-better precondition.

## Risk notes

- **getTranscript already present** — do NOT re-add it (the task brief was stale). Re-adding would create a duplicate-member compile error.
- **Atomicity is the highest-risk item.** The existing `IUnitOfWork.transaction(work)` runs `work` against the outer `db`, so naively wrapping two repo calls is NOT atomic. Use option (c) in Step 8: a dedicated infra method/service that runs both writes inside one `db.transaction(tx => …)`. Test with an injected failure between the two ops asserting rollback (ADR-035 Risk mitigation requires this exact test).
- **`withChanges` reportId clear:** relies on `Option.None ?? this.reportId === Option.None`. True because `??` only short-circuits on null/undefined and `Option.None` is an object — but lock it with a unit test (Step 3 / tests).
- **Route ordering:** register `/interviews/reconcile-stuck` BEFORE `/interviews/:id` or Fastify may match it as an id. Verify with a route test.
- **Reconcile threshold:** must be anchored to `startedAt` vs `now - threshold` (NOT wall clock alone) and generous (>= 2*maxDurationMinutes + 30min buffer + 30min HMAC window per ADR-035 Risks) to avoid sweeping live mid-session interviews.
- **Migration style:** `status` is plain `text` today (no enum/check). Adding `FAILED` strictly needs no DB change for writes to succeed; the CHECK constraint in 0004 is defensive integrity per ADR-035's "enum/check" intent. If the team uses `db:generate` exclusively, drive the constraint from a schema annotation rather than hand-authoring, to keep `meta/_journal.json` consistent.
- **DTO status enum:** if the recruiter list/detail DTO (`packages/application/src/dtos`) constrains `status` with a Zod enum, it MUST be extended to include `FAILED`, else FAILED rows fail response validation. Confirm with `rg "status" packages/application/src/dtos -n` during implementation.
- **PersistCompletedTranscript constructor signature change** ripples to `elevenlabs-webhook.composition.ts` and its existing tests — update both.
