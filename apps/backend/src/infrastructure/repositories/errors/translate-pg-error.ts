import {
  RepositoryConflictError,
  RepositoryConnectionError,
  RepositoryUnknownError,
  type RepositoryError,
} from "./repository-error.js";

interface PgErrorShape {
  readonly code?: string;
  readonly message?: string;
}

const isPgError = (error: unknown): error is PgErrorShape =>
  typeof error === "object" && error !== null && ("code" in error || "message" in error);

/**
 * Drizzle wraps raw postgres driver errors inside a `DrizzleQueryError`
 * (see drizzle-orm/errors.js). The actual SQLSTATE code lives on `error.cause`.
 * This helper unwraps one level to find the underlying postgres error shape.
 */
const extractPgError = (error: unknown): unknown => {
  if (
    error instanceof Error &&
    error.constructor.name === "DrizzleQueryError" &&
    (error as Error & { cause?: unknown }).cause !== undefined
  ) {
    return (error as Error & { cause?: unknown }).cause;
  }
  return error;
};

export const translatePgError =
  (operation: string) =>
  (error: unknown): RepositoryError => {
    const underlying = extractPgError(error);

    if (!isPgError(underlying)) {
      return new RepositoryUnknownError(
        error instanceof Error ? error.message : String(error),
        operation,
        error,
      );
    }

    const code = underlying.code ?? "";
    const message = underlying.message ?? "Postgres error";

    if (code === "23505" || code === "23503" || code === "23502") {
      return new RepositoryConflictError(message, error);
    }

    if (code.startsWith("08")) {
      return new RepositoryConnectionError(message, error);
    }

    return new RepositoryUnknownError(message, operation, error);
  };
