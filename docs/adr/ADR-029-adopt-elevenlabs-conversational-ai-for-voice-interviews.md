# ADR-029 Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline

## Status

Accepted. Date: 2026-05-29.

Approved by: raafayk7 (user) based on Phase 9 live-testing findings documented in `docs/progress/phase-9.md` (Phase 9.5 section).

## Context

The sandwich pipeline adopted in ADR-002 (Deepgram speech-to-text (STT) + Gemini via Vercel AI SDK + ElevenLabs text-to-speech (TTS)) was implemented and shipped in Phase 5. Phase 9 live testing surfaced a sequence of three progressively deeper bugs that reveal a structural ceiling in the sandwich approach.

**Bug 1 — echo loop.** With the mic active during AI speech, laptop speakers played the AI's MP3, the laptop mic captured it, Deepgram transcribed the AI's own voice as candidate speech, and Gemini responded to its own previous output. Fix required: `getUserMedia` constraints `echoCancellation: true`, a strict half-duplex `aiSpeakingRef` guard, and an 800 ms silence watchdog (`aiTurnEndTimerRef`) to re-open the mic after the last TTS chunk drains (`apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts`). The watchdog threshold is empirical and fragile; it will regress on slow connections or when ElevenLabs changes chunk cadence.

**Bug 2 — empty STT crash.** After half-duplex gating stopped the echo, silent candidate turns produced `""` from Deepgram. The use case passed `""` directly to `TranscriptEntry.create`, which enforces a non-empty text invariant, producing `InvalidInterviewInputError` mapped to WebSocket close code 1008 — terminating the whole interview on a single silent turn. Fix required: a `MAX_CONSECUTIVE_SILENT_TURNS = 3` counter and a `CANDIDATE_SILENT` end-reason enum value in `packages/application/src/use-cases/interview/conduct-interview.use-case.ts`.

**Bug 3 — Gemini hallucinates the candidate (unfixable within the sandwich).** After the silent-turn guard landed, Gemini's next turn ran against a conversation history with no `role: "user"` message following the previous `role: "assistant"` turn. The model "helpfully" fabricated the candidate's response by drawing from the CV in its system prompt, then voiced the fabricated text through ElevenLabs as if the candidate had spoken. Root cause: role and turn enforcement live only inside the LLM prompt in the sandwich model. There is no structural turn boundary. In a screening product where transcript fidelity is the entire value proposition, this is a correctness defect, not an edge case.

The sandwich can be patched for bug 3 specifically (insert a synthetic `role: "user", content: "[no audible response]"` marker on silent turns; move the CV out of the system prompt into a tool-callable resource; add a server-side echo-detection guard of at least 500 ms after the last TTS chunk). However, the deeper failure modes are inherent to the three-vendor composition:

- No native barge-in: candidates cannot interrupt the AI mid-utterance without a new WS protocol extension.
- No native voice activity detection (VAD) or turn detection: the 800 ms watchdog is the only turn boundary, and it is a heuristic.
- No role enforcement outside the LLM: any drift in the model's system prompt interpretation can break turn hygiene.
- Stitched latency of approximately 700 to 1 000 ms across three independent vendor round trips.
- Three-vendor sync drift: Deepgram WebSocket, Gemini streaming, ElevenLabs HTTP streaming are all asynchronous and can diverge under load.
- Hand-rolled half-duplex contract: the `aiSpeakingRef` + 800 ms watchdog + AudioWorklet early-return pattern in `useInterviewSession.ts` is approximately 80 lines of bespoke state-machine code with no test coverage for timing-sensitive paths.

ElevenLabs Conversational AI agents address the entire problem area natively. The product offers: native VAD with configurable turn eagerness (`patient`, `normal`, `eager`), built-in barge-in support, LiveKit-based echo cancellation (no browser-side heuristics needed), guardrails applied outside the LLM context (`focus`, `prompt_injection`, `custom`), workflow nodes that model interview state machine transitions, native `tools` + `dispatch_tool` for `next_question` / `score_answer` / `take_note` / `end_interview`, and an LLM choice that includes `claude-sonnet-4-6` and `gemini-2.5-flash`. Sub-300 ms end-to-end latency is claimed by ElevenLabs (vs. the sandwich's measured 700 to 1 000 ms). The project already holds an `ELEVENLABS_API_KEY` plumbed into `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` and uses the ElevenLabs voice for TTS; no new vendor relationship is required.

The domain layer is unaffected. `Interview`, `InterviewPlan`, `Report`, the scoring rubric, and the interview state machine all remain. Only the orchestration edge changes.

ADR-002 is superseded by this ADR for the primary voice path. The sandwich code (`ConductInterview` use case, Deepgram adapter, WebSocket controller, ElevenLabs TTS service) is retained in the repository as a non-default fallback path. ADR-010 (AsyncIterable stream contracts for STT and TTS application ports) remains valid for the retained sandwich fallback; it is not superseded.

## Decision

Adopt ElevenLabs Conversational AI agents as the primary voice interview pipeline, replacing the sandwich (Deepgram STT + Gemini via AI SDK + ElevenLabs TTS) described in ADR-002 as the default path.

The new primary path works as follows. The backend's `StartCandidateSession` use case provisions or reuses a static ElevenLabs agent (see ADR-030 for the single-agent provisioning model), injects the interview-specific system prompt (job description, interview plan, candidate name, tool schemas), and returns a signed ElevenLabs session URL. The candidate's browser connects to that URL directly via the ElevenLabs React SDK; the backend is no longer on the real-time audio path during the session. ElevenLabs delivers audio to the candidate and receives audio back, performing STT, VAD, turn management, and TTS internally. When the agent calls a tool (`next_question`, `score_answer`, `take_note`, `end_interview`), ElevenLabs delivers an HMAC-verified webhook to the backend. When the session ends, a second webhook delivers the final transcript. The backend's domain layer processes these events exactly as before: `Interview` aggregate mutations, per-turn persistence, and eventual `InterviewCompleted` state transition.

The sandwich code is retained and remains runnable. It is not deleted. New code additions to the voice pipeline must target the ElevenLabs Conversational AI path. Reintroducing the sandwich as the default runtime path requires a superseding ADR.

This decision does not cover the ElevenLabs agent provisioning model (ADR-030), the webhook receiver design and lifecycle event handling (ADR-031), or Langfuse tracing re-wiring for the new path (ADR-032).

## Alternatives Considered

### Alternative A: Patch the sandwich to fix the hallucination and remaining failure modes

Three targeted patches would address the immediate correctness defect: (1) insert a `role: "user", content: "[no audible response]"` synthetic marker into the conversation history when the candidate is silent, so Gemini sees an explicit user-side gap rather than fabricating one; (2) move the CV out of the system prompt into a tool-callable `read_candidate_cv()` resource, preventing CV content from seeping into fabricated turns; (3) add a server-side echo-detection guard of at least 500 ms after the last TTS chunk before opening the candidate audio gate.

Rejected because these patches address the symptom of bug 3 without addressing its structural cause: role and turn enforcement live only inside the LLM prompt, and a model that drifts from the prompt can violate turn hygiene in arbitrarily many ways. The deeper failure modes — no native barge-in, no native VAD, no structural turn boundary, approximately 700 to 1 000 ms stitched latency, three-vendor sync drift, and the 80-line hand-rolled half-duplex contract in `useInterviewSession.ts` — remain entirely in place. Each of these will continue to surface as production voice-quality regressions under conditions the patched prompts do not anticipate. The cost of maintaining the patch surface compounds with every new edge case.

### Alternative B: Adopt a different managed real-time voice agent platform (OpenAI Realtime API)

OpenAI Realtime API is a competing managed voice agent platform that also provides native VAD, barge-in, and integrated STT/LLM/TTS in a single session.

Rejected for three reasons. First, the project already pays for and uses ElevenLabs for TTS (ElevenLabs voice `EXAVITQu4vr4xnSDxMaL` and model `eleven_turbo_v2_5` are in production use; the sift-sample.mp3 in `apps/web/public/` was generated with this voice). Switching to OpenAI Realtime replaces the ElevenLabs key and SDK surface with OpenAI's while retaining ElevenLabs for nothing, adding net complexity. Second, the project currently uses Gemini as the reasoning brain (ADR-002, ADR-003); OpenAI Realtime would require replacing the brain with a GPT-4o class model and accepting the associated prompt-migration and evaluation-regression risk. Third, ElevenLabs Conversational AI supports `claude-sonnet-4-6` and `gemini-2.5-flash` as LLM choices, preserving model flexibility without a new vendor relationship.

### Alternative C: Do nothing

Retain the sandwich as-is and accept the hallucination defect.

Rejected. Transcript fidelity is the core value proposition of a technical screening product. A system that voices fabricated candidate responses and includes them in the interview transcript produces a record that is actively misleading to recruiters. This is a correctness defect of product-level severity, not a tolerable edge case.

## Consequences

**Benefits**

- Structural turn enforcement: ElevenLabs VAD and turn-management layers enforce role boundaries outside the LLM context. Fabricated candidate turns are architecturally prevented rather than prompt-guarded.
- Native barge-in: candidates can interrupt the AI mid-utterance without any bespoke WS protocol extension.
- Native echo cancellation via LiveKit: the 80-line hand-rolled half-duplex contract (`aiSpeakingRef`, `aiTurnEndTimerRef`, AudioWorklet early-return) in `useInterviewSession.ts` is deleted.
- Lower latency: sub-300 ms claimed vs. the sandwich's measured 700 to 1 000 ms.
- Reduced operational surface: three-vendor STT + LLM + TTS sync becomes one vendor session; Deepgram WebSocket management and the `ISpeechToTextService` adapter are no longer on the primary path.
- Existing ElevenLabs API key and voice identity reused: no new vendor relationship, no new billing surface.

**Trade-offs**

- Per-session cost is approximately 3 to 5 times higher than the sandwich: approximately $0.50 to $1.50 per 15-minute session at current ElevenLabs conversational AI pricing vs. the sandwich's lower per-minute component costs. Acceptable for early product; requires re-evaluation when sessions exceed roughly 500 per month.
- Deeper vendor lock-in for the primary voice path: the interview's real-time turn logic is now expressed inside ElevenLabs workflow nodes and guardrail config rather than in the application layer. Mitigation: the `Interview` / `Report` domain layer remains the source of truth for all transcript, score, and note data; ElevenLabs is the real-time transport, not the record of authority.
- Status transitions and transcript persistence become asynchronous and webhook-driven rather than synchronous per-turn repository saves. The lifecycle of an interview session is now event-sourced across multiple webhook calls. This is covered in detail in ADR-031.
- Langfuse / OpenTelemetry (OTel) tracing must be re-wired: the AI SDK span hierarchy defined in ADR-014 no longer applies to the primary path. The new span schema is documented in ADR-032.
- The frontend `InterviewSessionContainer` and its voice pipeline helpers (`AudioPlaybackQueue`, `pcm-downsampler.js`) are replaced by the ElevenLabs React SDK. The Phase 9 implementation of these components becomes dead code on the primary path (though retained while the sandwich fallback exists).

**Risks and mitigations**

- *Risk*: ElevenLabs pricing, availability, or API surface changes adversely. *Mitigation*: The sandwich code is explicitly retained in the repository as a non-default fallback. If ElevenLabs Conversational AI becomes untenable, the sandwich path can be reinstated as the default by a new superseding ADR without rebuilding from scratch.
- *Risk*: ElevenLabs transcript format or fidelity differs from Deepgram's. *Mitigation*: The ElevenLabs session-end webhook delivers a final transcript that must be mapped to the existing `TranscriptEntry` domain invariant (non-empty text, `role: "agent" | "user"`, ISO 8601 timestamp). The mapping adapter in the `PersistCompletedTranscript` use case enforces the invariant at the infrastructure boundary; no domain changes are required.
- *Risk*: ElevenLabs tool dispatch latency causes webhook delivery delays that desynchronise the `Interview` aggregate state from the real-time session state. *Mitigation*: ADR-031 specifies the webhook receiver design, idempotency strategy, and ordering guarantees. The aggregate accepts out-of-order tool events via append-only mutations that do not depend on delivery order.
- *Risk*: The LLM judge enforcement block below cannot catch all forms of sandwich reinstatement. *Mitigation*: New voice-path code must be reviewed against this ADR's Decision text. The `llm_judge: true` flag surfaces an advisory line at commit time.

## Related Decisions

- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: Superseded by this ADR for the primary voice path. ADR-002's sandwich code is retained as a non-default fallback; ADR-002's Status line should be updated to `Superseded by ADR-029, 2026-05-20` after this ADR is accepted.
- **ADR-010 (Use AsyncIterable Stream Contracts for STT and TTS Application Ports)**: Remains valid and accepted. ADR-010's contracts govern the retained sandwich fallback path. This ADR does not supersede ADR-010.
- **ADR-013 (Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface)**: The four-tool surface (`next_question`, `score_answer`, `take_note`, `end_interview`) and the aggregate mutation model defined in ADR-013 are preserved on the new path; tool delivery is now via ElevenLabs webhooks rather than AI SDK tool callbacks. ADR-031 documents how ADR-013's per-turn persistence model adapts to asynchronous webhook delivery.
- **ADR-030 (Single Static ElevenLabs Agent with Per-Session Prompt Overrides)**: The provisioning model this adoption uses. Specifies how one static ElevenLabs agent is reused across all interview sessions via per-session `clientInstructions` injection.
- **ADR-031 (HMAC-Verified ElevenLabs Webhooks Drive Interview Lifecycle and Transcript Persistence)**: How interview lifecycle events and transcript persistence operate under this adoption. Partially supersedes ADR-013 for the primary path's asynchronous event-delivery model.
- **ADR-032 (Extend OTel/Langfuse Span Hierarchy for ElevenLabs Conversational Sessions)**: The new observability span schema for the primary voice path, replacing the AI SDK span hierarchy from ADR-014 on the primary path.

## References

- `docs/progress/phase-9.md` — Phase 9.5 section: full narrative of the three bugs, the architectural ceiling analysis, and the Phase 9.5 migration plan table that drives this ADR.
- `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts` — the 800 ms `aiTurnEndTimerRef` half-duplex watchdog and `aiSpeakingRef` guard.
- `packages/application/src/use-cases/interview/conduct-interview.use-case.ts` — `MAX_CONSECUTIVE_SILENT_TURNS = 3` counter and `CANDIDATE_SILENT` end-reason handling.
- `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` — existing `ELEVENLABS_API_KEY` and voice configuration reused by this adoption.
- `apps/web/public/sift-sample.mp3` and `apps/web/public/audio-worklet/pcm-downsampler.js` — Phase 9 voice-pipeline assets that become redundant on the primary path after migration.
- ElevenLabs Conversational AI documentation: https://elevenlabs.io/docs/conversational-ai/overview
- ElevenLabs Conversational AI React SDK: https://elevenlabs.io/docs/conversational-ai/libraries/react
- ElevenLabs Conversational AI pricing: https://elevenlabs.io/pricing (conversational AI tier)
- Phase 9.5 migration plan: `docs/progress/phase-9.md` Phase 9.5 section (layer-by-layer action table).

## Enforcement

The sandwich code is retained, so forbidding Deepgram or ElevenLabs TTS imports would produce false positives. The rule that matters is semantic: new voice-path code must route through the ElevenLabs Conversational AI path and must not reintroduce the sandwich as the default runtime path. This cannot be expressed purely as a regex, so `llm_judge: true` is used. The judge evaluates staged diffs against this ADR's Decision text and flags any change that wires the sandwich `ConductInterview` use case as the primary execution path for a new session request.

```json
{
  "forbid_pattern": [],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

`llm_judge: true` is set because the core rule — new conversational voice code must target the ElevenLabs Conversational AI path and must not reinstate the sandwich as the default — requires semantic evaluation of intent, not line-pattern matching. The pre-commit hook will surface an advisory line for any diff that touches voice-pipeline code; the reviewer resolves it in-session via `/adr-kit:judge`.
