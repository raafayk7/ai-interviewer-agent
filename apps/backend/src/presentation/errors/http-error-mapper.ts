import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { DtoValidationError, type ServiceError } from "@repo/application";

export interface HttpErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: ReadonlyArray<{
      readonly path: ReadonlyArray<string | number>;
      readonly message: string;
    }>;
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  INTERVIEW_NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  INVALID_INTERVIEW_STATE_TRANSITION: 409,
  INTERVIEW_PLAN_REQUIRED: 409,
  INVALID_INTERVIEW_INPUT: 400,
  INVALID_REPORT_INPUT: 400,
  INVALID_FILE_REF: 400,
  DTO_VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  INVALID_CANDIDATE_TOKEN: 401,
  FORBIDDEN: 403,
  SERVICE_UNAVAILABLE: 503,
  SERVICE_TIMEOUT: 503,
  STORAGE_UNAVAILABLE: 503,
  STORAGE_NOT_FOUND: 404,
  EXTRACTION_UNAVAILABLE: 503,
  EXTRACTION_PARSE_FAILED: 422,
  AGENT_UNAVAILABLE: 503,
  AGENT_TURN_TIMEOUT: 504,
  PLANNER_UNAVAILABLE: 503,
  PLANNER_OUTPUT_INVALID: 422,
  EVALUATOR_UNAVAILABLE: 503,
  EVALUATOR_OUTPUT_INVALID: 422,
  STT_UNAVAILABLE: 503,
  TTS_UNAVAILABLE: 503,
};

export function mapServiceErrorToHttp(
  err: ServiceError,
): { status: number; body: HttpErrorBody } {
  const status = STATUS_BY_CODE[err.code] ?? 500;
  const body: HttpErrorBody = {
    error: { code: err.code, message: err.message },
  };

  if (err instanceof DtoValidationError) {
    return {
      status,
      body: { error: { ...body.error, issues: err.issues } },
    };
  }

  return { status, body };
}

export function installErrorHandler(
  app: FastifyInstance,
  logger: FastifyBaseLogger,
): void {
  app.setErrorHandler((err, req, reply) => {
    if (isServiceError(err)) {
      const { status, body } = mapServiceErrorToHttp(err);
      reply.code(status).send(body);
      return;
    }

    logger.error({ err, reqId: req.id }, "unhandled error");
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
}

function isServiceError(err: unknown): err is ServiceError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}
