import { describe, expect, it, vi } from "vitest";
import { buildInterviewSessionDeps } from "./interview-session.composition.js";

const mocks = vi.hoisted(() => {
  class ConductInterviewUseCase {
    static readonly instances: ConductInterviewUseCase[] = [];
    readonly execute = vi.fn();

    constructor(readonly deps: unknown) {
      ConductInterviewUseCase.instances.push(this);
    }
  }

  class DeepgramSpeechToTextService {
    constructor(readonly handle: unknown) {}
  }

  class ElevenLabsTextToSpeechService {
    constructor(readonly handle: unknown) {}
  }

  class GeminiInterviewAgentService {
    constructor(readonly handle: unknown) {}
  }

  class DrizzleInterviewRepository {
    constructor(readonly db: unknown) {}
  }

  return {
    ConductInterviewUseCase,
    DeepgramSpeechToTextService,
    ElevenLabsTextToSpeechService,
    GeminiInterviewAgentService,
    DrizzleInterviewRepository,
  };
});

vi.mock("@repo/application", () => ({
  ConductInterviewUseCase: mocks.ConductInterviewUseCase,
}));

vi.mock("../infrastructure/services/deepgram/index.js", async () => {
  const { Result } = await import("@carbonteq/fp");

  return {
    deepgramClientFromEnv: vi.fn((env: NodeJS.ProcessEnv) =>
      env["DEEPGRAM_API_KEY"]
        ? Result.Ok({ provider: "deepgram" })
        : Result.Err(new Error("DEEPGRAM_API_KEY is required")),
    ),
    DeepgramSpeechToTextService: mocks.DeepgramSpeechToTextService,
  };
});

vi.mock("../infrastructure/services/elevenlabs/index.js", async () => {
  const { Result } = await import("@carbonteq/fp");

  return {
    elevenLabsClientFromEnv: vi.fn((env: NodeJS.ProcessEnv) =>
      env["ELEVENLABS_API_KEY"]
        ? Result.Ok({ provider: "elevenlabs" })
        : Result.Err(new Error("ELEVENLABS_API_KEY is required")),
    ),
    ElevenLabsTextToSpeechService: mocks.ElevenLabsTextToSpeechService,
  };
});

vi.mock("../infrastructure/services/gemini/index.js", async () => {
  const { Result } = await import("@carbonteq/fp");

  return {
    geminiProviderFromEnv: vi.fn((env: NodeJS.ProcessEnv) =>
      env["GOOGLE_GENERATIVE_AI_API_KEY"]
        ? Result.Ok({ provider: "gemini" })
        : Result.Err(new Error("GOOGLE_GENERATIVE_AI_API_KEY is required")),
    ),
    GeminiInterviewAgentService: mocks.GeminiInterviewAgentService,
  };
});

vi.mock("../infrastructure/repositories/drizzle-interview.repository.js", () => ({
  DrizzleInterviewRepository: mocks.DrizzleInterviewRepository,
}));

const env = {
  DEEPGRAM_API_KEY: "deepgram-key",
  ELEVENLABS_API_KEY: "elevenlabs-key",
  GOOGLE_GENERATIVE_AI_API_KEY: "gemini-key",
};

const fakeDb = { kind: "test-db" };

describe("buildInterviewSessionDeps", () => {
  it("throws when DEEPGRAM_API_KEY is missing", () => {
    expect(() =>
      buildInterviewSessionDeps({
        env: {
          ELEVENLABS_API_KEY: "elevenlabs-key",
          GOOGLE_GENERATIVE_AI_API_KEY: "gemini-key",
        },
        db: fakeDb as never,
      }),
    ).toThrow("DEEPGRAM_API_KEY is required");
  });

  it("throws when ELEVENLABS_API_KEY is missing", () => {
    expect(() =>
      buildInterviewSessionDeps({
        env: {
          DEEPGRAM_API_KEY: "deepgram-key",
          GOOGLE_GENERATIVE_AI_API_KEY: "gemini-key",
        },
        db: fakeDb as never,
      }),
    ).toThrow("ELEVENLABS_API_KEY is required");
  });

  it("throws when GOOGLE_GENERATIVE_AI_API_KEY is missing", () => {
    expect(() =>
      buildInterviewSessionDeps({
        env: {
          DEEPGRAM_API_KEY: "deepgram-key",
          ELEVENLABS_API_KEY: "elevenlabs-key",
        },
        db: fakeDb as never,
      }),
    ).toThrow("GOOGLE_GENERATIVE_AI_API_KEY is required");
  });

  it("returns a use case factory when provider env and db are configured", () => {
    const deps = buildInterviewSessionDeps({
      env,
      db: fakeDb as never,
    });

    const useCase = deps.buildUseCase();

    expect(useCase.execute).toEqual(expect.any(Function));
  });

  it("creates a fresh use case for each session", () => {
    const deps = buildInterviewSessionDeps({
      env,
      db: fakeDb as never,
    });

    expect(deps.buildUseCase()).not.toBe(deps.buildUseCase());
  });

  it("uses the injected db without requiring DATABASE_URL at module load time", () => {
    const previous = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    const deps = buildInterviewSessionDeps({
      env,
      db: fakeDb as never,
    });

    expect(deps.buildUseCase().execute).toEqual(expect.any(Function));

    if (previous === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = previous;
    }
  });

  it("falls back to default timing knobs when env values are malformed", () => {
    const deps = buildInterviewSessionDeps({
      env: {
        ...env,
        INTERVIEW_TIME_REMAINING_INTERVAL_TURNS: "2.5",
        INTERVIEW_HARD_CEILING_GRACE_SECONDS: "-1",
      },
      db: fakeDb as never,
    });

    deps.buildUseCase();
    const last = mocks.ConductInterviewUseCase.instances.at(-1);

    expect(last?.deps).toEqual(
      expect.objectContaining({
        timeRemainingIntervalTurns: 3,
        hardCeilingGraceSeconds: 30,
      }),
    );
  });

  it("accepts zero for timing knobs", () => {
    const deps = buildInterviewSessionDeps({
      env: {
        ...env,
        INTERVIEW_TIME_REMAINING_INTERVAL_TURNS: "0",
        INTERVIEW_HARD_CEILING_GRACE_SECONDS: "0",
      },
      db: fakeDb as never,
    });

    deps.buildUseCase();
    const last = mocks.ConductInterviewUseCase.instances.at(-1);

    expect(last?.deps).toEqual(
      expect.objectContaining({
        timeRemainingIntervalTurns: 0,
        hardCeilingGraceSeconds: 0,
      }),
    );
  });
});
