import { ServiceInfraError } from "../../core/service-error.js";

export abstract class PlannerError extends ServiceInfraError {}

export class PlannerUnavailableError extends PlannerError {
  readonly code = "PLANNER_UNAVAILABLE";
}

export class PlannerOutputInvalidError extends PlannerError {
  readonly code = "PLANNER_OUTPUT_INVALID";

  constructor(
    message: string,
    readonly interviewId: string,
  ) {
    super(message);
  }
}

export class PlannerUnknownError extends PlannerError {
  readonly code = "PLANNER_UNKNOWN";

  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
  }
}
