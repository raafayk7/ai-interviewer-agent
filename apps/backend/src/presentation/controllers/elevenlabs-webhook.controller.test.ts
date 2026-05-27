import { Option, Result } from "@carbonteq/fp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceError } from "@repo/application";
import {
  ElevenLabsWebhookController,
  type ElevenLabsWebhookControllerDeps,
} from "./elevenlabs-webhook.controller.js";

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

function buildController(options: {
  readonly verifierResult?: Result<void, unknown>;
  readonly start?: ReturnType<typeof vi.fn>;
  readonly note?: ReturnType<typeof vi.fn>;
  readonly score?: ReturnType<typeof vi.fn>;
  readonly end?: ReturnType<typeof vi.fn>;
  readonly persist?: ReturnType<typeof vi.fn>;
  readonly resolveConversation?: ReturnType<typeof vi.fn>;
} = {}): ElevenLabsWebhookController {
  return new ElevenLabsWebhookController({
    verifier: {
      verify: vi.fn().mockReturnValue(options.verifierResult ?? Result.Ok(undefined)),
    },
    startInterviewFromWebhookUseCase: {
      execute: options.start ?? vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
    },
    recordAgentNoteUseCase: {
      execute: options.note ?? vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
    },
    recordInternalScoreUseCase: {
      execute: options.score ?? vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
    },
    endInterviewFromAgentUseCase: {
      execute: options.end ?? vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
    },
    persistCompletedTranscriptUseCase: {
      execute:
        options.persist ??
        vi.fn().mockResolvedValue(Result.Ok({ applied: true, entryCount: 2 })),
    },
    interviewResolver: {
      findByElevenLabsSessionId:
        options.resolveConversation ??
        vi.fn().mockResolvedValue(Result.Ok(Option.Some({ id: "interview-001" }))),
    },
  });
}

const baseSessionStartBody = {
  conversation_id: "conv-001",
  dynamic_variables: { interview_id: "interview-001" },
};

const baseToolBody = (toolName: string, args: Record<string, unknown> = {}) => ({
  conversation_id: "conv-001",
  tool_name: toolName,
  dynamic_variables: { interview_id: "interview-001" },
  parameters: args,
});

const basePostCallBody = {
  conversation_id: "conv-001",
};

// ── /session-start ─────────────────────────────────────────────────────────────

describe("[E2E] ElevenLabsWebhookController — /session-start", () => {
  it("returns 401 and does not invoke start use case when HMAC verification fails", async () => {
    const start = vi.fn();
    const controller = buildController({
      verifierResult: Result.Err(new Error("bad signature")),
      start,
    });
    const reply = new FakeReply();

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 200 with applied:true on successful session start", async () => {
    const controller = buildController();
    const reply = new FakeReply();

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "valid-sig" },
        rawBody: JSON.stringify(baseSessionStartBody),
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    const body = reply.body as { ok: boolean; applied: boolean };
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(true);
  });

  it("calls verifier BEFORE dispatching the use case", async () => {
    const callOrder: string[] = [];
    const start = vi.fn().mockImplementation(async () => {
      callOrder.push("useCase");
      return Result.Ok({ applied: true });
    });
    const verifier = {
      verify: vi.fn().mockImplementation(() => {
        callOrder.push("verifier");
        return Result.Ok(undefined);
      }),
    };
    const controller = new ElevenLabsWebhookController({
      verifier,
      startInterviewFromWebhookUseCase: { execute: start },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn(),
      },
    });

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(baseSessionStartBody),
        body: baseSessionStartBody,
      }),
      new FakeReply() as never,
    );

    expect(callOrder).toEqual(["verifier", "useCase"]);
  });

  it("returns 200 with applied:false when start is idempotent no-op", async () => {
    const controller = buildController({
      start: vi.fn().mockResolvedValue(Result.Ok({ applied: false })),
    });
    const reply = new FakeReply();

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(baseSessionStartBody),
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    const body = reply.body as { applied: boolean };
    expect(body.applied).toBe(false);
  });

  it("returns 401 with webhook.result=signature_rejected on HMAC failure", async () => {
    const controller = buildController({
      verifierResult: Result.Err(new Error("signature mismatch")),
    });
    const reply = new FakeReply();

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "tampered" },
        rawBody: "{}",
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(401);
    const body = reply.body as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");
  });

  it("returns non-2xx when start use case returns a genuine error", async () => {
    const err: ServiceError = Object.assign(new Error("interview not found"), {
      code: "INTERVIEW_NOT_FOUND",
    }) as ServiceError;
    const controller = buildController({
      start: vi.fn().mockResolvedValue(Result.Err(err)),
    });
    const reply = new FakeReply();

    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(baseSessionStartBody),
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBeGreaterThanOrEqual(400);
  });
});

// ── /tools ─────────────────────────────────────────────────────────────────────

describe("[E2E] ElevenLabsWebhookController — /tools", () => {
  it("returns 401 and does not dispatch any use case on HMAC failure", async () => {
    const note = vi.fn();
    const score = vi.fn();
    const end = vi.fn();
    const controller = buildController({
      verifierResult: Result.Err(new Error("bad sig")),
      note,
      score,
      end,
    });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: baseToolBody("take_note", { note: "test" }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(401);
    expect(note).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("routes take_note to RecordAgentNoteUseCase and returns 200", async () => {
    const note = vi.fn().mockResolvedValue(Result.Ok({ applied: true }));
    const score = vi.fn();
    const end = vi.fn();
    const controller = buildController({ note, score, end });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("take_note", { note: "Candidate showed strong problem solving." }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(note).toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("routes score_answer to RecordInternalScoreUseCase and returns 200", async () => {
    const note = vi.fn();
    const score = vi.fn().mockResolvedValue(Result.Ok({ applied: true }));
    const end = vi.fn();
    const controller = buildController({ note, score, end });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("score_answer", {
          topic_name: "Backend Architecture",
          score: 4,
          justification: "Good answer.",
        }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(score).toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("routes end_call to EndInterviewFromAgentUseCase and returns 200", async () => {
    const note = vi.fn();
    const score = vi.fn();
    const end = vi.fn().mockResolvedValue(Result.Ok({ applied: true }));
    const controller = buildController({ note, score, end });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("end_call", { reason: "all_topics_covered" }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(end).toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
  });

  it("acks next_question without calling any use case and returns 200", async () => {
    const note = vi.fn();
    const score = vi.fn();
    const end = vi.fn();
    const controller = buildController({ note, score, end });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("next_question"),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(note).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("returns 200 with applied:false when use case returns idempotent no-op", async () => {
    const controller = buildController({
      note: vi.fn().mockResolvedValue(Result.Ok({ applied: false })),
    });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("take_note", { note: "Late duplicate." }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    const body = reply.body as { applied: boolean };
    expect(body.applied).toBe(false);
  });

  it("returns non-2xx on genuine InvalidInterviewInputError from use case", async () => {
    const err: ServiceError = Object.assign(new Error("invalid score"), {
      code: "INVALID_INTERVIEW_INPUT",
    }) as ServiceError;
    const controller = buildController({
      score: vi.fn().mockResolvedValue(Result.Err(err)),
    });
    const reply = new FakeReply();

    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("score_answer", { topic_name: "topic", score: 99 }),
      }),
      reply as never,
    );

    expect(reply.statusCode).toBeGreaterThanOrEqual(400);
  });
});

// ── /post-call ─────────────────────────────────────────────────────────────────

describe("[E2E] ElevenLabsWebhookController — /post-call", () => {
  it("returns 401 and does not invoke persist use case on HMAC failure", async () => {
    const persist = vi.fn();
    const controller = buildController({
      verifierResult: Result.Err(new Error("bad signature")),
      persist,
    });
    const reply = new FakeReply();

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: basePostCallBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(401);
    expect(persist).not.toHaveBeenCalled();
  });

  it("returns 200 and persists transcript on happy path", async () => {
    const controller = buildController();
    const reply = new FakeReply();

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
  });

  it("returns 200 and does not call persist when conversation_id is unknown", async () => {
    const persist = vi.fn();
    const controller = buildController({
      persist,
      resolveConversation: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });
    const reply = new FakeReply();

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(persist).not.toHaveBeenCalled();
  });

  it("calls persist use case with the interviewId resolved from the conversation", async () => {
    const persist = vi.fn().mockResolvedValue(Result.Ok({ applied: true, entryCount: 3 }));
    const controller = buildController({
      persist,
      resolveConversation: vi.fn().mockResolvedValue(
        Result.Ok(Option.Some({ id: "interview-abc" })),
      ),
    });

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      new FakeReply() as never,
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ interviewId: "interview-abc" }),
    );
  });

  it("returns 200 even when persist returns applied:false (already COMPLETED idempotency)", async () => {
    const controller = buildController({
      persist: vi.fn().mockResolvedValue(Result.Ok({ applied: false, entryCount: 0 })),
    });
    const reply = new FakeReply();

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    const body = reply.body as { applied: boolean };
    expect(body.applied).toBe(false);
  });

  it("returns non-2xx when persist use case returns a genuine service error", async () => {
    const err: ServiceError = Object.assign(new Error("unknown error"), {
      code: "SERVICE_UNKNOWN",
    }) as ServiceError;
    const controller = buildController({
      persist: vi.fn().mockResolvedValue(Result.Err(err)),
    });
    const reply = new FakeReply();

    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    expect(reply.statusCode).toBeGreaterThanOrEqual(400);
  });
});

// ── OTel span tests ──────────────────────────────────────────────────────────
//
// The controller caches `const tracer = trace.getTracer(...)` at module-load
// time. We reset the module registry and dynamically import the controller
// AFTER setting up a fake tracer provider. The webhook controller also imports
// `context as otelContext` from `@opentelemetry/api` — we patch that via
// `vi.spyOn` on the context singleton after the fake provider is set.

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

// A minimal Context implementation that satisfies OTel's Context interface.
// `trace.setSpan` calls `context.setValue(key, span)` — so we need getValue/setValue/deleteValue.
const fakeContext: import("@opentelemetry/api").Context = {
  getValue: () => undefined,
  setValue: () => fakeContext,
  deleteValue: () => fakeContext,
};

// Patch `otelContext.active()`, `otelContext.with()`, and `trace.setSpan`
// so that the post-call handler's context propagation calls are no-ops that
// simply execute the callback without real context propagation.
async function patchOtelContext(): Promise<() => void> {
  const { context, trace } = await import("@opentelemetry/api");
  const activeSpy = vi.spyOn(context, "active").mockReturnValue(fakeContext);
  const withSpy = vi.spyOn(context, "with").mockImplementation(
    (_ctx: unknown, fn: () => unknown) => fn() as never,
  );
  const setSpanSpy = vi.spyOn(trace, "setSpan").mockReturnValue(fakeContext);
  return () => {
    activeSpy.mockRestore();
    withSpy.mockRestore();
    setSpanSpy.mockRestore();
  };
}

describe("OTel spans (ADR-032) — session-start route", () => {
  let spans: SpanCapture[];
  let restoreCtx: () => void;

  beforeEach(async () => {
    const { spans: s, provider } = buildFakeProvider();
    spans = s;
    const { trace } = await import("@opentelemetry/api");
    trace.setGlobalTracerProvider(provider);
    restoreCtx = await patchOtelContext();
    vi.resetModules();
  });

  afterEach(async () => {
    restoreCtx();
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
    vi.resetModules();
  });

  it("session-start span opens with name interview.webhook.session-start, stamps interview.id + elevenLabs.sessionId, closes", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
      },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(baseSessionStartBody),
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.session-start");
    expect(span).toBeDefined();
    expect(span!.attributes["interview.id"]).toBe("interview-001");
    expect(span!.attributes["elevenLabs.sessionId"]).toBe("conv-001");
    expect(span!.ended).toBe(true);
  });

  it("session-start span stamps webhook.result:signature_rejected on HMAC rejection", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Err(new Error("bad sig"))) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleSessionStart(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: baseSessionStartBody,
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.session-start");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.result"]).toBe("signature_rejected");
    expect(span!.ended).toBe(true);
  });
});

describe("OTel spans (ADR-032) — D2 interview.webhook.tool", () => {
  let spans: SpanCapture[];
  let restoreCtx: () => void;

  beforeEach(async () => {
    const { spans: s, provider } = buildFakeProvider();
    spans = s;
    const { trace } = await import("@opentelemetry/api");
    trace.setGlobalTracerProvider(provider);
    restoreCtx = await patchOtelContext();
    vi.resetModules();
  });

  afterEach(async () => {
    restoreCtx();
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
    vi.resetModules();
  });

  it("D2 stamps webhook.result:signature_rejected on HMAC rejection, span closes, use cases not invoked", async () => {
    const note = vi.fn();
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Err(new Error("bad sig"))) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: note },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: baseToolBody("take_note", { note: "test" }),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.result"]).toBe("signature_rejected");
    expect(span!.ended).toBe(true);
    expect(note).not.toHaveBeenCalled();
  });

  it("D2 stamps interview.id, elevenLabs.sessionId, webhook.tool_name:take_note, webhook.result:ok on take_note happy path", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
      },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("take_note", { note: "Good answer." }),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["interview.id"]).toBe("interview-001");
    expect(span!.attributes["elevenLabs.sessionId"]).toBe("conv-001");
    expect(span!.attributes["webhook.tool_name"]).toBe("take_note");
    expect(span!.attributes["webhook.result"]).toBe("ok");
    expect(span!.ended).toBe(true);
  });

  it("D2 stamps webhook.tool_name:score_answer on score_answer dispatch", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
      },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("score_answer", { topic_name: "Architecture", score: 4, justification: "Good" }),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.tool_name"]).toBe("score_answer");
    expect(span!.attributes["webhook.result"]).toBe("ok");
    expect(span!.ended).toBe(true);
  });

  it("D2 stamps webhook.tool_name:end_call on end_call dispatch", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true })),
      },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("end_call", { reason: "all_topics_covered" }),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.tool_name"]).toBe("end_call");
    expect(span!.attributes["webhook.result"]).toBe("ok");
    expect(span!.ended).toBe(true);
  });

  it("D2 stamps webhook.tool_name:next_question and webhook.result:ok on no-op ack (no use case invoked)", async () => {
    const note = vi.fn();
    const score = vi.fn();
    const end = vi.fn();
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: note },
      recordInternalScoreUseCase: { execute: score },
      endInterviewFromAgentUseCase: { execute: end },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("next_question"),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.tool_name"]).toBe("next_question");
    expect(span!.attributes["webhook.result"]).toBe("ok");
    expect(span!.ended).toBe(true);
    expect(note).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("D2 stamps webhook.result:use_case_error on genuine use-case error", async () => {
    const err: import("@repo/application").ServiceError = Object.assign(
      new Error("invalid score"),
      { code: "INVALID_INTERVIEW_INPUT" },
    ) as import("@repo/application").ServiceError;

    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(err)),
      },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: vi.fn() },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handleTool(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: "{}",
        body: baseToolBody("score_answer", { topic_name: "topic", score: 99 }),
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.webhook.tool");
    expect(span).toBeDefined();
    expect(span!.attributes["webhook.result"]).toBe("use_case_error");
    expect(span!.ended).toBe(true);
    expect(reply.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("OTel spans (ADR-032) — D3 interview.webhook.session-end + D4 interview.session.transcript-persist", () => {
  let spans: SpanCapture[];
  let restoreCtx: () => void;

  beforeEach(async () => {
    const { spans: s, provider } = buildFakeProvider();
    spans = s;
    const { trace } = await import("@opentelemetry/api");
    trace.setGlobalTracerProvider(provider);
    restoreCtx = await patchOtelContext();
    vi.resetModules();
  });

  afterEach(async () => {
    restoreCtx();
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
    vi.resetModules();
  });

  it("D3 opens interview.webhook.session-end and D4 opens interview.session.transcript-persist; both close on success", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true, entryCount: 2 })),
      },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn().mockResolvedValue(
          Result.Ok(Option.Some({ id: "interview-001" })),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d3 = spans.find((s) => s.name === "interview.webhook.session-end");
    const d4 = spans.find((s) => s.name === "interview.session.transcript-persist");
    expect(d3).toBeDefined();
    expect(d4).toBeDefined();
    expect(d3!.ended).toBe(true);
    expect(d4!.ended).toBe(true);
  });

  it("D4 stamps transcript.entry_count on successful transcript persistence", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true, entryCount: 3 })),
      },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn().mockResolvedValue(
          Result.Ok(Option.Some({ id: "interview-001" })),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d4 = spans.find((s) => s.name === "interview.session.transcript-persist");
    expect(d4).toBeDefined();
    expect(d4!.attributes["transcript.entry_count"]).toBe(3);
    expect(d4!.ended).toBe(true);
  });

  it("D4 stamps error:true and error.kind on transcript fetch failure", async () => {
    const err: import("@repo/application").ServiceError = Object.assign(
      new Error("fetch failed"),
      { code: "CONVERSATIONAL_TRANSCRIPT_FETCH_FAILED" },
    ) as import("@repo/application").ServiceError;

    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(err)),
      },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn().mockResolvedValue(
          Result.Ok(Option.Some({ id: "interview-001" })),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d4 = spans.find((s) => s.name === "interview.session.transcript-persist");
    expect(d4).toBeDefined();
    expect(d4!.attributes["error"]).toBe(true);
    expect(d4!.attributes["error.kind"]).toBe("CONVERSATIONAL_TRANSCRIPT_FETCH_FAILED");
    expect(d4!.ended).toBe(true);
  });

  it("D3 stamps webhook.result:signature_rejected on HMAC rejection", async () => {
    const persist = vi.fn();
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Err(new Error("bad sig"))) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: persist },
      interviewResolver: { findByElevenLabsSessionId: vi.fn() },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "bad" },
        rawBody: "{}",
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d3 = spans.find((s) => s.name === "interview.webhook.session-end");
    expect(d3).toBeDefined();
    expect(d3!.attributes["webhook.result"]).toBe("signature_rejected");
    expect(d3!.ended).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("D3 stamps webhook.result:use_case_error on unknown conversation_id (Option.None) ack path, route returns 200", async () => {
    const persist = vi.fn();
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: { execute: persist },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
      },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d3 = spans.find((s) => s.name === "interview.webhook.session-end");
    expect(d3).toBeDefined();
    // Source stamps use_case_error + INTERVIEW_NOT_FOUND when interview is None
    expect(d3!.attributes["webhook.result"]).toBe("use_case_error");
    expect(d3!.ended).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    // Route still returns 200 to suppress ElevenLabs redelivery
    expect(reply.statusCode).toBe(200);
  });

  it("D3 stamps interview.id and elevenLabs.sessionId on successful post-call path", async () => {
    const { ElevenLabsWebhookController } = await import("./elevenlabs-webhook.controller.js");
    const controller = new ElevenLabsWebhookController({
      verifier: { verify: vi.fn().mockReturnValue(Result.Ok(undefined)) },
      startInterviewFromWebhookUseCase: { execute: vi.fn() },
      recordAgentNoteUseCase: { execute: vi.fn() },
      recordInternalScoreUseCase: { execute: vi.fn() },
      endInterviewFromAgentUseCase: { execute: vi.fn() },
      persistCompletedTranscriptUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Ok({ applied: true, entryCount: 1 })),
      },
      interviewResolver: {
        findByElevenLabsSessionId: vi.fn().mockResolvedValue(
          Result.Ok(Option.Some({ id: "interview-001" })),
        ),
      },
    });

    const reply = new FakeReply();
    await controller.handlePostCall(
      request({
        headers: { "elevenlabs-signature": "sig" },
        rawBody: JSON.stringify(basePostCallBody),
        body: basePostCallBody,
      }),
      reply as never,
    );

    const d3 = spans.find((s) => s.name === "interview.webhook.session-end");
    expect(d3).toBeDefined();
    expect(d3!.attributes["interview.id"]).toBe("interview-001");
    expect(d3!.attributes["elevenLabs.sessionId"]).toBe("conv-001");
    expect(d3!.ended).toBe(true);
  });
});
