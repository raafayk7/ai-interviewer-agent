import { streamText } from "ai";
import {
  AgentToolInputInvalidError,
  AgentTurnTimeoutError,
  AgentUnavailableError,
  type AgentTurnInput,
  END_INTERVIEW_REASON,
} from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiInterviewAgentService } from "./gemini-interview-agent.service.js";
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

const aiMocks = vi.hoisted(() => {
  class MockInvalidToolInputError extends Error {
    readonly toolName: string;

    constructor(message: string, toolName = "<unknown>") {
      super(message);
      this.name = "InvalidToolInputError";
      this.toolName = toolName;
    }

    static isInstance(error: unknown): error is MockInvalidToolInputError {
      return error instanceof MockInvalidToolInputError;
    }
  }

  class MockRetryError extends Error {
    static isInstance(error: unknown): error is MockRetryError {
      return error instanceof MockRetryError;
    }
  }

  return {
    InvalidToolInputError: MockInvalidToolInputError,
    RetryError: MockRetryError,
    jsonSchema: vi.fn((schema: unknown, validation: unknown) => ({ schema, validation })),
    stepCountIs: vi.fn((count: number) => ({ stepCount: count })),
    streamText: vi.fn(),
    tool: vi.fn((definition: unknown) => definition),
  };
});

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: otelMocks.getTracer,
  },
}));

vi.mock("ai", () => aiMocks);

const streamTextMock = vi.mocked(streamText);

const createHandle = () => {
  const model = { provider: "test", modelId: "gemini-agent-test" };
  const provider = vi.fn(() => model) as unknown as GeminiProviderHandle["provider"];
  const handle: GeminiProviderHandle = {
    provider,
    defaultModel: "gemini-planner-test",
    defaultAgentModel: "gemini-agent-test",
  };

  return { handle, provider, model };
};

const baseInput = (): AgentTurnInput => ({
  interviewId: "interview-1",
  turnIndex: 2,
  systemPrompt: "You are interviewing a candidate.",
  conversationHistory: [
    { role: "assistant", content: "Welcome." },
    { role: "user", content: "Thanks." },
    { role: "tool", content: "ignored tool history" },
  ],
  timeRemainingMessage: "Time check: 10 minutes remaining.",
  abortSignal: new AbortController().signal,
});

type StreamTextOptions = {
  tools: Record<string, { execute: (input: never) => Promise<unknown> }>;
};

const setupStreamText = (options?: {
  readonly chunks?: string[];
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly callTools?: (tools: StreamTextOptions["tools"]) => Promise<void>;
}): void => {
  streamTextMock.mockImplementation((rawOptions) => {
    const callOptions = rawOptions as unknown as StreamTextOptions;

    return {
      textStream: (async function* () {
        await options?.callTools?.(callOptions.tools);
        for (const chunk of options?.chunks ?? ["Tell me ", "about your work."]) {
          yield chunk;
        }
      })(),
      usage: Promise.resolve({
        inputTokens: options?.inputTokens ?? 11,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: options?.outputTokens ?? 7,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: undefined,
      }),
      finishReason: Promise.resolve(options?.finishReason ?? "stop"),
    } as never;
  });
};

const lastStreamTextOptions = (): Record<string, unknown> => {
  const options = streamTextMock.mock.calls.at(-1)?.[0];
  expect(options).toBeDefined();
  return options as unknown as Record<string, unknown>;
};

describe("GeminiInterviewAgentService.runTurn", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    otelMocks.span.end.mockClear();
    otelMocks.span.recordException.mockClear();
    otelMocks.span.setAttribute.mockClear();
    otelMocks.tracer.startSpan.mockClear();
  });

  it("collects streamed text, configures Gemini, and records success span attributes", async () => {
    const { handle, provider, model } = createHandle();
    setupStreamText();
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      text: "Tell me about your work.",
      toolEvents: [],
      stopReason: "stop",
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(provider).toHaveBeenCalledWith("gemini-agent-test");

    const options = lastStreamTextOptions();
    expect(options["model"]).toBe(model);
    expect(options["experimental_telemetry"]).toEqual({
      isEnabled: true,
      functionId: "GeminiInterviewAgentService.runTurn",
      metadata: {
        interviewId: "interview-1",
        turnIndex: 2,
      },
    });
    expect(options["messages"]).toEqual([
      {
        role: "system",
        content: "You are interviewing a candidate.\n\nTime check: 10 minutes remaining.",
      },
      { role: "assistant", content: "Welcome." },
      { role: "user", content: "Thanks." },
    ]);

    expect(otelMocks.tracer.startSpan).toHaveBeenCalledWith("interview.turn.agent", {
      attributes: {
        "interview.id": "interview-1",
        "interview.turn_index": 2,
        "agent.model": "gemini-agent-test",
      },
    });
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("agent.tool_calls_count", 0);
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("agent.stop_reason", "stop");
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("agent.input_tokens", 11);
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("agent.output_tokens", 7);
    expect(otelMocks.span.end).toHaveBeenCalledOnce();
  });

  it("adds an initial user kickoff message when conversation history is empty", async () => {
    const { handle } = createHandle();
    setupStreamText();
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn({
      ...baseInput(),
      conversationHistory: [],
      timeRemainingMessage: null,
    });

    expect(result.isOk()).toBe(true);
    expect(lastStreamTextOptions()["messages"]).toEqual([
      { role: "system", content: "You are interviewing a candidate." },
      {
        role: "user",
        content: "Start the interview now with a concise opening question.",
      },
    ]);
  });

  it("records next_question tool events", async () => {
    const { handle } = createHandle();
    setupStreamText({
      finishReason: "tool-calls",
      callTools: async (tools) => {
        await tools["next_question"]!.execute({
          topicName: "System Design",
          question: "How would you design a cache?",
        } as never);
      },
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().stopReason).toBe("tool_call_complete");
    expect(result.unwrap().toolEvents).toEqual([
      {
        kind: "next_question",
        topicName: "System Design",
        question: "How would you design a cache?",
      },
    ]);
    expect(otelMocks.span.setAttribute).toHaveBeenCalledWith("agent.tool_calls_count", 1);
  });

  it("records score_answer tool events", async () => {
    const { handle } = createHandle();
    setupStreamText({
      callTools: async (tools) => {
        await tools["score_answer"]!.execute({
          topicName: "System Design",
          score: 4,
          justification: "Clear trade-offs.",
        } as never);
      },
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().toolEvents).toEqual([
      {
        kind: "score_answer",
        topicName: "System Design",
        score: 4,
        justification: "Clear trade-offs.",
      },
    ]);
  });

  it("records take_note tool events", async () => {
    const { handle } = createHandle();
    setupStreamText({
      callTools: async (tools) => {
        await tools["take_note"]!.execute({ note: "Candidate prefers explicit consistency models." } as never);
      },
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().toolEvents).toEqual([
      { kind: "take_note", note: "Candidate prefers explicit consistency models." },
    ]);
  });

  it("records end_interview tool events", async () => {
    const { handle } = createHandle();
    setupStreamText({
      callTools: async (tools) => {
        await tools["end_interview"]!.execute({
          reason: END_INTERVIEW_REASON.ALL_TOPICS_COVERED,
        } as never);
      },
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().toolEvents).toEqual([
      { kind: "end_interview", reason: END_INTERVIEW_REASON.ALL_TOPICS_COVERED },
    ]);
  });

  it("maps invalid tool input errors", async () => {
    const { handle } = createHandle();
    streamTextMock.mockImplementation(() => {
      throw new aiMocks.InvalidToolInputError("score must be <= 5", "score_answer");
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AgentToolInputInvalidError);
    expect(otelMocks.span.recordException).toHaveBeenCalledOnce();
    expect(otelMocks.span.end).toHaveBeenCalledOnce();
  });

  it("maps unavailable provider failures", async () => {
    const { handle } = createHandle();
    const error = new Error("503 service unavailable");
    streamTextMock.mockImplementation(() => {
      throw error;
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AgentUnavailableError);
    expect(otelMocks.span.recordException).toHaveBeenCalledWith(error);
  });

  it("maps aborts to timeout errors", async () => {
    const { handle } = createHandle();
    const error = new Error("aborted");
    error.name = "AbortError";
    streamTextMock.mockImplementation(() => {
      throw error;
    });
    const service = new GeminiInterviewAgentService(handle);

    const result = await service.runTurn(baseInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AgentTurnTimeoutError);
    expect(otelMocks.span.recordException).toHaveBeenCalledWith(error);
  });
});
