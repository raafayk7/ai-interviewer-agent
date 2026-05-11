import { describe, expect, it, vi } from "vitest";
import { buildEvaluateInterviewDeps } from "./evaluate-interview.composition.js";

const mocks = vi.hoisted(() => {
  class EvaluateInterviewUseCase {
    static readonly instances: EvaluateInterviewUseCase[] = [];
    readonly execute = vi.fn();

    constructor(readonly deps: unknown) {
      EvaluateInterviewUseCase.instances.push(this);
    }
  }

  class GetReportByInterviewIdUseCase {
    static readonly instances: GetReportByInterviewIdUseCase[] = [];
    readonly execute = vi.fn();

    constructor(readonly reports: unknown) {
      GetReportByInterviewIdUseCase.instances.push(this);
    }
  }

  class GeminiInterviewEvaluatorService {
    constructor(readonly handle: unknown) {}
  }

  class DrizzleInterviewRepository {
    constructor(readonly db: unknown) {}
  }

  class DrizzleReportRepository {
    constructor(readonly db: unknown) {}
  }

  return {
    EvaluateInterviewUseCase,
    GetReportByInterviewIdUseCase,
    GeminiInterviewEvaluatorService,
    DrizzleInterviewRepository,
    DrizzleReportRepository,
  };
});

vi.mock("@repo/application", () => ({
  EvaluateInterviewUseCase: mocks.EvaluateInterviewUseCase,
  GetReportByInterviewIdUseCase: mocks.GetReportByInterviewIdUseCase,
}));

vi.mock("../infrastructure/services/gemini/index.js", async () => {
  const { Result } = await import("@carbonteq/fp");

  return {
    geminiProviderFromEnv: vi.fn((env: NodeJS.ProcessEnv) =>
      env["GOOGLE_GENERATIVE_AI_API_KEY"]
        ? Result.Ok({ provider: "gemini" })
        : Result.Err(new Error("GOOGLE_GENERATIVE_AI_API_KEY is required")),
    ),
    GeminiInterviewEvaluatorService: mocks.GeminiInterviewEvaluatorService,
  };
});

vi.mock("../infrastructure/repositories/index.js", () => ({
  DrizzleInterviewRepository: mocks.DrizzleInterviewRepository,
  DrizzleReportRepository: mocks.DrizzleReportRepository,
}));

const env = {
  GOOGLE_GENERATIVE_AI_API_KEY: "gemini-key",
};

const fakeDb = { kind: "test-db" };

describe("buildEvaluateInterviewDeps", () => {
  it("throws when GOOGLE_GENERATIVE_AI_API_KEY is missing", () => {
    expect(() =>
      buildEvaluateInterviewDeps({
        env: {},
        db: fakeDb as never,
      }),
    ).toThrow("GOOGLE_GENERATIVE_AI_API_KEY is required");
  });

  it("returns use case factories when provider env and db are configured", () => {
    const deps = buildEvaluateInterviewDeps({
      env,
      db: fakeDb as never,
    });

    expect(deps.buildEvaluateUseCase().execute).toEqual(expect.any(Function));
    expect(deps.buildGetReportUseCase().execute).toEqual(expect.any(Function));
  });

  it("creates fresh use cases for each factory call", () => {
    const deps = buildEvaluateInterviewDeps({
      env,
      db: fakeDb as never,
    });

    expect(deps.buildEvaluateUseCase()).not.toBe(deps.buildEvaluateUseCase());
    expect(deps.buildGetReportUseCase()).not.toBe(deps.buildGetReportUseCase());
  });

  it("wires evaluate use case with shared repositories and evaluator", () => {
    const deps = buildEvaluateInterviewDeps({
      env,
      db: fakeDb as never,
    });

    deps.buildEvaluateUseCase();
    const last = mocks.EvaluateInterviewUseCase.instances.at(-1);

    expect(last?.deps).toEqual({
      interviews: expect.any(mocks.DrizzleInterviewRepository),
      reports: expect.any(mocks.DrizzleReportRepository),
      evaluator: expect.any(mocks.GeminiInterviewEvaluatorService),
    });
  });

  it("wires get-report use case with the shared report repository", () => {
    const deps = buildEvaluateInterviewDeps({
      env,
      db: fakeDb as never,
    });

    deps.buildEvaluateUseCase();
    deps.buildGetReportUseCase();
    const evaluate = mocks.EvaluateInterviewUseCase.instances.at(-1);
    const getReport = mocks.GetReportByInterviewIdUseCase.instances.at(-1);

    expect(getReport?.reports).toBe(
      (evaluate?.deps as { reports: unknown } | undefined)?.reports,
    );
  });

  it("uses the injected db without requiring DATABASE_URL at module load time", () => {
    const previous = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    const deps = buildEvaluateInterviewDeps({
      env,
      db: fakeDb as never,
    });

    expect(deps.buildEvaluateUseCase().execute).toEqual(expect.any(Function));
    expect(deps.buildGetReportUseCase().execute).toEqual(expect.any(Function));

    if (previous === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = previous;
    }
  });
});
