# Plan: Phase 5 — Agent Integration (Real Gemini Interviewer)

> Generated: 2026-05-10
> Slug: `phase-5-agent-integration`
> Architecture context: `docs/ARCHITECTURE.md` §3.3, §4.5, §4.6, §5.1, §5.2, §5.5, §6, §7
> Phase 4 reference: `.claude/plan/phase-4-voice-pipeline-spike.md`, `docs/progress/phase-4.md`
> ADRs locking in this phase: ADR-002, ADR-006, ADR-010, ADR-011, ADR-012

---

## Goal

Replace the Phase 4 hardcoded scripted driver with a **real Gemini interviewer agent** that drives the conversation turn-by-turn. The same WebSocket route `GET /interviews/:id/session`, the same Deepgram STT and ElevenLabs TTS infrastructure adapters, and the same `AsyncIterable` port contracts (ADR-010) keep working. What changes is the orchestrator: a new `IInterviewAgentService` port wraps the AI SDK `streamText` call with Gemini and four typed tools (`next_question`, `score_answer`, `take_note`, `end_interview`), and a new `ConductInterviewUseCase` orchestrates STT → Agent → TTS while persisting transcript, notes, and internal scores onto the `Interview` aggregate. Periodic time-remaining context is injected back into the agent prompt every K turns; the soft target / hard ceiling discipline of ADR-006 is honoured. Per-turn Langfuse trace structure (ADR-012) is verified end-to-end: one `interview.session.agent` root span, one `interview.turn.stt`, one `interview.turn.agent`, and one `interview.turn.tts` span per turn, all sharing the same `interview.id`.

The Phase 4 scripted use case (`RunScriptedInterviewSessionUseCase`), DTO, tee helper, and constants are **retired**: the scripted path is gone from the route, gone from the composition root, and the source files plus their tests are deleted from `packages/application/src/use-cases/interview/`. The latency harness (`apps/backend/src/scripts/measure-voice-latency.ts`) is retained but pivoted: it now drives the Phase 5 endpoint and asserts on the new `session.completed` envelope shape.

The frontend, REST CRUD, auth, reconnection, retry policies, circuit breakers, and full hard-ceiling enforcement remain out of scope (they belong to Phases 7, 8, 9, 10).

## Non-goals (DO NOT do these in Phase 5)

- No browser UI work — Phase 9.
- No REST endpoints for interview CRUD or report retrieval — Phase 7.
- No auth, neither recruiter auth nor candidate signed-link validation — Phase 7. The route still trusts `:id`.
- No evaluation pass, `Report` writes, or rubric scoring — Phase 6.
- No reconnection / mid-call recovery, no retry / backoff policies, no circuit breakers — Phase 10.
- No graceful-wrap-up negotiation when the hard ceiling fires. Phase 5 implements only a **simple wall-clock timeout** that flips the abort signal once `maxDurationMinutes` elapses; the agent is given one final turn to emit `end_interview`, after which the session is force-closed. Full graceful negotiation (per ADR-006) lives in Phase 10.
- No barge-in support. The conversation stays half-duplex: candidate audio frames received during agent speech are dropped (same behaviour as Phase 4's tee).
- No streaming of the agent's text output into the TTS adapter token-by-token. The agent's text-step output is collected per turn and synthesised in one TTS call (one `interview.turn.tts` span per turn). Token-by-token TTS streaming is a Phase 10 optimisation; the port contract from ADR-010 already accommodates it additively.

## Layers touched

| Layer          | Package / Location                                   | Scope                                                                                                                                                                             |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                                   | Two new value objects (`AgentNote`, `AgentInternalScore`), three new `Interview` mutator methods (`appendTranscriptEntry`, `appendNote`, `appendInternalScore`), serialised-shape extension, `InterviewSerialized` updates, repository contract unchanged |
| Application    | `packages/application/`                              | New `IInterviewAgentService` port + error hierarchy + barrel; new `system-prompt-assembler.ts` pure helper; new `ConductInterviewUseCase` + DTO; `Interview` import surface widened; **delete** Phase 4 scripted use case, scripted DTO, scripted-script const file, tee helper, and their tests |
| Infrastructure | `apps/backend/src/infrastructure/`                   | New `GeminiInterviewAgentService` adapter (AI SDK `streamText` with four tools + telemetry); Drizzle migration for `notes` + `internal_scores` JSONB columns on `interviews`; schema update to expose the new columns; repository serialiser updates |
| Presentation   | `apps/backend/src/presentation/`                     | Update `InterviewSessionController` and route to invoke `ConductInterviewUseCase`; rename session span to `interview.session.agent`; extend WS close-code mapping for new agent error variants                                                                |
| Composition    | `apps/backend/src/composition/`                      | Wire repository, agent, STT, TTS, and clock dependencies into `buildInterviewSessionDeps()`; update tests                                                                          |
| Scripts        | `apps/backend/src/scripts/`                          | Update `measure-voice-latency.ts` for the new envelope shape and trace structure                                                                                                  |
| Env / config   | `apps/backend/.env.example`                          | Add `GEMINI_AGENT_MODEL`, `INTERVIEW_TIME_REMAINING_INTERVAL_TURNS`, optional `INTERVIEW_HARD_CEILING_GRACE_SECONDS`                                                              |

---

## Architectural decisions (rationale locked in)

These are the decisions to capture as ADRs in this phase. Numbers continue from ADR-012; next free number is **ADR-013**.

### Pre-implementation resolutions (2026-05-10)

The five open questions raised when this plan was first drafted are resolved as follows. Implementing-agent guidance throughout the plan reflects these:

1. **Default agent model — `gemini-2.5-pro`.** Quality-first default. The architecture explicitly justifies Pro for the interviewer (§5.1 cites reasoning depth as the gap that disqualified PersonaPlex). Google currently positions 2.5 Pro as the strongest reasoning model and 2.5 Flash as the latency/price-performance model. The §3.3 latency budget (≈300–500 ms LLM contribution) is **not** assumed to be met by Pro out of the box — `GEMINI_AGENT_MODEL=gemini-2.5-flash` remains a valid env override once Langfuse traces show Pro is the bottleneck. Do not preempt that calibration. (See D1, the C4 snippet, the `.env.example` entry, and risk note 8.)
2. **ADR-013 and ADR-014 stay separate.** ADR-013 owns agent contract + orchestration + per-turn persistence (D1–D5). ADR-014 owns the OTel span schema extension (D7). Bundling fails the Clarity gate. Both `llm_judge: true`.
3. **Phase 4 scripted code is deleted, not deprecated.** Phase 4 was framed as a spike; keeping a parallel WS-driving use case creates contract drift. The `voice:latency` harness stays — it is the dev-only path. Symbol cleanup is enforced by the Batch E sweep.
4. **`getDb(env)` does not exist.** Verified 2026-05-10: `apps/backend/src/infrastructure/persistence/db.ts` exports a module-level singleton `db` (typed `Database`) and reads `process.env.DATABASE_URL` at import time. The composition root in Batch D1 uses an ESM-safe lazy `require(...)` via `createRequire(import.meta.url)` plus an injectable `options.db` so composition tests do not require `DATABASE_URL` to load the module graph. No `createDatabase(env)` factory is introduced in Phase 5; that is a deferred Phase 10 follow-up.
5. **`INTERVIEW_TIME_REMAINING_INTERVAL_TURNS` is env-configurable, default `3`, `0` disables.** A new helper `parseNonNegativeInt` validates the value: rejects fractional (`2.5`), negative (`-1`), `NaN`, and `Infinity`, falling back to the default. The composition test matrix asserts these. Same helper validates `INTERVIEW_HARD_CEILING_GRACE_SECONDS` (default `30`).

### D1 — Agent tool surface is exactly the four tools named in ARCHITECTURE.md §5.1

**Decision.** The Gemini agent receives a `tools` map with exactly these four entries:

| Tool name        | Input (Zod 4 schema)                                                                                              | Effect on use case                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next_question`  | `{ topicName: string, question: string }`                                                                          | Records that the agent is moving on to a planned topic. The use case appends the agent text turn and continues the loop. The tool result returned to the model is `{ ok: true, topicName, advancedAtTurn }`.        |
| `score_answer`   | `{ topicName: string, score: number (0..5), justification: string }`                                                | Use case appends an `AgentInternalScore` value object onto the `Interview` aggregate via `interview.appendInternalScore(...)`. Tool result: `{ ok: true, recordedAtTurn }`. Score is **not** read out to candidate. |
| `take_note`      | `{ note: string }`                                                                                                 | Use case appends an `AgentNote` value object. Tool result: `{ ok: true, recordedAtTurn }`.                                                                                                                          |
| `end_interview`  | `{ reason: "all_topics_covered" \| "candidate_not_a_fit" \| "candidate_requested_end" \| "time_up" }`              | Sets a sticky `agentEnded = true` flag in the use-case state so the loop exits cleanly after the current turn's TTS finishes. Tool result: `{ ok: true, willEndAfterTurn: turnIndex }`.                            |

**Why exactly these four.** ARCHITECTURE.md §5.1 enumerates them by name; ADR-002 records the same list in the rejected-PersonaPlex rationale. Adding a fifth tool now (e.g. `request_clarification`) inflates the prompt surface and forces the agent to choose between two near-synonyms, hurting tool-call reliability. Removing one (e.g. dropping `score_answer` and computing scores in Phase 6 from the transcript) loses per-turn agent reasoning that Phase 6 cannot reconstruct from text alone. The four tools map cleanly to four well-defined effects on the `Interview` aggregate.

**Why each tool's input is a flat object with named primitive fields.** AI SDK's `tool({ inputSchema, execute })` validates input against the Zod 4 schema before invoking `execute`. Flat schemas give the cleanest model output and the cleanest test fixtures. No nested objects or arrays except where the domain invariant requires them.

**Why `score_answer.score` is `0..5`.** Matches `TopicScore` in the domain (`packages/domain/src/entities/report/value-objects/topic-score.ts`, score bounded 0–5). The agent's internal score is a different value object (`AgentInternalScore`) but reuses the same scale so Phase 6's evaluator can compare them.

### D2 — Notes and internal scores are persisted on the `Interview` aggregate (option (a) from the spec)

**Decision.** Two new domain value objects, persisted as JSONB columns:

```typescript
// packages/domain/src/entities/interview/value-objects/agent-note.ts
export interface AgentNoteProps {
  readonly note: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}

// packages/domain/src/entities/interview/value-objects/agent-internal-score.ts
export interface AgentInternalScoreProps {
  readonly topicName: string;
  readonly score: number;            // 0..5
  readonly justification: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}
```

Both have `Result.create(...)` factories with non-empty / range checks, `serialize()`, and `static fromSerialized()` per the project's value-object contract. Both are added to `Interview` as `readonly notes: ReadonlyArray<AgentNote>` and `readonly internalScores: ReadonlyArray<AgentInternalScore>` collections, with three new mutator methods that all return `Result<Interview, InvalidInterviewStateTransitionError>`:

```typescript
appendTranscriptEntry(entry: TranscriptEntry): Result<Interview, InvalidInterviewStateTransitionError>
appendNote(note: AgentNote):                  Result<Interview, InvalidInterviewStateTransitionError>
appendInternalScore(score: AgentInternalScore): Result<Interview, InvalidInterviewStateTransitionError>
```

All three reject with `InvalidInterviewStateTransitionError` if `status !== INTERVIEW_STATUS.IN_PROGRESS` — the agent loop only runs while the interview is in progress. The existing `complete(at, transcript)` method now also re-validates that `transcript` is non-empty if you're persisting via the new append path (an interview that completes with zero turns is a defect).

**Why on the aggregate, not a sidecar table.** Three concrete reasons, all consistent with ADR-007's per-aggregate JSONB pattern:

1. **Phase 6 traceability.** The Phase 6 evaluator will read JD + CV + transcript + notes + internal scores together. Keeping them on the aggregate means one repository call returns everything; sidecar tables introduce join logic the evaluator does not need.
2. **Aggregate boundary integrity.** Notes and internal scores have no lifecycle independent of the interview. They are not queried separately; they have no `id` of their own; deleting an interview must delete them. This is the textbook DDD case for a child collection on the aggregate.
3. **Mirror Phase 1's `transcript` JSONB.** The `transcript` column already lives on `interviews` as `jsonb DEFAULT '[]'::jsonb NOT NULL`. The two new columns follow the same pattern (`notes jsonb`, `internal_scores jsonb`, both `NOT NULL DEFAULT '[]'::jsonb`). One repository, one serialise / deserialise pair, zero new query patterns.

**Why not in-memory only and persist on completion.** Two concrete failure modes:

- A WebSocket drop mid-session would lose all `take_note` and `score_answer` records permanently. Even though Phase 5 doesn't implement reconnection, the data is still lost on every abort, every error close, every controller exception. Per-turn persistence makes the data durable from the moment the agent emits it.
- Phase 6's evaluator needs to read notes from a `findById(...)` call. An in-memory-only design means notes are gone by the time evaluation runs, defeating the entire point of having `take_note` as a tool.

This decision is encoded in **ADR-013** (proposed below).

### D3 — Time-remaining injection is per-turn, computed by the use case

**Decision.** At the start of every turn, the use case computes:

```typescript
const elapsedMs = clock().getTime() - sessionStartedAt.getTime();
const remainingTargetMs = Math.max(0, plan.targetDurationMinutes * 60_000 - elapsedMs);
const remainingMaxMs = Math.max(0, plan.maxDurationMinutes * 60_000 - elapsedMs);
```

It assembles a per-turn system message appended to the existing message history (NOT a re-render of the full system prompt). The shape of that injected message is a literal `system` role message:

```
Time check (turn N): {targetRemainingFormatted} remaining of soft target,
{maxRemainingFormatted} remaining before hard ceiling. Topics still uncovered: {list}.
```

Topics still uncovered are derived by counting `next_question` tool calls so far per topic name and subtracting from `plan.topics`.

**Why per-turn, not on a wall-clock timer.** Two concrete reasons:

1. The agent is invoked once per turn. Injecting on a timer would require interrupting an in-flight `streamText` call, which the AI SDK does not support except via `abortSignal` (which terminates the call entirely). Per-turn injection is the natural cadence.
2. The agent already sees the conversation history; the time check is an additional system-role message appended to the same history. AI SDK respects multiple `system`-role messages and handles them as a conversation prefix.

**Configurable cadence.** A backoff knob: `INTERVIEW_TIME_REMAINING_INTERVAL_TURNS` (default `3`). Inject every K turns, not every turn — saves prompt tokens. K=1 is also valid for tests. K=0 disables injection (used in unit tests that don't care about the injection mechanism).

This decision is encoded in **ADR-013** (proposed below).

### D4 — Transcript persistence is per-turn (write-on-each-turn), not end-of-session

**Decision.** After each completed turn (one TTS spoken + one STT final received), the use case:

1. Builds the agent `TranscriptEntry` from the agent's text output for that turn.
2. Builds the candidate `TranscriptEntry` from the STT final.
3. Calls `interview.appendTranscriptEntry(agent).flatMap(i => i.appendTranscriptEntry(candidate))`.
4. Persists by calling `repo.save(updated)`.

If `repo.save` returns `Result.Err`, the turn fails and the loop exits with `ServiceUnknownError`. The next-most-recent durable state is whatever was persisted on the previous turn; the candidate hears the controller close-code reason.

**Why per-turn, not buffered.** Same logic as D2: durability of the in-flight session matters for Phase 6 even before reconnection ships in Phase 10. A 14-minute interview with a crash at minute 13 should not lose 12 minutes of transcript. The cost is O(N) DB writes per session where N ≈ 8–20 turns; PostgreSQL handles this comfortably for the expected concurrency.

**Why save the full aggregate each time, not a partial UPDATE.** The existing `DrizzleInterviewRepository.save(...)` does an UPSERT and treats the aggregate as the unit of persistence (consistent with ADR-001's immutable-entity rule). Adding a partial-update path would diverge from the established pattern and cost more in code than it saves in bytes-on-the-wire.

This decision is encoded in **ADR-013** (proposed below).

### D5 — Tool effects are typed events, dispatched inside the AI SDK `tool.execute()` callback, but mutate use-case state through a closure

**Decision.** The agent service's `tool({ inputSchema, execute })` callback does **not** call infrastructure (no DB writes, no STT, no TTS, no Langfuse spans). Instead, each tool's `execute` callback emits a typed event into a use-case-owned event sink and returns a small JSON object the model uses as the tool result. The use case consumes these events on the same turn (after `streamText` resolves) and translates them into `Interview` mutations and repo writes.

Concrete shape:

```typescript
// In application: a small event sink shape
export type AgentToolEvent =
  | { kind: "next_question"; topicName: string; question: string }
  | { kind: "score_answer"; topicName: string; score: number; justification: string }
  | { kind: "take_note"; note: string }
  | { kind: "end_interview"; reason: EndInterviewReason };

export interface AgentTurnInput {
  readonly interviewId: string;
  readonly turnIndex: number;
  readonly systemPrompt: string;             // assembled by application helper
  readonly conversationHistory: ReadonlyArray<AgentMessage>;
  readonly timeRemainingMessage: string | null; // null when injection skipped this turn
  readonly abortSignal: AbortSignal;
}

export interface AgentTurnOutput {
  readonly text: string;                      // agent's spoken text for this turn (used as TTS input)
  readonly toolEvents: ReadonlyArray<AgentToolEvent>;
  readonly stopReason: "tool_call_complete" | "stop" | "abort" | "error";
}

// In infra adapter:
const tools: ToolSet = {
  next_question: tool({
    description: "Advance to the next planned topic. Call once per topic transition.",
    inputSchema: z.object({ topicName: z.string().min(1), question: z.string().min(1) }),
    execute: async (input) => {
      events.push({ kind: "next_question", topicName: input.topicName, question: input.question });
      return { ok: true, topicName: input.topicName, advancedAtTurn: turnIndex };
    },
  }),
  // … same shape for the other three
};
```

Why the indirection. Three concrete reasons:

1. Per ADR-001, infrastructure adapters do not mutate domain aggregates. Tool effects must reach the use case for translation into `Interview` methods. Events are the natural decoupling mechanism.
2. Per ADR-012, the agent adapter owns its own `interview.turn.agent` span; the per-tool effect (DB write) belongs to a different span scope (the use case writes after the agent turn completes). Decoupling tool effects from tool execution keeps the spans correctly nested.
3. The AI SDK's `streamText` calls `tool.execute()` synchronously during streaming; if `execute` blocked on a DB write, the agent's text streaming would stall waiting for Postgres. The events pattern means `execute` returns in microseconds.

This decision is encoded in **ADR-013** (proposed below).

### D6 — Hard ceiling: simple wall-clock abort + one grace turn, not full graceful negotiation

**Decision.** The use case starts a `setTimeout` for `(plan.maxDurationMinutes * 60_000) + INTERVIEW_HARD_CEILING_GRACE_SECONDS * 1000`. If the timer fires:

1. The internal `hardCeilingHit` flag is set.
2. On the next turn boundary, the use case injects a final `system` message: `"Hard ceiling reached. End the interview now with end_interview(reason: 'time_up')."`
3. The agent gets one more turn to emit `end_interview`. If it does, the loop exits cleanly.
4. If it doesn't (or if the agent's response stalls), `abortController.abort()` is called and the loop exits with a `ServiceUnknownError("hard ceiling exceeded")` error. The presentation layer maps this to `WS_CLOSE.SERVICE_RESTART` (1012).

`INTERVIEW_HARD_CEILING_GRACE_SECONDS` defaults to `30`; configurable per env. This satisfies ADR-006's "the system terminates the session unconditionally" requirement at minimum complexity. Full graceful negotiation (multi-turn wrap-up, custom TTS phrase, candidate-facing apology) is Phase 10.

### D7 — Session span renamed `interview.session.agent`; per-turn agent span added

**Decision.** Per ADR-012, span name conventions for Phase 5:

```
interview.session.agent              (root, opened by InterviewSessionController, attribute interview.id)
├── interview.turn.agent             (turn 1, opened by GeminiInterviewAgentService, attributes: interview.id, interview.turn_index, agent.model, agent.tool_calls_count, agent.input_tokens, agent.output_tokens, agent.stop_reason)
├── interview.turn.tts               (turn 1, opened by ElevenLabsTextToSpeechService — unchanged)
├── interview.turn.stt               (turn 1, opened by DeepgramSpeechToTextService — unchanged)
├── interview.turn.agent             (turn 2, …)
├── interview.turn.tts               (turn 2, …)
├── interview.turn.stt               (turn 2, …)
└── …
```

`agent.tool_calls_count` is set lazily as tool calls arrive. `agent.stop_reason` is set on stream finish. `agent.input_tokens` / `agent.output_tokens` are set on stream finish, mirroring how AI SDK already exposes them via `experimental_telemetry` on the `streamText` call. Telemetry is enabled with `experimental_telemetry: { isEnabled: true, functionId: "GeminiInterviewAgentService.runTurn", metadata: { interviewId, turnIndex } }` so the AI SDK auto-emits a sibling Generation span the way it already does for `GeminiInterviewPlannerService.generatePlan` (Phase 3). Both spans land in the same Langfuse trace because the controller wraps the use-case call in `otelContext.with(sessionContext, ...)`.

This decision extends ADR-012 (no supersession; Phase 5 adds new span names that are listed in ADR-013's enforcement block).

### D8 — System prompt assembly is a pure application-layer helper

**Decision.** A new file `packages/application/src/use-cases/interview/system-prompt-assembler.ts` exports:

```typescript
export interface SystemPromptInput {
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly interviewPlan: InterviewPlan;
}

export const assembleInterviewSystemPrompt = (input: SystemPromptInput): string => { /* … */ };
```

**Why application, not infrastructure.** It composes domain VOs (no Drizzle, no AI SDK, no Langfuse) into a string. It is pure; it is unit-testable without any mocks. Putting it in infrastructure couples the prompt to the Gemini adapter, which means swapping to a different LLM provider rewrites the prompt unnecessarily.

**Why a free function, not a class.** No state. A class would only add ceremony.

**Why not in domain.** It is orchestration, not policy. The domain owns the duration constants and the plan VO; the application layer owns the textual rendering of those into a system prompt.

The prompt content follows ARCHITECTURE.md §5.1: JD context, CV summary, client instructions, interview plan (topics, must-ask questions, target/max duration), and behavioural guidelines (professional tone, time management, how to handle tangents, how to use the four tools).

### D9 — Phase 4 scripted use case, DTO, script consts, and tee helper are deleted

**Decision.** The route now points at `ConductInterviewUseCase`. The Phase 4 scripted code path is dead code from the moment Phase 5 lands. Deleting it eliminates a class of "which code path is the WS using?" confusion. Specifically delete:

- `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts`
- `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.test.ts`
- `packages/application/src/use-cases/interview/scripted-interview-script.ts`
- `packages/application/src/use-cases/interview/scripted-interview-tee.ts`
- `packages/application/src/use-cases/interview/scripted-interview-tee.test.ts`
- `packages/application/src/dtos/run-scripted-interview-session.dto.ts`
- `packages/application/src/dtos/run-scripted-interview-session.dto.test.ts`

And remove their exports from:

- `packages/application/src/use-cases/interview/index.ts`
- `packages/application/src/dtos/index.ts`

The `RunScriptedInterviewSessionUseCaseLike` shape in the controller is replaced with `ConductInterviewUseCaseLike`. The `wsBinaryToAsyncIterable` and `sendBinaryFrame` helpers in `apps/backend/src/presentation/websocket/voice-websocket.ts` are unchanged. The Phase 4 latency harness `apps/backend/src/scripts/measure-voice-latency.ts` is updated, not deleted.

This is a cleanup choice; the project values a single canonical path over an orphaned dev-only path. Re-introducing a scripted dev harness (e.g. for offline testing without API keys) is left for the future — it will be a different shape (likely an `InMemoryInterviewAgentService` test double under `apps/backend/src/scripts/`) and not a parallel use case in `@repo/application`.

### D10 — `IInterviewAgentService` returns one turn per call, not the whole conversation

**Decision.** The agent port exposes a single method:

```typescript
runTurn(input: AgentTurnInput): Promise<Result<AgentTurnOutput, AgentError>>
```

Not `runConversation(input): AsyncIterable<AgentTurnOutput>` and not a callback-driven `start(handlers)`. The use case calls `runTurn(...)` once per loop iteration, builds the next message history from the previous turn's output and the candidate's STT result, and calls again.

**Why one-shot per turn, not streaming over the whole conversation.** The use case must interleave STT (after agent text) and per-turn DB writes between agent turns. A `runConversation` shape would force the agent service to know about STT and DB writes — a layering violation. Per-turn `runTurn` keeps the agent adapter focused on one job: text in, text + tool events out.

**Why not async-iterable agent text inside each turn.** Phase 5 collects the per-turn text fully before sending to TTS (rationale in non-goals). Inside the adapter, `streamText` does iterate text chunks; the adapter accumulates them and returns the full string at turn end. Token-by-token TTS streaming is Phase 10.

### D11 — `streamText` step limit per turn

**Decision.** Each turn invokes `streamText` with `stopWhen: stepCountIs(4)` (AI SDK 6 helper). The agent has at most 4 reasoning steps per turn (text + up to 3 tool calls). Empirically a normal turn is "speak → maybe one tool call (`next_question` or `take_note` or `score_answer`) → final text"; allowing 4 steps gives one safety-buffer step. A higher cap risks runaway tool-call loops; a lower cap blocks legitimate tool sequences.

If `streamText` stops because of `stepCountIs`, the use case treats it as a normal turn end (`stopReason: "stop"`). If it stops because all tools fired and the model emitted final text, same path (`stopReason: "tool_call_complete"`). Both produce one `interview.turn.agent` span.

---

## Pre-flight

Before starting any batch, the implementing agent must:

1. **Read these files** (in order):
   - `docs/ARCHITECTURE.md` §3.3, §4.5, §4.6, §5.1, §5.2, §5.5, §6, §7
   - `.claude/plan/phase-4-voice-pipeline-spike.md` end-to-end (style and structure reference)
   - `docs/progress/phase-4.md` (what already shipped)
   - `docs/adr/ADR-002-…md`, `ADR-006-…md`, `ADR-010-…md`, `ADR-011-…md`, `ADR-012-…md`
   - `packages/domain/src/entities/interview/interview.entity.ts` (for the existing aggregate shape)
   - `packages/domain/src/entities/interview/value-objects/interview-plan.ts` (for `targetDurationMinutes` / `maxDurationMinutes` / defaults)
   - `packages/domain/src/entities/interview/value-objects/transcript-entry.ts` (for `SPEAKER` enum and existing factory)
   - `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts` (the use case being replaced)
   - `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts` (the AI SDK adapter shape to mirror)
   - `apps/backend/src/presentation/controllers/interview-session.controller.ts` (the controller to update)
   - `apps/backend/src/composition/interview-session.composition.ts` (the composition root to update)

2. **Confirm branch hygiene.** Phase 5 work continues on the `phase-4` branch (which despite the name carries Phase 4 + ADR-010/-011/-012). Cut a new branch `phase-5` from `phase-4` HEAD before the first edit.

3. **Confirm env.** `GOOGLE_GENERATIVE_AI_API_KEY` is already configured (Phase 3). No new secrets are required for type-check or tests; live smoke needs the same Phase 4 + Phase 3 keys plus the new defaults (`GEMINI_AGENT_MODEL`, `INTERVIEW_TIME_REMAINING_INTERVAL_TURNS`).

4. **Confirm migration tooling.** `pnpm --filter backend db:generate` is the Drizzle command; `pnpm --filter backend db:migrate` runs migrations. The expected migration file is `apps/backend/drizzle/0001_*.sql`.

---

## Implementation steps (file-by-file, batched in dependency order)

Each batch is independently runnable: at the end of each batch, run the verification commands listed under it and confirm clean before moving on.

### Batch A — Domain: notes + internal scores + new aggregate methods

#### A1. Create `AgentNote` value object

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/entities/interview/value-objects/agent-note.ts` (CREATE)

**What:** Immutable VO for notes the agent records mid-session.

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface AgentNoteProps {
  readonly note: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}

export class AgentNote {
  private constructor(
    readonly note: string,
    readonly recordedAtTurn: number,
    readonly recordedAt: Date,
  ) {}

  static create(props: AgentNoteProps): Result<AgentNote, InvalidInterviewInputError> {
    if (!props.note.trim()) {
      return Result.Err(new InvalidInterviewInputError("AgentNote.note must not be empty"));
    }
    if (!Number.isInteger(props.recordedAtTurn) || props.recordedAtTurn < 0) {
      return Result.Err(
        new InvalidInterviewInputError("AgentNote.recordedAtTurn must be a non-negative integer"),
      );
    }
    return Result.Ok(new AgentNote(props.note, props.recordedAtTurn, props.recordedAt));
  }

  serialize(): AgentNoteProps {
    return { note: this.note, recordedAtTurn: this.recordedAtTurn, recordedAt: this.recordedAt };
  }

  static fromSerialized(data: AgentNoteProps): AgentNote {
    return new AgentNote(data.note, data.recordedAtTurn, data.recordedAt);
  }
}
```

**Invariant check:** `Result`-returning factory; immutable readonly fields; `serialize` / `fromSerialized` pair; no infra imports.

#### A2. Create `AgentInternalScore` value object

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/entities/interview/value-objects/agent-internal-score.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface AgentInternalScoreProps {
  readonly topicName: string;
  readonly score: number;
  readonly justification: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}

export class AgentInternalScore {
  private constructor(
    readonly topicName: string,
    readonly score: number,
    readonly justification: string,
    readonly recordedAtTurn: number,
    readonly recordedAt: Date,
  ) {}

  static create(
    props: AgentInternalScoreProps,
  ): Result<AgentInternalScore, InvalidInterviewInputError> {
    if (!props.topicName.trim()) {
      return Result.Err(new InvalidInterviewInputError("AgentInternalScore.topicName must not be empty"));
    }
    if (!Number.isFinite(props.score) || props.score < 0 || props.score > 5) {
      return Result.Err(new InvalidInterviewInputError("AgentInternalScore.score must be in [0, 5]"));
    }
    if (!props.justification.trim()) {
      return Result.Err(
        new InvalidInterviewInputError("AgentInternalScore.justification must not be empty"),
      );
    }
    if (!Number.isInteger(props.recordedAtTurn) || props.recordedAtTurn < 0) {
      return Result.Err(
        new InvalidInterviewInputError("AgentInternalScore.recordedAtTurn must be a non-negative integer"),
      );
    }
    return Result.Ok(
      new AgentInternalScore(
        props.topicName,
        props.score,
        props.justification,
        props.recordedAtTurn,
        props.recordedAt,
      ),
    );
  }

  serialize(): AgentInternalScoreProps {
    return {
      topicName: this.topicName,
      score: this.score,
      justification: this.justification,
      recordedAtTurn: this.recordedAtTurn,
      recordedAt: this.recordedAt,
    };
  }

  static fromSerialized(data: AgentInternalScoreProps): AgentInternalScore {
    return new AgentInternalScore(
      data.topicName,
      data.score,
      data.justification,
      data.recordedAtTurn,
      data.recordedAt,
    );
  }
}
```

**Invariant check:** Score range is policy (0–5); other fields validated at boundary; immutable.

#### A3. Update value-object barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/entities/interview/value-objects/index.ts` (MODIFY)

Append:

```typescript
export { AgentNote } from "./agent-note.js";
export type { AgentNoteProps } from "./agent-note.js";
export { AgentInternalScore } from "./agent-internal-score.js";
export type { AgentInternalScoreProps } from "./agent-internal-score.js";
```

#### A4. Extend `Interview` aggregate

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/entities/interview/interview.entity.ts` (MODIFY)

**What:** Add `notes: ReadonlyArray<AgentNote>` and `internalScores: ReadonlyArray<AgentInternalScore>` collections. Three new mutators (`appendTranscriptEntry`, `appendNote`, `appendInternalScore`). Update `serialize()` / `fromSerialized()` / `withChanges()` / constructor.

```typescript
// New imports
import {
  // … existing imports
  AgentNote,
  type AgentNoteProps,
  AgentInternalScore,
  type AgentInternalScoreProps,
} from "./value-objects/index.js";

// Updated InterviewSerialized
export interface InterviewSerialized {
  // … existing fields, plus:
  readonly notes: ReadonlyArray<AgentNoteProps>;
  readonly internalScores: ReadonlyArray<AgentInternalScoreProps>;
}

// Updated constructor signature — add two new readonly array params, push them
// to the bottom of the parameter list to minimise diff churn:
//   readonly notes: ReadonlyArray<AgentNote>,
//   readonly internalScores: ReadonlyArray<AgentInternalScore>,

// Interview.create(...) now defaults both arrays to Object.freeze([]).

// Three new mutators:
appendTranscriptEntry(
  entry: TranscriptEntry,
): Result<Interview, InvalidInterviewStateTransitionError> {
  if (this.status !== INTERVIEW_STATUS.IN_PROGRESS) {
    return Result.Err(
      new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.IN_PROGRESS),
    );
  }
  return Result.Ok(
    this.withChanges({ transcript: Object.freeze([...this.transcript, entry]) }),
  );
}

appendNote(note: AgentNote): Result<Interview, InvalidInterviewStateTransitionError> {
  if (this.status !== INTERVIEW_STATUS.IN_PROGRESS) {
    return Result.Err(
      new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.IN_PROGRESS),
    );
  }
  return Result.Ok(this.withChanges({ notes: Object.freeze([...this.notes, note]) }));
}

appendInternalScore(
  score: AgentInternalScore,
): Result<Interview, InvalidInterviewStateTransitionError> {
  if (this.status !== INTERVIEW_STATUS.IN_PROGRESS) {
    return Result.Err(
      new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.IN_PROGRESS),
    );
  }
  return Result.Ok(
    this.withChanges({ internalScores: Object.freeze([...this.internalScores, score]) }),
  );
}

// serialize() adds:
//   notes: this.notes.map((n) => n.serialize()),
//   internalScores: this.internalScores.map((s) => s.serialize()),

// fromSerialized adds:
//   Object.freeze(data.notes.map((n) => AgentNote.fromSerialized(n))),
//   Object.freeze(data.internalScores.map((s) => AgentInternalScore.fromSerialized(s))),

// withChanges patch type adds:
//   notes?: ReadonlyArray<AgentNote>;
//   internalScores?: ReadonlyArray<AgentInternalScore>;
```

**Invariant check:**

- All three mutators return `Result<Interview, InvalidInterviewStateTransitionError>` and reject when not `IN_PROGRESS`. Reusing the existing error class is fine — the new methods are state-gated transitions in the same family as `start` / `complete`.
- All fields stay `readonly`; `withChanges` clones into a new instance (immutability invariant).
- `serialize()` / `fromSerialized()` are symmetrical: every persisted field round-trips.
- The `InterviewSerialized` extension is **not** backward-compatible with rows written before Phase 5. Mitigation: the migration in Batch C sets the new columns to `'[]'::jsonb` for existing rows, so `fromSerialized` always sees an empty array, never `undefined`.

#### A5. Update interview entity barrel and shared barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/entities/interview/index.ts` (MODIFY)

The existing `export *` from `./value-objects/index.js` already re-exports value objects. Confirm `AgentNote` and `AgentInternalScore` are reachable via `@repo/domain` after rebuild.

#### A6. Tests for Batch A

**Files (CREATE):**

- `packages/domain/src/entities/interview/value-objects/agent-note.test.ts`
- `packages/domain/src/entities/interview/value-objects/agent-internal-score.test.ts`
- Update existing `packages/domain/src/entities/interview/interview.entity.test.ts` (MODIFY) to cover the three new mutators and the round-trip of the two new collections

**Test categories:**

| File | Tests |
|---|---|
| `agent-note.test.ts` | create accepts valid; rejects empty note; rejects negative `recordedAtTurn`; rejects fractional `recordedAtTurn`; serialize / fromSerialized round-trip |
| `agent-internal-score.test.ts` | create accepts valid; rejects empty topicName; rejects empty justification; rejects score < 0; rejects score > 5; rejects fractional `recordedAtTurn`; serialize / fromSerialized round-trip |
| `interview.entity.test.ts` (added cases) | `appendTranscriptEntry` rejects when status is CREATED / SCHEDULED / COMPLETED / EVALUATED / CANCELLED; `appendTranscriptEntry` succeeds when IN_PROGRESS and produces a new instance with the entry appended; same shape for `appendNote` and `appendInternalScore`; `serialize` round-trip preserves both new arrays; `complete` after a few `appendTranscriptEntry` calls preserves the appended entries in the final transcript |

**Mocks:** none — pure domain.

#### Batch A verification

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
```

Application and backend may type-fail in this batch because `Interview.fromSerialized` now requires `notes` and `internalScores` — that's fine, Batch B / C / D fix them. Domain tests must pass.

---

### Batch B — Application: agent port + system prompt assembler + use case + DTO

#### B1. Create agent port error file

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/interview-agent/interview-agent-error.ts` (CREATE)

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class AgentError extends ServiceInfraError {}

export class AgentUnavailableError extends AgentError {
  readonly code = "AGENT_UNAVAILABLE";
}

export class AgentToolInputInvalidError extends AgentError {
  readonly code = "AGENT_TOOL_INPUT_INVALID";

  constructor(
    message: string,
    readonly interviewId: string,
    readonly toolName: string,
  ) {
    super(message);
  }
}

export class AgentTurnTimeoutError extends AgentError {
  readonly code = "AGENT_TURN_TIMEOUT";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class AgentUnknownError extends AgentError {
  readonly code = "AGENT_UNKNOWN";

  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
```

**Invariant check:** Mirrors `PlannerError` hierarchy. All extend `ServiceInfraError`. No domain leakage.

#### B2. Create agent port interface

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/interview-agent/interview-agent.port.ts` (CREATE)

```typescript
import type { Result } from "@carbonteq/fp";
import type { AgentError } from "./interview-agent-error.js";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  readonly role: AgentMessageRole;
  readonly content: string;
  /** Tool call tag for `role === "tool"` messages. */
  readonly toolName?: string;
}

export const END_INTERVIEW_REASON = {
  ALL_TOPICS_COVERED: "all_topics_covered",
  CANDIDATE_NOT_A_FIT: "candidate_not_a_fit",
  CANDIDATE_REQUESTED_END: "candidate_requested_end",
  TIME_UP: "time_up",
} as const;

export type EndInterviewReason =
  (typeof END_INTERVIEW_REASON)[keyof typeof END_INTERVIEW_REASON];

export type AgentToolEvent =
  | {
      readonly kind: "next_question";
      readonly topicName: string;
      readonly question: string;
    }
  | {
      readonly kind: "score_answer";
      readonly topicName: string;
      readonly score: number;
      readonly justification: string;
    }
  | { readonly kind: "take_note"; readonly note: string }
  | { readonly kind: "end_interview"; readonly reason: EndInterviewReason };

export interface AgentTurnInput {
  readonly interviewId: string;
  readonly turnIndex: number;
  readonly systemPrompt: string;
  readonly conversationHistory: ReadonlyArray<AgentMessage>;
  /** When non-null, the use case asks the adapter to inject this string as a `system`-role message before the user turn. */
  readonly timeRemainingMessage: string | null;
  readonly abortSignal: AbortSignal;
}

export type AgentStopReason = "tool_call_complete" | "stop" | "abort" | "error";

export interface AgentTurnOutput {
  readonly text: string;
  readonly toolEvents: ReadonlyArray<AgentToolEvent>;
  readonly stopReason: AgentStopReason;
  /** Set when the model exposed token usage; the adapter may always populate. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface IInterviewAgentService {
  /**
   * Run one agent turn. The adapter is responsible for opening
   * `interview.turn.agent` OTel span and emitting AI SDK telemetry.
   * The adapter does NOT mutate domain aggregates; tool effects
   * are returned via `toolEvents` and the use case translates them.
   */
  runTurn(input: AgentTurnInput): Promise<Result<AgentTurnOutput, AgentError>>;
}
```

**Invariant check:**

- `Promise<Result<…>>` for setup failures; mid-stream and tool-input errors are surfaced as `Result.Err` not via thrown iterators (the agent has no per-token streaming exposed at the port level — D10).
- No infrastructure types; no AI SDK imports.
- `AbortSignal` carries the controller's WS-close-driven cancellation plus the hard-ceiling timer.

#### B3. Create agent port barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/interview-agent/index.ts` (CREATE)

```typescript
export type {
  AgentMessage,
  AgentMessageRole,
  AgentStopReason,
  AgentToolEvent,
  AgentTurnInput,
  AgentTurnOutput,
  EndInterviewReason,
  IInterviewAgentService,
} from "./interview-agent.port.js";
export { END_INTERVIEW_REASON } from "./interview-agent.port.js";
export {
  AgentError,
  AgentToolInputInvalidError,
  AgentTurnTimeoutError,
  AgentUnavailableError,
  AgentUnknownError,
} from "./interview-agent-error.js";
```

#### B4. Update ports root barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/index.ts` (MODIFY)

```typescript
export * from "./storage/index.js";
export * from "./document-extraction/index.js";
export * from "./interview-planner/index.js";
export * from "./speech-to-text/index.js";
export * from "./text-to-speech/index.js";
export * from "./interview-agent/index.js";
```

#### B5. Create system-prompt assembler

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/system-prompt-assembler.ts` (CREATE)

```typescript
import type {
  CandidateInfo,
  InterviewPlan,
  JobDescription,
} from "@repo/domain";

export interface SystemPromptInput {
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly interviewPlan: InterviewPlan;
}

export const assembleInterviewSystemPrompt = (
  input: SystemPromptInput,
): string => {
  const { jobDescription, candidateInfo, clientInstructions, interviewPlan } = input;
  const topicLines = interviewPlan.topics
    .map(
      (t, i) =>
        `  ${i + 1}. ${t.name} (${t.priority}, ~${t.timeAllocationMinutes}min)\n` +
        t.questions.map((q) => `     - ${q}`).join("\n"),
    )
    .join("\n");
  const mustAskLines = interviewPlan.mustAskQuestions
    .map((q, i) => `  ${i + 1}. ${q}`)
    .join("\n");

  return [
    "You are a professional technical interviewer conducting a short voice screening interview.",
    `The interview should aim for approximately ${interviewPlan.targetDurationMinutes} minutes; the system enforces a hard ceiling at ${interviewPlan.maxDurationMinutes} minutes.`,
    "",
    "Job description:",
    `  Title: ${jobDescription.title}`,
    `  Company: ${jobDescription.company}`,
    "  Responsibilities:",
    ...jobDescription.responsibilities.map((r) => `    - ${r}`),
    "  Requirements:",
    ...jobDescription.requirements.map((r) => `    - ${r}`),
    "",
    "Candidate profile:",
    `  Name: ${candidateInfo.fullName}`,
    `  Headline: ${candidateInfo.headline}`,
    `  Years of experience: ${candidateInfo.yearsOfExperience}`,
    `  Skills: ${candidateInfo.skills.join(", ")}`,
    "",
    "Client instructions:",
    clientInstructions.trim() ? `  ${clientInstructions}` : "  (none)",
    "",
    "Interview plan (topics):",
    topicLines,
    "",
    "Must-ask questions:",
    mustAskLines.length > 0 ? mustAskLines : "  (none)",
    "",
    "How to use your tools:",
    "  - next_question(topicName, question): call when you advance to a new topic.",
    "  - score_answer(topicName, score (0-5), justification): call once per topic when you have enough signal.",
    "  - take_note(note): call when you observe something worth surfacing in the recruiter report.",
    "  - end_interview(reason): call when all topics are covered, the candidate is clearly not a fit, or the candidate asks to end. Reason values: all_topics_covered, candidate_not_a_fit, candidate_requested_end, time_up.",
    "",
    "Behavioural guidelines:",
    "  - Stay professional and conversational. No filler.",
    "  - One question at a time. Wait for the candidate's full answer before responding.",
    "  - If the candidate goes off-topic, gently redirect.",
    "  - Score topics privately via score_answer; do not read scores out loud.",
    "  - You will receive periodic 'time check' system messages; use them to pace yourself.",
  ].join("\n");
};
```

**Invariant check:**

- Pure function. No side effects. No imports outside `@repo/domain` types.
- Domain VOs are read via their `readonly` fields, not via internals.

#### B6. Create the `ConductInterview` DTO

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/dtos/conduct-interview.dto.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { z } from "zod";
import type { TranscriptEntryProps } from "@repo/domain";
import type {
  AgentNoteProps,
  AgentInternalScoreProps,
  EndInterviewReason,
} from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const ConductInterviewInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type ConductInterviewInput = z.infer<typeof ConductInterviewInputSchema>;

export class ConductInterviewInputDto extends BaseDto<ConductInterviewInput> {
  static parse(
    raw: unknown,
  ): Result<ConductInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(ConductInterviewInputSchema, raw).map(
      (v) => new ConductInterviewInputDto(v),
    );
  }
}

export interface ConductInterviewOutput {
  readonly interviewId: string;
  readonly turnsCompleted: number;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly notes: ReadonlyArray<AgentNoteProps>;
  readonly internalScores: ReadonlyArray<AgentInternalScoreProps>;
  /** Mirrors what the agent emitted when it ended; null if the system forced end. */
  readonly endReason: EndInterviewReason | null;
  /** Whether the system enforced the hard ceiling. */
  readonly hardCeilingHit: boolean;
}
```

> **Note for the implementing agent.** Re-export `AgentNoteProps` and `AgentInternalScoreProps` from `@repo/domain` so the DTO can name them. They are already in `value-objects/index.ts` after Batch A. Re-export `EndInterviewReason` from the application package barrel after Batch B because it is defined in the agent port (not domain).

#### B7. Update DTOs barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/dtos/index.ts` (MODIFY)

Replace the `RunScriptedInterviewSession*` block with:

```typescript
export {
  ConductInterviewInputDto,
  ConductInterviewInputSchema,
} from "./conduct-interview.dto.js";
export type {
  ConductInterviewInput,
  ConductInterviewOutput,
} from "./conduct-interview.dto.js";
```

#### B8. Create `ConductInterviewUseCase`

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/conduct-interview.use-case.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  AgentInternalScore,
  AgentNote,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InvalidInterviewInputError,
  type IInterviewRepository,
  SPEAKER,
  TranscriptEntry,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnavailableError,
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type {
  AgentMessage,
  AgentToolEvent,
  AgentTurnOutput,
  EndInterviewReason,
  IInterviewAgentService,
} from "../../ports/interview-agent/index.js";
import type {
  ISpeechToTextService,
  TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import type { ITextToSpeechService } from "../../ports/text-to-speech/index.js";
import type { ConductInterviewOutput } from "../../dtos/conduct-interview.dto.js";
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

export interface ConductInterviewDeps {
  readonly interviews: IInterviewRepository;
  readonly agent: IInterviewAgentService;
  readonly stt: ISpeechToTextService;
  readonly tts: ITextToSpeechService;
  readonly clock?: () => Date;
  /** Inject the time-remaining message every K turns. 0 disables. Default 3. */
  readonly timeRemainingIntervalTurns?: number;
  /** Hard-ceiling grace period after `maxDurationMinutes` elapses. Default 30s. */
  readonly hardCeilingGraceSeconds?: number;
}

export interface ConductInterviewRuntimeInput {
  readonly interviewId: string;
  readonly candidateAudioIn: AsyncIterable<Uint8Array>;
  readonly agentAudioOut: (chunk: Uint8Array) => Promise<void>;
  readonly abortSignal: AbortSignal;
}

export class ConductInterviewUseCase extends UseCase<
  ConductInterviewRuntimeInput,
  ConductInterviewOutput
> {
  constructor(private readonly deps: ConductInterviewDeps) {
    super();
  }

  async execute(
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<ConductInterviewOutput, ServiceError>> {
    const clock = this.deps.clock ?? (() => new Date());
    const interval = this.deps.timeRemainingIntervalTurns ?? 3;
    const graceSeconds = this.deps.hardCeilingGraceSeconds ?? 30;

    // 1. Load aggregate.
    const loadResult = await this.deps.interviews.findById(input.interviewId);
    if (loadResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(loadResult.unwrapErr().message, "InterviewRepository.findById"),
      );
    }
    const interviewOpt = loadResult.unwrap();
    if (interviewOpt.isNone()) {
      return Result.Err(new InterviewNotFoundError(input.interviewId));
    }
    let interview = interviewOpt.unwrap();
    const planOpt = interview.interviewPlan;
    if (planOpt.isNone()) {
      return Result.Err(
        new InvalidInterviewInputError(
          "Interview cannot be conducted without an InterviewPlan; run GenerateInterviewPlan first.",
        ),
      );
    }
    const plan = planOpt.unwrap();

    // 2. SCHEDULED → IN_PROGRESS. (CREATED → must run plan first.)
    const sessionStartedAt = clock();
    const startResult = interview.start(sessionStartedAt);
    if (startResult.isErr()) return Result.Err(startResult.unwrapErr() as ServiceError);
    interview = startResult.unwrap();
    const persistStart = await this.deps.interviews.save(interview);
    if (persistStart.isErr()) {
      return Result.Err(
        new ServiceUnknownError(persistStart.unwrapErr().message, "InterviewRepository.save"),
      );
    }
    interview = persistStart.unwrap();

    // 3. Hard-ceiling timer.
    const hardCeilingMs = plan.maxDurationMinutes * 60_000 + graceSeconds * 1000;
    const ownAbortController = new AbortController();
    let hardCeilingHit = false;
    const ceilingTimer = setTimeout(() => {
      hardCeilingHit = true;
      // Do NOT abort yet — give the agent one more turn to call end_interview.
    }, hardCeilingMs);
    // Compose: if the outer abort fires (WS close), also abort our work.
    input.abortSignal.addEventListener(
      "abort",
      () => ownAbortController.abort(),
      { once: true },
    );

    // 4. Build conversation state.
    const systemPrompt = assembleInterviewSystemPrompt({
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      interviewPlan: plan,
    });
    const history: AgentMessage[] = [];
    let turnIndex = 0;
    let endReason: EndInterviewReason | null = null;
    let agentEndedAfterTurn: number | null = null;
    let lastError: ServiceError | null = null;

    // 5. Turn loop.
    while (!input.abortSignal.aborted && !ownAbortController.signal.aborted) {
      const timeRemainingMessage = this.buildTimeRemaining(
        plan,
        sessionStartedAt,
        clock(),
        turnIndex,
        interval,
        hardCeilingHit,
      );

      // 5a. Agent turn.
      const turnResult = await this.deps.agent.runTurn({
        interviewId: input.interviewId,
        turnIndex,
        systemPrompt,
        conversationHistory: history,
        timeRemainingMessage,
        abortSignal: ownAbortController.signal,
      });
      if (turnResult.isErr()) {
        lastError = turnResult.unwrapErr() as ServiceError;
        break;
      }
      const turn = turnResult.unwrap();

      // 5b. Apply tool events to the aggregate.
      for (const event of turn.toolEvents) {
        const applied = await this.applyToolEvent(interview, event, turnIndex, clock);
        if (applied.isErr()) {
          lastError = applied.unwrapErr();
          break;
        }
        interview = applied.unwrap();
        if (event.kind === "end_interview") {
          endReason = event.reason;
          agentEndedAfterTurn = turnIndex;
        }
      }
      if (lastError) break;

      // 5c. Append agent transcript entry, persist, speak.
      const agentEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.AGENT,
        text: turn.text,
        timestamp: clock(),
      });
      if (agentEntryResult.isErr()) {
        lastError = agentEntryResult.unwrapErr() as ServiceError;
        break;
      }
      const appendAgent = interview.appendTranscriptEntry(agentEntryResult.unwrap());
      if (appendAgent.isErr()) {
        lastError = appendAgent.unwrapErr() as ServiceError;
        break;
      }
      interview = appendAgent.unwrap();
      history.push({ role: "assistant", content: turn.text });

      const speakResult = await this.speakTurn(turn.text, input.interviewId, turnIndex, input);
      if (speakResult.isErr()) {
        lastError = speakResult.unwrapErr();
        break;
      }

      // 5d. End conditions checked AFTER speech, BEFORE STT.
      if (agentEndedAfterTurn === turnIndex) {
        // Persist the final state; loop exits cleanly.
        const persisted = await this.deps.interviews.save(interview);
        if (persisted.isErr()) {
          lastError = new ServiceUnknownError(
            persisted.unwrapErr().message,
            "InterviewRepository.save",
          );
          break;
        }
        interview = persisted.unwrap();
        break;
      }
      if (hardCeilingHit && agentEndedAfterTurn === null) {
        // Inject one final wrap-up reminder, but do not yet abort.
        // We give the agent exactly one more turn (the next loop iteration).
        // If that turn doesn't end the interview, the next iteration's
        // hardCeilingHit + already-injected reminder => abort below.
        // We track via a sticky flag: once injected once, the next-time path aborts.
      }

      // 5e. STT — wait for candidate answer (one final transcript).
      const sttResult = await this.deps.stt.transcribe(input.candidateAudioIn, {
        interviewId: input.interviewId,
        turnIndex,
      });
      if (sttResult.isErr()) {
        lastError = sttResult.unwrapErr() as ServiceError;
        break;
      }
      const finalTextResult = await this.collectFinalTranscript(
        sttResult.unwrap(),
        input.abortSignal,
      );
      if (finalTextResult.isErr()) {
        lastError = finalTextResult.unwrapErr();
        break;
      }
      const candidateText = finalTextResult.unwrap();

      const candidateEntryResult = TranscriptEntry.create({
        speaker: SPEAKER.CANDIDATE,
        text: candidateText,
        timestamp: clock(),
      });
      if (candidateEntryResult.isErr()) {
        lastError = candidateEntryResult.unwrapErr() as ServiceError;
        break;
      }
      const appendCandidate = interview.appendTranscriptEntry(candidateEntryResult.unwrap());
      if (appendCandidate.isErr()) {
        lastError = appendCandidate.unwrapErr() as ServiceError;
        break;
      }
      interview = appendCandidate.unwrap();
      history.push({ role: "user", content: candidateText });

      // 5f. Persist after each completed turn.
      const persistTurn = await this.deps.interviews.save(interview);
      if (persistTurn.isErr()) {
        lastError = new ServiceUnknownError(
          persistTurn.unwrapErr().message,
          "InterviewRepository.save",
        );
        break;
      }
      interview = persistTurn.unwrap();

      turnIndex += 1;

      // 5g. Hard ceiling enforcement after grace turn.
      if (hardCeilingHit && agentEndedAfterTurn === null && turnIndex > 0) {
        // We have already injected a "Hard ceiling reached" message and given
        // the agent one more turn. Abort now.
        ownAbortController.abort();
        lastError = new ServiceUnknownError(
          `Interview ${input.interviewId} exceeded hard ceiling`,
          "ConductInterview.hardCeiling",
        );
        break;
      }
    }
    clearTimeout(ceilingTimer);

    // 6. Final state: COMPLETED if we have at least one full turn AND lastError is null.
    if (lastError && interview.status === INTERVIEW_STATUS.IN_PROGRESS) {
      // Best-effort: keep the interview IN_PROGRESS, do not transition to COMPLETED on failure.
      // The persisted state already reflects the partial transcript / notes / scores.
      return Result.Err(lastError);
    }

    if (interview.status === INTERVIEW_STATUS.IN_PROGRESS) {
      const completeResult = interview.complete(clock(), interview.transcript);
      if (completeResult.isErr()) {
        return Result.Err(completeResult.unwrapErr() as ServiceError);
      }
      interview = completeResult.unwrap();
      const persisted = await this.deps.interviews.save(interview);
      if (persisted.isErr()) {
        return Result.Err(
          new ServiceUnknownError(persisted.unwrapErr().message, "InterviewRepository.save"),
        );
      }
      interview = persisted.unwrap();
    }

    return Result.Ok({
      interviewId: interview.id,
      turnsCompleted: turnIndex,
      transcript: interview.transcript.map((t) => t.serialize()),
      notes: interview.notes.map((n) => n.serialize()),
      internalScores: interview.internalScores.map((s) => s.serialize()),
      endReason,
      hardCeilingHit,
    });
  }

  private async applyToolEvent(
    interview: Interview,
    event: AgentToolEvent,
    turnIndex: number,
    clock: () => Date,
  ): Promise<Result<Interview, ServiceError>> {
    switch (event.kind) {
      case "next_question": {
        // No aggregate mutation; advancement is implicit in the agent's text turn.
        return Result.Ok(interview);
      }
      case "score_answer": {
        const scoreResult = AgentInternalScore.create({
          topicName: event.topicName,
          score: event.score,
          justification: event.justification,
          recordedAtTurn: turnIndex,
          recordedAt: clock(),
        });
        if (scoreResult.isErr()) {
          return Result.Err(scoreResult.unwrapErr() as ServiceError);
        }
        const appended = interview.appendInternalScore(scoreResult.unwrap());
        return appended.mapErr((e) => e as ServiceError);
      }
      case "take_note": {
        const noteResult = AgentNote.create({
          note: event.note,
          recordedAtTurn: turnIndex,
          recordedAt: clock(),
        });
        if (noteResult.isErr()) {
          return Result.Err(noteResult.unwrapErr() as ServiceError);
        }
        const appended = interview.appendNote(noteResult.unwrap());
        return appended.mapErr((e) => e as ServiceError);
      }
      case "end_interview":
        return Result.Ok(interview);
    }
  }

  private async speakTurn(
    text: string,
    interviewId: string,
    turnIndex: number,
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<void, ServiceError>> {
    const ttsResult = await this.deps.tts.synthesize(text, {
      interviewId,
      turnIndex,
    });
    if (ttsResult.isErr()) return Result.Err(ttsResult.unwrapErr() as ServiceError);

    return Result.tryAsyncCatch(
      async () => {
        for await (const chunk of ttsResult.unwrap()) {
          if (input.abortSignal.aborted) break;
          await input.agentAudioOut(chunk);
        }
      },
      (err) =>
        new ServiceUnknownError(
          err instanceof Error ? err.message : String(err),
          "ConductInterview.tts.consume",
        ),
    ).toPromise();
  }

  private async collectFinalTranscript(
    chunks: AsyncIterable<TranscriptChunk>,
    abortSignal: AbortSignal,
  ): Promise<Result<string, ServiceError>> {
    return Result.tryAsyncCatch(
      async () => {
        const buf: string[] = [];
        for await (const chunk of chunks) {
          if (abortSignal.aborted) break;
          if (chunk.isFinal) {
            buf.push(chunk.text);
            break;
          }
        }
        return buf.join(" ").trim();
      },
      (err) =>
        new ServiceUnknownError(
          err instanceof Error ? err.message : String(err),
          "ConductInterview.stt.consume",
        ),
    ).toPromise();
  }

  private buildTimeRemaining(
    plan: { readonly targetDurationMinutes: number; readonly maxDurationMinutes: number },
    startedAt: Date,
    now: Date,
    turnIndex: number,
    interval: number,
    hardCeilingHit: boolean,
  ): string | null {
    if (hardCeilingHit) {
      return "Hard ceiling reached. End the interview now with end_interview(reason: 'time_up').";
    }
    if (interval <= 0) return null;
    if (turnIndex % interval !== 0) return null;
    const elapsedMs = now.getTime() - startedAt.getTime();
    const targetRemainingMs = Math.max(0, plan.targetDurationMinutes * 60_000 - elapsedMs);
    const maxRemainingMs = Math.max(0, plan.maxDurationMinutes * 60_000 - elapsedMs);
    const fmt = (ms: number): string => {
      const sec = Math.round(ms / 1000);
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      return `${mm}:${String(ss).padStart(2, "0")}`;
    };
    return `Time check (turn ${turnIndex}): ${fmt(targetRemainingMs)} remaining of soft target, ${fmt(maxRemainingMs)} before hard ceiling.`;
  }
}
```

**Invariant check:**

- No `throw` / `try/catch` in production paths. Every async external call is wrapped in `Result.tryAsyncCatch` or returns `Result` directly.
- Every domain construction is `isErr()`-checked before unwrap.
- `applyToolEvent` does not call infrastructure; pure aggregate mutation + Result chaining.
- The use case never imports infrastructure or framework types. `AbortSignal` is a Web API standard, not Fastify-specific.
- Per-turn persistence is enforced (D4). On error, the partial state is already durable.
- The hard-ceiling logic is the simple variant promised in D6.
- Output uses serialized props to keep the WS envelope cleanly cross-process.

#### B9. Update use-cases barrel (delete scripted, add conduct)

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/index.ts` (MODIFY)

Replace contents:

```typescript
export { CreateInterviewUseCase } from "./create-interview.use-case.js";
export { GenerateInterviewPlanUseCase } from "./generate-interview-plan.use-case.js";
export {
  ConductInterviewUseCase,
  type ConductInterviewDeps,
  type ConductInterviewRuntimeInput,
} from "./conduct-interview.use-case.js";
export { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";
export type { SystemPromptInput } from "./system-prompt-assembler.js";
```

#### B10. Delete Phase 4 scripted use case + DTO + tee + tests

**Files (DELETE):**

- `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts`
- `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.test.ts`
- `packages/application/src/use-cases/interview/scripted-interview-script.ts`
- `packages/application/src/use-cases/interview/scripted-interview-tee.ts`
- `packages/application/src/use-cases/interview/scripted-interview-tee.test.ts`
- `packages/application/src/dtos/run-scripted-interview-session.dto.ts`
- `packages/application/src/dtos/run-scripted-interview-session.dto.test.ts`

#### B11. Tests for Batch B

**Files (CREATE):**

- `packages/application/src/dtos/conduct-interview.dto.test.ts`
- `packages/application/src/use-cases/interview/system-prompt-assembler.test.ts`
- `packages/application/src/use-cases/interview/conduct-interview.use-case.test.ts`

**Test categories:**

| File | Tests |
|---|---|
| `conduct-interview.dto.test.ts` | parse with valid `interviewId`; parse rejects empty `interviewId`; parse rejects non-object input |
| `system-prompt-assembler.test.ts` | output contains JD title, JD company, candidate full name, all topic names, all must-ask questions, target / max durations, all four tool names; with empty client instructions, output contains `(none)`; with empty must-ask, output contains `(none)` |
| `conduct-interview.use-case.test.ts` | (1) interview not found → `InterviewNotFoundError`; (2) interview exists but plan absent → `InvalidInterviewInputError`; (3) repo.findById error → `ServiceUnknownError`; (4) interview must be SCHEDULED — interview in CREATED returns `InvalidInterviewStateTransitionError`; (5) happy path: 3 agent turns then `end_interview` → `endReason === "all_topics_covered"`, `turnsCompleted === 3`, transcript has 6 entries (alternating agent/candidate), `notes.length` matches `take_note` count, `internalScores.length` matches `score_answer` count; (6) per-turn save: `repo.save` is called once on start + once per turn + once on complete (so 1 + 2*N + 1 calls for N turns); (7) STT setup err short-circuits and does NOT transition to COMPLETED; (8) TTS setup err short-circuits; (9) agent err short-circuits; (10) abortSignal aborts mid-loop → status remains IN_PROGRESS, returns ServiceError; (11) hard-ceiling timer (use fake timers, plan with target=0.05min/max=0.1min): after the timer fires the next turn injects the wrap-up reminder, then if the agent doesn't end, the next iteration aborts; (12) time-remaining injection: with `interval=2`, agent receives non-null `timeRemainingMessage` on turns 0, 2, 4 only; with `interval=0`, agent never receives one; (13) tool event ordering: a turn that emits `take_note` then `next_question` mutates the aggregate in that exact order; (14) `score_answer` with score > 5 from the agent → use case returns `InvalidInterviewInputError` and aborts the turn (never persists the bad score) |

**Mocks:** in-memory `IInterviewAgentService`, `ISpeechToTextService`, `ITextToSpeechService`, and `IInterviewRepository` doubles. Use `vi.useFakeTimers()` for the hard-ceiling test. Never mock `Result`, `Option`, or domain entities.

#### Batch B verification

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application
pnpm turbo run test --filter=@repo/application
```

---

### Batch C — Infrastructure: Drizzle migration + Gemini agent adapter

#### C1. Add the Drizzle schema columns

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/persistence/schema/interviews.ts` (MODIFY)

Add to the `pgTable("interviews", ...)` columns block:

```typescript
notes: jsonb("notes")
  .$type<ReadonlyArray<AgentNoteProps>>()
  .notNull()
  .default(sql`'[]'::jsonb`),
internalScores: jsonb("internal_scores")
  .$type<ReadonlyArray<AgentInternalScoreProps>>()
  .notNull()
  .default(sql`'[]'::jsonb`),
```

Add the imports:

```typescript
import type {
  AgentInternalScoreProps,
  AgentNoteProps,
  // … existing
} from "@repo/domain";
```

#### C2. Generate the Drizzle migration

**Command:** Run `pnpm --filter backend db:generate`. The tool produces a new migration file under `apps/backend/drizzle/0001_*.sql`. Confirm the generated SQL includes:

```sql
ALTER TABLE "interviews"
  ADD COLUMN "notes" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "interviews"
  ADD COLUMN "internal_scores" jsonb NOT NULL DEFAULT '[]'::jsonb;
```

(Drizzle Kit emits the exact SQL based on the schema diff. The implementing agent should commit both the generated `.sql` file and the updated `meta/_journal.json` and `meta/0001_snapshot.json`.)

**Invariant check:** The migration is forward-only and idempotent on a clean DB. Existing rows get `'[]'::jsonb` from the `DEFAULT`. No data migration is needed because there are no production rows yet (Phase 5 ships before any production interview runs).

#### C3. Update `DrizzleInterviewRepository` row mappers

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts` (MODIFY)

Update both `rowToSerialized` and `serializedToInsertRow` to include the two new columns:

```typescript
const rowToSerialized = (row: InterviewRow): InterviewSerialized => ({
  // … existing fields, plus:
  notes: row.notes,
  internalScores: row.internalScores,
});

const serializedToInsertRow = (serialized: InterviewSerialized): InterviewInsertRow => ({
  // … existing fields, plus:
  notes: serialized.notes,
  internalScores: serialized.internalScores,
});
```

Also add the two columns to the UPSERT `set` clause:

```typescript
.onConflictDoUpdate({
  target: interviews.id,
  set: {
    // … existing
    notes: insertRow.notes,
    internalScores: insertRow.internalScores,
    updatedAt: insertRow.updatedAt,
  },
})
```

**Invariant check:** Symmetry between `rowToSerialized` and `serializedToInsertRow`; the upsert touches the same set of columns the entity exposes.

#### C4. Create Gemini agent provider entries

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/gemini/provider.ts` (MODIFY)

Add a constant for the agent's preferred model and read the env override:

```typescript
export const DEFAULT_GEMINI_AGENT_MODEL = "gemini-2.5-pro";

// Inside `geminiProviderFromEnv`:
//   defaultAgentModel: env["GEMINI_AGENT_MODEL"] ?? DEFAULT_GEMINI_AGENT_MODEL,
// Add to GeminiProviderHandle:
//   readonly defaultAgentModel: string;
```

**Why a separate model knob.** `GEMINI_MODEL` (already env-driven) is used by the Phase 3 planner and document extraction. Phase 5 adds `GEMINI_AGENT_MODEL` as an independent knob for the per-turn agent. The default is **quality-first**: `gemini-2.5-pro` matches Google's positioning of Pro as the strongest reasoning model — appropriate for an interviewer that must judge follow-ups, score answers, and decide when to end. `gemini-2.5-flash` is a valid env override for latency-sensitive deployments once Langfuse traces show Pro is the bottleneck inside the §3.3 latency budget; do not preempt that calibration. Keeping the agent model separate from the planner model also keeps the Phase 3 telemetry attribution clean.

> **Note for the implementing agent.** The handle expansion is non-breaking: existing consumers ignore `defaultAgentModel`. The agent service uses it; the planner service ignores it.

#### C5. Create `GeminiInterviewAgentService` adapter

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  jsonSchema,
  RetryError,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { trace, type Span } from "@opentelemetry/api";
import {
  AgentToolInputInvalidError,
  AgentTurnTimeoutError,
  AgentUnavailableError,
  AgentUnknownError,
  END_INTERVIEW_REASON,
  type AgentError,
  type AgentMessage,
  type AgentStopReason,
  type AgentToolEvent,
  type AgentTurnInput,
  type AgentTurnOutput,
  type IInterviewAgentService,
} from "@repo/application";
import type { GeminiProviderHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.gemini-agent");

const NEXT_QUESTION_INPUT = z.object({
  topicName: z.string().min(1),
  question: z.string().min(1),
});
const SCORE_ANSWER_INPUT = z.object({
  topicName: z.string().min(1),
  score: z.number().min(0).max(5),
  justification: z.string().min(1),
});
const TAKE_NOTE_INPUT = z.object({ note: z.string().min(1) });
const END_INTERVIEW_INPUT = z.object({
  reason: z.enum([
    END_INTERVIEW_REASON.ALL_TOPICS_COVERED,
    END_INTERVIEW_REASON.CANDIDATE_NOT_A_FIT,
    END_INTERVIEW_REASON.CANDIDATE_REQUESTED_END,
    END_INTERVIEW_REASON.TIME_UP,
  ]),
});

export class GeminiInterviewAgentService implements IInterviewAgentService {
  constructor(private readonly handle: GeminiProviderHandle) {}

  async runTurn(
    input: AgentTurnInput,
  ): Promise<Result<AgentTurnOutput, AgentError>> {
    const span: Span = tracer.startSpan("interview.turn.agent", {
      attributes: {
        "interview.id": input.interviewId,
        "interview.turn_index": input.turnIndex,
        "agent.model": this.handle.defaultAgentModel,
      },
    });

    const events: AgentToolEvent[] = [];
    const tools: ToolSet = {
      next_question: tool({
        description: "Advance to the next planned topic. Use once per topic transition.",
        inputSchema: NEXT_QUESTION_INPUT,
        execute: async (raw) => {
          events.push({
            kind: "next_question",
            topicName: raw.topicName,
            question: raw.question,
          });
          return { ok: true, topicName: raw.topicName, advancedAtTurn: input.turnIndex };
        },
      }),
      score_answer: tool({
        description:
          "Privately score the candidate's answer for a topic on a 0–5 scale. Not read out loud.",
        inputSchema: SCORE_ANSWER_INPUT,
        execute: async (raw) => {
          events.push({
            kind: "score_answer",
            topicName: raw.topicName,
            score: raw.score,
            justification: raw.justification,
          });
          return { ok: true, recordedAtTurn: input.turnIndex };
        },
      }),
      take_note: tool({
        description: "Record an observation for the recruiter report.",
        inputSchema: TAKE_NOTE_INPUT,
        execute: async (raw) => {
          events.push({ kind: "take_note", note: raw.note });
          return { ok: true, recordedAtTurn: input.turnIndex };
        },
      }),
      end_interview: tool({
        description:
          "End the interview. Use when topics are covered, candidate is not a fit, candidate asks to end, or the system has signalled time_up.",
        inputSchema: END_INTERVIEW_INPUT,
        execute: async (raw) => {
          events.push({ kind: "end_interview", reason: raw.reason });
          return { ok: true, willEndAfterTurn: input.turnIndex };
        },
      }),
    };

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: input.systemPrompt },
    ];
    for (const m of input.conversationHistory) {
      if (m.role === "tool") continue; // tool messages are reconstructed by AI SDK from tool calls
      messages.push({ role: m.role, content: m.content });
    }
    if (input.timeRemainingMessage) {
      messages.push({ role: "system", content: input.timeRemainingMessage });
    }

    return Result.tryAsyncCatch(
      async () => {
        const result = streamText({
          model: this.handle.provider(this.handle.defaultAgentModel),
          messages,
          tools,
          stopWhen: stepCountIs(4),
          abortSignal: input.abortSignal,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewAgentService.runTurn",
            metadata: {
              interviewId: input.interviewId,
              turnIndex: input.turnIndex,
            },
          },
        });

        // Drain the text stream — we need the full agent text for TTS.
        let text = "";
        for await (const chunk of result.textStream) {
          text += chunk;
        }
        // Wait for finish so usage / finishReason are available.
        const usage = await result.usage;
        const finishReason = await result.finishReason;

        const stopReason: AgentStopReason =
          finishReason === "stop" || finishReason === "length"
            ? "stop"
            : finishReason === "tool-calls"
              ? "tool_call_complete"
              : "stop";

        span.setAttribute("agent.tool_calls_count", events.length);
        span.setAttribute("agent.stop_reason", stopReason);
        if (typeof usage.inputTokens === "number") {
          span.setAttribute("agent.input_tokens", usage.inputTokens);
        }
        if (typeof usage.outputTokens === "number") {
          span.setAttribute("agent.output_tokens", usage.outputTokens);
        }
        span.end();

        const output: AgentTurnOutput = {
          text: text.trim(),
          toolEvents: Object.freeze([...events]),
          stopReason,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
        return output;
      },
      (err) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.end();
        return mapAgentError(err, input.interviewId);
      },
    ).toPromise();
  }
}

const isLikelyUnavailable = (err: unknown): err is Error => {
  if (!(err instanceof Error)) return false;
  if (RetryError.isInstance(err)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    /\b5\d\d\b/.test(msg)
  );
};

function mapAgentError(err: unknown, interviewId: string): AgentError {
  if (err instanceof Error && err.name === "AbortError") {
    return new AgentTurnTimeoutError(`Agent turn aborted: ${err.message}`, interviewId);
  }
  if (isLikelyUnavailable(err)) {
    return new AgentUnavailableError(
      `Gemini unavailable during agent turn: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Tool input validation errors thrown by AI SDK.
  if (err instanceof Error && err.name === "InvalidToolInputError") {
    return new AgentToolInputInvalidError(err.message, interviewId, "<unknown>");
  }
  return new AgentUnknownError(
    err instanceof Error ? err.message : String(err),
    "GeminiInterviewAgentService.runTurn",
  );
}
```

**Invariant check:**

- `Result.tryAsyncCatch` wraps the entire `streamText` consumption.
- Span lifecycle: open at top, close in `finally`-style (both success and failure paths via the `mapAgentError` and the success branch).
- Tool `execute` callbacks push to a closure-scoped `events` array — no infrastructure side effects, no DB writes.
- `messages` is built from system prompt + history + optional time-remaining; tool messages from history are skipped because AI SDK reconstructs them from prior tool calls via the per-turn message exchange (Phase 5 keeps state across turns by passing `assistant` text and `user` text only — Gemini does not retain tool-call state across separate `streamText` invocations, which is the desired behaviour: each turn is its own atomic "you have these four tools, here's the conversation, decide what to do").
- Mid-turn `abortSignal` is honoured by AI SDK natively.
- Telemetry settings mirror `GeminiInterviewPlannerService` exactly.

> **Note for the implementing agent.** AI SDK 6's exact API for `streamText` results is `result.textStream`, `await result.usage`, `await result.finishReason`. If the local installed version differs, surface the change as a Phase 5 risk note rather than papering over it. The plan signature was verified against `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/node_modules/ai/dist/index.d.ts:2812`.

#### C6. Update Gemini barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/gemini/index.ts` (MODIFY)

```typescript
export {
  buildGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_AGENT_MODEL,
  geminiProviderFromEnv,
} from "./provider.js";
export type { GeminiProviderConfig, GeminiProviderHandle } from "./provider.js";
export { GeminiDocumentExtractionService } from "./gemini-document-extraction.service.js";
export { GeminiInterviewPlannerService } from "./gemini-interview-planner.service.js";
export { GeminiInterviewAgentService } from "./gemini-interview-agent.service.js";
```

#### C7. Tests for Batch C

**Files (CREATE):**

- `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.test.ts`

Update existing test:

- `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts` (MODIFY) — add cases for `notes` and `internalScores` round-trip; assert that updates preserve all four collections (transcript, notes, internal scores, plus the existing fields).

**Test categories:**

| File | Tests |
|---|---|
| `gemini-interview-agent.service.test.ts` | mock `ai` (`vi.mock("ai", …)`) so `streamText` returns a fake handle. (1) happy path: `textStream` yields "Tell me…", no tools fire → `text === "Tell me…"`, `toolEvents.length === 0`, `stopReason === "stop"`; (2) `next_question` tool call → `toolEvents` contains one event with `kind: "next_question"`; (3) `score_answer` with score in range → event recorded; (4) `score_answer` with invalid input (score > 5) → AI SDK throws `InvalidToolInputError` → use case returns `Result.Err(AgentToolInputInvalidError)`; (5) `take_note` tool fires; (6) `end_interview` tool fires with reason `all_topics_covered`; (7) network 503 → `AgentUnavailableError`; (8) abortSignal triggers AbortError → `AgentTurnTimeoutError`; (9) span attributes: `agent.tool_calls_count`, `agent.stop_reason`, `agent.input_tokens`, `agent.output_tokens` are set on success; (10) span recordException is called on error |
| `drizzle-interview.repository.test.ts` (additions) | save Interview with `appendNote` then read back: notes round-trip; save with `appendInternalScore` then read back: scores round-trip; save with both: both round-trip; existing transcript-write tests still pass after the schema bump |

**Mocks:** mock `ai` at module level with a stub `streamText` that returns an object exposing a fake `textStream` (async generator) and `usage` / `finishReason` promises. Drive the events list by calling the test's `tool.execute` mock manually.

#### Batch C verification

```bash
pnpm turbo run check-types --filter=backend
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

Run `pnpm --filter backend db:migrate` against the test database before running the repository tests so the new columns exist.

---

### Batch D — Composition root + presentation update

#### D1. Update composition root

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/composition/interview-session.composition.ts` (MODIFY)

Replace the body of `buildInterviewSessionDeps`:

```typescript
import { ConductInterviewUseCase, type ConductInterviewDeps } from "@repo/application";
import { createRequire } from "node:module";
import {
  deepgramClientFromEnv,
  DeepgramSpeechToTextService,
} from "../infrastructure/services/deepgram/index.js";
import {
  elevenLabsClientFromEnv,
  ElevenLabsTextToSpeechService,
} from "../infrastructure/services/elevenlabs/index.js";
import {
  geminiProviderFromEnv,
  GeminiInterviewAgentService,
} from "../infrastructure/services/gemini/index.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
import type { InterviewSessionDeps } from "../presentation/controllers/interview-session.controller.js";

const require = createRequire(import.meta.url);

export interface InterviewSessionCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional injected DB handle. When omitted the composition root falls back
   * to the module-level singleton `db` exported from
   * `infrastructure/persistence/db.ts`. Tests must inject a fixture DB to
   * avoid coupling to module load order — see the implementing-agent note
   * below.
   */
  readonly db?: Database;
}

export function buildInterviewSessionDeps(
  options: InterviewSessionCompositionOptions = {},
): InterviewSessionDeps {
  const env = options.env ?? process.env;

  const dgHandle = deepgramClientFromEnv(env);
  if (dgHandle.isErr()) throw new Error(`Boot failed: ${dgHandle.unwrapErr().message}`);

  const elHandle = elevenLabsClientFromEnv(env);
  if (elHandle.isErr()) throw new Error(`Boot failed: ${elHandle.unwrapErr().message}`);

  const gmHandle = geminiProviderFromEnv(env);
  if (gmHandle.isErr()) throw new Error(`Boot failed: ${gmHandle.unwrapErr().message}`);

  // Resolve the DB handle. Prefer an injected handle (tests). Otherwise lazy-load
  // the module-level singleton: `db.ts` reads DATABASE_URL at import time and
  // throws synchronously if it's missing, so a top-level import would force every
  // composition test to set DATABASE_URL before the module graph loads. Lazy
  // require defers that throw to the first real boot.
  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const interviews = new DrizzleInterviewRepository(db);
  const stt = new DeepgramSpeechToTextService(dgHandle.unwrap());
  const tts = new ElevenLabsTextToSpeechService(elHandle.unwrap());
  const agent = new GeminiInterviewAgentService(gmHandle.unwrap());

  const interval = parseNonNegativeInt(
    env["INTERVIEW_TIME_REMAINING_INTERVAL_TURNS"],
    3,
  );
  const grace = parseNonNegativeInt(
    env["INTERVIEW_HARD_CEILING_GRACE_SECONDS"],
    30,
  );

  const useCaseDeps: ConductInterviewDeps = {
    interviews,
    agent,
    stt,
    tts,
    timeRemainingIntervalTurns: interval,
    hardCeilingGraceSeconds: grace,
  };

  return {
    buildUseCase: () => new ConductInterviewUseCase(useCaseDeps),
  };
}

/**
 * Parse a non-negative integer from env. Rejects fractional, negative, NaN,
 * Infinity values; falls back to `defaultValue` for missing or malformed input.
 * `0` is a valid result (e.g. disables time-remaining injection in tests).
 */
function parseNonNegativeInt(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return defaultValue;
  return n;
}
```

**Invariant check:** Composition root is the only place where Result-Err on env may legitimately throw. The DB connection is acquired once at boot and shared across sessions (Drizzle pool).

> **Note for the implementing agent — DB module shape (verified 2026-05-10).** `apps/backend/src/infrastructure/persistence/db.ts` exports a **module-level singleton** named `db` (typed as `Database`); there is **no** `getDb(env)` factory. The module reads `process.env.DATABASE_URL` at import time and throws synchronously if missing. Implications for Phase 5:
>
> 1. Use the lazy `require(...)` shown above instead of a top-level `import { db }`. A top-level import would force every composition unit test to set `DATABASE_URL` before the module graph loads — gratuitous coupling.
> 2. Composition tests inject a fixture `Database` through `InterviewSessionCompositionOptions.db`. The lazy require path is exercised only by the all-keys-present, no-injection test (which can also pass an injected `db` to keep CI hermetic).
> 3. If a future refactor introduces a `createDatabase(env)` factory, the composition root collapses to `const db = options.db ?? createDatabase(env)`. That refactor is **out of scope** for Phase 5 — leave a Phase 10 follow-up note rather than bundling it.

#### D2. Update controller

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/controllers/interview-session.controller.ts` (MODIFY)

Two changes:

1. Replace `RunScriptedInterviewSessionUseCaseLike` with `ConductInterviewUseCaseLike`:

```typescript
import type {
  ConductInterviewOutput,
  ConductInterviewRuntimeInput,
  ServiceError,
} from "@repo/application";

export interface ConductInterviewUseCaseLike {
  execute(
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<ConductInterviewOutput, ServiceError>>;
}

export interface InterviewSessionDeps {
  readonly buildUseCase: () => ConductInterviewUseCaseLike;
}
```

2. Rename the session span to `interview.session.agent` and remove the `interview.script_version` attribute:

```typescript
const sessionSpan = sessionTracer.startSpan("interview.session.agent", {
  attributes: { "interview.id": interviewId },
});
```

3. Extend `mapErrorToWsClose` to map the new agent error codes:

```typescript
export function mapErrorToWsClose(error: ServiceError): number {
  if (
    error.code === "STT_UNAVAILABLE" ||
    error.code === "TTS_UNAVAILABLE" ||
    error.code === "AGENT_UNAVAILABLE" ||
    error.code === "SERVICE_UNAVAILABLE"
  ) {
    return WS_CLOSE.SERVICE_RESTART;
  }
  if (error.code === "AGENT_TURN_TIMEOUT") {
    return WS_CLOSE.SERVICE_RESTART;
  }
  if (error.code === "INTERVIEW_NOT_FOUND" || error.code === "INVALID_INTERVIEW_INPUT") {
    return WS_CLOSE.POLICY_VIOLATION;
  }
  return WS_CLOSE.INTERNAL_ERROR;
}
```

**WebSocket close-code table (Phase 5 update):**

| Error code                                                 | Close code                | Mnemonic                |
| ---------------------------------------------------------- | ------------------------- | ----------------------- |
| DTO validation failed (bad `:id`)                          | 1008 POLICY_VIOLATION     | input rejected          |
| `INTERVIEW_NOT_FOUND` / `INVALID_INTERVIEW_INPUT`          | 1008 POLICY_VIOLATION     | invalid pre-state       |
| `STT_UNAVAILABLE` / `TTS_UNAVAILABLE` / `AGENT_UNAVAILABLE` | 1012 SERVICE_RESTART      | upstream down           |
| `AGENT_TURN_TIMEOUT`                                       | 1012 SERVICE_RESTART      | abort / timeout         |
| `AGENT_TOOL_INPUT_INVALID` / `AGENT_UNKNOWN`               | 1011 INTERNAL_ERROR       | server bug              |
| `STT_STREAM_ERROR` / `TTS_STREAM_ERROR` / `SERVICE_UNKNOWN_ERROR` | 1011 INTERNAL_ERROR | server bug              |
| `INVALID_INTERVIEW_STATE_TRANSITION` (from Interview)      | 1011 INTERNAL_ERROR       | aggregate state mismatch |
| Use case Ok                                                | 1000 NORMAL               | clean exit               |

#### D3. Update route file

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/routes/interview-session.ws.ts` (MODIFY)

The body is unchanged because the controller signature is the same (`(socket, req) => Promise<void>`). Only the comment / docstring wording shifts:

```typescript
// Phase 5: real Gemini agent driven via ConductInterviewUseCase.
// Phase 4 scripted path has been removed.
```

#### D4. Update controller tests

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/controllers/interview-session.controller.test.ts` (MODIFY)

Replace `RunScriptedInterviewSessionRuntimeInput` and `RunScriptedInterviewSessionOutput` with the conduct shapes. The `mockResolvedValue(Result.Ok({...}))` happy-path payload now includes `notes`, `internalScores`, `endReason`, `hardCeilingHit`. Add a new test:

```typescript
it("maps INTERVIEW_NOT_FOUND to policy violation", async () => {
  const ws = new FakeWebSocket();
  const notFound = Object.assign(new Error("Interview foo not found"), {
    code: "INTERVIEW_NOT_FOUND",
  }) as ServiceError;
  const controller = new InterviewSessionController({
    buildUseCase: () => ({ execute: vi.fn().mockResolvedValue(Result.Err(notFound)) }),
  });
  await controller.handle(ws as never, request("foo") as never);
  expect(ws.closes[0]).toEqual({ code: WS_CLOSE.POLICY_VIOLATION, reason: "Interview foo not found" });
});
```

#### D5. Update composition tests

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/composition/interview-session.composition.test.ts` (MODIFY)

Add cases for missing `GOOGLE_GENERATIVE_AI_API_KEY` (must throw at boot). The `DATABASE_URL` case is handled differently: because `db.ts` reads `DATABASE_URL` at import time and throws synchronously if missing, composition tests inject a fixture `Database` via `InterviewSessionCompositionOptions.db` rather than relying on the lazy require path. Add an explicit test that asserts injection works (`buildInterviewSessionDeps({ env, db: fakeDb })` returns successfully) and a smoke test that the lazy require path is *not* exercised when `db` is injected (no `process.env.DATABASE_URL` access). Update the all-keys-present case to provide the four service env vars (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, plus the optional knobs) and inject `db: fakeDb`; assert the returned `useCase.execute` is a function. Also assert that malformed knobs (`INTERVIEW_TIME_REMAINING_INTERVAL_TURNS=2.5` and `=-1`) fall back to the default `3` rather than producing fractional or negative values.

#### D6. Update WS route integration test

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/routes/interview-session.ws.test.ts` (MODIFY)

Inject a fake `ConductInterviewUseCase` via the `deps` option, drive the WS, assert:

1. The server-emitted JSON envelope `type: "session.completed"` and the new `payload` shape (with `notes`, `internalScores`, `endReason`, `hardCeilingHit`).
2. WS closes with code 1000.
3. The controller forwards `interviewId` from the URL path.

#### D7. Update env example

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/.env.example` (MODIFY)

Append:

```
GEMINI_AGENT_MODEL=gemini-2.5-pro
INTERVIEW_TIME_REMAINING_INTERVAL_TURNS=3
INTERVIEW_HARD_CEILING_GRACE_SECONDS=30
```

#### Batch D verification

```bash
pnpm turbo run check-types --filter=backend
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

---

### Batch E — Latency harness update + cleanup

#### E1. Update latency harness for the new envelope

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/scripts/measure-voice-latency.ts` (MODIFY)

The script's only Phase-5-relevant change is the JSON envelope shape. Update the message handler that parses `session.completed`:

```typescript
const env = JSON.parse(data.toString("utf-8")) as {
  type: string;
  payload?: {
    interviewId: string;
    turnsCompleted: number;
    transcript: unknown[];
    notes: unknown[];
    internalScores: unknown[];
    endReason: string | null;
    hardCeilingHit: boolean;
  };
};
if (env.type === "session.completed" && env.payload) {
  console.log(
    `session.completed: turns=${env.payload.turnsCompleted}, notes=${env.payload.notes.length}, scores=${env.payload.internalScores.length}, endReason=${env.payload.endReason}, ceiling=${env.payload.hardCeilingHit}`,
  );
  ws.close();
}
```

The harness still streams a WAV file as raw audio frames; the loop / silence-detection heuristic is unchanged from Phase 4.

> **Note for the implementing agent.** The harness header comment must call out that Phase 5 expects the candidate WAV to contain at least one full utterance per agent turn. Phase 4's hardcoded 4-question script was forgiving; the Phase 5 agent will keep going until tools fire end_interview. For smoke testing, prefer a recorded conversation (5–8 candidate utterances) or accept that the harness will hit the hard ceiling.

#### E2. Confirm Phase 4 deletes propagated

Run:

```bash
rg -n "RunScriptedInterviewSession|SCRIPTED_INTERVIEW_QUESTIONS|scripted-interview" packages/ apps/backend/src/
```

Result should be **empty**. If anything remains, delete it.

#### Batch E verification

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

All four must pass. After this, the implementation is done; remaining work is verification, ADR authoring, and live smoke.

---

### Batch F — ADR authoring

#### F1. Author ADR-013

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/docs/adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md` (CREATE)

**Title:** *ADR-013 Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface*

**Decision** (one consolidated ADR covering D1, D2, D3, D4, D5):

- The agent receives exactly four tools: `next_question`, `score_answer`, `take_note`, `end_interview` (D1). The Zod schemas, score range (0–5), and `EndInterviewReason` enum are normative.
- Notes and internal scores are persisted on the `Interview` aggregate as JSONB columns `notes` and `internal_scores` (D2). Two new value objects (`AgentNote`, `AgentInternalScore`) and three new aggregate mutators (`appendTranscriptEntry`, `appendNote`, `appendInternalScore`) are the canonical mutation API.
- Time-remaining is injected per-turn via a `system`-role message every K turns (configurable; default K=3) (D3).
- Transcript persistence is per-turn via `repo.save(updated)` after each completed agent + candidate exchange (D4).
- Tool effects flow through a typed `AgentToolEvent[]` returned from the agent port; the use case translates events into aggregate mutations (D5).

**Alternatives Considered:** at least two per decision (the in-memory-only alternative for D2/D4; the run-conversation iterator alternative for D10; the streaming-token-by-token TTS alternative for the speak-turn helper; the periodic wall-clock injection alternative for D3; the single combined `score_and_note` tool alternative for D1).

**Enforcement** (declarative + LLM judge):

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

The `llm_judge: true` flag covers semantic checks: (a) tool surface is not silently extended, (b) per-turn save is invoked on every loop iteration, (c) tool effects do not bypass the use case.

**Status:** `Proposed` initially. Flipped to `Accepted` only after human review per the ADR Kit workflow.

#### F2. Author ADR-014 (optional)

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/docs/adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md` (CREATE, optional)

**Title:** *ADR-014 Extend OTel Span Hierarchy with `interview.turn.agent` and Unify Session Span as `interview.session.agent`*

A short ADR that:

- Adds `interview.turn.agent` to the canonical span name list (extends ADR-012).
- Documents the rename from `interview.session.scripted` (Phase 4) to `interview.session.agent` (Phase 5).
- Records the agent span attribute schema (`agent.model`, `agent.tool_calls_count`, `agent.stop_reason`, `agent.input_tokens`, `agent.output_tokens`).

This is optional because ADR-012's enforcement block already permits any `interview.turn.*` namespace. Authoring ADR-014 makes the agent attribute schema discoverable to Phase 6, which will add `interview.evaluation.*` spans. Recommend authoring it.

#### F3. Update ADR README

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/docs/adr/README.md` (MODIFY)

Append entries for ADR-013 and ADR-014.

---

### Batch G — Verification + code review + progress doc

#### G1. Final verification

In order, in a single session, after all batches A–F land:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

Expected counts (rough guide; update once tests are written):

- domain: ~125 tests (was 116; +5 for AgentNote, +6 for AgentInternalScore, +6 for new mutators on Interview)
- application: ~85 tests (was 73; remove Phase 4 scripted/dto/tee tests, add ConductInterview suite of ~14 tests, system-prompt-assembler suite of ~5, conduct-dto suite of ~3)
- backend: ~95 tests (was 79; add agent service tests of ~10, update repository tests +2, update controller tests +1, update composition tests +1)

#### G2. `/backend-arch-validator`

Run against three layers:

```
/backend-arch-validator application
/backend-arch-validator infrastructure
/backend-arch-validator presentation
```

Expected to pass without violations. The boundaries Phase 5 stretches:

- Application imports `@repo/domain` only — confirmed by inspection of every new file.
- Infrastructure imports `@repo/domain` + `@repo/application` only — confirmed.
- Presentation imports `@repo/domain` + `@repo/application` + composition root — confirmed.

#### G3. `backend-code-reviewer`

Run with the plan path and the full file list. Iterate to PASS per Rule 7. Specific items to flag for self-review **before** invoking the reviewer:

- Every `Result.tryAsyncCatch` callback returns the right error subclass (no bare `Error`).
- Every `interview.appendXxx(...)` is `isErr()`-checked before unwrap.
- The agent service's tool `execute` callbacks do not call any domain or repository code.
- The hard-ceiling timer is cleared in every exit path of the use case (success, error, abort).
- The use case's clock is injectable for tests.

#### G4. Author the progress document

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/docs/progress/phase-5.md` (CREATE)

Match the structure of `phase-4.md`:

- Phase summary (what shipped, what didn't)
- Implementation notes (any deviations from this plan, including AI SDK API drift discoveries)
- Files touched (grouped by layer)
- Verification (commands run, test counts, type-check status)
- Live smoke (deferred or completed; see G5 below)
- ADRs accepted (link ADR-013 and ADR-014 if authored)
- Code review (first-pass + final-pass status)
- Follow-up (Phase 6 expectations)

#### G5. Live smoke (deferred until keys + DB are available)

Mirror Phase 4's live-smoke approach:

1. Start a Postgres in Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`.
2. Run migrations: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter backend db:migrate`.
3. Seed an interview row that is in `SCHEDULED` state with a real `InterviewPlan` (use the Phase 3 use cases or a one-shot script).
4. Boot the backend with all five keys set: `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
5. Run the latency harness: `pnpm --filter backend exec tsx src/scripts/measure-voice-latency.ts --wav <conversation.wav> --interview-id <seeded-id> --url ws://localhost:3002/interviews/<seeded-id>/session`.
6. Inspect Langfuse for the trace tree:
   - one `interview.session.agent` span
   - one `interview.turn.agent` per turn
   - one `interview.turn.tts` per turn
   - one `interview.turn.stt` per turn
   - one AI SDK Generation span per turn (the auto-emitted Gemini call)
7. Inspect the Postgres `interviews` row: `transcript` populated, `notes` populated (if `take_note` fired), `internal_scores` populated (if `score_answer` fired), status `COMPLETED`.

Document the run with the trace ID and the row dump in `phase-5.md`, identical to how Phase 4 documented its smoke results.

---

## Pseudo-workflow (end-to-end request)

The full request flow from WS upgrade to `session.completed`:

1. **Browser** opens `ws://backend/interviews/{id}/session`.
2. **Fastify + @fastify/websocket** upgrade the connection. The route handler calls `InterviewSessionController.handle(socket, req)`.
3. **Controller** validates `:id` via `ConductInterviewInputDto.parse({ interviewId: req.params.id })` → `Result<DTO, DtoValidationError>`. On `Err`: `ws.close(1008, "invalid interview id")`.
4. **Controller** opens session OTel span `interview.session.agent` with `interview.id` attribute.
5. **Controller** adapts the WebSocket via the existing helpers in `voice-websocket.ts`:
   - `candidateAudioIn`: AsyncIterable backed by `ws.on("message", binary)`.
   - `agentAudioOut`: callback that does `ws.send(chunk, { binary: true })`.
6. **Controller** calls `useCase.execute(...)` inside `otelContext.with(sessionContext, …)` so child spans nest correctly.
7. **Use case** loads the `Interview` aggregate via `repo.findById(interviewId)` — `Promise<Result<Option<Interview>, Error>>`.
   - On repo error: map to `ServiceUnknownError`.
   - On `Option.None`: return `InterviewNotFoundError`.
   - If `interviewPlan` is `None`: return `InvalidInterviewInputError("plan required")`.
8. **Use case** transitions `SCHEDULED → IN_PROGRESS` via `interview.start(now)` → `Result<Interview, InvalidInterviewStateTransitionError>`.
9. **Use case** persists the `IN_PROGRESS` aggregate (`repo.save`).
10. **Use case** starts the hard-ceiling timer (`maxDurationMinutes * 60_000 + graceSeconds * 1000` ms).
11. **Use case** assembles the system prompt via `assembleInterviewSystemPrompt(...)`.
12. **Turn loop iteration N:**
    - **Use case** computes the per-turn time-remaining message (or `null` if N % interval ≠ 0).
    - **Use case** calls `agent.runTurn({ interviewId, turnIndex: N, systemPrompt, conversationHistory, timeRemainingMessage, abortSignal })` → `Promise<Result<AgentTurnOutput, AgentError>>`.
    - **Agent adapter** opens span `interview.turn.agent`.
    - **Agent adapter** calls AI SDK `streamText` with the four tools, `stopWhen: stepCountIs(4)`, `experimental_telemetry`. Tools' `execute` callbacks push to a closure `events: AgentToolEvent[]`.
    - **AI SDK** auto-emits a Generation span (Gemini call) under the active context.
    - **Agent adapter** drains `result.textStream`, awaits `usage` and `finishReason`, sets span attributes, ends span.
    - **Agent adapter** returns `AgentTurnOutput { text, toolEvents, stopReason, inputTokens, outputTokens }`.
    - **Use case** applies each tool event:
      - `next_question` → no-op on aggregate.
      - `score_answer` → build `AgentInternalScore.create(...)`, append via `interview.appendInternalScore(...)`.
      - `take_note` → build `AgentNote.create(...)`, append via `interview.appendNote(...)`.
      - `end_interview` → set `endReason` and `agentEndedAfterTurn`.
    - **Use case** appends the agent's text to the transcript via `interview.appendTranscriptEntry(SPEAKER.AGENT, text, now)`, pushes `assistant`-role message to history.
    - **Use case** synthesises the agent text via `tts.synthesize(text, { interviewId, turnIndex: N })` → `Promise<Result<AsyncIterable<Uint8Array>, TtsError>>`.
    - **TTS adapter** opens span `interview.turn.tts`, returns the audio stream.
    - **Use case** iterates the TTS stream and pumps chunks into `agentAudioOut(...)`.
    - If `agentEndedAfterTurn === N`: persist (`repo.save`) and break.
    - Otherwise call `stt.transcribe(candidateAudioIn, { interviewId, turnIndex: N })` → `Promise<Result<AsyncIterable<TranscriptChunk>, SttError>>`.
    - **STT adapter** opens span `interview.turn.stt`, returns the transcript stream.
    - **Use case** consumes the stream until first `isFinal === true`, builds `TranscriptEntry`, appends via `interview.appendTranscriptEntry(SPEAKER.CANDIDATE, …)`, pushes `user`-role message to history.
    - **Use case** persists the aggregate (`repo.save`) — per-turn durability.
    - Loop continues with `N+1`.
13. **Loop exit:**
    - Clean exit (`endReason !== null`) → use case calls `interview.complete(now, transcript)` → persists → returns `Result.Ok(ConductInterviewOutput)`.
    - Hard-ceiling exit → returns `Result.Err(ServiceUnknownError("hard ceiling exceeded"))` and leaves the aggregate `IN_PROGRESS`.
    - Any error → returns `Result.Err(error)` and leaves the aggregate at the last persisted state.
14. **Controller** clears the hard-ceiling timer.
15. **Controller** maps Ok → JSON envelope `{type: "session.completed", payload: ConductInterviewOutput}`, sends via `ws.send`, then `ws.close(1000)`.
16. **Controller** maps Err → `mapErrorToWsClose(err)` → `ws.close(<code>, message.slice(0, 120))`.
17. **Controller** ends the session span in the `finally` block.

---

## Entry points (dependency-ordered)

| #  | File                                                                                                                         | Layer        | Operation | Purpose                                                                        |
| -- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ | --------- | ------------------------------------------------------------------------------ |
| 1  | `packages/domain/src/entities/interview/value-objects/agent-note.ts`                                                         | domain       | CREATE    | `AgentNote` value object                                                       |
| 2  | `packages/domain/src/entities/interview/value-objects/agent-internal-score.ts`                                               | domain       | CREATE    | `AgentInternalScore` value object                                              |
| 3  | `packages/domain/src/entities/interview/value-objects/index.ts`                                                              | domain       | MODIFY    | Re-export new VOs                                                              |
| 4  | `packages/domain/src/entities/interview/interview.entity.ts`                                                                 | domain       | MODIFY    | Add notes / scores / 3 mutators / serialise extension                          |
| 5  | `packages/domain/src/entities/interview/value-objects/agent-note.test.ts`                                                    | domain test  | CREATE    | VO factory + serialise tests                                                   |
| 6  | `packages/domain/src/entities/interview/value-objects/agent-internal-score.test.ts`                                          | domain test  | CREATE    | VO factory + serialise tests                                                   |
| 7  | `packages/domain/src/entities/interview/interview.entity.test.ts`                                                            | domain test  | MODIFY    | Add cases for 3 new mutators + serialise round-trip                            |
| 8  | `packages/application/src/ports/interview-agent/interview-agent-error.ts`                                                    | application  | CREATE    | `AgentError` hierarchy                                                         |
| 9  | `packages/application/src/ports/interview-agent/interview-agent.port.ts`                                                     | application  | CREATE    | `IInterviewAgentService` + types                                               |
| 10 | `packages/application/src/ports/interview-agent/index.ts`                                                                    | application  | CREATE    | Barrel                                                                         |
| 11 | `packages/application/src/ports/index.ts`                                                                                    | application  | MODIFY    | Re-export agent port                                                           |
| 12 | `packages/application/src/use-cases/interview/system-prompt-assembler.ts`                                                    | application  | CREATE    | Pure prompt builder                                                            |
| 13 | `packages/application/src/dtos/conduct-interview.dto.ts`                                                                     | application  | CREATE    | DTO + output shapes                                                            |
| 14 | `packages/application/src/dtos/index.ts`                                                                                     | application  | MODIFY    | Replace scripted exports with conduct exports                                  |
| 15 | `packages/application/src/use-cases/interview/conduct-interview.use-case.ts`                                                 | application  | CREATE    | Orchestrator                                                                   |
| 16 | `packages/application/src/use-cases/interview/index.ts`                                                                      | application  | MODIFY    | Replace scripted exports with conduct exports                                  |
| 17 | `packages/application/src/dtos/conduct-interview.dto.test.ts`                                                                | app test     | CREATE    | DTO parse tests                                                                |
| 18 | `packages/application/src/use-cases/interview/system-prompt-assembler.test.ts`                                               | app test     | CREATE    | Prompt content tests                                                           |
| 19 | `packages/application/src/use-cases/interview/conduct-interview.use-case.test.ts`                                            | app test     | CREATE    | 14 use-case scenarios                                                          |
| 20 | `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts`                                    | application  | DELETE    | Phase 4 scripted use case                                                      |
| 21 | `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.test.ts`                               | app test     | DELETE    | Phase 4 scripted use case test                                                 |
| 22 | `packages/application/src/use-cases/interview/scripted-interview-script.ts`                                                  | application  | DELETE    | Phase 4 scripted constants                                                     |
| 23 | `packages/application/src/use-cases/interview/scripted-interview-tee.ts`                                                     | application  | DELETE    | Phase 4 tee helper                                                             |
| 24 | `packages/application/src/use-cases/interview/scripted-interview-tee.test.ts`                                                | app test     | DELETE    | Phase 4 tee test                                                               |
| 25 | `packages/application/src/dtos/run-scripted-interview-session.dto.ts`                                                        | application  | DELETE    | Phase 4 DTO                                                                    |
| 26 | `packages/application/src/dtos/run-scripted-interview-session.dto.test.ts`                                                   | app test     | DELETE    | Phase 4 DTO test                                                               |
| 27 | `apps/backend/src/infrastructure/persistence/schema/interviews.ts`                                                           | infra        | MODIFY    | Add `notes` + `internal_scores` columns                                        |
| 28 | `apps/backend/drizzle/0001_*.sql` (generated)                                                                                | infra        | CREATE    | Migration                                                                      |
| 29 | `apps/backend/drizzle/meta/0001_snapshot.json` and `_journal.json`                                                           | infra        | MODIFY    | Drizzle metadata                                                               |
| 30 | `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts`                                               | infra        | MODIFY    | Map `notes` + `internalScores` in row mappers and upsert                       |
| 31 | `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts`                                          | infra test   | MODIFY    | Add round-trip tests for new collections                                       |
| 32 | `apps/backend/src/infrastructure/services/gemini/provider.ts`                                                                | infra        | MODIFY    | Add `DEFAULT_GEMINI_AGENT_MODEL` and `defaultAgentModel` on handle             |
| 33 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts`                                          | infra        | CREATE    | AI SDK `streamText` adapter with four tools + telemetry + `interview.turn.agent` span |
| 34 | `apps/backend/src/infrastructure/services/gemini/index.ts`                                                                   | infra        | MODIFY    | Export agent service + new constant                                            |
| 35 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.test.ts`                                     | infra test   | CREATE    | 10 adapter scenarios                                                           |
| 36 | `apps/backend/src/composition/interview-session.composition.ts`                                                              | composition  | MODIFY    | Wire repository + agent + STT + TTS into `ConductInterviewUseCase`             |
| 37 | `apps/backend/src/composition/interview-session.composition.test.ts`                                                         | composition test | MODIFY | Add Gemini key + DB key cases                                                  |
| 38 | `apps/backend/src/presentation/controllers/interview-session.controller.ts`                                                  | presentation | MODIFY    | Use `ConductInterviewUseCaseLike`; rename session span; widen close-code map   |
| 39 | `apps/backend/src/presentation/controllers/interview-session.controller.test.ts`                                             | presentation test | MODIFY | Update DTO names; add INTERVIEW_NOT_FOUND case                                 |
| 40 | `apps/backend/src/presentation/routes/interview-session.ws.ts`                                                               | presentation | MODIFY    | Comment update only                                                            |
| 41 | `apps/backend/src/presentation/routes/interview-session.ws.test.ts`                                                          | presentation test | MODIFY | Use new envelope shape                                                         |
| 42 | `apps/backend/src/scripts/measure-voice-latency.ts`                                                                          | scripts      | MODIFY    | Parse new envelope; update header comment                                      |
| 43 | `apps/backend/.env.example`                                                                                                  | env          | MODIFY    | Document `GEMINI_AGENT_MODEL`, two interview env knobs                         |
| 44 | `docs/adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md`                                                       | docs         | CREATE    | ADR for D1–D5                                                                  |
| 45 | `docs/adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md`                                     | docs         | CREATE    | (Optional) ADR for D7 — recommend authoring                                    |
| 46 | `docs/adr/README.md`                                                                                                         | docs         | MODIFY    | Add ADR-013 / ADR-014 entries                                                  |
| 47 | `docs/progress/phase-5.md`                                                                                                   | docs         | CREATE    | Phase 5 progress writeup                                                       |

---

## Test matrix (consolidated)

| Test file (relative to repo root)                                                                          | Categories                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mocks                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/domain/src/entities/interview/value-objects/agent-note.test.ts`                                  | create with valid props; rejects empty note; rejects negative `recordedAtTurn`; rejects fractional `recordedAtTurn`; serialize / fromSerialized round-trip                                                                                                                                                                                                                                                                                                                  | none                                                                                   |
| `packages/domain/src/entities/interview/value-objects/agent-internal-score.test.ts`                        | create with valid props; rejects empty topicName; rejects empty justification; rejects score < 0; rejects score > 5; rejects fractional `recordedAtTurn`; serialize / fromSerialized round-trip                                                                                                                                                                                                                                                                            | none                                                                                   |
| `packages/domain/src/entities/interview/interview.entity.test.ts` (additions)                              | `appendTranscriptEntry` / `appendNote` / `appendInternalScore` reject when status is CREATED / SCHEDULED / COMPLETED / EVALUATED / CANCELLED; succeed when IN_PROGRESS; produce a new instance; `serialize` / `fromSerialized` round-trip preserves both new arrays; `complete` after several appends keeps the appended entries                                                                                                                                            | none                                                                                   |
| `packages/application/src/dtos/conduct-interview.dto.test.ts`                                              | parse with valid `interviewId`; parse rejects empty `interviewId`; parse rejects non-object input                                                                                                                                                                                                                                                                                                                                                                          | none                                                                                   |
| `packages/application/src/use-cases/interview/system-prompt-assembler.test.ts`                             | output contains JD title, JD company, candidate full name, all topic names, all must-ask questions, target / max durations, four tool names; with empty client instructions, output contains `(none)`; with empty must-ask, output contains `(none)`                                                                                                                                                                                                                       | none                                                                                   |
| `packages/application/src/use-cases/interview/conduct-interview.use-case.test.ts`                          | (1) interview not found; (2) plan absent; (3) repo.findById err; (4) start transition rejected; (5) happy path 3 turns + end_interview; (6) per-turn save count matches expected; (7–9) STT / TTS / agent setup err short-circuits; (10) abort signal aborts mid-loop; (11) hard ceiling enforcement w/ fake timers; (12) time-remaining injection cadence (interval=2 → turns 0,2,4 only; interval=0 → never); (13) tool event ordering preserved; (14) bad score_answer → use case error | in-memory `IInterviewAgentService`, `ISpeechToTextService`, `ITextToSpeechService`, `IInterviewRepository` |
| `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.test.ts`                   | (1) happy path text; (2) `next_question` event; (3) `score_answer` event; (4) `score_answer` invalid input → `AgentToolInputInvalidError`; (5) `take_note` event; (6) `end_interview` event with `all_topics_covered`; (7) network 503 → `AgentUnavailableError`; (8) abort → `AgentTurnTimeoutError`; (9) span attributes set on success; (10) span recordException on error                                                                                              | `vi.mock("ai", …)` with stub `streamText` exposing `textStream`, `usage`, `finishReason`     |
| `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts` (additions)            | save Interview with `appendNote` then read back: notes round-trip; same for `appendInternalScore`; combined: both round-trip; existing transcript-write tests still pass                                                                                                                                                                                                                                                                                                  | real test DB                                                                           |
| `apps/backend/src/composition/interview-session.composition.test.ts` (modifications)                       | missing `DEEPGRAM_API_KEY` throws; missing `ELEVENLABS_API_KEY` throws; missing `GOOGLE_GENERATIVE_AI_API_KEY` throws; all keys present returns deps; each call to `buildUseCase` returns a fresh use case; injected `db` is preferred over the lazy require; malformed `INTERVIEW_TIME_REMAINING_INTERVAL_TURNS` (`2.5`, `-1`, `"abc"`) falls back to `3`; malformed `INTERVIEW_HARD_CEILING_GRACE_SECONDS` falls back to `30`; `0` is a valid value for the interval knob | env injection via `options.env`; fixture `Database` injected via `options.db`; no module-level import of `db.ts` |
| `apps/backend/src/presentation/controllers/interview-session.controller.test.ts` (modifications)           | invalid id → 1008; agent unavailable → 1012; STT unavailable → 1012; happy path → JSON envelope w/ new shape + close 1000; abort on early ws.close stops loop; INTERVIEW_NOT_FOUND → 1008                                                                                                                                                                                                                                                                                  | mock controller deps; FakeWebSocket                                                    |
| `apps/backend/src/presentation/routes/interview-session.ws.test.ts` (modifications)                        | end-to-end: server boots on port:0, client connects, server completes session, client receives envelope w/ new shape, closes 1000; INTERVIEW_NOT_FOUND from injected use case → close 1008                                                                                                                                                                                                                                                                                  | mock composition factory; real ws client                                               |

**Mocks at the SDK / port boundary only.** Never mock `Result`, `Option`, domain entities, or value objects. Per-package coverage targets stay at the project default (85% statements, 80% branches).

---

## Per-batch verification commands

After every batch, run in this order:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
```

Do not proceed to the next batch until type-check is clean and the relevant test suites pass.

After all batches, run the full suite once more, then run `/backend-arch-validator` against each touched layer (`application`, `infrastructure`, `presentation`) and `backend-code-reviewer` over the full file list above.

---

## ADRs to author in this phase

| ADR     | Status   | Title                                                                                                  | Required? |
| ------- | -------- | ------------------------------------------------------------------------------------------------------ | --------- |
| ADR-013 | Proposed | Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface | Yes       |
| ADR-014 | Proposed | Extend OTel Span Hierarchy with `interview.turn.agent` and Unify Session Span as `interview.session.agent` | Recommended |

Both are flipped to `Accepted` only after human review per the ADR Kit workflow. Both should include `llm_judge: true` in their Enforcement blocks because the semantic invariants (tool surface stability, per-turn save discipline, span lifecycle) cannot be fully expressed as regex.

---

## Exit criteria — Phase 5 is complete when:

1. All 47 entry-point operations in the table above are applied in the codebase.
2. `pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend` is clean.
3. Domain, application, and backend test suites all pass against the test database (with the new migration applied).
4. `/backend-arch-validator` passes for `application`, `infrastructure`, and `presentation`.
5. `backend-code-reviewer` returns PASS on the full file list.
6. ADR-013 is at status `Accepted` (ADR-014 may remain `Proposed` if human review is pending).
7. `docs/progress/phase-5.md` exists and documents the run.
8. Live smoke is **either** completed (Langfuse trace ID + Postgres row dump in `phase-5.md`), **or** explicitly noted as pending with the reason (DB not yet provisioned, missing keys, etc.).
9. The Phase 4 scripted code path is gone from `packages/` and `apps/backend/`. `rg "RunScriptedInterviewSession" packages/ apps/backend/src/` returns no matches.
10. The new `interview.session.agent` and `interview.turn.agent` span names appear in Langfuse traces (verified during live smoke or via OTel test exporter in unit tests).

---

## Risk notes / open questions

1. **AI SDK 6 surface area drift.** The exact `streamText` API surface (return shape, finishReason values, tool input validation error names) was verified against `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/node_modules/ai/dist/index.d.ts:2812` at plan-time. If the installed minor version drifts, the agent adapter's `result.textStream` / `result.usage` / `result.finishReason` access paths may need adjustment. The implementing agent should run `pnpm install` first and verify the API in `node_modules` before writing the adapter.

2. **Tool input validation errors.** AI SDK 6 throws `InvalidToolInputError` from inside `streamText` when a tool's input fails its `inputSchema` check. The plan maps this to `AgentToolInputInvalidError`. If AI SDK instead silently retries (via `experimental_repairToolCall`), the use case never sees the bad input and the agent burns extra steps. The plan does **not** enable repair; the bad input fails fast. Document this trade-off in ADR-013.

3. **Conversation history vs tool-call replay.** The plan's history shape is `assistant` + `user` messages only (no `tool` role). Each `streamText` call is therefore stateless from Gemini's perspective regarding *prior* tool calls. The agent must re-derive its understanding of "topics covered" from the assistant text history. This is intentional (D10) but means the agent's prompt may need to be slightly more explicit about "you've already covered topic X" — phrasing that the system-prompt assembler handles via the topic list. If empirically the agent forgets covered topics, Phase 5.1 can extend the history to include synthetic tool-result messages. Surface this as a learning in `phase-5.md`.

4. **Time-remaining injection precision.** The injected message is a literal string built per-turn. If the injection cadence is too aggressive (`interval=1`), prompt tokens balloon. If too lax (`interval=10`), the agent forgets time pressure mid-conversation. Default 3 is a guess; calibrate via Langfuse during live smoke.

5. **Hard-ceiling grace edge cases.** The simple variant in D6 has a known edge: if the agent's grace turn calls `end_interview` *during* its TTS speech (because the controller saw `agentEndedAfterTurn`), the candidate may hear the wrap-up message but the WS will close cleanly. If the agent ignores the wrap-up reminder *and* the candidate's STT for the next turn takes 30 seconds, the loop continues past the hard ceiling. Mitigation: the `ownAbortController.abort()` call in step 5g aborts the `streamText` call but does **not** abort an in-flight STT (Deepgram socket lifecycle is independent). For Phase 5 this is acceptable — Phase 10's full graceful negotiation closes this gap.

6. **Per-turn `repo.save` write amplification.** N turns = O(N) UPSERTs on a single row. For N≈10 this is 10–20 ms total at typical Postgres latency. For very long interviews this could degrade. If a future profile shows write amplification problems, swap `save` for a partial UPDATE that only touches `transcript`, `notes`, `internal_scores`, `updated_at`. Document the option in ADR-013 and defer to Phase 10.

7. **Span context propagation through `streamText`.** The agent adapter opens `interview.turn.agent` synchronously at the top of `runTurn`. AI SDK's auto-emitted Generation span uses the active OTel context at the time `streamText` is called — which is the agent-turn span's context, because the controller wraps the use-case call in `otelContext.with(sessionContext, …)` and the adapter is called synchronously from the use case until the awaited `Promise<Result>` resolves. ADR-012's risk note 7 covers this; same mitigation applies.

8. **`gemini-2.5-pro` latency vs `gemini-2.5-flash`.** The agent default is `gemini-2.5-pro` (quality-first). Per-turn latency must still land inside the §3.3 budget (≈300–500 ms LLM contribution); if Langfuse traces show Pro consistently overruns, set `GEMINI_AGENT_MODEL=gemini-2.5-flash` for that deployment and re-measure. A future split is also available — `flash` for the live agent loop, `pro` for the Phase 6 evaluation pass — but do not preempt; calibrate from real traces. Surface as a Phase 5 learning, not a Phase 5 blocker.

9. **WebSocket back-pressure during long agent text.** If the agent emits a 200-word turn (~1.5 KB of text → ~500 KB of mp3 audio at `mp3_44100_128`), and the browser's WS receive buffer can't drain fast enough, the `agentAudioOut` callback's `Promise<void>` resolution stalls and the use case naturally back-pressures. Phase 4 was tested with short scripted questions; Phase 5 turns will be longer. Watch for stall behaviour during live smoke; if observed, document and defer the explicit back-pressure handling to Phase 10.

10. **Composition root throws on missing env.** Inherited from Phase 4 (D4 in that plan). Same justification: composition roots are the only place where `Result.Err` may legitimately throw because they sit at the framework boot boundary. Now compounded by adding the `GOOGLE_GENERATIVE_AI_API_KEY` check; missing any of three keys halts startup. Documented in the file header comment of `interview-session.composition.ts`.

11. **No interview lookup before start.** The use case calls `repo.findById` then `interview.start(...)`. There's a tiny race: if another process simultaneously transitions the same interview, the `start()` call here will fail. Phase 5 doesn't handle concurrency (single-server assumption); Phase 10's session management closes this. Document in ADR-013.

12. **ADR-006 hard-ceiling enforcement gap.** ADR-006 says hard-ceiling runtime enforcement is a Phase 10 deliverable. Phase 5's simple `setTimeout` is a stopgap that satisfies the *minimum* ceiling guarantee but not the graceful-wrap-up requirement. ADR-013 must explicitly note that the simple variant is interim per ADR-006's risk-and-mitigation block.

---

## Reference: required reading checklist

Before invoking `/backend-implement` on this plan, the implementing agent must have read:

- [ ] `docs/ARCHITECTURE.md` §3.3, §4.5, §4.6, §5.1, §5.2, §5.5, §6, §7
- [ ] `.claude/plan/phase-4-voice-pipeline-spike.md` (full)
- [ ] `docs/progress/phase-4.md`
- [ ] ADR-002, ADR-006, ADR-010, ADR-011, ADR-012
- [ ] `packages/domain/src/entities/interview/interview.entity.ts`
- [ ] `packages/domain/src/entities/interview/value-objects/interview-plan.ts`
- [ ] `packages/domain/src/entities/interview/value-objects/transcript-entry.ts`
- [ ] `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts` (the file being deleted)
- [ ] `packages/application/src/use-cases/interview/generate-interview-plan.use-case.ts` (similar shape)
- [ ] `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts` (AI SDK adapter pattern)
- [ ] `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.ts`
- [ ] `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts`
- [ ] `apps/backend/src/presentation/controllers/interview-session.controller.ts`
- [ ] `apps/backend/src/composition/interview-session.composition.ts`

Plan generated 2026-05-10. Implementation may begin once the user has reviewed and approved this document.
