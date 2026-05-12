import { DomainError } from "@repo/domain";

export type ServiceError = DomainError | ServiceInfraError;

export abstract class ServiceInfraError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ServiceUnavailableError extends ServiceInfraError {
  readonly code = "SERVICE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
  }
}

export class ServiceTimeoutError extends ServiceInfraError {
  readonly code = "SERVICE_TIMEOUT";
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends ServiceInfraError {
  readonly code = "UNAUTHORIZED";
  constructor(message = "Authentication required") {
    super(message);
  }
}

export class InvalidCandidateTokenError extends ServiceInfraError {
  readonly code = "INVALID_CANDIDATE_TOKEN";
  constructor(message = "Candidate link invalid or expired") {
    super(message);
  }
}

export class ForbiddenError extends ServiceInfraError {
  readonly code = "FORBIDDEN";
  constructor(message = "Not permitted") {
    super(message);
  }
}

export class ServiceUnknownError extends ServiceInfraError {
  readonly code = "SERVICE_UNKNOWN_ERROR";
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
