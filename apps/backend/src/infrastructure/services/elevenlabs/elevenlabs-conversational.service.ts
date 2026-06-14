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

function extractConversationIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("conversation_id") ??
      parsed.searchParams.get("conversationId") ??
      null
    );
  } catch {
    return null;
  }
}

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

        // SDK type is { signedUrl } only; with includeConversationId the id may
        // surface as an untyped passthrough field (raw snake_case wire key) or as
        // a query param on the signed URL. Check both casings, then the URL.
        const raw = response as unknown as Record<string, unknown>;
        const conversationId =
          (typeof raw["conversation_id"] === "string" ? (raw["conversation_id"] as string) : undefined) ??
          (typeof raw["conversationId"] === "string" ? (raw["conversationId"] as string) : undefined) ??
          extractConversationIdFromUrl(response.signedUrl);

        if (!conversationId) {
          throw new Error(
            "getSignedUrl returned no conversationId despite includeConversationId: true",
          );
        }

        return { signedUrl: response.signedUrl, conversationId };
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
