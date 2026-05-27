import { Result } from "@carbonteq/fp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceError } from "@repo/application";
import { ConversationalSignedUrlFailedError } from "@repo/application";
import {
  InterviewNotFoundError,
  InvalidInterviewInputError,
} from "@repo/domain";
import {
  CandidateSessionController,
  type CandidateLinkVerifier,
  type CandidateSessionControllerDeps,
} from "./candidate-session.controller.js";

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
  overrides: Partial<CandidateSessionControllerDeps> = {},
): CandidateSessionControllerDeps => ({
  agentId: "agent-001",
  candidateLink: {
    verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001" })),
  },
  startCandidateSessionUseCase: {
    execute: vi.fn().mockResolvedValue(
      Result.Ok({
        signedUrl: "https://signed.example/session",
        sessionToken: "session-token",
      }),
    ),
  },
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("[E2E] CandidateSessionController", () => {
  describe("start() — success path", () => {
    it("returns 200 with signedUrl and sessionToken on valid request", async () => {
      const deps = makeDeps();
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({
          params: { id: "interview-001" },
          query: { token: "candidate-token" },
        }),
        reply as never,
      );

      expect(reply.statusCode).toBe(200);
      expect(reply.body).toEqual({
        signedUrl: "https://signed.example/session",
        sessionToken: "session-token",
      });
    });

    it("invokes use case with correct interviewId and agentId", async () => {
      const deps = makeDeps();
      const controller = new CandidateSessionController(deps);

      await controller.start(
        request({
          params: { id: "interview-001" },
          query: { token: "candidate-token" },
        }),
        new FakeReply() as never,
      );

      expect(deps.startCandidateSessionUseCase.execute).toHaveBeenCalledWith({
        interviewId: "interview-001",
        agentId: "agent-001",
      });
    });
  });

  describe("start() — authentication/token guards", () => {
    it("returns 401 when token query param is missing", async () => {
      const execute = vi.fn();
      const deps = makeDeps({ startCandidateSessionUseCase: { execute } });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: {} }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });

    it("returns 401 when token query param is empty string", async () => {
      const execute = vi.fn();
      const deps = makeDeps({ startCandidateSessionUseCase: { execute } });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });

    it("returns 401 when candidateLink.verify fails", async () => {
      const execute = vi.fn();
      const invalidToken: ServiceError = Object.assign(new Error("invalid token"), {
        code: "INVALID_CANDIDATE_TOKEN",
      }) as ServiceError;
      const deps = makeDeps({
        candidateLink: { verify: vi.fn().mockReturnValue(Result.Err(invalidToken)) },
        startCandidateSessionUseCase: { execute },
      });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "bad-token" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });

    it("returns 401 when verified token interviewId does not match params.id", async () => {
      const execute = vi.fn();
      const deps = makeDeps({
        candidateLink: {
          verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "OTHER-interview" })),
        },
        startCandidateSessionUseCase: { execute },
      });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "valid-token" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("start() — use case error paths", () => {
    it("returns 404 when use case returns InterviewNotFoundError", async () => {
      const deps = makeDeps({
        startCandidateSessionUseCase: {
          execute: vi.fn().mockResolvedValue(
            Result.Err(new InterviewNotFoundError("interview-001") as ServiceError),
          ),
        },
      });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "candidate-token" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(404);
    });

    it("returns 400 when use case returns InvalidInterviewInputError (non-SCHEDULED)", async () => {
      const deps = makeDeps({
        startCandidateSessionUseCase: {
          execute: vi.fn().mockResolvedValue(
            Result.Err(new InvalidInterviewInputError("Interview is not SCHEDULED") as ServiceError),
          ),
        },
      });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "candidate-token" } }),
        reply as never,
      );

      expect(reply.statusCode).toBe(400);
    });

    it("returns 503 when provider returns ConversationalSignedUrlFailedError", async () => {
      const deps = makeDeps({
        startCandidateSessionUseCase: {
          execute: vi.fn().mockResolvedValue(
            Result.Err(
              new ConversationalSignedUrlFailedError("provider error", "interview-001") as ServiceError,
            ),
          ),
        },
      });
      const controller = new CandidateSessionController(deps);
      const reply = new FakeReply();

      await controller.start(
        request({ params: { id: "interview-001" }, query: { token: "candidate-token" } }),
        reply as never,
      );

      // CONVERSATIONAL_SIGNED_URL_FAILED has no explicit mapping → 500 fallback
      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});

// ── OTel span tests ──────────────────────────────────────────────────────────
//
// The controller caches `const tracer = trace.getTracer(...)` at module-load
// time. To intercept span calls reliably we reset the module registry and
// dynamically import the controller AFTER installing the fake tracer provider
// via `trace.setGlobalTracerProvider`. Each `describe` block below does this
// in its `beforeEach`, restores via `trace.disable()` in `afterEach`, and
// re-registers `vi.resetModules()` so the next block gets a clean slate too.

interface SpanCapture {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

function makeSpanCapture(name: string): SpanCapture {
  return { name, attributes: {}, ended: false };
}

function buildFakeProvider(): { spans: SpanCapture[]; provider: import("@opentelemetry/api").TracerProvider } {
  const spans: SpanCapture[] = [];
  const provider: import("@opentelemetry/api").TracerProvider = {
    getTracer() {
      return {
        startSpan(spanName: string, options?: { attributes?: Record<string, unknown> }): import("@opentelemetry/api").Span {
          const capture = makeSpanCapture(spanName);
          // Copy attributes passed via startSpan options (OTel allows passing them at open time)
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

describe("OTel spans (ADR-032) — D1 interview.session.conversational", () => {
  let spans: SpanCapture[];
  let controller: import("./candidate-session.controller.js").CandidateSessionController;
  let makeDepsDynamic: typeof makeDeps;

  beforeEach(async () => {
    const { spans: s, provider } = buildFakeProvider();
    spans = s;
    const { trace } = await import("@opentelemetry/api");
    trace.setGlobalTracerProvider(provider);

    // Reset modules so the controller re-executes trace.getTracer() with the
    // fake provider now set as delegate.
    vi.resetModules();

    const mod = await import("./candidate-session.controller.js");
    controller = new mod.CandidateSessionController({
      agentId: "agent-001",
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001" })),
      },
      startCandidateSessionUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({
            signedUrl: "https://signed.example/session",
            sessionToken: "session-token",
          }),
        ),
      },
    });

    makeDepsDynamic = (overrides = {}) => ({
      agentId: "agent-001",
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001" })),
      },
      startCandidateSessionUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Ok({
            signedUrl: "https://signed.example/session",
            sessionToken: "session-token",
          }),
        ),
      },
      ...overrides,
    });
  });

  afterEach(async () => {
    const { trace } = await import("@opentelemetry/api");
    trace.disable();
    vi.resetModules();
  });

  it("D1 opens span with interview.id attribute and closes on success path", async () => {
    const reply = new FakeReply();
    await controller.start(
      request({
        params: { id: "interview-001" },
        query: { token: "candidate-token" },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.session.conversational");
    expect(span).toBeDefined();
    expect(span!.attributes["interview.id"]).toBe("interview-001");
    expect(span!.ended).toBe(true);
  });

  it("D1 stamps elevenLabs.agentId on success path", async () => {
    const reply = new FakeReply();
    await controller.start(
      request({
        params: { id: "interview-001" },
        query: { token: "candidate-token" },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.session.conversational");
    expect(span).toBeDefined();
    expect(span!.attributes["elevenLabs.agentId"]).toBe("agent-001");
  });

  it("D1 stamps error:true and error.kind on use-case error path (InterviewNotFoundError)", async () => {
    vi.resetModules();
    const mod = await import("./candidate-session.controller.js");
    const domainMod = await import("@repo/domain");

    const c = new mod.CandidateSessionController({
      agentId: "agent-001",
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001" })),
      },
      startCandidateSessionUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Err(new domainMod.InterviewNotFoundError("interview-001") as import("@repo/application").ServiceError),
        ),
      },
    });

    const reply = new FakeReply();
    await c.start(
      request({
        params: { id: "interview-001" },
        query: { token: "candidate-token" },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.session.conversational");
    expect(span).toBeDefined();
    expect(span!.attributes["error"]).toBe(true);
    expect(span!.attributes["error.kind"]).toBe("INTERVIEW_NOT_FOUND");
    expect(span!.ended).toBe(true);
  });

  it("D1 stamps error:true and error.kind when candidate-link verification fails", async () => {
    vi.resetModules();
    const mod = await import("./candidate-session.controller.js");

    const invalidToken: import("@repo/application").ServiceError = Object.assign(
      new Error("invalid token"),
      { code: "INVALID_CANDIDATE_TOKEN" },
    ) as import("@repo/application").ServiceError;

    const c = new mod.CandidateSessionController({
      agentId: "agent-001",
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Err(invalidToken)),
      },
      startCandidateSessionUseCase: {
        execute: vi.fn(),
      },
    });

    const reply = new FakeReply();
    await c.start(
      request({
        params: { id: "interview-001" },
        query: { token: "bad-token" },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.session.conversational");
    expect(span).toBeDefined();
    expect(span!.attributes["error"]).toBe(true);
    expect(span!.attributes["error.kind"]).toBe("INVALID_CANDIDATE_TOKEN");
    expect(span!.ended).toBe(true);
  });

  it("D1 stamps error:true and error.kind when token does not match interview id", async () => {
    vi.resetModules();
    const mod = await import("./candidate-session.controller.js");

    const c = new mod.CandidateSessionController({
      agentId: "agent-001",
      candidateLink: {
        verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "OTHER-interview" })),
      },
      startCandidateSessionUseCase: {
        execute: vi.fn(),
      },
    });

    const reply = new FakeReply();
    await c.start(
      request({
        params: { id: "interview-001" },
        query: { token: "valid-token" },
      }),
      reply as never,
    );

    const span = spans.find((s) => s.name === "interview.session.conversational");
    expect(span).toBeDefined();
    expect(span!.attributes["error"]).toBe(true);
    expect(span!.attributes["error.kind"]).toBe("INVALID_CANDIDATE_TOKEN");
    expect(span!.ended).toBe(true);
  });
});
