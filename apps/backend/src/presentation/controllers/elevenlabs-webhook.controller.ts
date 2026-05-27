import { Option, Result } from "@carbonteq/fp";
import { context as otelContext, trace, type Span } from "@opentelemetry/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServiceError } from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.webhook");

export interface RawBodyFastifyRequest extends FastifyRequest {
  rawBody?: string;
}

export interface WebhookVerifierLike {
  verify(rawBody: string, signature: string | undefined): Result<void, unknown>;
}

export interface WebhookUseCaseLike<I, O = WebhookReceiverOutput> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface WebhookReceiverOutput {
  readonly applied: boolean;
}

export interface TranscriptPersistOutput extends WebhookReceiverOutput {
  readonly entryCount: number;
}

export interface InterviewIdResolverLike {
  findByElevenLabsSessionId(
    elevenLabsSessionId: string,
  ): Promise<Result<Option<InterviewIdLike>, ServiceError>>;
}

export interface InterviewIdLike {
  readonly id?: string;
  serialize?: () => { readonly id?: string };
}

export interface ElevenLabsWebhookControllerDeps {
  readonly verifier: WebhookVerifierLike;
  readonly startInterviewFromWebhookUseCase: WebhookUseCaseLike<{
    readonly interviewId: string;
    readonly elevenLabsSessionId: string;
    readonly occurredAt: Date;
  }>;
  readonly recordAgentNoteUseCase: WebhookUseCaseLike<{
    readonly interviewId: string;
    readonly note: string;
    readonly recordedAtTurn?: number;
    readonly recordedAt: Date;
  }>;
  readonly recordInternalScoreUseCase: WebhookUseCaseLike<{
    readonly interviewId: string;
    readonly topicName: string;
    readonly score: number;
    readonly justification: string;
    readonly recordedAtTurn?: number;
    readonly recordedAt: Date;
  }>;
  readonly endInterviewFromAgentUseCase: WebhookUseCaseLike<{
    readonly interviewId: string;
    readonly reason: string;
    readonly recordedAtTurn?: number;
    readonly recordedAt: Date;
  }>;
  readonly persistCompletedTranscriptUseCase: WebhookUseCaseLike<
    {
      readonly interviewId: string;
      readonly elevenLabsSessionId: string;
      readonly occurredAt: Date;
    },
    TranscriptPersistOutput
  >;
  readonly interviewResolver: InterviewIdResolverLike;
}

interface ParsedSessionStartPayload {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
}

interface ParsedToolPayload extends ParsedSessionStartPayload {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface ParsedPostCallPayload {
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
}

export class ElevenLabsWebhookController {
  constructor(private readonly deps: ElevenLabsWebhookControllerDeps) {}

  async handleSessionStart(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const span = tracer.startSpan("interview.webhook.session-start");
    try {
      if (!(await this.verifyWebhook(req, reply, span))) return;

      const payload = parseSessionStartPayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("interview.id", payload.interviewId);
      span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);

      const result = await this.deps.startInterviewFromWebhookUseCase.execute({
        interviewId: payload.interviewId,
        elevenLabsSessionId: payload.elevenLabsSessionId,
        occurredAt: payload.occurredAt,
      });
      await sendWebhookResult(reply, result, span);
    } finally {
      span.end();
    }
  }

  async handleTool(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.tool");
    try {
      if (!(await this.verifyWebhook(req, reply, span))) return;

      const payload = parseToolPayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("interview.id", payload.interviewId);
      span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
      span.setAttribute("webhook.tool_name", payload.toolName);

      if (payload.toolName === "next_question") {
        span.setAttribute("webhook.result", "ok");
        await reply.code(200).send({ ok: true });
        return;
      }

      const result = await this.dispatchTool(payload);
      await sendWebhookResult(reply, result, span);
    } finally {
      span.end();
    }
  }

  async handlePostCall(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.session-end");
    try {
      if (!(await this.verifyWebhook(req, reply, span))) return;

      const payload = parsePostCallPayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);

      const interviewResult =
        await this.deps.interviewResolver.findByElevenLabsSessionId(
          payload.elevenLabsSessionId,
        );
      if (interviewResult.isErr()) {
        await sendWebhookResult(reply, interviewResult, span);
        return;
      }

      const interview = interviewResult.unwrap();
      if (interview.isNone()) {
        span.setAttribute("webhook.result", "use_case_error");
        span.setAttribute("error", true);
        span.setAttribute("error.kind", "INTERVIEW_NOT_FOUND");
        await reply.code(200).send({ ok: true });
        return;
      }

      const interviewId = getInterviewId(interview.unwrap());
      if (!interviewId) {
        span.setAttribute("webhook.result", "use_case_error");
        span.setAttribute("error", true);
        span.setAttribute("error.kind", "INTERVIEW_ID_MISSING");
        await reply.code(200).send({ ok: true });
        return;
      }

      span.setAttribute("interview.id", interviewId);
      const spanContext = trace.setSpan(otelContext.active(), span);
      const result = await otelContext.with(spanContext, () =>
        this.persistTranscript({
          interviewId,
          elevenLabsSessionId: payload.elevenLabsSessionId,
          occurredAt: payload.occurredAt,
        }),
      );
      await sendWebhookResult(reply, result, span);
    } finally {
      span.end();
    }
  }

  private async persistTranscript(input: {
    readonly interviewId: string;
    readonly elevenLabsSessionId: string;
    readonly occurredAt: Date;
  }): Promise<Result<TranscriptPersistOutput, ServiceError>> {
    const span = tracer.startSpan("interview.session.transcript-persist");
    try {
      const spanContext = trace.setSpan(otelContext.active(), span);
      const result = await otelContext.with(spanContext, () =>
        this.deps.persistCompletedTranscriptUseCase.execute(input),
      );
      if (result.isErr()) {
        const error = result.unwrapErr();
        span.setAttribute("error", true);
        span.setAttribute("error.kind", error.code);
        return result;
      }

      span.setAttribute("transcript.entry_count", result.unwrap().entryCount);
      return result;
    } finally {
      span.end();
    }
  }

  private async verifyWebhook(
    req: FastifyRequest,
    reply: FastifyReply,
    span: Span,
  ): Promise<boolean> {
    const rawBody = (req as RawBodyFastifyRequest).rawBody ?? "";
    const signature = getHeader(req.headers["elevenlabs-signature"]);
    const verified = this.deps.verifier.verify(rawBody, signature);
    if (verified.isErr()) {
      span.setAttribute("webhook.result", "signature_rejected");
      span.setAttribute("error", true);
      span.setAttribute("error.kind", "INVALID_WEBHOOK_SIGNATURE");
      await reply.code(401).send({
        error: { code: "INVALID_WEBHOOK_SIGNATURE", message: "rejected" },
      });
      return false;
    }

    return true;
  }

  private dispatchTool(
    payload: ParsedToolPayload,
  ): Promise<Result<WebhookReceiverOutput, ServiceError>> {
    if (payload.toolName === "take_note") {
      return this.deps.recordAgentNoteUseCase.execute({
        interviewId: payload.interviewId,
        note: getString(payload.args.note) ?? getString(payload.args.text) ?? "",
        recordedAtTurn: getNumber(payload.args.recorded_at_turn) ?? undefined,
        recordedAt: payload.occurredAt,
      });
    }

    if (payload.toolName === "score_answer") {
      return this.deps.recordInternalScoreUseCase.execute({
        interviewId: payload.interviewId,
        topicName:
          getString(payload.args.topic_name) ??
          getString(payload.args.topicName) ??
          getString(payload.args.question_id) ??
          "general",
        score: getNumber(payload.args.score) ?? 0,
        justification:
          getString(payload.args.justification) ??
          getString(payload.args.rationale) ??
          "",
        recordedAtTurn: getNumber(payload.args.recorded_at_turn) ?? undefined,
        recordedAt: payload.occurredAt,
      });
    }

    if (payload.toolName === "end_call") {
      return this.deps.endInterviewFromAgentUseCase.execute({
        interviewId: payload.interviewId,
        reason:
          getString(payload.args.reason) ??
          getString(payload.args.end_reason) ??
          "agent_requested_end_call",
        recordedAtTurn: getNumber(payload.args.recorded_at_turn) ?? undefined,
        recordedAt: payload.occurredAt,
      });
    }

    return Promise.resolve(Result.Ok({ applied: false }));
  }
}

async function sendWebhookResult<O extends WebhookReceiverOutput>(
  reply: FastifyReply,
  result: Result<O, ServiceError>,
  span: Span,
): Promise<void> {
  if (result.isErr()) {
    const error = result.unwrapErr();
    span.setAttribute("webhook.result", "use_case_error");
    span.setAttribute("error", true);
    span.setAttribute("error.kind", error.code);
    const { status, body } = mapServiceErrorToHttp(error);
    await reply.code(status).send(body);
    return;
  }

  span.setAttribute("webhook.result", "ok");
  await reply.code(200).send({ ok: true, applied: result.unwrap().applied });
}

async function sendParseError(reply: FastifyReply, span: Span): Promise<void> {
  span.setAttribute("webhook.result", "parse_error");
  span.setAttribute("error", true);
  span.setAttribute("error.kind", "INVALID_WEBHOOK_PAYLOAD");
  await reply.code(400).send({
    error: {
      code: "INVALID_WEBHOOK_PAYLOAD",
      message: "Webhook payload is missing required fields",
    },
  });
}

function parseSessionStartPayload(
  body: unknown,
): ParsedSessionStartPayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const interviewId = getInterviewIdFromPayload(source);
  const elevenLabsSessionId = getConversationId(source);
  if (!interviewId || !elevenLabsSessionId) return null;

  return {
    interviewId,
    elevenLabsSessionId,
    occurredAt: getOccurredAt(source),
  };
}

function parseToolPayload(body: unknown): ParsedToolPayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const base = parseSessionStartPayload(source);
  const toolName =
    getString(source.tool_name) ??
    getString(source.toolName) ??
    getString(source.name) ??
    getString(asRecord(source.tool)?.name);
  if (!base || !toolName) return null;

  return {
    ...base,
    toolName,
    args: getArgs(source),
  };
}

function parsePostCallPayload(body: unknown): ParsedPostCallPayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const elevenLabsSessionId = getConversationId(source);
  if (!elevenLabsSessionId) return null;

  return {
    elevenLabsSessionId,
    occurredAt: getOccurredAt(source),
  };
}

function getInterviewIdFromPayload(source: Record<string, unknown>): string | null {
  const dynamicVariables = getDynamicVariables(source);
  return (
    getString(dynamicVariables?.interview_id) ??
    getString(dynamicVariables?.interviewId) ??
    getString(source.interview_id) ??
    getString(source.interviewId)
  );
}

function getConversationId(source: Record<string, unknown>): string | null {
  return (
    getString(source.conversation_id) ??
    getString(source.conversationId) ??
    getString(asRecord(source.conversation)?.id)
  );
}

function getDynamicVariables(
  source: Record<string, unknown>,
): Record<string, unknown> | null {
  return (
    asRecord(source.dynamic_variables) ??
    asRecord(source.dynamicVariables) ??
    asRecord(asRecord(source.conversation_initiation_client_data)?.dynamic_variables)
  );
}

function getArgs(source: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return (
    asRecord(source.parameters) ??
    asRecord(source.args) ??
    asRecord(source.arguments) ??
    asRecord(source.tool_call) ??
    {}
  );
}

function getOccurredAt(source: Record<string, unknown>): Date {
  const raw =
    getString(source.occurred_at) ??
    getString(source.occurredAt) ??
    getString(source.created_at) ??
    getString(source.createdAt);
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getInterviewId(interview: InterviewIdLike): string | null {
  return getString(interview.id) ?? getString(interview.serialize?.().id);
}

function getHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
