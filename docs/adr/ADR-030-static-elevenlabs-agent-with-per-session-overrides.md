# ADR-030 Static ElevenLabs Agent with Per-Session Overrides via Conversation-Initiation Webhook

## Status

Superseded by ADR-033, 2026-05-27.

Revised 2026-05-20 after verifying the @elevenlabs/elevenlabs-js@2.49.1 SDK contract. The original draft assumed per-session overrides could be passed at signed-URL issuance time; SDK verification proved that path does not exist. The Decision, Alternatives, and Enforcement sections have been rewritten accordingly.

## Context

Phase 9.5 replaces the Deepgram + Gemini + ElevenLabs sandwich pipeline (ADR-002) with an ElevenLabs Conversational AI agent. Each interview requires a unique system prompt — containing the Job Description (JD) summary, CV summary, InterviewPlan, and any client-specific instructions — but every interview uses the identical tool set, voice, turn-detection settings, and guardrails. These four tools (`next_question`, `score_answer`, `take_note`, `end_interview`) are defined in ADR-013 and remain unchanged.

ElevenLabs Conversational AI supports two provisioning strategies:

1. Create a new agent object per interview via the Agents API (`POST /v1/convai/agents`), tailoring its config to that interview.
2. Provision one static agent at deploy time with the tool set, voice, and base prompt structure fixed, then specialize each session via a per-session mechanism at conversation start.

The choice between these two strategies directly shapes the signature of the new application-layer port `IConversationalAgentService`. This decision must be recorded before the `StartCandidateSession` use case can be designed.

**SDK contract verification (blocking finding).** The installed `@elevenlabs/elevenlabs-js@2.49.1` SDK was inspected during Phase 9.5 implementation. `ConversationsGetSignedUrlRequest` (file: `api/resources/conversationalAi/resources/conversations/client/requests/ConversationsGetSignedUrlRequest.d.ts`) accepts only `{ agentId, includeConversationId?, branchId?, environment? }` and returns `{ signedUrl }` via `ConversationSignedUrlResponseModel`. It carries no prompt overrides and no dynamic variables. Passing JD, CV, or InterviewPlan data at signed-URL issuance time is not possible through the SDK; the parameters simply do not exist on that call.

The browser-side SDK does accept `conversationConfigOverride` and `dynamicVariables` inside a `ConversationInitiationData` object when starting a conversation from the browser. However, placing JD, CV, or InterviewPlan content there would transmit sensitive interview data to the candidate's browser, which is a security violation — the candidate browser must not receive proprietary JD content, internal CV summaries, or interview scoring criteria.

The ElevenLabs platform's intended secure path for server-side override injection is the **conversation-initiation webhook**. An agent configured with `ConversationInitiationClientDataConfigInput.enableConversationInitiationClientDataFromWebhook = true` causes ElevenLabs to call the owner's backend (server-to-server) at the moment a conversation starts. The backend returns `ConversationInitiationClientDataRequestOutput`, which carries `conversationConfigOverride.agent` (the per-session system prompt) and `dynamicVariables`. Sensitive content never leaves the server.

The correlation problem: the initiation webhook call arrives from ElevenLabs without any request body that identifies which interview is starting. A correlation mechanism is needed so the webhook handler can load the correct `Interview` aggregate and assemble the right system prompt. This ADR adopts a short-lived, opaque, HMAC-signed correlation token bound to the `interviewId` (mirroring the HMAC idiom from ADR-017) that the browser passes as a dynamic variable when initiating the conversation.

The analysis follows from the Phase 9 post-mortem captured in `docs/progress/phase-9.md` (Phase 9.5 section, lines 144-183), which identified the ElevenLabs migration as necessary due to fundamental limitations of the stitched sandwich: no native turn detection, no role enforcement outside the LLM, and Gemini hallucinating candidate responses on silent turns.

## Decision

Provision a single, statically-configured ElevenLabs Conversational AI agent — with its voice, tool set, guardrails, and base prompt structure fixed at deploy time — and specialize each interview session via the **conversation-initiation webhook** rather than at signed-URL issuance time.

The agent is configured with `enableConversationInitiationClientDataFromWebhook = true`. When a conversation starts, ElevenLabs calls the backend's initiation webhook endpoint server-to-server. The handler verifies an HMAC-signed correlation token, loads the `Interview` aggregate, assembles `conversationConfigOverride.agent.prompt` (JD summary, CV summary, InterviewPlan topics, client instructions), and returns `ConversationInitiationClientDataRequestOutput` to ElevenLabs. Sensitive interview content is never placed in the signed-URL request or in any browser-delivered payload.

`StartCandidateSession` returns `{ signedUrl, sessionToken }`. The `signedUrl` is issued by calling `conversationalAi.conversations.getSignedUrl({ agentId })` — no override fields exist on this call (SDK-verified). The `sessionToken` is a short-lived HMAC-signed opaque token bound to the `interviewId`, generated using the same `node:crypto` HMAC-SHA256 idiom as ADR-017 with a dedicated secret `ELEVENLABS_SESSION_TOKEN_SECRET`. The browser passes `sessionToken` as a dynamic variable (e.g., `correlation_token`) when initiating the conversation; this is the only non-sensitive data the browser contributes to the agent's context.

The agent configuration (agent ID, voice ID `EXAVITQu4vr4xnSDxMaL`, model, tool schemas, guardrail settings) is owned by the infrastructure team and versioned through ElevenLabs' own agent versioning mechanism. The agent ID is exposed to the application layer as the environment variable `ELEVENLABS_AGENT_ID`. The `StartCandidateSession` use case reads `ELEVENLABS_AGENT_ID` from the infrastructure configuration and passes it to the `IConversationalAgentService` port. No `agents.create` or `agents.delete` call is ever made at session start or end.

The per-session system prompt assembled by the initiation webhook handler carries:
- A `prompt` override field containing the assembled system prompt (JD summary, CV summary, InterviewPlan topics, client instructions).
- Dynamic variables for fields the agent references symbolically (candidate name, job title, target duration).

The CV is passed as a summary produced by the existing system-prompt assembler, not as raw text, to stay within ElevenLabs' override payload size limits. This is consistent with how the Phase 5 sandwich pipeline handled CV content in the Gemini system prompt.

The initiation webhook endpoint is a server-to-server call from ElevenLabs. Its verification, routing, and lifecycle integration are specified in ADR-031.

This decision does not cover the specific LLM model chosen for the ElevenLabs agent, the tool-call and session-end webhook handling (ADR-031), or the frontend SDK integration (tracked as part of Phase 9.5 implementation).

## Alternatives Considered

### Alternative A: Per-session overrides at signed-URL issuance

Pass the JD summary, CV summary, InterviewPlan, and client instructions as override fields when calling `conversationalAi.conversations.getSignedUrl()` on the backend, so the session is pre-specialized before the URL is handed to the browser.

Rejected because the SDK contract does not support this. `ConversationsGetSignedUrlRequest` in `@elevenlabs/elevenlabs-js@2.49.1` (`api/resources/conversationalAi/resources/conversations/client/requests/ConversationsGetSignedUrlRequest.d.ts`) accepts only `{ agentId, includeConversationId?, branchId?, environment? }`. There are no parameters for prompt overrides or dynamic variables. This mechanism does not exist on the `getSignedUrl` call.

### Alternative B: Overrides as browser-side ConversationInitiationData

Place JD summary, CV summary, InterviewPlan, and client instructions in the browser-side `ConversationInitiationData` (`conversationConfigOverride` + `dynamicVariables`) that the ElevenLabs React SDK accepts when starting a conversation.

Rejected on security grounds. These fields are transmitted from the candidate's browser to ElevenLabs. Placing proprietary JD content, internal CV summaries, or interview scoring criteria in a browser-delivered payload exposes them to the candidate and to any network-layer observer. A candidate could inspect the SDK initiation payload (e.g., via browser devtools or a network proxy) and read the internal scoring criteria or the recruiter's notes before the interview begins. Interview content must stay server-side; the initiation webhook is the platform's designated secure path for this.

### Alternative C: First-step get_interview_context server tool instead of the initiation webhook

Omit the initiation webhook. Instead, define a `get_interview_context` server tool that the agent calls as its first action, which the backend uses to inject JD, CV, InterviewPlan, and instructions into the conversation.

Rejected for two reasons. First, the agent is unspecialized at greeting time: without a pre-loaded system prompt, the opening greeting cannot reference the role or the candidate's name, and the first substantive turn is wasted fetching context the agent should already have. Second, the initiation webhook is the ElevenLabs-intended mechanism for this pattern; using a context-fetch tool instead fights the platform and adds an observable RTT (round-trip time) to the first agent turn that the initiation webhook avoids entirely.

### Alternative D: One static agent with no per-session specialization

Keep one static agent with a fully generic system prompt. Inject interview specifics via an opening `role: "system"` or `role: "user"` context message instead of using any override mechanism.

Rejected for two reasons. First, an opening context message becomes part of the conversation history, appears in the raw transcript, and is visible to any webhook or API consumer that reads the session transcript. Per-session overrides via the initiation webhook are applied before the conversation starts and do not appear in the transcript. Second, this approach fights the platform's intended mechanism (the initiation webhook) for no benefit, and the model may re-surface the context message as part of its response.

### Alternative E: Create one ElevenLabs agent per interview

Invoke `POST /v1/convai/agents` at the start of each `StartCandidateSession` use case call, building a fully custom agent config from the `InterviewPlan`, JD, and CV. Delete the agent after the session ends via `DELETE /v1/convai/agents/:agentId`.

Rejected for four concrete reasons:

1. Agent lifecycle complexity: the port must expose `agents.create`, `agents.delete`, and session issuance as distinct operations, and the use case must handle creation failure, session failure, and cleanup failure independently. The initiation webhook gives the same per-session specialization with no agent creation at session start.
2. Orphan-agent risk on crashes: if the application process crashes after `agents.create` but before `agents.delete`, the agent is left in ElevenLabs' account indefinitely. With one static agent, there is nothing to orphan.
3. Creation latency per session start: `POST /v1/convai/agents` is a write that provisions resources on ElevenLabs' backend; its latency is higher and less predictable than the `getSignedUrl` call.
4. API rate-limit exposure: a burst of simultaneous interview starts hits the Agents API at write rate, not the cheaper token-issuance endpoint.

## Consequences

**Benefits**

- No per-interview agent lifecycle: no creation latency at session start, no cleanup obligation, no orphan-agent risk on crash or restart.
- One agent configuration to version, test, and promote. Changes to the tool set, voice, guardrails, or base prompt are a single agent-config deploy.
- Interview content (JD, CV, InterviewPlan, client instructions) is assembled and returned by the backend's initiation webhook handler and is never transmitted to or through the candidate's browser.
- Clean port: `IConversationalAgentService` exposes exactly two methods: `createSession(agentId)` returning a signed URL, and `getTranscript(sessionId)` returning the session transcript. The use case is straightforward to test by mocking these two calls.
- Correlation token reuses the project's established HMAC idiom (ADR-017): `node:crypto` HMAC-SHA256, `timingSafeEqual`, secret in environment variable, no external dependency.

**Trade-offs**

- The conversation now depends on a synchronous initiation webhook round-trip at start time. ElevenLabs calls the backend before the first agent word; if the webhook handler is slow or unavailable, the session fails to start. The webhook mechanics and synchronous initiation round-trip are specified in ADR-031.
- All concurrent interviews share one agent's tool config, voice, and guardrails. Per-interview variation in these dimensions (different voice per client, different guardrail set per campaign) is not possible without revisiting this ADR.
- A bad deploy of the static agent configuration (misconfigured tools, wrong guardrail, broken base prompt) affects all interviews simultaneously. Mitigated by ElevenLabs agent versioning and a staging-environment validation step before promoting any agent config change.
- The CV is passed as a summary (not raw text) to stay within ElevenLabs' override payload size limits. There is a hard ceiling on the assembled system prompt size that must be monitored.

**Risks and mitigations**

- *Risk*: The ElevenLabs `prompt` override field in `ConversationInitiationClientDataRequestOutput` has a low or undocumented size limit; a JD + CV summary + InterviewPlan combination exceeds it, causing the initiation webhook response to be rejected. *Mitigation*: The system-prompt assembler must enforce a character budget. Integration tests against a staging ElevenLabs agent should assert that the largest plausible override payload is accepted before Phase 9.5 ships.
- *Risk*: A misconfigured agent deploy (e.g., missing `end_interview` tool schema) breaks all active interviews simultaneously rather than just one. *Mitigation*: Maintain a staging ElevenLabs agent that mirrors production config; promote config changes through staging before applying to the production agent.
- *Risk*: The HMAC correlation token is forged or replayed by a malicious actor, causing the initiation webhook handler to load the wrong `Interview` aggregate. *Mitigation*: The token uses HMAC-SHA256 with `timingSafeEqual` (ADR-017 idiom). Tokens are short-lived (TTL set to the maximum expected conversation-start latency, suggested 5 minutes). The handler verifies signature and expiry before loading any aggregate.
- *Risk*: A developer adds a new session-start code path that calls `agents.create` directly, bypassing the static-agent contract. *Mitigation*: The Enforcement block below provides a declarative guard plus an LLM-judge advisory.
- *Risk*: A developer places JD, CV, or InterviewPlan content in the signed-URL request parameters or in a browser-delivered payload, reintroducing the security leak that Alternative B was rejected for. *Mitigation*: The Enforcement block below flags this pattern at commit time.

**Security**

Interview content (JD, CV, InterviewPlan, client instructions) MUST never be sent to the candidate browser. Only the opaque HMAC correlation token crosses the browser boundary; it contains no interview content and is tamper-proof. The conversation-initiation webhook is the sole channel by which sensitive overrides reach the ElevenLabs agent. Any code path that places interview content in the signed-URL request parameters or in any browser-delivered `ConversationInitiationData` field violates this constraint and must be blocked.

## Related Decisions

- **ADR-029 (Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline)**: This ADR depends on ADR-029's decision to adopt ElevenLabs Conversational AI. ADR-029 establishes that the ElevenLabs platform is used; this ADR records how the agent is provisioned and specialized within that platform.
- **ADR-031 (ElevenLabs Webhooks Drive the Interview Lifecycle)**: The conversation-initiation webhook mechanics, the correlation-token verification logic, and the synchronous initiation round-trip specified by this ADR are detailed in ADR-031. ADR-031 covers the full webhook receiver design, HMAC verification, and lifecycle event handling for all ElevenLabs webhook types including the initiation webhook.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: The four tools established in ADR-013 (`next_question`, `score_answer`, `take_note`, `end_interview`) map directly onto the static agent's tool configuration. The tool schemas (Zod input shapes, score range 0-5, `EndInterviewReason` enum) are reused verbatim in the ElevenLabs agent tool definitions; no changes to the domain or application layer are required.
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: The HMAC-signed correlation token issued by `StartCandidateSession` mirrors the HMAC idiom from ADR-017: `node:crypto` HMAC-SHA256, `timingSafeEqual`, secret in an environment variable, short TTL. The two mechanisms guard different surfaces (initiation-webhook correlation vs. candidate WebSocket upgrades) but share the same implementation idiom.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The static-agent provisioning model is part of the broader Phase 9.5 migration away from ADR-002. ADR-029 formally supersedes ADR-002; this ADR is a complementary provisioning detail of that migration.

## References

- `docs/progress/phase-9.md`, Phase 9.5 section (lines 144-183): motivation for the ElevenLabs migration and the `StartCandidateSession` use case description.
- SDK type: `ConversationsGetSignedUrlRequest` — `node_modules/@elevenlabs/elevenlabs-js/api/resources/conversationalAi/resources/conversations/client/requests/ConversationsGetSignedUrlRequest.d.ts` — verified accepts only `{ agentId, includeConversationId?, branchId?, environment? }`.
- SDK type: `ConversationInitiationClientDataConfigInput` — `node_modules/@elevenlabs/elevenlabs-js/api/types/ConversationInitiationClientDataConfigInput.d.ts` — source of `enableConversationInitiationClientDataFromWebhook` flag.
- SDK type: `ConversationInitiationClientDataRequestOutput` — `node_modules/@elevenlabs/elevenlabs-js/api/types/ConversationInitiationClientDataRequestOutput.d.ts` — return type of the initiation webhook handler; carries `conversationConfigOverride` and `dynamicVariables`.
- `packages/application/src/ports/interview-agent/interview-agent.port.ts:13-21`: `EndInterviewReason` enum and `AgentToolEvent` discriminated union that map onto the static agent's tool definitions.
- `apps/backend/src/infrastructure/services/gemini/gemini-interview-agent.service.ts:232-280`: current four-tool definitions reused in the ElevenLabs agent tool config.
- `apps/backend/src/infrastructure/auth/candidate-signed-link.ts`: reference HMAC implementation (ADR-017 idiom) that the correlation token follows.
- ElevenLabs Conversational AI conversation-initiation webhook documentation: https://elevenlabs.io/docs/conversational-ai/customization/conversation-configuration
- ElevenLabs Conversational AI signed URL endpoint: https://elevenlabs.io/docs/conversational-ai/api-reference/conversation-token
- ElevenLabs Conversational AI agent versioning: https://elevenlabs.io/docs/conversational-ai/agent-setup/overview

## Enforcement

The core rules are:

1. No `agents.create` or `agents.delete` call per interview (static agent only).
2. No JD, CV, InterviewPlan, or client instructions in the signed-URL request parameters or in any browser-delivered payload (sensitive content server-side only via initiation webhook).
3. The agent must be configured with `enableConversationInitiationClientDataFromWebhook = true`; per-session overrides must be returned only from the server-side initiation webhook handler.

Rules 1 and 2 have declarative guards below. Rule 3 — that per-session content is assembled and returned in the initiation webhook handler rather than placed elsewhere — requires semantic evaluation, so `llm_judge: true` is also set.

```json
{
  "forbid_pattern": [
    {
      "pattern": "\\.agents\\.create\\s*\\(",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Per-interview agent creation is forbidden (ADR-030). Reuse ELEVENLABS_AGENT_ID and deliver per-session overrides via the conversation-initiation webhook."
    },
    {
      "pattern": "\\.agents\\.delete\\s*\\(",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Per-interview agent deletion is forbidden (ADR-030). The static agent is never deleted at session end."
    },
    {
      "pattern": "conversationConfigOverride|dynamicVariables",
      "path_glob": "apps/web/src/**/*.ts",
      "message": "Interview content (JD/CV/plan/clientInstructions) must not be placed in browser-side ConversationInitiationData (ADR-030). Per-session overrides must be returned only from the server-side initiation webhook."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

`llm_judge: true` is set because the declarative rules only catch explicit API call names and browser-side patterns. The deeper compliance requirement — that the initiation webhook handler (not `StartCandidateSession` or any browser path) is the sole point of assembly and delivery for interview content — requires semantic review of the use case and adapter code.
