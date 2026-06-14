import type { Result } from "@carbonteq/fp";
import type { Speaker } from "@repo/domain";
import type {
  ConversationalAgentError,
  ConversationalSignedUrlFailedError,
  ConversationalTranscriptFetchFailedError,
} from "./conversational-agent-error.js";

export interface IssueSignedUrlInput {
  readonly agentId: string;
}

export interface IssueSignedUrlOutput {
  readonly signedUrl: string;
  readonly conversationId: string;
}

export interface ConversationalTranscriptRow {
  readonly speaker: Speaker;
  readonly text: string;
  readonly timestamp: Date;
}

export interface IConversationalAgentService {
  /**
   * Must pass includeConversationId=true. Returns both the signed URL (to hand
   * to the browser) and the conversationId (to bind on the interview entity as
   * elevenLabsSessionId before responding). The conversationId is the
   * trustworthy correlation key — no separate HMAC token is needed.
   */
  issueSignedUrl(
    input: IssueSignedUrlInput,
  ): Promise<
    Result<
      IssueSignedUrlOutput,
      ConversationalSignedUrlFailedError | ConversationalAgentError
    >
  >;

  getTranscript(
    elevenLabsSessionId: string,
  ): Promise<
    Result<
      ReadonlyArray<ConversationalTranscriptRow>,
      ConversationalTranscriptFetchFailedError | ConversationalAgentError
    >
  >;
}
