import { Result } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import {
  type ITextToSpeechService,
  type TtsError,
  type TtsSessionContext,
  TtsStreamError,
  TtsUnavailableError,
  TtsUnknownError,
} from "@repo/application";
import type { ElevenLabsClientHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.elevenlabs");

export class ElevenLabsTextToSpeechService implements ITextToSpeechService {
  constructor(private readonly handle: ElevenLabsClientHandle) {}

  async synthesize(
    text: string,
    ctx: TtsSessionContext,
  ): Promise<Result<AsyncIterable<Uint8Array>, TtsError>> {
    if (!text.trim()) {
      return Result.Err(new TtsStreamError("ElevenLabs synthesize received empty text", ctx.interviewId));
    }

    const span = tracer.startSpan("interview.turn.tts", {
      attributes: {
        "interview.id": ctx.interviewId,
        "interview.turn_index": ctx.turnIndex,
        "tts.voice_id": this.handle.defaultVoiceId,
        "tts.model_id": this.handle.defaultModelId,
        "tts.output_format": this.handle.defaultOutputFormat,
        "tts.character_count": text.length,
      },
    });
    const startMs = Date.now();

    return Result.tryAsyncCatch(
      async () => {
        const stream = await this.handle.client.textToSpeech.convertAsStream(this.handle.defaultVoiceId, {
          text,
          model_id: this.handle.defaultModelId,
          output_format: this.handle.defaultOutputFormat,
        });

        return wrapAudioStream(stream as AsyncIterable<Uint8Array | Buffer>, span, startMs);
      },
      (err) => {
        span.end();
        return mapSetupError(err, ctx);
      },
    ).toPromise();
  }
}

function wrapAudioStream(
  stream: AsyncIterable<Uint8Array | Buffer>,
  span: Span,
  startMs: number,
): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => {
      const iterator = stream[Symbol.asyncIterator]();
      let firstChunkSeen = false;
      let totalBytes = 0;
      let closed = false;

      const close = (): void => {
        if (closed) {
          return;
        }

        closed = true;
        span.setAttribute("tts.total_bytes", totalBytes);
        if (!firstChunkSeen) {
          span.recordException(new Error("ElevenLabs stream produced no audio"));
        }
        span.end();
      };

      const rejectWithRecordedError = (err: unknown): Promise<IteratorResult<Uint8Array>> => {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.end();
        return Promise.reject(error);
      };

      return {
        next: async () =>
          iterator.next().then((result) => {
            if (result.done) {
              close();
              return done();
            }

            const chunk = toUint8Array(result.value);
            if (!firstChunkSeen) {
              firstChunkSeen = true;
              span.setAttribute("tts.latency_to_first_chunk_ms", Date.now() - startMs);
            }
            totalBytes += chunk.byteLength;

            return { value: chunk, done: false };
          }, rejectWithRecordedError),
        return: async () => {
          close();
          return iterator.return
            ? iterator.return().then(() => done<Uint8Array>())
            : done();
        },
      };
    },
  };
}

const done = <T>(): IteratorResult<T> => ({ done: true }) as IteratorResult<T>;

function toUint8Array(chunk: Uint8Array | Buffer): Uint8Array {
  return chunk;
}

function mapSetupError(err: unknown, ctx: TtsSessionContext): TtsError {
  if (!(err instanceof Error)) {
    return new TtsUnknownError(String(err), "ElevenLabsTextToSpeechService.synthesize");
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
    return new TtsUnavailableError(`ElevenLabs unavailable: ${err.message}`);
  }

  return new TtsStreamError(err.message, ctx.interviewId);
}
