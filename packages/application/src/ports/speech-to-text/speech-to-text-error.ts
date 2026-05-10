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
