# ADR-012 Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns

## Status

Accepted. Date: 2026-05-10.

## Context

ADR-004 adopted Langfuse and OpenTelemetry (OTel) for LLM observability and established that Deepgram Speech-to-Text (STT) and ElevenLabs Text-to-Speech (TTS) calls would be instrumented as custom OTel spans within the same Langfuse trace as the Gemini agent turns. ADR-004 does not specify the concrete span names, nesting structure, attribute schema, or lifecycle ownership for the voice pipeline. It describes intent; it does not prescribe implementation.

Phase 4 implements these spans for the first time across three files:

- `apps/backend/src/presentation/controllers/interview-session.controller.ts` (session span)
- `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts` (TTS turn span)
- `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.ts` (STT turn span)

Without a recorded decision, Phase 5 (real Gemini agent turns) and Phase 6 (evaluation) will have no canonical schema to follow. Span names and attribute keys chosen independently across those phases will diverge, making the Langfuse trace timeline uninterpretable and cross-phase latency queries impossible to write.

Four concrete forces constrain the design:

1. Every interview session must produce a single root span so all turns group under one Langfuse trace entry. Langfuse surfaces spans as a tree keyed by the root span's trace context.
2. Per-turn STT and TTS spans must be children of the session span for correct timeline rendering. Langfuse's timeline view uses OTel parent-child relationships to indent spans under their parent.
3. OTel context propagation through `AsyncIterable` boundaries is non-trivial. `context.with(ctx, fn)` only propagates synchronously within the call to `fn`. The controller must capture the active context before the use case begins yielding so that adapter spans opened inside asynchronous iterator callbacks are correctly parented. This is the pattern used at `interview-session.controller.ts:53-61`.
4. The Clean Architecture boundary established in ADR-001 forbids the application layer from importing infrastructure observability packages. The use case at `packages/application/` must not import `@opentelemetry/api`. Span ownership must therefore live outside the use case.

## Decision

Three span types are defined for the voice pipeline. All span names use dot-separated namespaces, following OTel naming conventions for hierarchical identifiers.

**Span 1: Session span** (`interview.session.scripted` in Phase 4, `interview.session.agent` in Phase 5)

The session span is the root span for one complete interview WebSocket session. It is opened by the presentation controller on WebSocket upgrade (`interview-session.controller.ts:41-46`) and closed in the `finally` block after the use case returns (`interview-session.controller.ts:79`). Before invoking the use case, the controller sets the session span as the active OTel context via `trace.setSpan(otelContext.active(), sessionSpan)` and wraps the use-case call in `otelContext.with(sessionContext, ...)` (`interview-session.controller.ts:53-61`). This makes the session context the active context for the duration of the use case, so any spans opened by adapters during that call are automatically parented to the session span.

Required attributes: `interview.id` (string). Optional attributes: `interview.script_version` (string, Phase 4 only).

**Span 2: TTS turn span** (`interview.turn.tts`)

The TTS turn span wraps one ElevenLabs synthesis call. It is opened by `ElevenLabsTextToSpeechService.synthesize()` at the top of the method, before the HTTP request is made (`elevenlabs-tts.service.ts:26-35`). It is closed when the audio stream iterator is exhausted (`return` path, `elevenlabs-tts.service.ts:68-79`) or on stream error (`rejectWithRecordedError`, `elevenlabs-tts.service.ts:81-86`). The span is also closed immediately on setup failure before the stream begins.

Attributes set at span open: `interview.id`, `interview.turn_index`, `tts.voice_id`, `tts.model_id`, `tts.output_format`, `tts.character_count`.

Attributes set lazily during streaming: `tts.latency_to_first_chunk_ms` (set on first chunk, `elevenlabs-tts.service.ts:99`), `tts.total_bytes` (set at stream close, `elevenlabs-tts.service.ts:74`).

**Span 3: STT turn span** (`interview.turn.stt`)

The STT turn span wraps one Deepgram live-transcription session. It is opened by `DeepgramSpeechToTextService.openLive()` at the top of the method, before the WebSocket connection is established (`deepgram-stt.service.ts:35-44`). It is closed on the Deepgram socket Close event or on Error event, both handled inside `TranscriptQueue.close()` (`deepgram-stt.service.ts:142-166`).

Attributes set at span open: `interview.id`, `interview.turn_index`, `stt.model`, `stt.language`, `stt.sample_rate`, `stt.encoding`.

Attributes set at span close: `stt.latency_ms` (socket open to close, `deepgram-stt.service.ts:148`), `stt.words` (cumulative word count across final transcripts, `deepgram-stt.service.ts:149`), `stt.final_confidence` (confidence of the last final transcript, `deepgram-stt.service.ts:150-152`).

**Span lifecycle rule:** Infrastructure adapters own span creation and lifecycle. The use case is span-unaware. The controller sets the active OTel context once before the use case call; adapter spans opened inside async iterator callbacks are parented automatically because they inherit the active context at the time `tracer.startSpan()` is called.

## Alternatives Considered

### Alternative A: Use case owns all spans

The use case (`RunScriptedInterviewSessionUseCase` in `packages/application/`) would import `@opentelemetry/api` and open spans around each adapter call. Rejected: the application layer must not import infrastructure or observability packages (ADR-001). Importing `@opentelemetry/api` from `packages/application/` crosses the dependency boundary. The application layer's `package.json` does not list `@opentelemetry/api` as a dependency, and adding it would make every use case aware of the observability platform.

### Alternative B: Presentation controller opens all turn spans

The controller would open `interview.turn.tts` and `interview.turn.stt` spans before invoking each use-case step, then close them after the step completes. Rejected: the controller has no visibility into when the adapter's network connection is actually open or closed. The TTS span should start when the HTTP request leaves the process, not when the controller calls `execute()`. The STT span should end when the Deepgram socket fires its Close event, which happens asynchronously inside the adapter's event loop. Only the adapter knows these lifecycle boundaries.

### Alternative C: Single flat session span with no turn-level spans

One span covers the entire WebSocket session with no children. Rejected: this satisfies ADR-004's "one trace per session" requirement but discards per-turn latency attribution. Diagnosing "why did turn 3 TTS produce silence?" or "why did STT latency spike to 4 seconds on turn 5?" requires per-turn spans. Without them, the Langfuse trace collapses into a single opaque duration, which is no better than a log line. ADR-004 explicitly requires that Deepgram and ElevenLabs latency be visible in the trace timeline (ADR-004, Consequences: "latency, cost, and failure information are visible in the unified trace timeline").

### Alternative D: Slash-separated span names (e.g., `interview/session/scripted`)

The same three-tier naming hierarchy expressed with slash separators instead of dots. Rejected: OTel span names conventionally use dot-separated hierarchical namespaces (e.g., `http.server.request`, `db.query`). Slash separators are common in URL path segments and resource names but are non-idiomatic for OTel operation names. Dot-separated names align with the OTel Semantic Conventions naming style and are more readable in Langfuse's flat span list, where the hierarchy is visually implied by the shared prefix.

### Alternative E: Do nothing (let each phase choose its own span names)

Each phase team coins span names independently. Rejected: spans from Phase 4 (scripted session), Phase 5 (agent session), and Phase 6 (evaluation) would use different naming conventions, making cross-phase Langfuse queries (e.g., "show me all TTS latency readings across all session types") require manual namespace reconciliation. The cost of establishing a schema now is one ADR; the cost of reconciling divergent schemas later is a migration of all stored traces.

## Consequences

**Benefits**

- Every voice session produces a predictable, consistent span tree in Langfuse: one root session span with one `interview.turn.tts` and one `interview.turn.stt` child per scripted question. Phase 5 extends this to N pairs of `interview.turn.stt` / agent-generation / `interview.turn.tts`.
- Per-turn latency and quality metrics are queryable in Langfuse without log scraping: `tts.latency_to_first_chunk_ms` captures the time from HTTP request to first audio byte; `stt.latency_ms` captures the full Deepgram session duration; `stt.final_confidence` enables transcript-quality alerting.
- The adapter-owns-span-lifecycle rule is a documented invariant. Any future infrastructure adapter (e.g., a Cartesia TTS adapter replacing ElevenLabs) has a clear implementation contract: open a span at the start of the network call, close it on the terminal event, set attributes lazily during streaming.
- The use case is span-unaware. Adding or changing an observability adapter requires no changes to `packages/application/`.

**Trade-offs**

- Span attribute names are hard-coded strings in the adapters. A typo in a key name (`tts.latency_to_first_chunk` vs `tts.latency_to_first_chunk_ms`) is not caught at compile time. This ADR serves as the normative reference; code review must verify attribute keys against this schema.
- The session span name changes between phases (`interview.session.scripted` in Phase 4, `interview.session.agent` in Phase 5). Langfuse queries that filter by span name must account for both values if querying across phases. A future ADR may unify the names.
- OTel context propagation through `AsyncIterable` iterators depends on the adapter opening its span synchronously at the start of the `Promise`-returning method, before any `await`. If an adapter defers `tracer.startSpan()` to a callback inside an already-running iterator, the span will not be parented correctly. This constraint is not enforced mechanically and requires review.

**Risks and mitigations**

- *Risk*: A new adapter opens its span inside an async callback, after the OTel context has left the `otelContext.with(...)` synchronous boundary, resulting in unparented spans in Langfuse. *Mitigation*: Code review of every new adapter against this ADR's lifecycle rule. The `interview.turn.*` span must be the first statement of the top-level `async` method, before any `await`.
- *Risk*: Attribute key names diverge across Phase 4 and Phase 5 implementations (e.g., Phase 5 uses `stt.word_count` instead of `stt.words`). *Mitigation*: This ADR is the normative schema. The Enforcement block below flags any new `interview.turn.*` span attributes not listed in this ADR's schema.
- *Risk*: The session span name (`interview.session.scripted` vs `interview.session.agent`) makes cross-phase Langfuse queries harder to write. *Mitigation*: The shared `interview.id` attribute is present on all three span types. Cross-phase queries can group by `interview.id` rather than span name. Unifying the session span name is deferred to Phase 5's ADR.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: The adapter-owns-span-lifecycle rule is a direct consequence of ADR-001's dependency direction. Infrastructure adapters may import `@opentelemetry/api`; application use cases must not.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The three-span structure (session root, TTS turn, STT turn) maps directly onto the sandwich legs defined in ADR-002. Each leg of the sandwich gets a named turn span; the session span wraps the full sandwich execution.
- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: This ADR concretizes ADR-004's trace structure for the voice pipeline. ADR-004 described the high-level intent (Deepgram and ElevenLabs as custom OTel spans within the interview trace); this ADR records the concrete span names, attribute keys, and lifecycle rules that realize that intent.
- **ADR-010 (Use AsyncIterable Stream Contracts for STT and TTS Application Ports)**: The async-iterator boundary described in ADR-010 is exactly where OTel context propagation is non-trivial. The solution adopted here (wrap the use-case call in `otelContext.with(...)` before the first iterator operation) is the counterpart to ADR-010's streaming contract.

## References

- `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.ts:35-44` (STT span open), `:142-166` (STT span close on socket events)
- `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts:26-35` (TTS span open), `:68-86` (TTS span close), `:99` (first-chunk latency attribute)
- `apps/backend/src/presentation/controllers/interview-session.controller.ts:41-46` (session span open), `:53-61` (otelContext.with propagation), `:79` (session span close in finally)
- `.claude/plan/phase-4-voice-pipeline-spike.md` section D6 (Phase 4 observability plan)
- `docs/ARCHITECTURE.md` §4.6 "Observability (Langfuse)", lines 199-242 (trace structure rationale)
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- OTel Semantic Conventions naming conventions: https://opentelemetry.io/docs/specs/semconv/general/naming/

## Enforcement

The core rules are partially declarative (span names follow a known namespace) and partially semantic (lifecycle placement cannot be expressed as a line-pattern regex). The enforcement block below catches two things mechanically: (1) any new `interview.turn.*` span opened using `startSpan` must use one of the canonical names defined in this ADR; (2) `@opentelemetry/api` must not be imported from `packages/application/`.

The lifecycle rule (span opened before first `await`) is not expressible as a regex and is marked for LLM judgement.

```json
{
  "forbid_import": [
    {
      "pattern": "from [\"']@opentelemetry/api[\"']",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must not import @opentelemetry/api. Span ownership belongs to infrastructure adapters (ADR-012, ADR-001)."
    }
  ],
  "forbid_pattern": [
    {
      "pattern": "startSpan\\([\"']interview\\.turn\\.",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Turn spans must be opened by infrastructure adapters, not application use cases (ADR-012)."
    }
  ],
  "require_pattern": [],
  "llm_judge": true
}
```
