import { ServiceInfraError } from "../../core/service-error.js";

export class InvalidConversationCorrelationTokenError extends ServiceInfraError {
  readonly code = "INVALID_CONVERSATION_CORRELATION_TOKEN";

  constructor(message: string) {
    super(message);
  }
}
