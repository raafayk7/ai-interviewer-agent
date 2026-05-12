import WebSocket from "ws";
import { Result } from "@carbonteq/fp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ServiceError } from "@repo/application";
import { buildApp } from "../../app.js";
import type { ConductInterviewRuntimeInput } from "../controllers/interview-session.controller.js";

describe("registerInterviewSessionRoutes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("accepts a WebSocket session, sends the completion envelope, and closes cleanly", async () => {
    const execute = vi.fn(async (input: ConductInterviewRuntimeInput) =>
      Result.Ok({
        interviewId: input.interviewId,
        transcript: [],
        notes: [],
        internalScores: [],
        turnsCompleted: 4,
        endReason: "all_topics_covered" as const,
        hardCeilingHit: false,
      }),
    );

    app = await buildApp({
      interviewSession: {
        deps: {
          buildUseCase: () => ({ execute }),
        },
      },
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = new WebSocket(`${address.replace(/^http/, "ws")}/interviews/interview-1/session`);

    const received = await new Promise<{ envelope: unknown; closeCode: number }>((resolve, reject) => {
      let envelope: unknown;
      client.on("message", (data, isBinary) => {
        if (!isBinary) {
          envelope = JSON.parse(data.toString("utf-8"));
        }
      });
      client.on("close", (code) => resolve({ envelope, closeCode: code }));
      client.on("error", reject);
    });

    expect(received).toEqual({
      envelope: {
        type: "session.completed",
        payload: {
          interviewId: "interview-1",
          transcript: [],
          notes: [],
          internalScores: [],
          turnsCompleted: 4,
          endReason: "all_topics_covered",
          hardCeilingHit: false,
        },
      },
      closeCode: 1000,
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1" }));
  });

  it("closes with policy violation when the guarded candidate token is missing", async () => {
    const execute = vi.fn();
    app = await buildApp({
      interviewSession: {
        deps: {
          buildUseCase: () => ({ execute }),
        },
        candidateLink: {
          verify: vi.fn(),
        },
      },
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = new WebSocket(`${address.replace(/^http/, "ws")}/interviews/interview-1/session`);

    const closeCode = await new Promise<number>((resolve, reject) => {
      client.on("close", (code) => resolve(code));
      client.on("error", reject);
    });

    expect(closeCode).toBe(1008);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts a WebSocket session when the guarded candidate token matches the route id", async () => {
    const execute = vi.fn(async (input: ConductInterviewRuntimeInput) =>
      Result.Ok({
        interviewId: input.interviewId,
        transcript: [],
        notes: [],
        internalScores: [],
        turnsCompleted: 1,
        endReason: "all_topics_covered" as const,
        hardCeilingHit: false,
      }),
    );
    app = await buildApp({
      interviewSession: {
        deps: {
          buildUseCase: () => ({ execute }),
        },
        candidateLink: {
          verify: vi.fn(() => Result.Ok({ interviewId: "interview-1" })),
        },
      },
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = new WebSocket(
      `${address.replace(/^http/, "ws")}/interviews/interview-1/session?token=valid-token`,
    );

    const closeCode = await new Promise<number>((resolve, reject) => {
      client.on("close", (code) => resolve(code));
      client.on("error", reject);
    });

    expect(closeCode).toBe(1000);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1" }));
  });

  it("closes with policy violation when the guarded candidate token is invalid", async () => {
    const execute = vi.fn();
    const invalidToken = Object.assign(new Error("invalid token"), {
      code: "INVALID_CANDIDATE_TOKEN",
    }) as ServiceError;
    app = await buildApp({
      interviewSession: {
        deps: {
          buildUseCase: () => ({ execute }),
        },
        candidateLink: {
          verify: vi.fn(() => Result.Err(invalidToken)),
        },
      },
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const client = new WebSocket(
      `${address.replace(/^http/, "ws")}/interviews/interview-1/session?token=bad-token`,
    );

    const closeCode = await new Promise<number>((resolve, reject) => {
      client.on("close", (code) => resolve(code));
      client.on("error", reject);
    });

    expect(closeCode).toBe(1008);
    expect(execute).not.toHaveBeenCalled();
  });
});
