import { ServiceInfraError } from "../../core/service-error.js";

export abstract class AgentError extends ServiceInfraError {}

export class AgentUnavailableError extends AgentError {
  readonly code = "AGENT_UNAVAILABLE";
}

export class AgentToolInputInvalidError extends AgentError {
  readonly code = "AGENT_TOOL_INPUT_INVALID";

  constructor(
    message: string,
    readonly interviewId: string,
    readonly toolName: string,
  ) {
    super(message);
  }
}

export class AgentTurnTimeoutError extends AgentError {
  readonly code = "AGENT_TURN_TIMEOUT";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class AgentUnknownError extends AgentError {
  readonly code = "AGENT_UNKNOWN";

  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
