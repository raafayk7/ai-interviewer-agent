import { Option, Result } from "@carbonteq/fp";
import { context as otelContext, trace, type Span } from "@opentelemetry/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PostCallTranscriptEntry, PostCallToolResult, ServiceError } from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.webhook");

export interface RawBodyFastifyRequest extends FastifyRequest {
  rawBody?: string;
}

export interface WebhookVerifierLike {
  verify(rawBody: string, signature: string | undefined): Result<void, unknown>;
}

export interface ToolSecretVerifierLike {
  verify(headerValue: string | undefined): Result<void, unknown>;
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
  readonly hmacVerifier: WebhookVerifierLike;
  readonly toolSecretVerifier: ToolSecretVerifierLike;
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
  readonly persistCompletedTranscriptUseCase: WebhookUseCaseLike<
    {
      readonly interviewId: string;
      readonly elevenLabsSessionId: string;
      readonly occurredAt: Date;
      readonly transcript: ReadonlyArray<PostCallTranscriptEntry>;
    },
    TranscriptPersistOutput
  >;
  readonly interviewResolver: InterviewIdResolverLike;
}

interface ParsedPostCallPayload {
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
  readonly terminationReason: string | null;
  readonly transcript: ReadonlyArray<PostCallTranscriptEntry>;
}

interface ParsedTakeNotePayload {
  readonly interviewId: string;
  readonly elevenLabsSessionId?: string;
  readonly note: string;
  readonly recordedAtTurn?: number;
  readonly occurredAt: Date;
}

interface ParsedScoreAnswerPayload {
  readonly interviewId: string;
  readonly elevenLabsSessionId?: string;
  readonly topicName: string;
  readonly score: number;
  readonly justification: string;
  readonly recordedAtTurn?: number;
  readonly occurredAt: Date;
}

export class ElevenLabsWebhookController {
  constructor(private readonly deps: ElevenLabsWebhookControllerDeps) {}

  async handleNextQuestion(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.tool");
    try {
      span.setAttribute("webhook.tool_name", "next_question");
      if (!(await this.verifyToolSecret(req, reply, span))) return;
      span.setAttribute("webhook.result", "ok");
      await reply.send({ ok: true });
    } finally {
      span.end();
    }
  }

  async handleScoreAnswer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.tool");
    try {
      span.setAttribute("webhook.tool_name", "score_answer");
      if (!(await this.verifyToolSecret(req, reply, span))) return;

      const payload = parseScoreAnswerPayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("interview.id", payload.interviewId);
      if (payload.elevenLabsSessionId) {
        span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
      }

      const result = await this.deps.recordInternalScoreUseCase.execute({
        interviewId: payload.interviewId,
        topicName: payload.topicName,
        score: payload.score,
        justification: payload.justification,
        recordedAtTurn: payload.recordedAtTurn,
        recordedAt: payload.occurredAt,
      });
      await sendWebhookResult(reply, result, span);
    } finally {
      span.end();
    }
  }

  async handleTakeNote(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.tool");
    try {
      span.setAttribute("webhook.tool_name", "take_note");
      if (!(await this.verifyToolSecret(req, reply, span))) return;

      const payload = parseTakeNotePayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("interview.id", payload.interviewId);
      if (payload.elevenLabsSessionId) {
        span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
      }

      const result = await this.deps.recordAgentNoteUseCase.execute({
        interviewId: payload.interviewId,
        note: payload.note,
        recordedAtTurn: payload.recordedAtTurn,
        recordedAt: payload.occurredAt,
      });
      await sendWebhookResult(reply, result, span);
    } finally {
      span.end();
    }
  }

  async handlePostCall(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.session-end");
    try {
      if (!(await this.verifyHmac(req, reply, span))) return;

      const payload = parsePostCallPayload(req.body);
      if (!payload) {
        await sendParseError(reply, span);
        return;
      }

      span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
      if (payload.terminationReason) {
        span.setAttribute("elevenlabs.termination_reason", payload.terminationReason);
      }

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
        await reply.send({ ok: true });
        return;
      }

      const interviewId = getInterviewId(interview.unwrap());
      if (!interviewId) {
        span.setAttribute("webhook.result", "use_case_error");
        span.setAttribute("error", true);
        span.setAttribute("error.kind", "INTERVIEW_ID_MISSING");
        await reply.send({ ok: true });
        return;
      }

      span.setAttribute("interview.id", interviewId);
      const spanContext = trace.setSpan(otelContext.active(), span);
      const result = await otelContext.with(spanContext, () =>
        this.persistTranscript({
          interviewId,
          elevenLabsSessionId: payload.elevenLabsSessionId,
          occurredAt: payload.occurredAt,
          transcript: payload.transcript,
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
    readonly transcript: ReadonlyArray<PostCallTranscriptEntry>;
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

      const output = result.unwrap();
      span.setAttribute("transcript.entry_count", output.entryCount);
      return result;
    } finally {
      span.end();
    }
  }

  private async verifyHmac(
    req: FastifyRequest,
    reply: FastifyReply,
    span: Span,
  ): Promise<boolean> {
    const rawBody = (req as RawBodyFastifyRequest).rawBody ?? "";
    const signature = getHeader(req.headers["elevenlabs-signature"]);
    const verified = this.deps.hmacVerifier.verify(rawBody, signature);
    if (verified.isErr()) {
      span.setAttribute("webhook.result", "signature_rejected");
      span.setAttribute("error", true);
      span.setAttribute("error.kind", "INVALID_WEBHOOK_SIGNATURE");
      const { status, body } = mapServiceErrorToHttp(
        Object.assign(new Error("rejected"), {
          code: "INVALID_WEBHOOK_SIGNATURE",
        }) as ServiceError,
      );
      await reply.code(status).send(body);
      return false;
    }
    return true;
  }

  private async verifyToolSecret(
    req: FastifyRequest,
    reply: FastifyReply,
    span: Span,
  ): Promise<boolean> {
    const headerValue = getHeader(req.headers["x-voice-secret"]);
    const verified = this.deps.toolSecretVerifier.verify(headerValue);
    if (verified.isErr()) {
      span.setAttribute("webhook.result", "signature_rejected");
      span.setAttribute("error", true);
      span.setAttribute("error.kind", "INVALID_TOOL_SECRET");
      const { status, body } = mapServiceErrorToHttp(
        Object.assign(new Error("rejected"), { code: "INVALID_TOOL_SECRET" }) as ServiceError,
      );
      await reply.code(status).send(body);
      return false;
    }
    return true;
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
  await reply.send({ ok: true, applied: result.unwrap().applied });
}

async function sendParseError(reply: FastifyReply, span: Span): Promise<void> {
  span.setAttribute("webhook.result", "parse_error");
  span.setAttribute("error", true);
  span.setAttribute("error.kind", "INVALID_WEBHOOK_PAYLOAD");
  const { status, body } = mapServiceErrorToHttp(
    Object.assign(new Error("Webhook payload is missing required fields"), {
      code: "INVALID_WEBHOOK_PAYLOAD",
    }) as ServiceError,
  );
  await reply.code(status).send(body);
}

function parsePostCallPayload(body: unknown): ParsedPostCallPayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const data = asRecord(source.data);
  if (!data) return null;

  const elevenLabsSessionId = getString(data.conversation_id);
  if (!elevenLabsSessionId) return null;

  const metadata = asRecord(data.metadata) ?? {};
  const startTimeSecs =
    typeof metadata.start_time_unix_secs === "number" ? metadata.start_time_unix_secs : null;
  const durationSecs =
    typeof metadata.call_duration_secs === "number" ? metadata.call_duration_secs : 0;
  const occurredAt =
    startTimeSecs !== null
      ? new Date((startTimeSecs + durationSecs) * 1000)
      : new Date();
  const terminationReason = getString(metadata.termination_reason) ?? null;
  const transcript = parseTranscript(data.transcript);

  return { elevenLabsSessionId, occurredAt, terminationReason, transcript };
}

function parseTranscript(raw: unknown): ReadonlyArray<PostCallTranscriptEntry> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row): PostCallTranscriptEntry | null => {
      const r = asRecord(row);
      if (!r) return null;
      const role = r.role === "agent" || r.role === "user" ? r.role : null;
      if (!role) return null;
      const message = typeof r.message === "string" ? r.message : null;
      const timeInCallSecs =
        typeof r.time_in_call_secs === "number" ? r.time_in_call_secs : 0;
      const toolResults = parseToolResults(r.tool_results);
      return { role, message, timeInCallSecs, toolResults };
    })
    .filter((entry): entry is PostCallTranscriptEntry => entry !== null);
}

function parseToolResults(raw: unknown): ReadonlyArray<PostCallToolResult> | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((row): PostCallToolResult | null => {
      const r = asRecord(row);
      if (!r) return null;
      const resultType = getString(r.result_type);
      if (!resultType) return null;
      const resultValue = asRecord(r.result_value) as
        | { reason?: string; message?: string }
        | undefined;
      return { resultType, resultValue };
    })
    .filter((entry): entry is PostCallToolResult => entry !== null);
}

function parseTakeNotePayload(body: unknown): ParsedTakeNotePayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const interviewId = getInterviewIdFromPayload(source);
  if (!interviewId) return null;

  const note =
    getString(source.note) ?? getString(source.text) ?? "";

  return {
    interviewId,
    elevenLabsSessionId: getConversationIdFromToolPayload(source) ?? undefined,
    note,
    recordedAtTurn: getNumber(source.recorded_at_turn) ?? undefined,
    occurredAt: getOccurredAt(source),
  };
}

function parseScoreAnswerPayload(body: unknown): ParsedScoreAnswerPayload | null {
  const source = asRecord(body);
  if (!source) return null;

  const interviewId = getInterviewIdFromPayload(source);
  if (!interviewId) return null;

  const topicName =
    getString(source.topic_name) ??
    getString(source.topicName) ??
    getString(source.question_id) ??
    "general";
  const score = getNumber(source.score) ?? 0;
  const justification =
    getString(source.justification) ??
    getString(source.rationale) ??
    "";

  return {
    interviewId,
    elevenLabsSessionId: getConversationIdFromToolPayload(source) ?? undefined,
    topicName,
    score,
    justification,
    recordedAtTurn: getNumber(source.recorded_at_turn) ?? undefined,
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

function getConversationIdFromToolPayload(source: Record<string, unknown>): string | null {
  const dynamicVariables = getDynamicVariables(source);
  return (
    getString(dynamicVariables?.conversation_id) ??
    getString(dynamicVariables?.conversationId) ??
    getConversationId(source)
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
