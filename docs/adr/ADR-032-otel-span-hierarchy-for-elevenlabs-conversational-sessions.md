# ADR-032 Extend OTel Span Hierarchy for ElevenLabs Conversational Sessions

## Status

Accepted. Date: 2026-05-29. Revised 2026-05-27 to align with ADR-033 / ADR-034. Revised 2026-05-29 to align with the corrected ADR-033 and ADR-034: no session-start-webhook span exists; D1 now records that StartCandidateSession performs the SCHEDULED to IN_PROGRESS transition at issuance (there is no `session.started` webhook on the browser SDK path).

## Context

ADR-012 defined three span types for the sandwich voice pipeline (`interview.session.agent`, `interview.turn.tts`, `interview.turn.stt`). ADR-014 extended the hierarchy with `interview.turn.agent` for the Gemini agent step. Both ADRs assume a backend that sits in the hot path of every turn: the backend mediates all STT (Deepgram), agent inference (Gemini AI SDK), and TTS (ElevenLabs) calls, and therefore has concrete per-turn observability surfaces.

Phase 9.5 replaces the sandwich architecture with ElevenLabs Conversational AI (ADR-029). In the new path, the candidate's browser connects directly to ElevenLabs via the ElevenLabs LiveKit-based SDK. The backend is no longer in the per-turn hot path: it neither opens nor reads Deepgram connections, does not call `streamText`, and does not synthesize TTS audio per turn. The surfaces the backend DOES control in Phase 9.5 are:

1. **Session initiation**: `StartCandidateSession` use case mints a signed URL via `getSignedUrl({ agentId, includeConversationId: true })`, binds the resulting `conversation_id` onto the interview aggregate, assembles the per-session override payload server-side, and returns it alongside the signed URL to the candidate's browser. The browser passes the override inline to ElevenLabs via the SDK's `Conversation.startSession({ overrides, dynamicVariables })` call (ADR-033).
2. **Webhook receipt**: ElevenLabs delivers inbound lifecycle events to the backend at four routes: three per-tool routes (`/webhooks/elevenlabs/tools/next_question`, `/tools/score_answer`, `/tools/take_note`) when the agent invokes the corresponding tool; and `/webhooks/elevenlabs/post-call` when the session ends. There is no session-start webhook: ElevenLabs does not emit a conversation-start notification for browser SDK sessions (ADR-034 Priority 1 finding).
3. **Transcript persistence**: `PersistCompletedTranscript` use case is invoked at session end, pulls the full transcript via the ElevenLabs REST API, walks it for the `end_call_success` tool-result entry (per ADR-034), and writes the resulting record to the `Interview` aggregate.

The existing `interview.turn.*` span names assert per-turn STT, agent, and TTS work that the backend no longer performs for the conversational path. Leaving the hierarchy unchanged means Phase 9.5 code either produces untraced backend-side spans (no observability at all on the surfaces we do control) or reuses semantically incorrect span names (false attribution to work that happens entirely inside ElevenLabs). ADR-012's enforcement block, which catches `@opentelemetry/api` imports in `packages/application/`, remains correct and must continue to apply.

The existing Langfuse exporter is configured to export OTel spans whose names match `otelSpan.name.startsWith("interview.")`. Any new span names must stay inside the `interview.` prefix so they are captured without filter changes. This filter is set on the `LangfuseSpanProcessor` (`shouldExportSpan` option) installed during the backend bootstrap via `@langfuse/otel`.

This decision was recommended by codebase analysis (Phase 9.5 planning, documented in `docs/progress/phase-9.md` §"Phase 9.5") and approved by the project lead.

## Decision

Extend the span hierarchy with four new span types to cover the backend-controlled surfaces of an ElevenLabs conversational session. ADR-012 and ADR-014 are NOT superseded: their span definitions remain valid for the retained sandwich path and for any future path that brings the backend back into the per-turn hot path.

All four span types use the `interview.` name prefix and are exported by the existing `@langfuse/otel` `LangfuseSpanProcessor`. Root OTel spans (D1, D2, D3) each become an independent Langfuse **trace**. The child span (D4) becomes a Langfuse **observation** of type `span` nested under the D3 trace. No new Langfuse SDK wiring or exporter changes are required.

### D1 — interview.session.conversational (session initiation span)

The session initiation span wraps the `StartCandidateSession` use case execution in the presentation layer. It is opened by the `candidate-session.controller.ts` handler immediately on receipt of the `POST /interviews/:id/candidate-session` request, before calling the use case, and closed in the handler's `finally` block after the use case returns.

Session initiation: `StartCandidateSession` use case validates the interview, calls `getSignedUrl({ agentId, includeConversationId: true })`, binds `elevenLabsSessionId = conversation_id` at issuance time, and — because ElevenLabs emits no conversation-start webhook for browser SDK sessions — performs the SCHEDULED to IN_PROGRESS lifecycle transition (`interview.start(new Date())`) at this same moment (ADR-033, ADR-034). It then assembles the per-session override payload (system prompt, dynamic variables) server-side, and returns `{ signedUrl, overrides, dynamicVariables }` to the candidate's browser. The browser passes the payload through to ElevenLabs via the SDK's inline `Conversation.startSession({ overrides, dynamicVariables })` call. The backend mints the signed URL but does not create or modify any ElevenLabs agent object (ADR-033). There is no separate session-start-webhook span: D1 is the only backend-side trace for the beginning of an ElevenLabs session.

The span name is `interview.session.conversational`. The `conversational` suffix distinguishes this session type from `interview.session.agent` (Phase 5+ sandwich sessions) in Langfuse queries. Per ADR-014's precedent, the phase-qualified name makes the session type visible in Langfuse's trace list without reading attributes.

In Langfuse, this root span appears as a **trace** with name `interview.session.conversational`. It has no child observations because `StartCandidateSession` does not call any LLM; there is no AI SDK `generateText` or `streamText` call inside this span, so no Langfuse generation observation is auto-emitted.

**Attributes set at span open:**

| Key | Type | Value |
|---|---|---|
| `interview.id` | string | The interview UUID |

**Attributes set after use case returns (success path):**

| Key | Type | Value |
|---|---|---|
| `elevenLabs.agentId` | string | The static ElevenLabs agent ID configured via `ELEVENLABS_AGENT_ID` (ADR-033) |
| `elevenLabs.sessionId` | string | The ElevenLabs `conversation_id` returned by `getSignedUrl({ includeConversationId: true })` and bound onto the interview aggregate |

**Attributes set on error path:**

| Key | Type | Value |
|---|---|---|
| `error` | boolean | `true` |
| `error.kind` | string | The `ServiceError.kind` string (e.g. `SERVER`, `NETWORK`) |

### D2 — interview.webhook.tool (tool-call webhook span)

Each inbound tool-call webhook event from ElevenLabs opens an `interview.webhook.tool` span. It is opened by the tool-call webhook controller as the first statement of the handler, before HMAC signature verification or any `await`. It is closed in the handler's `finally` block.

This span is opened as a new root span (no parent). The browser-to-ElevenLabs connection does not propagate an OTel trace context to the backend webhook; there is no parent context to inherit. This root span therefore appears in Langfuse as an independent **trace** with name `interview.webhook.tool`. The `interview.id` and `elevenLabs.sessionId` attributes on this trace allow Langfuse queries to correlate all webhook traces with the initiation trace for the same session without requiring a parent-child relationship.

**Attributes set at span open:**

| Key | Type | Value |
|---|---|---|
| `interview.id` | string | The interview UUID (extracted from the verified webhook payload) |
| `elevenLabs.sessionId` | string | The ElevenLabs session ID from the webhook payload |
| `webhook.tool_name` | string | The tool name (e.g. `next_question`, `score_answer`, `take_note`, `end_interview`) |

**Attributes set after handler completes:**

| Key | Type | Value |
|---|---|---|
| `webhook.result` | string | One of `ok`, `signature_rejected`, `use_case_error` |

### D3 — interview.webhook.session-end (session-end webhook span)

Each inbound session-end webhook event opens an `interview.webhook.session-end` span. Opened as the first statement of the session-end webhook controller, before signature verification, and closed in the handler's `finally` block. Also opened as a new root span for the same reason as D2. In Langfuse, this appears as an independent **trace** with name `interview.webhook.session-end`.

**Attributes set at span open:**

| Key | Type | Value |
|---|---|---|
| `interview.id` | string | The interview UUID |
| `elevenLabs.sessionId` | string | The ElevenLabs session ID |

**Attributes set after handler completes:**

| Key | Type | Value |
|---|---|---|
| `webhook.result` | string | One of `ok`, `signature_rejected`, `use_case_error` |

### D4 — interview.session.transcript-persist (transcript persistence span)

The transcript-persistence span wraps the `PersistCompletedTranscript` use case invocation. It is opened by the session-end webhook controller immediately after the session-end webhook span (D3) records the event, before calling the use case, and closed after the use case returns. This span is a **child** of the `interview.webhook.session-end` span (D3).

In Langfuse, D4 appears as a **span observation** nested under the D3 trace. It has no child generation observation because `PersistCompletedTranscript` calls the ElevenLabs REST API for the transcript (an HTTP call, not an AI SDK LLM call), so no Langfuse generation is auto-emitted.

When the post-call transcript contains an `end_call_success` tool-result entry (the agent's invocation of the built-in `end_call` system tool per ADR-034), its `reason` and `message` fields are extracted and stamped as span attributes for Langfuse correlation.

**Attributes set at span open:**

| Key | Type | Value |
|---|---|---|
| `interview.id` | string | The interview UUID |
| `elevenLabs.sessionId` | string | The ElevenLabs session ID |

**Attributes set after use case returns (success path):**

| Key | Type | Value |
|---|---|---|
| `transcript.entry_count` | number | The number of transcript entries persisted |
| `interview.end_call.reason` | string | The `reason` field from the `end_call_success` entry in the post-call transcript, when present |
| `interview.end_call.message` | string | The `message` field from the `end_call_success` entry, when present |

**Attributes set on error path:**

| Key | Type | Value |
|---|---|---|
| `error` | boolean | `true` |
| `error.kind` | string | The `ServiceError.kind` string |

### D5 — Acknowledge the split-observability boundary and its Langfuse representation

Per-turn STT transcription, LLM inference, and TTS synthesis for the conversational path are performed entirely inside the ElevenLabs platform via their LiveKit pipeline. These operations do not produce Langfuse traces, observations, or generations, because the backend is not in the per-turn path and the `@langfuse/otel` exporter only exports spans that the backend process opens. ElevenLabs' internal per-turn traces exist only in the ElevenLabs monitoring dashboard and are not accessible through the Langfuse SDK or API. This is not a gap in the tracing design: it is an accepted consequence of the architecture change (ADR-029).

Langfuse captures the backend-controlled surfaces: the signed-URL issuance trace (D1, which also records the SCHEDULED to IN_PROGRESS transition), the tool-call webhook traces (D2), and the post-call webhook trace (D3) with its nested transcript-persist observation (D4). There is no session-start-webhook trace: ElevenLabs does not emit a conversation-start notification for browser SDK sessions (ADR-034). All four span types are exported through the existing `@langfuse/otel` `LangfuseSpanProcessor` configured in `apps/backend`'s bootstrap, with no changes to the exporter or `shouldExportSpan` filter.

To correlate the three independent Langfuse traces for one interview session (D1, D2, D3) in a single view, Langfuse's **Sessions** feature can be used: if the backend sets `session_id = interview.id` via `propagateAttributes({ sessionId: interviewId })` around each handler call, all traces for one interview appear together in Langfuse's Sessions view. This is the recommended correlation strategy because it produces a browsable session timeline without requiring a SQL-style attribute join. The `elevenLabs.sessionId` attribute on D1 through D4 additionally allows a developer to cross-reference any Langfuse trace with the matching session in the ElevenLabs dashboard.

### D6 — Application-layer no-import rule continues to apply

ADR-012's rule that `packages/application/` must NOT import `@opentelemetry/api` is unchanged. The spans defined in this ADR are opened by presentation controllers (D1, D2, D3) and the presentation layer owns D4 as well (opened inside the session-end webhook controller). No span is opened in a use case.

## Alternatives Considered

### Alternative A: Reuse interview.turn.* span names for the conversational path

The presentation layer opens `interview.turn.tts`, `interview.turn.stt`, and `interview.turn.agent` spans as stubs when webhook events arrive, mapping each inbound tool event to one of the existing turn-level span types. Rejected for three reasons. First, those span names semantically assert that the backend is performing TTS synthesis, STT transcription, or agent inference — work it no longer does; the resulting Langfuse observations would be empty shells that misrepresent what actually happened. Second, ADR-012 explicitly ties these spans to the lifecycle of specific network calls (`ElevenLabsTextToSpeechService.synthesize()`, `DeepgramSpeechToTextService.openLive()`, `GeminiInterviewAgentService.runTurn()`); reusing the names for webhook handlers would break the documented lifecycle semantics. Third, Langfuse queries that filter on `interview.turn.stt` observations to measure Deepgram STT latency would be poisoned by stub entries with zero duration, producing misleading p50/p99 latency figures for the sandwich path.

### Alternative B: Drop backend tracing for the conversational path and rely solely on the ElevenLabs dashboard

No OTel instrumentation is added for Phase 9.5 backend surfaces. All turn-level observability comes from ElevenLabs' own UI. Rejected: the backend-controlled surfaces introduced in Phase 9.5 are exactly the new failure modes that ADR-034 introduces: HMAC signature rejection on the post-call webhook, ElevenLabs API errors during signed-URL issuance, and transcript-fetch failures at session end. A signature rejection that silently drops every tool call and leaves the `Interview` aggregate in a stale state would produce no Langfuse trace and no Langfuse observation, making the failure invisible without log scraping. The ElevenLabs dashboard shows that tool calls were dispatched from the agent's side; it does not show that the backend rejected them. Losing visibility over these surfaces would make the two most likely production incidents (webhook auth mis-configuration and transcript-persist failures) undetectable from Langfuse.

### Alternative C: Do nothing, leave the hierarchy as-is

Phase 9.5 code ships without amending the span hierarchy, leaving span ownership ad hoc. Rejected: ADR-012 established that ad-hoc span names diverge across phases, producing unqueryable Langfuse timelines. Phase 9.5 is a significant architecture boundary (sandwich to conversational); not documenting the observability boundary at this point is precisely the scenario ADR-012's anti-alternative E ("let each phase choose its own span names") warned against.

### Alternative D: Extend interview.session.agent to cover the conversational initiation

Reuse `interview.session.agent` for the `StartCandidateSession` span, since both paths represent the start of an interview session with an AI agent. Rejected per ADR-014 Alternative D's reasoning: different session types have different orchestrators, different attributes, and different lifecycle shapes. The conversational initiation trace in Langfuse has no nested generation observation (no AI SDK call); its structure is fundamentally different from the sandwich session trace, which does contain a nested AI SDK generation. Using the same name would conflate two structurally distinct trace types in Langfuse queries and break the per-session-type latency analysis that the qualified names enable.

## Consequences

**Benefits**

- Backend-controlled surfaces for the conversational path (signed-URL issuance, webhook handling, transcript persistence) remain observable in Langfuse with no changes to the `@langfuse/otel` exporter or the `shouldExportSpan` filter. The existing `interview.` prefix filter captures all four new span types.
- D1 becomes a Langfuse trace with name `interview.session.conversational`; D2 traces are named `interview.webhook.tool`; D3 traces are named `interview.webhook.session-end`; D4 is a span observation nested under D3. All four are browsable in the Langfuse Traces view immediately after Phase 9.5 deploys.
- Using `interview.id` as the Langfuse `session_id` groups the D1, D2, and D3 independent traces into one Langfuse Session, giving a browsable per-interview session timeline in the Langfuse Sessions view without manual attribute joins.
- The `elevenLabs.sessionId` attribute on D1 through D4 is the correlation key that links Langfuse backend traces to ElevenLabs per-session monitoring. A developer debugging a production incident can find the session in both tools with one search. Because `elevenLabsSessionId` is bound at signed-URL issuance time (ADR-033), the attribute is present from D1 onward.
- ADR-012's application-layer no-import rule is preserved, so `packages/application/` continues to be span-unaware and the Clean Architecture dependency direction is not compromised.
- The `transcript.entry_count` attribute on the D4 observation provides an immediate correctness signal in Langfuse: a session-end trace where the nested transcript-persist observation has `transcript.entry_count = 0` indicates a failed transcript fetch without reading any logs.

**Trade-offs**

- Per-turn STT, LLM inference, and TTS traces for the conversational path are not in Langfuse. They exist only in the ElevenLabs monitoring dashboard. Observability is split across two tools for conversational sessions: Langfuse for backend-side traces and observations, ElevenLabs for per-turn session data. Cost-per-interview attribution must combine ElevenLabs per-minute billing data with Langfuse traces, as there is no unified cost view.
- Webhook traces (D2, D3) are independent Langfuse traces, not observations nested under the D1 initiation trace. Langfuse cannot render them in a single trace tree automatically. The Langfuse Sessions view (with `session_id = interview.id`) is the recommended alternative for the session-level unified view.
- The number of distinct session trace names in Langfuse grows from two (`interview.session.scripted`, `interview.session.agent`) to three. Cross-phase Langfuse queries that filter by session trace name must enumerate all three values; queries that group by `interview.id` or by Langfuse `session_id` are unaffected.

**Risks and mitigations**

- *Risk*: Split observability (Langfuse backend traces plus ElevenLabs dashboard) makes end-to-end debugging of a failed session require two browser tabs instead of one. *Mitigation*: Stamp `elevenLabs.sessionId` on every backend trace (D1 through D4); document the correlation workflow in `docs/ARCHITECTURE.md` §4.6. The attribute is also surfaced in backend logs alongside the span, so a log search is a fallback.
- *Risk*: Webhook spans are short-lived HTTP handlers. If a span is opened after the first `await` (e.g. after HMAC signature verification), OTel context propagation from the inbound request may already be stale, producing an incorrectly parented or orphaned Langfuse observation. *Mitigation*: The span must be opened as the first statement of the handler, before any `await`, per ADR-012's lifecycle rule. The LLM judge in the Enforcement block checks this convention on new webhook controller code.
- *Risk*: The `elevenLabs.sessionId` is bound during `StartCandidateSession` via `getSignedUrl({ includeConversationId: true })`. If the SDK response shape changes or the `conversation_id` field is absent, the binding fails and the attribute is missing from D1. *Mitigation*: `StartCandidateSession` treats a missing `conversation_id` in the signed-URL response as an error and returns `ServiceError`; the span's error path stamps `error.kind` so the failure is visible in Langfuse. ADR-033 pins the SDK version and the `includeConversationId` flag.
- *Risk*: A future infrastructure adapter introduces new backend-controlled surfaces and authors span names outside the `interview.` namespace, breaking the Langfuse `shouldExportSpan` filter. *Mitigation*: The Enforcement block below checks that new `startSpan` calls in presentation and infrastructure code use the `interview.` name prefix.
- *Risk*: The `LangfuseSpanProcessor`'s `shouldExportSpan` filter (or its `isDefaultExportSpan` default) drops non-LLM spans by default following a future SDK upgrade. *Mitigation*: Per the Langfuse JS/TS SDK upgrade guide, the `shouldExportSpan` callback must extend the default with `isDefaultExportSpan(otelSpan) || otelSpan.name.startsWith("interview.")` rather than replacing it. Any SDK upgrade must be tested against a smoke test that confirms at least one `interview.session.conversational` trace reaches Langfuse after a test session.

## Related Decisions

- **ADR-012 (Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns)**: This ADR extends ADR-012 by adding four new span types for the conversational path. ADR-012's lifecycle rule (span opened before first `await`), its application-layer no-import rule, and its `interview.` namespace requirement all apply unchanged. ADR-012 is NOT superseded; its span definitions remain valid for the sandwich path.
- **ADR-014 (Extend OTel Span Hierarchy with `interview.turn.agent` and Unify Session Span as `interview.session.agent`)**: This ADR follows ADR-014's "extend, not replace" framing and its session-name qualification convention. ADR-014 is NOT superseded.
- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: The split-observability tradeoff in this ADR is a direct consequence of the ElevenLabs Conversational AI architecture. ADR-004's principle that "Deepgram and ElevenLabs calls are instrumented as custom OTel spans" no longer holds for per-turn calls in the conversational path; the `@langfuse/otel` exporter only sees spans the backend process opens, and the backend is not in the per-turn path. ADR-004 continues to apply to the four backend-controlled spans defined here.
- **ADR-029 (Adopt ElevenLabs Conversational AI)**: The initiation span (D1) and webhook spans (D2, D3, D4) are the observability layer for the backend surfaces introduced by ADR-029. ADR-029 is the architectural source of the surfaces; this ADR records the span schema and corresponding Langfuse trace/observation structure for those surfaces.
- **ADR-030 (Superseded by ADR-033, 2026-05-27)** — original static-agent decision; superseded by ADR-033 which corrected the override delivery channel from a synchronous webhook to inline browser SDK overrides. The static-agent decision itself carries forward to ADR-033.
- **ADR-034 (Supersedes ADR-031)** — the two-surface webhook lifecycle (per-tool routes and post-call) defines the receivers traced by D2 (tool webhook per route) and D3 (post-call webhook) with D4 (transcript-persist child of D3). There is no session-start-webhook surface; the SCHEDULED to IN_PROGRESS transition that the first ADR-034 draft attributed to a `session.started` webhook is owned by `StartCandidateSession` and recorded in D1.
- **ADR-001 (Adopt Clean Architecture and DDD)**: D6 continues ADR-001's dependency-direction requirement. Presentation controllers own span lifecycle; application use cases remain span-unaware.

## References

- `docs/progress/phase-9.md` §"Phase 9.5 — Migration to ElevenLabs Conversational Agents": Phase 9.5 backend layer plan, surface inventory, and tradeoff notes (split observability listed explicitly under "Langfuse integration").
- `apps/backend/src/presentation/controllers/candidate-session.controller.ts` (Phase 9.5, to be created): D1 initiation span owner.
- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` (Phase 9.5, to be created): D2, D3, D4 span owners.
- `apps/backend/src/presentation/controllers/interview-session.controller.ts:41-61`: Reference implementation of the session span open plus `otelContext.with(...)` propagation pattern (ADR-012).
- ADR-033 (server-built overrides via browser SDK; SCHEDULED to IN_PROGRESS transition at issuance), ADR-034 (two-surface webhook lifecycle: per-tool routes and post-call; no session-start webhook on browser SDK path).
- `docs/adr/ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md`: Base span schema; lifecycle rule and `@opentelemetry/api` import prohibition.
- `docs/adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md`: "Extend, not replace" precedent; session span qualification convention.
- Langfuse tracing data model (traces, observations, generations, sessions): https://langfuse.com/docs/tracing
- Langfuse sessions feature (grouping multiple traces by `session_id`): https://langfuse.com/docs/tracing-features/sessions
- Langfuse `@langfuse/otel` package and `LangfuseSpanProcessor`: https://www.npmjs.com/package/@langfuse/otel
- Langfuse JS/TS SDK `shouldExportSpan` / `isDefaultExportSpan` (span filtering): https://langfuse.com/docs/observability/sdk/upgrade-path/js-v4-to-v5
- `.claude/skills/langfuse/SKILL.md` and `.claude/skills/langfuse/references/instrumentation.md`: Project Langfuse skill describing observation types, session grouping, and `shouldExportSpan` best practices.
- ElevenLabs Conversational AI documentation (webhook lifecycle): https://elevenlabs.io/docs/conversational-ai/workflows/webhooks
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- OTel Semantic Conventions naming conventions: https://opentelemetry.io/docs/specs/semconv/general/naming/

## Enforcement

Two rules are expressible declaratively and one requires LLM judgement. The declarative rules reaffirm ADR-012's application-layer no-import prohibition and enforce the `interview.` span name prefix on new `startSpan` calls. The LLM judge checks the lifecycle placement rule (span opened before first `await`) for all new webhook controller handlers and the session-initiation controller, consistent with the `llm_judge: true` convention from ADR-012 and ADR-014.

```json
{
  "forbid_import": [
    {
      "pattern": "from [\"']@opentelemetry/api[\"']",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must not import @opentelemetry/api. Span ownership belongs to infrastructure adapters and presentation controllers (ADR-032, ADR-012, ADR-001)."
    }
  ],
  "forbid_pattern": [
    {
      "pattern": "startSpan\\([\"'](?!interview\\.)",
      "path_glob": "apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts",
      "message": "All spans in the ElevenLabs webhook controller must use the interview. name prefix (ADR-032)."
    },
    {
      "pattern": "startSpan\\([\"'](?!interview\\.)",
      "path_glob": "apps/backend/src/presentation/controllers/candidate-session.controller.ts",
      "message": "All spans in the candidate-session controller must use the interview. name prefix (ADR-032)."
    }
  ],
  "require_pattern": [],
  "llm_judge": true
}
```
