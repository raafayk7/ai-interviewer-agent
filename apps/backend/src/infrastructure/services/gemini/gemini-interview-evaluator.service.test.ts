import { Result } from "@carbonteq/fp";
import { generateText, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  EvaluatorOutputInvalidError,
  EvaluatorUnavailableError,
  EvaluatorUnknownError,
  type InterviewEvaluatorInput,
} from "@repo/application";
import {
  AgentInternalScore,
  AgentNote,
  CandidateInfo,
  JobDescription,
  RECOMMENDATION,
  TopicScore,
  TranscriptEntry,
} from "@repo/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTERVIEW_EVALUATOR_FALLBACK } from "../../prompts/fallbacks/interview-evaluator.fallback.js";
import type { FetchedPrompt, ILangfusePromptClient } from "../../prompts/langfuse-prompt-client.js";
import { PROMPT_KEYS } from "../../prompts/prompt-keys.js";
import { GeminiInterviewEvaluatorService } from "./gemini-interview-evaluator.service.js";
import type { GeminiProviderHandle } from "./provider.js";

const otelMocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
  };
  const tracer = {
    startSpan: vi.fn(() => span),
  };

  return {
    span,
    tracer,
    getTracer: vi.fn(() => tracer),
  };
});

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: otelMocks.getTracer,
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  class MockNoObjectGeneratedError extends Error {
    static isInstance(error: unknown): error is MockNoObjectGeneratedError {
      return error instanceof MockNoObjectGeneratedError;
    }
  }

  class MockRetryError extends Error {
    static isInstance(error: unknown): error is MockRetryError {
      return error instanceof MockRetryError;
    }
  }

  return {
    ...actual,
    generateText: vi.fn(),
    NoObjectGeneratedError: MockNoObjectGeneratedError,
    RetryError: MockRetryError,
    Output: {
      ...actual.Output,
      object: vi.fn((args: Parameters<typeof actual.Output.object>[0]) => actual.Output.object(args)),
    },
  };
});

const generateTextMock = vi.mocked(generateText);
const outputObjectMock = vi.mocked(Output.object);

const evaluatorOutput = {
  overallRecommendation: RECOMMENDATION.ADVANCE,
  topicScores: [
    {
      topicName: "Backend Architecture",
      score: 4,
      justification: "Clear explanation of boundaries and persistence error handling.",
    },
    {
      topicName: "TypeScript",
      score: 5,
      justification: "Strong type modeling for expected failures.",
    },
  ],
  communicationAssessment: "Structured answers with concise examples and good clarification.",
  strengths: ["Strong backend fundamentals", "Clear communication"],
  concerns: ["Limited discussion of frontend collaboration"],
  followUpQuestions: ["Ask about operating production systems under incident pressure."],
};

const mustCreate = <T>(result: { isOk: () => boolean; unwrap: () => T }): T => {
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeJobDescription = (): JobDescription =>
  mustCreate(
    JobDescription.create({
      title: "Senior Backend Engineer",
      company: "Carbonteq",
      responsibilities: ["Build APIs"],
      requirements: ["TypeScript", "Clean Architecture"],
      rawText: "Backend JD",
    }),
  );

const makeCandidateInfo = (): CandidateInfo =>
  mustCreate(
    CandidateInfo.create({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      headline: "Backend Engineer",
      yearsOfExperience: 7,
      skills: ["TypeScript", "Postgres"],
      education: ["BSc Computer Science"],
      rawText: "Ada CV",
    }),
  );

const makeTranscriptEntry = (): TranscriptEntry =>
  mustCreate(
    TranscriptEntry.create({
      speaker: "candidate",
      text: "I use ports so application code does not know about Drizzle.",
      timestamp: new Date("2026-05-11T09:00:00.000Z"),
    }),
  );

const makeAgentNote = (): AgentNote =>
  mustCreate(
    AgentNote.create({
      note: "Candidate gave concrete trade-off examples.",
      recordedAtTurn: 2,
      recordedAt: new Date("2026-05-11T09:01:00.000Z"),
    }),
  );

const makeInternalScore = (): AgentInternalScore =>
  mustCreate(
    AgentInternalScore.create({
      topicName: "Backend Architecture",
      score: 4,
      justification: "Good port/adapters answer.",
      recordedAtTurn: 2,
      recordedAt: new Date("2026-05-11T09:02:00.000Z"),
    }),
  );

const mockGenerateTextOutput = (output: unknown): void => {
  generateTextMock.mockResolvedValue({ output } as unknown as Awaited<ReturnType<typeof generateText>>);
};

const noObjectError = (): Error => {
  const ctor = NoObjectGeneratedError as unknown as { new (message: string): Error };
  return new ctor("No object generated");
};

const retryError = (): Error => {
  const ctor = RetryError as unknown as { new (message: string): Error };
  return new ctor("retry exhausted");
};

const createHandle = () => {
  const model = { provider: "test", modelId: "gemini-test" };
  const provider = vi.fn(() => model) as unknown as GeminiProviderHandle["provider"];
  const handle: GeminiProviderHandle = {
    provider,
    defaultModel: "gemini-test",
    defaultAgentModel: "gemini-agent-test",
  };

  return { handle, provider, model };
};

const createPromptClient = (options?: {
  readonly isFallback?: boolean;
  readonly result?: "ok" | "err";
}) => {
  type PromptClientResult = Awaited<ReturnType<ILangfusePromptClient["getText"]>>;
  const metadata = { name: PROMPT_KEYS.INTERVIEW_EVALUATOR, version: 4 };
  const compile = vi.fn((variables: Record<string, string>) => JSON.stringify(variables));
  const toJSON = vi.fn(() => metadata);
  const fetched: FetchedPrompt = {
    isFallback: options?.isFallback ?? false,
    handle: {
      isFallback: options?.isFallback ?? false,
      compile,
      toJSON,
    },
  };
  const getText = vi.fn(
    async (): Promise<PromptClientResult> =>
      options?.result === "err"
        ? (Result.Err(new Error("prompt unavailable")) as PromptClientResult)
        : Result.Ok(fetched),
  );
  const prompts: ILangfusePromptClient = { getText };

  return { prompts, getText, compile, toJSON, metadata };
};

const makeEvaluatorInput = (): InterviewEvaluatorInput => ({
  interviewId: "interview-1",
  jobDescription: makeJobDescription(),
  candidateInfo: makeCandidateInfo(),
  clientInstructions: "Focus on backend depth.",
  transcript: [makeTranscriptEntry()],
  notes: [makeAgentNote()],
  internalScores: [makeInternalScore()],
  rubric: "Score each planned topic on a 0-5 scale.",
});

const lastGenerateTextOptions = (): Record<string, unknown> => {
  const options = generateTextMock.mock.calls.at(-1)?.[0];
  expect(options).toBeDefined();
  return options as unknown as Record<string, unknown>;
};

describe("GeminiInterviewEvaluatorService.evaluate", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    outputObjectMock.mockClear();
    otelMocks.span.end.mockClear();
    otelMocks.span.recordException.mockClear();
    otelMocks.span.setAttribute.mockClear();
    otelMocks.tracer.startSpan.mockClear();
  });

  it("returns ReportCreateProps and passes telemetry, prompt context, structured output, and span metadata", async () => {
    const { handle, provider, model } = createHandle();
    const promptClient = createPromptClient();
    mockGenerateTextOutput(evaluatorOutput);
    const service = new GeminiInterviewEvaluatorService(handle, promptClient.prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isOk()).toBe(true);
    const reportProps = result.unwrap();
    expect(reportProps.interviewId).toBe("interview-1");
    expect(reportProps.overallRecommendation).toBe(RECOMMENDATION.ADVANCE);
    expect(reportProps.topicScores).toHaveLength(2);
    expect(reportProps.topicScores[0]).toBeInstanceOf(TopicScore);
    expect(reportProps.communicationAssessment).toBe(evaluatorOutput.communicationAssessment);
    expect(provider).toHaveBeenCalledWith("gemini-test");
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "InterviewEvaluation",
      }),
    );

    const options = lastGenerateTextOptions();
    expect(options["model"]).toBe(model);
    expect(promptClient.getText).toHaveBeenCalledWith(PROMPT_KEYS.INTERVIEW_EVALUATOR, INTERVIEW_EVALUATOR_FALLBACK);
    expect(promptClient.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        client_instructions: "Focus on backend depth.",
        rubric: "Score each planned topic on a 0-5 scale.",
      }),
    );
    expect(promptClient.toJSON).toHaveBeenCalledOnce();
    expect(options["experimental_telemetry"]).toEqual(
      expect.objectContaining({
        isEnabled: true,
        functionId: "GeminiInterviewEvaluatorService.evaluate",
        metadata: expect.objectContaining({
          interviewId: "interview-1",
          transcriptEntries: 1,
          notes: 1,
          internalScores: 1,
          langfusePrompt: promptClient.metadata,
        }),
      }),
    );
    expect(options["prompt"]).toContain("Senior Backend Engineer");
    expect(options["prompt"]).toContain("Ada Lovelace");
    expect(options["prompt"]).toContain("Focus on backend depth.");
    expect(options["prompt"]).toContain("Score each planned topic on a 0-5 scale.");

    expect(otelMocks.tracer.startSpan).toHaveBeenCalledWith("interview.evaluation", {
      attributes: {
        "interview.id": "interview-1",
        "evaluator.model": "gemini-test",
        "evaluator.transcript_entries": 1,
        "evaluator.notes": 1,
        "evaluator.internal_scores": 1,
      },
    });
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("evaluator.stop_reason", "stop");
    expect(otelMocks.span.end).toHaveBeenCalledOnce();
  });

  it("omits Langfuse prompt linkage when the fetched prompt is fallback", async () => {
    const { handle } = createHandle();
    const promptClient = createPromptClient({ isFallback: true });
    mockGenerateTextOutput(evaluatorOutput);
    const service = new GeminiInterviewEvaluatorService(handle, promptClient.prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isOk()).toBe(true);
    const options = lastGenerateTextOptions();
    expect(options["experimental_telemetry"]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          interviewId: "interview-1",
          transcriptEntries: 1,
          notes: 1,
          internalScores: 1,
        }),
      }),
    );
    expect(
      (options["experimental_telemetry"] as { metadata: Record<string, unknown> }).metadata["langfusePrompt"],
    ).toBeUndefined();
    expect(promptClient.toJSON).not.toHaveBeenCalled();
  });

  it("uses local fallback compilation when prompt fetching fails", async () => {
    const { handle } = createHandle();
    const promptClient = createPromptClient({ result: "err" });
    mockGenerateTextOutput(evaluatorOutput);
    const service = new GeminiInterviewEvaluatorService(handle, promptClient.prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isOk()).toBe(true);
    const options = lastGenerateTextOptions();
    expect(options["prompt"]).toContain("Senior Backend Engineer");
    expect(options["prompt"]).toContain("Ada Lovelace");
    expect(options["prompt"]).toContain("Score each planned topic on a 0-5 scale.");
    expect(
      (options["experimental_telemetry"] as { metadata: Record<string, unknown> }).metadata["langfusePrompt"],
    ).toBeUndefined();
  });

  it("maps NoObjectGeneratedError to EvaluatorOutputInvalidError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(noObjectError());
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorOutputInvalidError);
    expect(otelMocks.span.recordException).toHaveBeenCalled();
    expect(otelMocks.span.end).toHaveBeenCalledOnce();
  });

  it("maps retry-like errors to EvaluatorUnavailableError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(retryError());
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorUnavailableError);
  });

  it("maps network-like failures to EvaluatorUnavailableError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("fetch failed"));
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorUnavailableError);
  });

  it("maps 5xx provider failures to EvaluatorUnavailableError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(Object.assign(new Error("provider down"), { status: 503 }));
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorUnavailableError);
  });

  it("maps unknown AI failures to EvaluatorUnknownError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("unexpected provider state"));
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorUnknownError);
  });

  it("maps topic score lift failures to EvaluatorOutputInvalidError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({
      ...evaluatorOutput,
      topicScores: [{ ...evaluatorOutput.topicScores[0], score: 6 }],
    });
    const service = new GeminiInterviewEvaluatorService(handle, createPromptClient().prompts);

    const result = await service.evaluate(makeEvaluatorInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorOutputInvalidError);
    expect(otelMocks.span.end).toHaveBeenCalledOnce();
  });
});
