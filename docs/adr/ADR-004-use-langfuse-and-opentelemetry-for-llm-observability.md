# ADR-004 Use Langfuse and OpenTelemetry for LLM Observability

## Status

Accepted. Date: 2026-05-09.

## Context

The product runs many AI calls per interview session: multiple Gemini agent turns driving the real-time conversation, a Gemini evaluation pass at session end, and document extraction calls at upload time. Each agent turn also wraps two non-LLM vendor calls: Deepgram speech-to-text (STT) and ElevenLabs text-to-speech (TTS). Standard Node.js structured logging (pino) is insufficient for this workload because LLM interactions have a distinct data shape: system prompt, message history, tool-call sequence, tool results, token counts per role, and per-call cost. Correlating a 5-turn agent conversation across line-delimited JSON log entries is impractical for post-hoc debugging ("why did the agent ask that question?") and offers no built-in cost aggregation per interview.

We need an observability layer that: (1) stores full prompt and response payloads in a structured, queryable UI; (2) groups all spans for one interview session under a single trace keyed by `interviewId`; (3) tracks token counts and cost per call and per interview; (4) supports prompt-version comparison for iterating on system prompts; and (5) keeps the integration maintenance cost low given a small team. This requirement is captured in `docs/ARCHITECTURE.md` §4.6 "Observability (Langfuse)", lines 199-242.

## Decision

Adopt Langfuse as the LLM observability platform and integrate it via OpenTelemetry (OTel) using the `langfuse` and `@langfuse/otel` packages.

Setup is a one-time call in the backend bootstrap (`apps/backend`). The Vercel AI SDK has native OTel support, so every `generateText`, `generateObject`, and `streamText` call is traced automatically once the Langfuse OTel exporter is registered. No per-callsite observability code is required.

Trace structure per interview session:

```
Trace: Interview session {interviewId}
├── Span: Agent turn 1
│   ├── Span: Deepgram STT        (duration, audio_seconds, cost)
│   ├── Generation: Gemini agent  (native — prompts, tokens, tool calls)
│   └── Span: ElevenLabs TTS      (character_count, audio_duration, cost)
├── Span: Agent turn 2
│   └── ...
└── Generation: Evaluation pass   (native — transcript in, report out)
```

Custom metadata attached to every trace: `interviewId`, `candidateId`, `jdId` (job description ID). These enable filtered views and cost aggregation per interview or per candidate in the Langfuse UI.

Deepgram and ElevenLabs calls are instrumented as custom OTel spans within the same trace. They are not first-class Langfuse "generations", but latency, cost, and failure information are visible in the unified trace timeline.

Three environment variables are required at runtime:

```
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or self-hosted URL
```

Langfuse is adopted on its free cloud tier initially, with a self-host upgrade path available when data-residency constraints or quota limits make that necessary.

## Alternatives Considered

### Alternative A: Plain pino/winston JSON logs with Grafana Loki

Standard structured logging captures request metadata and errors but has no concept of an LLM generation. Reconstructing a 5-turn agent conversation requires joining log lines by `interviewId` across multiple services, then reading prompt payloads as escaped JSON strings embedded in log fields. Prompt-version comparison is entirely manual. Per-interview cost requires a post-processing aggregation job. Rejected because the operational cost of debugging agent behaviour and monitoring unit economics would be disproportionately high relative to the tool-adoption cost of Langfuse.

### Alternative B: LangSmith (LangChain observability)

LangSmith provides a capable LLM trace UI with chain replay and evaluator runs. However, its strongest features (chain replay, evaluator runners, LCEL graph visualization) are tightly coupled to LangChain. This codebase uses the Vercel AI SDK. LangSmith's OTel integration is a secondary surface that does not receive the same first-class investment as its LangChain-native path. Langfuse is provider-neutral from day one and has stronger documented OTel support. Rejected on integration fit grounds.

### Alternative C: Build an in-house dashboard on Postgres and Recharts

We already store `interviewId` and basic metadata in PostgreSQL. Extending the schema to persist LLM payloads and rendering a cost dashboard over them is technically feasible. Rejected as a make-vs-buy distraction: the team's value-add is the interview product, not an observability tool. Engineering time spent on a custom dashboard is directly subtracted from interview-feature delivery. Free-tier Langfuse covers all immediate requirements.

### Alternative D: Datadog APM with the LLM Observability add-on

Datadog offers LLM-specific trace views as a paid add-on to its APM product. Rejected for three reasons: (a) cost scales poorly for high-cardinality per-interview tracing with full payload storage; (b) Datadog LLM Observability is a newer feature that is less LLM-native than Langfuse's core product; (c) there is no existing Datadog footprint in this stack whose cost could be amortised across this capability.

### Alternative E: Do nothing (rely on Gemini API dashboard only)

The Gemini API console shows per-API-key token usage but has no per-interview grouping, no cross-vendor view (Deepgram and ElevenLabs are invisible), and no prompt-version history. Rejected because it does not meet the debugging or cost-tracking requirements stated in the context.

## Consequences

**Benefits**

- A single trace per interview session shows Deepgram STT, all Gemini agent turns (with full tool-call sequences), and ElevenLabs TTS in one timeline. Debugging "the candidate said the agent went silent for 30 seconds" becomes a single trace lookup.
- AI SDK native OTel means every `generateText`/`generateObject`/`streamText` call is traced automatically. Adding a new AI SDK call requires zero additional observability code.
- Per-interview cost is visible in real time, enabling continuous validation of unit economics against pricing assumptions.
- Prompt versioning and A/B comparison are available in the Langfuse UI without custom tooling.
- Self-host upgrade path exists via the open-source Langfuse server if data-residency requirements or vendor risk become binding later.

**Trade-offs**

- Deepgram and ElevenLabs spans are generic OTel spans, not first-class Langfuse "generations". They are visible in the trace timeline but do not benefit from LLM-specific UI features (token diffs, prompt-version comparison). This is an acceptable limitation for the current product stage.
- Three additional environment variables must be managed across deployment environments (local, staging, production).
- Langfuse is one more vendor in the ingest path. A Langfuse outage or network partition could, in principle, slow or block trace flushing if the SDK is not configured for async, non-blocking export.
- The free-tier request quota may be exhausted at scale; a paid plan or self-hosting becomes necessary at that point.

**Risks and mitigations**

- *Risk*: Langfuse SDK network errors block application code. *Mitigation*: The `@langfuse/otel` SDK is documented to fail open; trace export errors are dropped asynchronously and do not propagate to the calling code. Verify this behaviour in the bootstrap integration test before shipping to production.
- *Risk*: Full prompt/response payload storage creates a data-compliance surface (candidate PII in transcripts may be stored on Langfuse cloud). *Mitigation*: Review Langfuse's data-processing agreement before production launch. The self-host upgrade path eliminates third-party storage if required.
- *Risk*: Free-tier quota exhaustion mid-interview season disrupts observability. *Mitigation*: Monitor monthly ingest usage in the Langfuse dashboard. Set a budget alert at 70% of quota and plan the self-host migration before exhaustion.
- *Risk*: Future AI SDK version breaks OTel instrumentation. *Mitigation*: Pin `@langfuse/otel` and AI SDK versions together; include an integration smoke-test in the CI pipeline that asserts at least one span is emitted after a test generation call.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: The Langfuse OTel bootstrap wiring is placed in `apps/backend` (the presentation/infrastructure bootstrap), not in `packages/application` or `packages/domain`. This preserves the inward dependency flow: domain and application packages remain unaware of the observability platform.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The Deepgram STT and ElevenLabs TTS spans defined in the sandwich pipeline (each agent turn wraps STT input and TTS output around a Gemini generation) map directly to the trace structure adopted here. Observability spans follow the same per-turn structure as the sandwich.
- **ADR-003 (Gemini Multimodal Extraction)**: Document-extraction calls (CV and job description ingestion) are traced as standalone Langfuse generations under a separate trace, not under the interview-session trace. This keeps document-upload observability independent from interview-session observability.

## References

- `docs/ARCHITECTURE.md` §4.6 "Observability (Langfuse)", lines 199-242: platform rationale, trace structure diagram, env vars.
- Langfuse OpenTelemetry integration guide: https://langfuse.com/docs/opentelemetry/get-started
- Vercel AI SDK telemetry documentation: https://sdk.vercel.ai/docs/ai-sdk-core/telemetry
- `@langfuse/otel` package: https://www.npmjs.com/package/@langfuse/otel
- `langfuse` package: https://www.npmjs.com/package/langfuse

## Enforcement

The enforcement rule for this ADR is LLM-judgeable rather than declarative. The core invariant is: every AI SDK call in `apps/backend` must be made within a request context that has a Langfuse trace registered via the OTel exporter. This cannot be expressed as a file-pattern regex because compliance depends on runtime wiring (whether the OTel provider was bootstrapped before the call) rather than import presence. A declarative `require_pattern` on the bootstrap file would confirm the file exists but not that it is invoked before the AI SDK calls.

Once the bootstrap integration is wired (Phase 2), a narrow declarative rule can be added to enforce that no AI SDK call bypasses the OTel context by using an untraced client instance.

```json
{
  "forbid_pattern": [],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
