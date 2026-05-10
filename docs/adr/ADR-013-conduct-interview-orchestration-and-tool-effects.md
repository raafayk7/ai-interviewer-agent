# ADR-013 Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface

## Status

Proposed. Date: 2026-05-10.

## Context

Phase 5 replaces the Phase 4 scripted driver with a real Gemini interviewer agent. The voice pipeline sandwich (STT → LLM → TTS) established in ADR-002 is now driven by an AI SDK `streamText` call with Gemini as the provider. Several design decisions arise at the junction of the application layer and the infrastructure adapter that are not covered by any existing ADR:

1. **What tools does the agent get?** ARCHITECTURE.md §5.1 names four tools by intent (`next_question`, `score_answer`, `take_note`, `end_interview`), but does not specify input schemas, score ranges, or what happens if the model emits invalid tool input.

2. **Where do notes and internal scores live?** The agent emits `take_note` and `score_answer` tool calls mid-session. Phase 6's evaluator needs these records alongside the transcript. They could live in sidecar tables, in memory until session end, or as JSONB columns on the `Interview` aggregate following the existing `transcript` pattern from ADR-007.

3. **How does the agent learn how much time is left?** The agent has no real-time clock. It must receive elapsed-time signals from the use case. The injection mechanism (timer-based vs per-turn) and its configurable cadence must be recorded.

4. **When is transcript data persisted?** Two failure modes exist: the WebSocket drops mid-session (losing in-memory transcript), and Phase 6 reads from a cold `findById` call (so data must be in the database by the time evaluation runs). Whether to buffer and persist at session end, or persist per turn, needs a recorded decision.

5. **How do tool effects reach the use case?** AI SDK `tool.execute` callbacks run inside `streamText`. If callbacks directly call the repository or domain, the infrastructure adapter imports domain packages — violating ADR-001's dependency rule. A typed event-sink pattern is the alternative; it must be formalized.

These five questions interact: per-turn persistence requires a per-turn data flow from tool events to aggregate mutations; the event-sink pattern requires the use case to own aggregate mutations; the aggregate-as-unit-of-persistence rule (ADR-001) shapes which storage model is cheapest to adopt.

Phase 5 is the first time the agent is fully wired end-to-end. Without a recorded decision, Phase 6 (evaluation) and Phase 10 (resilience) will each re-derive these choices independently, creating drift in tool schemas, attribute keys, and persistence semantics.

## Decision

Five decisions are consolidated here because they form one coherent orchestration pattern. Splitting them would produce five single-sentence ADRs that each reference each other; the shared context is better expressed as one record.

### D1 — Agent tool surface is exactly four tools

The Gemini interview agent receives a `tools` map with exactly these four entries, defined in `GeminiInterviewAgentService` at `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts`:

| Tool | Input schema (Zod 4) | Effect on use case |
|---|---|---|
| `next_question` | `{ topicName: string, question: string }` | No-op on aggregate; advances conversation history |
| `score_answer` | `{ topicName: string, score: number (0–5), justification: string }` | Appends `AgentInternalScore` onto `Interview` |
| `take_note` | `{ note: string }` | Appends `AgentNote` onto `Interview` |
| `end_interview` | `{ reason: EndInterviewReason }` | Sets `agentEnded = true`; loop exits after current TTS finishes |

`EndInterviewReason` is a const-object enum with four values: `all_topics_covered`, `candidate_not_a_fit`, `candidate_requested_end`, `time_up`. The definition lives in `packages/application/src/ports/interview-agent/interview-agent.port.ts:13-21`.

`score_answer.score` uses the 0–5 range matching the domain's `TopicScore` value object (`packages/domain/src/entities/report/value-objects/topic-score.ts`), so Phase 6's evaluator can compare the agent's real-time score against the post-hoc evaluation score on the same numeric scale.

AI SDK `experimental_repairToolCall` is not enabled. A tool call with invalid input returns `AgentToolInputInvalidError` immediately, closing the WebSocket session with an error envelope. Silent repair causes additional LLM turns with unpredictable output and obscures the root cause during debugging.

### D2 — Notes and internal scores are persisted on the Interview aggregate as JSONB columns

Two new value objects are added to the domain:

```typescript
// packages/domain/src/entities/interview/value-objects/agent-note.ts
export class AgentNote {
  static create(props: AgentNoteProps): Result<AgentNote, InvalidInterviewInputError>
  serialize(): AgentNoteProps
  static fromSerialized(data: AgentNoteProps): AgentNote
}

// packages/domain/src/entities/interview/value-objects/agent-internal-score.ts
export class AgentInternalScore {
  static create(props: AgentInternalScoreProps): Result<AgentInternalScore, InvalidInterviewInputError>
  serialize(): AgentInternalScoreProps
  static fromSerialized(data: AgentInternalScoreProps): AgentInternalScore
}
```

Both are added to `Interview` as `readonly notes: ReadonlyArray<AgentNote>` and `readonly internalScores: ReadonlyArray<AgentInternalScore>` (see `interview.entity.ts:52-53`, `:78-79`).

Three new aggregate mutators are added (`interview.entity.ts:154-172`), all returning `Result<Interview, InvalidInterviewStateTransitionError>` and rejecting when `status !== IN_PROGRESS`:

```typescript
appendTranscriptEntry(entry: TranscriptEntry): Result<Interview, InvalidInterviewStateTransitionError>
appendNote(note: AgentNote):                   Result<Interview, InvalidInterviewStateTransitionError>
appendInternalScore(score: AgentInternalScore): Result<Interview, InvalidInterviewStateTransitionError>
```

The Drizzle schema gains two new JSONB columns (`interviews.ts:30`):

```sql
-- apps/backend/drizzle/0001_lame_ozymandias.sql
ALTER TABLE "interviews" ADD COLUMN "internal_scores" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "interviews" ADD COLUMN "notes"           jsonb DEFAULT '[]'::jsonb NOT NULL;
```

This mirrors the existing `transcript jsonb DEFAULT '[]'::jsonb NOT NULL` column pattern from Phase 1 (ADR-007). No new repository interface, no new query pattern.

### D3 — Time-remaining context is injected per-turn as a system-role message

At the start of every K-th turn (K = `INTERVIEW_TIME_REMAINING_INTERVAL_TURNS`, default 3; 0 disables), the use case computes remaining time against the `InterviewPlan`'s `targetDurationMinutes` and `maxDurationMinutes` and passes a formatted string to the agent port as `AgentTurnInput.timeRemainingMessage`. When non-null, the `GeminiInterviewAgentService` adapter appends this string to the system prompt before assembling the message array (`gemini-interview-agent.service.ts:281-283`).

The message template is:

```
Time check (turn N): {targetRemaining} remaining of soft target,
{maxRemaining} remaining before hard ceiling.
Topics still uncovered: {list}.
```

Uncovered topics are tracked by counting `next_question` tool events emitted so far per topic name, subtracted from `interviewPlan.topics`.

Phase 5's hard-ceiling enforcement is a `setTimeout` that fires an abort signal after `maxDurationMinutes * 60_000 + graceSeconds * 1000` milliseconds (`conduct-interview.use-case.ts:114-158`). This satisfies ADR-006's minimum ceiling guarantee but not its graceful-wrap-up requirement. Full graceful negotiation is a Phase 10 deliverable per ADR-006's risk-and-mitigation block.

### D4 — Transcript persistence is per-turn

After each completed agent+candidate exchange, the use case:

1. Builds the `AgentTranscriptEntry` from the agent's text output.
2. Builds the `CandidateTranscriptEntry` from the STT final.
3. Calls `interview.appendTranscriptEntry(agentEntry).flatMap(i => i.appendTranscriptEntry(candidateEntry))` (`conduct-interview.use-case.ts:201`, `:267`).
4. Persists by calling `repo.save(updated)`.

If `repo.save` returns `Result.Err`, the turn fails and the loop exits with `ServiceUnknownError`. The next-most-recent durable state is whatever was persisted on the previous turn.

The cost is O(N) UPSERTs per session where N is the number of turns (typically 8–20). At standard PostgreSQL latency this is 10–40 ms total write overhead per session — acceptable for the expected concurrency. If profiling reveals a bottleneck, a partial-UPDATE path targeting only `transcript`, `notes`, `internal_scores`, `updated_at` can be added in Phase 10 without changing the aggregate model or use-case contract.

### D5 — Tool effects flow through a typed AgentToolEvent discriminated union

The `IInterviewAgentService.runTurn()` port returns `AgentTurnOutput`, which includes `toolEvents: ReadonlyArray<AgentToolEvent>` (`interview-agent.port.ts:50-57`). The `AgentToolEvent` type is a discriminated union:

```typescript
export type AgentToolEvent =
  | { readonly kind: "next_question"; readonly topicName: string; readonly question: string }
  | { readonly kind: "score_answer"; readonly topicName: string; readonly score: number; readonly justification: string }
  | { readonly kind: "take_note"; readonly note: string }
  | { readonly kind: "end_interview"; readonly reason: EndInterviewReason };
```

Inside `GeminiInterviewAgentService`, each `tool.execute` callback pushes an event to a closure array and returns the JSON tool result to the model (`gemini-interview-agent.service.ts:232-280`). The callback does not import or call domain, repository, or observability code.

After `streamText` resolves, the use case iterates `toolEvents` and translates each event into an aggregate mutation (`conduct-interview.use-case.ts:177-370`):

- `next_question` → no-op on aggregate (conversation history is advanced implicitly).
- `score_answer` → `AgentInternalScore.create(...)` → `interview.appendInternalScore(...)`.
- `take_note` → `AgentNote.create(...)` → `interview.appendNote(...)`.
- `end_interview` → sets `endReason` and `agentEndedAfterTurn`.

## Alternatives Considered

### D1 — Tool surface

#### Alternative A: Combine score_answer and take_note into a single score_and_note tool

A single tool `score_and_note(topicName, score, justification, note?)` would reduce the model's tool vocabulary by one. Rejected: scoring a topic and logging an observation are semantically distinct operations. The model often wants to take a note without scoring (mid-topic observations), or score without a note (when the justification is sufficient). Merging them forces an arbitrary `note` value when the model only intends to score, inflating the tool call with a field the model must fabricate.

#### Alternative B: Add a fifth request_clarification tool

A `request_clarification(question)` tool would let the model signal that it is asking for clarification rather than moving to a new topic. Rejected: `request_clarification` is semantically near-identical to continuing the conversation with a question — the model already has that capability without a tool call. A fifth tool expands the prompt surface and introduces a near-synonym choice that degrades tool-call reliability. ARCHITECTURE.md §5.1 names exactly four tools; deviating from the spec requires a superseding ADR.

#### Alternative C: Enable experimental_repairToolCall

AI SDK v4+ supports `experimental_repairToolCall` which asks the model to self-correct on an invalid tool call. Rejected: repair adds at least one extra LLM turn with unpredictable output; the repair turn's cost and latency are invisible in the trace; and the root cause (malformed model output) is swallowed silently. Failing fast with `AgentToolInputInvalidError` makes the defect visible in the WebSocket close envelope and in Langfuse, enabling rapid diagnosis.

### D2 — Storage model for notes and internal scores

#### Alternative A: Sidecar interview_notes and interview_scores tables

Two normalized tables, each with a foreign key to `interviews.id`. Rejected: notes and scores have no lifecycle independent of the interview; they cannot be queried without joining to `interviews`; deleting an interview cascades to their rows with no benefit to query flexibility. Phase 6's evaluator loads JD + CV + transcript + notes + scores in a single `findById` call — sidecar tables introduce a join the evaluator does not need, at the cost of two additional schema objects and a widened repository interface.

#### Alternative B: In-memory only, persist on interview.complete()

Notes and scores accumulate in the use-case closure and are written via `interview.complete(at, transcript, notes, scores)` at session end. Rejected: a WebSocket drop mid-session permanently loses all `take_note` and `score_answer` records computed during the session. Phase 6's evaluator calls `findById` on a completed interview — if the interview never called `complete()` (error close, reconnection failure), there are zero notes and scores to evaluate. Per-turn persistence avoids both failure modes.

### D3 — Time-remaining injection mechanism

#### Alternative A: Wall-clock timer injecting every 30 seconds

A `setInterval` fires every 30 seconds and appends a time-remaining message to a queue consumed by the agent on the next turn. Rejected: AI SDK `streamText` is not interruptible mid-flight. Injecting on a timer requires interrupting an in-flight call, which is only possible via `abortSignal` — which terminates the call entirely rather than inserting a message. A 30-second timer that cannot fire mid-turn provides no benefit over per-turn injection.

#### Alternative B: Embed an elapsed-time formula in the initial system prompt

The system prompt instructs the agent to compute remaining time from a `sessionStartedAt` timestamp included in the prompt. Rejected: Gemini 2.5 does not have access to a reliable real-time clock; the elapsed-time formula produces erratic results because the model cannot observe the actual wall-clock time when it generates a response. The per-turn injection provides ground-truth time-remaining values computed by the use case from `clock().getTime()`.

### D4 — Transcript persistence timing

#### Alternative A: Buffer transcript in memory and persist on interview.complete()

The transcript array lives in the use-case closure and is written once at session end via `interview.complete()`. Rejected: identical to D2 Alternative B — a session that ends abnormally (error close, hard-ceiling abort) loses all transcript data. A 14-minute interview with a crash at minute 13 would retain zero transcript entries.

#### Alternative B: Partial UPDATE on each turn

Instead of a full `repo.save(interview)` UPSERT, execute a targeted `UPDATE interviews SET transcript=$1, notes=$2, internal_scores=$3, updated_at=$4 WHERE id=$5`. Rejected: the existing `DrizzleInterviewRepository.save()` uses a full UPSERT consistent with ADR-001's immutable-entity rule and the established pattern across all repositories. Adding a partial-update path diverges from that pattern, introduces a second code path through the repository, and complicates test fixtures. If write amplification is profiled as a bottleneck in Phase 10, this path can be added without changing the use-case contract.

### D5 — Tool effect routing

#### Alternative A: Tool execute callbacks directly call the repository

Each `tool.execute` callback receives an injected `IInterviewRepository` and calls `repo.save(...)` directly. Rejected: the infrastructure adapter (`GeminiInterviewAgentService`) would need to import `IInterviewRepository` from `@repo/application` and domain types from `@repo/domain`, inverting the dependency direction mandated by ADR-001. The adapter must not import application-layer ports; it is instantiated by the composition root and receives only its own configuration.

#### Alternative B: Return AgentToolEvent[] as a separate Result channel from runTurn()

The port signature becomes `runTurn(): Promise<{ output: Result<AgentTurnOutput, AgentError>; events: Result<AgentToolEvent[], AgentError> }>`. Rejected: tool events and the agent text output are produced by the same `streamText` call. Separating them requires two independent awaits on the same streaming source, which is not possible with the current AI SDK model — `textStream` and tool callbacks are interleaved in a single async generator. Embedding `toolEvents` in `AgentTurnOutput` preserves the one-await-per-turn model.

## Consequences

**Benefits**

- The `Interview` aggregate is the single source of truth for all interview state (transcript, notes, scores) — fully consistent with ADR-001's immutable-entity model. Phase 6's evaluator calls `repo.findById(interviewId)` once and receives everything it needs.
- Per-turn saves make agent observations durable from the moment they are emitted. A session that closes abnormally (network drop, error close, hard-ceiling abort) retains all observations up to the last completed turn.
- The four-tool surface keeps the model's decision space small. Fewer tools reduce prompt token count and the probability of ambiguous tool selection by the model.
- The `AgentToolEvent[]` event-sink pattern keeps the infrastructure adapter free of domain knowledge. The use case retains full control over aggregate mutation, is independently testable, and satisfies ADR-001's dependency direction without exception.
- Time-remaining injection with a configurable cadence (`INTERVIEW_TIME_REMAINING_INTERVAL_TURNS`) allows latency-token trade-off tuning per deployment: K=1 injects every turn (maximum context, maximum token cost); K=0 disables injection entirely (useful in unit tests).

**Trade-offs**

- O(N) full-aggregate UPSERTs per session. For N≈20 turns and a typical `interviews` row size of 5–15 KB, this is ≈100–300 KB written per session across 20 round-trips. At standard PostgreSQL on the same host, this is 10–40 ms total overhead — acceptable for interview workloads. Profiling should confirm this before Phase 10 optimizes it.
- Phase 5's hard-ceiling enforcement is a simple `setTimeout` + `AbortSignal`. It satisfies ADR-006's minimum ceiling guarantee (no session exceeds `maxDurationMinutes + graceSeconds`) but not ADR-006's graceful-wrap-up requirement (the agent is given one reminder turn, then force-closed). Full graceful negotiation is a Phase 10 deliverable. Operators must be aware that force-close can produce a truncated candidate experience.
- Tool repair is not enabled. A model that emits an invalid tool call (e.g., `score` outside 0–5, empty `note`) causes the session to close with an error WebSocket code. This is intentional for debuggability but may frustrate users on networks with high model-output variance. The mitigating factor is that Gemini 2.5 Pro's tool-call reliability on flat Zod schemas is high; the failure mode is expected to be rare.
- Single-server concurrency only. If two processes simultaneously load the same `Interview` and one calls `interview.start(...)`, the second `start()` call returns `InvalidInterviewStateTransitionError`. Phase 5 runs on a single server; optimistic locking and session management are deferred to Phase 10.

**Risks and mitigations**

- *Risk*: A future developer adds a fifth tool to `GeminiInterviewAgentService` without updating this ADR. The enforcement block below flags additions to the tool surface in the adapter file via LLM judge. *Mitigation*: `llm_judge: true` in the Enforcement block.
- *Risk*: A future refactor calls `interview.transcript = [...]` directly rather than `appendTranscriptEntry`, bypassing the IN_PROGRESS guard and producing invalid aggregate state. *Mitigation*: The `forbid_pattern` rule in the Enforcement block below blocks the direct-assignment pattern in `apps/backend/src/**/*.ts`.
- *Risk*: The O(N) write amplification becomes a bottleneck under high concurrency in Phase 10. *Mitigation*: The partial-UPDATE path (D4 Alternative B) can be added in Phase 10 without changing the use-case contract or aggregate model. Document the option; defer the implementation until Langfuse/Postgres profiling confirms the need.
- *Risk*: Phase 5's `setTimeout` hard ceiling fires during a high-value candidate response, cutting the session short. *Mitigation*: The `INTERVIEW_HARD_CEILING_GRACE_SECONDS` knob (default 30) provides a configurable buffer after `maxDurationMinutes` elapses. Operators should set `maxDurationMinutes` conservatively (25 min for a 15-min target interview). ADR-006's graceful-wrap-up requirement is tracked for Phase 10.
- *Risk*: Gemini API returns a session with zero text output but one or more tool calls, producing an empty `AgentTurnOutput.text` that results in ElevenLabs receiving an empty string. *Mitigation*: The use case guards against empty TTS input by skipping the TTS call when `turn.text.trim().length === 0`; the conversation history advances only on non-empty text turns.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: The aggregate-as-persistence-unit rule (D2, D4) and the dependency-direction rule that forbids the adapter from importing domain packages (D5) are direct consequences of ADR-001.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The four tools are the in-session control surface for the sandwich's LLM leg. Their names are first listed in ARCHITECTURE.md §5.1, which ADR-002 formalizes.
- **ADR-006 (Interview Duration Is a Soft Target with a Hard Ceiling Enforced by the System)**: D3 (time-remaining injection) implements ADR-006's soft-target policy. Phase 5's `setTimeout` covers the minimum hard-ceiling guarantee from ADR-006; the graceful-wrap-up requirement from ADR-006 is deferred to Phase 10 and explicitly acknowledged in D3's Consequences above.
- **ADR-007 (Persist Extracted JD/CV Through the Interview Aggregate's Existing JSONB Columns)**: D2 follows ADR-007's JSONB-on-aggregate pattern. `notes` and `internal_scores` are two additional JSONB columns on `interviews` with the same `DEFAULT '[]'::jsonb NOT NULL` convention as `transcript`.
- **ADR-010 (Use AsyncIterable Stream Contracts for STT and TTS Application Ports)**: The `IInterviewAgentService` port uses `Promise<Result<AgentTurnOutput, AgentError>>` — not `AsyncIterable` — because the agent collects the full turn before returning. This is consistent with ADR-010's scope: AsyncIterable is the right contract for STT and TTS, where streaming chunks are consumed incrementally; the agent port is not a streaming boundary.
- **ADR-012 (Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns)**: The `GeminiInterviewAgentService` adapter opens the `interview.turn.agent` span at the top of `runTurn()` before the first `await`, consistent with ADR-012's adapter-owns-span-lifecycle rule. Token counts and stop reason are recorded as span attributes (`agent.input_tokens`, `agent.output_tokens`, `agent.stop_reason`).

## References

- `packages/application/src/use-cases/interview/conduct-interview.use-case.ts` — D3 (time-remaining injection, lines 114–158), D4 (per-turn transcript append and save, lines 201, 267), D5 (tool event processing, lines 177–370)
- `packages/application/src/ports/interview-agent/interview-agent.port.ts:13-21` — `END_INTERVIEW_REASON` enum; `:23-36` — `AgentToolEvent` discriminated union; `:50-57` — `AgentTurnOutput` with `toolEvents`; `:59-65` — `IInterviewAgentService.runTurn()` signature
- `packages/domain/src/entities/interview/value-objects/agent-note.ts` — `AgentNote` value object with `Result.create`, `serialize`, `fromSerialized`
- `packages/domain/src/entities/interview/value-objects/agent-internal-score.ts` — `AgentInternalScore` value object with `Result.create`, `serialize`, `fromSerialized`
- `packages/domain/src/entities/interview/interview.entity.ts:52-53` — `notes` and `internalScores` readonly fields; `:154-172` — `appendTranscriptEntry`, `appendNote`, `appendInternalScore` mutators; `:206-207` — `serialize()` extension; `:229-230` — `fromSerialized()` extension
- `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts:165` — `interview.turn.agent` span opened; `:232-280` — four tool definitions with event-sink callbacks; `:281-283` — `timeRemainingMessage` folded into system prompt
- `apps/backend/src/infrastructure/persistence/schema/interviews.ts:30` — `internalScores` JSONB column; (notes column at adjacent line)
- `apps/backend/drizzle/0001_lame_ozymandias.sql` — migration adding `notes` and `internal_scores` JSONB columns
- `docs/ARCHITECTURE.md` §5.1 (four-tool spec), §5.2 (duration policy — soft target + hard ceiling), §6 (domain model showing `transcript`, `notes`, `internalScores` on `Interview`)
- `.claude/plan/phase-5-agent-integration.md` — decisions D1–D5 with full implementation rationale, open-question resolutions, and risk notes

## Enforcement

Declarative rules cover the two highest-frequency violations: importing domain from the agent adapter, and bypassing the aggregate mutator API. The `llm_judge: true` flag covers semantic checks that cannot be expressed as line-pattern regexes: whether the tool surface has grown beyond four entries, whether per-turn `repo.save` is invoked on every loop iteration, and whether tool-event processing bypasses the use case.

```json
{
  "forbid_pattern": [
    {
      "pattern": "from\\s+['\"]@repo/domain['\"]",
      "path_glob": "apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts",
      "message": "Agent adapter must not import domain — tool effects are returned as AgentToolEvent[] (ADR-013)."
    },
    {
      "pattern": "interview\\.transcript\\s*=",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Direct mutation of Interview.transcript is forbidden; use appendTranscriptEntry (ADR-013)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [
    {
      "pattern": "appendTranscriptEntry|appendNote|appendInternalScore",
      "path_glob": "packages/application/src/use-cases/interview/conduct-interview.use-case.ts",
      "message": "ConductInterviewUseCase must use the typed Interview mutators (ADR-013)."
    }
  ],
  "llm_judge": true
}
```
