import {
  BusinessRuleViolationError,
  NotFoundError,
  ValidationError,
} from "../../../shared/domain-error.js";
import type { InterviewStatus } from "../interview-status.js";

export class InvalidInterviewStateTransitionError extends BusinessRuleViolationError {
  readonly code = "INVALID_INTERVIEW_STATE_TRANSITION";
  constructor(from: InterviewStatus, to: InterviewStatus) {
    super(`Cannot transition Interview from ${from} to ${to}`);
  }
}

export class InterviewPlanRequiredError extends BusinessRuleViolationError {
  readonly code = "INTERVIEW_PLAN_REQUIRED";
  constructor() {
    super("Interview cannot be SCHEDULED without an InterviewPlan");
  }
}

export class InvalidInterviewInputError extends ValidationError {
  readonly code = "INVALID_INTERVIEW_INPUT";
}

export class InterviewNotFoundError extends NotFoundError {
  readonly code = "INTERVIEW_NOT_FOUND";
  constructor(id: string) {
    super(`Interview with id ${id} not found`);
  }
}
