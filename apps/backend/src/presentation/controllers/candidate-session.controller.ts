import { trace, type Span } from "@opentelemetry/api";
import type { Result } from "@carbonteq/fp";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  InvalidCandidateTokenError,
  type ServiceError,
} from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.session");

export interface UseCaseLike<I, O> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface CandidateLinkVerifier {
  verify(token: string): Result<{ readonly interviewId: string }, ServiceError>;
}

export interface StartCandidateSessionInput {
  readonly interviewId: string;
  readonly agentId: string;
}

export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly overrides: {
    readonly agent: {
      readonly prompt: { readonly prompt: string };
    };
  };
  readonly dynamicVariables: Readonly<Record<string, string>>;
}

export interface CandidateSessionControllerDeps {
  readonly startCandidateSessionUseCase: UseCaseLike<
    StartCandidateSessionInput,
    StartCandidateSessionOutput
  >;
  readonly candidateLink: CandidateLinkVerifier;
  readonly agentId: string;
}

export class CandidateSessionController {
  constructor(private readonly deps: CandidateSessionControllerDeps) {}

  async start(
    req: FastifyRequest<{
      Params: { id: string };
      Querystring: { token?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const span = tracer.startSpan("interview.session.conversational", {
      attributes: { "interview.id": parseInterviewId(req.params) ?? "" },
    });
    try {
      const interviewId = parseInterviewId(req.params);
      if (!interviewId) {
        await sendError(
          reply,
          new InvalidCandidateTokenError("Interview id is required"),
          span,
        );
        return;
      }

      const token = req.query.token;
      if (!token) {
        await sendError(
          reply,
          new InvalidCandidateTokenError("Candidate token is required"),
          span,
        );
        return;
      }

      const verified = this.deps.candidateLink.verify(token);
      if (verified.isErr()) {
        await sendError(reply, verified.unwrapErr(), span);
        return;
      }

      if (verified.unwrap().interviewId !== interviewId) {
        await sendError(
          reply,
          new InvalidCandidateTokenError("Token does not match interview"),
          span,
        );
        return;
      }

      const result = await this.deps.startCandidateSessionUseCase.execute({
        interviewId,
        agentId: this.deps.agentId,
      });
      if (result.isErr()) {
        await sendError(reply, result.unwrapErr(), span);
        return;
      }

      span.setAttribute("elevenLabs.agentId", this.deps.agentId);
      span.setAttribute("interview.session.override_assembled", true);
      await reply.code(200).send(result.unwrap());
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

function parseInterviewId(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;

  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string") return null;

  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}
