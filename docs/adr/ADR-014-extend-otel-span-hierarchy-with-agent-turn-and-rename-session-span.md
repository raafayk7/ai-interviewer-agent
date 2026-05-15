# ADR-014 Extend OTel Span Hierarchy with `interview.turn.agent` and Unify Session Span as `interview.session.agent`

## Status

Accepted, 2026-05-15.

## Context

ADR-012 established three span types for the Phase 4 voice pipeline:

| Span name | Owner | Phase |
|---|---|---|
| `interview.session.scripted` | Presentation controller | 4 |
| `interview.turn.tts` | `ElevenLabsTextToSpeechService` | 4 |
| `interview.turn.stt` | `DeepgramSpeechToTextService` | 4 |

ADR-012's enforcement block permits any `interview.turn.*` span name, leaving the namespace open for future phases. Phase 5 adds two new instrumentation points that are not recorded anywhere:

1. **A new turn span for the Gemini agent call.** `GeminiInterviewAgentService.runTurn()` opens an `interview.turn.agent` span that wraps the AI SDK `streamText` call and its tool callbacks. This span is a sibling of `interview.turn.tts` and `interview.turn.stt`, not a child — all three are direct children of the session span. Without a recorded attribute schema, Phase 6 (evaluation) and Phase 10 (resilience instrumentation) will add agent attributes independently, producing inconsistent keys in Langfuse.

2. **A rename of the session span.** Phase 4 opened the root session span as `interview.session.scripted`. Phase 5 renames it to `interview.session.agent` because the scripted driver no longer exists and `scripted` is a confusing label for a production Gemini-driven session. ADR-012 noted this rename as a known mitigation in its Consequences, but did not record the name change or its rationale.

Both points need a recorded decision so Phase 6 can add `interview.evaluation.*` spans predictably and so cross-phase Langfuse queries can be written without manual namespace reconciliation.

## Decision

### D7a — Add interview.turn.agent to the canonical span name list

`interview.turn.agent` is the span for one Gemini agent turn. It is opened by `GeminiInterviewAgentService.runTurn()` at `gemini-interview-agent.service.ts:165`, before the first `await`, making it the first statement of the `async` method — consistent with ADR-012's lifecycle rule. It is closed in the `finally` block of the same method after `streamText` resolves, whether the call succeeds or fails.

**Attributes set at span open:**

| Key | Type | Value | Line |
|---|---|---|---|
| `interview.id` | string | The interview UUID | `:167` |
| `interview.turn_index` | number | Zero-based turn counter | `:168` |
| `agent.model` | string | Gemini model identifier (e.g. `gemini-2.5-pro`) | `:169` |

**Attributes set lazily after `streamText` resolves:**

| Key | Type | Value | Line |
|---|---|---|---|
| `agent.tool_calls_count` | number | Count of tool events emitted in this turn | `:204` |
| `agent.stop_reason` | string | One of `tool_call_complete`, `stop`, `abort`, `error` | `:205` |
| `agent.input_tokens` | number | Prompt tokens from `result.usage` (when available) | `:207` |
| `agent.output_tokens` | number | Completion tokens from `result.usage` (when available) | `:210` |

The AI SDK's `experimental_telemetry: { isEnabled: true }` option automatically emits a Generation span (Gemini call) as a child of the active OTel context. Because `interview.turn.agent` is active when `streamText` is called, the AI SDK Generation span is parented to `interview.turn.agent`, which is itself parented to `interview.session.agent`. The per-turn Langfuse subtree is therefore:

```
interview.session.agent
  └── interview.turn.agent          (GeminiInterviewAgentService)
        └── [AI SDK Generation]    (auto-emitted by AI SDK experimental_telemetry)
  └── interview.turn.tts            (ElevenLabsTextToSpeechService)
  └── interview.turn.stt            (DeepgramSpeechToTextService)
```

The `interview.turn.tts` and `interview.turn.stt` spans remain siblings of `interview.turn.agent` under the session span. They are not nested inside the agent span because each adapter opens its span at the boundary of its own network call, not inside the agent's `runTurn()` method.

### D7b — Rename session span from interview.session.scripted to interview.session.agent

The presentation controller opens the root session span as `interview.session.agent` at `interview-session.controller.ts:47`. The Phase 4 name `interview.session.scripted` is retired together with the scripted use case (deleted in Phase 5). The rename is not a schema break — no data migration is needed — but cross-phase Langfuse queries that filter by span name must account for both values when querying sessions created across Phase 4 and Phase 5. Grouping by the `interview.id` attribute (present on all three span types) is the recommended cross-phase query strategy and is unaffected by the rename.

### D7c — Reserve interview.evaluation.* for Phase 6

Phase 6 will add an evaluation pass (Gemini `generateObject` over the full transcript, JD, CV, and rubric). Its span MUST use a name in the `interview.evaluation.*` namespace, MUST set the `interview.id` attribute, and MUST follow the same adapter-owns-span-lifecycle rule from ADR-012. Phase 6's ADR will specify the exact name and attribute schema. This ADR records the namespace reservation so Phase 6 has a documented slot to fill.

## Alternatives Considered

### Alternative A: Do not author this ADR — rely on ADR-012's open namespace

ADR-012's enforcement block already permits any `interview.turn.*` span. A new ADR is not strictly required for the LLM judge to function. Rejected: the agent attribute schema (`agent.model`, `agent.tool_calls_count`, `agent.stop_reason`, `agent.input_tokens`, `agent.output_tokens`) is not documented anywhere. Phase 6 adding an `interview.turn.evaluation` span without this schema as a reference will independently invent attribute key names — at minimum producing inconsistent casing or missing `agent.stop_reason` on a future adapter. The ten minutes to write this ADR prevents a schema-drift incident.

### Alternative B: Extend ADR-012 instead of authoring a new ADR

Edit ADR-012's Decision section to add the agent span and attribute schema. Rejected: accepted ADRs are immutable per the ADR Kit workflow and CLAUDE.md. Editing the Decision section of ADR-012 (Status: Accepted, 2026-05-10) is not permitted. An amendment ADR (this document) is the correct mechanism.

### Alternative C: Nest interview.turn.tts and interview.turn.stt inside interview.turn.agent

Place the TTS and STT spans as children of the agent span rather than as siblings of it under the session span. Rejected: the TTS and STT adapters open their spans at the boundary of their own network calls, which occur before and after the agent span in the turn lifecycle (STT produces the input to the agent; TTS consumes the agent's output). Nesting them inside the agent span would misrepresent the timing — TTS runs after the agent span closes, not while it is open. Siblings under the session span is the accurate representation of the sequential STT → Agent → TTS flow.

### Alternative D: Unify session span as interview.session regardless of phase

Use a single constant `interview.session` for all phases (scripted, agent, future evaluation-only). Rejected: different phases use different orchestrators with different span attributes. A unified name would conflate sessions driven by the scripted controller (Phase 4), the agent controller (Phase 5+), and any future evaluation-only sessions (Phase 6). The phase-qualified name makes the session type visible in Langfuse's span list without reading attributes.

## Consequences

**Benefits**

- The complete per-turn span tree for Phase 5 is recorded with exact attribute keys and ownership. Phase 6 can implement `interview.evaluation.*` spans without re-deriving the schema from source code.
- The `agent.model` attribute on `interview.turn.agent` makes Gemini model-version comparisons queryable in Langfuse: filter by `agent.model = gemini-2.5-pro` vs `gemini-2.5-flash` to compare latency and token cost between model versions after a `GEMINI_AGENT_MODEL` override.
- The `interview.evaluation.*` namespace reservation signals to future contributors that Phase 6 instrumentation has a designated slot — preventing ad-hoc names like `evaluation` or `gemini.evaluate`.
- The session span rename is documented. Future Langfuse query writers know to include both `interview.session.scripted` (Phase 4 history) and `interview.session.agent` (Phase 5+) when querying across all sessions by `interview.id`.

**Trade-offs**

- Attribute names (`agent.input_tokens`, `agent.output_tokens`) differ from OTel Semantic Conventions for LLM spans (`gen_ai.usage.input_tokens` etc.) which are still in incubation. If the project adopts OTel GenAI semconv in a future phase, a rename of these attributes is needed. Because they are set in a single file (`gemini-interview-agent.service.ts:207, :210`), the rename cost is low.
- The AI SDK's auto-emitted Generation span is an implementation detail of `experimental_telemetry`. If the AI SDK removes or renames this feature, the innermost Langfuse subtree changes without requiring an ADR update — the adapter-owns-span-lifecycle rule in ADR-012 continues to apply to the explicitly opened spans only.

**Risks and mitigations**

- *Risk*: A future adapter opens `interview.turn.agent` inside an async callback (after the OTel context boundary), producing an unparented span in Langfuse. *Mitigation*: ADR-012's `llm_judge: true` enforcement block checks that turn spans are opened before the first `await`. This ADR's `llm_judge: true` block adds the same check for `interview.turn.agent` specifically.
- *Risk*: Phase 6 coins `interview.evaluation.gemini` when the reserved namespace is `interview.evaluation.*`, creating a subtly inconsistent name (dot-separated vs space-separated). *Mitigation*: Phase 6's ADR cites this document and inherits the naming convention. The namespace reservation note in D7c is explicit.
- *Risk*: `agent.input_tokens` and `agent.output_tokens` may be `undefined` when the Gemini API does not return usage data (e.g., streaming with some model versions). *Mitigation*: The adapter already guards this — `span.setAttribute("agent.input_tokens", usage.inputTokens)` is called only inside `if (usage)` at `gemini-interview-agent.service.ts:207`. Langfuse will simply omit the attribute for those turns.

## Related Decisions

- **ADR-012 (Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns)**: This ADR amends ADR-012 by adding `interview.turn.agent` to the canonical span list, recording the agent attribute schema, and documenting the session span rename. ADR-012's Status is updated to `Amended by ADR-014`. The lifecycle rule and OTel context propagation guidance from ADR-012 apply unchanged.
- **ADR-001 (Adopt Clean Architecture and DDD)**: The adapter-owns-span-lifecycle rule that governs this ADR's span placement is a direct consequence of ADR-001's dependency-direction rule.
- **ADR-013 (Conduct Interview Orchestration)**: ADR-013 records that `GeminiInterviewAgentService` opens `interview.turn.agent` consistent with ADR-012's lifecycle rule. This ADR specifies the exact attribute schema that ADR-013 references.
- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: The AI SDK `experimental_telemetry` integration described here is the concrete realization of ADR-004's "AI SDK has native OpenTelemetry support" integration point.

## References

- `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts:165` — `interview.turn.agent` span opened; `:167-170` — span-open attributes; `:204-210` — lazy attributes set after `streamText` resolves
- `apps/backend/src/presentation/controllers/interview-session.controller.ts:47` — session span opened as `interview.session.agent`
- `docs/adr/ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md` — base span schema; Consequences section notes the session span rename as a known mitigation
- `docs/adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md` — records that the adapter opens `interview.turn.agent` per ADR-012's lifecycle rule
- `docs/ARCHITECTURE.md` §4.6 — Langfuse trace structure specification showing the per-turn subtree
- OpenTelemetry Semantic Conventions for GenAI (incubating): https://opentelemetry.io/docs/specs/semconv/gen-ai/
- AI SDK `experimental_telemetry` documentation: https://sdk.vercel.ai/docs/ai-sdk-core/telemetry

## Enforcement

The `interview.turn.agent` span must be opened before the first `await` in `runTurn()` (ADR-012's lifecycle rule). The LLM judge verifies this and that no agent attributes are set outside the `gemini-interview-agent.service.ts` file (preventing attribute-key drift across adapters).

```json
{
  "forbid_pattern": [
    {
      "pattern": "startSpan\\([\"']interview\\.turn\\.agent[\"']",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "interview.turn.agent span must be opened by the infrastructure adapter, not the application layer (ADR-014, ADR-012)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [
    {
      "pattern": "agent\\.model",
      "path_glob": "apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts",
      "message": "interview.turn.agent span must set agent.model attribute (ADR-014)."
    }
  ],
  "llm_judge": true
}
```
