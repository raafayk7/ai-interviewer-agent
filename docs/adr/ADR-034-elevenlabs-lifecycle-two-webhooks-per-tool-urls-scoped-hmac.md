# ADR-034 ElevenLabs Conversational AI Lifecycle: Two Inbound Webhook Surfaces with Scoped HMAC, Per-Tool URLs, and Post-Call End-Reason Recovery

## Status

Accepted. Date: 2026-05-29.

Supersedes ADR-031.

Note: this is a Proposed-stage revision of the initial ADR-034 draft (2026-05-27), which incorrectly described three fire-and-forget webhook surfaces including a `session.started` surface. The correction here removes that surface entirely: ElevenLabs emits no conversation-start webhook for browser SDK sessions. The SCHEDULED to IN_PROGRESS transition that the first draft attributed to `StartInterviewFromWebhookUseCase` has moved into `StartCandidateSession` at signed-URL issuance (ADR-033). See the new Alternative F for the rationale.

## Context

ADR-031 (Proposed 2026-05-20) described four inbound webhook surfaces for the ElevenLabs-path interview lifecycle: a synchronous conversation-initiation webhook, a `session.started` fire-and-forget webhook, a unified tool-call webhook (dispatched by body-field discrimination), and a `session.ended` fire-and-forget webhook. The phase 9.5 live-validation spike (docs/spikes/phase-9-5-live-findings.md, Priorities 1-4) produced evidence that invalidates three of those four design choices:

**Priority 1: The synchronous initiation webhook does not fire for browser SDK sessions.** ElevenLabs documents `conversation_initiation_client_data_webhook` exclusively within the Twilio-inbound-call channel. The Personalization index lists "Twilio Integration: Personalize inbound call experiences via webhooks" as the only webhook-based personalization path. The Twilio Personalization page opens with "When receiving inbound Twilio calls..." and scopes prerequisites to "inbound Twilio calls". No documentation, GitHub issue, or SDK example records this webhook firing for a browser session started via `Conversation.startSession({ signedUrl })`. The implication: ADR-031's initiation webhook surface cannot be reached from the browser SDK path, and ADR-030's static-agent-with-per-session-overrides design must deliver overrides inline through `Conversation.startSession({ overrides, dynamicVariables })` instead (captured in ADR-033, which supersedes ADR-030). The same Priority 1 finding also means ElevenLabs does not emit a fire-and-forget `session.started` webhook for browser sessions. There is no HTTP notification from ElevenLabs when a browser conversation begins. Consequently, the `StartInterviewFromWebhookUseCase` (which the first ADR-034 draft assigned to a `session.started` surface) has been deleted. The SCHEDULED to IN_PROGRESS transition is performed by `StartCandidateSession` at signed-URL issuance — the only server-side moment the backend controls in the browser SDK flow (ADR-033).

**Priority 2: Tool webhook discrimination by body field is impossible; per-tool URLs are the correct pattern.** `tool_name` does not appear in any ElevenLabs server-tool webhook request: not in the body, not in headers, not in the path. The body is shaped exclusively by the tool's `request_body_schema`; with the phase 9.5 empty schema, every tool POST arrived as `{}` — three indistinguishable bodies. The SDK type `WebhookToolApiSchemaConfigInput` defines the request as `{ url, method, pathParamsSchema, queryParamsSchema, requestBodySchema, requestHeaders, contentType, authConnection }` with no envelope. Two community implementations confirm per-tool URLs as the canonical pattern: `solmail-website` registers `/api/ai/do/${toolDef.name}` per tool; `clinivox` registers `/api/tools/<slug>` per tool. Additionally, ElevenLabs does not HMAC-sign server-tool webhooks: the `ElevenLabs-Signature: t=<unix>,v0=<hex>` header is documented only for the workspace post-call webhook (SDK `webhooks.ts` `constructEvent`). All three live tool POSTs arrived with no signature header.

**Priority 3: `end_call` is a system tool and never dispatches an HTTP webhook.** ElevenLabs categorizes `end_call` as `type: "system"`. The system-tools documentation explicitly states system tools "modify the internal state of the conversation without making external calls." `SystemToolConfigInput` has no URL field. The browser SDK (`BaseConversation.ts` L355-360) observes `tool_name === "end_call"` in an `agent_tool_response` event and calls `endSessionWithDetails()` to close the WebSocket. The end reason surfaces in the post-call transcript at `data.transcript[<final turn>].tool_results[]` with `result_type === "end_call_success"` carrying `{ status, reason, message }`. This invalidates the ADR-031 `end_interview` tool-webhook row and the `EndInterviewFromAgentUseCase`.

**Priority 4: Post-call payload field names and HMAC tolerance are now confirmed.** Post-call payloads use snake_case throughout: `data.conversation_id`, `data.status`, `data.transcript[]`, `data.metadata.start_time_unix_secs`, `data.metadata.call_duration_secs`, `data.metadata.termination_reason`. There is no top-level `ended_by` or `end_reason`; end reason is per-turn in `tool_results`. The HMAC tolerance window is 30 minutes (not 5), per SDK `constructEvent`. The existing `addContentTypeParser` that captures `req.rawBody` for HMAC verification is correct and must be preserved.

**Tool correlation via injected `interview_id`.** Each tool's `request_body_schema` includes an `interview_id` field with `dynamicVariable: "interview_id"` (SDK type `LiteralJsonSchemaProperty.dynamicVariable`, wire value `dynamic_variable`). The agent injects the value from the session dynamic variable passed via `Conversation.startSession({ dynamicVariables: { interview_id } })`. The backend correlates tool webhooks on `interview_id` alone; the conversation id in the tool payload is optional and used only as a span attribute when present. See `apps/backend/scripts/live-validation/provision-agent.mjs` and `wire-webhooks.mjs` for the provisioning-side schema, and `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` (`parseScoreAnswerPayload` / `parseTakeNotePayload` / `getInterviewIdFromPayload`) for the controller-side extraction.

These findings together invalidate ADR-031's webhook surface model and require a corrected record.

This ADR applies to the ElevenLabs path only. The sandwich path (ADR-013) remains valid and unchanged. The domain state machine (`SCHEDULED -> IN_PROGRESS -> COMPLETED`) and the IN_PROGRESS-gated aggregate mutators (`appendNote`, `appendInternalScore`) are unaffected.

## Decision

Drive the ElevenLabs-path interview lifecycle from **two inbound webhook surfaces**, both fire-and-forget: per-tool custom-tool webhooks (one route per tool) and post-call. There is no session-start webhook. The synchronous initiation webhook surface from ADR-031 is removed; overrides are delivered inline via the browser SDK per ADR-033. There is no `session.started` webhook surface; the SCHEDULED to IN_PROGRESS transition is performed by `StartCandidateSession` at signed-URL issuance (ADR-033). The built-in `end_call` system tool does not dispatch any HTTP traffic; its reason surfaces in the post-call transcript and is consumed by `PersistCompletedTranscriptUseCase`.

The four-route surface (three tool routes counted separately plus post-call) and their mapping:

| Route | Type | Auth mechanism | Use case | Aggregate mutation |
|---|---|---|---|---|
| `POST /webhooks/elevenlabs/tools/next_question` | fire-and-forget | shared-secret header (`x-voice-secret: <ELEVENLABS_TOOL_WEBHOOK_SECRET>`) | no-op acknowledgment | none |
| `POST /webhooks/elevenlabs/tools/score_answer` | fire-and-forget | shared-secret header | `RecordInternalScore` | `interview.appendInternalScore(score)` |
| `POST /webhooks/elevenlabs/tools/take_note` | fire-and-forget | shared-secret header | `RecordAgentNote` | `interview.appendNote(note)` |
| `POST /webhooks/elevenlabs/post-call` | fire-and-forget | HMAC-SHA256 (`ELEVENLABS_WEBHOOK_SECRET`) | `PersistCompletedTranscript` | end_reason extracted from transcript; `interview.complete(at, transcript)` — IN_PROGRESS to COMPLETED |

**Session-start transition.** There is no `/session-start` webhook route. The SCHEDULED to IN_PROGRESS transition is owned by `StartCandidateSession` at signed-URL issuance (ADR-033, `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:93-99`). `PersistCompletedTranscriptUseCase` is the sole owner of the IN_PROGRESS to COMPLETED transition.

**Per-tool URL routing.** Each tool's `apiSchema` in the ElevenLabs agent provisioning script declares `url: <base>/webhooks/elevenlabs/tools/<name>`, a `request_body_schema` matching the tool's parameter shape including an `interview_id` field with `dynamicVariable: "interview_id"`, and `requestHeaders: { "x-voice-secret": "<ELEVENLABS_TOOL_WEBHOOK_SECRET>" }`. The backend registers three independent POST routes; each route is its own discriminator. The `provision-agent.mjs` script holds the single source of truth for the URL map; any tool added there must have a corresponding route registration. Current registered routes: `/tools/next_question`, `/tools/score_answer`, `/tools/take_note`, `/post-call` — confirmed in `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts`.

**HMAC scoped to post-call only.** `ElevenLabsWebhookVerifier` (HMAC-SHA256 over `${timestamp}.${rawBody}`, 30-minute tolerance, `timingSafeEqual`) applies only to `/post-call`. There is no session-start route for HMAC to apply to. Tool routes use a separate shared-secret-header verifier: constant-time string comparison of the `x-voice-secret` request header against `ELEVENLABS_TOOL_WEBHOOK_SECRET`. Authentication code: `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` (HMAC, post-call) and `apps/backend/src/infrastructure/auth/elevenlabs-tool-secret-verifier.ts` (shared-secret, tool routes). The Fastify `addContentTypeParser` that captures `req.rawBody` for the HMAC computation is preserved unchanged.

**Tool correlation by injected `interview_id`.** Each tool's `request_body_schema` carries `interview_id: { type: "string", dynamicVariable: "interview_id" }`. The ElevenLabs agent injects the interview id from the session dynamic variable (passed via `Conversation.startSession({ dynamicVariables: { interview_id } })`). The controller (`getInterviewIdFromPayload` in `elevenlabs-webhook.controller.ts`) reads `interview_id` from the tool payload's dynamic variables block or directly from the root. The conversation id in the tool payload is optional: it is used as a span attribute when present but is not required for routing.

**`end_call` handled exclusively in post-call transcript walk.** `EndInterviewFromAgentUseCase` is deleted. `PersistCompletedTranscriptUseCase` walks `transcript[].tool_results[]` for an entry where `result_type === "end_call_success"`, extracts `reason` and `message`, and persists them as an `AgentNote` before calling `interview.complete()`. If no such entry is found, the transcript is persisted and the interview completed without an end-reason note.

**Post-call payload field access (locked).** The use case reads: `body.data.conversation_id` (to locate the interview via `findByElevenLabsSessionId`), `body.data.transcript` (array of turn objects), `body.data.metadata.start_time_unix_secs` (for `started_at`), `body.data.metadata.call_duration_secs` (to compute `ended_at = start + duration`). `body.data.metadata.termination_reason` is recorded as supplemental metadata but is not the primary end-reason signal (which is the `end_call_success` transcript entry). Zod validates `body.data` on receipt; a shape mismatch returns HTTP 400 and triggers an alert.

**`elevenLabsSessionId` binding at issuance.** Because `getSignedUrl({ includeConversationId: true })` returns the `conversation_id` server-side before the browser connects (per ADR-033), the binding is established in `StartCandidateSession` at URL issuance time. Incoming `conversation_id` values on post-call that do not match any interview are genuinely unrelated sessions, not timing races.

**Idempotency contract (updated from ADR-031 first draft).** There is no `session.started` duplicate-handling clause; that surface is gone. A duplicate post-call on a COMPLETED interview is a no-op. An unmatched `conversation_id` on post-call returns HTTP 200 (suppress redelivery) while the span stamps `webhook.result: "use_case_error"` and `error.kind: "INTERVIEW_NOT_FOUND"` for Langfuse visibility. Reconnect scenario: a candidate browser refresh re-issues a single-use signed URL and re-binds a new conversation id; `StartCandidateSession` accepts SCHEDULED or IN_PROGRESS and performs the `interview.start()` transition only from SCHEDULED, so a second call on an IN_PROGRESS interview is a no-op for the lifecycle transition but updates the bound `elevenLabsSessionId`.

**Span hierarchy.** Aligned with ADR-032 as amended: D1 (session initiation in StartCandidateSession — stamps `elevenLabs.sessionId` at signed-URL issuance time AND performs the SCHEDULED to IN_PROGRESS transition), D2 (tool webhook per route), D3 (post-call webhook, span name `interview.webhook.session-end`), D4 (transcript-persist child of D3, span name `interview.session.transcript-persist`). There is no session-start-webhook span.

This ADR applies to the ElevenLabs path only. ADR-013 orchestration for the sandwich path is unaffected.

## Alternatives Considered

### Alternative A: Synchronous initiation webhook (ADR-031's original mechanism)

Drive per-session context injection and `elevenLabsSessionId` binding through the `conversation_initiation_client_data_webhook` synchronous request/response surface, as documented in ADR-030 and ADR-031.

Rejected. The webhook is documented exclusively for the Twilio-inbound-call channel. The ElevenLabs Personalization index lists Twilio webhooks as the only webhook-based personalization path; the Twilio Personalization page's prerequisites are scoped to "inbound Twilio calls". No documentation, GitHub issue, community implementation, or SDK code path records this webhook firing for a browser session started via `Conversation.startSession({ signedUrl })`. Live evidence during phase 9.5 validation: the webhook endpoint received zero calls across multiple browser-SDK sessions. The browser SDK delivers overrides through the `conversation_initiation_client_data` WebSocket client-to-server message, not through an HTTP webhook. ADR-033 captures the corrected transport; this ADR removes the now-unreachable surface.

### Alternative B: Single `/webhooks/elevenlabs/tools` route with body-field discrimination

Register one route for all tool calls and dispatch to the correct handler by reading a `tool_name` field from the request body.

Rejected. `tool_name` is not present in any ElevenLabs server-tool webhook request body, header, or path. The request body is shaped entirely by the tool's `request_body_schema`. With the phase 9.5 agent's empty schemas, three consecutive tool calls arrived as `{}` — indistinguishable by any body-field read. The SDK type `WebhookToolApiSchemaConfigInput` has no envelope field. Two independent community implementations (`solmail-website`, `clinivox`) use per-tool URLs as the discriminator. No known community implementation uses body-field discrimination.

### Alternative C: HMAC-sign every webhook including custom tools

Extend HMAC-SHA256 verification using `ELEVENLABS_WEBHOOK_SECRET` to all webhook routes, including per-tool routes, for uniform security.

Rejected. ElevenLabs does not HMAC-sign custom server-tool webhook calls. The `ElevenLabs-Signature: t=<unix>,v0=<hex>` header is documented only for the workspace post-call webhook; the SDK `webhooks.ts` `constructEvent` function handles only that signature format. Live evidence: three tool POST calls arrived in phase 9.5 with no `ElevenLabs-Signature` header. Implementing HMAC verification on tool routes would reject all real tool calls with HTTP 401. Per-tool security uses the `requestHeaders` shared-secret mechanism (`x-voice-secret`), which ElevenLabs forwards verbatim on every invocation of that tool.

### Alternative D: Treat `end_call` as a custom-tool webhook

Register `POST /webhooks/elevenlabs/tools/end_call` and handle interview completion there, symmetrically with `score_answer` and `take_note`.

Rejected. `end_call` is `type: "system"` in the ElevenLabs agent configuration. `SystemToolConfigInput` has no URL field — the type does not support webhook dispatch. The system-tools documentation states system tools "modify the internal state of the conversation without making external calls." The browser SDK (`BaseConversation.ts` L355-360) closes the WebSocket on receiving the `agent_tool_response` for `end_call`; no HTTP call is ever made. The end reason is observable only in the post-call transcript's `tool_results[]`. Attempting to register a webhook URL for `end_call` would have no effect; the backend would never receive a call on that route.

### Alternative E: Poll the ElevenLabs API for session state and transcript

On a periodic background job, call the ElevenLabs API to check whether the session has started, what tool calls have been made, and whether the session has ended.

Rejected for the same reasons as ADR-031 Alternative E. Polling adds latency between the candidate's action and the status update visible to the recruiter. ElevenLabs pushes these events natively as webhooks. No ElevenLabs polling endpoint exposes per-tool-call granularity mid-session; tool calls are only available in the final session transcript, meaning `RecordInternalScore` and `RecordAgentNote` could not be populated during the session under a polling model.

### Alternative F: A fire-and-forget `session.started` webhook for SCHEDULED to IN_PROGRESS transition

Register `POST /webhooks/elevenlabs/session-start` as a fire-and-forget surface. When ElevenLabs begins a conversation, it fires this webhook; the backend receives it, verifies the signature, and invokes `StartInterviewFromWebhookUseCase` to perform the SCHEDULED to IN_PROGRESS transition. This was the design in the first draft of ADR-034.

Rejected. The Priority 1 finding (the same evidence that eliminates the synchronous initiation webhook) means ElevenLabs emits no conversation-start webhook for browser SDK sessions. The ElevenLabs Personalization index and Twilio Personalization page scope all webhook-based session notifications to the Twilio inbound-call channel. No documentation, community implementation, or Phase 9.5 live-validation run recorded any fire-and-forget start webhook arriving from a browser-SDK session. A `session.started` webhook surface would receive zero calls and would never perform the lifecycle transition, leaving every interview stuck in SCHEDULED. The transition is owned by `StartCandidateSession` instead (ADR-033), which is the only moment in the browser flow when the backend has server-side control.

### Alternative G: Backchannel per-turn transcript streaming from the browser

The candidate's browser forwards partial transcript data to the backend during the session, restoring per-turn persistence semantics from ADR-013 D4.

Rejected for the same reasons as ADR-031 Alternative F. The browser-to-ElevenLabs connection is LiveKit-managed and fully outside backend control. A second backchannel from the browser during every session is additional infrastructure and an additional failure surface. The post-call webhook delivers the authoritative final transcript, making partial forwarding redundant.

## Consequences

**Benefits**

- No synchronous webhook on the critical path of conversation start. The removed initiation surface eliminates the per-conversation blocking HTTP fetch that ADR-031 introduced; overrides arrive inline via the browser SDK per ADR-033, with zero backend round-trip before the conversation begins.
- No session-start webhook surface to implement, maintain, or rotate secrets for. The SCHEDULED to IN_PROGRESS transition happens in the existing `StartCandidateSession` path, reducing the total number of backend entry points for the ElevenLabs lifecycle to four routes (three tool routes and post-call).
- Per-tool URL routing is mechanically explicit: the route is the discriminator. No body-parsing logic can misfire; a misconfigured or missing tool schema produces a clear 404 rather than silent misrouting.
- Tool correlation by injected `interview_id` is simpler than conversation-id lookup: the agent injects the interview id directly from the session dynamic variable, and the backend correlates without a database round-trip to resolve `conversation_id -> interview_id`.
- Scoped authentication reduces the cryptographic surface to one secret per channel: `ELEVENLABS_WEBHOOK_SECRET` for the post-call lifecycle webhook, `ELEVENLABS_TOOL_WEBHOOK_SECRET` for tool webhooks. Each secret has exactly one consumer in the composition layer.
- `end_call` is handled correctly and without a race condition. `PersistCompletedTranscriptUseCase` is the single owner of the IN_PROGRESS to COMPLETED transition and the only reader of end_reason.
- `elevenLabsSessionId` binding at issuance time (per ADR-033) removes the ambiguity window in which the first arriving webhook had to be trusted as the session's identity anchor. Unmatched post-call `conversation_id` values are now definitively "not ours."

**Trade-offs**

- `ELEVENLABS_TOOL_WEBHOOK_SECRET` is a required environment variable that must be set on both the backend and in each tool's `apiSchema.requestHeaders` during provisioning. A mismatch produces silent 401 failures on tool calls: the LLM invokes a tool, the webhook is rejected, and the agent receives no result. The live-validation harness re-runs every tool path on each provisioning; a misconfigured secret surfaces on the first conversation.
- Per-tool URLs increase the route count from one tool endpoint to three. This is negligible operationally; the route plugin registers three POSTs. The provisioning script holds the single source of truth for the URL map, so a tool added in provisioning but not in the backend route plugin will produce 404s caught by the live-validation harness.
- The 30-minute HMAC tolerance window (correct per SDK; ADR-031 used a 5-minute draft value) allows a wider replay window on the post-call route. This is the documented ElevenLabs behavior; accepting it trades a narrower replay window for zero false-rejection of legitimately slow deliveries.
- `end_reason` arrives only at the post-call boundary, seconds to minutes after the call ends. The recruiter UI cannot surface "agent ended for reason X" in real time. This is acceptable: the interview is COMPLETED-state-visible immediately after the post-call webhook is processed, and the end reason is a soft diagnostic signal rather than a user-facing action gate.

**Risks and mitigations**

- *Risk*: Per-tool URL provisioning drifts: a tool's `apiSchema.url` changes in the provisioning script but the backend route is not updated, or vice versa. *Mitigation*: The live-validation harness re-runs every tool surface end-to-end; the test asserts each tool call lands on the expected backend route. The provisioning script reads URLs from a single map, making it the authoritative list.
- *Risk*: `ELEVENLABS_TOOL_WEBHOOK_SECRET` is leaked. *Mitigation*: The secret is workspace-scoped to ElevenLabs egress traffic only. Rotation requires re-provisioning all three tools with a new `requestHeaders` value and updating the backend environment variable simultaneously.
- *Risk*: A future tool is added to the provisioning script without a corresponding route registration in the backend. *Mitigation*: There is no declarative rule that can catch "tool added in provisioning but missing in route handler" — the LLM judge advisory on webhook controller changes is the primary catch. The live-validation harness serves as the integration gate.
- *Risk*: ElevenLabs changes the post-call payload field names in a future SDK version. *Mitigation*: Zod validates `body.data` on every receipt; a shape mismatch returns HTTP 400 and triggers an alert before any domain mutation occurs. The payload shape is documented in ElevenLabs post-call webhooks docs and tracked in this ADR's References.
- *Risk*: The post-call webhook never arrives (ElevenLabs delivery failure or network partition). *Mitigation*: A reconciliation sweep (Phase 10, carried forward from ADR-031) will identify interviews that have been IN_PROGRESS beyond `maxDurationMinutes + graceBuffer` and attempt transcript recovery via the ElevenLabs REST API using the stored `elevenLabsSessionId`. This is explicitly out of scope for Phase 9.5.
- *Risk*: `end_call_success` extraction in `PersistCompletedTranscriptUseCase` misses the entry due to a transcript shape variation (multiple tool results in one turn, nested results, empty `tool_results`). *Mitigation*: The use case is tested against representative transcript fixtures covering: success path with `end_call_success`, transcript with no `tool_results` on the final turn, and transcript with multiple tool results in one turn. If the entry is absent, the use case completes the interview without an end-reason note rather than failing.
- *Risk*: Webhook spoofing on tool routes via a forged `x-voice-secret` header. *Mitigation*: Constant-time string comparison (`timingSafeEqual`) on `x-voice-secret`. The secret is workspace-scoped and not embedded in any client-side artifact. The tool routes' aggregate mutations are append-only (notes and scores); a spoofed call would add junk data to an IN_PROGRESS interview. The COMPLETED-state guard prevents spurious completion.
- *Risk*: A developer re-introduces a `/session-start` route or `StartInterviewFromWebhookUseCase`, incorrectly believing ElevenLabs emits a conversation-start webhook for browser sessions. This would be dead code that misleads readers and could create a dangling transition path. *Mitigation*: The Enforcement block below guards against `session-start` route names and `StartInterviewFromWebhook` use-case references in backend source. ADR-033 owns the lifecycle transition with cross-references to this ADR.

## Related Decisions

- **ADR-029 (Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline)**: This ADR depends on ADR-029's adoption of ElevenLabs as the voice pipeline. Still in full effect.
- **ADR-033 (supersedes ADR-030)**: Overrides delivery via browser SDK `Conversation.startSession` and SCHEDULED to IN_PROGRESS transition at signed-URL issuance. This ADR pairs directly with ADR-033: ADR-033 removes the initiation webhook from the transport and owns the session-start lifecycle transition; this ADR removes both the initiation webhook and the `session.started` fire-and-forget surface from the webhook inventory.
- **ADR-031 (Superseded by this ADR)**: The original four-surface lifecycle model. This ADR supersedes ADR-031 entirely.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: The tool surface defined in ADR-013 D1 (`next_question`, `score_answer`, `take_note`) carries forward to the ElevenLabs path. The `end_interview` tool intent from D1 is realized by ElevenLabs's built-in `end_call` system tool, which closes the session via WebSocket rather than an HTTP webhook. ADR-013's sandwich-path orchestration is unaffected.
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: The HMAC idiom is reused for `ELEVENLABS_WEBHOOK_SECRET` verification (post-call only): `node:crypto` HMAC-SHA256, constant-time compare, no external dependency.
- **ADR-016 (Adopt better-auth for Recruiter Authentication)**: Webhook routes are excluded from the better-auth pre-handler (unchanged from ADR-031).
- **ADR-019 (Recruiter Ownership Checks Live in the Presentation Layer)**: Webhook ownership is scoped by `conversation_id` payload mapped to `interview_id`, not by a recruiter session. This remains an explicit carve-out from ADR-019's scope.
- **ADR-032 (Extend OTel Span Hierarchy for ElevenLabs Conversational Sessions)**: Amended alongside this ADR: no session-start-webhook span exists; D1 now stamps `elevenLabs.sessionId` at issuance time and records the SCHEDULED to IN_PROGRESS transition there; D2 (tool webhook), D3 (post-call), and D4 (transcript-persist child of D3) are unchanged.

## References

- `docs/spikes/phase-9-5-live-findings.md` (2026-05-27) — Priorities 1, 2, 3, 4: live-evidence basis for each design change in this ADR.
- SDK: `WebhookToolApiSchemaConfigInput` (no envelope, confirming per-tool URL pattern) — https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/types/WebhookToolApiSchemaConfigInput.ts
- SDK: `SystemToolConfigInput` (no URL field, confirming `end_call` does not dispatch externally) — https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/types/SystemToolConfigInput.ts
- SDK: `constructEvent` (HMAC-SHA256, 30-minute tolerance, post-call only) — https://github.com/elevenlabs/elevenlabs-js/blob/main/src/wrapper/webhooks.ts
- SDK: `BaseConversation.ts` L355-360 (browser SDK closes WebSocket on `end_call` agent_tool_response) — https://github.com/elevenlabs/packages/blob/main/packages/client/src/BaseConversation.ts
- ElevenLabs Server tools documentation — https://elevenlabs.io/docs/agents-platform/customization/tools/server-tools
- ElevenLabs System tools documentation (no external calls for system tools) — https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools
- ElevenLabs Post-call webhooks documentation (payload sample and HMAC) — https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
- Community example: per-tool URL pattern with `requestHeaders` shared secret (solmail) — https://github.com/sol-mail/solmail-website/blob/main/Zero/scripts/register-elevenlabs-tools.ts
- Community example: per-tool URL pattern (clinivox) — https://github.com/VantaScript/clinivox/blob/main/integration/elevenlabs_tool_registration.py
- elevenlabs-python issue #529 (system tools do not dispatch HTTP) — https://github.com/elevenlabs/elevenlabs-python/issues/529
- Confirmed route inventory (no `/session-start`): `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts` — routes: `/tools/next_question`, `/tools/score_answer`, `/tools/take_note`, `/post-call`.
- Post-call HMAC verifier (30-min tolerance): `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts`.
- Tool shared-secret verifier (`x-voice-secret`, constant-time): `apps/backend/src/infrastructure/auth/elevenlabs-tool-secret-verifier.ts`.
- Tool `interview_id` injection via `dynamicVariable`: `apps/backend/scripts/live-validation/provision-agent.mjs` and `wire-webhooks.mjs`.
- Controller correlation on `interview_id`: `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` (`parseScoreAnswerPayload` / `parseTakeNotePayload` / `getInterviewIdFromPayload`).
- `StartInterviewFromWebhookUseCase` deleted: no longer present in `packages/application/src/use-cases/interview/`.
- SCHEDULED to IN_PROGRESS transition now in `StartCandidateSession`: `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:93-99`.
- Domain state machine closed set: `packages/domain/src/entities/interview/interview-status.ts:21-28`.
- `interview.start()` guard: `packages/domain/src/entities/interview/interview.entity.ts:134-141`.
- `interview.complete()` signature: `packages/domain/src/entities/interview/interview.entity.ts:144-155`.
- `appendNote`, `appendInternalScore` IN_PROGRESS guards: `packages/domain/src/entities/interview/interview.entity.ts` (approx. lines 161-197).
- ADR-013 D1 (tool surface): `docs/adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md`

## Enforcement

Declarative rules guard the mechanically expressible invariants. LLM judge covers the semantic invariants that cannot be expressed as regex.

```json
{
  "forbid_pattern": [
    {
      "pattern": "payload\\.tool_name|payload\\.toolName|body\\.tool_name|body\\.toolName",
      "path_glob": "apps/backend/src/presentation/controllers/**/*.ts",
      "message": "Tool dispatch by body field is forbidden (ADR-034). Per-tool URLs are the discriminator; no tool_name field exists in ElevenLabs server-tool webhook bodies."
    },
    {
      "pattern": "end_call",
      "path_glob": "apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts",
      "message": "end_call must not appear as a branch in the tool webhook controller (ADR-034). end_call is a system tool; its reason surfaces only in the post-call transcript walk in PersistCompletedTranscriptUseCase."
    },
    {
      "pattern": "ELEVENLABS_WEBHOOK_SECRET",
      "path_glob": "apps/backend/src/presentation/routes/webhooks/**/*.ts",
      "message": "Do not read ELEVENLABS_WEBHOOK_SECRET directly in route handlers. Use the shared lifecycle-webhook verifier (ADR-034)."
    },
    {
      "pattern": "ELEVENLABS_TOOL_WEBHOOK_SECRET",
      "path_glob": "apps/backend/src/presentation/routes/webhooks/**/*.ts",
      "message": "Do not read ELEVENLABS_TOOL_WEBHOOK_SECRET directly in route handlers. Use the shared tool-webhook verifier (ADR-034)."
    },
    {
      "pattern": "session-start|StartInterviewFromWebhook",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "The session-start webhook surface and StartInterviewFromWebhookUseCase were deleted in ADR-034. ElevenLabs emits no conversation-start webhook for browser SDK sessions. The SCHEDULED->IN_PROGRESS transition is owned by StartCandidateSession at signed-URL issuance (ADR-033). Do not re-introduce this surface."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

The LLM judge checks that (a) tool routes do not invoke `ElevenLabsWebhookVerifier` (HMAC applies only to `/post-call`), (b) `PersistCompletedTranscriptUseCase` walks `transcript[].tool_results[]` for `end_call_success` before calling `interview.complete()`, and (c) no new webhook route corresponding to a session-start surface is introduced without a superseding ADR that documents evidence of ElevenLabs adding a browser-SDK conversation-start webhook.
