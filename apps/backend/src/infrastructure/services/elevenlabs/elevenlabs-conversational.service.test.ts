import { describe, expect, it, vi } from "vitest";
import {
  ConversationalSignedUrlFailedError,
  ConversationalTranscriptFetchFailedError,
} from "@repo/application";
import { SPEAKER } from "@repo/domain";
import type { ConversationalClientHandle } from "./conversational-provider.js";
import { ElevenLabsConversationalService } from "./elevenlabs-conversational.service.js";

const makeService = (client: unknown): ElevenLabsConversationalService =>
  new ElevenLabsConversationalService({
    client,
    agentId: "agent-1",
  } as ConversationalClientHandle);

describe("ElevenLabsConversationalService", () => {
  it("issues single-use signed URLs with includeConversationId enabled and returns conversationId", async () => {
    const getSignedUrl = vi.fn().mockResolvedValue({
      signedUrl: "wss://signed-url",
      conversationId: "conv-abc-123",
    });
    const service = makeService({
      conversationalAi: { conversations: { getSignedUrl } },
    });

    const result = await service.issueSignedUrl({ agentId: "agent-1" });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ signedUrl: "wss://signed-url", conversationId: "conv-abc-123" });
    expect(getSignedUrl).toHaveBeenCalledWith({
      agentId: "agent-1",
      includeConversationId: true,
    });
  });

  it("maps signed URL SDK failures to a typed boundary error", async () => {
    const service = makeService({
      conversationalAi: {
        conversations: {
          getSignedUrl: vi.fn().mockRejectedValue(new Error("401 missing_permissions")),
        },
      },
    });

    const result = await service.issueSignedUrl({ agentId: "agent-1" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ConversationalSignedUrlFailedError);
    expect(result.unwrapErr().message).toContain("401");
  });

  it("maps transcript roles and timestamps from conversation history", async () => {
    const get = vi.fn().mockResolvedValue({
      metadata: { startTimeUnixSecs: 1_800_000_000 },
      transcript: [
        { role: "agent", message: "Hello", timeInCallSecs: 0 },
        { role: "user", message: "Hi", timeInCallSecs: 3 },
        { role: "agent", timeInCallSecs: 4 },
      ],
    });
    const service = makeService({
      conversationalAi: { conversations: { get } },
    });

    const result = await service.getTranscript("conv-1");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual([
      {
        speaker: SPEAKER.AGENT,
        text: "Hello",
        timestamp: new Date("2027-01-15T08:00:00.000Z"),
      },
      {
        speaker: SPEAKER.CANDIDATE,
        text: "Hi",
        timestamp: new Date("2027-01-15T08:00:03.000Z"),
      },
      {
        speaker: SPEAKER.AGENT,
        text: "",
        timestamp: new Date("2027-01-15T08:00:04.000Z"),
      },
    ]);
    expect(get).toHaveBeenCalledWith("conv-1");
  });

  it("maps transcript fetch failures to a typed boundary error", async () => {
    const service = makeService({
      conversationalAi: {
        conversations: {
          get: vi.fn().mockRejectedValue(new Error("not found")),
        },
      },
    });

    const result = await service.getTranscript("conv-missing");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(
      ConversationalTranscriptFetchFailedError,
    );
    expect(result.unwrapErr().elevenLabsSessionId).toBe("conv-missing");
  });
});
