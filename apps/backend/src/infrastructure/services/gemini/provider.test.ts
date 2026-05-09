import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ServiceUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGeminiProvider, DEFAULT_GEMINI_MODEL, geminiProviderFromEnv } from "./provider.js";

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

const createGoogleGenerativeAIMock = vi.mocked(createGoogleGenerativeAI);

describe("buildGeminiProvider", () => {
  beforeEach(() => {
    createGoogleGenerativeAIMock.mockClear();
  });

  it("returns Err when apiKey is blank", () => {
    const result = buildGeminiProvider({ apiKey: "   " });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(createGoogleGenerativeAIMock).not.toHaveBeenCalled();
  });

  it("creates a Google provider handle with the default Gemini model", () => {
    const result = buildGeminiProvider({ apiKey: "gemini-key" });

    expect(result.isOk()).toBe(true);
    expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith({ apiKey: "gemini-key" });
    expect(result.unwrap().defaultModel).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("uses a custom default model when provided", () => {
    const result = buildGeminiProvider({
      apiKey: "gemini-key",
      defaultModel: "gemini-test-model",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().defaultModel).toBe("gemini-test-model");
  });
});

describe("geminiProviderFromEnv", () => {
  beforeEach(() => {
    createGoogleGenerativeAIMock.mockClear();
  });

  it("returns Err when GOOGLE_GENERATIVE_AI_API_KEY is missing", () => {
    const result = geminiProviderFromEnv({});

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnavailableError);
    expect(createGoogleGenerativeAIMock).not.toHaveBeenCalled();
  });

  it("returns Ok when GOOGLE_GENERATIVE_AI_API_KEY is present", () => {
    const result = geminiProviderFromEnv({
      GOOGLE_GENERATIVE_AI_API_KEY: "env-key",
      GEMINI_MODEL: "gemini-env-model",
    });

    expect(result.isOk()).toBe(true);
    expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith({ apiKey: "env-key" });
    expect(result.unwrap().defaultModel).toBe("gemini-env-model");
  });
});
