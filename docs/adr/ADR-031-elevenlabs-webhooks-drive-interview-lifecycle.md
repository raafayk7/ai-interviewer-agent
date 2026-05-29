# ADR-031 ElevenLabs Webhooks Drive the Interview Lifecycle

## Status

Superseded by ADR-034, 2026-05-27.

## Context

Phase 9.5 replaces the Deepgram-Gemini-ElevenLabs sandwich with ElevenLabs Conversational AI as the full voice pipeline (ADR-029). In the sandwich architecture (ADR-013), the backend owns the audio loop: `ConductInterviewUseCase` opens a WebSocket with the candidate, calls `interview.start(at)` when the socket upgrades, runs every STT-LLM-TTS turn, and persists transcript after each turn (ADR-013 D4). When that loop exits, the use case calls `interview.complete(at, transcript)` and persists the final aggregate.

With ElevenLabs, the candidate's browser connects directly to ElevenLabs over LiveKit. The backend is never in the audio path. This removes the synchronous hook that ADR-013 relied on for every lifecycle event:

- There is no `onSocketUpgrade` equivalent to call `interview.start()`.
- There is no per-turn loop to persist `appendTranscriptEntry`, `appendNote`, or `appendInternalScore`.
- There is no session-end callback in process to call `interview.complete()`.

The backend learns about ElevenLabs session events through inbound webhooks that ElevenLabs pushes to registered HTTP endpoints. These webhooks fall into four categories:

1. **Conversation-initiation webhook (synchronous)** — ElevenLabs calls our backend at conversation start and blocks waiting for our HTTP response carrying per-session overrides (`ConversationInitiationClientDataRequestOutput`: system-prompt override and dynamic variables). This webhook is enabled by the agent flag `enableConversationInitiationClientDataFromWebhook=true` on the agent's `ConversationInitiationClientDataConfigInput`. It is fundamentally different from the other three categories: it is a synchronous request/response, not a fire-and-forget notification. ElevenLabs blocks the conversation start until our response arrives; if we do not respond in time or with a valid payload, the conversation does not begin. This is not an idempotent at-least-once event in the way the other webhooks are — it is a single blocking fetch per conversation.

2. **`session.started`** — the candidate's browser has connected and the agent is live (fire-and-forget).

3. **Tool-call events** — the agent emitted a `score_answer`, `take_note`, or `end_interview` tool call (fire-and-forget).

4. **`session.ended`** — the LiveKit session has closed; the full transcript is available via the ElevenLabs REST API (fire-and-forget).

The `ConversationSignedUrlResponseModel` returned by `getSignedUrl` in the SDK (verified against `@elevenlabs/elevenlabs-js@2.49.1`) carries only `{ signedUrl: string }`. There is no `conversation_id` in the issuance response. The SDK's `ConversationInitiationClientDataConfigInput` type shows that per-session context injection at URL issuance time is impossible: that field carries config flags, not payload data. The `conversation_id` (referred to in the SDK as `conversationId`) first appears in webhook payloads: the `ToolExecutionResponseModel` carries `conversationId: string`, and the `GetConversationResponseModel` carries `conversationId: string`. Therefore `elevenLabsSessionId` must be bound from a webhook payload (initiation or post-call), not at signed-URL issuance time.

Per-session interview context (job description, CV summary, `InterviewPlan`, client instructions) cannot be passed in the browser. Passing them in the signed URL is rejected by the SDK (`getSignedUrl` accepts only `agentId`), and passing them from the browser would leak confidential JD and CV data to the client. The secure mechanism is the conversation-initiation webhook: the browser passes a short-lived opaque HMAC correlation token as a dynamic variable; the backend receives that token in the initiation webhook, verifies it against the `interviewId`, loads the `Interview` aggregate, assembles the per-session overrides, and returns them to ElevenLabs in the HTTP response body as `ConversationInitiationClientDataRequestOutput`. The correlation token mechanism mirrors ADR-017's HMAC-signed candidate link pattern: `node:crypto` HMAC-SHA256, `timingSafeEqual`, short TTL, no external dependency.

These webhook endpoints are reachable without a recruiter better-auth session (ADR-016) because ElevenLabs is the caller, not a recruiter browser. They are also distinct from the candidate HMAC-signed-link flow (ADR-017), which guards candidate browser requests. The fire-and-forget lifecycle and tool webhooks are authenticated by verifying the HMAC-SHA256 signature ElevenLabs attaches to every webhook request (`ELEVENLABS_WEBHOOK_SECRET`). The synchronous initiation webhook is authenticated by verifying the correlation token embedded in the request's `dynamic_variables` map.

This is the first set of inbound webhook endpoints in the codebase and the first REST endpoints that are public (not gated by better-auth) but still require cryptographic authentication.

The `Interview` aggregate's state machine is unchanged: `SCHEDULED -> IN_PROGRESS` via `interview.start(at)` and `IN_PROGRESS -> COMPLETED` via `interview.complete(at, transcript)` (`packages/domain/src/entities/interview/interview-status.ts:21-27`). `appendNote` and `appendInternalScore` are guarded by `status !== IN_PROGRESS` (`interview.entity.ts:161-172`), so the domain correctly rejects tool-effect webhooks that arrive before `session.started` has been processed.

Per-turn transcript persistence (ADR-013 D4) is not available in the ElevenLabs path because there is no backend turn loop. The transcript arrives atomically when the `session.ended` webhook fires. A mid-session crash does not permanently lose the transcript: ElevenLabs holds the session recording and the transcript is re-pullable from their API using the stored `elevenLabsSessionId`. This is acceptable; the Phase 10 reconciliation sweep (see Risks) formalises the recovery path.

`TranscriptEntry` has a non-empty text invariant enforced in the domain. The `PersistCompletedTranscript` use case must filter out any ElevenLabs transcript entries with empty text before constructing `TranscriptEntry` values.

This ADR partially supersedes ADR-013 for the ElevenLabs path only: the synchronous-loop lifecycle model of ADR-013 is replaced by the webhook-driven model described here. The sandwich path and ADR-013's orchestration rules for that path remain fully valid and unchanged.

## Decision

Drive the ElevenLabs-path interview lifecycle from four inbound webhook categories. The conversation-initiation webhook is a synchronous blocking request/response that injects per-session overrides and binds `elevenLabsSessionId`. The three fire-and-forget webhooks (session-started, tool-call, session-ended) are HMAC-signature-verified with `ELEVENLABS_WEBHOOK_SECRET` and idempotent via domain-level state guards.

The four-webhook model and use-case mapping is:

| Webhook category | Type | Use case invoked | Aggregate mutation |
|---|---|---|---|
| Conversation-initiation | Synchronous request/response | `AssembleConversationInitiation` | Binds `elevenLabsSessionId`; returns `ConversationInitiationClientDataRequestOutput` |
| `session.started` | Fire-and-forget | `StartInterviewFromWebhook` | `interview.start(at)` — SCHEDULED to IN_PROGRESS |
| Tool call: `score_answer` | Fire-and-forget | `RecordInternalScore` | `interview.appendInternalScore(score)` |
| Tool call: `take_note` | Fire-and-forget | `RecordAgentNote` | `interview.appendNote(note)` |
| Tool call: `end_interview` | Fire-and-forget | `EndInterviewFromAgent` | Records `endReason`; does not complete the aggregate |
| `session.ended` | Fire-and-forget | `PersistCompletedTranscript` | `interview.complete(at, transcript)` — IN_PROGRESS to COMPLETED |

**Conversation-initiation webhook.** The agent flag `enableConversationInitiationClientDataFromWebhook=true` is set on the static agent's `ConversationInitiationClientDataConfigInput`. When the candidate's browser starts a conversation, ElevenLabs calls our backend at the registered initiation endpoint before the conversation proceeds. The handler must:

1. Extract the opaque correlation token from the `dynamic_variables` map in the request body.
2. Verify the token using HMAC-SHA256 with a short-lived secret bound to `interviewId` (same idiom as ADR-017).
3. Load the `Interview` aggregate and assemble the system-prompt override, CV summary, `InterviewPlan` topics, and dynamic variables.
4. Return `ConversationInitiationClientDataRequestOutput` in the HTTP response body (200 OK).
5. Bind `elevenLabsSessionId` from the `conversation_id` field present in the initiation webhook payload.

The handler must be fast: it is in the critical path of conversation start. All I/O is a single repository read plus prompt assembly; no slow calls (LLM, external API) are permitted inside this handler. If the handler cannot assemble or return overrides, it returns a non-2xx status so ElevenLabs aborts the conversation rather than starting a mis-specialized session (fail-closed semantics). Unlike the fire-and-forget webhooks, this endpoint is not idempotent in the at-least-once sense: ElevenLabs issues it exactly once per conversation start as a synchronous fetch.

**Fire-and-forget webhooks.** The `session.started`, tool-call, and `session.ended` endpoints are authenticated by verifying the HMAC-SHA256 signature (`ELEVENLABS_WEBHOOK_SECRET`, `timingSafeEqual`) before dispatching to any use case. A shared middleware at the `/webhooks/elevenlabs/` route group performs this check; a request that fails verification returns HTTP 401 and the use case is never invoked. Idempotency is provided by the domain's state guards: a duplicate `session.started` when the interview is already IN_PROGRESS returns `InvalidInterviewStateTransitionError`, which the use case treats as a no-op and returns HTTP 200 to suppress redelivery. The same dual contract applies to the `session.ended` (post-call) webhook when the incoming `conversation_id` does not match any interview in the database: the HTTP layer returns 200 to suppress ElevenLabs redelivery, while the D3 span (ADR-032) stamps `webhook.result: "use_case_error"` + `error.kind: "INTERVIEW_NOT_FOUND"` so the unmatched-conversation event remains visible in Langfuse. The HTTP layer is idempotent; the span layer is truthful. Both are required.

`elevenLabsSessionId` binding: the `conversation_id` observed in the first arriving webhook (initiation or `session.started`) is stored on the `Interview` aggregate. The `getSignedUrl` response (`{ signedUrl: string }`) carries no `conversation_id`; binding at issuance time is not possible with the SDK at `@elevenlabs/elevenlabs-js@2.49.1`.

`StartCandidateSession` does not flip the interview to IN_PROGRESS. It validates SCHEDULED status, constructs the signed URL, and returns it. The status transition is deferred to the `session.started` webhook so the aggregate reflects reality.

This ADR applies to the ElevenLabs path only. The sandwich path (ADR-013) remains fully valid and unchanged.

## Alternatives Considered

### Alternative A: Inject per-session context at signed-URL issuance time

Pass the system-prompt override and interview specifics as fields on the `getSignedUrl` call at the moment `StartCandidateSession` issues the URL.

Rejected because the SDK does not support it. `ConversationSignedUrlResponseModel` (verified at `@elevenlabs/elevenlabs-js@2.49.1`) returns only `{ signedUrl: string }`. The `getSignedUrl` method accepts only `agentId`; there is no payload override parameter. The per-session context injection mechanism provided by the SDK is the conversation-initiation webhook response, not URL issuance.

### Alternative B: Browser-supplied per-session overrides

The candidate's browser sends the job description, CV summary, and `InterviewPlan` directly to ElevenLabs as part of the conversation initiation client data (browser-side dynamic variables or client prompt override).

Rejected because it leaks confidential data to the client. The JD and CV are stored as recruiter-owned data; passing them through the browser exposes them to the candidate and to any network observer. The conversation-initiation webhook keeps context assembly entirely on the server side.

### Alternative C: Bind `elevenLabsSessionId` at signed-URL issuance

Store the `conversation_id` on the `Interview` aggregate when `StartCandidateSession` issues the URL so downstream webhook handlers have it available immediately.

Rejected because the SDK does not return a `conversation_id` at issuance time. `ConversationSignedUrlResponseModel.signedUrl` is the only field. The `conversation_id` is assigned by ElevenLabs at session creation and first appears in webhook payloads (confirmed from `ToolExecutionResponseModel.conversationId` and the conversation-initiation request body at SDK 2.49.1). Binding must therefore happen at the first received webhook.

### Alternative D: Optimistic status flip at URL issuance time

`StartCandidateSession` marks the interview IN_PROGRESS immediately when issuing the signed URL, before the candidate's browser has connected. The `session.started` webhook is ignored or used only for a timestamp update.

Rejected because the interview status would no longer reflect reality. If the candidate never opens the URL, the interview is stuck IN_PROGRESS indefinitely. The Phase 6 evaluator reads the aggregate via `findById` and may attempt to evaluate an interview that has no transcript and no completed state. `interview.start(at)` correctly records when the session actually began, not when the URL was minted.

### Alternative E: Poll the ElevenLabs API for session state and transcript

On each recruiter-side status check, or on a periodic background job, the backend calls the ElevenLabs API to ask whether the session has started, what tool calls have been made, and whether the session has ended.

Rejected for three reasons. First, polling adds latency between the candidate's action and the status update visible to the recruiter. Second, it wastes API calls; ElevenLabs pushes these events natively as webhooks. Third, there is no polling endpoint on ElevenLabs that exposes per-tool-call granularity mid-session; tool calls are only available in the final session transcript, meaning `RecordInternalScore` and `RecordAgentNote` could not be populated during the session at all under a polling model.

### Alternative F: Backchannel per-turn transcript streaming from the browser

The candidate's browser forwards partial transcript data to the backend during the session, restoring per-turn persistence semantics from ADR-013 D4.

Rejected because it re-creates the complexity that ElevenLabs was chosen to eliminate. The browser-to-ElevenLabs connection is LiveKit-managed and fully outside backend control; a second channel from the browser at all times during the session is additional infrastructure and an additional failure surface. The ElevenLabs `session.ended` webhook delivers the authoritative final transcript, making partial forwarding redundant.

### Alternative G: Do nothing — retain the sandwich (ADR-013) and patch its silent-turn hallucination

Continue with the Deepgram-Gemini-ElevenLabs sandwich, insert a synthetic `[no audible response]` marker on silent turns, move the CV out of the system prompt, and add a server-side echo-detection guard.

Rejected because the hallucination bug is a symptom of the sandwich's structural weaknesses, not an isolated defect. The sandwich lacks native VAD, barge-in, role enforcement, and has approximately 700 to 1000 ms stitched latency across three vendors. ElevenLabs Conversational AI solves the entire problem area natively (ADR-029). The sandwich path is retained for reference and for deployments that have not adopted ADR-029, but is no longer the recommended forward path.

## Consequences

**Benefits**

- Interview status reflects reality: SCHEDULED means the candidate has not connected; IN_PROGRESS means an active ElevenLabs session exists. The domain state machine (`interview-status.ts:21-27`) enforces this without special-casing.
- Per-session context (JD, CV, `InterviewPlan`) is assembled server-side in the initiation webhook handler and never passes through the browser, eliminating the client-side data-leak risk.
- `StartCandidateSession` becomes a narrow, pure URL-issuance use case with no side effects on the aggregate status. Simpler to test, simpler to audit.
- Tool effects (`score_answer`, `take_note`, `end_interview`) are handled by small single-purpose use cases that compose cleanly with the existing `appendNote` / `appendInternalScore` / IN_PROGRESS-gated domain mutators.
- Fire-and-forget webhook verification reuses the project's established HMAC idiom (ADR-017): `node:crypto` only, no new npm dependency, `timingSafeEqual`, secret rotation via environment variable.
- The IN_PROGRESS-gated domain guards act as natural idempotency checks: a duplicate tool-call webhook that arrives while the interview is already COMPLETED is rejected by the domain guard without additional receiver-level deduplication logic.
- Transcript arrives atomically at session end: no partial-write window, no N-UPSERT write amplification (ADR-013 D4 cost does not apply to this path).

**Trade-offs**

- The lifecycle is now asynchronous and distributed across multiple webhook deliveries rather than a single synchronous loop. Reasoning about the state machine requires understanding ElevenLabs webhook delivery semantics (at-least-once for fire-and-forget; exactly-once blocking fetch for initiation).
- The conversation now has a hard runtime dependency on a fast, available, fail-closed initiation webhook. This is a new availability surface: if the initiation webhook handler is down or times out, the conversation cannot start. The sandwich path had no such per-conversation synchronous backend dependency at session start.
- Transcript persistence is all-or-nothing at session end. If the `session.ended` webhook never arrives (ElevenLabs delivery failure, network partition), the interview stays IN_PROGRESS and no transcript is persisted. The transcript is re-pullable from the ElevenLabs API using the stored `elevenLabsSessionId`, but recovery requires a reconciliation job that is out of scope here (Phase 10).
- Tool-call webhooks (`score_answer`, `take_note`, `end_interview`) arrive independently of the final transcript. If the `session.ended` webhook is delayed, the aggregate may hold notes and scores but no transcript for a window of time. The Phase 6 evaluator must not run until the interview is in COMPLETED status.
- `ELEVENLABS_WEBHOOK_SECRET` is a new required environment variable alongside `CANDIDATE_LINK_SECRET` (ADR-017) and `BETTER_AUTH_SECRET` (ADR-016). Deployments that omit it will fail HMAC verification on all fire-and-forget webhook calls and the interview lifecycle will not advance.

**Risks and mitigations**

- *Risk*: Initiation webhook latency or outage blocks interview start. Every candidate who tries to begin an interview while the handler is slow or unavailable sees a stalled or aborted conversation. *Mitigation*: Keep the initiation handler to a single repository read plus prompt assembly; no LLM calls, no external API calls, no slow operations. Monitor p99 latency. Phase 10 will add a configurable timeout and retry-hardening plan.
- *Risk*: Mis-specialized conversation if initiation webhook returns 2xx with partial overrides (e.g. prompt assembled but `elevenLabsSessionId` not yet bound). *Mitigation*: Fail-closed semantics — if the handler cannot assemble a complete override payload, it must return a non-2xx status so ElevenLabs aborts the conversation start rather than proceeding with default or empty context.
- *Risk*: Webhook spoofing — a malicious actor crafts a `session.started`, tool-call, or `session.ended` payload to manipulate interview status. *Mitigation*: HMAC-SHA256 signature verification with `ELEVENLABS_WEBHOOK_SECRET` and `timingSafeEqual` before any use case is invoked. A missing or invalid signature returns HTTP 401; the use case is never called.
- *Risk*: Correlation token for the initiation webhook is replayed or spoofed. *Mitigation*: The token is short-lived (same HMAC-SHA256 + short TTL idiom as ADR-017). Verification uses `timingSafeEqual`. An expired or mismatched token causes the initiation handler to return non-2xx, aborting the conversation.
- *Risk*: Duplicate or out-of-order fire-and-forget webhook delivery. ElevenLabs guarantees at-least-once delivery. A duplicate `session.started` webhook would attempt to call `interview.start()` on an already-IN_PROGRESS interview. *Mitigation*: `interview.start()` returns `InvalidInterviewStateTransitionError` if `status !== SCHEDULED` (`interview.entity.ts:132-134`). The use case treats this error as a no-op and returns HTTP 200 to suppress redelivery. The same pattern applies to tool-call and `session.ended` webhooks via the IN_PROGRESS and COMPLETED guards.
- *Risk*: `session.ended` webhook never arrives. The interview remains IN_PROGRESS indefinitely; the Phase 6 evaluator cannot run. *Mitigation*: A future reconciliation/timeout sweep (Phase 10) will identify interviews that have been IN_PROGRESS beyond `maxDurationMinutes + graceBuffer` and attempt to recover by pulling the transcript from the ElevenLabs API directly. This is explicitly out of scope for Phase 9.5.
- *Risk*: ElevenLabs transcript entries with empty text violate the `TranscriptEntry` non-empty invariant. *Mitigation*: `PersistCompletedTranscript` filters out entries with empty or whitespace-only text before constructing `TranscriptEntry` values, following the same guard introduced in the sandwich path (Phase 9 implementation notes).
- *Risk*: `ELEVENLABS_WEBHOOK_SECRET` leaked from the environment. *Mitigation*: All fire-and-forget ElevenLabs webhook sessions become forgeable until the secret is rotated. Secret must be stored in a secrets manager and injected at runtime.

## Related Decisions

- **ADR-029 (Adopt ElevenLabs Conversational AI for Voice Interviews)**: This ADR depends on ADR-029's decision to adopt ElevenLabs as the voice pipeline. The webhook-driven lifecycle is a direct consequence of ElevenLabs' architecture in which the backend is not in the audio path.
- **ADR-030 (Static ElevenLabs Agent with Per-Session Overrides)**: This ADR pairs with ADR-030. ADR-030 defines the static agent and the correlation-token model by which the browser passes an opaque token as a dynamic variable. This ADR defines how the initiation webhook receives that token, verifies it, and returns the assembled overrides. The two ADRs together define the secure per-session context injection pipeline.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: This ADR partially supersedes ADR-013 for the ElevenLabs path. ADR-013 remains valid and unchanged for the sandwich path. The tool surface defined in ADR-013 D1 (`score_answer`, `take_note`, `end_interview`) carries forward to the ElevenLabs path unchanged.
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: The webhook HMAC signature verification style mirrors ADR-017's approach: `node:crypto` HMAC-SHA256, `timingSafeEqual`, secret in environment, no external dependency. The correlation token bound to `interviewId` and passed as a dynamic variable follows the same HMAC idiom, ensuring the initiation webhook's caller is authenticated to the interview in question.
- **ADR-032 (Extend OTel Span Hierarchy for ElevenLabs Conversational Sessions)**: ADR-032 adds the `interview.webhook.initiation` span for the conversation-initiation webhook handler, providing Langfuse visibility into the per-conversation blocking path.
- **ADR-019 (Recruiter Ownership Checks Live in the Presentation Layer)**: Webhook endpoints do not carry a recruiter session. Ownership is implicitly scoped by the `elevenLabsSessionId` / correlation-token payload, which maps to exactly one interview in the database. This is an explicit carve-out from ADR-019's scope (ADR-019 is scoped to recruiter-authenticated endpoints only).
- **ADR-016 (Adopt better-auth for Recruiter Authentication)**: Webhook endpoints are deliberately excluded from the better-auth session pre-handler. This ADR establishes that exclusion explicitly.

## References

- SDK type verification: `ConversationSignedUrlResponseModel` at `node_modules/.pnpm/@elevenlabs+elevenlabs-js@2.49.1/node_modules/@elevenlabs/elevenlabs-js/api/types/ConversationSignedUrlResponseModel.d.ts` — only `{ signedUrl: string }` is returned; no `conversation_id` at issuance.
- SDK type verification: `ConversationInitiationClientDataConfigInput` at `...api/types/ConversationInitiationClientDataConfigInput.d.ts` — `enableConversationInitiationClientDataFromWebhook?: boolean` is the agent flag.
- SDK type verification: `ConversationInitiationClientDataRequestOutput` at `...api/types/ConversationInitiationClientDataRequestOutput.d.ts` — the response payload shape returned by the initiation webhook handler.
- SDK type verification: `ToolExecutionResponseModel.conversationId` at `...api/types/ToolExecutionResponseModel.d.ts` — first appearance of `conversationId` in a webhook payload.
- SDK type verification: `GetConversationResponseModel.conversationId` at `...api/types/GetConversationResponseModel.d.ts` — `conversationId` present on the session-end / post-call payload.
- Domain state machine: `packages/domain/src/entities/interview/interview-status.ts:21-27`
- `interview.start()` guard: `packages/domain/src/entities/interview/interview.entity.ts:131-138`
- `interview.complete()` signature: `packages/domain/src/entities/interview/interview.entity.ts:141-152`
- `appendNote`, `appendInternalScore` IN_PROGRESS guards: `packages/domain/src/entities/interview/interview.entity.ts:161-172`
- HMAC verification reference implementation: `apps/backend/src/infrastructure/auth/candidate-signed-link.ts` (ADR-017 pattern to mirror)
- Phase 9 progress document, Phase 9.5 section: `docs/progress/phase-9.md`
- ADR-013 D1 (tool surface), D4 (per-turn persistence): `docs/adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md`
- ElevenLabs Conversational AI webhook documentation: https://elevenlabs.io/docs/conversational-ai/guides/webhooks
- ElevenLabs conversation initiation client data webhook: https://elevenlabs.io/docs/conversational-ai/customization/conversation-configuration#conversation-initiation-client-data-webhook
- ElevenLabs session transcript API: https://elevenlabs.io/docs/api-reference/conversational-ai/get-conversation

## Enforcement

Every inbound ElevenLabs webhook route must verify authenticity before acting: HMAC-SHA256 with `ELEVENLABS_WEBHOOK_SECRET` for fire-and-forget routes, and correlation-token HMAC verification for the synchronous initiation route. Fire-and-forget webhook receivers must treat illegal state-transition errors as idempotent no-ops (return success to suppress redelivery) rather than propagating them as HTTP 4xx/5xx errors. The initiation webhook must fail-closed: any failure to assemble or return valid overrides must return a non-2xx status. These properties are semantic and require LLM judgment to evaluate against diffs.

The declarative rule below provides belt-and-suspenders coverage to prevent any webhook route handler from reading `ELEVENLABS_WEBHOOK_SECRET` directly (the shared verification middleware must own that read):

```json
{
  "forbid_pattern": [
    {
      "pattern": "ELEVENLABS_WEBHOOK_SECRET",
      "path_glob": "apps/backend/src/presentation/routes/webhooks/**/*.ts",
      "message": "Do not read ELEVENLABS_WEBHOOK_SECRET directly in route handlers. Use the shared webhook-verification middleware (ADR-031)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
