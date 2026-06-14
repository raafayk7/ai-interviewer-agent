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
