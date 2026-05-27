import { Result } from "@carbonteq/fp";
import {
  ConversationalSignedUrlFailedError,
  ConversationalTranscriptFetchFailedError,
  type ConversationalTranscriptRow,
  type IConversationalAgentService,
  type IssueSignedUrlInput,
  type IssueSignedUrlOutput,
} from "@repo/application";
import { SPEAKER } from "@repo/domain";
import type { ConversationalClientHandle } from "./conversational-provider.js";

export class ElevenLabsConversationalService implements IConversationalAgentService {
  constructor(private readonly handle: ConversationalClientHandle) {}

  async issueSignedUrl(
    input: IssueSignedUrlInput,
  ): Promise<Result<IssueSignedUrlOutput, ConversationalSignedUrlFailedError>> {
    return Result.tryAsyncCatch(
      async (): Promise<IssueSignedUrlOutput> => {
        const response = await this.handle.client.conversationalAi.conversations.getSignedUrl({
          agentId: input.agentId,
          includeConversationId: true,
        });

        return { signedUrl: response.signedUrl };
      },
      (err) =>
        new ConversationalSignedUrlFailedError(
          err instanceof Error ? err.message : String(err),
          input.agentId,
        ),
    ).toPromise();
  }

  async getTranscript(
    elevenLabsSessionId: string,
  ): Promise<Result<ReadonlyArray<ConversationalTranscriptRow>, ConversationalTranscriptFetchFailedError>> {
    return Result.tryAsyncCatch(
      async (): Promise<ReadonlyArray<ConversationalTranscriptRow>> => {
        const response =
          await this.handle.client.conversationalAi.conversations.get(elevenLabsSessionId);
        const startTimeMs = response.metadata.startTimeUnixSecs * 1000;

        return response.transcript
          .filter((message) => message.role === "agent" || message.role === "user")
          .map((message) => ({
            speaker: message.role === "agent" ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
            text: message.message ?? "",
            timestamp: new Date(startTimeMs + message.timeInCallSecs * 1000),
          }));
      },
      (err) =>
        new ConversationalTranscriptFetchFailedError(
          err instanceof Error ? err.message : String(err),
          elevenLabsSessionId,
        ),
    ).toPromise();
  }
}
