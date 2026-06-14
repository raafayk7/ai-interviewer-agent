import type { Result } from "@carbonteq/fp";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  InvalidCandidateTokenError,
  type GetCandidateInterviewViewInput,
  type GetCandidateInterviewViewOutput,
  type ServiceError,
} from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

export interface UseCaseLike<I, O> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface CandidateLinkVerifier {
  verify(token: string): Result<{ readonly interviewId: string }, ServiceError>;
}

export interface CandidateInterviewControllerDeps {
  readonly getCandidateInterviewViewUseCase: UseCaseLike<
    GetCandidateInterviewViewInput,
    GetCandidateInterviewViewOutput
  >;
  readonly candidateLink: CandidateLinkVerifier;
}

export class CandidateInterviewController {
  constructor(private readonly deps: CandidateInterviewControllerDeps) {}

  async getView(
    req: FastifyRequest<{
      Params: { id: string };
      Querystring: { token?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const token = req.query.token;
    if (!token) {
      sendError(reply, new InvalidCandidateTokenError("Candidate token is required"));
      return;
    }

    const verifyResult = this.deps.candidateLink.verify(token);
    if (verifyResult.isErr()) {
      sendError(reply, verifyResult.unwrapErr());
      return;
    }

    const { interviewId } = verifyResult.unwrap();
    if (interviewId !== req.params.id) {
      sendError(
        reply,
        new InvalidCandidateTokenError("Candidate token does not match interview"),
      );
      return;
    }

    const result = await this.deps.getCandidateInterviewViewUseCase.execute({
      interviewId: req.params.id,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(result.unwrap().view);
  }
}

function sendError(reply: FastifyReply, error: ServiceError): void {
  const { status, body } = mapServiceErrorToHttp(error);
  reply.code(status).send(body);
}
