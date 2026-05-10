import { context as otelContext, trace, type Span } from "@opentelemetry/api";
import type { Result } from "@carbonteq/fp";
import type { WebSocket } from "@fastify/websocket";
import type { FastifyRequest } from "fastify";
import type {
  ConductInterviewInput,
  ConductInterviewOutput,
  ServiceError,
} from "@repo/application";
import { sendBinaryFrame, wsBinaryToAsyncIterable } from "../websocket/voice-websocket.js";

const sessionTracer = trace.getTracer("ai-interviewer.session");

export const WS_CLOSE = {
  NORMAL: 1000,
  POLICY_VIOLATION: 1008,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012,
} as const;

export interface ConductInterviewUseCaseLike {
  execute(
    input: ConductInterviewRuntimeInput,
  ): Promise<Result<ConductInterviewOutput, ServiceError>>;
}

export interface ConductInterviewRuntimeInput extends ConductInterviewInput {
  readonly candidateAudioIn: AsyncIterable<Uint8Array>;
  readonly agentAudioOut: (chunk: Uint8Array) => Promise<void>;
  readonly abortSignal: AbortSignal;
}

export interface InterviewSessionDeps {
  readonly buildUseCase: () => ConductInterviewUseCaseLike;
}

export class InterviewSessionController {
  constructor(private readonly deps: InterviewSessionDeps) {}

  async handle(ws: WebSocket, req: FastifyRequest): Promise<void> {
    const interviewId = parseInterviewId(req.params);
    if (!interviewId) {
      ws.close(WS_CLOSE.POLICY_VIOLATION, "invalid interview id");
      return;
    }

    const sessionSpan = sessionTracer.startSpan("interview.session.agent", {
      attributes: {
        "interview.id": interviewId,
      },
    });

    const abortController = new AbortController();
    ws.once("close", () => abortController.abort());
    ws.once("error", () => abortController.abort());

    try {
      const sessionContext = trace.setSpan(otelContext.active(), sessionSpan);
      const result = await otelContext.with(sessionContext, () =>
        this.deps.buildUseCase().execute({
          interviewId,
          candidateAudioIn: wsBinaryToAsyncIterable(ws, abortController.signal),
          agentAudioOut: (chunk) => sendBinaryFrame(ws, chunk),
          abortSignal: abortController.signal,
        }),
      );

      if (result.isErr()) {
        const error = result.unwrapErr();
        recordSessionException(sessionSpan, error);
        ws.close(mapErrorToWsClose(error), closeReason(error.message));
        return;
      }

      await sendTextFrame(ws, {
        type: "session.completed",
        payload: result.unwrap(),
      });
      ws.close(WS_CLOSE.NORMAL, "session complete");
    } catch (error) {
      recordSessionException(sessionSpan, error);
      ws.close(WS_CLOSE.INTERNAL_ERROR, closeReason(errorMessage(error)));
    } finally {
      sessionSpan.end();
      abortController.abort();
    }
  }
}

export function mapErrorToWsClose(error: ServiceError): number {
  if (
    error.code === "STT_UNAVAILABLE" ||
    error.code === "TTS_UNAVAILABLE" ||
    error.code === "AGENT_UNAVAILABLE" ||
    error.code === "SERVICE_UNAVAILABLE" ||
    error.code === "AGENT_TURN_TIMEOUT"
  ) {
    return WS_CLOSE.SERVICE_RESTART;
  }

  if (error.code === "INTERVIEW_NOT_FOUND" || error.code === "INVALID_INTERVIEW_INPUT") {
    return WS_CLOSE.POLICY_VIOLATION;
  }

  return WS_CLOSE.INTERNAL_ERROR;
}

function parseInterviewId(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;

  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string") return null;

  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function sendTextFrame(ws: WebSocket, envelope: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.send(JSON.stringify(envelope), (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function recordSessionException(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(errorMessage(error)));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return String(error);
}

function closeReason(message: string): string {
  return message.slice(0, 120);
}
