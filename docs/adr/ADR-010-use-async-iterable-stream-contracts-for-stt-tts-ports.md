# ADR-010 Use AsyncIterable Stream Contracts for STT and TTS Application Ports

## Status

Accepted. Date: 2026-05-10.

## Context

Phase 4 introduces a real-time voice pipeline that connects a browser WebSocket to two external streaming services: Deepgram (Speech-to-Text, STT) and ElevenLabs (Text-to-Speech, TTS). To insulate the use-case layer from both provider SDKs and the WebSocket transport, two new application-layer service ports are required: `ISpeechToTextService` and `ITextToSpeechService`.

Because both services produce or consume continuous audio/text streams rather than single values, the shape of these port interfaces is a non-trivial architectural choice. The shape chosen here will propagate to every adapter implementation in Phase 4, every use case that drives the voice loop in Phase 5 (`ConductInterview`), and any future provider swap.

Four concrete forces constrained the choice:

1. The STT port must accept an unbounded stream of binary audio frames as input and emit an unbounded stream of transcript chunks as output. Both legs may span 30 or more seconds and must interleave with other I/O without blocking the event loop.
2. The TTS port must accept a text string and return a stream of binary audio chunks. In Phase 4, prompts are short hardcoded strings; streaming text input is therefore out of scope and adds unnecessary complexity.
3. The use cases that consume these ports (`RunScriptedInterviewSessionUseCase` in Phase 4, `ConductInterview` in Phase 5) must be framework-free. They must not import WebSocket types, Fastify, or any streaming library. This rule is mandated by ADR-001 (application layer must not import infrastructure or presentation code).
4. Error propagation must integrate with the `@carbonteq/fp` `Result`/`Option` discipline established in ADR-001. Setup failures (authentication errors, invalid model/voice identifiers) must surface as `Result.Err` from an outer `Promise`. Mid-stream errors (socket drops after the session is open) must surface as thrown `Error` from the iterator boundary so callers can wrap iteration in `Result.tryAsyncCatch`.

The project runs on Node 22, which ships native `AsyncIterator` support including `Symbol.asyncIterator` on `ReadableStream` instances. No additional streaming library is required.

This decision is the application-layer counterpart to ADR-002, which committed the system to the Deepgram + ElevenLabs sandwich and specified that the backend drives Deepgram over a WebSocket and ElevenLabs over HTTP streaming.

## Decision

The STT and TTS application-layer ports use `AsyncIterable` as their streaming primitive.

**`ISpeechToTextService`** (at `packages/application/src/ports/speech-to-text/speech-to-text.port.ts`):

```typescript
transcribe(
  audioFrames: AsyncIterable<Uint8Array>,
  ctx: SttSessionContext,
): Promise<Result<AsyncIterable<TranscriptChunk>, SttError>>
```

The outer `Promise<Result<…, SttError>>` resolves once the adapter has successfully established the upstream Deepgram WebSocket connection. A connection failure (network unreachable, invalid API key, unsupported model) resolves the outer promise as `Result.Err`. The inner `AsyncIterable<TranscriptChunk>` yields one `TranscriptChunk` per provider message. Iteration ends when `audioFrames` is exhausted or the upstream STT socket closes cleanly. Mid-stream errors throw from the iterator; callers wrap iteration in `Result.tryAsyncCatch`.

**`ITextToSpeechService`** (at `packages/application/src/ports/text-to-speech/text-to-speech.port.ts`):

```typescript
synthesize(
  text: string,
  ctx: TtsSessionContext,
): Promise<Result<AsyncIterable<Uint8Array>, TtsError>>
```

The outer `Promise<Result<…, TtsError>>` captures setup failures (authentication, invalid voice identifier, HTTP 4xx from ElevenLabs). The inner `AsyncIterable<Uint8Array>` streams binary audio chunks in the adapter's configured container format. Mid-stream errors (socket drop after streaming has begun) throw from the iterator. The port is codec-agnostic: the audio container and sample rate are encoded in the adapter's constructor configuration, not on the port.

**Use-case boundary.** The use case receives the two abstract stream handles directly as `candidateAudioIn: AsyncIterable<Uint8Array>` and a callback `agentAudioOut: (chunk: Uint8Array) => Promise<void>`. It never imports WebSocket types. The presentation-layer controller translates between the WebSocket message events and these `AsyncIterable` handles before calling the use case.

**Both port interfaces are re-exported from the application ports barrel** at `packages/application/src/ports/index.ts`. This ensures that infrastructure adapters import the contracts from the application package rather than reaching into sub-paths.

## Alternatives Considered

### Alternative A: Callbacks

The STT port would expose a signature such as `onTranscript(frame: Uint8Array, cb: (chunk: TranscriptChunk) => void): void`. The TTS port would expose `synthesize(text, onChunk: (data: Uint8Array) => void, onDone: () => void, onError: (e: Error) => void): void`.

Rejected because: the use case must track session lifetime imperatively — invoking `start`, watching for completion, wiring `onError` to `onDone` — which breaks the `Result`-chain composability required by ADR-001. Error propagation across asynchronous callbacks requires manual threading through every intermediate function rather than a single `Result.tryAsyncCatch` call site. Callback-based contracts also have no natural backpressure mechanism; the audio write loop could enqueue faster than the STT WebSocket can drain.

### Alternative B: EventEmitter

The STT port would expose a typed emitter with `.on("transcript", handler)` and `.on("error", handler)`. The TTS port would emit `"data"` and `"end"` events.

Rejected because: TypeScript's `EventEmitter` API is stringly-typed (`.on(eventName: string, listener: Function)`). Typed-event libraries (such as `eventemitter3` or `typed-emitter`) would add a new dependency solely to paper over this weakness. More critically, error propagation through events requires the caller to register a separate `"error"` listener and plumb its result back into the `Result` chain manually. Listener cleanup must also be managed by hand; a missed `.off(...)` call silently leaks a handler across sessions. None of this integrates naturally with `for await...of` or `Result.tryAsyncCatch`.

### Alternative C: Observable (rxjs)

The ports would return `Observable<TranscriptChunk>` and `Observable<Uint8Array>` respectively. Errors would surface through the `error` channel of the subscriber. Setup failures would require a dedicated wrapping observable or `defer`.

Rejected because: `rxjs` would be a new production dependency introduced for a single feature. Phase 4 contributors familiar with native Node.js patterns would face an observable learning curve for no benefit over `AsyncIterable`. More concretely, `rxjs` composes poorly with `for await...of` — bridging between observables and async iterators requires `lastValueFrom`/`firstValueFrom` or `toAsyncIterable` (rxjs 7.8+), adding impedance at every consumption site. The existing `Result.tryAsyncCatch` idiom used throughout the codebase wraps async iterators directly and would require a new bridging wrapper for observables.

### Alternative D: Full bidirectional streaming input for TTS

The TTS port would accept `AsyncIterable<string>` rather than a plain `string`, allowing the Phase 5 LLM agent to stream token-by-token text into the TTS adapter without buffering the full response.

Rejected for Phase 4 because: Phase 4 prompts are short hardcoded strings of 10 to 50 words. The overhead of chunking these into a `string` iterator would serve no purpose. The `Promise<Result<AsyncIterable<Uint8Array>, TtsError>>` return shape is compatible with a future additive change: if Phase 5 requires partial-text streaming input, the port can be extended with an overload or a new `streamSynthesize` method without breaking this contract.

### Alternative E: Do nothing (leave the port shape unspecified)

Infrastructure adapters could accept raw `EventEmitter`, `Readable`, or SDK-specific types, letting each use case and each adapter negotiate the contract bilaterally.

Rejected because: two use cases are already planned (`RunScriptedInterviewSessionUseCase` in Phase 4, `ConductInterview` in Phase 5). A shared, stable port contract is exactly the mechanism that lets the Phase 5 use case reuse Phase 4's infrastructure adapters without modification. Without a defined port, the application layer would import infrastructure SDK types, violating ADR-001's layer rules.

## Consequences

**Benefits**

- `AsyncIterable` is a first-class Node.js primitive. No new production dependencies are required. Test doubles are plain `async function*` generators — no mock library or adapter shim is needed.
- `for await...of` plus `Result.tryAsyncCatch` is the idiom already established across this codebase. The port contract reinforces rather than diverges from existing patterns.
- The outer `Promise<Result<…>>` / inner iterator split gives callers a clean two-level failure model: setup failures handled once at connection time, mid-stream failures handled at iteration time. This maps cleanly onto the error class hierarchy (`SttUnavailableError`, `SttStreamError`, `TtsUnavailableError`, `TtsStreamError`) already defined in the port packages.
- Phase 5's `ConductInterview` use case can reuse `ISpeechToTextService` and `ITextToSpeechService` without changing the infrastructure adapters or the port contracts.
- The port interfaces are entirely free of Deepgram or ElevenLabs SDK types. Swapping either provider requires only a new adapter class under `apps/backend/src/infrastructure/`, with zero changes to the application layer.

**Trade-offs**

- Mid-stream errors throw from the iterator rather than resolving as `Result.Err`. Callers must remember to wrap `for await...of` loops in `Result.tryAsyncCatch`. This asymmetry (setup errors as `Result.Err`, mid-stream errors as `throw`) is documented in the JSDoc of both port interfaces but is easy to overlook when writing new consumers.
- Backpressure on the audio write path is implicit: the `audioFrames` producer blocks until the iterator consumer calls `.next()`. If the Deepgram WebSocket's send buffer fills before the consumer loops, the write loop will stall naturally. This is correct behaviour, but operators must be aware that slow Deepgram ACKs will propagate back-pressure to the browser.
- The `string`-in / `AsyncIterable<Uint8Array>`-out shape for TTS will require a port extension when Phase 5 needs token-by-token streaming input from the LLM. The additive change is straightforward (new overload or new method), but it will still require a minor version bump of the application package.

**Risks and mitigations**

- *Risk*: A new adapter author reads the return type as `Promise<Result<AsyncIterable<…>>>` and wraps iteration in `Result.map` rather than `Result.tryAsyncCatch`, silently swallowing mid-stream errors. *Mitigation*: The JSDoc on both port methods explicitly states "Mid-stream errors surface from the iterator and must be wrapped by callers." The Enforcement block (below) requires `ISpeechToTextService` and `ITextToSpeechService` to be referenced in the ports barrel, ensuring the JSDoc is always visible via the canonical import path. Integration tests for both adapters include a mid-stream error injection scenario.
- *Risk*: The presentation layer leaks WebSocket types into the use case. *Mitigation*: The Enforcement block forbids direct `WebSocket` and `fastify` imports in the application package's use-case files. `/backend-arch-validator` catches this at the layer level on every implementation cycle.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: The `AsyncIterable` contract is chosen specifically to preserve `Result`/`Option` discipline across the streaming boundary. The two-level failure model (setup as `Result.Err`, mid-stream as iterator throw) is a direct consequence of the `Result.tryAsyncCatch` idiom mandated by ADR-001.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: ADR-002 committed the system to Deepgram (WebSocket) and ElevenLabs (HTTP streaming) as the STT and TTS legs. This ADR specifies the application-layer port contracts through which those legs are consumed. ADR-010 depends on ADR-002.

## References

- Port implementation: `packages/application/src/ports/speech-to-text/speech-to-text.port.ts`
- Port implementation: `packages/application/src/ports/text-to-speech/text-to-speech.port.ts`
- Error classes: `packages/application/src/ports/speech-to-text/speech-to-text-error.ts`
- Error classes: `packages/application/src/ports/text-to-speech/text-to-speech-error.ts`
- Ports barrel: `packages/application/src/ports/index.ts` (exports `ISpeechToTextService` on line 4, `ITextToSpeechService` on line 5)
- Phase 4 plan sections D1, D2, D3: `.claude/plan/phase-4-voice-pipeline-spike.md`
- Node.js AsyncIterator documentation: https://nodejs.org/api/stream.html#async-iteration
- Node.js AsyncGenerator specification: https://tc39.es/ecma262/#sec-asyncgenerator-objects

## Enforcement

Declarative: the rules map cleanly to pattern matching on the ports barrel and on use-case source files.

```json
{
  "require_pattern": [
    {
      "pattern": "ISpeechToTextService",
      "path_glob": "packages/application/src/ports/index.ts",
      "message": "ISpeechToTextService must be re-exported from the ports barrel (ADR-010)."
    },
    {
      "pattern": "ITextToSpeechService",
      "path_glob": "packages/application/src/ports/index.ts",
      "message": "ITextToSpeechService must be re-exported from the ports barrel (ADR-010)."
    }
  ],
  "forbid_import": [
    {
      "pattern": "from ['\"]fastify['\"]",
      "path_glob": "packages/application/src/use-cases/**/*.ts",
      "message": "Use cases must not import Fastify. The presentation layer owns WebSocket/HTTP types (ADR-010, ADR-001)."
    },
    {
      "pattern": "from ['\"]ws['\"]",
      "path_glob": "packages/application/src/use-cases/**/*.ts",
      "message": "Use cases must not import the ws library. Convert WebSocket streams to AsyncIterable at the presentation boundary (ADR-010)."
    }
  ],
  "forbid_pattern": [],
  "llm_judge": false
}
```
