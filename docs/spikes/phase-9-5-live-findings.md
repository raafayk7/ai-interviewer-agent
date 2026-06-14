# Phase 9.5 Live-Validation Spike — Follow-up Findings

> Spike date: 2026-05-27. Resolution via ElevenLabs documentation review + SDK source inspection + community implementation review. **Five parallel agents** executed; no live re-runs (key answers were available in published artifacts). **No source files modified.** The seed prompt that drove this work has been removed now that the findings are recorded.

## Context

The 2026-05-25 live-validation pass produced **1 PASS / 3 FAIL** plus six new findings. The follow-up spike was tasked with resolving the failures by experimenting against the live SDK and platform. Because the load-bearing answers turned out to be available in ElevenLabs's published documentation and SDK source, the live re-run was deferred — findings below are well-evidenced and the implementation pivot is unambiguous. One residual ambiguity is staged for a clarifying question to ElevenLabs (§"Open clarification").

---

## Priority 1 — `conversation_initiation_client_data_webhook` does not fire for browser SDK sessions

**Root cause.** The webhook is documented **exclusively for the Twilio-inbound-call channel**. There is no documented mechanism for it to fire when a conversation is started from a browser via `Conversation.startSession({ signedUrl })`. ElevenLabs's parallel mechanism for the browser channel is the WebSocket `conversation_initiation_client_data` client→server message — the `@elevenlabs/client` SDK sends it automatically when the caller passes `dynamicVariables` and `overrides` to `startSession`.

**Evidence.**
- The Personalization index lists only three methods: Dynamic Variables, Overrides, and "Twilio Integration: Personalize inbound call experiences via webhooks." ([source](https://elevenlabs.io/docs/eleven-agents/customization/personalization))
- The page that documents the webhook is titled *Twilio personalization* and opens with *"When receiving inbound Twilio calls…"*. Prerequisites are scoped to *"the Security tab of the agent's page, enable fetching conversation initiation data for **inbound Twilio calls**."* ([source](https://elevenlabs.io/docs/agents-platform/customization/personalization/twilio-personalization))
- The Agent WebSocket reference defines the client→server message `conversation_initiation_client_data` with payload shape `{ conversation_config_override, custom_llm_extra_body, dynamic_variables }` — exactly what the webhook would have returned. ([source](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket))
- No GitHub issue, community thread, or SDK example documents the webhook firing for a browser-channel session.

**Residual uncertainty.** ElevenLabs has not stated in writing "the webhook does not fire for browser sessions" — the conclusion is inferred from the consistent Twilio-only scoping. A clarifying question is staged (§"Open clarification") to lock it down.

**Implication for source.**
- Override assembly moves from a synchronous webhook handler to `StartCandidateSession` (server-side, at signed-URL issuance time, before the browser sees anything).
- The browser receives the override payload as part of the `POST /interviews/:id/candidate-session` response and passes it through `Conversation.startSession({ overrides, dynamicVariables })`.
- The override is still server-built. The browser is a sealed courier that forwards the payload to ElevenLabs and discards. The candidate cannot fabricate it; the candidate signed link (ADR-017) remains the only authentication channel.
- `elevenLabsSessionId` binding can move *earlier* — `getSignedUrl({ includeConversationId: true })` already returns the `conversation_id` server-side, so `StartCandidateSession` can bind it at issuance time. This removes the need for a separate `correlation_token` (the conversation_id is a trustworthy server-bound key).

**Implication for ADRs.**
- ADR-030 needs a **supersession**: "build override server-side at `StartCandidateSession`; browser passes it inline via `Conversation.startSession({ overrides, dynamicVariables })`." The static-agent + per-session-override model is preserved; the *transport* changes.
- ADR-031: drop the initiation webhook from the four surfaces — three webhook surfaces remain (session-start, tools, post-call), HMAC scoped per Priority 2 below.

---

## Priority 2 — Tool webhook discrimination + HMAC behavior

**Root cause.** `tool_name` does not appear anywhere in the request body, headers, or path of an ElevenLabs server-tool webhook call. The body is shaped only by the tool's `request_body_schema`; with the current empty schema, the body is `{}` — the observed symptom. The canonical dispatch pattern is **per-tool URLs**.

**Evidence.**
- `WebhookToolApiSchemaConfigInput` (SDK source) defines the request as `{ url, method, pathParamsSchema, queryParamsSchema, requestBodySchema, requestHeaders, contentType, authConnection }`. No envelope. ([source](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/types/WebhookToolApiSchemaConfigInput.ts))
- `tool_name`, `tool_call_id`, and `parameters` exist only in the **client-side** WebSocket `client_tool_call` envelope (browser SDK channel), never in the server-tool HTTP webhook. ([source](https://elevenlabs.io/docs/agents-platform/customization/tools/client-tools))
- Two community implementations confirm per-tool URLs: [`solmail-website`](https://github.com/sol-mail/solmail-website/blob/main/Zero/scripts/register-elevenlabs-tools.ts) (`/api/ai/do/${toolDef.name}`) and [`clinivox`](https://github.com/VantaScript/clinivox/blob/main/integration/elevenlabs_tool_registration.py) (`/api/tools/<slug>`).

**HMAC.** Server-tool webhooks are **not signed** by default. The `ElevenLabs-Signature: t=…,v0=…` header is documented only for the workspace post-call webhook. Security for server tools is implemented per-tool via `requestHeaders` (shared-secret bearer / `x-voice-secret`), an `authConnection` (OAuth2/Basic/Bearer), or IP allowlisting against ElevenLabs egress IPs.

**Implication for source.**
- `elevenlabs-webhook.controller.ts`: split `handleTool` into `handleNextQuestion` / `handleScoreAnswer` / `handleTakeNote`. Drop `parseToolPayload`'s `tool_name` requirement. Drop the `end_call` branch (see Priority 3).
- `elevenlabs-webhook.controller.test.ts`: rewrite the tools section with per-handler fixtures; drop the body-discriminator tests.
- `elevenlabs-webhooks.routes.ts`: add three per-tool POST registrations.
- Composition: instantiate a shared-secret-header verifier for tool routes; keep `ElevenLabsWebhookVerifier` (HMAC) for the post-call route only.
- `provision-agent.mjs`: per-tool URLs + a real `request_body_schema` per tool (so `score_answer({ score, rationale })` actually fills the body) + `requestHeaders: { "x-voice-secret": "<env>" }` per tool.
- New env var `ELEVENLABS_TOOL_WEBHOOK_SECRET` replaces the deleted `ELEVENLABS_SESSION_TOKEN_SECRET`.

**Implication for ADRs.**
- ADR-031: narrow the "all webhooks HMAC-verified" claim to the post-call webhook only. Document the per-tool shared-secret pattern.

---

## Priority 3 — `end_call` does not dispatch externally

**Root cause.** `end_call` is `type: "system"` per the SDK. ElevenLabs's docs state: *"system tools don't make external API calls or trigger client-side functions — they modify the internal state of the conversation without making external calls."* The browser SDK observes `tool_name === "end_call"` in an `agent_tool_response` event and calls `endSessionWithDetails()` to close the WebSocket. The end reason lives in the post-call transcript at `data.transcript[<final turn>].tool_results[]` with `result_type === "end_call_success"` (`{ status, reason, message }`).

**Evidence.**
- `SystemToolConfigInput` has no URL field. ([source](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/types/SystemToolConfigInput.ts))
- "System tools" docs page explicitly states the no-external-call behavior. ([source](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools))
- `@elevenlabs/client` `BaseConversation.ts` (L355-360) calls `endSessionWithDetails({ reason: "agent", context: { type: "end_call", reason: "Agent ended the call" } })` on `tool_name === "end_call"`.
- `ConversationHistoryTranscriptSystemToolResultCommonModelInput` defines `EndCallSuccess` with `{ status, reason, message }`.
- Confirmed by [elevenlabs-python issue #529](https://github.com/elevenlabs/elevenlabs-python/issues/529).

**Implication for source.**
- Delete `EndInterviewFromAgentUseCase` + test.
- Delete the `end_call` branch in `dispatchTool` (controller).
- `PersistCompletedTranscriptUseCase` walks `transcript[].tool_results[]` for `end_call_success`, extracts `reason` / `message`, and persists them as an `AgentNote` before calling `interview.complete()`.

**Implication for ADRs.**
- ADR-013: `end_interview` wording updates — the agent's `end_call` invocation closes the WebSocket; the reason is observable only in the post-call transcript.
- ADR-031: drop `end_call` from the tools-webhook section.

---

## Priority 4 — Post-call webhook payload + HMAC

**Payload shape (`type: "post_call_transcription"`).** snake_case throughout.

```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1739537297,
  "data": {
    "agent_id": "...",
    "conversation_id": "...",
    "status": "done",
    "transcript": [
      {
        "role": "agent",
        "message": "...",
        "tool_calls": null,
        "tool_results": null,
        "time_in_call_secs": 0
      }
    ],
    "metadata": {
      "start_time_unix_secs": 1739537297,
      "call_duration_secs": 22,
      "termination_reason": ""
    },
    "analysis": { "call_successful": "success", "transcript_summary": "..." },
    "conversation_initiation_client_data": { "...": "..." }
  }
}
```

Termination is signaled by `data.status: "done"` (or `"failed"`). `data.metadata.termination_reason` is free-form, often empty on normal hangups. There is **no top-level `ended_by` / `end_reason`** — the per-turn `tool_results[].result_type === "end_call_success"` is where the agent's end reason surfaces. No documented `ended_at`; compute as `start_time_unix_secs + call_duration_secs`.

`call_initiation_failure` is the other documented event type (failed SIP setup, busy, no-answer). There is no separate end-of-call event; `post_call_transcription` *is* the end-of-call signal. ([source](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks))

**HMAC.** `ElevenLabs-Signature: t=<unix_seconds>,v0=<hex_sha256>`. Signed string is `` `${timestamp}.${rawBody}` ``. Tolerance window is **30 minutes**, not 5. ([SDK source](https://github.com/elevenlabs/elevenlabs-js/blob/main/src/wrapper/webhooks.ts) — `constructEvent`)

**Verifier status.** `ElevenLabsWebhookVerifier` is correct in algorithm. Verify the tolerance is 30 minutes (not 5), header lookup is case-insensitive (Node already lowercases), and the **raw body bytes** are signed — not Fastify's re-stringified JSON. The existing scoped `addContentTypeParser` in the routes plugin captures `req.rawBody` for exactly this reason; preserve it.

**Implication for source.**
- Post-call handler reads `body.data.conversation_id`, `body.data.transcript`, `body.data.metadata.termination_reason`.
- `PersistCompletedTranscriptUseCase` walks `transcript[]` with documented field names; persists `started_at = metadata.start_time_unix_secs`, `ended_at = start + call_duration_secs`.
- Verifier: bump tolerance to 30 min if currently shorter.

**Implication for ADRs.**
- ADR-031: pin the documented payload field names and the 30-minute tolerance.

---

## Secondary finding — `Interview.fromSerialized` throws

Recorded for triage outside Phase 9.5: domain `fromSerialized` paths can throw (observed: `TypeError: data.education is not iterable` from a malformed seed row), bypassing the controller's `Result`-based error mapping and returning a Fastify 500. Fix is to wrap `fromSerialized` calls in `Result.tryCatch` at the repository boundary. Not a Phase 9.5 deliverable; file under backend hardening.

---

## Open clarification (low-priority confirmation)

The Priority 1 conclusion is well-evidenced but unconfirmed by ElevenLabs directly. A clarifying question is staged for ElevenLabs Discord / help center / GitHub:

> **Does `conversation_initiation_client_data_webhook` fire for browser SDK sessions started via `getSignedUrl` + `Conversation.startSession()`, or is it inbound-Twilio only?**
> If browser is supported, what is the required configuration (workspace flag, per-agent flag, response format)?

A *"Twilio-only"* answer confirms the supersession path below. A *"browser is supported with config X"* answer is a 1-hour pivot back to the original ADR-030 design (set X, keep the initiation controller, re-run live validation). The implementation work below is safe to start in parallel — the "browser passes overrides through `startSession`" pattern is a valid working design either way.

---

## Concrete file change list

### Delete

- `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts` + `.test.ts`
- `apps/backend/src/presentation/routes/webhooks/elevenlabs-initiation-webhook.routes.ts` (or equivalent)
- `apps/backend/src/composition/elevenlabs-initiation-webhook.composition.ts`
- `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts` + test
- `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts` + test
- `packages/application/src/use-cases/interview/end-interview-from-agent.use-case.ts` + test
- `packages/application/src/ports/conversation-correlation-token/`

### Modify

- `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` — bind `elevenLabsSessionId` from `getSignedUrl({ includeConversationId: true })`; assemble override payload; extend output to include `overrides` and `dynamicVariables`
- `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` — read end reason from `transcript[].tool_results[]`
- `apps/backend/src/presentation/controllers/candidate-session.controller.ts` — return the override payload in the response body
- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` — split per-tool handlers; drop `end_call` branch; drop `tool_name` parsing
- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.test.ts` — rewrite tools section
- `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts` — three per-tool POST routes
- `apps/backend/src/composition/elevenlabs-webhook.composition.ts` — per-route verifier (shared-secret-header for tools; HMAC for post-call only)
- `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` — confirm 30-min tolerance
- `apps/backend/scripts/live-validation/provision-agent.mjs` — per-tool URLs + `request_body_schema` per tool + `requestHeaders: { "x-voice-secret" }`
- `apps/backend/scripts/live-validation/wire-webhooks.mjs` — drop initiation wiring; per-tool URL map
- `apps/backend/scripts/live-validation/cleanup.mjs` — drop initiation baseline reset (or keep idempotently)
- `apps/backend/scripts/live-validation/harness.html` — pass `overrides` to `Conversation.startSession`
- `apps/backend/src/app.ts` — drop initiation route registration

### ADR changes

- **ADR-030** — author a supersession ADR (next number) that captures the new transport. Old ADR-030 Status flips to `Superseded by ADR-NNN, YYYY-MM-DD` (the only edit permitted on an Accepted-or-Proposed ADR's body once superseded). Note: 030 is still `Proposed`, so technically the supersession discipline is laxer, but follow the supersession idiom for cleanliness.
- **ADR-031** — amend: drop the initiation-webhook surface; narrow HMAC to post-call; document per-tool URL + shared-secret-header pattern; pin 30-min tolerance and post-call field names.
- **ADR-013** — clarifying note that `end_interview` = `end_call` system tool, observable only in the post-call transcript.
- **ADR-032** — drop D5 (`interview.webhook.initiation`) from the span list; tighten D4 (`interview.session.transcript-persist`) to stamp the extracted end-reason.

### New environment variable

- `ELEVENLABS_TOOL_WEBHOOK_SECRET` — shared secret carried in each custom tool's `requestHeaders` as `x-voice-secret`. Replaces `ELEVENLABS_SESSION_TOKEN_SECRET` from the deleted correlation-token mechanism.

---

## Addendum — 2026-05-29 live re-run: PASS

The 2026-05-27 findings were implemented and then validated against the live ElevenLabs platform (the deferred live re-run). Outcome: **PASS** — supersedes the 2026-05-25 gate (1 PASS / 3 FAIL). A full browser voice conversation confirmed override delivery, per-tool `x-voice-secret` auth, `interview_id` correlation, post-call HMAC verification, transcript persistence, and the SCHEDULED→IN_PROGRESS→COMPLETED lifecycle.

Three issues surfaced during implementation/live testing beyond the four 2026-05-27 priorities, now fixed:

1. **No browser session-start webhook exists.** Priority 1 correctly killed the synchronous initiation webhook, but the residual assumption that a fire-and-forget `session.started` webhook fires for browser sessions was also wrong — ElevenLabs sends none. The SCHEDULED→IN_PROGRESS transition moved into `StartCandidateSession` at signed-URL issuance. (ADR-034 amended; `/session-start` route + `StartInterviewFromWebhookUseCase` deleted.)
2. **Tool correlation requires `dynamicVariable` injection.** The §"Open clarification" question on per-tool body correlation is resolved: `interview_id` must be declared in each tool's `request_body_schema` as `{ type: "string", dynamicVariable: "interview_id" }` (SDK `LiteralJsonSchemaProperty`) so ElevenLabs injects the session variable into the body. Confirmed accepted by the API and present in the live `take_note` payload.
3. **`requestHeaders` is an object map, not an array.** The per-tool `x-voice-secret` header must be `{ "x-voice-secret": … }`, not `[{ name, value }]` (live 422 → fixed in both provisioning scripts).

Also confirmed: `getSignedUrl({ includeConversationId: true })` returns `{ signedUrl }` only (no typed `conversation_id`); the id surfaces via the signed-URL query param / untyped passthrough and is extracted defensively — validated live (a real `conv_…` bound at issuance).

Re-setup runbook: `docs/runbooks/elevenlabs-live-validation.md`.
