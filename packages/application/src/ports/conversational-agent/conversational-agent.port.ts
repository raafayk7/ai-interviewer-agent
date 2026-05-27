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
}

export interface ConversationalTranscriptRow {
  readonly speaker: Speaker;
  readonly text: string;
  readonly timestamp: Date;
}

export interface IConversationalAgentService {
  /**
   * The adapter must pass includeConversationId=true so the signed URL is
   * single-use. Per-session overrides are intentionally not part of this call.
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
