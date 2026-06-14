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
   * one `TranscriptChunk` per provider message; iteration ends when either
   * `audioFrames` finishes or the upstream STT socket closes cleanly.
   *
   * Connection failures surface as `Result.Err` from the outer Promise.
   * Mid-stream errors surface from the iterator and must be wrapped by callers.
   */
  transcribe(
    audioFrames: AsyncIterable<Uint8Array>,
    ctx: SttSessionContext,
  ): Promise<Result<AsyncIterable<TranscriptChunk>, SttError>>;
}
