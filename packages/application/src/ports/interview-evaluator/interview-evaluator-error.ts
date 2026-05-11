import { ServiceInfraError } from "../../core/service-error.js";

export abstract class EvaluatorError extends ServiceInfraError {}

export class EvaluatorUnavailableError extends EvaluatorError {
  readonly code = "EVALUATOR_UNAVAILABLE";
}

export class EvaluatorOutputInvalidError extends EvaluatorError {
  readonly code = "EVALUATOR_OUTPUT_INVALID";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class EvaluatorUnknownError extends EvaluatorError {
  readonly code = "EVALUATOR_UNKNOWN";

  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
