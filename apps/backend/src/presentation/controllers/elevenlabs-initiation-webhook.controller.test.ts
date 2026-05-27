import { Option, Result } from "@carbonteq/fp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceError } from "@repo/application";
import {
  ElevenLabsInitiationWebhookController,
  type ElevenLabsInitiationWebhookControllerDeps,
} from "./elevenlabs-initiation-webhook.controller.js";

// ── helpers ──────────────────────────────────────────────────────────────────

class FakeReply {
  statusCode = 0;
  body: unknown;

  code(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  async send(body: unknown): Promise<this> {
    this.body = body;
    return this;
  }
}

const request = (value: unknown) => value as never;

const makeDeps = (
  overrides: Partial<ElevenLabsInitiationWebhookControllerDeps> = {},
): ElevenLabsInitiationWebhookControllerDeps => ({
  assembleContextUseCase: {
    execute: vi.fn().mockResolvedValue(
      Result.Ok({
        interviewId: "interview-001",
        systemPrompt: "Interview prompt for Jane Doe",
        firstMessage: "Welcome to the interview.",
        dynamicVariables: {
          interview_id: "interview-001",
          candidate_name: "Jane Doe",
          job_title: "Senior Backend Engineer",
          target_duration_minutes: "15",
        },
      }),
    ),
  },
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("[E2E] ElevenLabsInitiationWebhookController", () => {
  describe("handle() — fail-closed guards", () => {
    it("returns 401 when correlation_token is absent in dynamic_variables", async () => {
      const execute = vi.fn();
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({ assembleContextUseCase: { execute } }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({ body: { conversation_id: "conv-001", dynamic_variables: {} } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });

    it("returns 401 with MISSING_CORRELATION_TOKEN code when token absent", async () => {
      const controller = new ElevenLabsInitiationWebhookController(makeDeps());
      const reply = new FakeReply();

      await controller.handle(
        request({ body: { dynamic_variables: {} } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      const body = reply.body as { error: { code: string } };
      expect(body.error.code).toBe("MISSING_CORRELATION_TOKEN");
    });

    it("returns 401 when dynamic_variables is missing entirely", async () => {
      const execute = vi.fn();
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({ assembleContextUseCase: { execute } }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({ body: { conversation_id: "conv-001" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("handle() — success path with conversation_id", () => {
    it("returns 200 with conversationConfigOverride wire shape", async () => {
      const controller = new ElevenLabsInitiationWebhookController(makeDeps());
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBe(200);
      const body = reply.body as {
        conversation_config_override: {
          agent: {
            prompt: { prompt: string };
            first_message?: string;
          };
        };
        dynamic_variables: Record<string, string>;
      };
      expect(body.conversation_config_override.agent.prompt.prompt).toBe(
        "Interview prompt for Jane Doe",
      );
    });

    it("includes first_message in the wire response when present", async () => {
      const controller = new ElevenLabsInitiationWebhookController(makeDeps());
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBe(200);
      const body = reply.body as {
        conversation_config_override: { agent: { first_message?: string } };
      };
      expect(body.conversation_config_override.agent.first_message).toBe(
        "Welcome to the interview.",
      );
    });

    it("returns dynamicVariables in the wire response", async () => {
      const controller = new ElevenLabsInitiationWebhookController(makeDeps());
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        reply as never,
      );

      const body = reply.body as { dynamic_variables: Record<string, string> };
      expect(body.dynamic_variables.interview_id).toBe("interview-001");
    });

    it("calls assembleContextUseCase with conversationId wrapped in Option.Some", async () => {
      const execute = vi.fn().mockResolvedValue(
        Result.Ok({
          interviewId: "interview-001",
          systemPrompt: "prompt",
          dynamicVariables: { interview_id: "interview-001" },
        }),
      );
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({ assembleContextUseCase: { execute } }),
      );

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        new FakeReply() as never,
      );

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationToken: "session-token",
        }),
      );
      const callArg = vi.mocked(execute).mock.calls[0]?.[0];
      expect(callArg?.conversationId.isSome()).toBe(true);
    });
  });

  describe("handle() — success path WITHOUT conversation_id", () => {
    it("returns 200 even when conversation_id is absent", async () => {
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({
          assembleContextUseCase: {
            execute: vi.fn().mockResolvedValue(
              Result.Ok({
                interviewId: "interview-001",
                systemPrompt: "prompt",
                dynamicVariables: { interview_id: "interview-001" },
              }),
            ),
          },
        }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBe(200);
    });

    it("calls assembleContextUseCase with Option.None when conversation_id absent", async () => {
      const execute = vi.fn().mockResolvedValue(
        Result.Ok({
          interviewId: "interview-001",
          systemPrompt: "prompt",
          dynamicVariables: { interview_id: "interview-001" },
        }),
      );
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({ assembleContextUseCase: { execute } }),
      );

      await controller.handle(
        request({
          body: {
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        new FakeReply() as never,
      );

      const callArg = vi.mocked(execute).mock.calls[0]?.[0];
      expect(callArg?.conversationId.isNone()).toBe(true);
    });
  });

  describe("handle() — use case error paths (fail-closed)", () => {
    it("returns non-2xx when use case returns an error", async () => {
      const err: ServiceError = Object.assign(new Error("token invalid"), {
        code: "INVALID_CONVERSATION_CORRELATION_TOKEN",
      }) as ServiceError;
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({
          assembleContextUseCase: {
            execute: vi.fn().mockResolvedValue(Result.Err(err)),
          },
        }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "bad-token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("does not send a 200 response when use case returns Err", async () => {
      const err: ServiceError = Object.assign(new Error("interview not found"), {
        code: "INTERVIEW_NOT_FOUND",
      }) as ServiceError;
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({
          assembleContextUseCase: {
            execute: vi.fn().mockResolvedValue(Result.Err(err)),
          },
        }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            conversation_id: "conv-001",
            dynamic_variables: { correlation_token: "token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).not.toBe(200);
    });
  });

  describe("handle() — optional first_message omission", () => {
    it("omits first_message key from agent override when use case returns no firstMessage", async () => {
      const controller = new ElevenLabsInitiationWebhookController(
        makeDeps({
          assembleContextUseCase: {
            execute: vi.fn().mockResolvedValue(
              Result.Ok({
                interviewId: "interview-001",
                systemPrompt: "prompt",
                dynamicVariables: { interview_id: "interview-001" },
                // firstMessage intentionally absent
              }),
            ),
          },
        }),
      );
      const reply = new FakeReply();

      await controller.handle(
        request({
          body: {
            dynamic_variables: { correlation_token: "session-token" },
          },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBe(200);
      const body = reply.body as {
        conversation_config_override: { agent: Record<string, unknown> };
      };
      expect(body.conversation_config_override.agent).not.toHaveProperty("first_message");
    });
  });
});

// ── OTel span tests ──────────────────────────────────────────────────────────
//
// The controller caches `const tracer = trace.getTracer(...)` at module-load
// time. We reset the module registry and dynamically import the controller
// AFTER setting up a fake tracer provider via `trace.setGlobalTracerProvider`.
// The approach is shared with the candidate-session controller tests.

interface SpanCapture {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

function buildFakeProvider(): {
  spans: SpanCapture[];
  provider: import("@opentelemetry/api").TracerProvider;
} {
  const spans: SpanCapture[] = [];
  const provider: import("@opentelemetry/api").TracerProvider = {
    getTracer() {
      return {
        startSpan(
          spanName: string,
          options?: { attributes?: Record<string, unknown> },
        ): import("@opentelemetry/api").Span {
          const capture: SpanCapture = { name: spanName, attributes: {}, ended: false };
          if (options?.attributes) {
            Object.assign(capture.attributes, options.attributes);
          }
          spans.push(capture);
          const fakeSpan = {
            setAttribute(key: string, value: unknown) {
              capture.attributes[key] = value;
              return fakeSpan;
            },
            setAttributes(attrs: Record<string, unknown>) {
              Object.assign(capture.attributes, attrs);
              return fakeSpan;
            },
            end() {
              capture.ended = true;
            },
            addEvent: () => fakeSpan,
            setStatus: () => fakeSpan,
            updateName: () => fakeSpan,
            recordException: () => fakeSpan,
            isRecording: () => true,
            spanContext: () => ({ traceId: "0", spanId: "0", traceFlags: 0, isRemote: false }),
          } as unknown as import("@opentelemetry/api").Span;
          return fakeSpan;
        },
        startActiveSpan: (..._args: unknown[]) => undefined,
      } as unknown as import("@opentelemetry/api").Tracer;
    },
  };
  return { spans, provider };
}

describe("OTel spans (ADR-032) — D5 interview.webhook.initiation", () => {
  let spans: SpanCapture[];

  beforeEach(async () => {
    const { spans: s, provider } = buildFakeProvider();
    spans = s;
    const { trace } = await import("@opentelemetry/api");
    trace.setGlobalTracerProvider(provider);
    vi.resetModules();
  });

  afterEach(async () => {
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
    vi.resetModules();
  });

  it("D5 opens span, stamps interview.id from use-case output, conversation_id, override_assembled:true on success, closes", async () => {
    const mod = await import("./elevenlabs-initiation-webhook.controller.js");
    const controller = new mod.ElevenLabsInitiationWebhookController({
      assembleContextUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({
            interviewId: "interview-001",
            systemPrompt: "prompt",
            dynamicVariables: { interview_id: "interview-001" },
          }),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handle(
      request({
        body: {
          conversation_id: "conv-001",
          dynamic_variables: { correlation_token: "session-token" },
        },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.initiation");
    expect(span).toBeDefined();
    expect(span!.attributes["interview.id"]).toBe("interview-001");
    expect(span!.attributes["elevenlabs.conversation_id"]).toBe("conv-001");
    expect(span!.attributes["interview.initiation.override_assembled"]).toBe(true);
    expect(span!.ended).toBe(true);
  });

  it("D5 omits elevenlabs.conversation_id when conversation_id is absent from payload", async () => {
    const mod = await import("./elevenlabs-initiation-webhook.controller.js");
    const controller = new mod.ElevenLabsInitiationWebhookController({
      assembleContextUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({
            interviewId: "interview-001",
            systemPrompt: "prompt",
            dynamicVariables: { interview_id: "interview-001" },
          }),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handle(
      request({
        body: {
          dynamic_variables: { correlation_token: "session-token" },
        },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.initiation");
    expect(span).toBeDefined();
    expect(span!.attributes["elevenlabs.conversation_id"]).toBeUndefined();
    expect(span!.attributes["interview.id"]).toBe("interview-001");
    expect(span!.ended).toBe(true);
  });

  it("D5 stamps error:true and error.kind MISSING_CORRELATION_TOKEN on fail-closed guard", async () => {
    const mod = await import("./elevenlabs-initiation-webhook.controller.js");
    const controller = new mod.ElevenLabsInitiationWebhookController({
      assembleContextUseCase: { execute: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handle(
      request({
        body: { dynamic_variables: {} },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.initiation");
    expect(span).toBeDefined();
    expect(span!.attributes["error"]).toBe(true);
    expect(span!.attributes["error.kind"]).toBe("MISSING_CORRELATION_TOKEN");
    expect(span!.ended).toBe(true);
  });

  it("D5 stamps error:true and error.kind from use-case error code on use-case failure", async () => {
    const err: import("@repo/application").ServiceError = Object.assign(
      new Error("token invalid"),
      { code: "INVALID_CONVERSATION_CORRELATION_TOKEN" },
    ) as import("@repo/application").ServiceError;

    const mod = await import("./elevenlabs-initiation-webhook.controller.js");
    const controller = new mod.ElevenLabsInitiationWebhookController({
      assembleContextUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(err)),
      },
    });

    const reply = new FakeReply();
    await controller.handle(
      request({
        body: {
          conversation_id: "conv-001",
          dynamic_variables: { correlation_token: "bad-token" },
        },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.initiation");
    expect(span).toBeDefined();
    expect(span!.attributes["error"]).toBe(true);
    expect(span!.attributes["error.kind"]).toBe("INVALID_CONVERSATION_CORRELATION_TOKEN");
    expect(span!.ended).toBe(true);
  });
});
