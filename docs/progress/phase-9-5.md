# Phase 9.5 — ElevenLabs Conversational AI Backend (Parallel Path) Progress

## Phase 9.5 Complete

This document records the Phase 9.5 changes for the ai-interviewer-agent monorepo.

Phase 9.5 goal:

- Add the ElevenLabs Conversational AI voice path as a parallel pipeline alongside the retained sandwich (Deepgram + Gemini + ElevenLabs TTS); the sandwich stays runnable as a non-default fallback and every sandwich file is untouched.
- Leave the backend out of the per-turn audio path entirely: the candidate's browser will connect directly to ElevenLabs over LiveKit; backend correctness moves to four inbound webhook surfaces (synchronous initiation + three fire-and-forget) authenticated by HMAC and idempotent at both the HTTP and domain layers.
- Keep all per-session interview content (JD, CV summary, `InterviewPlan`, client instructions) server-side: the browser never receives interview content. Per-session overrides are assembled inside the synchronous conversation-initiation webhook and returned to ElevenLabs server-to-server.
- Issue a short-lived HMAC correlation token from `StartCandidateSession` so the browser can be linked to its interview when the initiation webhook arrives — same `node:crypto` + `timingSafeEqual` idiom as ADR-017's candidate signed link.
- Provision exactly one static ElevenLabs agent (no per-interview `agents.create` / `agents.delete`); ADR-030's declarative `forbid_pattern` guards this.
- Keep the domain layer additive only — state machine unchanged; one new `Option<string>` field plus an idempotent `bindElevenLabsSession()` mutator.
- Cover the new backend-controlled surfaces with five new OTel span types (D1–D5) under the existing `interview.` prefix so the Langfuse exporter captures them without filter changes.

Plan source: `.claude/plan/phase-9-5-elevenlabs-backend.md`
Architecture context: `docs/ARCHITECTURE.md`
Spike findings: `docs/spikes/phase-9-5-elevenlabs-spike-findings.md` — the 7 SDK contract surprises against `@elevenlabs/elevenlabs-js@2.49.1` that materially shaped the wiring.

ADRs referenced (all `Proposed`; ADR-031 and ADR-032 received clarifying edits during this phase to reconcile rubric drift):
- [ADR-029](../adr/ADR-029-adopt-elevenlabs-conversational-ai-for-voice-interviews.md) — adopt ElevenLabs Conversational AI as the primary voice path; sandwich retained as non-default fallback; `llm_judge: true` advisory at commit time
- [ADR-030](../adr/ADR-030-static-elevenlabs-agent-with-per-session-overrides.md) — single static agent at `ELEVENLABS_AGENT_ID`; per-session overrides via the conversation-initiation webhook; declarative `forbid_pattern` against `.agents.create(` / `.agents.delete(` under `apps/backend/src/**`
- [ADR-031](../adr/ADR-031-elevenlabs-webhooks-drive-interview-lifecycle.md) — synchronous initiation webhook (fail-closed) + three fire-and-forget HMAC-verified webhooks (`session-start`, `tools`, `post-call`); `elevenLabsSessionId` bound from `conversation_id` observed in webhook payloads, never at signed-URL issuance; clarified the dual HTTP-200/span-truthful contract for the post-call route on unmatched `conversation_id`
- [ADR-032](../adr/ADR-032-otel-span-hierarchy-for-elevenlabs-conversational-sessions.md) — five OTel span types: D1 `interview.session.conversational`, D2 `interview.webhook.tool`, D3 `interview.webhook.session-end`, D4 child `interview.session.transcript-persist`, D5 `interview.webhook.initiation`; D1 attribute matrix corrected to drop `elevenLabs.sessionId` (binds asynchronously)
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — HMAC idiom reused for both the candidate signed link (already in use) and the new conversation correlation token
- [ADR-013](../adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md) — tool surface carried forward; `end_interview` reframed as the built-in `end_call` system tool per spike surprise #5

---

## Summary

Completed:

- **Domain (additive only, state machine untouched):** `packages/domain/src/entities/interview/interview.entity.ts` gains an optional `elevenLabsSessionId: Option<string>` field and an idempotent `bindElevenLabsSession(sessionId)` mutator returning `Result<Interview, InvalidInterviewStateTransitionError>`. Allowed on `SCHEDULED` and `IN_PROGRESS`; re-bind to the same id returns `this` unchanged; `COMPLETED`/`EVALUATED` rejected with the gating-state pair `(this.status, INTERVIEW_STATUS.IN_PROGRESS)` so the error message reports the intended target rather than the misleading `(COMPLETED, COMPLETED)`. `InterviewSerialized` mirrors the new nullable field. Entity test extended with five new `bindElevenLabsSession()` cases plus a serialize round-trip with both `null` and a present value.
- **Application ports:** Two new port directories under `packages/application/src/ports/`: `conversational-agent/` (`IConversationalAgentService` exposing only `issueSignedUrl({ agentId })` and `getTranscript(sid)` — overrides explicitly removed from the port surface per ADR-030) and `conversation-correlation-token/` (`IConversationCorrelationTokenIssuer` with `issue(interviewId)` + `verify(token)`, HMAC-bound to the interview id). Port-local error types extending `ServiceInfraError`: `ConversationalAgentError`, `ConversationalAgentUnavailableError`, `ConversationalSignedUrlFailedError`, `ConversationalTranscriptFetchFailedError`, `InvalidConversationCorrelationTokenError`.
- **Application use cases (7 new files, one per use case per codebase convention):** `StartCandidateSession` validates `SCHEDULED` + plan-present, mints the signed URL via the port, issues the correlation token, returns `{ signedUrl, sessionToken }` — never calls `interview.start()` and never binds `elevenLabsSessionId` (ADR-031 defers both). `AssembleConversationInitiationContext` is the synchronous initiation-webhook handler: verifies the correlation token, loads the interview, binds `elevenLabsSessionId` from the payload's `conversation_id` when present (idempotent re-bind), assembles the system-prompt override + dynamic variables, returns `{ interviewId, systemPrompt, firstMessage?, dynamicVariables }`; fail-closed on every error. `StartInterviewFromWebhook` drives `SCHEDULED → IN_PROGRESS` from the `session.started` event, treats illegal-transition as `Ok({ applied: false })`, and binds `elevenLabsSessionId` as a fallback when initiation never bound it. `RecordAgentNote`, `RecordInternalScore`, and `EndInterviewFromAgent` dispatch the `take_note` / `score_answer` / `end_call` (built-in system tool — spike surprise #5) webhook payloads onto `interview.appendNote` / `interview.appendInternalScore`; `EndInterviewFromAgent` records the reason as an `AgentNote` and explicitly does **not** complete the aggregate. `PersistCompletedTranscript` pulls the transcript via `getTranscript(sid)`, filters empty/whitespace rows before `TranscriptEntry.create` (preserving the non-empty invariant), completes the aggregate, and returns `{ applied, entryCount }` so D4 can stamp `transcript.entry_count`.
- **Infrastructure — auth helpers:** `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts` (HMAC-SHA256 issue/verify, `timingSafeEqual`, ADR-017 idiom, new `ELEVENLABS_SESSION_TOKEN_SECRET` env var). `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` (parses `ElevenLabs-Signature: t=…,v0=…` against raw body bytes, `timingSafeEqual` against `ELEVENLABS_WEBHOOK_SECRET`). Both use `node:crypto` only — no new npm dependency.
- **Infrastructure — ElevenLabs adapter group:** `conversational-provider.ts` builds the `@elevenlabs/elevenlabs-js` client handle and reads `ELEVENLABS_AGENT_ID` (kept strictly separate from the sandwich `provider.ts` which retains the deprecated `elevenlabs@^1.59.0` package). `elevenlabs-conversational.service.ts` implements `IConversationalAgentService`: `issueSignedUrl` passes `includeConversationId: true` for single-use URLs (spike surprise #7); `Result.tryAsyncCatch` wraps SDK throws and translates them to the application-layer error classes (`ConversationalSignedUrlFailedError` / `ConversationalTranscriptFetchFailedError`) — no `.agents.create(` or `.agents.delete(` anywhere. `agent-config-assertion.ts` is a boot-time adapter that calls `agents.get(agentId)` and verifies the three allow-list flags from spike surprises #1/#2 (`platformSettings.overrides.enableConversationInitiationClientDataFromWebhook === true`, `…conversationConfigOverride.agent.prompt.prompt === true`, `…agent.firstMessage === true`) — fails boot on drift, preventing the silent-drop misconfiguration where overrides are dropped without an error.
- **Infrastructure — persistence:** Nullable `eleven_labs_session_id text` column added to the interviews schema; `DrizzleInterviewRepository` round-trips it through serialize / `fromSerialized`. Migration `0003_keen_bloodstorm.sql` plus its snapshot is additive ALTER only.
- **Presentation — three controllers:** `candidate-session.controller.ts` (`POST /interviews/:id/candidate-session?token=…`, candidate-signed-link gated, D1 span open-first-statement → close-in-`finally`, stamps `interview.id` + `elevenLabs.agentId` deliberately omitting `elevenLabs.sessionId` since binding hasn't happened yet). `elevenlabs-initiation-webhook.controller.ts` (`POST /webhooks/elevenlabs/initiation`, synchronous, fail-closed; D5 span stamps `interview.id` from the use-case output, `elevenlabs.conversation_id` when present in payload, `interview.initiation.override_assembled: true` on success, `error` + `error.kind` on every fail-closed path; returns the `ConversationInitiationClientDataRequestOutput` wire shape). `elevenlabs-webhook.controller.ts` (fire-and-forget routes `/session-start`, `/tools`, `/post-call`; every span opens BEFORE HMAC verification — first statement, before any `await`; verifier rejection sets `webhook.result: "signature_rejected"` and returns 401 without dispatching; tool dispatch maps `take_note`/`score_answer`/`end_call` to their use cases and `next_question` to a no-op 200 ack; post-call route correlates by `conversation_id` and reports unmatched cases as HTTP 200 with `webhook.result: "use_case_error"` + `error.kind: "INTERVIEW_NOT_FOUND"` on the span per the ADR-031 dual contract; D4 `interview.session.transcript-persist` is opened as a child of D3 and stamps `transcript.entry_count` on success).
- **Presentation — route plugins:** `candidate-session.routes.ts`, `webhooks/elevenlabs-initiation-webhook.routes.ts`, `webhooks/elevenlabs-webhooks.routes.ts`. The two webhook plugins each install a scoped `addContentTypeParser` capturing `req.rawBody` so HMAC verifies the signed bytes — not Fastify's re-serialized JSON. Webhook routes do **not** inherit the `better-auth` pre-handler.
- **Composition:** Three new composition files — `candidate-session.composition.ts`, `elevenlabs-initiation-webhook.composition.ts`, `elevenlabs-webhook.composition.ts` — wire the use cases, repositories, services, verifier, token issuer, and (for the post-call route) the resolver that maps `conversation_id` back to an interview id. `apps/backend/src/app.ts` registrations are strictly additive; the sandwich WS block is unmodified.
- **Env / package:** `apps/backend/.env.example` documents three new fail-fast boot env vars (`ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_SESSION_TOKEN_SECRET`); deployments missing any of the three throw `Boot failed: …` at composition time, matching the existing `CANDIDATE_LINK_SECRET` and `BETTER_AUTH_SECRET` pattern. `apps/backend/package.json` adds `@elevenlabs/elevenlabs-js` for the conversational path; the sandwich TTS keeps `elevenlabs@^1.59.0` so the two SDK clients never share a handle.
- **Tests:** Seven new application use-case test files (one per use case) replace the originally-batched `elevenlabs-conversation.use-cases.test.ts`. Three new controller test files replace the batched `phase-9-5-elevenlabs.controllers.test.ts` and total 63 cases including the OTel span-attribute coverage added during the second revision pass (`vi.spyOn(trace, "getTracer")` plus `vi.resetModules()` + dynamic re-import to defeat the module-cached `ProxyTracer`). Infrastructure tests cover HMAC verifier (tampered body, missing/malformed header, length mismatch, fail-fast on short secret), correlation token (issue/verify round-trip, tamper, expiry, wrong secret), conversational provider (env fail-fast), conversational service (mocked SDK; `includeConversationId: true` assertion; SDK throws → typed boundary errors; transcript role mapping `agent`/`user` → `SPEAKER.AGENT`/`SPEAKER.CANDIDATE`), and the agent-config assertion adapter (each of the three allow-list flag misses + transient SDK error). The domain entity test was extended with the new `bindElevenLabsSession()` block.
- **ADR clarifying edits (mid-implementation, both in-flight `Proposed` status):** ADR-032 D1 attribute matrix corrected to drop `elevenLabs.sessionId` from the success-path table — the session id does not exist at signed-URL issuance time (verified against `ConversationSignedUrlResponseModel` in `@elevenlabs/elevenlabs-js@2.49.1`), binds asynchronously in the initiation webhook, and therefore first appears on D5 (as `elevenlabs.conversation_id`) and on D2/D3/D4. ADR-031's fire-and-forget paragraph extended to document the dual HTTP-200/span-truthful contract on unmatched `conversation_id`: the HTTP layer is idempotent (200 to suppress redelivery), the span layer is truthful (`webhook.result: "use_case_error"` + `error.kind: "INTERVIEW_NOT_FOUND"`). Both edits pass the four ADR-kit gates (Completeness / Evidence / Clarity / Consistency).

Explicitly **not** included in this work:

- Frontend changes. `apps/web` is untouched; the Phase 9 voice-pipeline assets (`AudioPlaybackQueue`, `pcm-downsampler.js`, the WebSocket lifecycle in `InterviewSessionContainer/`) become dead code on the primary conversational path but remain runnable on the retained sandwich. A future frontend phase will swap `InterviewSessionContainer` to the ElevenLabs React SDK.
- Reconciliation / timeout sweep for interviews stuck `IN_PROGRESS` when the post-call webhook never arrives — deferred to Phase 10 per ADR-031's risk register; transcript is re-pullable from the ElevenLabs API using the stored `elevenLabsSessionId`.
- Workspace-level webhook provisioning. The post-call webhook is workspace-scoped (spike surprise #6) and is configured manually via the ElevenLabs dashboard or CLI — the `ELEVENLABS_WEBHOOK_SECRET` is persisted from the workspace-webhook create response, not minted in code.
- The three deferred reviewer items from the first review pass (kept as known carryovers): narrowing `InterviewIdResolverLike.findByElevenLabsSessionId` return shape to `Option<string>` and dropping the controller's defensive `getInterviewId(...)` branch; tightening `WebhookVerifierLike.verify` to accept `string | Buffer`; removing the cross-layer re-exports in `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts`. All three are functionally correct; deferred for a separate revision.
- The end-to-end live-validation gate (see Notes).

---

## Implementation Notes

**SDK contract verification reshaped the plan, not the ADRs.** The first plan draft assumed per-session overrides could be passed at signed-URL issuance time. Static type inspection of `ConversationsGetSignedUrlRequest` in `@elevenlabs/elevenlabs-js@2.49.1` proved that path does not exist — the call accepts only `{ agentId, includeConversationId?, branchId?, environment? }` and returns `{ signedUrl }`. The corrected mechanism (synchronous initiation webhook returning `ConversationInitiationClientDataRequestOutput`) is the ElevenLabs-intended secure path for server-side override delivery. This finding drove ADR-030's and ADR-031's revisions before the plan regen.

**Silent-drop trap from spike surprises #1/#2.** `enableConversationInitiationClientDataFromWebhook` lives in `platformSettings.overrides` (not in `conversationConfig`), and the boolean allow-list `platformSettings.overrides.conversationConfigOverride` must include `agent.prompt.prompt = true` and `agent.firstMessage = true` or the webhook's override payload is silently dropped — no error, no warning. The boot-time `agent-config-assertion.ts` adapter is the explicit countermeasure: it calls `agents.get(agentId)` once at composition time and asserts all three flags, failing boot on any miss. This is the highest-leverage defensive guard in the phase because the failure mode would otherwise present as a perfectly healthy session that simply ignores the recruiter's interview content.

**`end_interview` is the built-in `end_call` system tool, not a custom webhook tool.** Per spike surprise #5, only a system tool can cleanly terminate the LiveKit session. The static agent is configured with three custom tools (`next_question`, `score_answer`, `take_note`) plus the built-in `end_call` system tool; when the agent invokes `end_call`, the tools webhook receives the payload and the controller maps it to `EndInterviewFromAgentUseCase`. The aggregate is **not** completed by this path — only the post-call webhook (with the authoritative final transcript) drives `IN_PROGRESS → COMPLETED`.

**The two ElevenLabs SDK clients live in separate files and never share a handle.** The sandwich TTS path keeps `elevenlabs@^1.59.0` in `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` and `elevenlabs-tts.service.ts`. The conversational path uses `@elevenlabs/elevenlabs-js` exclusively in `conversational-provider.ts`, `elevenlabs-conversational.service.ts`, and `agent-config-assertion.ts`. The two packages coexist without type-name collisions because import sites are scoped and the conversational adapter does not import from the sandwich provider.

**Two ADR-vs-code drifts surfaced during the second review pass were resolved in the docs, not the code.** ADR-032's D1 attribute matrix originally listed `elevenLabs.sessionId` on the success path, but the implementation correctly does not stamp it: `StartCandidateSession` has no session id to stamp at that surface (binding happens later, in the initiation webhook). ADR-031 originally did not document the dual idempotency contract on unmatched `conversation_id` — HTTP 200 to suppress redelivery, but `webhook.result: "use_case_error"` on the span to keep the event observable in Langfuse. Both ADRs are still in `Proposed` status, so the edits are clarifying refinements rather than supersessions. ADR-kit's four gates were manually verified post-edit since `bin/adr-lint` is not installed in this repo yet (the `/adr-kit:init` step is pending).

**Plan-vs-implementation small variance worth recording.** The plan called for a single batched test file per layer; the codebase convention (visible in `conduct-interview.use-case.test.ts`, `create-interview.use-case.test.ts`, etc.) is one test file per source file. The test-generator split the seven batched application use-case tests and three batched controller tests into ten per-target files before the first code review; the original two batched files were deleted. No semantic test coverage was lost in the split.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Results:

- domain type-check: **0 errors**
- application type-check: **0 errors**
- backend type-check: **0 errors**
- domain tests: **148 passed** (12 test files)
- application tests: **202 passed** (26 test files), plus 1 pre-existing failure unrelated to Phase 9.5 (`create-interview.dto.test.ts`, `z.date()` vs ISO-string coercion)
- backend tests: **312 passed** (33 test files), plus 18 pre-existing failures unrelated to Phase 9.5 (all `ECONNREFUSED` from the two Drizzle repository tests because no local Postgres is running in this sandbox: `drizzle-interview.repository.test.ts`, `drizzle-report.repository.test.ts`)

Phase 9.5-targeted test counts (subset of the above):

- 7 new application use-case test files
- 3 new controller test files: `candidate-session.controller.test.ts` (14), `elevenlabs-initiation-webhook.controller.test.ts` (16), `elevenlabs-webhook.controller.test.ts` (33) — **63 controller cases**
- 5 new infrastructure test files (conversation-correlation-token, elevenlabs-webhook-verifier, conversational-provider, elevenlabs-conversational.service, agent-config-assertion) — all passing
- Domain entity test extended with the new `bindElevenLabsSession()` block — 5 added cases

Cleanup checks (confirming the two batched test files were deleted in the split and have no dangling references):

```bash
rg --type ts "elevenlabs-conversation.use-cases|phase-9-5-elevenlabs.controllers" packages apps
```

Result: no matches; both batched files removed cleanly.

Architecture checks (manual, since `bin/adr-lint` and the adr-kit pre-commit hook are not installed in this repo yet):

- `rg --type ts "\.agents\.create\(|\.agents\.delete\(" apps/backend/src` — no matches (ADR-030 declarative forbid satisfied).
- `rg --type ts "ELEVENLABS_WEBHOOK_SECRET" apps/backend/src/presentation/routes/webhooks` — no matches; only the verifier in `infrastructure/auth/` reads the secret (ADR-031 declarative forbid satisfied).
- `rg --type ts "@elevenlabs/" packages/application` — no matches; no SDK leaks into the application layer.
- Sandwich files (`conduct-interview.use-case.ts`, `interview-session.controller.ts`, `interview-session.ws.ts`, `voice-websocket.ts`, `async-queue.ts`, `interview-session.composition.ts`, `provider.ts`, `elevenlabs-tts.service.ts`, the Deepgram adapter group) confirmed unmodified.

---

## Code Review

`backend-code-reviewer` first-pass result: **REVISION REQUIRED** — 2 blockers, 3 should-fix, 2 nits.

- **Blocker 1** — `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts:12-34` re-declared `ConversationalAgentError`, `ConversationalSignedUrlFailedError`, and `ConversationalTranscriptFetchFailedError` locally, shadowing the same-named classes exported from `@repo/application`. `instanceof` checks in downstream consumers (which correctly import from `@repo/application`) would have returned `false` at runtime. Fixed by importing the concrete classes from `@repo/application`, deleting the three shadow declarations, and updating `apps/backend/src/infrastructure/services/elevenlabs/index.ts` to re-export them from `@repo/application`. Adapter test imports updated to match.
- **Blocker 2** — `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts:18-22` omitted `interviewId` from `AssembleInitiationOutput`, so the controller's `if (ctx.interviewId) span.setAttribute("interview.id", ctx.interviewId)` guard at `elevenlabs-initiation-webhook.controller.ts:74-76` was dead code and the D5 span never carried `interview.id`. Fixed by promoting `interviewId` to a required field on the use-case output (returning `next.id` in the success branch) and switching the controller's stamp to unconditional. The five `Result.Ok({...})` mocks in the initiation-webhook controller test were updated to include `interviewId: "interview-001"` so they stay consistent with the now-non-optional contract.
- **Should-fix #3** — `packages/domain/src/entities/interview/interview.entity.ts:183` constructed `new InvalidInterviewStateTransitionError(this.status, this.status)` on rejected `bindElevenLabsSession`, producing nonsensical error messages like "Cannot transition from COMPLETED to COMPLETED". Fixed by passing `INTERVIEW_STATUS.IN_PROGRESS` as the target state so the message reflects the gating intent.
- **Should-fix #4** — The three new controller test files asserted HTTP shape and use-case dispatch but did not assert OTel span attributes, even though ADR-032 names them in the rubric. Fixed by adding 23 new `it()` blocks (5 in candidate-session, 4 in initiation, 14 in the webhook controller) using a `vi.spyOn(trace, "getTracer")` + `vi.resetModules()` + dynamic-import pattern that defeats the module-cached `ProxyTracer`. Spans-attribute coverage now includes signature-rejected / ok / use_case_error matrix for D2, `transcript.entry_count` on D4 success and `error.kind` on D4 failure, and the conditional `elevenlabs.conversation_id` stamp on D5.
- **Should-fix #5** (resolver narrowing), **Nit #6** (verifier signature `string` vs `string | Buffer`), **Nit #7** (cross-layer re-exports of `@repo/application` types from `infrastructure/auth/conversation-correlation-token.ts`) — deferred by user choice for a separate revision; carryovers acknowledged in the second review pass.

`backend-code-reviewer` second-pass result: **PASS**.

The reviewer additionally surfaced two source-vs-rubric drifts that I confirmed deliberate (D1 deliberately omits `elevenLabs.sessionId` because it isn't available at that surface; D3 deliberately stamps `webhook.result: "use_case_error"` on unmatched `conversation_id` while still returning HTTP 200). Both notes were folded back into the ADRs after the second pass cleared — ADR-032 D1 matrix amended and ADR-031 fire-and-forget paragraph extended.

---

## Live-Validation Gate (partial run, 2026-05-25)

A first live-validation pass was attempted against a real ElevenLabs Conversational AI agent. Setup, scripts, and harness used are checked in under `apps/backend/scripts/live-validation/`. **Throwaway resources have been cleaned up** (agent deleted, workspace baseline cleared, seeded interview row deleted, .env reverted), with one residual: three tool IDs are pinned by the deleted agent's lingering branch metadata; ElevenLabs has no branch-deletion endpoint (405), they'll GC eventually or can be purged from the dashboard. IDs are in `apps/backend/scripts/live-validation/.artifacts.json` for reference.

### What ran end-to-end

| Surface | Verdict | Evidence |
|---|---|---|
| Backend boots with all three new env vars (`ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_SESSION_TOKEN_SECRET`) and `assertElevenLabsAgentConfig` runs against the real agent | ✅ **LIVE PASS** | Backend reached `Server listening` cleanly with the assertion enabled in `candidate-session.composition.ts:45`. **First live confirmation that the spike-#1/#2 silent-drop guard works end-to-end against the real ElevenLabs API.** |
| `StartCandidateSession` happy path: real Drizzle row → `IConversationalAgentService.issueSignedUrl` → correlation-token mint → 200 `{ signedUrl, sessionToken }` | ✅ **LIVE PASS** | Two successful POSTs at `~800 ms` each (req-5, req-8); browser SDK accepted the URL and started a conversation against ElevenLabs LiveKit |
| Conversation actually reaches ElevenLabs and the agent loop fires | ✅ **LIVE PASS** | Tool webhooks arrived from ElevenLabs egress IP `34.59.11.47` with `User-Agent: ElevenLabs/1.0` |
| **Gate check (a)** — initiation webhook actually fires at session start | ❌ **FAIL** | Zero `/webhooks/elevenlabs/initiation` requests via ngrok across two runs (with workspace baseline + agent override both set with `enable_conversation_initiation_client_data_from_webhook: true`). Root cause unidentified within this session |
| **Gate check (b)** — prompt override honored | ❌ **FAIL** (downstream of a) | First message was the placeholder; agent had no knowledge of `Test Candidate` / `Sift` — because the initiation webhook never fired, the override never reached the agent |
| **Gate check (c)** — `correlation_token` surfaces in `dynamic_variables` | ❌ **UNTESTABLE** (downstream of a) | No initiation request body ever delivered |
| **Gate check (d)** — `end_call` dispatches to `/tools` | ❌ **FAIL** | Three tool webhooks arrived, all with empty `{}` bodies and no tool-name discriminator (no body field, no path param, no header). Cannot distinguish which tool fired. System tools like `end_call` may not dispatch a webhook at all |

### Spike findings beyond the original 7 (load-bearing — these reshape the implementation)

1. **Per-tool URL discrimination, not body-field discrimination.** Tool webhook bodies carry only the tool's parameters — no `tool_name` field anywhere. URI, headers, body — none reveal which tool fired. ADR-031 + `elevenlabs-webhook.controller.ts` assume `payload.tool_name` exists. Reality: each tool's `apiSchema.url` must encode the discriminator (e.g. path param like `/webhooks/elevenlabs/tools/next_question` or query string).
2. **Tool webhooks are NOT HMAC-signed by default.** All three tool POSTs arrived with no `elevenlabs-signature` header and got 401-rejected by our verifier. Per-tool HMAC requires explicit `apiSchema.requestHeaders` config. ADR-031's "all fire-and-forget webhooks are HMAC-verified" claim must narrow to lifecycle webhooks only, OR each custom tool must be provisioned with explicit HMAC headers.
3. **System tools may not dispatch webhooks at all.** `end_call` is `type: "system"` (per SDK `BuiltInToolsInput.endCall`); the implementation assumed it would dispatch a fire-and-forget tool webhook. Live evidence is inconclusive but suggestive: nothing arriving at `/tools` looked like an `end_call`, and the conversation ended without a recognisable post-call signal. `EndInterviewFromAgentUseCase`'s dispatch path may be unreachable; the end reason might only be available in the post-call/transcript webhook payload.
4. **Two distinct API key scopes for two workspace webhook surfaces.** Setting workspace-level `conversation_initiation_client_data_webhook` via `PATCH /v1/convai/settings` works with `convai_write`. Creating workspace-level *post-call* webhooks via `POST /v1/workspace/webhooks` requires a separate `webhooks_write` scope (which the project key currently lacks). The ops setup checklist needs both scopes when post-call/transcript handling is required.
5. **`workspace_overrides.conversation_initiation_client_data_webhook` on a per-agent config is an *override* of a workspace baseline, not a primary setting.** Without a workspace-level baseline configured at `/v1/convai/settings`, the per-agent override does nothing — even with `enable_conversation_initiation_client_data_from_webhook: true`. The ops setup checklist needs a `PATCH /v1/convai/settings` step.
6. **Initiation webhook still didn't fire after setting the workspace baseline** (correctness #5 alone was not enough). Cause unidentified — needs ElevenLabs docs reading or support dialog. Hypotheses: (a) browser-supplied `dynamicVariables` may suppress the webhook ("client already gave me data" interpretation), (b) per-agent override may interfere with the workspace baseline, (c) some other prerequisite flag is missing. **This is the highest-priority unknown and blocks ADR-030/031's core mechanism.**

### Secondary backend hardening finding (not a Phase 9.5 deliverable, worth recording)

Domain `fromSerialized` paths can throw synchronously and bypass the controller's `Result`-based error mapping, leaking as unhandled Fastify 500s (observed: `TypeError: data.education is not iterable` from a misshapen seed row produced a 500, not the documented `RepositoryError → ServiceUnknownError` translation). The serialization boundary needs a `Result.tryCatch` wrapper before this is candidate-facing.

### Implications for source

The gate did not produce a green light. Likely source-level revisions following the next spike pass:

- `elevenlabs-webhook.controller.ts` — route shape change from "one `/tools` URL + body discriminator" to "per-tool URL with name in path/query"; matching adjustment of the per-tool URLs provisioned in the agent config.
- `ElevenLabsWebhookVerifier` use scope — narrow to lifecycle webhooks only, OR provision custom HMAC headers on each tool's `apiSchema.requestHeaders`.
- `EndInterviewFromAgentUseCase` — probably refactored away (or moved to a sub-step inside `PersistCompletedTranscriptUseCase` reading the end reason from the post-call payload).
- ADR-031 — amend "fire-and-forget HMAC-verified" claim with the per-tool scope reality; add the dual-webhook configuration requirement (workspace baseline + per-agent override).
- Ops setup checklist — workspace baseline `conversation_initiation_client_data_webhook`, plus `webhooks_write` scope on the API key, plus the workspace post-call webhook provisioning step.
- ADR-030 — possibly revisit if check (c) ultimately fails: the `correlation_token` mechanism may need an alternative channel (e.g. a per-tool URL path param carrying a short-lived token bound to the conversation_id).

### Status after this run

- All four ADRs (029/030/031/032) remain **`Proposed`** (correctly).
- Implementation is **not committed**; commits remain deferred.
- A follow-up spike is required to resolve the open mechanisms before flipping ADRs to Accepted. A hand-off prompt for the next agent is in `docs/spikes/phase-9-5-followup-spike-prompt.md`.

---

## Notes

- **Live-validation gate.** Partial run completed 2026-05-25; see the "Live-Validation Gate (partial run)" section above for the 1 PASS / 3 FAIL outcome and the six new spike findings. Gate remains **not passed**; a follow-up spike is required.
- **ElevenLabs API key scope (updated).** Current `.env` key has `convai_write` (verified by successful agent + tool create) but **lacks `webhooks_write`** (verified by 401 `missing_permissions` on `POST /v1/workspace/webhooks`). Workspace-level post-call webhook provisioning needs the second scope added before the next spike run.
- **ADR pre-commit gate behavior at commit time.** ADR-029 has `llm_judge: true`, so the pre-commit hook will surface an advisory line on any voice-path diff; resolve in-session via `/adr-kit:judge`. ADR-030's declarative `forbid_pattern` for `.agents.create(` and `.agents.delete(` was confirmed satisfied by `rg`; no commits in this phase should trigger that rule. Note: `bin/adr-judge` is not installed in this repo yet — running `/adr-kit:init` would install it before the first commit.
- **Open SDK contract questions (updated after the partial run).** Resolved live: workspace baseline initiation webhook lives at `PATCH /v1/convai/settings` with `convai_write` scope; per-agent `workspace_overrides` is an override of that baseline. Still open: (a) what additional configuration makes the initiation webhook actually fire when both baseline + agent override + enable-flag are set; (b) the dispatch shape and webhook channel for the built-in `end_call` system tool; (c) the wire field-name casing for `conversation_id` in initiation payloads (still unobserved because the webhook never fired); (d) whether browser-supplied `dynamicVariables` suppress the initiation webhook.
- **Deferred follow-up items.** Resolver narrowing on `InterviewIdResolverLike.findByElevenLabsSessionId` (`apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts:29-38`) plus removing the defensive `getInterviewId(...)` branch; `WebhookVerifierLike.verify` signature widening to `string | Buffer`; removing the two cross-layer re-exports at `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts:9-10`. None block correctness; all are batchable into a small cleanup revision.
- **Documentation drift watchlist.** ADR-032's D1 description still characterizes `StartCandidateSession` as "creates an ElevenLabs agent, sets the interview configuration"; this is residual phrasing from before ADR-030 locked in the static-agent model. The D1 attribute matrix is now correct; the prose around it could use a future polish pass when the four ADRs flip from `Proposed` to `Accepted`.
