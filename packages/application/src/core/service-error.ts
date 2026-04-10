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

export class ServiceUnknownError extends ServiceInfraError {
  readonly code = "SERVICE_UNKNOWN_ERROR";
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
