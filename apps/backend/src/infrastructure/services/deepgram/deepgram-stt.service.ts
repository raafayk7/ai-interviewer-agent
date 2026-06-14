import { Option, Result } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import {
  type ISpeechToTextService,
  type SttError,
  type SttSessionContext,
  SttStreamError,
  SttUnavailableError,
  SttUnknownError,
  type TranscriptChunk,
} from "@repo/application";
import type { DeepgramClientHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.deepgram");

type DeepgramSocket = Awaited<ReturnType<DeepgramClientHandle["client"]["listen"]["v1"]["connect"]>>;

export class DeepgramSpeechToTextService implements ISpeechToTextService {
  constructor(private readonly handle: DeepgramClientHandle) {}

  async transcribe(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<Result<AsyncIterable<TranscriptChunk>, SttError>> {
    return Result.tryAsyncCatch(
      () => this.openLive(audioFrames, ctx),
      (err) => mapSetupError(err, ctx),
    ).toPromise();
  }

  private async openLive(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<AsyncIterable<TranscriptChunk>> {
    const span = tracer.startSpan("interview.turn.stt", {
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
    const state = new TranscriptQueue(span, startMs);
    const connectionResult = await Result.tryAsyncCatch(
      async () => {
        const connection = await this.handle.client.listen.v1.connect({
          Authorization: `Token ${this.handle.apiKey}`,
          model: this.handle.defaultModel,
          language: this.handle.defaultLanguage,
          sample_rate: this.handle.defaultSampleRate,
          encoding: this.handle.defaultEncoding,
          smart_format: "true",
          interim_results: "true",
        });

        connection.on("message", (message) => {
          const parsed = parseDeepgramTranscript(message);
          if (parsed.isNone()) {
            return;
          }
          const chunk = parsed.unwrap();
          state.track(chunk);
          state.push(chunk);
        });
        connection.on("error", (error) => {
          state.fail(error instanceof Error ? error : new Error(String(error)));
        });
        connection.on("close", () => {
          state.close();
        });

        connection.connect();
        await connection.waitForOpen();

        return connection;
      },
      (err) => (err instanceof Error ? err : new Error(String(err))),
    ).toPromise();

    if (connectionResult.isErr()) {
      const error = connectionResult.unwrapErr();
      span.recordException(error);
      span.end();
      return Promise.reject(error);
    }

    const connection = connectionResult.unwrap();
    void pumpAudio(audioFrames, connection, state);

    return state.iterable();
  }
}

class TranscriptQueue {
  private readonly queue: TranscriptChunk[] = [];
  private pendingResolve?: (value: IteratorResult<TranscriptChunk>) => void;
  private pendingReject?: (reason?: unknown) => void;
  private closed = false;
  private socketError?: Error;
  private wordCount = 0;
  private finalConfidence?: number;

  constructor(
    private readonly span: Span,
    private readonly startMs: number,
  ) {}

  push(chunk: TranscriptChunk): void {
    if (this.closed) {
      return;
    }

    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = undefined;
      this.pendingReject = undefined;
      resolve({ value: chunk, done: false });
      return;
    }

    this.queue.push(chunk);
  }

  track(chunk: TranscriptChunk): void {
    if (!chunk.isFinal) {
      return;
    }

    this.wordCount += chunk.text.split(/\s+/).filter(Boolean).length;
    this.finalConfidence = chunk.confidence;
  }

  fail(error: Error): void {
    this.socketError = error;
    this.span.recordException(error);
    this.close();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.span.setAttribute("stt.latency_ms", Date.now() - this.startMs);
    this.span.setAttribute("stt.words", this.wordCount);
    if (this.finalConfidence !== undefined) {
      this.span.setAttribute("stt.final_confidence", this.finalConfidence);
    }
    this.span.end();

    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      const reject = this.pendingReject;
      this.pendingResolve = undefined;
      this.pendingReject = undefined;
      if (this.socketError) {
        reject?.(this.socketError);
      } else {
        resolve(done());
      }
    }
  }

  iterable(): AsyncIterable<TranscriptChunk> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<TranscriptChunk> => ({
        next: () => {
          if (this.queue.length > 0) {
            return Promise.resolve({ value: this.queue.shift() as TranscriptChunk, done: false });
          }
          if (this.closed) {
            if (this.socketError) {
              return Promise.reject(this.socketError);
            }
            return Promise.resolve(done());
          }

          return new Promise<IteratorResult<TranscriptChunk>>((resolve, reject) => {
            this.pendingResolve = resolve;
            this.pendingReject = reject;
          });
        },
        return: async () => {
          this.close();
          return done();
        },
      }),
    };
  }
}

const done = <T>(): IteratorResult<T> => ({ done: true }) as IteratorResult<T>;

const pumpAudio = async (
  audioFrames: AsyncIterable<Uint8Array>,
  connection: DeepgramSocket,
  state: TranscriptQueue,
): Promise<void> => {
  const result = await Result.tryAsyncCatch(
    async () => {
      for await (const frame of audioFrames) {
        connection.sendMedia(frame);
      }
      connection.sendCloseStream({ type: "CloseStream" });
    },
    (err) => (err instanceof Error ? err : new Error(String(err))),
  ).toPromise();

  if (result.isErr()) {
    state.fail(result.unwrapErr());
    connection.close();
  }
};

function parseDeepgramTranscript(message: unknown): Option<TranscriptChunk> {
  if (typeof message !== "object" || message === null) {
    return Option.None;
  }

  const record = message as Record<string, unknown>;
  if ("type" in record && record["type"] !== "Results") {
    return Option.None;
  }

  const channel = record["channel"];
  if (typeof channel !== "object" || channel === null) {
    return Option.None;
  }

  const alternatives = (channel as Record<string, unknown>)["alternatives"];
  if (!Array.isArray(alternatives)) {
    return Option.None;
  }

  const first = alternatives[0];
  if (typeof first !== "object" || first === null) {
    return Option.None;
  }

  const firstRecord = first as Record<string, unknown>;
  const text = typeof firstRecord["transcript"] === "string" ? firstRecord["transcript"] : "";
  if (!text.trim()) {
    return Option.None;
  }

  const chunk = {
    text,
    isFinal: record["is_final"] === true || record["speech_final"] === true,
    receivedAt: new Date(),
  };

  return typeof firstRecord["confidence"] === "number"
    ? Option.Some({ ...chunk, confidence: firstRecord["confidence"] })
    : Option.Some(chunk);
}

function mapSetupError(err: unknown, ctx: SttSessionContext): SttError {
  if (!(err instanceof Error)) {
    return new SttUnknownError(String(err), "DeepgramSpeechToTextService.transcribe");
  }

  const message = err.message.toLowerCase();
  if (
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timeout")
  ) {
    return new SttUnavailableError(`Deepgram unavailable: ${err.message}`);
  }

  return new SttStreamError(err.message, ctx.interviewId);
}
