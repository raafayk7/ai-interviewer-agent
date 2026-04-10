import type { Result } from "@carbonteq/fp";
import type { ServiceError } from "./service-error.js";

export abstract class UseCase<TInput, TOutput = unknown> {
  abstract execute(input: TInput): Promise<Result<TOutput, ServiceError>>;
}
