import { Result } from "@carbonteq/fp";
import type { AttributeValue } from "@opentelemetry/api";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  type IInterviewPlannerService,
  type InterviewPlannerInput,
  PlannerOutputInvalidError,
  PlannerUnavailableError,
  PlannerUnknownError,
  type PlannerError,
} from "@repo/application";
import {
  DEFAULT_MAX_DURATION_MIN,
  DEFAULT_TARGET_DURATION_MIN,
  InterviewPlan,
  type InterviewPlanSerialized,
  PlannedTopic,
  type PlannedTopicProps,
  TOPIC_PRIORITY,
} from "@repo/domain";
import { INTERVIEW_PLANNER_FALLBACK } from "../../prompts/fallbacks/interview-planner.fallback.js";
import type { FetchedPrompt, ILangfusePromptClient } from "../../prompts/langfuse-prompt-client.js";
import { PROMPT_KEYS } from "../../prompts/prompt-keys.js";
import { renderTemplate } from "../../prompts/render-template.js";
import type { GeminiProviderHandle } from "./provider.js";

type RecordValue = Record<string, unknown>;

const planSchema = jsonSchema<InterviewPlanSerialized>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      topics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            questions: { type: "array", items: { type: "string" } },
            timeAllocationMinutes: { type: "number" },
            priority: {
              type: "string",
              enum: [TOPIC_PRIORITY.MUST_COVER, TOPIC_PRIORITY.IF_TIME_PERMITS],
            },
          },
          required: ["name", "questions", "timeAllocationMinutes", "priority"],
        },
      },
      targetDurationMinutes: { type: "number" },
      maxDurationMinutes: { type: "number" },
      mustAskQuestions: { type: "array", items: { type: "string" } },
    },
    required: ["topics", "targetDurationMinutes", "maxDurationMinutes", "mustAskQuestions"],
  },
  {
    validate: (value) =>
      isInterviewPlanSerialized(value)
        ? { success: true, value }
        : { success: false, error: new Error("Generated interview plan did not match the expected shape") },
  },
);

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isTopicPriority = (value: unknown): value is PlannedTopicProps["priority"] =>
  value === TOPIC_PRIORITY.MUST_COVER || value === TOPIC_PRIORITY.IF_TIME_PERMITS;

const isPlannedTopicProps = (value: unknown): value is PlannedTopicProps => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["name"] === "string" &&
    isStringArray(value["questions"]) &&
    typeof value["timeAllocationMinutes"] === "number" &&
    isTopicPriority(value["priority"])
  );
};

const isInterviewPlanSerialized = (value: unknown): value is InterviewPlanSerialized => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["topics"]) &&
    value["topics"].every(isPlannedTopicProps) &&
    typeof value["targetDurationMinutes"] === "number" &&
    typeof value["maxDurationMinutes"] === "number" &&
    isStringArray(value["mustAskQuestions"])
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
  (interviewId: string) =>
  (err: unknown): PlannerError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new PlannerOutputInvalidError(`Planner produced no parseable object: ${err.message}`, interviewId);
    }

    if (isLikelyUnavailableError(err)) {
      return new PlannerUnavailableError(`Gemini unavailable during planner: ${err.message}`);
    }

    return new PlannerUnknownError(err instanceof Error ? err.message : String(err), "generatePlan");
  };

const fallbackFetchedPrompt = (key: string, fallback: string): FetchedPrompt => ({
  isFallback: true,
  handle: {
    isFallback: true,
    compile: (variables: Record<string, string>) => renderTemplate(fallback, variables),
    toJSON: () => ({ kind: "fallback-on-error", key }),
  },
});

const buildVariables = (input: InterviewPlannerInput): Record<string, string> => {
  const targetDurationMinutes = input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN;
  const maxDurationMinutes = input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN;

  return {
    target_duration_minutes: String(targetDurationMinutes),
    max_duration_minutes: String(maxDurationMinutes),
    job_description_json: JSON.stringify(input.jobDescription.serialize(), null, 2),
    candidate_profile_json: JSON.stringify(input.candidateInfo.serialize(), null, 2),
    client_instructions: input.clientInstructions.trim() ? input.clientInstructions : "(none)",
  };
};

const liftPlan = (
  raw: InterviewPlanSerialized,
  interviewId: string,
): Result<InterviewPlan, PlannerOutputInvalidError> => {
  const topics: PlannedTopic[] = [];

  for (const rawTopic of raw.topics) {
    const topicResult = PlannedTopic.create(rawTopic);

    if (topicResult.isErr()) {
      return Result.Err(new PlannerOutputInvalidError(topicResult.unwrapErr().message, interviewId));
    }

    topics.push(topicResult.unwrap());
  }

  return InterviewPlan.create({
    topics,
    targetDurationMinutes: raw.targetDurationMinutes,
    maxDurationMinutes: raw.maxDurationMinutes,
    mustAskQuestions: raw.mustAskQuestions,
  }).mapErr((error) => new PlannerOutputInvalidError(error.message, interviewId));
};

export class GeminiInterviewPlannerService implements IInterviewPlannerService {
  constructor(
    private readonly handle: GeminiProviderHandle,
    private readonly prompts: ILangfusePromptClient,
  ) {}

  async generatePlan(input: InterviewPlannerInput): Promise<Result<InterviewPlan, PlannerError>> {
    const fetched = await this.prompts.getText(PROMPT_KEYS.INTERVIEW_PLANNER, INTERVIEW_PLANNER_FALLBACK);
    const prompt = await fetched.match({
      Err: async () => fallbackFetchedPrompt(PROMPT_KEYS.INTERVIEW_PLANNER, INTERVIEW_PLANNER_FALLBACK),
      Ok: async (value) => value,
    });
    const compiledPrompt = prompt.handle.compile(buildVariables(input));
    const telemetryMetadata: Record<string, AttributeValue> = {
      interviewId: input.interviewId,
      targetDurationMinutes: input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN,
      maxDurationMinutes: input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN,
    };

    if (!prompt.isFallback) {
      telemetryMetadata["langfusePrompt"] = prompt.handle.toJSON() as AttributeValue;
    }

    return Result.tryAsyncCatch(
      () =>
        generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: planSchema,
            name: "InterviewPlan",
            description: "Structured plan for a screening interview scoped to the given job and candidate.",
          }),
          prompt: compiledPrompt,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewPlannerService.generatePlan",
            metadata: telemetryMetadata,
          },
        }),
      mapAiError(input.interviewId),
    )
      .flatMap((res) => liftPlan(res.output, input.interviewId))
      .toPromise();
  }
}
