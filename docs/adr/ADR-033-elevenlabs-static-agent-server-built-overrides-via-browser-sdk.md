# ADR-033 ElevenLabs Conversational AI Static Agent: Server-Built Overrides Delivered Inline via Browser SDK

## Status

Accepted. Date: 2026-05-29.

Supersedes ADR-030 (Static ElevenLabs Agent with Per-Session Overrides via Conversation-Initiation Webhook).

Note: this is a Proposed-stage revision of the initial ADR-033 draft (2026-05-27). The corrections here address two factual errors discovered during Phase 9.5 implementation: (1) the SDK type for `getSignedUrl` does not include `conversationId` in its typed response; and (2) `StartCandidateSession` now owns the SCHEDULED to IN_PROGRESS transition at signed-URL issuance, because ElevenLabs emits no conversation-start webhook for browser SDK sessions. See ADR-034 for the webhook lifecycle side of the same correction.

## Context

Phase 9.5 adopts ElevenLabs Conversational AI as the primary voice pipeline (ADR-029) and provisions one static agent reused across all interview sessions (ADR-030). ADR-030 specified that per-session specialization — injecting the JD summary, CV summary, InterviewPlan, and client instructions into the agent's system prompt — would be delivered via the ElevenLabs **conversation-initiation webhook** (`enableConversationInitiationClientDataFromWebhook = true`). The mechanism depended on ElevenLabs calling the backend server-to-server at the moment a conversation starts; the backend would verify a short-lived HMAC correlation token, assemble the override, and return it to ElevenLabs before the first agent word.

Live validation during Phase 9.5 found that the webhook was never called across multiple browser sessions — with full workspace-level flag, per-agent flag, and enable-flag configuration in place. Follow-up spike work (documented in `docs/spikes/phase-9-5-live-findings.md`, Priority 1) identified the root cause: **the conversation-initiation webhook is documented exclusively for the Twilio inbound-call channel**. It is not a general browser-SDK mechanism. Four independent evidence sources confirm this:

1. The ElevenLabs Personalization index lists only three personalization methods: Dynamic Variables, Overrides, and "Twilio Integration: Personalize inbound call experiences via webhooks." Dynamic Variables and Overrides are the browser-channel methods. (Source: https://elevenlabs.io/docs/eleven-agents/customization/personalization)
2. The page that documents the webhook is titled "Twilio personalization" and opens with: "When receiving inbound Twilio calls, you can dynamically fetch conversation initiation data through a webhook." The prerequisites are explicitly scoped to inbound Twilio calls. (Source: https://elevenlabs.io/docs/agents-platform/customization/personalization/twilio-personalization)
3. The ElevenLabs Agent WebSocket reference defines a client-to-server message named `conversation_initiation_client_data` with payload shape `{ conversation_config_override, custom_llm_extra_body, dynamic_variables }` — exactly the override shape the webhook would have returned. This is the browser channel's parallel mechanism. (Source: https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket)
4. No GitHub issue, community thread, or SDK example documents the webhook firing for a browser-channel session.

The `@elevenlabs/client` SDK sends the `conversation_initiation_client_data` WebSocket message automatically when the caller passes `overrides` and/or `dynamicVariables` to `Conversation.startSession()`. This is the correct, documented, browser-side delivery mechanism — it was the mechanism that should have been used in ADR-030 had the Twilio-only scoping been identified at authoring time.

The override security concern from ADR-030 Alternative B remains. The override must be server-built and server-controlled — placing JD content, CV summaries, or scoring criteria in browser-side code would expose them to the candidate. The resolution is to keep assembly server-side (inside `StartCandidateSession`) and have the browser act as a sealed courier: it receives the complete, pre-assembled override payload from the server response and passes it through verbatim to `Conversation.startSession()`. The candidate cannot meaningfully modify the payload because the ElevenLabs static agent's override allow-list (server-controlled configuration) silently drops any field not in the list.

The `getSignedUrl({ agentId, includeConversationId: true })` call is invoked with the `includeConversationId` flag set. The SDK type for the response is `ConversationSignedUrlResponseModel` (pinned at `@elevenlabs/elevenlabs-js@2.49.1`), which is typed as `{ signedUrl: string }` only (`node_modules/.pnpm/@elevenlabs+elevenlabs-js@2.49.1/node_modules/@elevenlabs/elevenlabs-js/api/types/ConversationSignedUrlResponseModel.d.ts`). With `includeConversationId: true`, ElevenLabs may surface the conversation id as a query parameter on the signed URL, or as an untyped passthrough field in the wire response under either `conversation_id` or `conversationId`. The adapter (`apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts`, `extractConversationIdFromUrl` plus the snake/camel passthrough checks in `issueSignedUrl`) extracts the value defensively from all three locations. This means `StartCandidateSession` can bind `interview.elevenLabsSessionId` at issuance time, removing the need for any separate correlation mechanism.

Because ElevenLabs emits no conversation-start webhook for browser SDK sessions (the Priority 1 finding also eliminates any `session.started` webhook), the SCHEDULED to IN_PROGRESS transition must occur at the only server-side moment the backend controls in the browser flow: signed-URL issuance inside `StartCandidateSession`. This is a lifecycle change relative to the first ADR-033 draft. The transition is reconnect-tolerant: the use case accepts status SCHEDULED or IN_PROGRESS and performs the `interview.start()` call only from SCHEDULED.

The correlation token and its issuer/verifier infrastructure from ADR-030 are no longer needed. This ADR preserves the core ADR-030 decision (one static agent, per-session overrides). It corrects the override transport (from the Twilio-only conversation-initiation webhook to the browser SDK's `startSession` inline delivery) and now also owns the session-start lifecycle transition.

## Decision

Provision one static ElevenLabs Conversational AI agent at deploy time (unchanged from ADR-030). Specialize each interview session via **server-built per-session overrides assembled inside `StartCandidateSession` at signed-URL issuance time** and **delivered to the agent through the browser SDK's inline `Conversation.startSession({ overrides, dynamicVariables })` call**, which the SDK transmits to ElevenLabs as the WebSocket `conversation_initiation_client_data` message at conversation start.

The concrete mechanics are:

- `StartCandidateSession` validates the interview is in `SCHEDULED` or `IN_PROGRESS` status (reconnect-tolerant) and has a plan present. It calls `getSignedUrl({ agentId, includeConversationId: true })`. The SDK response is typed as `{ signedUrl: string }` only; the conversation id is extracted defensively by the adapter from the signed-URL query param (`extractConversationIdFromUrl`) and/or an untyped passthrough field (`conversation_id` / `conversationId`). After binding `interview.elevenLabsSessionId = conversationId`, the use case checks whether the interview is still SCHEDULED. If so, it calls `interview.start(new Date())` to perform the SCHEDULED to IN_PROGRESS transition. This is the only server-side moment in the browser SDK flow when the backend can perform this transition, because ElevenLabs emits no conversation-start webhook for browser sessions (cross-reference ADR-034). The use case saves the interview only if the instance changed (i.e. skips the save on reconnect when already IN_PROGRESS). It then assembles the override payload: `{ systemPrompt, dynamicVariables: { interview_id, candidate_name, job_title, target_duration_minutes, ... } }` from the interview's JD summary, CV summary, InterviewPlan, and client instructions. It returns `{ signedUrl, overrides, dynamicVariables }` to the presentation layer. Implementation: `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:59-131`.

- The `POST /interviews/:id/candidate-session?token=…` response carries the override payload alongside the signed URL. The token is the candidate HMAC-signed link (ADR-017), which remains the only authentication channel; no second token (correlation token) is needed.

- The browser's `InterviewSessionContainer` passes the payload through verbatim: `await Conversation.startSession({ signedUrl, overrides, dynamicVariables })`. The SDK transmits these inline via the WebSocket `conversation_initiation_client_data` message. No client-side logic constructs or modifies any override field.

- The static agent retains the override allow-list configuration (`agent.prompt.prompt: true`, `agent.first_message: true`) so the inline override takes effect. This configuration is unchanged from ADR-030.

- The `enableConversationInitiationClientDataFromWebhook` agent flag is dropped; it is the Twilio-only configuration and is not needed on the browser path.

- The conversation-initiation webhook controller, routes, and composition are deleted from the codebase. The correlation-token issuer (`conversation-correlation-token.ts`), its port (`packages/application/src/ports/conversation-correlation-token/`), and the `ELEVENLABS_SESSION_TOKEN_SECRET` environment variable are deleted.

This decision owns: the override assembly and delivery channel, the `elevenLabsSessionId` binding at issuance, and the SCHEDULED to IN_PROGRESS lifecycle transition at signed-URL issuance. It explicitly does not own: the tool webhook handling, the post-call webhook, the session-end (IN_PROGRESS to COMPLETED) lifecycle, or the frontend voice pipeline beyond the `startSession` call signature. Those concerns are covered in ADR-034.

The static-agent boot-time assertion (`apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts`) continues to verify the allow-list flags at startup. If the flags are absent, the process fails fast rather than silently dropping every override at runtime.

## Alternatives Considered

### Alternative A: Conversation-initiation webhook (the mechanism specified in ADR-030)

Configure the static agent with `enableConversationInitiationClientDataFromWebhook = true`. ElevenLabs calls the backend server-to-server at conversation start; the backend assembles and returns the override payload.

Rejected because this mechanism is documented exclusively for the Twilio inbound-call channel. The Personalization index does not list it as a browser-SDK method. The Twilio personalization page opens with "When receiving inbound Twilio calls…" and scopes all prerequisites to inbound Twilio. Live evidence: the webhook URL was never called across multiple Phase 9.5 browser sessions with the full workspace flag, per-agent flag, and enable-flag configuration active. The correct browser-channel mechanism is the WebSocket `conversation_initiation_client_data` client-to-server message, delivered automatically by the `@elevenlabs/client` SDK when `overrides`/`dynamicVariables` are passed to `startSession`.

### Alternative B: Browser-side hard-coded overrides (browser builds the payload)

Keep override delivery via `Conversation.startSession`, but construct the override in browser code rather than receiving it from the server response.

Rejected on security grounds, identical to ADR-030 Alternative B. The override contains the JD summary, CV summary, InterviewPlan, and client instructions. A candidate can inspect any browser-resident payload (devtools, network proxy, source inspection) before or during the interview. Placing scoring criteria, internal recruiter notes, or the evaluation rubric in client-controlled code is a confidentiality violation. The browser must receive a pre-assembled payload from the server and forward it without modification. Server-side assembly is preserved; only the delivery channel changes relative to ADR-030.

### Alternative C: First-step `get_interview_context` server tool

Omit the initiation override. Define a `get_interview_context` server tool that the agent calls as its first action to fetch context from the backend.

Rejected for the same reasons as ADR-030 Alternative C. The agent is unspecialized at greeting time: without a pre-loaded system prompt and first message, the opening greeting cannot reference the role or the candidate's name. The first agent turn is wasted fetching context the agent should already have. The `conversation_initiation_client_data` inline mechanism is the ElevenLabs-intended path for pre-session context; a context-fetch tool fights the platform and adds an observable round-trip latency to the first agent word that the inline override avoids.

### Alternative D: One ElevenLabs agent per interview

Create a fully custom agent via `POST /v1/convai/agents` at the start of each `StartCandidateSession`, delete it after session end.

Rejected for the same four reasons as ADR-030 Alternative E: agent lifecycle complexity, orphan-agent risk on process crash between create and delete, creation latency on the critical session-start path, and API write-rate exposure on burst session starts. The static agent plus inline overrides delivers identical per-session specialization with none of these costs.

## Consequences

**Benefits**

- One agent configuration to manage, version, and test. Changes to voice, guardrails, or base prompt structure are a single agent-config deploy. Unchanged from ADR-030.
- Interview content (JD summary, CV summary, InterviewPlan, client instructions) is assembled server-side at issuance time and is never derived from or modifiable by candidate input.
- No synchronous webhook on the critical path of conversation start. The override is already resident in the browser by the time `startSession` is called; conversation-start latency is bounded only by the `getSignedUrl` round-trip, measured at P50 approximately 800 ms in Phase 9.5 live testing. ADR-030's initiation webhook added a second server-to-server round-trip on the same critical path.
- `elevenLabsSessionId` is bound at issuance time. The adapter extracts the conversation id defensively from the signed URL query param or untyped passthrough field. The SCHEDULED to IN_PROGRESS transition is performed at the same moment. After a successful `StartCandidateSession` call the interview is IN_PROGRESS with a bound `elevenLabsSessionId`, providing a trustworthy server-side session identifier before the browser connects.
- Three fewer source files: initiation webhook controller, initiation webhook composition root, and correlation-token issuer. One fewer port directory (`conversation-correlation-token/`). One fewer environment variable (`ELEVENLABS_SESSION_TOKEN_SECRET`). Reduced deployment configuration surface.

**Trade-offs**

- The override payload is briefly visible in the browser's memory between the `POST /interviews/:id/candidate-session` response and the `startSession` call. The candidate can read the override in devtools if they act within that window. The override targets the agent's system prompt and dynamic variables, neither of which is echoed back to the candidate during the interview. A determined attacker who reads the system prompt before the call begins could infer the evaluation criteria; they could also infer much of that content from the agent's behavior during the session. The threat model trade is accepted for Phase 9.5.
- Override payload size is bounded by ElevenLabs's WebSocket message size limits. The system-prompt assembler must enforce a character budget, as noted in ADR-030. This constraint is unchanged.
- All concurrent sessions share one agent's tool config, voice, and guardrails. Per-interview variation in these dimensions is not possible without revisiting this ADR. Unchanged from ADR-030.

**Risks and mitigations**

- *Risk*: A developer constructs override fields in browser code rather than forwarding the server-provided payload. The browser-side security boundary is violated. *Mitigation*: the Enforcement block below provides a declarative guard on `apps/web/src/**/*.ts` for direct override construction patterns.
- *Risk*: The override allow-list on the static agent is misconfigured, causing the inline override to be silently dropped by ElevenLabs — the trap encountered in Phase 9.5 spike rounds 1 and 2. *Mitigation*: the existing `agent-config-assertion.ts` boot-time guard verifies the allow-list flags (`agent.prompt.prompt: true`, `agent.first_message: true`) at process startup. A misconfigured agent fails the process before serving any request. This guard is preserved unchanged.
- *Risk*: A developer adds a `agents.create` call for a new session-start path, bypassing the static-agent contract. *Mitigation*: the declarative `forbid_pattern` below catches this at commit time.
- *Risk*: A developer retains or re-introduces the `enableConversationInitiationClientDataFromWebhook` flag or a new initiation webhook route, creating a dead code path that implies the Twilio mechanism is active. *Mitigation*: the `forbid_pattern` below guards against the flag string appearing in backend source.
- *Risk*: The SDK's `getSignedUrl` response shape changes in a future version, causing the conversation id extraction to fail silently. The adapter currently checks three locations: URL query param, `conversation_id` passthrough, and `conversationId` passthrough. If all three are absent, the adapter throws and `StartCandidateSession` returns a `ServiceError`. *Mitigation*: The adapter must be re-verified on any `@elevenlabs/elevenlabs-js` SDK upgrade by checking whether `ConversationSignedUrlResponseModel` gains a typed `conversationId` field (which would simplify extraction) or changes the query-param name. The live-validation harness confirms this path end-to-end on each provisioning run.

## Related Decisions

- **ADR-029 (Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline)**: still in effect. This ADR is a provisioning detail within the ADR-029 adoption. ADR-029 is not affected by this supersession.
- **ADR-030 (Static ElevenLabs Agent with Per-Session Overrides via Conversation-Initiation Webhook)**: superseded by this ADR. The static-agent provisioning decision carries forward unchanged. Only the override-delivery mechanism changes: from the Twilio-only conversation-initiation webhook to the browser SDK's inline `startSession` parameters.
- **ADR-034 (ElevenLabs Webhook Lifecycle: Two Inbound Webhook Surfaces, Per-Tool URLs, Scoped HMAC)**: pairs with this ADR to complete the Phase 9.5 corrected backend mechanics. ADR-034 supersedes ADR-031 by dropping the initiation webhook from the webhook surface (no `session.started` webhook exists on the browser SDK path), correcting per-tool URL dispatch, scoping HMAC to post-call only, and confirming `end_call` is handled in the post-call transcript walk. The SCHEDULED to IN_PROGRESS transition that ADR-034's first draft attributed to a `session.started` webhook is now owned by this ADR (StartCandidateSession at issuance).
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: the candidate HMAC signed link is the only authentication channel for `POST /interviews/:id/candidate-session`. This ADR removes the second token (correlation token) from ADR-030; ADR-017's single-token model is now fully consistent with the implementation.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: the four-tool surface (`next_question`, `score_answer`, `take_note`, `end_interview`) is unchanged. The `end_interview` intent is realized in the ElevenLabs path as the platform's built-in `end_call` system tool; the end reason is observable only in the post-call transcript per ADR-034 (not as a webhook dispatch).

## References

- `docs/spikes/phase-9-5-live-findings.md` — Priority 1 section: root cause analysis, four evidence sources, and the implementation implication that drives this ADR.
- ElevenLabs Personalization index (three methods, Twilio-only webhook): https://elevenlabs.io/docs/eleven-agents/customization/personalization
- ElevenLabs Twilio personalization page (the sole page documenting the initiation webhook, scoped to inbound Twilio calls): https://elevenlabs.io/docs/agents-platform/customization/personalization/twilio-personalization
- ElevenLabs Agent WebSocket reference (`conversation_initiation_client_data` client-to-server message, payload shape): https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
- SDK type: `ConversationSignedUrlResponseModel` is `{ signedUrl: string }` only, confirmed at `node_modules/.pnpm/@elevenlabs+elevenlabs-js@2.49.1/node_modules/@elevenlabs/elevenlabs-js/api/types/ConversationSignedUrlResponseModel.d.ts`. The conversation id surfaces as a query param on the signed URL and/or as an untyped passthrough field; it is not typed in the SDK response model.
- Defensive extraction: `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts` — `extractConversationIdFromUrl` (URL query param) plus the `conversation_id` / `conversationId` passthrough checks in `issueSignedUrl`.
- SCHEDULED to IN_PROGRESS transition: `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts:59-131` — guard accepts SCHEDULED or IN_PROGRESS; after `bindElevenLabsSession(conversationId)`, transitions from SCHEDULED via `interview.start(new Date())`; saves only when the instance changed.
- Domain state machine closed set (SCHEDULED to IN_PROGRESS only via `start()`): `packages/domain/src/entities/interview/interview-status.ts:21-28`.
- `interview.start()` guard: `packages/domain/src/entities/interview/interview.entity.ts:134-141`.
- `bindElevenLabsSession` (accepts SCHEDULED or IN_PROGRESS, no status change): `packages/domain/src/entities/interview/interview.entity.ts:178-197`.
- `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts` — boot-time guard that verifies the override allow-list flags (`agent.prompt.prompt: true`, `agent.first_message: true`); preserved unchanged by this ADR.
- ADR-030 Alternative B rejection rationale — security argument for server-side assembly; reused verbatim.

## Enforcement

The core rules are:

1. No `agents.create` or `agents.delete` call per interview (static agent only, carried forward from ADR-030).
2. No construction of override fields in browser code (the override must come from the server response, not be assembled client-side).
3. The `enableConversationInitiationClientDataFromWebhook` flag must not appear in backend source (it is the deleted Twilio-only mechanism).
4. The deleted correlation-token port/issuer must not be re-introduced.
5. Interview content (JD, CV, plan, client instructions) must be assembled inside `StartCandidateSession`, not in any browser path or other use case. This is a semantic rule and is covered by `llm_judge: true`.

```json
{
  "forbid_pattern": [
    {
      "pattern": "\\.agents\\.create\\s*\\(",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Per-interview agent creation is forbidden (ADR-033). Reuse ELEVENLABS_AGENT_ID and deliver per-session overrides via startSession inline parameters."
    },
    {
      "pattern": "\\.agents\\.delete\\s*\\(",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Per-interview agent deletion is forbidden (ADR-033). The static agent is never deleted at session end."
    },
    {
      "pattern": "enableConversationInitiationClientDataFromWebhook",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "This flag activates the Twilio-only initiation webhook, which does not fire for browser SDK sessions (ADR-033). Use startSession inline overrides instead."
    },
    {
      "pattern": "conversation-correlation-token|conversationCorrelationToken",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "The correlation-token mechanism was deleted in ADR-033. elevenLabsSessionId is bound at getSignedUrl issuance time; no second token is needed."
    },
    {
      "pattern": "conversation_config_override|conversationConfigOverride|dynamicVariables",
      "path_glob": "apps/web/src/**/*.ts",
      "message": "Override fields must not be constructed in browser code (ADR-033). The browser forwards the server-provided payload verbatim to Conversation.startSession."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

`llm_judge: true` is set because the deepest compliance requirement — that JD summary, CV summary, InterviewPlan, and client instructions are assembled inside `StartCandidateSession` and not in any browser path or secondary use case — requires semantic evaluation of the assembly site, not line-pattern matching. The declarative rules catch explicit API call names and browser-side construction patterns; the LLM judge catches intent violations that bypass those surface signals.
