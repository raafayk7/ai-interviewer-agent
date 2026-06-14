# ADR-035 ElevenLabs Interview Session Integrity: Idempotent Binding, Best-Transcript-Wins, Reconciliation, and a FAILED Terminal State

## Status

Accepted. Date: 2026-06-13.

Extends and partially supersedes ADR-034 (two specific semantics change: "first arriving webhook binds" and "first-writer-wins completion"; the rest of ADR-034 stands).

## Context

In 2026-06, a production-like interview was silently corrupted by a candidate page-reload near the end of the session. The failure exposed three independent gaps in the lifecycle design established by ADR-034.

**Gap 1: Unconditional re-issuance and rebind.** `StartCandidateSessionUseCase.execute()` calls `agent.issueSignedUrl()` and then `interview.bindElevenLabsSession(conversationId)` on every invocation, regardless of whether the interview already holds a bound `elevenLabsSessionId` and is IN_PROGRESS (`packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:80-90`). A page-reload during an active interview therefore mints a fresh, empty ElevenLabs conversation and overwrites the binding. Because ElevenLabs conversations are stateful per `conversation_id` (a new conversation has no memory of the previous one), this is not a reconnect — it is an amnesiac duplicate.

ADR-034 describes the IN_PROGRESS re-entry path as "a no-op for the lifecycle transition but updates the bound `elevenLabsSessionId`." That sentence is accurate — but that update is the bug: it replaces the binding to the real, in-progress conversation with a binding to the empty duplicate.

**Gap 2: First-writer-wins completion.** `PersistCompletedTranscriptUseCase` treats any interview in COMPLETED or EVALUATED status as already-done and returns `{ applied: false }` immediately (`packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts:65-69`). The post-call webhook is at-least-once and unordered. Because both conversations share the `interview_id` dynamic variable (injected at session start via `Conversation.startSession({ dynamicVariables: { interview_id } })`), their post-call webhooks both resolve to the same interview record. The empty conversation's post-call webhook completed the interview first; the real 15-turn conversation's webhook arrived second and was silently discarded.

**Gap 3: No failure terminus in the state machine.** `packages/domain/src/entities/interview/interview-status.ts` defines six statuses: CREATED, SCHEDULED, IN_PROGRESS, COMPLETED, EVALUATED, CANCELLED. There is no terminal state for an unrecoverable interview — one whose session ended without a transcript being delivered (ElevenLabs delivery failure, provider failure such as "All LLMs have failed", or a session abandoned before any content was recorded). Such interviews remain stuck IN_PROGRESS indefinitely. ADR-034 acknowledged this gap: "A reconciliation sweep (Phase 10, carried forward from ADR-031) will identify interviews stuck IN_PROGRESS beyond `maxDurationMinutes + graceBuffer`." That sweep and its terminus are what this ADR defines.

The incident required manual repair: re-bind `elevenLabsSessionId` to the real conversation id, restore the 15-turn transcript, delete the evaluation report generated from the empty transcript, and revert EVALUATED to COMPLETED so evaluation can re-run.

This ADR defines five coupled mechanisms that make such an incident self-healing going forward. It extends ADR-034's lifecycle model; all other ADR-034 decisions — per-tool URL routing, scoped HMAC, `end_call` in transcript walk, span hierarchy — remain in full effect.

## Decision

Implement five coupled mechanisms that together protect interview session integrity in the ElevenLabs path.

**Mechanism 1: Idempotent session binding in `StartCandidateSessionUseCase`.**

`StartCandidateSessionUseCase` refuses to mint a second ElevenLabs conversation when the interview already has a bound `elevenLabsSessionId` AND is IN_PROGRESS. It returns a distinct typed output signal — `SessionAlreadyActiveOutput` (or a typed error variant such as `SessionAlreadyActiveError`) — that the presentation layer maps to an HTTP status code the frontend uses to show "interview already in progress or finished" instead of starting a competing conversation.

Re-issuance is allowed only when no binding exists yet (the first-connect attempt failed before any conversation was bound). This preserves retry behaviour for transient first-connect failures and for the React StrictMode double-mount, which unmounts and remounts immediately without any user content having been generated. The distinguishing condition is: `elevenLabsSessionId.isNone()`. An interview that is SCHEDULED (never connected) or IN_PROGRESS with no bound session id may re-issue. An interview that is IN_PROGRESS with a bound session id may not.

The existing entity method `bindElevenLabsSession` (`packages/domain/src/entities/interview/interview.entity.ts:178-197`) already performs no-op rebind when the same id is passed; the new guard operates one level above, in the use case, to prevent `issueSignedUrl` from being called at all.

**Mechanism 2: Best-transcript-wins on post-call completion in `PersistCompletedTranscriptUseCase`.**

`PersistCompletedTranscriptUseCase` stops being first-writer-wins. When a post-call webhook arrives for an interview that is already COMPLETED, the use case compares the incoming transcript's non-empty entry count against the stored transcript's count. The incoming transcript replaces the stored one only if it is strictly better: `incomingNonEmptyEntries > storedNonEmptyEntries`. A transcript that is empty or shorter than what is already stored is discarded as a no-op (`applied: false`).

"Non-empty entries" means transcript entries whose `message` is non-null and non-empty after trimming, matching the filter already present at lines 92-96 of the use case.

This requires a new domain affordance: an entity method such as `recomplete(at, transcript)` that accepts a re-completion when the incoming transcript is strictly better, bypassing the `IN_PROGRESS` precondition check of the existing `complete()` method. The new method is guarded by the same comparison. The use case calls the new method and saves the updated aggregate.

**Mechanism 3: Report invalidation when a late better transcript arrives.**

If a strictly-better transcript arrives after an interview has been EVALUATED (status is EVALUATED), the use case reverts the interview to COMPLETED (clearing `reportId`) and deletes or invalidates the stale evaluation report, so that evaluation re-runs against the correct transcript. The state revert and report deletion must be executed atomically within a single database transaction. The `PersistCompletedTranscriptUseCase` either coordinates this itself via a unit-of-work pattern or delegates to a transactional application service. The specific transaction boundary is an implementation detail; what is non-negotiable is that the two operations (status revert and report deletion) cannot be split across separate commits.

**Mechanism 4: Reconciliation sweep for stuck IN_PROGRESS interviews.**

A recovery job — executable as a scheduled cron task and/or a recruiter-triggered HTTP endpoint — finds interviews stuck IN_PROGRESS past a configurable threshold (for example: `maxDurationMinutes + graceBuffer`, where `graceBuffer` is at least 30 minutes to allow generous post-call webhook delivery). For each stuck interview, the job:

1. Calls the ElevenLabs REST API using the stored `elevenLabsSessionId` to retrieve the conversation's transcript.
2. If the transcript is retrievable and non-empty, applies Mechanism 2 (best-transcript-wins re-completion) and marks COMPLETED.
3. If the transcript is not retrievable, or `elevenLabsSessionId` is null, or the ElevenLabs API returns an error that confirms the conversation is unrecoverable (provider failure, no such conversation), marks the interview FAILED (Mechanism 5).

The `IConversationalAgentService` port already exposes a `getTranscript(conversationId)` capability (`packages/application/src/ports/conversational-agent/conversational-agent.port.ts:40`, implemented at `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts:64`); reconciliation reuses it as-is. The phase 9.5 revision stopped the post-call path from *calling* `getTranscript` (the transcript now arrives inline in the post-call webhook payload), but the capability itself remained on the port.

**Mechanism 5: FAILED terminal state in the interview state machine.**

Extend `packages/domain/src/entities/interview/interview-status.ts` with a new status: `FAILED`. FAILED is terminal (`ALLOWED[FAILED] = []`). Allowed transitions into FAILED:

- `IN_PROGRESS -> FAILED` (reconciliation sweep, graceful LLM failure at conversation end).
- Optionally `SCHEDULED -> FAILED` (provisioning-time failure, not required in Phase 10 Tranche-A).

FAILED interviews receive no evaluation. No report is generated. Recruiters can see the FAILED status in the interview list and act on it (manual re-schedule or investigation). FAILED is the durable record of "this interview cannot be recovered automatically."

A new entity method `fail(reason: string)` transitions the interview and records the failure reason as an `AgentNote` so the reason is preserved in the aggregate without requiring a separate column.

## Alternatives Considered

### Alternative A: Frontend-only reload-guard

Prevent the re-issuance by detecting, on the frontend, that the interview is already bound or completed and not calling the `startSession` endpoint on page-reload.

Rejected as the sole fix. The frontend is untrusted; a determined reload, a multi-tab session, or a network race can still reach the backend. A frontend guard is valuable as defense-in-depth and as the cheap trigger-killer (it eliminates the happy-path reload from ever hitting the backend), but it is insufficient for data integrity. The backend must be the authority on whether a second conversation may be minted.

### Alternative B: First-bind-wins (permanently refuse any re-issuance once bound)

Once an interview has a bound `elevenLabsSessionId`, refuse all re-issuance unconditionally, regardless of the interview's status or how recently the binding was established.

Rejected as too strict. A legitimate instantaneous first-connect failure (transient ElevenLabs error, network glitch before the WebSocket opens, React StrictMode double-mount) needs a retry before any real content has been produced. Under first-bind-wins, the interview would be permanently un-startable after such a failure unless a human reset the binding. The chosen rule is narrower: re-issuance is blocked only when the interview is IN_PROGRESS with a non-null `elevenLabsSessionId`, meaning at least one connection with substantive content has taken place.

### Alternative C: Keep first-writer-wins and rely solely on the frontend guard (Alternative A)

Accept that the first post-call webhook wins and prevent the scenario entirely at the browser by not starting a second conversation.

Rejected. Webhooks are at-least-once and unordered. Even with a frontend guard in place, a network partition followed by delivery retry, a subtle timing race between two requests from a fast double-reload, or a future code path that calls `StartCandidateSession` from a non-browser surface can still produce two competing conversations. Best-transcript-wins is the only ordering-independent backstop that protects the transcript regardless of which webhook arrives first.

### Alternative D: Per-turn transcript persistence during the session (mirror ADR-013's sandwich path)

Mirror the sandwich path (ADR-013 D4 per-turn persistence) by forwarding each turn to the backend as it occurs, so the transcript is durable throughout the interview and not only at post-call.

Rejected. In the ElevenLabs browser SDK path there is no backend turn loop. The transcript exists atomically only at post-call (webhook) or via the ElevenLabs REST API. The browser SDK exposes turn events client-side, but routing them to the backend during every session adds a second live data channel, creates a new failure surface, and builds a partial transcript that is incomplete until the post-call arrives. Reconciliation (Mechanism 4) is the equivalent safety net: it re-pulls the authoritative transcript from ElevenLabs when the normal post-call path fails.

### Alternative E: Do nothing and continue manual repair

Accept that corrupted interviews require manual intervention: re-binding `elevenLabsSessionId`, restoring the transcript, deleting the stale report, and reverting status.

Rejected. Silent corruption of the primary deliverable (transcript and evaluation report) is disqualifying for real candidate interviews. Manual repair requires someone to notice the corruption — which did not happen automatically during the incident described in Context. The repair procedure is also error-prone and not encoded anywhere. At scale (many concurrent interviews), this approach does not hold.

### Alternative F: Treat CANCELLED as the unrecoverable terminus instead of adding FAILED

Route unrecoverable interviews to the existing CANCELLED status rather than adding a new FAILED state.

Rejected. CANCELLED has an existing semantics: a recruiter or system deliberately cancelled an interview that was in progress. Conflating "cancelled by choice" with "failed due to a provider error or unrecoverable network condition" destroys the distinction needed for recruiter-facing reporting and for future automated recovery logic. FAILED must be a separate, unambiguous state.

### Alternative G: Accept status quo in the domain and handle best-transcript-wins only in the database layer

Implement the transcript-replacement check as a database-level conditional upsert (for example, a Postgres `UPDATE ... WHERE transcript_entry_count < incoming_count`) rather than a domain entity method.

Rejected. The `Interview` aggregate owns its transcript as a domain invariant. Bypassing the entity and writing directly to the database violates the Clean Architecture boundary (ADR-001): infrastructure would contain business logic. A domain `recomplete()` method places the comparison and the invariant where they belong.

## Consequences

**Benefits**

- The authoritative transcript is protected regardless of webhook arrival order or page-reload behaviour. An empty or shorter duplicate transcript cannot overwrite a richer stored transcript.
- Page-reloads during an active interview no longer mint competing conversations. The backend refuses the second issuance and returns a typed signal the frontend can use for a clear UX message.
- Stuck interviews self-heal via reconciliation: a job re-pulls the transcript from ElevenLabs and completes or fails the interview without human intervention.
- Failed interviews receive a visible terminal state (FAILED) instead of being stuck IN_PROGRESS indefinitely. Recruiters can see the status and act.
- Stale evaluation reports generated from a shorter transcript are invalidated automatically when a better transcript arrives, ensuring evaluation always runs against the best available evidence.
- The binding idempotency guard is localised to a single use case entry point, not scattered across webhooks or the entity.

**Trade-offs**

- The domain state machine gains complexity: a new FAILED status, a new `recomplete()` transition, and a new `fail()` transition. Each adds a path through the entity's `withChanges` helper and a serialisation/deserialisation case.
- "Strictly better" is measured by non-empty entry count. This is unambiguous for the empty-versus-real case that caused the incident. In the rare scenario where two legitimately different transcripts of similar length compete (for example, two near-simultaneous retransmits), the longer one wins. This heuristic may occasionally be wrong; a future refinement could use transcript metadata (`call_duration_secs`, `end_reason`) as a tiebreaker.
- Reconciliation reuses the existing `getTranscript` capability on `IConversationalAgentService` (the post-call webhook path stopped calling it in phase 9.5 but the port method remained). No new port surface is required; the post-call webhook path is unaffected.
- Report invalidation and status revert require a transaction. The existing repository pattern uses single-aggregate saves; a cross-aggregate transaction (interview + report deletion) requires either a unit-of-work or an application service that coordinates two repository operations inside one database transaction.
- The `SessionAlreadyActiveOutput` / `SessionAlreadyActiveError` signal is new output from `StartCandidateSessionUseCase`. The presentation layer and the frontend must handle this new case explicitly (map to an appropriate HTTP status and display an appropriate message).

**Risks and mitigations**

- *Risk*: Two strictly-better transcripts arrive concurrently for the same interview (for example, ElevenLabs retransmits the post-call webhook twice in rapid succession and both see `applied: false` on entry). *Mitigation*: The `recomplete()` path reads the current stored entry count at the start of the use case invocation (inside the same repository `findById` call). The comparison is deterministic: the last invocation to complete its `save` call wins. Because both transcripts carry the same source data (same conversation), both would write identical content; there is no correctness risk, only a spurious second write.
- *Risk*: Reconciliation sweeps an interview whose candidate is mid-session (the interview is legitimately IN_PROGRESS and the candidate is still talking). *Mitigation*: The threshold must be generous: at minimum `maxDurationMinutes` (from ADR-006) plus a 30-minute buffer plus the HMAC tolerance window (30 minutes per ADR-034). In practice, no interview should still be IN_PROGRESS after `2 * maxDurationMinutes`. The reconciliation job must check the interview's `startedAt` against the threshold, not the current wall clock alone.
- *Risk*: The `fail()` transition is called on an interview that a recruiter has already manually re-scheduled or that is in an unexpected state. *Mitigation*: `fail()` only transitions from IN_PROGRESS; calls from any other status return `InvalidInterviewStateTransitionError` via the standard `InterviewStatusPolicy.canTransition` gate.
- *Risk*: The atomicity requirement for report invalidation (Mechanism 3) is not implemented — the report is deleted but the status is not reverted, or vice versa. *Mitigation*: The two operations must be enclosed in a single database transaction. The application service or unit-of-work that coordinates them must be tested with a failure injected between the two operations; the test asserts that partial execution is rolled back.
- *Risk*: The new `SessionAlreadyActiveError` / `SessionAlreadyActiveOutput` path is added to the use case but not mapped in the HTTP controller, causing a 500 instead of a clean 4xx. *Mitigation*: ADR-018's exhaustive error-mapping table must be extended to include the new error kind before the use case change ships. The Enforcement block below flags unhandled use-case return variants in the controller.

## Related Decisions

- **ADR-034 (ElevenLabs Lifecycle: Two Inbound Webhook Surfaces with Scoped HMAC, Per-Tool URLs, and Post-Call End-Reason Recovery)**: This ADR extends ADR-034. Two specific semantics change: (a) the IN_PROGRESS rebind path in `StartCandidateSession` is no longer unconditional (Mechanism 1 above supersedes the "updates the bound `elevenLabsSessionId`" clause in ADR-034's Idempotency section); (b) `PersistCompletedTranscriptUseCase` is no longer first-writer-wins on COMPLETED or EVALUATED (Mechanism 2 above supersedes ADR-034's "a duplicate post-call on a COMPLETED interview is a no-op" clause). All other ADR-034 decisions remain in full effect: per-tool URL routing, scoped HMAC, `end_call` handled in transcript walk, span hierarchy, tool correlation by `interview_id`.
- **ADR-033 (ElevenLabs Static Agent: Server-Built Overrides via Browser SDK — owns SCHEDULED to IN_PROGRESS transition)**: Mechanism 1 adds a precondition check before `issueSignedUrl` in the same use case that ADR-033 governs. The SCHEDULED to IN_PROGRESS transition path is unaffected; it still fires only from SCHEDULED status.
- **ADR-031 (Superseded by ADR-034)**: Mentioned for historical context. ADR-034 superseded ADR-031 in full; this ADR extends ADR-034.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: Alternative D explains why the ADR-013 per-turn persistence pattern cannot be directly applied to the ElevenLabs path. ADR-013's sandwich-path orchestration is unaffected.
- **ADR-006 (Interview Duration Is a Soft Target with a Hard Ceiling)**: The reconciliation sweep threshold is anchored to `maxDurationMinutes` from ADR-006. The FAILED terminal state (Mechanism 5) complements ADR-006's hard ceiling: a session that exceeds the ceiling and ends without a usable transcript can be marked FAILED by the reconciliation job.
- **ADR-001 (Clean Architecture, DDD, Immutable Entities, Result/Option)**: Mechanism 2's `recomplete()` entity method and Mechanism 5's `fail()` entity method follow the ADR-001 pattern: immutable entity, `Result<Interview, DomainError>` return, domain policy enforced inside the entity. Alternative G explains why the comparison logic cannot live in the infrastructure layer.
- **ADR-018 (HTTP Error Mapping by Error Code String)**: The `SessionAlreadyActiveError` introduced by Mechanism 1 must be added to ADR-018's exhaustive HTTP status table before the use case change ships.

## References

- `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:80-90` — unconditional `issueSignedUrl` call and `bindElevenLabsSession` call that permit re-issuance on every invocation.
- `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts:65-69` — first-writer-wins guard: returns `{ applied: false }` immediately if status is COMPLETED or EVALUATED.
- `packages/domain/src/entities/interview/interview-status.ts:1-28` — current state machine (no FAILED status; EVALUATED and CANCELLED are the only terminals).
- `packages/domain/src/entities/interview/interview.entity.ts:178-197` — `bindElevenLabsSession` entity method (performs no-op rebind if same id; does not guard against re-issuance at use-case level).
- `packages/domain/src/entities/interview/interview.entity.ts:134-155` — `start()` and `complete()` transition methods (the `recomplete()` method added by this ADR will live in this region).
- ADR-034 Idempotency section (the two clauses superseded by this ADR): `docs/adr/ADR-034-elevenlabs-lifecycle-two-webhooks-per-tool-urls-scoped-hmac.md`.
- ADR-034 Risks section (last bullet): "Risk: The post-call webhook never arrives ... A reconciliation sweep (Phase 10, carried forward from ADR-031) will identify interviews stuck IN_PROGRESS beyond `maxDurationMinutes + graceBuffer`." This ADR realises that carry-forward item.
- Phase 9.5 progress document (2026-06 manual repair section): `docs/progress/phase-9-5-revision.md`.

## Enforcement

The semantics changes in this ADR (idempotent binding and best-transcript-wins) are not mechanically expressible as regex: a regex cannot distinguish between "unconditional rebind reintroduced" and a legitimate `bindElevenLabsSession` call in a new code path, nor can it detect whether a `return Result.Ok({ applied: false })` early-exit is the old first-writer-wins guard or a new intentional no-op. The LLM judge is the appropriate enforcement mechanism.

```json
{
  "forbid_pattern": [],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

The LLM judge checks that:

1. `StartCandidateSessionUseCase` does not call `agent.issueSignedUrl()` unconditionally when the interview is IN_PROGRESS with a non-null `elevenLabsSessionId`. Any diff that reintroduces the unconditional call path (removing or bypassing the guard added by this ADR) is a violation.
2. `PersistCompletedTranscriptUseCase` does not short-circuit on COMPLETED or EVALUATED status without performing a transcript length comparison. A diff that restores the original early-return without the comparison is a violation.
3. The `INTERVIEW_STATUS` object and `ALLOWED` transition map in `interview-status.ts` include `FAILED` as a terminal state once this ADR is implemented. A diff that removes `FAILED` from either without a superseding ADR is a violation.
4. Any new domain entity method that performs a re-completion (`recomplete`, `reopen`, or equivalent) includes a precondition that the incoming transcript is strictly better than the stored one. A diff that removes this precondition is a violation.
