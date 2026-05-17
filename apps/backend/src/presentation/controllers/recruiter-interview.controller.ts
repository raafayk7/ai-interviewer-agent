import type { Result } from "@carbonteq/fp";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CreateInterviewInputDto,
  EvaluateInterviewInputDto,
  GenerateInterviewPlanInputDto,
  type CreateInterviewOutput,
  type EvaluateInterviewOutput,
  type GenerateInterviewPlanOutput,
  type GetInterviewByIdOutput,
  type IssueCandidateLinkOutput,
  type ListInterviewsByRecruiterOutput,
  type ServiceError,
} from "@repo/application";
import { assertRecruiterOwnsInterview } from "../auth/assert-recruiter-owns-interview.js";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

export interface UseCaseLike<I, O> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface CandidateLinkIssuer {
  issue(interviewId: string): string;
  readonly defaultTtlSeconds: number;
}

export interface RecruiterInterviewControllerDeps {
  readonly createInterviewUseCase: UseCaseLike<unknown, CreateInterviewOutput>;
  readonly listInterviewsUseCase: UseCaseLike<
    { readonly recruiterId: string },
    ListInterviewsByRecruiterOutput
  >;
  readonly getInterviewByIdUseCase: UseCaseLike<
    { readonly interviewId: string },
    GetInterviewByIdOutput
  >;
  readonly generatePlanUseCase: UseCaseLike<unknown, GenerateInterviewPlanOutput>;
  readonly evaluateInterviewUseCase: UseCaseLike<unknown, EvaluateInterviewOutput>;
  readonly getReportByInterviewIdUseCase: UseCaseLike<unknown, { readonly report: ReportOptionLike }>;
  readonly issueCandidateLinkUseCase: UseCaseLike<
    { readonly interviewId: string },
    IssueCandidateLinkOutput
  >;
  readonly candidateLink: CandidateLinkIssuer;
  readonly publicBaseUrl: string;
}

interface ReportOptionLike {
  match<T>(patterns: { Some: (value: unknown) => T; None: () => T }): T;
}

export class RecruiterInterviewController {
  constructor(private readonly deps: RecruiterInterviewControllerDeps) {}

  async create(
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> {
    const session = req.session!;
    const dto = CreateInterviewInputDto.parse(req.body);
    if (dto.isErr()) {
      sendError(reply, dto.unwrapErr());
      return;
    }

    const result = await this.deps.createInterviewUseCase.execute({
      ...dto.unwrap().value,
      recruiterId: session.userId,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(201).send(result.unwrap());
  }

  async list(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.deps.listInterviewsUseCase.execute({
      recruiterId: req.session!.userId,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(result.unwrap());
  }

  async get(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const owned = await this.getOwnedInterview(req.params.id, req.session!.userId, reply);
    if (!owned) return;

    await reply.code(200).send({ interview: owned.interview });
  }

  async generatePlan(
    req: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> {
    const owned = await this.getOwnedInterview(req.params.id, req.session!.userId, reply);
    if (!owned) return;

    const dto = GenerateInterviewPlanInputDto.parse({
      ...(isObject(req.body) ? req.body : {}),
      interviewId: req.params.id,
    });
    if (dto.isErr()) {
      sendError(reply, dto.unwrapErr());
      return;
    }

    const result = await this.deps.generatePlanUseCase.execute(dto.unwrap().value);
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send({
      ...result.unwrap(),
      candidateLink: this.buildCandidateLink(req.params.id),
    });
  }

  async issueCandidateLink(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const owned = await this.getOwnedInterview(req.params.id, req.session!.userId, reply);
    if (!owned) return;

    const result = await this.deps.issueCandidateLinkUseCase.execute({
      interviewId: req.params.id,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(this.buildCandidateLink(req.params.id));
  }

  async evaluate(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const owned = await this.getOwnedInterview(req.params.id, req.session!.userId, reply);
    if (!owned) return;

    const dto = EvaluateInterviewInputDto.parse({ interviewId: req.params.id });
    if (dto.isErr()) {
      sendError(reply, dto.unwrapErr());
      return;
    }

    const result = await this.deps.evaluateInterviewUseCase.execute(dto.unwrap().value);
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(result.unwrap());
  }

  async getReport(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const owned = await this.getOwnedInterview(req.params.id, req.session!.userId, reply);
    if (!owned) return;

    const result = await this.deps.getReportByInterviewIdUseCase.execute({
      interviewId: req.params.id,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await result.unwrap().report.match({
      Some: async (report) => reply.code(200).send({ report }),
      None: async () =>
        reply.code(404).send({
          error: {
            code: "REPORT_NOT_AVAILABLE",
            message: "Report not yet available for this interview",
          },
        }),
    });
  }

  private buildCandidateLink(interviewId: string): {
    url: string;
    token: string;
    expiresInSeconds: number;
  } {
    const token = this.deps.candidateLink.issue(interviewId);
    const url = new URL(`/c/${interviewId}`, this.deps.publicBaseUrl);
    url.searchParams.set("token", token);
    return { url: url.toString(), token, expiresInSeconds: this.deps.candidateLink.defaultTtlSeconds };
  }

  private async getOwnedInterview(
    interviewId: string,
    recruiterId: string,
    reply: FastifyReply,
  ): Promise<GetInterviewByIdOutput | null> {
    const result = await this.deps.getInterviewByIdUseCase.execute({ interviewId });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return null;
    }

    const ownership = assertRecruiterOwnsInterview(result.unwrap().interview, recruiterId);
    if (ownership.isErr()) {
      sendError(reply, ownership.unwrapErr());
      return null;
    }

    return result.unwrap();
  }
}

function sendError(reply: FastifyReply, error: ServiceError): void {
  const { status, body } = mapServiceErrorToHttp(error);
  reply.code(status).send(body);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
