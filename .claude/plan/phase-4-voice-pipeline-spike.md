# Plan: Phase 4 — Voice Pipeline Spike (Hardcoded Script)

> Generated: 2026-05-10
> Slug: `phase-4-voice-pipeline-spike`
> Architecture context: `docs/ARCHITECTURE.md` §3.3, §4.6, §5.5, §7
> Phase 3 reference: `docs/progress/phase-3.md` (adapter pattern to mirror)

---

## Goal

Prove the mechanical voice loop end-to-end before introducing the LLM agent. A browser opens a WebSocket to the backend; the backend plays a hardcoded sequence of 3–4 questions through ElevenLabs TTS, captures candidate replies through Deepgram STT, logs the resulting transcript, and exits. The two SDK adapters expose stream-shaped application ports so the upcoming Phase 5 `ConductInterview` use case can replace the hardcoded driver without changing infrastructure or presentation.

The spike also produces a real latency measurement (audio-in to first-TTS-chunk-out) for the chosen Deepgram model + ElevenLabs voice pair. The numbers go into `docs/progress/phase-4.md` once implemented.

## Non-goals (DO NOT do these in Phase 4)

- No `ConductInterview` use case (Phase 5).
- No Gemini agent, AI SDK tools, or system-prompt assembly (Phase 5).
- No transcript persistence to the `Interview` aggregate's `transcript` JSONB column. Transcript is returned in-memory only — the use case returns `Result<TranscriptEntry[], ServiceError>`. Persistence is wired in Phase 5 once the agent loop closes.
- No evaluation, no `Report` writes (Phase 6).
- No REST endpoints for interview CRUD (Phase 7).
- No auth — neither recruiter nor candidate-link auth. Document the gap and defer to Phase 7. The route accepts a path param `:id` and trusts it; this is a spike.
- No reconnection / mid-call recovery (Phase 10).
- No frontend UI work — Phase 4 is exercised either by a browser test page in `apps/web` or (preferred) by a CLI harness that feeds a `.wav` file. Only the latter is in scope here; the browser side is left for Phase 9.

## Layers touched

| Layer          | Package / Location                       | Scope                                                                                     |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                       | none — `TranscriptEntry`, `INTERVIEW_STATUS`, `Interview.start/complete` already cover us |
| Application    | `packages/application/`                  | new STT port, new TTS port, new `RunScriptedInterviewSessionUseCase` + DTO, barrel updates |
| Infrastructure | `apps/backend/src/infrastructure/`       | Deepgram provider + STT adapter, ElevenLabs provider + TTS adapter, custom OTel spans      |
| Presentation   | `apps/backend/src/presentation/`         | new `@fastify/websocket` plugin registration, WebSocket route, controller, error mapping  |
| Scripts        | `apps/backend/src/scripts/`              | `measure-voice-latency.ts` harness (CLI client of the WS endpoint)                        |

---

## Architectural decisions (rationale locked in)

### D1 — Stream contract for STT: `AsyncIterable<Uint8Array>` in, `AsyncIterable<TranscriptChunk>` out

**Decision.** `ISpeechToTextService.transcribe(input, ctx)` accepts an `AsyncIterable<Uint8Array>` of raw PCM/Opus audio frames and returns an `AsyncIterable<TranscriptChunk>` where each chunk carries `{ text, isFinal, confidence?, receivedAt }`. The adapter terminates the output iterator when the input iterator finishes or the upstream Deepgram socket closes.

**Why not callbacks / EventEmitter / `Observable`.**
- Callbacks force the use case to track lifetime imperatively — bad for `Result` chaining.
- `EventEmitter` leaks an untyped `.on(...)` surface and complicates error propagation.
- `Observable` (e.g. `rxjs`) introduces a new dependency for one feature.
- `AsyncIterable` is native, Promise-friendly, composes with `for await … of`, and converts cleanly to/from WebSocket message handlers via small adapter helpers.

The port stays free of Deepgram-specific types. Inside the adapter, `@deepgram/sdk` v5's `LiveTranscriptionEvents` are translated into `TranscriptChunk` objects.

### D2 — Stream contract for TTS: `string` in, `AsyncIterable<Uint8Array>` out

**Decision.** `ITextToSpeechService.synthesize(text, ctx)` returns `Promise<Result<AsyncIterable<Uint8Array>, TtsError>>`. The outer `Promise<Result<…>>` captures upfront connection / 4xx failures (auth, voice ID invalid). The inner `AsyncIterable` streams binary audio chunks; iteration errors (mid-stream socket drop) are surfaced as a thrown `Error` from the iterator, which the presentation layer wraps with `Result.tryAsyncCatch` at the consumption site.

**Why not full streaming on input.** Phase 4 prompts are short hardcoded strings — there is no need for streaming text in. We pass a single `string`; if Phase 5 needs partial-text streaming, we extend the port shape additively without breaking this contract.

**Audio container.** ElevenLabs streams MPEG (mp3) by default; we lock to `output_format: "mp3_44100_128"` for browser compatibility. Sample rate / format is encoded in the adapter constructor config, not on the port — the port stays codec-agnostic.

### D3 — Use case knows nothing about WebSockets

**Decision.** `RunScriptedInterviewSessionUseCase` accepts the two abstract stream handles directly:

```ts
{
  interviewId: InterviewId;
  candidateAudioIn: AsyncIterable<Uint8Array>;   // candidate microphone frames
  agentAudioOut: (chunk: Uint8Array) => Promise<void>; // back-pressured sink
  // …
}
```

The presentation layer converts WebSocket frames to/from these shapes:

- **Inbound** (browser → backend): WS `binary` messages → push into an `AsyncQueue<Uint8Array>` exposed as an `AsyncIterable`. WS close → end-of-iteration.
- **Outbound** (backend → browser): each chunk yielded by the TTS iterator → `socket.send(chunk, { binary: true })`. Errors propagate as `Result.Err` from the use case.

This keeps the use case framework-free and trivially unit-testable with in-memory iterators.

### D4 — Hardcoded script lives next to the use case as a sibling const file

**Decision.** `packages/application/src/use-cases/interview/scripted-interview-script.ts` exports `SCRIPTED_INTERVIEW_QUESTIONS: readonly string[]`. The use case imports it directly. **Not** in domain (it's not a domain rule), not in infrastructure (it's not env-driven), not inline in the use case (we want a single grep target when Phase 5 deletes it).

The file ships with a TODO header: `// TODO(phase-5): delete this file when ConductInterview replaces RunScriptedInterviewSession.`

The questions themselves: 4 generic technical-screen questions, no role-specific content. Picked to exercise the loop, not to interview anyone.

### D5 — WebSocket library: `@fastify/websocket` v11 (matching Fastify 5)

**Decision.** Add `@fastify/websocket` as a backend dependency. Pin the version range to `^11.0.0` (the line that targets Fastify 5). Other contenders (`ws` directly, `socket.io`) were rejected: `ws` requires hand-rolling the upgrade handshake into Fastify's lifecycle; `socket.io` adds a protocol layer browsers don't need for raw audio frames.

### D6 — OTel span structure mirrors ARCHITECTURE.md §4.6

**Decision.** One **session span** per WebSocket connection (root for the Phase 4 trace). Per scripted question, two **child spans**:

```
session: interview.session.scripted   (interviewId, scriptVersion)
├── turn: interview.turn.tts          (questionIndex, characterCount, audioDurationMs, latencyToFirstChunkMs, model, voiceId)
└── turn: interview.turn.stt          (questionIndex, audioSeconds, words, finalConfidence, latencyMs, model)
```

The session span is opened by the presentation controller on WebSocket upgrade and closed in the `finally` of the controller. Each turn span is opened by the **adapter** (not the use case) and closed when the underlying SDK call completes — this keeps span boundaries aligned with infra failure modes. The use case sets the active context (via OTel `context.with(...)`) before each adapter call so the adapter's spans become children of the session span automatically.

OTel tracer access: `import { trace, context } from "@opentelemetry/api"` — already a transitive dependency via `@opentelemetry/sdk-node`.

### D7 — Fail-closed providers, env-driven config, mirror Gemini provider pattern

Both adapters follow the same shape as `gemini/provider.ts`:

- `buildDeepgramClient({ apiKey, defaultModel })` → `Result<DeepgramClientHandle, ServiceUnavailableError>`
- `deepgramClientFromEnv(env)` reads `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_SAMPLE_RATE`
- Same shape for ElevenLabs with `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_OUTPUT_FORMAT`

Missing key → `Result.Err(new ServiceUnavailableError("…"))`. Tests pass without live keys.

---

## Implementation steps (file-by-file, batched in dependency order)

Each batch is independently runnable: at the end of each batch, run the verification commands listed under it and confirm clean before moving on.

### Batch A — Application ports + DTO + use case (no infra yet)

#### A1. Create STT port error file

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/speech-to-text/speech-to-text-error.ts` (CREATE)

**What:** Define the `SttError` hierarchy. Mirror `DocumentExtractionError`.

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class SttError extends ServiceInfraError {}

export class SttUnavailableError extends SttError {
  readonly code = "STT_UNAVAILABLE";
}

export class SttStreamError extends SttError {
  readonly code = "STT_STREAM_ERROR";
  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class SttUnknownError extends SttError {
  readonly code = "STT_UNKNOWN";
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
```

**Invariant check:** Subclasses of `ServiceInfraError`; no domain leakage; immutable readonly fields.

#### A2. Create STT port interface

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/speech-to-text/speech-to-text.port.ts` (CREATE)

**What:** Stream-shaped port. No Deepgram types. Async-iterable in, async-iterable out.

```typescript
import type { Result } from "@carbonteq/fp";
import type { SttError } from "./speech-to-text-error.js";

export interface TranscriptChunk {
  readonly text: string;
  readonly isFinal: boolean;
  readonly confidence?: number;
  readonly receivedAt: Date;
}

export interface SttSessionContext {
  readonly interviewId: string;
  readonly turnIndex: number;
}

export interface ISpeechToTextService {
  /**
   * Opens a streaming transcription session. The returned iterator yields
   * one `TranscriptChunk` per Deepgram message; iteration ends when either
   * `audioFrames` finishes or the upstream STT socket closes cleanly.
   *
   * Connection failures (auth, model not found) surface as `Result.Err` from
   * the outer Promise. Mid-stream errors throw from the iterator; the caller
   * must wrap consumption in `Result.tryAsyncCatch`.
   */
  transcribe(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<Result<AsyncIterable<TranscriptChunk>, SttError>>;
}
```

**Invariant check:** Promise<Result<…>> wrapper for setup failures; no `null`; no callbacks; pure ESM imports; type-only domain imports (none here).

#### A3. STT port barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/speech-to-text/index.ts` (CREATE)

```typescript
export type {
  ISpeechToTextService,
  SttSessionContext,
  TranscriptChunk,
} from "./speech-to-text.port.js";
export {
  SttError,
  SttUnavailableError,
  SttStreamError,
  SttUnknownError,
} from "./speech-to-text-error.js";
```

#### A4. Create TTS port error file

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/text-to-speech/text-to-speech-error.ts` (CREATE)

```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class TtsError extends ServiceInfraError {}

export class TtsUnavailableError extends TtsError {
  readonly code = "TTS_UNAVAILABLE";
}

export class TtsStreamError extends TtsError {
  readonly code = "TTS_STREAM_ERROR";
  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class TtsUnknownError extends TtsError {
  readonly code = "TTS_UNKNOWN";
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
```

#### A5. Create TTS port interface

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/text-to-speech/text-to-speech.port.ts` (CREATE)

```typescript
import type { Result } from "@carbonteq/fp";
import type { TtsError } from "./text-to-speech-error.js";

export interface TtsSessionContext {
  readonly interviewId: string;
  readonly turnIndex: number;
}

export interface ITextToSpeechService {
  /**
   * Synthesises `text` and returns a stream of binary audio chunks in the
   * adapter's configured container (e.g. mp3_44100_128 for ElevenLabs).
   * Connection / auth / 4xx failures surface as `Result.Err`. Mid-stream
   * errors throw from the iterator.
   */
  synthesize(
    text: string,
    ctx: TtsSessionContext,
  ): Promise<Result<AsyncIterable<Uint8Array>, TtsError>>;
}
```

#### A6. TTS port barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/text-to-speech/index.ts` (CREATE)

```typescript
export type {
  ITextToSpeechService,
  TtsSessionContext,
} from "./text-to-speech.port.js";
export {
  TtsError,
  TtsUnavailableError,
  TtsStreamError,
  TtsUnknownError,
} from "./text-to-speech-error.js";
```

#### A7. Update ports root barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/ports/index.ts` (MODIFY)

```typescript
export * from "./storage/index.js";
export * from "./document-extraction/index.js";
export * from "./interview-planner/index.js";
export * from "./speech-to-text/index.js";
export * from "./text-to-speech/index.js";
```

**Invariant check:** Public ports must be re-exported from the package barrel.

#### A8. Create the hardcoded script file

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/scripted-interview-script.ts` (CREATE)

```typescript
// TODO(phase-5): delete this file when ConductInterview replaces RunScriptedInterviewSession.

export const SCRIPTED_INTERVIEW_QUESTIONS: readonly string[] = [
  "Hi, thanks for joining. Could you start by introducing yourself and walking through your most recent project?",
  "What is the part of that project you're most proud of, and what made it hard?",
  "When something in production breaks, what's your typical first move?",
  "That's all from me. Is there anything you'd like to ask before we wrap up?",
] as const;

export const SCRIPT_VERSION = "phase-4-spike-v1";
```

**Invariant check:** Pure data, no side effects, frozen-at-source.

#### A9. Create the run-scripted-interview DTO

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/dtos/run-scripted-interview-session.dto.ts` (CREATE)

```typescript
import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { TranscriptEntryProps } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const RunScriptedInterviewSessionInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type RunScriptedInterviewSessionInput = z.infer<
  typeof RunScriptedInterviewSessionInputSchema
>;

export class RunScriptedInterviewSessionInputDto extends BaseDto<RunScriptedInterviewSessionInput> {
  static parse(
    raw: unknown,
  ): Result<RunScriptedInterviewSessionInputDto, DtoValidationError> {
    return BaseDto.validate(RunScriptedInterviewSessionInputSchema, raw).map(
      (v) => new RunScriptedInterviewSessionInputDto(v),
    );
  }
}

export interface RunScriptedInterviewSessionOutput {
  readonly interviewId: string;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly turnsCompleted: number;
  readonly scriptVersion: string;
}
```

#### A10. Update DTOs barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/dtos/index.ts` (MODIFY)

Append:

```typescript
export {
  RunScriptedInterviewSessionInputDto,
  RunScriptedInterviewSessionInputSchema,
} from "./run-scripted-interview-session.dto.js";
export type {
  RunScriptedInterviewSessionInput,
  RunScriptedInterviewSessionOutput,
} from "./run-scripted-interview-session.dto.js";
```

#### A11. Create the scripted-interview use case

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  SPEAKER,
  TranscriptEntry,
  type TranscriptEntryProps,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";
import type {
  ISpeechToTextService,
  TranscriptChunk,
} from "../../ports/speech-to-text/index.js";
import type { ITextToSpeechService } from "../../ports/text-to-speech/index.js";
import type { RunScriptedInterviewSessionOutput } from "../../dtos/run-scripted-interview-session.dto.js";
import {
  SCRIPT_VERSION,
  SCRIPTED_INTERVIEW_QUESTIONS,
} from "./scripted-interview-script.js";

export interface RunScriptedInterviewSessionDeps {
  readonly stt: ISpeechToTextService;
  readonly tts: ITextToSpeechService;
}

/**
 * Phase 4 spike. The presentation layer adapts the WebSocket into:
 *  - `candidateAudioIn`: AsyncIterable of inbound binary frames
 *  - `agentAudioOut`:   sink that writes outbound TTS chunks to the WS
 * The use case stays framework-free.
 */
export interface RunScriptedInterviewSessionRuntimeInput {
  readonly interviewId: string;
  readonly candidateAudioIn: AsyncIterable<Uint8Array>;
  readonly agentAudioOut: (chunk: Uint8Array) => Promise<void>;
  /** abort signal flipped when WS closes from the browser side */
  readonly abortSignal: AbortSignal;
  readonly clock?: () => Date;
}

export class RunScriptedInterviewSessionUseCase extends UseCase<
  RunScriptedInterviewSessionRuntimeInput,
  RunScriptedInterviewSessionOutput
> {
  constructor(private readonly deps: RunScriptedInterviewSessionDeps) {
    super();
  }

  async execute(
    input: RunScriptedInterviewSessionRuntimeInput,
  ): Promise<Result<RunScriptedInterviewSessionOutput, ServiceError>> {
    const clock = input.clock ?? (() => new Date());
    const transcript: TranscriptEntryProps[] = [];

    // candidate audio is shared across every STT turn — one queue, many readers
    const sharedCandidate = teeAsyncIterable(input.candidateAudioIn);

    for (let i = 0; i < SCRIPTED_INTERVIEW_QUESTIONS.length; i++) {
      if (input.abortSignal.aborted) break;

      const question = SCRIPTED_INTERVIEW_QUESTIONS[i] as string;

      // 1. TTS — speak the question
      const ttsResult = await this.deps.tts.synthesize(question, {
        interviewId: input.interviewId,
        turnIndex: i,
      });
      if (ttsResult.isErr()) {
        return Result.Err(ttsResult.unwrapErr() as ServiceError);
      }

      const speakResult = await Result.tryAsyncCatch(
        async () => {
          for await (const chunk of ttsResult.unwrap()) {
            if (input.abortSignal.aborted) break;
            await input.agentAudioOut(chunk);
          }
        },
        (err) =>
          new ServiceUnknownError(
            err instanceof Error ? err.message : String(err),
            "ScriptedInterview.tts.consume",
          ),
      ).toPromise();
      if (speakResult.isErr()) return Result.Err(speakResult.unwrapErr());

      const agentEntry = TranscriptEntry.create({
        speaker: SPEAKER.AGENT,
        text: question,
        timestamp: clock(),
      });
      if (agentEntry.isErr()) {
        return Result.Err(agentEntry.unwrapErr() as ServiceError);
      }
      transcript.push(agentEntry.unwrap().serialize());

      // 2. STT — wait for the candidate's reply (one final transcript)
      const candidateChunkIter = sharedCandidate.next();
      const sttResult = await this.deps.stt.transcribe(candidateChunkIter, {
        interviewId: input.interviewId,
        turnIndex: i,
      });
      if (sttResult.isErr()) {
        return Result.Err(sttResult.unwrapErr() as ServiceError);
      }

      const finalText = await collectFinalTranscript(
        sttResult.unwrap(),
        input.abortSignal,
      );
      if (finalText.isErr()) return Result.Err(finalText.unwrapErr());

      const candidateEntry = TranscriptEntry.create({
        speaker: SPEAKER.CANDIDATE,
        text: finalText.unwrap(),
        timestamp: clock(),
      });
      if (candidateEntry.isErr()) {
        return Result.Err(candidateEntry.unwrapErr() as ServiceError);
      }
      transcript.push(candidateEntry.unwrap().serialize());
    }

    return Result.Ok({
      interviewId: input.interviewId,
      transcript,
      turnsCompleted: SCRIPTED_INTERVIEW_QUESTIONS.length,
      scriptVersion: SCRIPT_VERSION,
    });
  }
}

// ── helpers (private to this module) ───────────────────────────────────

interface CandidateAudioTee {
  next(): AsyncIterable<Uint8Array>;
}

/**
 * Splits the upstream candidate audio iterator into per-turn slices. Each call
 * to `.next()` returns an iterable that yields frames until either:
 *   - `endTurn()` is signalled (caller decides — e.g. STT final fired), or
 *   - upstream finishes.
 *
 * For Phase 4 the simplest workable rule is: one turn ends when STT emits its
 * first `isFinal` chunk. The STT helper below closes the slice after that.
 */
function teeAsyncIterable(
  upstream: AsyncIterable<Uint8Array>,
): CandidateAudioTee {
  // Implementation note: see test `tee-async-iterable.test.ts` — uses an
  // internal queue + per-slice gate. Concrete implementation lives next to
  // this file: `scripted-interview-tee.ts`. Kept in same package because it
  // is application-layer plumbing, not domain.
  // (Body deliberately stubbed in this plan — exact code in Step A12.)
  throw new Error("see Step A12 for implementation");
}

async function collectFinalTranscript(
  chunks: AsyncIterable<TranscriptChunk>,
  abort: AbortSignal,
): Promise<Result<string, ServiceError>> {
  return Result.tryAsyncCatch(
    async () => {
      const buf: string[] = [];
      for await (const c of chunks) {
        if (abort.aborted) break;
        if (c.isFinal) {
          buf.push(c.text);
          break; // first final ends the turn
        }
      }
      return buf.join(" ").trim();
    },
    (err) =>
      new ServiceUnknownError(
        err instanceof Error ? err.message : String(err),
        "ScriptedInterview.stt.consume",
      ),
  ).toPromise();
}
```

**Invariant check:**
- No `throw`, no `try/catch` in the production path — `Result.tryAsyncCatch` wraps the imperative `for await` loops.
- Every domain construction (`TranscriptEntry.create`) is checked with `isErr()` before unwrap.
- No infrastructure or framework imports.
- Output is serialized props, not entity references — keeps the response cleanly cross-process.

#### A12. Create the tee helper

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/scripted-interview-tee.ts` (CREATE)

```typescript
/**
 * Per-turn slice of an upstream candidate-audio iterator. Phase 4 only.
 *
 * Each `.next()` returns an `AsyncIterable<Uint8Array>` that pulls from the
 * shared queue until the slice is closed via `endCurrent()`. The use case
 * calls `endCurrent()` once STT emits an `isFinal` chunk for the turn.
 */
export interface CandidateAudioTee {
  next(): AsyncIterable<Uint8Array>;
  endCurrent(): void;
  closeAll(): void;
}

export function teeCandidateAudio(
  upstream: AsyncIterable<Uint8Array>,
): CandidateAudioTee {
  const queue: Uint8Array[] = [];
  let pendingResolve: ((v: IteratorResult<Uint8Array>) => void) | null = null;
  let upstreamDone = false;
  let sliceOpen = false;
  let allClosed = false;

  // pump upstream into the queue
  void (async () => {
    try {
      for await (const frame of upstream) {
        if (allClosed) return;
        if (pendingResolve && sliceOpen) {
          const r = pendingResolve;
          pendingResolve = null;
          r({ value: frame, done: false });
        } else if (sliceOpen) {
          queue.push(frame);
        }
        // if no slice is open, drop frames silently — the model is half-duplex
      }
    } finally {
      upstreamDone = true;
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r({ value: undefined as never, done: true });
      }
    }
  })();

  const next = (): AsyncIterable<Uint8Array> => {
    sliceOpen = true;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (!sliceOpen || allClosed) return { value: undefined as never, done: true };
            if (queue.length > 0) return { value: queue.shift() as Uint8Array, done: false };
            if (upstreamDone) return { value: undefined as never, done: true };
            return new Promise((resolve) => {
              pendingResolve = resolve;
            });
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            return { value: undefined as never, done: true };
          },
        };
      },
    };
  };

  const endCurrent = (): void => {
    sliceOpen = false;
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r({ value: undefined as never, done: true });
    }
  };

  const closeAll = (): void => {
    allClosed = true;
    endCurrent();
  };

  return { next, endCurrent, closeAll };
}
```

**Invariant check:** Pure JS, no externals; the `void (async () => …)` wrapper is acceptable here because the inner errors flow back through the consumer's `for await` (which is wrapped by `Result.tryAsyncCatch` upstream). No silent error swallowing — finally block flips `upstreamDone`.

> **Note for the implementing agent.** Adjust `RunScriptedInterviewSessionUseCase` to import `teeCandidateAudio` from `./scripted-interview-tee.js`, replace the placeholder `teeAsyncIterable` body with a direct call, and call `tee.endCurrent()` after each `collectFinalTranscript` resolves. The `collectFinalTranscript` helper should also call back into the tee — pass it as an extra argument or restructure as a closure. The cleanest shape is one inline turn function inside `execute()`. Keep the tee stateful per-call to `execute()`.

#### A13. Update use-cases barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/use-cases/interview/index.ts` (MODIFY)

```typescript
export { CreateInterviewUseCase } from "./create-interview.use-case.js";
export { GenerateInterviewPlanUseCase } from "./generate-interview-plan.use-case.js";
export {
  RunScriptedInterviewSessionUseCase,
  type RunScriptedInterviewSessionDeps,
  type RunScriptedInterviewSessionRuntimeInput,
} from "./run-scripted-interview-session.use-case.js";
export {
  SCRIPTED_INTERVIEW_QUESTIONS,
  SCRIPT_VERSION,
} from "./scripted-interview-script.js";
```

#### A14. Tests for Batch A

**Files (CREATE):**

- `packages/application/src/dtos/run-scripted-interview-session.dto.test.ts`
- `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.test.ts`
- `packages/application/src/use-cases/interview/scripted-interview-tee.test.ts`

**Test categories:**

| File | Tests |
|---|---|
| `run-scripted-interview-session.dto.test.ts` | parse with valid `interviewId`, parse rejects empty `interviewId`, parse rejects non-object input |
| `run-scripted-interview-session.use-case.test.ts` | happy path (4 questions → 8 transcript entries), STT setup error short-circuits, TTS setup error short-circuits, mid-stream STT error surfaces as ServiceUnknownError, abortSignal aborts mid-loop, agent transcript entries marked SPEAKER.AGENT, candidate entries marked SPEAKER.CANDIDATE |
| `scripted-interview-tee.test.ts` | next() returns slice, endCurrent terminates iteration, frames dropped when no slice open, closeAll terminates pending reader |

**Mocks:** in-memory `ISpeechToTextService` and `ITextToSpeechService` test doubles. Never mock `Result` or domain types.

#### Batch A verification

```bash
pnpm turbo run check-types --filter=@repo/application
pnpm turbo run test --filter=@repo/application
```

Both must pass before Batch B.

---

### Batch B — Infrastructure: Deepgram STT adapter

#### B1. Add `@fastify/websocket` to backend dependencies

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/package.json` (MODIFY)

Add to `dependencies`:

```json
"@fastify/websocket": "^11.0.0"
```

(Implementing agent: run `pnpm install` from repo root.)

#### B2. Create Deepgram provider factory

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/deepgram/provider.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { createClient, type DeepgramClient } from "@deepgram/sdk";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_DEEPGRAM_MODEL = "nova-3";
export const DEFAULT_DEEPGRAM_LANGUAGE = "en-US";
export const DEFAULT_DEEPGRAM_SAMPLE_RATE = 16000;
export const DEFAULT_DEEPGRAM_ENCODING = "linear16";

export interface DeepgramProviderConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultLanguage?: string;
  readonly defaultSampleRate?: number;
  readonly defaultEncoding?: string;
}

export interface DeepgramClientHandle {
  readonly client: DeepgramClient;
  readonly defaultModel: string;
  readonly defaultLanguage: string;
  readonly defaultSampleRate: number;
  readonly defaultEncoding: string;
}

export const buildDeepgramClient = (
  config: DeepgramProviderConfig,
): Result<DeepgramClientHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(
      new ServiceUnavailableError("DEEPGRAM_API_KEY is required for Deepgram adapters"),
    );
  }

  return Result.Ok({
    client: createClient(config.apiKey),
    defaultModel: config.defaultModel ?? DEFAULT_DEEPGRAM_MODEL,
    defaultLanguage: config.defaultLanguage ?? DEFAULT_DEEPGRAM_LANGUAGE,
    defaultSampleRate: config.defaultSampleRate ?? DEFAULT_DEEPGRAM_SAMPLE_RATE,
    defaultEncoding: config.defaultEncoding ?? DEFAULT_DEEPGRAM_ENCODING,
  });
};

export const deepgramClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<DeepgramClientHandle, ServiceUnavailableError> => {
  const apiKey = env["DEEPGRAM_API_KEY"];
  if (!apiKey) {
    return Result.Err(
      new ServiceUnavailableError("DEEPGRAM_API_KEY is required for Deepgram adapters"),
    );
  }

  const sampleRateRaw = env["DEEPGRAM_SAMPLE_RATE"];
  const parsedSampleRate = sampleRateRaw ? Number(sampleRateRaw) : undefined;

  return buildDeepgramClient({
    apiKey,
    defaultModel: env["DEEPGRAM_MODEL"] ?? DEFAULT_DEEPGRAM_MODEL,
    defaultLanguage: env["DEEPGRAM_LANGUAGE"] ?? DEFAULT_DEEPGRAM_LANGUAGE,
    defaultSampleRate:
      parsedSampleRate && Number.isFinite(parsedSampleRate)
        ? parsedSampleRate
        : DEFAULT_DEEPGRAM_SAMPLE_RATE,
    defaultEncoding: env["DEEPGRAM_ENCODING"] ?? DEFAULT_DEEPGRAM_ENCODING,
  });
};
```

**Invariant check:** Mirrors `gemini/provider.ts` exactly. Fail-closed. No throws.

#### B3. Create Deepgram STT adapter

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { LiveTranscriptionEvents } from "@deepgram/sdk";
import {
  type ISpeechToTextService,
  type SttError,
  type SttSessionContext,
  SttStreamError,
  SttUnavailableError,
  SttUnknownError,
  type TranscriptChunk,
} from "@repo/application";
import { trace, type Span } from "@opentelemetry/api";
import type { DeepgramClientHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.deepgram");

export class DeepgramSpeechToTextService implements ISpeechToTextService {
  constructor(private readonly handle: DeepgramClientHandle) {}

  async transcribe(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<Result<AsyncIterable<TranscriptChunk>, SttError>> {
    return Result.tryAsyncCatch(
      async () => this.openLive(audioFrames, ctx),
      (err) => mapSetupError(err, ctx),
    ).toPromise();
  }

  private async openLive(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<AsyncIterable<TranscriptChunk>> {
    const span: Span = tracer.startSpan("interview.turn.stt", {
      attributes: {
        "interview.id": ctx.interviewId,
        "interview.turn_index": ctx.turnIndex,
        "stt.model": this.handle.defaultModel,
        "stt.language": this.handle.defaultLanguage,
        "stt.sample_rate": this.handle.defaultSampleRate,
        "stt.encoding": this.handle.defaultEncoding,
      },
    });

    const startMs = Date.now();
    const live = this.handle.client.listen.live({
      model: this.handle.defaultModel,
      language: this.handle.defaultLanguage,
      sample_rate: this.handle.defaultSampleRate,
      encoding: this.handle.defaultEncoding,
      smart_format: true,
      interim_results: true,
    });

    // Bridge Deepgram events → bounded queue
    const queue: TranscriptChunk[] = [];
    let chunkResolve: ((v: IteratorResult<TranscriptChunk>) => void) | null = null;
    let closed = false;
    let socketError: Error | null = null;
    let words = 0;
    let lastFinalConfidence: number | undefined;

    const push = (c: TranscriptChunk): void => {
      if (closed) return;
      if (chunkResolve) {
        const r = chunkResolve;
        chunkResolve = null;
        r({ value: c, done: false });
      } else {
        queue.push(c);
      }
    };

    const endStream = (): void => {
      if (closed) return;
      closed = true;
      const audioMs = Date.now() - startMs;
      span.setAttribute("stt.latency_ms", audioMs);
      span.setAttribute("stt.words", words);
      if (lastFinalConfidence !== undefined) {
        span.setAttribute("stt.final_confidence", lastFinalConfidence);
      }
      span.end();
      if (chunkResolve) {
        const r = chunkResolve;
        chunkResolve = null;
        if (socketError) {
          r(Promise.reject(socketError) as never);
        } else {
          r({ value: undefined as never, done: true });
        }
      }
    };

    live.on(LiveTranscriptionEvents.Open, () => {
      // pump audio frames into the live socket; the wait until OPEN is required
      void (async () => {
        try {
          for await (const frame of audioFrames) {
            if (closed) break;
            live.send(frame);
          }
          live.requestClose();
        } catch (err) {
          socketError = err instanceof Error ? err : new Error(String(err));
          live.requestClose();
        }
      })();
    });

    live.on(LiveTranscriptionEvents.Transcript, (msg: unknown) => {
      const parsed = parseDeepgramTranscript(msg);
      if (!parsed) return;
      if (parsed.isFinal) {
        words += parsed.text.split(/\s+/).filter(Boolean).length;
        lastFinalConfidence = parsed.confidence;
      }
      push(parsed);
    });

    live.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      socketError = err instanceof Error ? err : new Error(String(err));
      span.recordException(socketError);
    });

    live.on(LiveTranscriptionEvents.Close, () => {
      endStream();
    });

    const iterable: AsyncIterable<TranscriptChunk> = {
      [Symbol.asyncIterator](): AsyncIterator<TranscriptChunk> {
        return {
          async next(): Promise<IteratorResult<TranscriptChunk>> {
            if (queue.length > 0) {
              return { value: queue.shift() as TranscriptChunk, done: false };
            }
            if (closed) {
              if (socketError) throw socketError;
              return { value: undefined as never, done: true };
            }
            return new Promise<IteratorResult<TranscriptChunk>>((resolve, reject) => {
              chunkResolve = (r) => {
                if ("then" in (r as object)) {
                  void (r as unknown as Promise<never>).catch(reject);
                } else {
                  resolve(r);
                }
              };
            });
          },
          async return(): Promise<IteratorResult<TranscriptChunk>> {
            endStream();
            return { value: undefined as never, done: true };
          },
        };
      },
    };

    return iterable;
  }
}

interface ParsedTranscript {
  text: string;
  isFinal: boolean;
  confidence?: number;
  receivedAt: Date;
}

function parseDeepgramTranscript(msg: unknown): ParsedTranscript | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  const channel = m["channel"] as Record<string, unknown> | undefined;
  if (!channel) return null;
  const alternatives = channel["alternatives"] as Array<Record<string, unknown>> | undefined;
  const first = alternatives?.[0];
  if (!first) return null;
  const text = typeof first["transcript"] === "string" ? first["transcript"] : "";
  if (!text) return null;
  return {
    text,
    isFinal: m["is_final"] === true,
    confidence:
      typeof first["confidence"] === "number" ? (first["confidence"] as number) : undefined,
    receivedAt: new Date(),
  };
}

function mapSetupError(err: unknown, ctx: SttSessionContext): SttError {
  if (!(err instanceof Error)) {
    return new SttUnknownError(String(err), "DeepgramSpeechToTextService.transcribe");
  }
  const msg = err.message.toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("401") ||
    msg.includes("403")
  ) {
    return new SttUnavailableError(`Deepgram unavailable: ${err.message}`);
  }
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("timeout")
  ) {
    return new SttUnavailableError(`Deepgram unavailable: ${err.message}`);
  }
  return new SttStreamError(err.message, ctx.interviewId);
}
```

**Invariant check:**
- Outer `Result.tryAsyncCatch` for setup; mid-stream errors thrown from the async iterator (caller wraps).
- OTel span lifecycle bound to socket open/close.
- No throws in production paths except inside the iterator boundary, which is the documented contract.
- Error mapper translates auth/network/timeout to `SttUnavailableError`, everything else to `SttStreamError`.

#### B4. Deepgram barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/deepgram/index.ts` (CREATE)

```typescript
export {
  buildDeepgramClient,
  deepgramClientFromEnv,
  DEFAULT_DEEPGRAM_MODEL,
  DEFAULT_DEEPGRAM_LANGUAGE,
  DEFAULT_DEEPGRAM_SAMPLE_RATE,
  DEFAULT_DEEPGRAM_ENCODING,
} from "./provider.js";
export type { DeepgramClientHandle, DeepgramProviderConfig } from "./provider.js";
export { DeepgramSpeechToTextService } from "./deepgram-stt.service.js";
```

#### B5. Tests for Batch B

**Files (CREATE):**

- `apps/backend/src/infrastructure/services/deepgram/provider.test.ts`
- `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.test.ts`

**Test categories:**

| File | Tests |
|---|---|
| `provider.test.ts` | blank apiKey → Err(ServiceUnavailableError); valid apiKey → Ok with default model/lang/sr/encoding; env builder reads DEEPGRAM_MODEL etc.; missing env key → Err |
| `deepgram-stt.service.test.ts` | mock `@deepgram/sdk` `createClient` + `listen.live`; happy path: Open event triggers audio pump, Transcript event → TranscriptChunk yielded, Close ends iterator; auth-like setup error → `SttUnavailableError`; mid-stream Error event throws from iterator; transcript parser rejects malformed payloads |

**Mock strategy:** mock the Deepgram SDK at module level (`vi.mock("@deepgram/sdk", …)`). Provide a fake `live` object with `on`/`send`/`requestClose` so we can drive events synchronously from the test.

#### Batch B verification

```bash
pnpm turbo run check-types --filter=backend
pnpm turbo run test --filter=backend
```

---

### Batch C — Infrastructure: ElevenLabs TTS adapter

#### C1. Create ElevenLabs provider factory

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/elevenlabs/provider.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import { ElevenLabsClient } from "elevenlabs";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";
export const DEFAULT_ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" stock voice
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

export interface ElevenLabsProviderConfig {
  readonly apiKey: string;
  readonly defaultVoiceId?: string;
  readonly defaultModelId?: string;
  readonly defaultOutputFormat?: string;
}

export interface ElevenLabsClientHandle {
  readonly client: ElevenLabsClient;
  readonly defaultVoiceId: string;
  readonly defaultModelId: string;
  readonly defaultOutputFormat: string;
}

export const buildElevenLabsClient = (
  config: ElevenLabsProviderConfig,
): Result<ElevenLabsClientHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(
      new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs adapters"),
    );
  }

  return Result.Ok({
    client: new ElevenLabsClient({ apiKey: config.apiKey }),
    defaultVoiceId: config.defaultVoiceId ?? DEFAULT_ELEVENLABS_VOICE_ID,
    defaultModelId: config.defaultModelId ?? DEFAULT_ELEVENLABS_MODEL_ID,
    defaultOutputFormat: config.defaultOutputFormat ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  });
};

export const elevenLabsClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<ElevenLabsClientHandle, ServiceUnavailableError> => {
  const apiKey = env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    return Result.Err(
      new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs adapters"),
    );
  }
  return buildElevenLabsClient({
    apiKey,
    defaultVoiceId: env["ELEVENLABS_VOICE_ID"] ?? DEFAULT_ELEVENLABS_VOICE_ID,
    defaultModelId: env["ELEVENLABS_MODEL_ID"] ?? DEFAULT_ELEVENLABS_MODEL_ID,
    defaultOutputFormat:
      env["ELEVENLABS_OUTPUT_FORMAT"] ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  });
};
```

#### C2. Create ElevenLabs TTS adapter

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts` (CREATE)

```typescript
import { Result } from "@carbonteq/fp";
import {
  type ITextToSpeechService,
  type TtsError,
  type TtsSessionContext,
  TtsStreamError,
  TtsUnavailableError,
  TtsUnknownError,
} from "@repo/application";
import { trace, type Span } from "@opentelemetry/api";
import type { ElevenLabsClientHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.elevenlabs");

export class ElevenLabsTextToSpeechService implements ITextToSpeechService {
  constructor(private readonly handle: ElevenLabsClientHandle) {}

  async synthesize(
    text: string,
    ctx: TtsSessionContext,
  ): Promise<Result<AsyncIterable<Uint8Array>, TtsError>> {
    if (!text.trim()) {
      return Result.Err(
        new TtsStreamError("ElevenLabs synthesize received empty text", ctx.interviewId),
      );
    }

    const span: Span = tracer.startSpan("interview.turn.tts", {
      attributes: {
        "interview.id": ctx.interviewId,
        "interview.turn_index": ctx.turnIndex,
        "tts.voice_id": this.handle.defaultVoiceId,
        "tts.model_id": this.handle.defaultModelId,
        "tts.output_format": this.handle.defaultOutputFormat,
        "tts.character_count": text.length,
      },
    });

    return Result.tryAsyncCatch(
      async () => {
        const startMs = Date.now();
        const stream = await this.handle.client.textToSpeech.convertAsStream(
          this.handle.defaultVoiceId,
          {
            text,
            model_id: this.handle.defaultModelId,
            output_format: this.handle.defaultOutputFormat,
          },
        );

        let firstChunkSeen = false;
        let totalBytes = 0;

        return wrapStream(stream, {
          onFirstChunk: (bytes) => {
            firstChunkSeen = true;
            totalBytes += bytes;
            span.setAttribute("tts.latency_to_first_chunk_ms", Date.now() - startMs);
          },
          onChunk: (bytes) => {
            totalBytes += bytes;
          },
          onClose: () => {
            span.setAttribute("tts.total_bytes", totalBytes);
            if (!firstChunkSeen) {
              span.recordException(new Error("ElevenLabs stream produced no audio"));
            }
            span.end();
          },
          onError: (err) => {
            span.recordException(err);
            span.end();
          },
        });
      },
      (err) => {
        span.end();
        return mapSetupError(err, ctx);
      },
    ).toPromise();
  }
}

interface StreamHooks {
  readonly onFirstChunk: (bytes: number) => void;
  readonly onChunk: (bytes: number) => void;
  readonly onClose: () => void;
  readonly onError: (err: Error) => void;
}

function wrapStream(
  stream: AsyncIterable<Uint8Array> | NodeJS.ReadableStream,
  hooks: StreamHooks,
): AsyncIterable<Uint8Array> {
  // ElevenLabs SDK returns a Node Readable for `convertAsStream` — both Node
  // Readable and AsyncIterable<Uint8Array> work with `for await`. Normalise to
  // AsyncIterable<Uint8Array>.
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      let first = true;
      try {
        for await (const raw of stream as AsyncIterable<Uint8Array | Buffer>) {
          const buf =
            raw instanceof Uint8Array
              ? raw
              : new Uint8Array((raw as Buffer).buffer, (raw as Buffer).byteOffset, (raw as Buffer).byteLength);
          if (first) {
            first = false;
            hooks.onFirstChunk(buf.byteLength);
          } else {
            hooks.onChunk(buf.byteLength);
          }
          yield buf;
        }
        hooks.onClose();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        hooks.onError(e);
        throw e;
      }
    },
  };
}

function mapSetupError(err: unknown, ctx: TtsSessionContext): TtsError {
  if (!(err instanceof Error)) {
    return new TtsUnknownError(String(err), "ElevenLabsTextToSpeechService.synthesize");
  }
  const msg = err.message.toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("401") ||
    msg.includes("403")
  ) {
    return new TtsUnavailableError(`ElevenLabs unavailable: ${err.message}`);
  }
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("timeout")
  ) {
    return new TtsUnavailableError(`ElevenLabs unavailable: ${err.message}`);
  }
  return new TtsStreamError(err.message, ctx.interviewId);
}
```

**Invariant check:** `Result.tryAsyncCatch` wraps the SDK call; iterator errors throw out of the async generator (documented contract). Span is closed on every exit path including the early empty-text guard (which doesn't open the span).

> **Note:** the early empty-text guard returns `Result.Err` *before* opening the span. The implementing agent should keep the span creation after the guard.

#### C3. ElevenLabs barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/elevenlabs/index.ts` (CREATE)

```typescript
export {
  buildElevenLabsClient,
  elevenLabsClientFromEnv,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
} from "./provider.js";
export type { ElevenLabsClientHandle, ElevenLabsProviderConfig } from "./provider.js";
export { ElevenLabsTextToSpeechService } from "./elevenlabs-tts.service.js";
```

#### C4. Update services barrel

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/infrastructure/services/index.ts` (MODIFY)

```typescript
export { LocalFileStorageService, type LocalFileStorageConfig } from "./local-file-storage.service.js";
export * from "./gemini/index.js";
export * from "./deepgram/index.js";
export * from "./elevenlabs/index.js";
```

#### C5. Tests for Batch C

**Files (CREATE):**

- `apps/backend/src/infrastructure/services/elevenlabs/provider.test.ts`
- `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.test.ts`

**Test categories:**

| File | Tests |
|---|---|
| `provider.test.ts` | blank apiKey → Err; valid apiKey + env reads voice/model/format defaults; missing env → Err |
| `elevenlabs-tts.service.test.ts` | mock `elevenlabs` module; happy path: convertAsStream returns chunks, iterator yields Uint8Arrays; setup error (auth-like) → TtsUnavailableError; mid-stream error throws from iterator; empty text → TtsStreamError without opening span |

#### Batch C verification

```bash
pnpm turbo run check-types --filter=backend
pnpm turbo run test --filter=backend
```

---

### Batch D — Presentation: WebSocket route + composition root + latency harness

#### D1. Register `@fastify/websocket` plugin

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/app.ts` (MODIFY)

```typescript
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { registerInterviewSessionRoutes } from "./presentation/routes/interview-session.ws.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 }, // 1 MiB cap per WS frame; audio frames are kilobytes
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(registerInterviewSessionRoutes, { prefix: "/interviews" });

  return app;
}
```

**Invariant check:** Presentation only — registers a route module that itself wires composition.

#### D2. Create the WebSocket controller

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/controllers/interview-session.controller.ts` (CREATE)

```typescript
import type { WebSocket } from "@fastify/websocket";
import type { FastifyRequest } from "fastify";
import { Result } from "@carbonteq/fp";
import { trace, context as otelContext, type Span } from "@opentelemetry/api";
import {
  RunScriptedInterviewSessionInputDto,
  RunScriptedInterviewSessionUseCase,
  type RunScriptedInterviewSessionDeps,
  type ServiceError,
} from "@repo/application";
import {
  SttUnavailableError,
  TtsUnavailableError,
} from "@repo/application";

const sessionTracer = trace.getTracer("ai-interviewer.session");

const WS_CLOSE = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 1002,
  POLICY_VIOLATION: 1008,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012, // we use this for upstream STT/TTS unavailable
} as const;

export interface InterviewSessionDeps {
  readonly buildUseCaseDeps: () => RunScriptedInterviewSessionDeps;
}

export class InterviewSessionController {
  constructor(private readonly deps: InterviewSessionDeps) {}

  async handle(ws: WebSocket, req: FastifyRequest): Promise<void> {
    const params = req.params as { id?: string };
    const inputResult = RunScriptedInterviewSessionInputDto.parse({
      interviewId: params.id,
    });
    if (inputResult.isErr()) {
      ws.close(WS_CLOSE.POLICY_VIOLATION, "invalid interview id");
      return;
    }

    const interviewId = inputResult.unwrap().value.interviewId;
    const sessionSpan: Span = sessionTracer.startSpan("interview.session.scripted", {
      attributes: { "interview.id": interviewId },
    });
    const sessionCtx = trace.setSpan(otelContext.active(), sessionSpan);

    const abortController = new AbortController();
    ws.once("close", () => abortController.abort());
    ws.once("error", () => abortController.abort());

    const candidateAudioIn = wsBinaryToAsyncIterable(ws, abortController.signal);
    const agentAudioOut = async (chunk: Uint8Array): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        ws.send(chunk, (err) => (err ? reject(err) : resolve()));
      });
    };

    const useCase = new RunScriptedInterviewSessionUseCase(this.deps.buildUseCaseDeps());

    const result = await otelContext.with(sessionCtx, () =>
      useCase.execute({
        interviewId,
        candidateAudioIn,
        agentAudioOut,
        abortSignal: abortController.signal,
      }),
    );

    if (result.isErr()) {
      sessionSpan.recordException(result.unwrapErr());
      const code = mapErrorToWsClose(result.unwrapErr());
      ws.close(code, result.unwrapErr().message.slice(0, 120));
    } else {
      // Send a final JSON envelope with the transcript before closing
      const envelope = JSON.stringify({
        type: "session.completed",
        payload: result.unwrap(),
      });
      ws.send(envelope);
      ws.close(WS_CLOSE.NORMAL, "session complete");
    }
    sessionSpan.end();
  }
}

function wsBinaryToAsyncIterable(
  ws: WebSocket,
  abort: AbortSignal,
): AsyncIterable<Uint8Array> {
  const queue: Uint8Array[] = [];
  let pending: ((v: IteratorResult<Uint8Array>) => void) | null = null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (pending) {
      const r = pending;
      pending = null;
      r({ value: undefined as never, done: true });
    }
  };

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (pending) {
      const r = pending;
      pending = null;
      r({ value: u8, done: false });
    } else {
      queue.push(u8);
    }
  });
  ws.on("close", close);
  abort.addEventListener("abort", close, { once: true });

  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (queue.length > 0) return { value: queue.shift() as Uint8Array, done: false };
          if (closed) return { value: undefined as never, done: true };
          return new Promise<IteratorResult<Uint8Array>>((resolve) => {
            pending = resolve;
          });
        },
        async return() {
          close();
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

function mapErrorToWsClose(err: ServiceError): number {
  if (err instanceof SttUnavailableError || err instanceof TtsUnavailableError) {
    return WS_CLOSE.SERVICE_RESTART;
  }
  // Domain validation errors and unknown infra both close as policy violation
  // for now — Phase 7 will introduce richer mapping with HTTP routes.
  return WS_CLOSE.INTERNAL_ERROR;
}
```

**WebSocket close-code table** (for the implementing agent and ADR follow-up):

| Error | Close code | Mnemonic |
|---|---|---|
| DTO validation failed (bad `:id`) | 1008 POLICY_VIOLATION | input rejected |
| `SttUnavailableError` / `TtsUnavailableError` | 1012 SERVICE_RESTART | upstream down, retry later |
| `SttStreamError` / `TtsStreamError` / `ServiceUnknownError` | 1011 INTERNAL_ERROR | server bug |
| Use case Ok | 1000 NORMAL | clean exit |

#### D3. Create the WebSocket route module

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/routes/interview-session.ws.ts` (CREATE)

```typescript
import type { FastifyInstance } from "fastify";
import { InterviewSessionController } from "../controllers/interview-session.controller.js";
import { buildInterviewSessionDeps } from "../composition/interview-session.composition.js";

export async function registerInterviewSessionRoutes(app: FastifyInstance): Promise<void> {
  const deps = buildInterviewSessionDeps();
  const controller = new InterviewSessionController(deps);

  app.get("/:id/session", { websocket: true }, async (socket, req) => {
    await controller.handle(socket, req);
  });
}
```

#### D4. Create the composition root for the WS controller

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/presentation/composition/interview-session.composition.ts` (CREATE)

```typescript
import type { RunScriptedInterviewSessionDeps } from "@repo/application";
import { deepgramClientFromEnv, DeepgramSpeechToTextService } from "../../infrastructure/services/deepgram/index.js";
import {
  elevenLabsClientFromEnv,
  ElevenLabsTextToSpeechService,
} from "../../infrastructure/services/elevenlabs/index.js";

export interface InterviewSessionCompositionDeps {
  readonly buildUseCaseDeps: () => RunScriptedInterviewSessionDeps;
}

/**
 * Phase 4 composition root. Resolves env-driven clients once; the resulting
 * adapters are stateless across sessions, so we hand the same instances to
 * every WS connection. If clients are misconfigured, we fail closed at boot
 * (the throw here is a fatal startup error — the only place a throw is
 * acceptable, per the architectural rule about composition roots).
 */
export function buildInterviewSessionDeps(): InterviewSessionCompositionDeps {
  const dgHandleResult = deepgramClientFromEnv();
  if (dgHandleResult.isErr()) {
    throw new Error(`Boot failed: ${dgHandleResult.unwrapErr().message}`);
  }
  const elHandleResult = elevenLabsClientFromEnv();
  if (elHandleResult.isErr()) {
    throw new Error(`Boot failed: ${elHandleResult.unwrapErr().message}`);
  }

  const stt = new DeepgramSpeechToTextService(dgHandleResult.unwrap());
  const tts = new ElevenLabsTextToSpeechService(elHandleResult.unwrap());

  return {
    buildUseCaseDeps: () => ({ stt, tts }),
  };
}
```

**Invariant check:** Composition roots are the *only* place where Result-Err on missing env may legitimately throw, because they sit at the framework boot boundary (no Fastify request to bind to a graceful Result). Document this in the file header comment.

#### D5. Create the latency harness

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/src/scripts/measure-voice-latency.ts` (CREATE)

```typescript
/**
 * Phase 4 latency harness.
 *
 * Usage:
 *   tsx apps/backend/src/scripts/measure-voice-latency.ts \
 *     --wav ./fixtures/sample-reply.wav \
 *     --interview-id smoke-1 \
 *     --url ws://localhost:3002/interviews/smoke-1/session
 *
 * What it does:
 *   1. Opens a WebSocket to the backend.
 *   2. Waits for the first inbound binary frame (TTS audio of question 1).
 *   3. Times "WS open → first inbound TTS chunk" (turn 1 TTS warm-up).
 *   4. After each TTS stream ends (silence detection — heuristic), streams
 *      the WAV bytes back as binary frames at real-time pace.
 *   5. Waits for the final JSON envelope with `type: "session.completed"`.
 *   6. Prints a per-turn latency table to stdout AND exposes Langfuse
 *      session trace ID (extracted from W3C traceparent header, if the
 *      server echoes it — for Phase 4 we just log a timestamp and inspect
 *      Langfuse manually).
 *
 * Metrics logged (stdout):
 *   - turn N: time to first TTS chunk (ms)
 *   - turn N: total TTS audio bytes
 *   - turn N: time from end-of-candidate-WAV → next TTS chunk (round trip)
 *
 * This is a smoke harness. It is not a production load test. We measure
 * happy-path latency only.
 */

import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

interface Args {
  wav: string;
  interviewId: string;
  url: string;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      wav: { type: "string" },
      "interview-id": { type: "string" },
      url: { type: "string" },
    },
  });
  if (!values.wav || !values["interview-id"] || !values.url) {
    throw new Error("--wav --interview-id --url all required");
  }
  return {
    wav: values.wav,
    interviewId: values["interview-id"],
    url: values.url,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const wavBytes = readFileSync(args.wav);

  const ws = new WebSocket(args.url);
  const turns: Array<{ ttsFirstChunkMs: number; roundTripMs: number | null }> = [];
  let turnIdx = 0;
  let turnStart = 0;
  let candidateEndedAt = 0;
  let ttsActive = false;

  const FRAME_MS = 20;
  const FRAME_BYTES = Math.floor((wavBytes.length / 30000) * FRAME_MS); // crude

  ws.on("open", () => {
    turnStart = Date.now();
  });

  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      if (!ttsActive) {
        ttsActive = true;
        const ms = Date.now() - turnStart;
        turns[turnIdx] = {
          ttsFirstChunkMs: ms,
          roundTripMs: candidateEndedAt
            ? Date.now() - candidateEndedAt
            : null,
        };
        console.log(
          `turn ${turnIdx} TTS first chunk: ${ms}ms, RTT: ${turns[turnIdx]!.roundTripMs ?? "n/a"}ms`,
        );
      }
      return;
    }
    // text message — final envelope
    const env = JSON.parse(data.toString("utf-8")) as { type: string };
    if (env.type === "session.completed") {
      console.log("session.completed:", env);
      ws.close();
    }
  });

  ws.on("close", () => process.exit(0));
  ws.on("error", (err) => {
    console.error("ws error:", err);
    process.exit(1);
  });

  // every ~250ms with no inbound binary, treat TTS as ended and stream candidate audio
  setInterval(() => {
    if (!ttsActive) return;
    if (Date.now() - turnStart < 800) return; // give TTS some time
    // stream WAV in real-time-ish chunks
    let offset = 0;
    const interval = setInterval(() => {
      if (offset >= wavBytes.length) {
        clearInterval(interval);
        candidateEndedAt = Date.now();
        ttsActive = false;
        turnIdx++;
        turnStart = Date.now();
        return;
      }
      ws.send(wavBytes.subarray(offset, offset + FRAME_BYTES));
      offset += FRAME_BYTES;
    }, FRAME_MS);
  }, 250);
}

void main();
```

**What this is and isn't:** a *spike-quality* harness. It is **not** unit-tested; it is run manually and its output is captured into `docs/progress/phase-4.md`. The implementing agent should add a TODO note in the file header acknowledging the heuristic silence detection and suggesting a Phase 10 replacement that uses a proper protocol envelope (`{type: "tts.end"}` from the server).

#### D6. Update `.env.example` with new vars

**File:** `/home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/apps/backend/.env.example` (MODIFY)

Append:

```
DEEPGRAM_MODEL=nova-3
DEEPGRAM_LANGUAGE=en-US
DEEPGRAM_SAMPLE_RATE=16000
DEEPGRAM_ENCODING=linear16

ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

(`DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` are already present.)

#### D7. Tests for Batch D

**Files (CREATE):**

- `apps/backend/src/presentation/composition/interview-session.composition.test.ts`
- `apps/backend/src/presentation/controllers/interview-session.controller.test.ts`
- `apps/backend/src/presentation/routes/interview-session.ws.test.ts` (integration — uses `app.inject` not feasible for WS; use `fastify.listen` on ephemeral port + `ws` client)

**Test categories:**

| File | Tests |
|---|---|
| `interview-session.composition.test.ts` | missing DEEPGRAM_API_KEY → throw; missing ELEVENLABS_API_KEY → throw; both present → returns deps with stt + tts |
| `interview-session.controller.test.ts` | invalid `:id` → ws.close(1008); STT unavailable → ws.close(1012); happy path → ws.send(JSON envelope), ws.close(1000); abort on early ws close stops use case |
| `interview-session.ws.test.ts` | with mocked composition deps, opens WS, exchanges one turn, receives final envelope, closes 1000 |

**Mocking:** mock the entire composition root in route/controller tests via a constructor parameter or by overriding the composition factory at the route boundary. Do **not** mock `WebSocket` itself — use `@fastify/websocket`'s built-in test support or spin up a real local Fastify on `port: 0`.

#### Batch D verification

```bash
pnpm turbo run check-types --filter=backend
pnpm turbo run test --filter=backend
```

---

## Pseudo-workflow

1. **Browser** opens `ws://backend/interviews/{id}/session`.
2. **Fastify** upgrades the connection via `@fastify/websocket`. The route handler calls `InterviewSessionController.handle(socket, req)`.
3. Controller validates `:id` through `RunScriptedInterviewSessionInputDto.parse(...)` → `Result<DTO, DtoValidationError>`. On Err: `ws.close(1008)`.
4. Controller opens the **session OTel span** `interview.session.scripted` with `interview.id` attribute.
5. Controller adapts the WebSocket:
   - `candidateAudioIn`: AsyncIterable backed by `ws.on("message", binary)`.
   - `agentAudioOut`: callback that does `ws.send(chunk, { binary: true })`.
6. Controller calls `useCase.execute({ interviewId, candidateAudioIn, agentAudioOut, abortSignal })` inside `otelContext.with(sessionCtx, …)` so child spans nest correctly.
7. **Use case** loops over `SCRIPTED_INTERVIEW_QUESTIONS`. For each question:
   - 7a. `tts.synthesize(text, ctx)` → `Promise<Result<AsyncIterable<Uint8Array>, TtsError>>`. The adapter opens span `interview.turn.tts` and starts streaming.
   - 7b. Use case iterates the TTS audio and pumps each chunk into `agentAudioOut` (which writes to the WS).
   - 7c. Use case appends `TranscriptEntry({ speaker: AGENT, text })` to its in-memory transcript.
   - 7d. Use case calls `stt.transcribe(candidateAudioIn.next(), ctx)` — slice from the tee. Adapter opens span `interview.turn.stt` and pipes audio to Deepgram live.
   - 7e. Use case waits for the first `isFinal` chunk, signals tee `endCurrent()`, appends `TranscriptEntry({ speaker: CANDIDATE, text })`.
8. After all questions, use case returns `Result.Ok({ interviewId, transcript, turnsCompleted, scriptVersion })`.
9. Controller maps Ok → JSON envelope `{type: "session.completed", payload: …}`, sends via `ws.send`, then `ws.close(1000)`.
10. Controller maps Err → `mapErrorToWsClose(err)` → `ws.close(<code>, message)`.
11. Session span is ended in the `finally` of the controller.

## Entry points (dependency-ordered)

| #   | File                                                                                                                  | Layer        | Operation | Purpose                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------ | --------- | ---------------------------------------------------- |
| 1   | `packages/application/src/ports/speech-to-text/speech-to-text-error.ts`                                               | application  | CREATE    | SttError hierarchy                                   |
| 2   | `packages/application/src/ports/speech-to-text/speech-to-text.port.ts`                                                | application  | CREATE    | ISpeechToTextService + TranscriptChunk               |
| 3   | `packages/application/src/ports/speech-to-text/index.ts`                                                              | application  | CREATE    | barrel                                               |
| 4   | `packages/application/src/ports/text-to-speech/text-to-speech-error.ts`                                               | application  | CREATE    | TtsError hierarchy                                   |
| 5   | `packages/application/src/ports/text-to-speech/text-to-speech.port.ts`                                                | application  | CREATE    | ITextToSpeechService                                 |
| 6   | `packages/application/src/ports/text-to-speech/index.ts`                                                              | application  | CREATE    | barrel                                               |
| 7   | `packages/application/src/ports/index.ts`                                                                             | application  | MODIFY    | re-export new ports                                  |
| 8   | `packages/application/src/use-cases/interview/scripted-interview-script.ts`                                           | application  | CREATE    | hardcoded questions + version constant               |
| 9   | `packages/application/src/dtos/run-scripted-interview-session.dto.ts`                                                 | application  | CREATE    | input/output shapes                                  |
| 10  | `packages/application/src/dtos/index.ts`                                                                              | application  | MODIFY    | export new DTO                                       |
| 11  | `packages/application/src/use-cases/interview/scripted-interview-tee.ts`                                              | application  | CREATE    | tee helper for candidate audio per-turn slicing      |
| 12  | `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.ts`                             | application  | CREATE    | orchestration                                        |
| 13  | `packages/application/src/use-cases/interview/index.ts`                                                               | application  | MODIFY    | export new use case + script consts                  |
| 14  | DTO + use case + tee tests                                                                                            | application  | CREATE    | test coverage for batch A                            |
| 15  | `apps/backend/package.json`                                                                                           | backend      | MODIFY    | add `@fastify/websocket`                             |
| 16  | `apps/backend/src/infrastructure/services/deepgram/provider.ts`                                                       | backend infra| CREATE    | Deepgram client factory                              |
| 17  | `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.ts`                                           | backend infra| CREATE    | STT adapter w/ OTel span                             |
| 18  | `apps/backend/src/infrastructure/services/deepgram/index.ts`                                                          | backend infra| CREATE    | barrel                                               |
| 19  | Deepgram tests                                                                                                        | backend infra| CREATE    | provider + adapter unit tests                        |
| 20  | `apps/backend/src/infrastructure/services/elevenlabs/provider.ts`                                                     | backend infra| CREATE    | ElevenLabs client factory                            |
| 21  | `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts`                                       | backend infra| CREATE    | TTS adapter w/ OTel span                             |
| 22  | `apps/backend/src/infrastructure/services/elevenlabs/index.ts`                                                        | backend infra| CREATE    | barrel                                               |
| 23  | ElevenLabs tests                                                                                                      | backend infra| CREATE    | provider + adapter unit tests                        |
| 24  | `apps/backend/src/infrastructure/services/index.ts`                                                                   | backend infra| MODIFY    | re-export new adapter barrels                        |
| 25  | `apps/backend/src/presentation/composition/interview-session.composition.ts`                                          | backend pres | CREATE    | composition root for WS controller                   |
| 26  | `apps/backend/src/presentation/controllers/interview-session.controller.ts`                                           | backend pres | CREATE    | WS controller, error mapping, span lifecycle         |
| 27  | `apps/backend/src/presentation/routes/interview-session.ws.ts`                                                        | backend pres | CREATE    | route registration                                   |
| 28  | `apps/backend/src/app.ts`                                                                                             | backend pres | MODIFY    | register websocket plugin + new routes               |
| 29  | `apps/backend/.env.example`                                                                                           | backend      | MODIFY    | document new voice env vars                          |
| 30  | `apps/backend/src/scripts/measure-voice-latency.ts`                                                                   | backend      | CREATE    | latency harness CLI                                  |
| 31  | Presentation + composition tests                                                                                      | backend pres | CREATE    | controller + composition + WS integration            |

## Test matrix (consolidated)

| Test file (relative to repo root) | Categories | Mocks |
|---|---|---|
| `packages/application/src/dtos/run-scripted-interview-session.dto.test.ts` | parse valid; parse rejects empty id; parse rejects non-object | none |
| `packages/application/src/use-cases/interview/run-scripted-interview-session.use-case.test.ts` | happy path 4 turns → 8 entries; STT setup err short-circuits; TTS setup err short-circuits; mid-stream STT throw → ServiceUnknownError; abort signal aborts mid-loop; agent vs candidate speakers correct | in-memory `ISpeechToTextService` + `ITextToSpeechService` doubles |
| `packages/application/src/use-cases/interview/scripted-interview-tee.test.ts` | next slice yields frames; endCurrent terminates; frames dropped between slices; closeAll terminates pending | none — pure data |
| `apps/backend/src/infrastructure/services/deepgram/provider.test.ts` | blank apiKey err; valid apiKey ok with defaults; env builder reads overrides; missing env err | `vi.mock("@deepgram/sdk")` |
| `apps/backend/src/infrastructure/services/deepgram/deepgram-stt.service.test.ts` | open → audio pump; transcript event yielded; close ends; auth-like setup err → SttUnavailableError; mid-stream Error event → throws from iterator; malformed payload ignored | `vi.mock("@deepgram/sdk")` with fake `live` event emitter |
| `apps/backend/src/infrastructure/services/elevenlabs/provider.test.ts` | blank apiKey err; valid apiKey ok; env reads overrides | `vi.mock("elevenlabs")` |
| `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.test.ts` | empty text → TtsStreamError without span; happy path yields chunks; setup auth err → TtsUnavailableError; mid-stream throw propagates | `vi.mock("elevenlabs")` |
| `apps/backend/src/presentation/composition/interview-session.composition.test.ts` | missing DG key throws; missing EL key throws; both present returns deps | env injection via process.env mutation in beforeEach |
| `apps/backend/src/presentation/controllers/interview-session.controller.test.ts` | invalid id → ws.close(1008); STT unavailable → ws.close(1012); happy path → JSON envelope + ws.close(1000); abort on early ws.close stops loop | mock controller deps; fake `WebSocket` (EventEmitter shape sufficient) |
| `apps/backend/src/presentation/routes/interview-session.ws.test.ts` | end-to-end WS: server boots on port:0, client connects, server completes session, client receives envelope and 1000 close | mock composition factory before `buildApp()`; real ws client |

**Mocks at the SDK boundary only.** Never mock `Result`, `Option`, domain entities, or value objects. Per-package coverage targets stay at the project default (85% statements, 80% branches).

## Per-batch verification commands

After **every** batch, run in this order:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Do not proceed to the next batch until type-check is clean and the relevant test suites pass.

After **all** batches, run the full suite once more, then run `/backend-arch-validator` against each touched layer (`application`, `infrastructure`, `presentation`) and `backend-code-reviewer` over the full file list above.

## Risk notes / open questions

1. **Browser audio codec mismatch.** The browser `MediaRecorder` API outputs Opus-in-WebM by default; Deepgram's `linear16` PCM expects raw 16-bit PCM. The harness sidesteps this by feeding a known WAV file pre-formatted to `linear16` 16 kHz. The browser path will need a `MediaStreamTrackProcessor` + AudioWorklet (Phase 9) to produce raw PCM, or we tell Deepgram to expect Opus (`encoding: "opus"`) and pass the WebM blobs through. Lock this decision before Phase 9; for Phase 4 the WAV harness is sufficient.

2. **ElevenLabs streaming format vs. browser playback.** `mp3_44100_128` plays in `<audio>` and `MediaSource` natively. If we ever switch to PCM out for lower latency, the browser will need Web Audio API decode. Keep mp3 for Phase 4.

3. **Deepgram WebSocket back-pressure.** The `live.send(frame)` call in the adapter is fire-and-forget. If the upstream socket buffer fills, frames are dropped silently. Acceptable for the spike. Phase 10 should add explicit backpressure handling (`live.getReadyState()` checks).

4. **No transcript persistence.** Phase 4 returns transcript via JSON envelope only. Phase 5 must integrate the transcript into the `Interview` aggregate via `Interview.complete(at, transcript)`. The shape of the envelope is therefore *temporary*; do not let frontend code start depending on its precise structure.

5. **Audio recording for replay.** Out of scope. The plan does not write candidate audio to disk. If we need replay for QA, add it in Phase 6 (Reports) as a separate Storage write.

6. **Network flakiness in CI.** All adapter tests mock the SDK at module level; no real network calls. The latency harness is run manually only — never in CI. If we want CI smoke, gate it behind an env flag and a tagged Vitest suite (`describe.skipIf(!process.env.LIVE_VOICE_KEYS)`).

7. **OTel span context propagation through async iterators.** `context.with(...)` only propagates synchronously. Inside the use case's `for await (const chunk of ttsResult.unwrap())` we are already outside the active context by the time the iterator yields. Mitigation: the **adapter** opens its own child span before yielding, using the active context at adapter-call time — which `useCase.execute(...)` is wrapped in via `otelContext.with(sessionCtx, ...)`. This works because the adapter call is synchronous from the use case's perspective until the awaited `Promise<Result<…>>` resolves, and the span is created inside that resolution path. Verify span nesting in Langfuse during smoke testing.

8. **The composition root throws.** Documented in D4. This is the single boot-time exception to "no throws". The implementing agent should add a header comment explaining why and link back to this plan section so future readers don't widen the rule.

9. **`@fastify/websocket` v11 API drift.** The exact handler signature `(socket, req) => …` is from the Fastify 5–compatible v11 line. If the installed minor version differs, the controller signature may need a tiny adjustment. Verify after `pnpm install`.

10. **Half-duplex enforcement.** The tee deliberately drops candidate frames while no slice is open (i.e. while the agent is speaking) so the spike is half-duplex. A real interview will eventually need barge-in support — Phase 10 territory. Document this in the Phase 4 progress file.

