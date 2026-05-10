import { describe, expect, it } from "vitest";
import { buildInterviewSessionDeps } from "./interview-session.composition.js";

describe("buildInterviewSessionDeps", () => {
  it("throws when DEEPGRAM_API_KEY is missing", () => {
    expect(() =>
      buildInterviewSessionDeps({
        env: { ELEVENLABS_API_KEY: "elevenlabs-key" },
      }),
    ).toThrow("DEEPGRAM_API_KEY is required");
  });

  it("throws when ELEVENLABS_API_KEY is missing", () => {
    expect(() =>
      buildInterviewSessionDeps({
        env: { DEEPGRAM_API_KEY: "deepgram-key" },
      }),
    ).toThrow("ELEVENLABS_API_KEY is required");
  });

  it("returns a use case factory when provider env is configured", () => {
    const deps = buildInterviewSessionDeps({
      env: {
        DEEPGRAM_API_KEY: "deepgram-key",
        ELEVENLABS_API_KEY: "elevenlabs-key",
      },
    });

    const useCase = deps.buildUseCase();

    expect(useCase.execute).toEqual(expect.any(Function));
  });

  it("creates a fresh use case for each session", () => {
    const deps = buildInterviewSessionDeps({
      env: {
        DEEPGRAM_API_KEY: "deepgram-key",
        ELEVENLABS_API_KEY: "elevenlabs-key",
      },
    });

    expect(deps.buildUseCase()).not.toBe(deps.buildUseCase());
  });
});
