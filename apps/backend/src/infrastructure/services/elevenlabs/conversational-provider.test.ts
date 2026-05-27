import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ServiceUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConversationalClient,
  conversationalClientFromEnv,
} from "./conversational-provider.js";

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: vi.fn(function MockElevenLabsClient(
    this: { options: unknown },
    options: unknown,
  ) {
    this.options = options;
  }),
}));

const ElevenLabsClientMock = vi.mocked(ElevenLabsClient);

describe("buildConversationalClient", () => {
  beforeEach(() => {
    ElevenLabsClientMock.mockClear();
  });

  it("returns Err when apiKey is blank", () => {
    const result = buildConversationalClient({ apiKey: " ", agentId: "agent-1" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(ElevenLabsClientMock).not.toHaveBeenCalled();
  });

  it("returns Err when agentId is blank", () => {
    const result = buildConversationalClient({ apiKey: "key-1", agentId: " " });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(ElevenLabsClientMock).not.toHaveBeenCalled();
  });

  it("creates a conversational client handle", () => {
    const result = buildConversationalClient({ apiKey: "key-1", agentId: "agent-1" });

    expect(result.isOk()).toBe(true);
    expect(ElevenLabsClientMock).toHaveBeenCalledWith({ apiKey: "key-1" });
    expect(result.unwrap().agentId).toBe("agent-1");
  });
});

describe("conversationalClientFromEnv", () => {
  beforeEach(() => {
    ElevenLabsClientMock.mockClear();
  });

  it("requires ELEVENLABS_API_KEY", () => {
    const result = conversationalClientFromEnv({ ELEVENLABS_AGENT_ID: "agent-1" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/ELEVENLABS_API_KEY/);
  });

  it("requires ELEVENLABS_AGENT_ID", () => {
    const result = conversationalClientFromEnv({ ELEVENLABS_API_KEY: "key-1" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toMatch(/ELEVENLABS_AGENT_ID/);
  });

  it("reads Conversational AI settings from env", () => {
    const result = conversationalClientFromEnv({
      ELEVENLABS_API_KEY: "key-env",
      ELEVENLABS_AGENT_ID: "agent-env",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().agentId).toBe("agent-env");
    expect(ElevenLabsClientMock).toHaveBeenCalledWith({ apiKey: "key-env" });
  });
});
