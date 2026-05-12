import type { Result } from "@carbonteq/fp";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ExtractCandidateDocumentsInputDto,
  UploadCandidateDocumentsInputDto,
  type ExtractCandidateDocumentsOutput,
  type ServiceError,
  type UploadCandidateDocumentsOutput,
} from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

export interface UseCaseLike<I, O> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface RecruiterDocumentControllerDeps {
  readonly uploadDocumentsUseCase: UseCaseLike<unknown, UploadCandidateDocumentsOutput>;
  readonly extractDocumentsUseCase: UseCaseLike<unknown, ExtractCandidateDocumentsOutput>;
}

export class RecruiterDocumentController {
  constructor(private readonly deps: RecruiterDocumentControllerDeps) {}

  async upload(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const files = await collectDocumentFiles(req);
    if (!files.jdFile || !files.cvFile) {
      await reply.code(400).send({
        error: {
          code: "DTO_VALIDATION_FAILED",
          message: "jdFile and cvFile are required",
        },
      });
      return;
    }

    const dto = UploadCandidateDocumentsInputDto.parse({
      recruiterId: req.session!.userId,
      jdFile: files.jdFile,
      cvFile: files.cvFile,
    });
    if (dto.isErr()) {
      sendError(reply, dto.unwrapErr());
      return;
    }

    const result = await this.deps.uploadDocumentsUseCase.execute(dto.unwrap().value);
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(201).send(result.unwrap());
  }

  async extract(
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> {
    const dto = ExtractCandidateDocumentsInputDto.parse({
      ...(isObject(req.body) ? req.body : {}),
      recruiterId: req.session!.userId,
    });
    if (dto.isErr()) {
      sendError(reply, dto.unwrapErr());
      return;
    }

    const result = await this.deps.extractDocumentsUseCase.execute(dto.unwrap().value);
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(result.unwrap());
  }
}

interface DocumentUploadFiles {
  readonly jdFile?: FileInput;
  readonly cvFile?: FileInput;
}

interface FileInput {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly filename: string;
}

async function collectDocumentFiles(req: FastifyRequest): Promise<DocumentUploadFiles> {
  const files: { jdFile?: FileInput; cvFile?: FileInput } = {};

  for await (const part of req.parts()) {
    if (part.type !== "file") continue;
    if (part.fieldname !== "jdFile" && part.fieldname !== "cvFile") continue;

    files[part.fieldname] = await toFileInput(part);
  }

  return files;
}

async function toFileInput(part: MultipartFile): Promise<FileInput> {
  return {
    buffer: await part.toBuffer(),
    contentType: part.mimetype,
    filename: part.filename,
  };
}

function sendError(reply: FastifyReply, error: ServiceError): void {
  const { status, body } = mapServiceErrorToHttp(error);
  reply.code(status).send(body);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
