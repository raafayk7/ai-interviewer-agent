import { generateText, NoObjectGeneratedError, Output } from "ai";
import {
  DocumentExtractionParseFailedError,
  DocumentExtractionUnavailableError,
  DocumentExtractionUnknownError,
} from "@repo/application";
import { CandidateInfo, JobDescription } from "@repo/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiDocumentExtractionService } from "./gemini-document-extraction.service.js";
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

const jobDescriptionOutput = {
  title: "Senior Backend Engineer",
  company: "Carbonteq",
  responsibilities: ["Build APIs", "Own architecture"],
  requirements: ["TypeScript", "Clean Architecture"],
  rawText: "Senior Backend Engineer at Carbonteq",
};

const candidateInfoOutput = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  headline: "Backend Engineer",
  yearsOfExperience: 7,
  skills: ["TypeScript", "Postgres"],
  education: ["BSc Computer Science"],
  rawText: "Ada Lovelace CV",
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

const lastGenerateTextOptions = (): Record<string, unknown> => {
  const options = generateTextMock.mock.calls.at(-1)?.[0];
  expect(options).toBeDefined();
  return options as unknown as Record<string, unknown>;
};

describe("GeminiDocumentExtractionService.extractJobDescription", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    outputObjectMock.mockClear();
  });

  it("extracts a JobDescription and passes telemetry plus file input to generateText", async () => {
    const { handle, provider, model } = createHandle();
    mockGenerateTextOutput(jobDescriptionOutput);
    const service = new GeminiDocumentExtractionService(handle, "jd-key.pdf", "recruiter-1");

    const result = await service.extractJobDescription(Buffer.from("jd"), "application/pdf");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(JobDescription);
    expect(provider).toHaveBeenCalledWith("gemini-test");
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "JobDescription",
      }),
    );

    const options = lastGenerateTextOptions();
    expect(options["model"]).toBe(model);
    expect(options["experimental_telemetry"]).toEqual({
      isEnabled: true,
      functionId: "GeminiDocumentExtractionService.extractJobDescription",
      metadata: {
        recruiterId: "recruiter-1",
        documentKey: "jd-key.pdf",
        kind: "jd",
      },
    });

    const messages = options["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages[0]?.content[1]).toEqual({
      type: "file",
      data: Buffer.from("jd"),
      mediaType: "application/pdf",
    });
  });

  it("maps domain validation failure to DocumentExtractionParseFailedError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({ ...jobDescriptionOutput, title: "" });
    const service = new GeminiDocumentExtractionService(handle, "bad-jd.pdf");

    const result = await service.extractJobDescription(Buffer.from("jd"), "application/pdf");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DocumentExtractionParseFailedError);
    expect((result.unwrapErr() as DocumentExtractionParseFailedError).documentKey).toBe("bad-jd.pdf");
  });

  it("maps NoObjectGeneratedError to DocumentExtractionParseFailedError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(noObjectError());
    const service = new GeminiDocumentExtractionService(handle, "unparseable.pdf");

    const result = await service.extractJobDescription(Buffer.from("jd"), "application/pdf");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DocumentExtractionParseFailedError);
  });

  it("maps network-like failures to DocumentExtractionUnavailableError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("fetch failed"));
    const service = new GeminiDocumentExtractionService(handle);

    const result = await service.extractJobDescription(Buffer.from("jd"), "application/pdf");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DocumentExtractionUnavailableError);
  });

  it("maps unknown failures to DocumentExtractionUnknownError", async () => {
    const { handle } = createHandle();
    generateTextMock.mockRejectedValue(new Error("provider changed shape"));
    const service = new GeminiDocumentExtractionService(handle);

    const result = await service.extractJobDescription(Buffer.from("jd"), "application/pdf");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DocumentExtractionUnknownError);
  });
});

describe("GeminiDocumentExtractionService.extractCandidateInfo", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    outputObjectMock.mockClear();
  });

  it("extracts CandidateInfo and records CV telemetry", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput(candidateInfoOutput);
    const service = new GeminiDocumentExtractionService(handle, "cv-key.pdf", "recruiter-2");

    const result = await service.extractCandidateInfo(Buffer.from("cv"), "application/pdf");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(CandidateInfo);
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CandidateInfo",
      }),
    );
    expect(lastGenerateTextOptions()["experimental_telemetry"]).toEqual({
      isEnabled: true,
      functionId: "GeminiDocumentExtractionService.extractCandidateInfo",
      metadata: {
        recruiterId: "recruiter-2",
        documentKey: "cv-key.pdf",
        kind: "cv",
      },
    });
  });

  it("maps invalid candidate domain output to DocumentExtractionParseFailedError", async () => {
    const { handle } = createHandle();
    mockGenerateTextOutput({ ...candidateInfoOutput, email: "not-an-email" });
    const service = new GeminiDocumentExtractionService(handle, "bad-cv.pdf");

    const result = await service.extractCandidateInfo(Buffer.from("cv"), "application/pdf");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DocumentExtractionParseFailedError);
  });
});
