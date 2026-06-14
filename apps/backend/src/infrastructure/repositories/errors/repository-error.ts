export abstract class RepositoryError extends Error {
  abstract readonly code: string;

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class RepositoryConnectionError extends RepositoryError {
  readonly code = "REPO_CONNECTION_ERROR";
}

export class RepositoryConflictError extends RepositoryError {
  readonly code = "REPO_CONFLICT";
}

export class RepositoryNotFoundError extends RepositoryError {
  readonly code = "REPO_NOT_FOUND";

  constructor(readonly entity: string, readonly id: string) {
    super(`${entity} with id ${id} not found`);
  }
}

export class RepositoryUnknownError extends RepositoryError {
  readonly code = "REPO_UNKNOWN";

  constructor(message: string, readonly operation: string, cause?: unknown) {
    super(message, cause);
  }
}
