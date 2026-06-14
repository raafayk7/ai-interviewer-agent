import { ElevenLabsClient } from "elevenlabs";
import { ServiceUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildElevenLabsClient,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_ID,
  elevenLabsClientFromEnv,
} from "./provider.js";

vi.mock("elevenlabs", () => ({
  ElevenLabsClient: vi.fn(function MockElevenLabsClient(this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
}));

const ElevenLabsClientMock = vi.mocked(ElevenLabsClient);

describe("buildElevenLabsClient", () => {
  beforeEach(() => {
    ElevenLabsClientMock.mockClear();
  });

  it("returns Err when apiKey is blank", () => {
    const result = buildElevenLabsClient({ apiKey: " " });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(ElevenLabsClientMock).not.toHaveBeenCalled();
  });

  it("creates an ElevenLabs client handle with defaults", () => {
    const result = buildElevenLabsClient({ apiKey: "el-key" });

    expect(result.isOk()).toBe(true);
    expect(ElevenLabsClientMock).toHaveBeenCalledWith({ apiKey: "el-key" });
    expect(result.unwrap()).toMatchObject({
      defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
      defaultModelId: DEFAULT_ELEVENLABS_MODEL_ID,
      defaultOutputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    });
  });

  it("uses custom defaults when provided", () => {
    const result = buildElevenLabsClient({
      apiKey: "el-key",
      defaultVoiceId: "voice-1",
      defaultModelId: "model-1",
      defaultOutputFormat: "pcm_16000",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      defaultVoiceId: "voice-1",
      defaultModelId: "model-1",
      defaultOutputFormat: "pcm_16000",
    });
  });
});

describe("elevenLabsClientFromEnv", () => {
  beforeEach(() => {
    ElevenLabsClientMock.mockClear();
  });

  it("returns Err when ELEVENLABS_API_KEY is missing", () => {
    const result = elevenLabsClientFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(ElevenLabsClientMock).not.toHaveBeenCalled();
  });

  it("reads ElevenLabs settings from env", () => {
    const result = elevenLabsClientFromEnv({
      ELEVENLABS_API_KEY: "env-key",
      ELEVENLABS_VOICE_ID: "voice-env",
      ELEVENLABS_MODEL_ID: "model-env",
      ELEVENLABS_OUTPUT_FORMAT: "mp3_22050_32",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      defaultVoiceId: "voice-env",
      defaultModelId: "model-env",
      defaultOutputFormat: "mp3_22050_32",
    });
  });
});
