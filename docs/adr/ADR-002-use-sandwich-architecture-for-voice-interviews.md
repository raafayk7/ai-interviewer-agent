# ADR-002 Use Sandwich Architecture for Voice Interviews

## Status

Accepted. Date: 2026-05-09. Superseded as the primary voice pipeline by ADR-029, 2026-05-29; the sandwich (STT → LLM → TTS) architecture documented here is retained as the documented fallback.

## Context

The product is an AI technical-screening interviewer that conducts real-time, spoken interviews with engineering candidates. Each session lasts approximately 15 minutes. The system must accept candidate audio, reason over it (with awareness of the job description, CV summary, interview plan, and full conversation history), and speak back a response — all within a latency envelope that feels conversational.

Two candidate architectures were evaluated:

1. A **composed "sandwich" pipeline** of three specialised, independently replaceable services: Deepgram (speech-to-text, STT) → Gemini agent (reasoning brain, via the Vercel AI SDK) → ElevenLabs (text-to-speech, TTS).
2. **NVIDIA PersonaPlex**, an end-to-end voice persona model that handles the full audio-in/audio-out loop in a single model.

This decision also touches the real-time transport layer: browser-to-backend communication uses WebSockets for bidirectional audio; the backend drives Deepgram over a WebSocket and drives ElevenLabs over HTTP streaming (see `docs/ARCHITECTURE.md` §5.5, lines 334–339).

ADR-001 (Clean Architecture + DDD + FP) establishes the layering and Result/Option discipline that the voice pipeline's failure handling depends on.

## Decision

The voice interview pipeline composes three independent services in series: Deepgram (WebSocket streaming STT) → Gemini agent (via the Vercel AI SDK) → ElevenLabs (HTTP streaming TTS). NVIDIA PersonaPlex is not used.

The pipeline works as follows (see `docs/ARCHITECTURE.md` §3.3, lines 101–135 for the full diagram):

- The browser streams microphone audio to the backend over a WebSocket.
- The backend relays that audio to Deepgram over a WebSocket; Deepgram returns a transcript in real time (~200 ms).
- The transcript is appended to the conversation history and passed to the Gemini agent. The agent receives the job description, CV summary, interview plan, and full conversation history in its system prompt. It emits structured output via four tool calls: `next_question`, `score_answer`, `take_note`, and `end_interview` (~300–500 ms).
- The agent's text output is sent to ElevenLabs over HTTP streaming, which returns audio chunks; the backend relays those chunks back to the browser over the same WebSocket (~200 ms).

End-to-end latency budget: approximately 500 ms to 1 s. This is acceptable for a screening interview with natural conversational pauses.

This decision does not cover document ingestion (CV/JD parsing uses Gemini multimodal directly — see §4.5) or observability (Langfuse tracing — see §4.6). Those are addressed separately.

## Alternatives Considered

### Alternative A: NVIDIA PersonaPlex (end-to-end voice persona model)

PersonaPlex is an NVIDIA-hosted 7 B-parameter voice persona model that accepts audio in and produces audio out without a separate STT or TTS step.

Rejected for six concrete reasons drawn from `docs/ARCHITECTURE.md` §4.4 (lines 175–186):

1. **Content injection does not work.** The `text_prompt` parameter controls only persona identity ("You are Sarah"), not behavior or content. There is no mechanism to inject a job description or instruct the model on what questions to ask. This is a fine-tuning limitation, not a configuration gap.
2. **163-second context window.** The model forgets everything beyond approximately 2.7 minutes. A 15-minute interview would cause repeated questions and loss of track of earlier answers — a hard functional failure.
3. **No tool calling.** Interview flow control (`end_interview`, `next_question`, `score_answer`) cannot be driven without tool calling. Prompt-engineering workarounds are unreliable for a structured screening workflow.
4. **7 B parameters.** Insufficient reasoning depth for evaluating technical answers or generating meaningful follow-up questions.
5. **1:1 GPU ratio per concurrent interview.** Each session requires a dedicated GPU, making horizontal scaling prohibitively expensive.
6. **English only.** No multilingual support; the product targets a global hiring market.

### Alternative B: OpenAI Realtime API (single-model voice)

OpenAI's Realtime API handles STT, reasoning, and TTS in a single streaming session billed as one unit.

Rejected because it ties the entire voice loop to one vendor: STT, reasoning brain, and TTS cannot be swapped independently. If OpenAI changes pricing, quality, or availability, all three legs are affected simultaneously. As of the evaluation date (2026-05-09) the latency and cost profile did not clearly beat the sandwich pipeline. The choice of Gemini-via-AI-SDK as the reasoning brain is also already recorded as a project constraint; using OpenAI Realtime would require replacing the brain as well.

### Alternative C: Server-side STT with browser-side TTS (browser SpeechSynthesis API)

Route Deepgram STT through the server but use the browser's built-in `SpeechSynthesis` API for audio output, eliminating the ElevenLabs leg.

Rejected because browser SpeechSynthesis voice quality is materially below ElevenLabs for a recruiter-facing professional product. The latency saving of eliminating the TTS leg is approximately 200 ms — within the acceptable conversational pause budget — so it does not justify the quality regression. ElevenLabs also provides a stable, consistent voice identity across all sessions; `SpeechSynthesis` varies by OS and browser.

### Alternative D: Do nothing (text-only interviews)

Conduct interviews as a text chat interface with no voice.

Rejected because voice interaction is a product differentiator: it more accurately simulates a real phone screen, reduces candidate fatigue from typing, and enables richer prosodic signals. The product brief explicitly requires voice.

## Consequences

**Benefits**

- Each component is replaceable in isolation: Deepgram can be swapped for Whisper, ElevenLabs for Cartesia or PlayHT, without touching the reasoning layer.
- Full content control: we own the system prompt, the tool schema, the question bank, and the conversation history passed to Gemini.
- Tool calling (`end_interview`, `next_question`, `score_answer`, `take_note`) enables deterministic interview flow control; no prompt-engineering escape hatches are needed.
- Scales on standard infrastructure: no GPU 1:1 binding; each interview is three HTTP/WebSocket connections.
- Multilingual: Deepgram, Gemini, and ElevenLabs all support multiple languages.
- Observability is composable: Deepgram and ElevenLabs calls are instrumented as custom OpenTelemetry spans within the same Langfuse trace as the Gemini agent turns (see §4.6).

**Trade-offs**

- Three vendor relationships and three API keys to manage (Deepgram, Google AI Studio, ElevenLabs) — see §4.3. Operational surface is larger than a single-vendor solution.
- End-to-end latency is the sum of three independent providers; a regression in any one leg degrades the full loop.
- Failure handling is more complex: Deepgram WebSocket drops, Gemini timeouts, and ElevenLabs rate limits are independent failure modes requiring independent recovery paths.
- No "voice cloning persona" out of the box: the interviewer voice is a stock ElevenLabs voice. Custom voice cloning is a future option but not part of this decision.

**Risks and mitigations**

- *Risk*: Deepgram WebSocket drops mid-interview cause transcript loss and a broken session. *Mitigation*: Implement WebSocket reconnection with transcript carry-forward (backlog item — see §5.5 notes at line 443); save partial transcript to the database on every turn so a reconnect can resume from the last persisted state.
- *Risk*: Gemini latency spikes push end-to-end latency above 2 s, breaking conversational feel. *Mitigation*: Set a per-turn timeout; fall back to a canned "I'm thinking, give me a moment" TTS phrase while the model catches up. Monitor p95 latency via Langfuse traces.
- *Risk*: ElevenLabs rate limits during a burst of concurrent interviews. *Mitigation*: Implement a retry with exponential back-off in the ElevenLabs adapter (infrastructure layer); expose the rate-limit error as a `ServiceInfraError` so the application layer can surface it to the candidate gracefully.
- *Risk*: Vendor lock-in via tight coupling to Deepgram/ElevenLabs SDK internals. *Mitigation*: Both integrations live behind repository/service ports in `apps/backend/src/infrastructure/`; the application layer depends only on port interfaces, not on SDK types. Swapping a vendor requires only a new adapter.

## Related Decisions

- **ADR-001 (Clean Architecture + DDD + FP)**: This ADR depends on ADR-001's layering model. The voice pipeline's three external service adapters (Deepgram, Gemini, ElevenLabs) are infrastructure-layer adapters behind application-layer port interfaces. Result/Option discipline from ADR-001 governs error propagation across the three legs.

## References

- `docs/ARCHITECTURE.md` §3.3, lines 101–135: sandwich architecture diagram and latency budget.
- `docs/ARCHITECTURE.md` §4.3, lines 166–173: API keys required (Deepgram, Google AI Studio, ElevenLabs).
- `docs/ARCHITECTURE.md` §4.4, lines 175–186: six concrete reasons PersonaPlex was rejected.
- `docs/ARCHITECTURE.md` §5.5, lines 334–339: real-time communication transport choices (WebSocket for browser-to-backend and Deepgram; HTTP streaming for ElevenLabs).
- Vercel AI SDK documentation: https://sdk.vercel.ai/
- Deepgram live-streaming STT documentation: https://developers.deepgram.com/docs/live-streaming-audio
- ElevenLabs streaming TTS API reference: https://elevenlabs.io/docs/api-reference/text-to-speech-streaming

## Enforcement

The composition rule (use exactly these three services in this order) cannot be expressed purely as a regex, so `llm_judge` is enabled for semantic compliance checks. The declarative guard below catches direct imports of PersonaPlex or NVIDIA voice libraries at the package level.

```json
{
  "forbid_import": [
    {
      "pattern": "from\\s+['\"](@nvidia|nvidia|personaplex)['\"]",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "PersonaPlex was rejected in ADR-002. Use the Deepgram → Gemini → ElevenLabs sandwich pipeline."
    }
  ],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```

`llm_judge: true` is set because the core decision — compose these three specific services in this specific order, each behind an infrastructure port — requires semantic evaluation. Any new voice or audio code path in `apps/backend/src/` should be reviewed against the sandwich architecture described in this ADR.
