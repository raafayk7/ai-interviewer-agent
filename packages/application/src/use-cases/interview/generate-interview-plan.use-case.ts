import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError,
  type IInterviewRepository,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import type {
  GenerateInterviewPlanInput,
  GenerateInterviewPlanOutput,
} from "../../dtos/generate-interview-plan.dto.js";
import type { IInterviewPlannerService } from "../../ports/interview-planner/interview-planner.port.js";

export class GenerateInterviewPlanUseCase extends UseCase<
  GenerateInterviewPlanInput,
  GenerateInterviewPlanOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly planner: IInterviewPlannerService,
  ) {
    super();
  }

  async execute(
    input: GenerateInterviewPlanInput,
  ): Promise<Result<GenerateInterviewPlanOutput, ServiceError>> {
    const interviewResult = await this.interviews.findById(input.interviewId);
    if (interviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          interviewResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrError = interviewResult.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }

    const interview = interviewOrError.unwrap();
    const planResult = await this.planner.generatePlan({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      targetDurationMinutes: input.targetDurationMinutes,
      maxDurationMinutes: input.maxDurationMinutes,
    });
    if (planResult.isErr()) {
      return Result.Err(planResult.unwrapErr() as ServiceError);
    }

    const plan = planResult.unwrap();
    const scheduledResult = interview.schedule(plan);
    if (scheduledResult.isErr()) {
      return Result.Err(scheduledResult.unwrapErr() as ServiceError);
    }

    const saveResult = await this.interviews.save(scheduledResult.unwrap());
    if (saveResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saveResult.unwrapErr().message, "InterviewRepository.save"),
      );
    }

    const saved = saveResult.unwrap();
    return Result.Ok({
      interviewId: saved.id,
      status: saved.status,
      topicCount: plan.topics.length,
      targetDurationMinutes: plan.targetDurationMinutes,
      maxDurationMinutes: plan.maxDurationMinutes,
    });
  }
}
