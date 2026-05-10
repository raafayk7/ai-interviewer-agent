import WebSocket from "ws";
import { Result } from "@carbonteq/fp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

describe("registerInterviewSessionRoutes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("accepts a WebSocket session, sends the completion envelope, and closes cleanly", async () => {
    const execute = vi.fn(async (input) =>
      Result.Ok({
        interviewId: input.interviewId,
        transcript: [],
        turnsCompleted: 4,
        scriptVersion: "phase-4-spike-v1",
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
          turnsCompleted: 4,
          scriptVersion: "phase-4-spike-v1",
        },
      },
      closeCode: 1000,
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1" }));
  });
});
