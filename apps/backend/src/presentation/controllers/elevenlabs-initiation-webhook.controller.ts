import { Option } from "@carbonteq/fp";
import { trace, type Span } from "@opentelemetry/api";
import type { Result } from "@carbonteq/fp";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServiceError } from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.webhook");

export interface AssembleConversationInitiationContextInput {
  readonly correlationToken: string;
  readonly conversationId: Option<string>;
}

export interface AssembleConversationInitiationContextOutput {
  readonly interviewId: string;
  readonly systemPrompt: string;
  readonly firstMessage?: string;
  readonly dynamicVariables: Readonly<Record<string, string>>;
}

export interface InitiationUseCaseLike {
  execute(
    input: AssembleConversationInitiationContextInput,
  ): Promise<Result<AssembleConversationInitiationContextOutput, ServiceError>>;
}

export interface ElevenLabsInitiationWebhookControllerDeps {
  readonly assembleContextUseCase: InitiationUseCaseLike;
}

interface InitiationRequestBody {
  readonly conversation_id?: unknown;
  readonly conversationId?: unknown;
  readonly dynamic_variables?: unknown;
  readonly dynamicVariables?: unknown;
}

export class ElevenLabsInitiationWebhookController {
  constructor(private readonly deps: ElevenLabsInitiationWebhookControllerDeps) {}

  async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.initiation");
    try {
      const body = asInitiationBody(req.body);
      const dynamicVariables = getDynamicVariables(body);
      const correlationToken = dynamicVariables?.["correlation_token"];
      const conversationId = getString(body.conversation_id ?? body.conversationId);

      if (conversationId) {
        span.setAttribute("elevenlabs.conversation_id", conversationId);
      }

      if (!correlationToken) {
        span.setAttribute("error", true);
        span.setAttribute("error.kind", "MISSING_CORRELATION_TOKEN");
        await reply.code(401).send({
          error: { code: "MISSING_CORRELATION_TOKEN", message: "rejected" },
        });
        return;
      }

      const result = await this.deps.assembleContextUseCase.execute({
        correlationToken,
        conversationId: conversationId ? Option.Some(conversationId) : Option.None,
      });

      if (result.isErr()) {
        await sendError(reply, result.unwrapErr(), span);
        return;
      }

      const ctx = result.unwrap();
      span.setAttribute("interview.id", ctx.interviewId);
      span.setAttribute("interview.initiation.override_assembled", true);

      await reply.code(200).send({
        conversation_config_override: {
          agent: {
            prompt: { prompt: ctx.systemPrompt },
            ...(ctx.firstMessage
              ? { first_message: ctx.firstMessage }
              : {}),
          },
        },
        dynamic_variables: ctx.dynamicVariables,
      });
    } finally {
      span.end();
    }
  }
}

async function sendError(reply: FastifyReply, error: ServiceError, span: Span): Promise<void> {
  span.setAttribute("error", true);
  span.setAttribute("error.kind", error.code);
  const { status, body } = mapServiceErrorToHttp(error);
  await reply.code(status).send(body);
}

function asInitiationBody(body: unknown): InitiationRequestBody {
  return typeof body === "object" && body !== null ? body : {};
}

function getDynamicVariables(
  body: InitiationRequestBody,
): Readonly<Record<string, string>> | null {
  const raw = body.dynamic_variables ?? body.dynamicVariables;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
