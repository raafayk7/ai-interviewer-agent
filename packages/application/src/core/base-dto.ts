import { Result } from "@carbonteq/fp";
import { ValidationError } from "@repo/domain";
import type { ZodSchema, ZodError } from "zod";

export class DtoValidationError extends ValidationError {
  readonly code = "DTO_VALIDATION_FAILED";
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
  ) {
    super(message);
  }

  static fromZod(err: ZodError): DtoValidationError {
    const issues = err.issues.map((i) => ({
      path: i.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number"),
      message: i.message,
    }));
    return new DtoValidationError(
      issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
      issues,
    );
  }
}

export abstract class BaseDto<T> {
  protected constructor(readonly value: T) {}

  static validate<T>(schema: ZodSchema<T>, input: unknown): Result<T, DtoValidationError> {
    const parsed = schema.safeParse(input);
    if (parsed.success) return Result.Ok(parsed.data);
    return Result.Err(DtoValidationError.fromZod(parsed.error));
  }
}
