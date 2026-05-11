import { Result } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  EvaluatorOutputInvalidError,
  EvaluatorUnavailableError,
  EvaluatorUnknownError,
  type EvaluatorError,
  type IInterviewEvaluatorService,
  type InterviewEvaluatorInput,
} from "@repo/application";
import {
  RECOMMENDATION,
  type Recommendation,
  type ReportCreateProps,
  TopicScore,
  type TopicScoreProps,
} from "@repo/domain";
import type { GeminiProviderHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.gemini-evaluator");

type RecordValue = Record<string, unknown>;

interface EvaluatorRawOutput {
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScoreProps>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
}

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isRecommendation = (value: unknown): value is Recommendation =>
  value === RECOMMENDATION.ADVANCE ||
  value === RECOMMENDATION.HOLD ||
  value === RECOMMENDATION.REJECT;

const isTopicScoreProps = (value: unknown): value is TopicScoreProps => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["topicName"] === "string" &&
    typeof value["score"] === "number" &&
    typeof value["justification"] === "string"
  );
};

const isEvaluatorRawOutput = (value: unknown): value is EvaluatorRawOutput => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecommendation(value["overallRecommendation"]) &&
    Array.isArray(value["topicScores"]) &&
    value["topicScores"].every(isTopicScoreProps) &&
    typeof value["communicationAssessment"] === "string" &&
    isStringArray(value["strengths"]) &&
    isStringArray(value["concerns"]) &&
    isStringArray(value["followUpQuestions"])
  );
};

const evaluatorSchema = jsonSchema<EvaluatorRawOutput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      overallRecommendation: {
        type: "string",
        enum: [RECOMMENDATION.ADVANCE, RECOMMENDATION.HOLD, RECOMMENDATION.REJECT],
      },
      topicScores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            topicName: { type: "string", minLength: 1 },
            score: { type: "number", minimum: 0, maximum: 5 },
            justification: { type: "string", minLength: 1 },
          },
          required: ["topicName", "score", "justification"],
        },
      },
      communicationAssessment: { type: "string", minLength: 1 },
      strengths: { type: "array", items: { type: "string" } },
      concerns: { type: "array", items: { type: "string" } },
      followUpQuestions: { type: "array", items: { type: "string" } },
    },
    required: [
      "overallRecommendation",
      "topicScores",
      "communicationAssessment",
      "strengths",
      "concerns",
      "followUpQuestions",
    ],
  },
  {
    validate: (value) =>
      isEvaluatorRawOutput(value)
        ? { success: true, value }
        : {
            success: false,
            error: new Error("Generated evaluator output did not match the expected shape"),
          },
  },
);

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
  (err: unknown): EvaluatorError => {
    if (NoObjectGeneratedError.isInstance(err)) {
      return new EvaluatorOutputInvalidError(
        `Evaluator produced no parseable object: ${err.message}`,
        interviewId,
      );
    }

    if (isLikelyUnavailableError(err)) {
      return new EvaluatorUnavailableError(`Gemini unavailable during evaluation: ${err.message}`);
    }

    return new EvaluatorUnknownError(err instanceof Error ? err.message : String(err), "evaluate");
  };

const buildPrompt = (input: InterviewEvaluatorInput): string =>
  [
    "You are an experienced technical recruiter writing a structured screening report.",
    "Read the job description, candidate profile, client instructions, transcript, agent notes, and the agent's internal per-topic scores, then produce the report.",
    "",
    "Job description:",
    JSON.stringify(input.jobDescription.serialize(), null, 2),
    "",
    "Candidate profile:",
    JSON.stringify(input.candidateInfo.serialize(), null, 2),
    "",
    "Client instructions:",
    input.clientInstructions.trim() ? input.clientInstructions : "(none)",
    "",
    "Transcript (chronological):",
    JSON.stringify(input.transcript.map((entry) => entry.serialize()), null, 2),
    "",
    "Agent notes (private observations during the interview):",
    JSON.stringify(input.notes.map((note) => note.serialize()), null, 2),
    "",
    "Agent internal scores (recorded mid-interview, 0-5 scale):",
    JSON.stringify(input.internalScores.map((score) => score.serialize()), null, 2),
    "",
    "Rubric:",
    input.rubric,
  ].join("\n");

const liftReport = (
  raw: EvaluatorRawOutput,
  interviewId: string,
): Result<ReportCreateProps, EvaluatorOutputInvalidError> => {
  const topicScores: TopicScore[] = [];

  for (const rawTopic of raw.topicScores) {
    const topicScoreResult = TopicScore.create(rawTopic);

    if (topicScoreResult.isErr()) {
      return Result.Err(new EvaluatorOutputInvalidError(topicScoreResult.unwrapErr().message, interviewId));
    }

    topicScores.push(topicScoreResult.unwrap());
  }

  return Result.Ok({
    interviewId,
    overallRecommendation: raw.overallRecommendation,
    topicScores,
    communicationAssessment: raw.communicationAssessment,
    strengths: raw.strengths,
    concerns: raw.concerns,
    followUpQuestions: raw.followUpQuestions,
  });
};

export class GeminiInterviewEvaluatorService implements IInterviewEvaluatorService {
  constructor(private readonly handle: GeminiProviderHandle) {}

  async evaluate(input: InterviewEvaluatorInput): Promise<Result<ReportCreateProps, EvaluatorError>> {
    const span: Span = tracer.startSpan("interview.evaluation", {
      attributes: {
        "interview.id": input.interviewId,
        "evaluator.model": this.handle.defaultModel,
        "evaluator.transcript_entries": input.transcript.length,
        "evaluator.notes": input.notes.length,
        "evaluator.internal_scores": input.internalScores.length,
      },
    });

    const result = await Result.tryAsyncCatch(
      async () => {
        const result = await generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: evaluatorSchema,
            name: "InterviewEvaluation",
            description: "Structured screening report scored against the supplied rubric, transcript, JD, and CV.",
          }),
          prompt: buildPrompt(input),
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewEvaluatorService.evaluate",
            metadata: {
              interviewId: input.interviewId,
              transcriptEntries: input.transcript.length,
              notes: input.notes.length,
              internalScores: input.internalScores.length,
            },
          },
        });

        span.setAttribute("evaluator.stop_reason", "stop");
        return result.output;
      },
      (err) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        return mapAiError(input.interviewId)(err);
      },
    )
      .flatMap((raw) => liftReport(raw, input.interviewId))
      .toPromise();

    span.end();

    return result;
  }
}
