import { DeepgramClient } from "@deepgram/sdk";
import { ServiceUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeepgramClient,
  deepgramClientFromEnv,
  DEFAULT_DEEPGRAM_ENCODING,
  DEFAULT_DEEPGRAM_LANGUAGE,
  DEFAULT_DEEPGRAM_MODEL,
  DEFAULT_DEEPGRAM_SAMPLE_RATE,
} from "./provider.js";

vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: vi.fn(function MockDeepgramClient(this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
}));

const DeepgramClientMock = vi.mocked(DeepgramClient);

describe("buildDeepgramClient", () => {
  beforeEach(() => {
    DeepgramClientMock.mockClear();
  });

  it("returns Err when apiKey is blank", () => {
    const result = buildDeepgramClient({ apiKey: "   " });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(DeepgramClientMock).not.toHaveBeenCalled();
  });

  it("creates a Deepgram client handle with defaults", () => {
    const result = buildDeepgramClient({ apiKey: "dg-key" });

    expect(result.isOk()).toBe(true);
    expect(DeepgramClientMock).toHaveBeenCalledWith({ apiKey: "dg-key" });
    expect(result.unwrap()).toMatchObject({
      apiKey: "dg-key",
      defaultModel: DEFAULT_DEEPGRAM_MODEL,
      defaultLanguage: DEFAULT_DEEPGRAM_LANGUAGE,
      defaultSampleRate: DEFAULT_DEEPGRAM_SAMPLE_RATE,
      defaultEncoding: DEFAULT_DEEPGRAM_ENCODING,
    });
  });

  it("uses custom defaults when provided", () => {
    const result = buildDeepgramClient({
      apiKey: "dg-key",
      defaultModel: "nova-test",
      defaultLanguage: "en",
      defaultSampleRate: 8000,
      defaultEncoding: "mulaw",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      defaultModel: "nova-test",
      defaultLanguage: "en",
      defaultSampleRate: 8000,
      defaultEncoding: "mulaw",
    });
  });
});

describe("deepgramClientFromEnv", () => {
  beforeEach(() => {
    DeepgramClientMock.mockClear();
  });

  it("returns Err when DEEPGRAM_API_KEY is missing", () => {
    const result = deepgramClientFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(DeepgramClientMock).not.toHaveBeenCalled();
  });

  it("reads Deepgram settings from env", () => {
    const result = deepgramClientFromEnv({
      DEEPGRAM_API_KEY: "env-key",
      DEEPGRAM_MODEL: "nova-env",
      DEEPGRAM_LANGUAGE: "en-GB",
      DEEPGRAM_SAMPLE_RATE: "48000",
      DEEPGRAM_ENCODING: "opus",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      apiKey: "env-key",
      defaultModel: "nova-env",
      defaultLanguage: "en-GB",
      defaultSampleRate: 48000,
      defaultEncoding: "opus",
    });
  });
});
