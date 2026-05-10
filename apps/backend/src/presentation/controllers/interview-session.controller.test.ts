import { EventEmitter } from "node:events";
import { Result } from "@carbonteq/fp";
import type {
  RunScriptedInterviewSessionRuntimeInput,
  RunScriptedInterviewSessionOutput,
  ServiceError,
} from "@repo/application";
import { describe, expect, it, vi } from "vitest";
import {
  InterviewSessionController,
  type RunScriptedInterviewSessionUseCaseLike,
  WS_CLOSE,
} from "./interview-session.controller.js";

class FakeWebSocket extends EventEmitter {
  readonly sent: unknown[] = [];
  readonly closes: Array<{ code: number; reason?: string }> = [];

  send(data: unknown, optionsOrCallback?: unknown, callback?: (error?: Error) => void): void {
    this.sent.push(data);

    const cb =
      typeof optionsOrCallback === "function" ? (optionsOrCallback as (error?: Error) => void) : callback;
    cb?.();
  }

  close(code: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}

const request = (id: unknown) => ({ params: { id } });

describe("InterviewSessionController", () => {
  it("closes with policy violation when interview id is invalid", async () => {
    const ws = new FakeWebSocket();
    const controller = new InterviewSessionController({
      buildUseCase: vi.fn(),
    });

    await controller.handle(ws as never, request("") as never);

    expect(ws.closes).toEqual([{ code: WS_CLOSE.POLICY_VIOLATION, reason: "invalid interview id" }]);
  });

  it("maps upstream STT/TTS unavailable errors to service restart", async () => {
    const ws = new FakeWebSocket();
    const unavailable = Object.assign(new Error("stt down"), {
      code: "STT_UNAVAILABLE",
    }) as ServiceError;
    const controller = new InterviewSessionController({
      buildUseCase: () =>
        ({
          execute: vi.fn().mockResolvedValue(Result.Err(unavailable)),
        }) as RunScriptedInterviewSessionUseCaseLike,
    });

    await controller.handle(ws as never, request("interview-1") as never);

    expect(ws.closes).toEqual([{ code: WS_CLOSE.SERVICE_RESTART, reason: "stt down" }]);
  });

  it("sends a completion envelope and closes normally on success", async () => {
    const ws = new FakeWebSocket();
    const execute = vi.fn(async (input: RunScriptedInterviewSessionRuntimeInput) => {
      await input.agentAudioOut(new Uint8Array([1, 2, 3]));
      return Result.Ok({
        interviewId: input.interviewId,
        transcript: [],
        turnsCompleted: 4,
        scriptVersion: "phase-4-spike-v1",
      });
    });
    const controller = new InterviewSessionController({
      buildUseCase: () => ({ execute }),
    });

    await controller.handle(ws as never, request("interview-1") as never);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        interviewId: "interview-1",
        candidateAudioIn: expect.anything(),
        agentAudioOut: expect.any(Function),
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(ws.sent[0]).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(String(ws.sent[1]))).toEqual({
      type: "session.completed",
      payload: {
        interviewId: "interview-1",
        transcript: [],
        turnsCompleted: 4,
        scriptVersion: "phase-4-spike-v1",
      },
    });
    expect(ws.closes).toEqual([{ code: WS_CLOSE.NORMAL, reason: "session complete" }]);
  });

  it("aborts the use case when the socket closes early", async () => {
    const ws = new FakeWebSocket();
    let capturedInput: RunScriptedInterviewSessionRuntimeInput | undefined;
    const execute = vi.fn(
      (input: RunScriptedInterviewSessionRuntimeInput) =>
        new Promise<Result<RunScriptedInterviewSessionOutput, ServiceError>>((resolve) => {
          capturedInput = input;
          input.abortSignal.addEventListener("abort", () =>
            resolve(
              Result.Ok({
                interviewId: input.interviewId,
                transcript: [],
                turnsCompleted: 0,
                scriptVersion: "phase-4-spike-v1",
              }),
            ),
          );
        }),
    );
    const controller = new InterviewSessionController({
      buildUseCase: () => ({ execute }),
    });

    const handling = controller.handle(ws as never, request("interview-1") as never);
    ws.emit("close");
    await handling;

    expect(capturedInput?.abortSignal.aborted).toBe(true);
    expect(ws.closes.at(-1)).toEqual({ code: WS_CLOSE.NORMAL, reason: "session complete" });
  });
});
