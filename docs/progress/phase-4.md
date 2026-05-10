# Phase 4 Progress

## Phase 4 Complete, Live Smoke Pending

This document records the Phase 4 changes for the **AI interviewer** monorepo, scoped to a hardcoded voice-pipeline spike.

Phase 4 goal:

- prove the mechanical voice loop before adding the Phase 5 LLM agent
- expose stream-shaped STT and TTS application ports
- implement Deepgram STT and ElevenLabs TTS infrastructure adapters
- add a Fastify WebSocket route for scripted interview sessions
- add a CLI latency harness for manual smoke testing once voice API keys are configured

Plan source: `.claude/plan/phase-4-voice-pipeline-spike.md`  
Architecture context: `docs/ARCHITECTURE.md`

ADRs accepted for this phase:

- [ADR-010](../adr/ADR-010-use-async-iterable-stream-contracts-for-stt-tts-ports.md) — AsyncIterable stream contracts for STT/TTS ports
- [ADR-011](../adr/ADR-011-adopt-fastify-websocket-v11-for-websocket-transport.md) — `@fastify/websocket` v11 for WebSocket transport
- [ADR-012](../adr/ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md) — OTel span hierarchy for voice pipeline sessions and turns

---

## Summary

Completed:

- **Application:** `ISpeechToTextService`, `ITextToSpeechService`, DTO, scripted questions, candidate-audio tee helper, and `RunScriptedInterviewSessionUseCase`
- **Infrastructure:** fail-closed Deepgram and ElevenLabs provider factories, streaming STT/TTS adapters, and OTel turn spans
- **Presentation:** `@fastify/websocket` registration, `/interviews/:id/session` WebSocket route, controller, binary frame helpers, and close-code mapping
- **Composition:** backend boot wiring for the scripted voice session pipeline
- **Scripts:** `voice:latency` harness for manual latency measurement
- **Tests:** focused coverage for DTO/use case/tee, SDK adapters, composition, WebSocket helpers, controller, and route integration

Explicitly not included in this phase:

- no Gemini interview agent
- no `ConductInterview` use case
- no transcript persistence
- no report/evaluation writes
- no auth or candidate-link validation
- no browser UI
- no live latency number yet, because `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` are still pending

---

## Implementation Notes

The installed `@deepgram/sdk@5.0.0` does not expose the older `createClient` / `LiveTranscriptionEvents` API shape shown in the draft plan. The adapter uses the installed SDK's `DeepgramClient` and `listen.v1.connect(...)` WebSocket API instead, while keeping the application port unchanged.

The presentation layer does not import infrastructure directly. Voice-session wiring lives in `apps/backend/src/composition/interview-session.composition.ts`, and the route receives already-built dependencies.

Backend boot fails closed when voice keys are missing, matching the Phase 4 plan. Tests inject route dependencies where needed, so CI does not require live voice keys.

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

- domain tests: **116 passed**
- application tests: **73 passed**
- backend tests: **79 passed**
- type-check passed for domain, application, and backend

Live smoke / latency:

- provider-level smoke completed with `phase-4-live-smoke-1778400352254`
- ElevenLabs TTS returned first audio chunk successfully
- Deepgram STT returned final transcript chunks successfully
- Langfuse observations confirmed:
  - `interview.turn.tts` observation `32f75bac10909994`, trace `7ad992b16fb1ee0b81475f28a719ca93`, first chunk latency **1151 ms**
  - `interview.turn.stt` observation `c8b1407b21fc3291`, trace `197e0be0da2c91c5f0623e6608f2e245`, final confidence **0.9780**
- full WebSocket route smoke reached Langfuse with `phase-4-ws-smoke-1778400501`, trace `8f5405f7baf19e44f1c311881dda72ad`
  - session span `633458a017e8a7a0`
  - child TTS spans `8c6b98c01c73a11b`, `323d301f9d0e0ef2`
  - child STT spans `62796688de6ff4ee`, `3fae394f5d572448`
- full WebSocket smoke closed with `1011 TranscriptEntry.text must not be empty` on the second scripted turn; this exposed a Phase 4 harness/protocol timing gap, not a key/provider failure

To rerun manually:

```bash
pnpm --filter backend exec tsx src/scripts/measure-voice-latency.ts \
  --wav <path> \
  --interview-id <id> \
  --url ws://localhost:3002/interviews/<id>/session
```

Note: the current harness reads raw bytes despite the `--wav` flag name. For the current Deepgram config, feed 16 kHz mono `linear16` PCM bytes or update the Deepgram env config to match the audio container.
