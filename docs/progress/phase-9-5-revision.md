# Phase 9.5 Backend Revision — ElevenLabs Conversational AI Alignment Progress

## Phase 9.5 Revision Complete

This document records the Phase 9.5 backend revision changes for ai-interviewer-agent.

Phase 9.5 revision goal:

- Align the first-pass ElevenLabs Conversational AI backend implementation with live-validated mechanisms discovered during the 2026-05-25 gate (1 PASS / 3 FAIL) and the 2026-05-27 follow-up spike
- Move override assembly from a synchronous initiation webhook to `StartCandidateSession`, using `Conversation.startSession({ overrides, dynamicVariables })` as the sealed-courier transport
- Replace single `/tools` route + `tool_name` body routing with three per-tool POST routes discriminated by URL, each with `x-voice-secret` shared-secret header
- Delete `EndInterviewFromAgentUseCase` — `end_call` is a system tool (no webhook); end-reason extracted from `transcript[].tool_results[]` in post-call payload
- Narrow HMAC verification to post-call surface only (30-minute tolerance); add `ElevenLabsToolSecretVerifier` for tool routes
- Delete the correlation-token mechanism entirely — `conversation_id` from `issueSignedUrl` is the trustworthy session key

Plan source: `.claude/plan/phase-9-5-revision.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-033](../adr/ADR-033-elevenlabs-static-agent-server-built-overrides-via-browser-sdk.md) — overrides assembled server-side, delivered via browser SDK `Conversation.startSession`; supersedes ADR-030
- [ADR-034](../adr/ADR-034-elevenlabs-lifecycle-two-webhooks-per-tool-urls-scoped-hmac.md) — two inbound webhook surfaces (per-tool tool webhooks + post-call), per-tool URLs, shared-secret for tools, HMAC for post-call only; supersedes ADR-031
- [ADR-032](../adr/ADR-032-otel-span-hierarchy-for-elevenlabs-conversational-sessions.md) — OTel span hierarchy; amended in place to drop D5 span and stamp `end_reason` from post-call transcript

---

## Summary

Completed:

- **Application layer — deletions:** Removed `AssembleConversationInitiationContextUseCase`, `EndInterviewFromAgentUseCase`, and the entire `conversation-correlation-token/` port directory (3 files, 2 use cases + their test files). Removed `ELEVENLABS_SESSION_TOKEN_SECRET` from the env surface.
- **Application layer — `StartCandidateSession` rewrite:** `issueSignedUrl` return type extended with `conversationId`. Use case now binds the session ID at issuance (`interview.bindElevenLabsSession`), assembles the system prompt + dynamic variables server-side, and returns `{ signedUrl, overrides: { agent: { prompt: { prompt } } }, dynamicVariables }`. No third constructor argument (correlation-token issuer removed).
- **Application layer — `PersistCompletedTranscript` rewrite:** Transcript now arrives inline from the post-call payload (`input.transcript`) rather than being fetched from the ElevenLabs API via `agent.getTranscript()`. `findEndCallSuccess` walks transcript entries from the last turn, finds `result_type === "end_call_success"`, and persists `[end_call] reason=<reason>` as an `AgentNote`. No `IConversationalAgentService` dependency.
- **Infrastructure — HMAC verifier hardening:** `ElevenLabsWebhookVerifier` gained `toleranceSecs` (default 30 min) and `nowMs` injectable clock. Timestamp age is checked before HMAC comparison, rejecting replayed requests outside the window.
- **Infrastructure — tool-secret verifier:** New `ElevenLabsToolSecretVerifier` with timing-safe `x-voice-secret` header comparison and `elevenLabsToolSecretVerifierFromEnv` factory (requires ≥ 32 chars). Exported from `infrastructure/auth/index.ts`.
- **Infrastructure — `issueSignedUrl` return shape:** `ElevenLabsConversationalService.issueSignedUrl` returns `{ signedUrl, conversationId }`. Tries `response.conversationId` first; falls back to `extractConversationIdFromUrl(signedUrl)` (URL query param pattern used by some SDK versions); errors if neither is present.
- **Infrastructure — agent-config assertion:** Dropped `enableConversationInitiationClientDataFromWebhook` check; now only asserts `conversationConfigOverride.agent.prompt.prompt` and `conversationConfigOverride.agent.firstMessage`.
- **Presentation — webhook controller rewrite:** `ElevenLabsWebhookControllerDeps` now has `hmacVerifier` + `toolSecretVerifier` (not a single `verifier`). `handleTool` dispatcher deleted; replaced with `handleNextQuestion`, `handleScoreAnswer`, `handleTakeNote` each with `verifyToolSecret()` guard. `handlePostCall` now parses `body.data.conversation_id`, `body.data.transcript`, `body.data.metadata` (the live-confirmed payload shape). `PostCallTranscriptEntry` and `PostCallToolResult` imported from `@repo/application`.
- **Presentation — candidate-session controller:** Returns `{ signedUrl, overrides, dynamicVariables }` to browser (previously `{ signedUrl, sessionToken }`). OTel span stamps `interview.session.override_assembled = true` on success.
- **Presentation — routes:** Single `/tools` POST replaced with `/tools/next_question`, `/tools/score_answer`, `/tools/take_note`.
- **Presentation — HTTP mapper:** `INVALID_TOOL_SECRET: 401` added to `STATUS_BY_CODE`.
- **Composition:** `buildElevenLabsWebhookDeps` wires `hmacVerifier` + `toolSecretVerifier` from separate env-factory calls; `EndInterviewFromAgentUseCase` wire removed; `PersistCompletedTranscriptUseCase` constructed with single argument `(interviews)`. `buildCandidateSessionDeps` drops correlation-token wiring; `StartCandidateSessionUseCase` constructed with two arguments `(interviews, service)`.
- **App bootstrap:** All initiation webhook references removed from `BuildAppOptions`, `composeDefaults`, and registration block.
- **Live-validation scripts:** `provision-agent.mjs` — per-tool placeholder URLs, `x-voice-secret` headers, dropped `enableConversationInitiationClientDataFromWebhook` from agent create call. `wire-webhooks.mjs` — per-tool URL patches with actual secret; dropped initiation webhook patching. `cleanup.mjs` — initiation section replaced with no-op comment. `harness.html` — passes `overrides` + `dynamicVariables` to `Conversation.startSession`; dropped `sessionToken` handling.
- **Env:** `ELEVENLABS_SESSION_TOKEN_SECRET` replaced with `ELEVENLABS_TOOL_WEBHOOK_SECRET` in `.env.example`.

Explicitly **not** included in this work:

- Frontend `InterviewSessionContainer` update — must be updated to pass `overrides` + `dynamicVariables` from the session endpoint response through to `Conversation.startSession`; flagged as Phase 9.5 frontend follow-up
- Live smoke test of the three new route shapes against real ElevenLabs API calls — `ELEVENLABS_WEBHOOK_SECRET` and workspace post-call webhook not configured in this environment
- README update and ADR commit

---

## Implementation Notes

**Deletion ordering was critical.** TypeScript rejects unknown imports immediately, so the deletion sequence was: strip caller references first (app.ts, compositions, deps interfaces), then delete the source files, then run `check-types`. Attempting to delete source before callers produced cascading errors across three packages.

**`end_call` system tool discovery.** The first-pass implementation dispatched `EndInterviewFromAgentUseCase` via a `handleTool` branch matching `tool_name === "end_call"`. Live validation confirmed `end_call` is `type: "system"` and never fires a tool URL. The end-reason is carried instead in `post_call_webhook.data.transcript[].tool_results[]` with `result_type === "end_call_success"`. The entire `EndInterviewFromAgentUseCase`, its dispatch branch, and the `end_call` test cases in the controller test were deleted.

**Post-call payload wrapper.** The ElevenLabs post-call payload is `{ data: { conversation_id, transcript, metadata, ... } }`, not a flat object. The first-pass parser read `body.conversation_id` directly and failed to find the session ID. The revised `parsePostCallPayload` reads `source.data.conversation_id`.

**Tool-secret verifier boundary placement.** The controller's `verifyToolSecret` discards the typed `InvalidToolSecretError` and fabricates a plain `ServiceError`-shaped object to pass to `mapServiceErrorToHttp`. This preserves the Clean Architecture rule that the presentation layer does not import from infrastructure — the controller's `ToolSecretVerifierLike` interface is structurally typed as `Result<void, unknown>`, keeping the infrastructure error type invisible to the controller.

**Injectable clock in HMAC verifier.** Adding `nowMs?: () => number` to `ElevenLabsWebhookVerifierConfig` allows tests to pin the clock and exercise the 30-minute tolerance window deterministically without depending on real wall-clock time.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Results:

- domain tests: **not re-run** (no domain files changed)
- application tests: **178 passed** (1 pre-existing failure in `create-interview.dto.test.ts`, unrelated to Phase 9.5)
- backend tests: **317 passed** (Drizzle integration tests excluded — ECONNREFUSED, no test database in this environment)
- type-check passed for `@repo/domain`, `@repo/application`, `backend`

Cleanup checks:

```bash
rg "ELEVENLABS_SESSION_TOKEN_SECRET" apps/backend/ packages/
rg "conversation-correlation-token" apps/backend/ packages/
rg "EndInterviewFromAgent" apps/backend/ packages/
rg "AssembleConversationInitiationContext" apps/backend/ packages/
rg "registerElevenLabsInitiationWebhookRoutes|elevenLabsInitiationWebhook" apps/backend/src
rg "enableConversationInitiationClientDataFromWebhook" apps/backend/
```

Result: all six sweeps returned empty.

---

## Code Review

`backend-code-reviewer` returned **PASS** on the first submission with no required revisions.

Non-blocking style notes addressed post-review:
- `start-candidate-session.use-case.test.ts` — removed unused `INTERVIEW_STATUS` and `beforeEach` imports
- `candidate-session.controller.test.ts` — updated stale test title from "signedUrl and sessionToken" to "signedUrl, overrides, and dynamicVariables"

Final test counts at PASS: application **178 passed**, backend **317 passed**.

---

## Notes

**Frontend follow-up is blocking for Phase 9.5 end-to-end.** The backend now returns `{ signedUrl, overrides, dynamicVariables }` from `POST /interviews/:id/candidate-session`. The `InterviewSessionContainer` must be updated to extract these fields and pass them to `Conversation.startSession({ signedUrl, overrides, dynamicVariables })`. Until that change lands, the browser will call `Conversation.startSession({ signedUrl })` only, which will use the agent's static placeholder prompt instead of the real interview instructions.

**Post-call HMAC requires workspace webhook configuration.** `ELEVENLABS_WEBHOOK_SECRET` (the workspace-level HMAC secret from ElevenLabs settings) is not set in this environment. The post-call route (`/webhooks/elevenlabs/post-call`) will reject every inbound post-call payload with 401 until this is configured. The session-start HMAC path has the same requirement but is also workspace-level — ElevenLabs workspace settings must be configured to send signatures.

**Tool secret must be wired before live calls.** `ELEVENLABS_TOOL_WEBHOOK_SECRET` must be set in `.env`, and `wire-webhooks.mjs` must be re-run with that secret to inject it into the three tool `request_headers` in the ElevenLabs agent configuration. The first-pass artifacts (`agentId`, `toolIds`) are still valid and provision-agent will skip re-creation.

---

## 2026-05-29 — Blocker fixes, live-validation PASS, ADR acceptance

A code review of the revision (above) caught two live-breaking defects plus a latent bug; all were fixed, and the full ElevenLabs path was then validated end-to-end against the live platform.

### Defects fixed
- **Blocker 1 — interview never reached IN_PROGRESS.** The browser-SDK flow had nothing to drive `interview.start()` (ElevenLabs fires no conversation-start webhook for browser sessions), so post-call `complete()` silently no-opped and transcripts were never persisted. Fix: `StartCandidateSessionUseCase` now performs the SCHEDULED→IN_PROGRESS transition at signed-URL issuance (reconnect-tolerant: accepts SCHEDULED or IN_PROGRESS). The orphaned `/session-start` route, handler, parser, composition wire, and `StartInterviewFromWebhookUseCase` (+ test) were deleted.
- **Blocker 2 — tool webhooks couldn't be correlated.** Server-tool bodies are shaped only by `request_body_schema`; `interview_id` was absent. Fix: each tool's schema injects `interview_id` from the session dynamic variable (`dynamicVariable: "interview_id"`, SDK `LiteralJsonSchemaProperty`); the controller correlates on `interview_id` alone (conversation id optional, span-only).
- **Issue 3 — `getSignedUrl` conversation_id.** The SDK response type is `{ signedUrl }` only; hardened the adapter to read snake/camel passthrough fields before the URL-query fallback.
- **Bug 3 (found during the live run) — `requestHeaders` shape.** Scripts passed `requestHeaders` as an array `[{name,value}]`; the API requires an object map `{ "x-voice-secret": … }`. Fixed in `provision-agent.mjs` + `wire-webhooks.mjs`.
- **Harness — transport + CORS.** Pinned `connectionType: "websocket"` (matches the signed URL; bypasses the LiveKit WebRTC `/rtc/v1` handshake bug); the harness must be served over http (port 3000, in the CORS allowlist), not `file://` (origin `null` → CORS-blocked).

### New scripts
- `seed-interview.ts` — seeds a SCHEDULED interview (via real domain serialization) and mints a candidate token.
- `register-post-call-webhook.mjs` — creates the workspace post-call webhook via API, captures the HMAC secret from the create response, links it per-agent.

### ADR dispositions (2026-05-29, human-approved)
- **Accepted:** ADR-029, ADR-032, ADR-033, ADR-034.
- ADR-002 → marked Superseded as primary by ADR-029 (sandwich retained as fallback). ADR-030/031 already Superseded by ADR-033/034. `docs/adr/README.md` index updated; `bin/adr-lint` clean.

### Live-validation gate — PASS (supersedes the 2026-05-25 1 PASS / 3 FAIL)
A full browser voice conversation through the live agent confirmed:
- candidate-session → 200; interview SCHEDULED→IN_PROGRESS; real `conv_…` bound (Blocker 1 + Issue 3).
- `take_note` webhook → 200 carrying `interview_id`; note recorded (Blocker 2 + `x-voice-secret` auth).
- post-call → 200, HMAC verified; 12-turn transcript persisted; interview COMPLETED (Blocker 1 payoff).
- `score_answer`/`next_question` were not triggered by the agent this run; identical code path to `take_note`, covered by extension.

### Env vars added (local `.env`, not committed)
`ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_TOOL_WEBHOOK_SECRET`, `CANDIDATE_LINK_TTL_SECONDS`.

Re-setup guide: `docs/runbooks/elevenlabs-live-validation.md`.
