# Phase 5 Progress

## Phase 5 Complete, Live Smoke Passed

This document records the Phase 5 changes for the **AI interviewer** monorepo, scoped to replacing the Phase 4 scripted WebSocket driver with a real Gemini interviewer agent.

Phase 5 goal:

- replace the hardcoded scripted interview loop with a real Gemini agent
- keep the existing `GET /interviews/:id/session` WebSocket route
- reuse the Phase 4 Deepgram STT and ElevenLabs TTS adapters
- add per-turn transcript, note, and internal-score persistence
- add the Gemini agent tool surface: `next_question`, `score_answer`, `take_note`, `end_interview`
- verify the end-to-end STT -> Gemini -> TTS loop with live provider keys

Plan source: `.claude/plan/phase-5-agent-integration.md`  
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced for this phase:

- [ADR-010](../adr/ADR-010-use-async-iterable-stream-contracts-for-stt-tts-ports.md) - AsyncIterable stream contracts for STT/TTS ports
- [ADR-011](../adr/ADR-011-adopt-fastify-websocket-v11-for-websocket-transport.md) - `@fastify/websocket` v11 for WebSocket transport
- [ADR-012](../adr/ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md) - OTel span hierarchy for voice pipeline sessions and turns (amended by ADR-014)
- [ADR-013](../adr/ADR-013-conduct-interview-orchestration-and-tool-effects.md) - Agent tool surface, per-turn persistence, and event-sink pattern
- [ADR-014](../adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md) - `interview.turn.agent` span schema and session span rename

---

## Summary

Completed:

- **Domain:** added `AgentNote` and `AgentInternalScore` value objects; extended `Interview` with `notes`, `internalScores`, `appendTranscriptEntry`, `appendNote`, and `appendInternalScore`.
- **Application:** added `IInterviewAgentService`, agent error types, `ConductInterviewUseCase`, `ConductInterview` DTO, and pure system prompt assembly.
- **Application cleanup:** deleted the Phase 4 scripted session use case, scripted DTO, scripted constants, scripted tee helper, and their tests.
- **Infrastructure:** added `notes` and `internal_scores` JSONB columns, generated Drizzle migration `0001_lame_ozymandias.sql`, updated repository mapping, and added `GeminiInterviewAgentService`.
- **Presentation:** updated the existing WebSocket route/controller to invoke `ConductInterviewUseCase` and renamed the root span to `interview.session.agent`.
- **Composition:** wired the interview repository, Gemini agent, Deepgram STT, ElevenLabs TTS, DB handle, and timing env knobs into the session dependency builder.
- **Scripts:** updated the `voice:latency` harness for the Phase 5 `session.completed` envelope.

Additional integration fix:

- Added `candidate-audio-turn-gate` in the application layer so each STT call receives a turn-scoped slice of candidate audio and audio received during agent speech is dropped.

---

## Live Smoke

Live smoke passed on May 10, 2026 using configured provider keys.

Setup:

- Applied migrations with `pnpm --filter backend db:migrate`
- Generated a temporary 16 kHz PCM candidate utterance with ElevenLabs at `/tmp/phase5-candidate-utterance.pcm`
- Seeded a scheduled interview through `DrizzleInterviewRepository`
- Started backend locally on `127.0.0.1:3015`
- Ran the WebSocket latency harness against `/interviews/:id/session`

Successful smoke interview:

- Interview ID: `ad4bc423-b47f-4357-9647-d71ad9422759`
- WebSocket result: `session.completed`
- Close code: `1000`
- Turns completed: `1`
- Notes persisted: `1`
- Internal scores persisted: `1`
- End reason: `all_topics_covered`
- Hard ceiling hit: `false`
- First TTS chunk latency observed by harness: `5006 ms`
- TTS bytes observed by harness on turn 0: `195276`
- Final persisted status: `COMPLETED`
- Persisted transcript entries: `3`
- Langfuse trace: `d53f8a5f3f09a38088b126c54050f9ef`
- Langfuse root span: `interview.session.agent`
- Langfuse observations recorded: `16`

Persisted candidate transcript excerpt:

```text
I have built TypeScript back end services with Postgres School and Message Queues.
```

Smoke-discovered fixes:

- Gemini rejected turn 0 when only a system prompt was sent: `contents is not specified`. The adapter now adds an initial user kickoff message when conversation history is empty.
- Gemini rejected later system messages: `system messages are only supported at the beginning of the conversation`. The adapter now folds the time-remaining message into the initial system prompt for that turn.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend --force
pnpm turbo run test --filter=@repo/domain --force
pnpm turbo run test --filter=@repo/application
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend --force
pnpm --filter backend test -- --run src/infrastructure/services/gemini/gemini-interview-agent.service.test.ts
npx --yes langfuse-cli api traces list --from-timestamp "2026-05-10T15:30:00Z" --limit 5 --order-by timestamp.desc --fields core,observations --json
```

Results:

- domain tests: **144 passed**
- application tests: **83 passed**
- backend tests: **96 passed**
- Gemini agent adapter focused tests: **9 passed**
- forced type-check passed for domain, application, and backend

Cleanup checks:

```bash
rg -n "RunScriptedInterviewSession|SCRIPTED_INTERVIEW_QUESTIONS|scripted-interview|interview\\.session\\.scripted|script_version" packages apps/backend/src apps/backend/.env.example
```

Result:

- no live package/backend source references remain to the Phase 4 scripted path

## Code Review

First pass (Batch G): **REVISION REQUIRED** — 3 violations, all in test files.

Violations:
- `conduct-interview.use-case.test.ts:232` — chained `.start().unwrap().complete().unwrap()` without `isOk()` guards
- `interview.entity.test.ts:378` — bare `.unwrap()` inside array literal in `appendNote` "rejects when not IN_PROGRESS" test
- `interview.entity.test.ts:410` — same pattern in `appendInternalScore` "rejects when not IN_PROGRESS" test

Fixes applied: each bare `.unwrap()` extracted into a named `const result = …` with a preceding `expect(result.isOk()).toBe(true)` assertion. Tests re-run after fixes: **144 domain / 83 application — all passing**.

Second pass: **PASS** — no violations. Production code was clean throughout; all three violations were in test helpers.

---

## Notes

The first live run was useful: it caught two Gemini provider message-shape constraints that unit tests had not exercised. Both are now covered by `gemini-interview-agent.service.test.ts`.

The smoke used a generated PCM utterance rather than a real candidate recording. That is enough to prove the live provider loop, WebSocket envelope, persistence, and normal close path. A more natural multi-turn recording should still be used before Phase 9 browser work.
