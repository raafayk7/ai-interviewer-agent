import { generateText, NoObjectGeneratedError, Output } from "ai";
import { PlannerOutputInvalidError, PlannerUnavailableError, PlannerUnknownError } from "@repo/application";
import { CandidateInfo, InterviewPlan, JobDescription, TOPIC_PRIORITY } from "@repo/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiInterviewPlannerService } from "./gemini-interview-planner.service.js";
import type { GeminiProviderHandle } from "./provider.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  class MockNoObjectGeneratedError extends Error {
    static isInstance(error: unknown): error is MockNoObjectGeneratedError {
      return error instanceof MockNoObjectGeneratedError;
    }
  }

  return {
    ...actual,
    generateText: vi.fn(),
    NoObjectGeneratedError: MockNoObjectGeneratedError,
    Output: {
      ...actual.Output,
      object: vi.fn((args: Parameters<typeof actual.Output.object>[0]) => actual.Output.object(args)),
    },
  };
});

const generateTextMock = vi.mocked(generateText);
const outputObjectMock = vi.mocked(Output.object);

const planOutput = {
  topics: [
    {
      name: "Backend Architecture",
      questions: ["How do you design service boundaries?", "How do you handle persistence errors?"],
      timeAllocationMinutes: 10,
      priority: TOPIC_PRIORITY.MUST_COVER,
    },
    {
      name: "TypeScript",
      questions: ["How do you model expected failures?"],
      timeAllocationMinutes: 5,
      priority: TOPIC_PRIORITY.IF_TIME_PERMITS,
    },
  ],
  targetDurationMinutes: 15,
  maxDurationMinutes: 25,
  mustAskQuestions: ["How do you design service boundaries?"],
};

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Carbonteq",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "Backend JD",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const result = CandidateInfo.create({
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    headline: "Backend Engineer",
    yearsOfExperience: 7,
    skills: ["TypeScript"],
    education: ["BSc Computer Science"],
    rawText: "Ada CV",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const mockGenerateTextOutput = (output: unknown): void => {
  generateTextMock.mockResolvedValue({ output } as unknown as Awaited<ReturnType<typeof generateText>>);
};

const noObjectError = (): Error => {
  const ctor = NoObjectGeneratedError as unknown as { new (message: string): Error };
  return new ctor("No object generated");
};

const createHandle = () => {
  const model = { provider: "test", modelId: "gemini-test" };
  const provider = vi.fn(() => model) as unknown as GeminiProviderHandle["provider"];
  const handle: GeminiProviderHandle = {
    provider,
    defaultModel: "gemini-test",
  };

  return { handle, provider, model };
};

const makePlannerInput = () => ({
  interviewId: "interview-1",
  jobDescription: makeJobDescription(),
  candidateInfo: makeCandidateInfo(),
  clientInstructions: "Focus on backend depth.",
  targetDurationMinutes: 20,
  maxDurationMinutes: 30,
});

const lastGenerateTextOptions = (): Record<string, unknown> => {
  const options = generateTextMock.mock.calls.at(-1)?.[0];
  expect(options).toBeDefined();
  return options as unknown as Record<string, unknown>;
};

describe("GeminiInterviewPlannerService.generatePlan", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    outputObjectMock.mockClear();
  });

  it("generates an InterviewPlan and passes telemetry, prompt context, and structured output config", async () => {
    const { handle, provider, model } = createHandle();
    mockGenerateTextOutput(planOutput);
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(InterviewPlan);
    expect(provider).toHaveBeenCalledWith("gemini-test");
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "InterviewPlan",
      }),
    );

    const options = lastGenerateTextOptions();
    expect(options["model"]).toBe(model);
    expect(options["experimental_telemetry"]).toEqual({
      isEnabled: true,
      functionId: "GeminiInterviewPlannerService.generatePlan",
      metadata: {
        interviewId: "interview-1",
        targetDurationMinutes: 20,
        maxDurationMinutes: 30,
      },
    });

    expect(options["prompt"]).toContain("Senior Backend Engineer");
    expect(options["prompt"]).toContain("Ada Lovelace");
    expect(options["prompt"]).toContain("Focus on backend depth.");
  });

  it("uses default duration metadata when overrides are omitted", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput(planOutput);
    const service = new GeminiInterviewPlannerService(handle);

    await service.generatePlan({
      interviewId: "interview-2",
      jobDescription: makeJobDescription(),
      candidateInfo: makeCandidateInfo(),
      clientInstructions: "",
    });

    expect(lastGenerateTextOptions()["experimental_telemetry"]).toEqual({
      isEnabled: true,
      functionId: "GeminiInterviewPlannerService.generatePlan",
      metadata: {
        interviewId: "interview-2",
        targetDurationMinutes: 15,
        maxDurationMinutes: 25,
      },
    });
  });

  it("maps empty topics to PlannerOutputInvalidError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({ ...planOutput, topics: [] });
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerOutputInvalidError);
  });

  it("maps invalid topic output to PlannerOutputInvalidError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({
      ...planOutput,
      topics: [{ ...planOutput.topics[0], name: "" }],
    });
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerOutputInvalidError);
  });

  it("maps target duration greater than max duration to PlannerOutputInvalidError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({
      ...planOutput,
      targetDurationMinutes: 30,
      maxDurationMinutes: 20,
    });
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerOutputInvalidError);
  });

  it("maps NoObjectGeneratedError to PlannerOutputInvalidError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(noObjectError());
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerOutputInvalidError);
  });

  it("maps timeout-like errors to PlannerUnavailableError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("ETIMEDOUT"));
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerUnavailableError);
  });

  it("maps unknown AI failures to PlannerUnknownError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("unexpected provider state"));
    const service = new GeminiInterviewPlannerService(handle);

    const result = await service.generatePlan(makePlannerInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(PlannerUnknownError);
  });
});
