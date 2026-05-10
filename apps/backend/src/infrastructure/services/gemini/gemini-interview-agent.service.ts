import { Result } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import {
  InvalidToolInputError,
  jsonSchema,
  RetryError,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
} from "ai";
import {
  AgentToolInputInvalidError,
  AgentTurnTimeoutError,
  AgentUnavailableError,
  AgentUnknownError,
  END_INTERVIEW_REASON,
  type AgentError,
  type AgentMessage,
  type AgentStopReason,
  type AgentToolEvent,
  type AgentTurnInput,
  type AgentTurnOutput,
  type EndInterviewReason,
  type IInterviewAgentService,
} from "@repo/application";
import type { GeminiProviderHandle } from "./provider.js";

const tracer = trace.getTracer("ai-interviewer.gemini-agent");

type RecordValue = Record<string, unknown>;

type NextQuestionInput = {
  readonly topicName: string;
  readonly question: string;
};

type ScoreAnswerInput = {
  readonly topicName: string;
  readonly score: number;
  readonly justification: string;
};

type TakeNoteInput = {
  readonly note: string;
};

type EndInterviewInput = {
  readonly reason: EndInterviewReason;
};

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isEndInterviewReason = (value: unknown): value is EndInterviewReason =>
  value === END_INTERVIEW_REASON.ALL_TOPICS_COVERED ||
  value === END_INTERVIEW_REASON.CANDIDATE_NOT_A_FIT ||
  value === END_INTERVIEW_REASON.CANDIDATE_REQUESTED_END ||
  value === END_INTERVIEW_REASON.TIME_UP;

const NEXT_QUESTION_INPUT = jsonSchema<NextQuestionInput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      topicName: { type: "string", minLength: 1 },
      question: { type: "string", minLength: 1 },
    },
    required: ["topicName", "question"],
  },
  {
    validate: (value) =>
      isRecord(value) && isNonEmptyString(value["topicName"]) && isNonEmptyString(value["question"])
        ? {
            success: true,
            value: {
              topicName: value["topicName"],
              question: value["question"],
            },
          }
        : { success: false, error: new Error("next_question input is invalid") },
  },
);

const SCORE_ANSWER_INPUT = jsonSchema<ScoreAnswerInput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      topicName: { type: "string", minLength: 1 },
      score: { type: "number", minimum: 0, maximum: 5 },
      justification: { type: "string", minLength: 1 },
    },
    required: ["topicName", "score", "justification"],
  },
  {
    validate: (value) =>
      isRecord(value) &&
      isNonEmptyString(value["topicName"]) &&
      typeof value["score"] === "number" &&
      value["score"] >= 0 &&
      value["score"] <= 5 &&
      isNonEmptyString(value["justification"])
        ? {
            success: true,
            value: {
              topicName: value["topicName"],
              score: value["score"],
              justification: value["justification"],
            },
          }
        : { success: false, error: new Error("score_answer input is invalid") },
  },
);

const TAKE_NOTE_INPUT = jsonSchema<TakeNoteInput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      note: { type: "string", minLength: 1 },
    },
    required: ["note"],
  },
  {
    validate: (value) =>
      isRecord(value) && isNonEmptyString(value["note"])
        ? { success: true, value: { note: value["note"] } }
        : { success: false, error: new Error("take_note input is invalid") },
  },
);

const END_INTERVIEW_INPUT = jsonSchema<EndInterviewInput>(
  {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: {
        type: "string",
        enum: [
          END_INTERVIEW_REASON.ALL_TOPICS_COVERED,
          END_INTERVIEW_REASON.CANDIDATE_NOT_A_FIT,
          END_INTERVIEW_REASON.CANDIDATE_REQUESTED_END,
          END_INTERVIEW_REASON.TIME_UP,
        ],
      },
    },
    required: ["reason"],
  },
  {
    validate: (value) =>
      isRecord(value) && isEndInterviewReason(value["reason"])
        ? { success: true, value: { reason: value["reason"] } }
        : { success: false, error: new Error("end_interview input is invalid") },
  },
);

export class GeminiInterviewAgentService implements IInterviewAgentService {
  constructor(private readonly handle: GeminiProviderHandle) {}

  async runTurn(input: AgentTurnInput): Promise<Result<AgentTurnOutput, AgentError>> {
    const span: Span = tracer.startSpan("interview.turn.agent", {
      attributes: {
        "interview.id": input.interviewId,
        "interview.turn_index": input.turnIndex,
        "agent.model": this.handle.defaultAgentModel,
      },
    });

    const events: AgentToolEvent[] = [];
    const tools = this.buildTools(input, events);
    const messages = buildMessages(input);

    return Result.tryAsyncCatch(
      async () => {
        const result = streamText({
          model: this.handle.provider(this.handle.defaultAgentModel),
          messages,
          tools,
          stopWhen: stepCountIs(4),
          abortSignal: input.abortSignal,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewAgentService.runTurn",
            metadata: {
              interviewId: input.interviewId,
              turnIndex: input.turnIndex,
            },
          },
        });

        let text = "";
        for await (const chunk of result.textStream) {
          text += chunk;
        }

        const usage = await result.usage;
        const finishReason = await result.finishReason;
        const stopReason = mapStopReason(finishReason);

        span.setAttribute("agent.tool_calls_count", events.length);
        span.setAttribute("agent.stop_reason", stopReason);
        if (typeof usage.inputTokens === "number") {
          span.setAttribute("agent.input_tokens", usage.inputTokens);
        }
        if (typeof usage.outputTokens === "number") {
          span.setAttribute("agent.output_tokens", usage.outputTokens);
        }
        span.end();

        return {
          text: text.trim(),
          toolEvents: Object.freeze([...events]),
          stopReason,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
      },
      (err) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.end();
        return mapAgentError(err, input.interviewId);
      },
    ).toPromise();
  }

  private buildTools(input: AgentTurnInput, events: AgentToolEvent[]): ToolSet {
    return {
      next_question: tool({
        description: "Advance to the next planned topic. Use once per topic transition.",
        inputSchema: NEXT_QUESTION_INPUT,
        execute: async (raw) => {
          events.push({
            kind: "next_question",
            topicName: raw.topicName,
            question: raw.question,
          });
          return { ok: true, topicName: raw.topicName, advancedAtTurn: input.turnIndex };
        },
      }),
      score_answer: tool({
        description: "Privately score the candidate's answer for a topic on a 0-5 scale. Do not read this aloud.",
        inputSchema: SCORE_ANSWER_INPUT,
        execute: async (raw) => {
          events.push({
            kind: "score_answer",
            topicName: raw.topicName,
            score: raw.score,
            justification: raw.justification,
          });
          return { ok: true, recordedAtTurn: input.turnIndex };
        },
      }),
      take_note: tool({
        description: "Record an observation for the recruiter report.",
        inputSchema: TAKE_NOTE_INPUT,
        execute: async (raw) => {
          events.push({ kind: "take_note", note: raw.note });
          return { ok: true, recordedAtTurn: input.turnIndex };
        },
      }),
      end_interview: tool({
        description:
          "End the interview when topics are covered, the candidate is not a fit, the candidate asks to end, or time is up.",
        inputSchema: END_INTERVIEW_INPUT,
        execute: async (raw) => {
          events.push({ kind: "end_interview", reason: raw.reason });
          return { ok: true, willEndAfterTurn: input.turnIndex };
        },
      }),
    };
  }
}

const buildMessages = (
  input: AgentTurnInput,
): Array<{ role: "system" | "user" | "assistant"; content: string }> => {
  const systemContent = input.timeRemainingMessage
    ? `${input.systemPrompt}\n\n${input.timeRemainingMessage}`
    : input.systemPrompt;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemContent },
  ];

  for (const message of input.conversationHistory) {
    if (!isSpeakableAgentMessage(message)) {
      continue;
    }

    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (messages.length === 1) {
    messages.push({
      role: "user",
      content: "Start the interview now with a concise opening question.",
    });
  }

  return messages;
};

const isSpeakableAgentMessage = (
  message: AgentMessage,
): message is AgentMessage & { role: "user" | "assistant"; content: string } =>
  (message.role === "user" || message.role === "assistant") && typeof message.content === "string";

const mapStopReason = (finishReason: string): AgentStopReason => {
  if (finishReason === "tool-calls") {
    return "tool_call_complete";
  }

  if (finishReason === "error") {
    return "error";
  }

  return "stop";
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

function mapAgentError(err: unknown, interviewId: string): AgentError {
  if (err instanceof Error && err.name === "AbortError") {
    return new AgentTurnTimeoutError(`Agent turn aborted: ${err.message}`, interviewId);
  }

  if (InvalidToolInputError.isInstance(err)) {
    const toolName = typeof err.toolName === "string" ? err.toolName : "<unknown>";
    return new AgentToolInputInvalidError(err.message, interviewId, toolName);
  }

  if (err instanceof Error && err.name === "InvalidToolInputError") {
    return new AgentToolInputInvalidError(err.message, interviewId, "<unknown>");
  }

  if (isLikelyUnavailableError(err)) {
    return new AgentUnavailableError(
      `Gemini unavailable during agent turn: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new AgentUnknownError(
    err instanceof Error ? err.message : String(err),
    "GeminiInterviewAgentService.runTurn",
  );
}
