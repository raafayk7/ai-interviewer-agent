# Phase 9 — Candidate Frontend Progress

## Phase 9 — Candidate Frontend Complete

This document records the Phase 9 changes for the ai-interviewer-agent monorepo.

Phase 9 goal:

- Ship the candidate-side web experience: five new routes under `/c/[id]` (landing, pre-interview check, live interview session, post-interview thank-you, and error fallbacks) under a new `(candidate)` route group with zero recruiter chrome
- Implement the full WebSocket voice pipeline frontend: AudioWorklet-driven linear16 uplink at 16 kHz, MediaSource-backed MP3 downlink, exponential reconnect (250 ms → 4 s cap, 60 s window, max 10 attempts), and the DESIGN.md §7 connection-loss choreography
- Build the orb-driven `VoicePresence` composite plus three supporting composites (`TranscriptFeed`, `MicLevelMeter`, `ConnectionLossBanner`) inside `@repo/ui`
- Add the candidate-bound HTTP service against the Phase 9-prep backend endpoint `GET /interviews/:id/candidate-view?token=…`, with HMAC token verification per ADR-017
- Hold the line on the layered architecture: routes as Server Components, containers as the first `"use client"` boundary, services as the only `fetch()` site (plus one documented Server-Component-only carve-out), Zustand for session/mic-check UI state, TanStack Query for the post-interview polling

Plan source: `.claude/plan/phase-9-candidate-frontend.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — HMAC signed candidate link (consumed at the page/service boundary; 7-day TTL)
- [ADR-019](../adr/ADR-019-ownership-checks-in-presentation-not-application.md) — 404 over 403/409 (drives the `invalid-link` collapse of 401/404 in `viewLoadToErrorKind`)
- [ADR-021](../adr/ADR-021-adopt-zustand-for-frontend-client-state.md) — Zustand 5 for UI state only (`useInterviewSessionStore`, `useMicCheckStore`)
- [ADR-022](../adr/ADR-022-use-tanstack-query-for-frontend-server-state.md) — TanStack Query 5 for server data (`usePostInterview` polling)
- [ADR-023](../adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) — shadcn/Radix/Tailwind v4 component system
- [ADR-024](../adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) — React Hook Form 7 + Zod 4 (consumed for response validation; no new RHF forms in this phase)
- [ADR-026](../adr/ADR-026-orb-halo-as-a-fenced-composite-token.md) — orb halo as a fenced composite token (drives `--orb-core`, `--orb-halo` usage inside `VoicePresence` only)
- [ADR-028](../adr/ADR-028-v2-palette-refresh.md) — v2 palette refresh (cream primary, petrol candidate-voice, restricted accent for the orb)

---

## Summary

Completed:

- **Types (`apps/web/src/types/`):** `CandidateInterviewViewSchema` mirrors the new backend wire shape (`interviewId`, `candidateName`, `jobTitle`, `company`, `scheduledAt` via `z.coerce.date()`, `targetDurationMinutes` nullable, `status`). Lifted `isTerminalStatus(status)` (backed by a `ReadonlySet<InterviewStatus>`) into `interview-status.types.ts` so both `useCandidateLanding` and `usePostInterview` consume a single source.

- **Env (`apps/web/src/lib/env.ts`):** Extended the Zod schema with `NEXT_PUBLIC_WS_URL` (validated as `ws://` or `wss://`). Local default added in `.env.local`.

- **Services (`apps/web/src/services/`):** Extracted the shared HTTP helper into `_request.ts` (Zod-validating wrapper returning `Result<T, ServiceError>`, parameterised by `credentials` and `authStatuses`). `interview.service.ts` refactored to consume it with `credentials: "include"` and default `[401, 403]` auth statuses. New `candidate.service.ts` exposes `getCandidateInterviewView({ interviewId, token })` with `authStatuses: [401]` only — 403 deliberately collapses to `SERVER` (token-only auth, no cookie surface).

- **Server-only fetch carve-out (`apps/web/src/lib/candidate-fetch.ts`):** `loadCandidateView(id, token)` returns a tagged `CandidateViewLoad` union (`ok | invalid-link | interview-not-found | network`). Mirrors the documented carve-out pattern from `lib/auth.ts` because Server Components cannot import `"use client"` service files. Companion `viewLoadToErrorKind()` helper collapses 401/404 to `"invalid-link"` per ADR-019.

- **Stores (`apps/web/src/stores/`):** `useInterviewSessionStore` (connection state machine `idle → connecting → connected → reconnecting → completed | interrupted | error`, speaker, mic-mute, transcript visibility persisted to localStorage, transcript buffer, reconnect-attempt count, and a throttled `audioLevel` 0..1). `useMicCheckStore` (permission state, RMS level, test outcome). Every setter carries a no-op guard (`set((cur) => cur.x === v ? cur : { x: v })`) so per-frame mic-RMS pushes and per-chunk speaker updates don't notify subscribers when nothing changed.

- **Cross-app composites (`packages/ui/src/composites/`):**
  - `VoicePresence` — the orb. `state: "idle" | "listening" | "thinking" | "speaking"`, `audioLevel?: 0..1`, `tone?: "default" | "warning"`. `forwardRef`, `motion-safe:` halo keyframe, `--orb-core` / `--orb-halo` / `--ai-thinking` / `--attention-warning` token plumbing. Speaking maps RMS to a 0.96..1.06 transform-scale envelope with 80 ms ease-out.
  - `TranscriptFeed` — stacked transcript lines, two-tone (`text-transcript-candidate` cool / `text-transcript-ai` warm), `caption`-style speaker labels, hover-revealed mono timecodes, `aria-live="polite"`.
  - `MicLevelMeter` — 3 px bar, max-width 360 px, `bg-voice-active` at 0.7 opacity, `role="meter"` with `aria-valuemin/max/now`.
  - `ConnectionLossBanner` — slide-down banner per DESIGN.md §7, three states (`reconnecting | reconnected-resuming | failed`), shimmer progress nub on reconnecting, `bg-attention-warning/90` only (no `--destructive`).

- **App-specific components (`apps/web/src/components/`):** `CandidatePageShell` (centred max-w-720 frame on `bg-background`); `CandidateErrorScreen` (six kinds — `invalid-link`, `expired-link`, `interview-not-ready`, `mic-denied`, `session-interrupted`, `network` — driven by a copy lookup table; `<h1>` via `CardTitle as="h1"`); `Toaster` (Sonner wrapper, dark theme, top-center, semantic-token classNames).

- **Containers (`apps/web/src/containers/`):** Four containers, each in the mandatory three-file pattern.
  - `CandidateLandingContainer` — pure view-model hook returning `greeting`, `jobLine`, `scheduledLine`, `durationLine`, `ctaEnabled` (gated on `status === "SCHEDULED"`), `blockedReason` (driven by a `BLOCKED_COPY` lookup table keyed by `InterviewStatus`).
  - `PreInterviewCheckContainer` — four-step state machine (`mic → audio → quiet → ready`). Step 1 wraps `getUserMedia` + AudioContext analyser + RAF tick, marks the mic test "passed" once RMS > 0.05. Step 2 doubles as a browser-compat probe — if `<audio>.play()` rejects or the element stays at `currentTime === 0` after 3 s the step transitions to `browser-unsupported` and surfaces "Try Chrome, Edge, or Firefox" copy (resolves plan risk #6 without UA sniffing). Step 4 writes the transcript-visible preference to localStorage and links to `/c/[id]/session?token=…`.
  - `InterviewSessionContainer` — the voice pipeline. The `useInterviewSession` hook owns the WebSocket lifecycle, the AudioWorklet uplink, the `AudioPlaybackQueue`, the exponential reconnect with a 60 s window and a 2 s UI-delay before flipping the connection state to `reconnecting` (DESIGN.md §7 micro-drop policy), and the terminal `interrupted` transition on close code `1008` / window expiry. Container is a thin shell that runs `deriveOrb()` + `deriveBanner()` helpers off the connection-state and speaker; subscribes to the throttled store-backed `audioLevel` so the orb scale + mic-meter width are reactive without per-chunk re-renders.
  - `PostInterviewContainer` — TanStack Query polling at 30 s, capped at 5 polls or terminal status (`COMPLETED | EVALUATED`) via `isTerminalStatus`. Renders "Thanks, you're done." copy in the terminal state, "Wrapping up…" otherwise.

- **Voice pipeline helpers (`apps/web/src/containers/InterviewSessionContainer/`):**
  - `audio-playback-queue.ts` — MediaSource-backed `audio/mpeg` SourceBuffer with a 64-chunk cap (~1–2 s) on the pending buffer (overflow drops the oldest), and a dispose hook that nulls the audio src.
  - `pcm-downsampler.js` (shipped at `apps/web/public/audio-worklet/pcm-downsampler.js`) — AudioWorkletProcessor that linear-interpolation downsamples the mic input to 16 kHz mono linear16 PCM, posts the bytes plus RMS back to the main thread.

- **Routes (`apps/web/app/(candidate)/`):** `layout.tsx` is a pure Server Component that renders `<SoftBlockScreen audience="candidate" />` + `{children}` (no token verification — Next 16 `LayoutProps` lacks `searchParams`, verified by reading `apps/web/.next/types/routes.d.ts`). Each of the four `c/[id]/...` page files is a Server Component that awaits `params` + `searchParams`, calls `loadCandidateView`, and either mounts its container or renders `CandidateErrorScreen` via the shared `viewLoadToErrorKind()` helper. `apps/web/app/layout.tsx` now mounts the `Toaster` after `QueryProvider`.

- **Tests:** Sixteen new test files across `apps/web` (eight files, 121 new tests) and `@repo/ui` (four composite suites, 358 total tests in the package). Store tests reset via `setState(initial, true)` between cases. Service test mocks `fetch` via `vi.stubGlobal` and verifies 403 maps to `SERVER` (not `AUTH`) for the candidate variant. `useInterviewSession.test.ts` mocks the `AudioPlaybackQueue` module, stubs `WebSocket`/`AudioContext`/`AudioWorkletNode`, and asserts every state-machine transition (1008 → `interrupted` terminal, non-1008 → reconnect with 2 s UI delay, attempts cap at 10, unmount closes WS with code 1000). One hermetic Playwright spec (`apps/web/e2e/candidate-error.spec.ts`) exercises the two deterministic error paths — token-missing (short-circuits before fetch) and dead-backend (ECONNREFUSED → `network` kind).

Explicitly **not** included in this work:

- Live transcript deltas during the call — current backend WS protocol only emits transcript inside the `session.completed` payload at session end; the transcript feed appears atomically when the call closes (plan risk #3)
- WebSocket session resumption / server-side reconnect bookkeeping — deferred to Phase 10
- Email delivery of candidate links — deferred per `project_email_resend_decision.md`
- Mobile candidate flow — blocked at the `SoftBlockScreen` layer (`max-width: 767px`, `pointer: coarse`)
- Tier-2 happy-path Playwright specs (candidate-landing, candidate-pre-check, candidate-session, candidate-done) — deferred to the real-backend infrastructure follow-up carried over from Phase 8 (plan risk #4)

---

## Implementation Notes

**Locked-in decisions taken before implementation start (from plan §11 "still open"):**

- `VoicePresence` exposes an explicit `tone?: "default" | "warning"` prop driven by the container's connection state. The alternative of wrapping the orb in a scoped CSS rule (recolouring `--orb-halo` from outside) would reach into the composite's internals from the container and would have been flagged by the arch-validator as a token-discipline smell.
- The AudioWorklet is shipped as JavaScript only at `apps/web/public/audio-worklet/pcm-downsampler.js`. Next 16 has no first-class TypeScript bundling for AudioWorklet modules, and maintaining a parallel TS source-of-truth file that no toolchain consumed would have been documentation rot waiting to happen. The JS file carries a contract comment at the top.
- The shared HTTP helper was extracted to `apps/web/src/services/_request.ts` and `interview.service.ts` was refactored to consume it before `candidate.service.ts` was written. Two callers is the right inflection point; deferring would have meant a third copy when the next service arrives. The candidate variant differs only in `authStatuses: [401]` (no 403) and the absence of `credentials: "include"` — both expressible as parameters.
- Each candidate page re-reads `searchParams` and re-fetches via `loadCandidateView`. Layout-level verification is not possible because Next 16's `LayoutProps` type has no `searchParams` field (confirmed by reading `apps/web/.next/types/routes.d.ts`). The plan's §8 fallback (push verification into the pages) applied. Each page is cheap (single repository read on the backend) and the duplicate boilerplate was lifted into a `viewLoadToErrorKind()` helper.

**Render storm on per-chunk store writes (caught by `/simplify`):** The first cut of `useInterviewSession` parked the audio level in a `useRef` and read `audioLevelRef.current` directly in JSX. That was both a correctness bug (refs don't trigger re-renders, so the orb scale and mic-meter would never animate) and a perf bug — the only thing triggering re-renders was `setSpeaker("ai")` firing on every binary MP3 chunk at ~25–50 Hz. Fix landed in two parts: (1) `useInterviewSessionStore.audioLevel` is now a reactive store field with an epsilon-guarded setter (changes under 0.01 are dropped); (2) the worklet → store push is throttled to ~15 Hz via `AUDIO_LEVEL_INTERVAL_MS = 67`. Every setter in both stores now carries a no-op guard so the same render-storm class can't reappear.

**Real bug found in /simplify:** `PreInterviewCheckContainer.tsx` mic-passed copy was using `you&rsquo;re` inside a JS string literal — that's an HTML entity, but the string is not JSX text, so React rendered the literal characters `&rsquo;` instead of an apostrophe. Replaced with the Unicode `'`.

**Bounded `AudioPlaybackQueue` pending:** The first draft punted on backpressure. ElevenLabs streams MP3 at ~16 KB/s; if the tab is backgrounded for thirty seconds the queue would grow ~480 KB. Not catastrophic, but the cap at 64 chunks (~1–2 s of audio, drop-oldest on overflow) prevents the pathological case where a frozen `SourceBuffer` plus a bursty WebSocket stack memory.

**Step 2 doubles as a browser-compat probe:** Most evergreen browsers support `MediaSource.addSourceBuffer("audio/mpeg")` but Safari historically required `audio/mp4`. Instead of UA-sniffing up front, the pre-interview audio test detects the failure mode by transitioning `audioTestState` to `"browser-unsupported"` if `<audio>.play()` rejects, the element fires `error`, or `currentTime` stays at 0 after 3 s. The candidate self-redirects before the live interview starts. Inherits the same `<audio>` + `MediaSource` stack used during the session, so anyone who passes Step 2 will work in the live interview too.

**Sift voice sample shipped:** The audio-test step plays `apps/web/public/sift-sample.mp3` — a 52 KB MPEG layer III file at 128 kbps / 44.1 kHz mono, matching the `mp3_44100_128` format streamed by ElevenLabs during the live session. Generated post-implementation via the ElevenLabs REST API using the same voice (`EXAVITQu4vr4xnSDxMaL`) and model (`eleven_turbo_v2_5`) the backend uses, with the text *"Hi, I'm Sift. If you can hear me clearly, your speakers are ready."* — short, second-person, calm tone consistent with the Quiet Signal voice. Asset is checked in; no runtime generation.

**Half-duplex turn-taking (post-implementation fix):** The first cut of `useInterviewSession` left the mic hot 24/7 and only ever called `setSpeaker("ai")` (never back to `"candidate"`). Live testing exposed the classic echo loop — laptop speakers played the AI's MP3, the laptop mic captured it, Deepgram transcribed the AI's own voice as candidate speech, and Gemini responded to its own previous output ("the AI proceeded to speak on behalf of me"). Fix landed in three parts: (1) `getUserMedia` now explicitly requests `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true` — these aren't reliably defaulted across browsers/hardware. (2) `aiSpeakingRef` ref + `aiTurnEndTimerRef` watchdog implement strict half-duplex — every binary chunk sets `aiSpeakingRef.current = true` and resets an 800 ms silence timer; when the timer expires, mic un-mutes and `speaker` flips back to `"candidate"`. (3) The AudioWorklet handler now early-returns when `aiSpeakingRef.current` is true, so no PCM frames are sent upstream during AI speech. Tradeoff: no barge-in (candidate can't interrupt the AI by talking over it) — acceptable for v1 since the backend WS protocol has no `turn.start`/`turn.end` frames to coordinate barge-in cleanly. The 800 ms threshold accounts for MP3 playback drainage after the server stops sending chunks. `useInterviewSession.test.ts` updated to assert the new `getUserMedia` constraint shape.

**Playback teardown on terminal close (post-implementation fix):** After the half-duplex fix landed, live testing surfaced a second issue — when the backend closed the WS with 1008, the `AudioPlaybackQueue` kept draining its `SourceBuffer`, so the AI's already-streamed audio continued to play out of the speakers after the toast appeared. Fix: extracted a `stopPlayback()` helper that disposes the queue and nulls the ref, and called it from both terminal close branches (1008 POLICY_VIOLATION and the reconnect-exhausted branch). Also surfaced the **actual backend close reason** in the toast (`"Your session ended: <reason>"`) instead of always saying "invalid credentials", and added a `console.info('[session] WS closed code=… reason=… wasClean=…')` log on every close for diagnostic visibility.

**Backend: silent candidate turn handling (post-implementation fix):** With the half-duplex fix in place, the candidate's silence stopped being masked by echo — and immediately exposed a backend correctness bug. `ConductInterview` called `TranscriptEntry.create({ text: finalTextResult.unwrap() })` directly with whatever Deepgram returned. When the candidate was silent, Deepgram returned `""`, which violated the `TranscriptEntry.text must not be empty` domain invariant. The resulting `InvalidInterviewInputError` (code `INVALID_INTERVIEW_INPUT`) mapped to WS close 1008 — *the entire interview died on a single silent turn*. Fix in `packages/application`: (1) added `CANDIDATE_SILENT: "candidate_silent"` to the `END_INTERVIEW_REASON` enum. (2) `conduct-interview.use-case.ts` now declares `MAX_CONSECUTIVE_SILENT_TURNS = 3` and a `consecutiveSilentTurns` counter. (3) Before calling `TranscriptEntry.create`, the use case checks `if (!candidateText.trim())` — on empty: increment the counter, end gracefully with `endReason = CANDIDATE_SILENT` if the cap is hit, otherwise `turnIndex += 1; continue;` so the agent re-runs with the same history and naturally re-prompts. On non-empty: counter resets and the original recording flow runs.

**Token freshness on reconnect (plan risk #7):** HMAC candidate tokens carry a 7-day TTL (ADR-017). A reconnect that occurs near the boundary may succeed on the first try and fail on the next — the WS close code `1008` then drives the terminal `interrupted` state with the "invalid credentials" toast. Accepted because in practice it requires a candidate to be within minutes of their token expiry when the interview starts, which is recruiter-side mis-scheduling.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web --filter=@repo/ui
pnpm --filter web exec playwright test e2e/candidate-error.spec.ts
```

Results:

- web type-check: **0 errors**
- @repo/ui type-check: **0 errors**
- web lint: **0 warnings** (`--max-warnings 0`)
- @repo/ui lint: **0 warnings** (`--max-warnings 0`)
- web tests: **277 passed** (18 test files; 121 of them new this phase)
- @repo/ui tests: **358 passed** (20 test files; 4 new composite suites contribute 51 tests)
- Playwright E2E (`candidate-error.spec.ts`): **2 passed**

Per-layer `/frontend-arch-validator` runs clean (services, stores, composites, containers, routes). No raw Tailwind color scales, no `fetch()` outside `services/` or the documented `lib/candidate-fetch.ts` carve-out, no `useQuery`/`useMutation` outside containers, no `create(...)` outside stores, no `"use client"` on pages or layouts.

---

## Code Review

`frontend-code-reviewer` first-pass result: **PASS**.

The reviewer verified all rubric items: layer boundaries, fetch ownership (services + the documented Server-Component-only carve-out), state boundaries (TanStack Query only in containers, Zustand only in stores, no server data in stores), `Result<T, ServiceError>` correctness in services with mapping at the boundary (services never throw; container `queryFn` correctly throws `result.error`), `"use client"` only at the container layer plus client providers, semantic Tailwind tokens everywhere, container three-file pattern + barrels, `forwardRef` + inferred `displayName` on `VoicePresence` (interactive composite), one-behaviour-per-`it` test discipline with a fresh `QueryClient` per container test and `vi.stubGlobal('fetch', ...)` for service tests.

Three optional non-blocking style notes were captured but not actioned (kept as historical record):

- `"use client"` declared on `MicLevelMeter`, `ConnectionLossBanner`, and `TranscriptFeed` even though none currently uses a browser-only API. Harmless and consistent with the rest of the composite layer; future-proofs against adding interactivity.
- Empty `ws.onerror` body in `useInterviewSession.ts`. Intentional (the matching `ws.onclose` covers both paths) and already commented.
- `usePreInterviewCheck` destructures the whole `useInterviewSessionStore` to read `transcriptVisible` / `setTranscriptVisible`. Selector-based subscriptions would reduce re-renders if the hook ever moved into a render-hot path. Not on a hot path today.

---

## Phase 9.5 — Migration to ElevenLabs Conversational Agents (recommended next phase)

Live testing in Phase 9 surfaced **a third, deeper bug** that the sandwich architecture (Deepgram → Gemini → ElevenLabs) cannot cleanly solve without significant additional engineering: **Gemini hallucinates candidate responses on silent turns**, drawing content from the CV that lives in its system prompt. After the half-duplex fix gated mic input correctly and the backend gracefully handled empty STT, Gemini's next turn ran against a conversation history with no `role: "user"` message after the previous `role: "assistant"` turn — and the model "helpfully" fabricated the candidate's response to fill the gap, voicing it through ElevenLabs as if the candidate had said it.

This is fixable in the sandwich (insert a `role: "user", content: "[no audible response]"` synthetic marker into history when silent; move the CV out of the system prompt into a tool-callable resource), but the deeper failure modes the sandwich exposes — no barge-in, no native turn-detection, no role enforcement outside the LLM, ~700–1000 ms stitched latency, three-vendor sync drift, hand-rolled half-duplex contract — are inherent to stitching STT + general LLM + TTS together. They will continue to surface as production-quality voice UX regressions.

**ElevenLabs Conversational AI agents solve the entire problem area natively** (per the `/agents` skill loaded into the project): native VAD with `patient`/`normal`/`eager` turn eagerness, built-in barge-in, LiveKit-based echo cancellation, guardrails layered outside the LLM (`focus`, `prompt_injection`, `custom`), workflow nodes (`start_node` → `override_agent` → `end`) that model the interview state machine, native `tools` + `dispatch_tool` for `next_question` / `score_answer` / `take_note` / `end_interview`, and a `claude-sonnet-4-6` / `gemini-2.5-flash` LLM choice that keeps the model flexibility. Sub-300 ms latency is claimed and reasonable given they own the entire pipeline.

### What Phase 9.5 will do

| Layer | Action |
|---|---|
| **Domain** (`packages/domain`) | Unchanged. `Interview`, `InterviewPlan`, `Report`, scoring rubric, state machine all keep. |
| **Application — replace** `ConductInterview` use case | New use case `StartCandidateSession` creates an ElevenLabs agent from `InterviewPlan` + `JobDescription` + `CandidateInfo` + `clientInstructions`, returns a signed URL for the candidate's browser to connect to. |
| **Application — add** webhook receivers | `RecordAgentNote`, `RecordInternalScore`, `EndInterviewFromAgent` — invoked by ElevenLabs webhooks when the agent calls the corresponding tools. |
| **Application — add** `PersistCompletedTranscript` | Invoked when the ElevenLabs session ends; pulls the final transcript via their API and writes it to the `Interview` aggregate. |
| **Infrastructure — replace** `ConductInterviewUseCase` adapter wiring | Adapter is now an ElevenLabs `Conversation` factory, not the AI-SDK Gemini + Deepgram + ElevenLabs sandwich. |
| **Infrastructure — remove** Deepgram STT adapter | No longer needed; ElevenLabs handles STT. |
| **Infrastructure — keep** ElevenLabs API key + voice config | Reused for the agent's voice. |
| **Presentation — replace** WebSocket session route | New REST endpoint `POST /interviews/:id/candidate-session` issues a signed URL; ElevenLabs webhook receiver routes added at `/webhooks/elevenlabs/tools` and `/webhooks/elevenlabs/session-end`. |
| **Frontend — replace** `InterviewSessionContainer/useInterviewSession.ts` | New container subscribes to the ElevenLabs React SDK (`ConversationProvider`, `useConversationControls`, `useConversationStatus`). |
| **Frontend — delete** `audio-playback-queue.ts`, `pcm-downsampler.js`, the worklet route | All handled by ElevenLabs LiveKit. |
| **Frontend — keep** the orb, transcript feed, mic-level meter, connection-loss banner | All driven by the new container's hook against the SDK's state. |
| **Frontend — keep** `(candidate)/c/[id]/session` route, layout, error screens | Unchanged. |
| **Tests** | Frontend voice-pipeline tests delete; new container tests mock the ElevenLabs SDK. Backend webhook receiver tests added. |
| **ADRs** | New ADR superseding ADR-002 (voice pipeline), ADR-010 (transport), ADR-011 (codec). Possibly new ADR documenting the workflow-based interview state. |

### Tradeoffs to validate before committing to 9.5

- **Cost**: ElevenLabs conversational AI is ~3–5× more expensive per minute than the sandwich. ~$0.50–1.50 per 15-min session at current pricing — fine for early product, worth re-checking their pricing page.
- **Vendor lock-in**: switching to their platform binds interview behaviour to their workflow model. Mitigated by the fact that the `Interview` / `Report` domain remains the source of truth.
- **Langfuse integration**: their tracing surface is different from AI-SDK's; needs re-wiring.

### Deferred sandwich-only fixes (only relevant if 9.5 is rejected)

If Phase 9.5 is **not** undertaken, the following sandwich-mode patches would need to land instead:
- Insert a `role: "user", content: "[no audible response]"` marker into `history[]` on silent turns so Gemini sees an explicit user-side gap rather than fabricating one.
- Move the CV out of the system prompt into a tool the agent can `read_candidate_cv()` when it needs to reference specifics — prevents CV regurgitation in any hallucinated user turn.
- Add a server-side echo-detection guard: don't open the candidate's audio-turn gate until ≥500 ms after the last MP3 chunk is sent.

---

## Notes

- The `viewLoadToErrorKind` helper currently collapses 401 and 404 to `"invalid-link"`. If product wants to distinguish "expired link" from "wrong link" the backend would need to expose the failure cause in the 401 body shape — the current shape carries only a generic message.
- `usePostInterview` polls up to 5 times at 30 s intervals (capped at 2.5 min) and stops on terminal status. If the candidate is on a slow eval pipeline this may need a longer cap; deferred until product feedback.
- The throttled `audioLevel` store field exists on `useInterviewSessionStore` rather than on `useMicCheckStore` because the session is the only consumer of the live worklet RMS. `useMicCheckStore` retains its own `level` field for the pre-interview RAF tick — different lifecycle, different cleanup boundary.
- The recruiter-side `useInterviewSessionStore()` is currently destructured whole in `usePreInterviewCheck`; if Phase 10 adds session-state mutations during the pre-check (e.g. resuming an interrupted session from the pre-check screen) we'll need to switch to selector subscriptions before that change to avoid re-render churn.
- `parseSessionCompleted` in `useInterviewSession.ts` is hand-rolled type-narrowing rather than a Zod schema. The reuse reviewer flagged the inconsistency — kept as-is for Phase 9 (it parses a WS transport payload, not an HTTP response, and lives outside `types/`). A small Zod schema would be the right migration if the protocol grows.
