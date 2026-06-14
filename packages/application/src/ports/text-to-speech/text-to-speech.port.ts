import type { Result } from "@carbonteq/fp";
import type { TtsError } from "./text-to-speech-error.js";

export interface TtsSessionContext {
  readonly interviewId: string;
  readonly turnIndex: number;
}

export interface ITextToSpeechService {
  /**
   * Synthesizes `text` and returns a stream of binary audio chunks in the
   * adapter's configured container. Connection/setup failures surface as
   * `Result.Err`; mid-stream errors surface from the iterator.
   */
  synthesize(
    text: string,
    ctx: TtsSessionContext,
  ): Promise<Result<AsyncIterable<Uint8Array>, TtsError>>;
}
