import type { Result } from "@carbonteq/fp";
import type {
  CandidateInfo,
  InterviewId,
  InterviewPlan,
  JobDescription,
} from "@repo/domain";
import type { PlannerError } from "./interview-planner-error.js";

export interface InterviewPlannerInput {
  readonly interviewId: InterviewId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly targetDurationMinutes?: number;
  readonly maxDurationMinutes?: number;
}

export interface IInterviewPlannerService {
  generatePlan(input: InterviewPlannerInput): Promise<Result<InterviewPlan, PlannerError>>;
}
