import { ServiceInfraError } from "../../core/service-error.js";

export abstract class ConversationalAgentError extends ServiceInfraError {}

export class ConversationalAgentUnavailableError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_AGENT_UNAVAILABLE";
}

export class ConversationalSignedUrlFailedError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_SIGNED_URL_FAILED";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class ConversationalTranscriptFetchFailedError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_TRANSCRIPT_FETCH_FAILED";

  constructor(
    message: string,
    readonly elevenLabsSessionId: string,
  ) {
    super(message);
  }
}
