import { Result } from "@carbonteq/fp";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  DocumentExtractionParseFailedError,
  DocumentExtractionUnavailableError,
  DocumentExtractionUnknownError,
  type DocumentExtractionError,
  type IDocumentExtractionService,
} from "@repo/application";
import { CandidateInfo, type CandidateInfoProps, JobDescription, type JobDescriptionProps } from "@repo/domain";
import type { GeminiProviderHandle } from "./provider.js";

type RecordValue = Record<string, unknown>;

const objectSchema = {
  type: "object",
  additionalProperties: false,
} as const;

const stringArraySchema = { type: "array", items: { type: "string" } } as const;

const jobDescriptionSchema = jsonSchema<JobDescriptionProps>(
  {
    ...objectSchema,
    properties: {
      title: { type: "string" },
      company: { type: "string" },
      responsibilities: stringArraySchema,
      requirements: stringArraySchema,
      rawText: { type: "string" },
    },
    required: ["title", "company", "responsibilities", "requirements", "rawText"],
  },
  {
    validate: (value) =>
      isJobDescriptionProps(value)
        ? { success: true, value }
        : { success: false, error: new Error("Generated job description did not match the expected shape") },
  },
);

const candidateInfoSchema = jsonSchema<CandidateInfoProps>(
  {
    ...objectSchema,
    properties: {
      fullName: { type: "string" },
      email: { type: "string" },
      headline: { type: "string" },
      yearsOfExperience: { type: "number" },
      skills: stringArraySchema,
      education: stringArraySchema,
      rawText: { type: "string" },
    },
    required: ["fullName", "email", "headline", "yearsOfExperience", "skills", "education", "rawText"],
  },
  {
    validate: (value) =>
      isCandidateInfoProps(value)
        ? { success: true, value }
        : { success: false, error: new Error("Generated candidate info did not match the expected shape") },
  },
);

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isJobDescriptionProps = (value: unknown): value is JobDescriptionProps => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["title"] === "string" &&
    typeof value["company"] === "string" &&
    isStringArray(value["responsibilities"]) &&
    isStringArray(value["requirements"]) &&
    typeof value["rawText"] === "string"
  );
};

const isCandidateInfoProps = (value: unknown): value is CandidateInfoProps => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["fullName"] === "string" &&
    typeof value["email"] === "string" &&
    typeof value["headline"] === "string" &&
    typeof value["yearsOfExperience"] === "number" &&
    isStringArray(value["skills"]) &&
    isStringArray(value["education"]) &&
    typeof value["rawText"] === "string"
  );
};

const isServerStatusError = (err: Error): boolean => {
  const record = err as unknown as RecordValue;
  const status = record["status"] ?? record["statusCode"];

  return typeof status === "number" && status >= 500 && status < 600;
};

const isLikelyUnavailableError = (err: unknown): err is Error => {
  if (!(err instanceof Error)) {
    return false;
  }

  const message = err.message.toLowerCase();

  return (
    RetryError.isInstance(err) ||
    err.name === "AI_RetryError" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    isServerStatusError(err) ||
    /\b5\d\d\b/.test(message)
  );
};

const mapAiError =
  (operation: "extractJobDescription" | "extractCandidateInfo", documentKey: string) =>
  (err: unknown): DocumentExtractionError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new DocumentExtractionParseFailedError(
        `Gemini produced no parseable object for ${operation}: ${err.message}`,
        documentKey,
      );
    }

    if (isLikelyUnavailableError(err)) {
      return new DocumentExtractionUnavailableError(`Gemini unavailable during ${operation}: ${err.message}`);
    }

    return new DocumentExtractionUnknownError(err instanceof Error ? err.message : String(err));
  };

export class GeminiDocumentExtractionService implements IDocumentExtractionService {
  constructor(
    private readonly handle: GeminiProviderHandle,
    private readonly documentKey: string = "unknown",
    private readonly recruiterId: string = "unknown",
  ) {}

  async extractJobDescription(
    file: Buffer,
    contentType: string,
  ): Promise<Result<JobDescription, DocumentExtractionError>> {
    return Result.tryAsyncCatch(
      () =>
        generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: jobDescriptionSchema,
            name: "JobDescription",
            description: "Structured job description extracted from a JD document.",
          }),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Extract a structured job description from this document. Populate every field. " +
                    "rawText should contain the document's full text content. If responsibilities or " +
                    "requirements are not enumerated, return empty arrays.",
                },
                { type: "file", data: file, mediaType: contentType },
              ],
            },
          ],
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiDocumentExtractionService.extractJobDescription",
            metadata: {
              recruiterId: this.recruiterId,
              documentKey: this.documentKey,
              kind: "jd",
            },
          },
        }),
      mapAiError("extractJobDescription", this.documentKey),
    )
      .flatMap((res) =>
        JobDescription.create(res.output).mapErr(
          (error) => new DocumentExtractionParseFailedError(error.message, this.documentKey),
        ),
      )
      .toPromise();
  }

  async extractCandidateInfo(
    file: Buffer,
    contentType: string,
  ): Promise<Result<CandidateInfo, DocumentExtractionError>> {
    return Result.tryAsyncCatch(
      () =>
        generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: candidateInfoSchema,
            name: "CandidateInfo",
            description: "Structured candidate profile extracted from a CV document.",
          }),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Extract a structured candidate profile from this CV. Populate every field. " +
                    "rawText should contain the CV's full text content. Use the candidate's most recent " +
                    "role for headline. If years of experience is not stated, infer it from listed roles.",
                },
                { type: "file", data: file, mediaType: contentType },
              ],
            },
          ],
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiDocumentExtractionService.extractCandidateInfo",
            metadata: {
              recruiterId: this.recruiterId,
              documentKey: this.documentKey,
              kind: "cv",
            },
          },
        }),
      mapAiError("extractCandidateInfo", this.documentKey),
    )
      .flatMap((res) =>
        CandidateInfo.create(res.output).mapErr(
          (error) => new DocumentExtractionParseFailedError(error.message, this.documentKey),
        ),
      )
      .toPromise();
  }
}
