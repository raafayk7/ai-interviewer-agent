import type { Result } from "@carbonteq/fp";
import type { InvalidConversationCorrelationTokenError } from "./conversation-correlation-token-error.js";

export interface ConversationCorrelationTokenPayload {
  readonly interviewId: string;
  readonly issuedAtMs: number;
}

export interface IConversationCorrelationTokenIssuer {
  issue(interviewId: string): string;

  verify(
    token: string,
  ): Result<ConversationCorrelationTokenPayload, InvalidConversationCorrelationTokenError>;
}
