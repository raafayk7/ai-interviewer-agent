# Phase 10 Session Integrity Backend Progress

## Phase 10 Session Integrity Backend Complete

This document records the Phase 10 Session Integrity Backend changes for ai-interviewer-agent.

Phase 10 Session Integrity Backend goal:

- Prevent page reloads from minting a second ElevenLabs conversation for an already-active interview
- Replace first-writer-wins post-call completion with best-transcript-wins semantics
- Atomically invalidate stale reports when a better transcript arrives after evaluation
- Add reconciliation for interviews stuck IN_PROGRESS past a threshold
- Add a recruiter-visible FAILED terminal state for unrecoverable ElevenLabs sessions

Plan source: `.claude/plan/phase-10-session-integrity-backend.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-035](../adr/ADR-035-elevenlabs-session-integrity-idempotent-binding-best-transcript-wins-reconciliation-failed-state.md) — idempotent binding, best-transcript-wins, reconciliation, and FAILED state for ElevenLabs sessions

---

## Summary

Completed:

- **Domain:** Added `FAILED` to `INTERVIEW_STATUS`, made it terminal, and allowed only `IN_PROGRESS -> FAILED`. Added `SessionAlreadyActiveError`, `TranscriptNotStrictlyBetterError`, `Interview.recomplete()`, `Interview.revertToCompleted()`, and `Interview.fail(reason)`, plus repository port methods `findStuckInProgress(cutoff)` and `deleteByInterviewId(interviewId)`.
- **Application:** Added the `StartCandidateSessionUseCase` active-session guard before `issueSignedUrl`, updated `PersistCompletedTranscriptUseCase` to compare transcript quality for COMPLETED/EVALUATED interviews, introduced `IInterviewReportInvalidationService` for true atomic invalidation, and added `ReconcileStuckInterviewsUseCase`.
- **Infrastructure:** Added migration `0004_session_integrity_failed_status.sql`, implemented `DrizzleInterviewRepository.findStuckInProgress()`, `DrizzleReportRepository.deleteByInterviewId()`, and `DrizzleInterviewReportInvalidationService.invalidateStaleReport()` using one Drizzle `db.transaction(tx => ...)`.
- **Presentation and composition:** Added `SESSION_ALREADY_ACTIVE` and `TRANSCRIPT_NOT_STRICTLY_BETTER` 409 mappings, added recruiter `POST /interviews/reconcile-stuck` before parameterized interview routes, and wired reconciliation plus report invalidation into backend composition.
- **Tests:** Added/updated domain, application, repository, controller, and error-mapper tests for FAILED status, strict transcript replacement, active-session refusal, report invalidation, and reconciliation outcomes.

Explicitly **not** included in this work:

- Frontend reload guard, modal UX, transcript scroll changes, or candidate-session handling for the new 409 response
- Scheduled cron/worker execution for reconciliation; this phase exposes the recruiter-triggered backend endpoint
- Live smoke testing against real ElevenLabs provider APIs
- Accepting or committing ADR-035; it remains the referenced source of truth for this implementation

---

## Implementation Notes

The report invalidation path deliberately uses a dedicated application port instead of the existing `IUnitOfWork.transaction(work)` shape. The existing unit-of-work callback cannot provide tx-bound repositories to the work function, so wrapping `interviews.save()` and `reports.deleteByInterviewId()` would look transactional without sharing the transaction handle. `DrizzleInterviewReportInvalidationService` writes the updated interview row and deletes stale reports inside one Drizzle transaction.

The EVALUATED branch in `PersistCompletedTranscriptUseCase` reverts first and then calls `recomplete()`. Calling `recomplete()` first already lands the aggregate in COMPLETED, so a later `revertToCompleted()` correctly rejects; the final ordering clears `reportId` before installing the better transcript and handing the aggregate to the atomic invalidation port.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run build --filter=@repo/domain --filter=@repo/application
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm --filter @repo/application test -- --run src/use-cases/interview/persist-completed-transcript.use-case.test.ts src/use-cases/interview/start-candidate-session.use-case.test.ts src/use-cases/interview/reconcile-stuck-interviews.use-case.test.ts
pnpm turbo run test --filter=backend
```

Results:

- domain tests: **159 passed**
- application Phase 10 targeted tests: **36 passed**
- backend tests: **317 passed**
- type-check passed for `@repo/domain`, `@repo/application`, and `backend`
- build passed for `@repo/domain` and `@repo/application`

Full application suite note:

```bash
pnpm turbo run test --filter=@repo/application
```

Result: **181 passed**, **1 pre-existing failure** in `src/dtos/create-interview.dto.test.ts` (`jdFileRef.uploadedAt is not a Date`). This same unrelated failure was recorded in earlier Phase 9/9.5 progress notes.

Architecture checks:

- `backend-arch-validator` manual audit over modified production files: **CLEAN**
- No forbidden domain/application/infrastructure/presentation imports were found in modified production files
- No new `throw`/`try`/`catch` paths were introduced in modified domain, application, or infrastructure production files
- Infrastructure `Result.tryAsyncCatch(...).toPromise()` chains terminate correctly in modified repository/invalidation service methods

---

## Code Review

Implementation was split across three subagents with disjoint ownership: domain, application, and backend integration. Domain, application, and backend workers each reported clean scoped verification. Integration review found one EVALUATED-path ordering issue in `PersistCompletedTranscriptUseCase`: the first implementation called `recomplete()` before `revertToCompleted()`, causing the revert to reject because the aggregate was already COMPLETED. Fixed by reverting first, then applying `recomplete()` to the reverted aggregate.

Second-pass verification after the fix:
- targeted application Phase 10 tests: **36 passed**
- full backend tests: **317 passed**
- full domain tests: **159 passed**
- cross-package type-check: **passed**

**PASS**.

### Formal `backend-code-reviewer` gate (2026-06-13)

The mandated `backend-code-reviewer` agent gate caught one blocking gap the in-session reviews missed: `DrizzleInterviewReportInvalidationService.invalidateStaleReport` — the load-bearing atomicity guarantee for Mechanism 3 — had no test, while ADR-035's Risks section mandates a failure-injection rollback test. Remediation: added `apps/backend/src/infrastructure/persistence/drizzle-interview-report-invalidation.service.test.ts` (integration, live test DB) with two cases — (1) commit path: interview → COMPLETED with `reportId` cleared, the strictly-better transcript installed, and the stale report deleted; (2) rollback path: a `db.transaction` proxy lets the interview upsert run on the real transaction, then throws on `tx.delete`, and the test asserts the interview row retains its pre-call EVALUATED state + `reportId` + 2-entry transcript and the report row survives (genuine partial-execution rollback, the proof ADR-035 demands).

With the test Postgres container up (`apps/backend/docker-compose.test.yml`, port 54329; migrations applied incl. `0004`), re-verification: full backend suite **319 passed** (was 317; +2), cross-package type-check clean, new file lint-clean. Re-review returned **PASS**.

---

## Notes

The reconciliation endpoint uses `RECONCILE_THRESHOLD_MINUTES`, defaulting to `90`, and compares `startedAt` against `now - thresholdMinutes`. Production scheduling can call the same `ReconcileStuckInterviewsUseCase` later without changing the domain/application contract.

The defensive DB CHECK constraint was added even though `interviews.status` is currently a `text` column typed at the Drizzle/TypeScript boundary. This turns the new `FAILED` state into a persistence-level invariant without converting the column to a Postgres enum.
