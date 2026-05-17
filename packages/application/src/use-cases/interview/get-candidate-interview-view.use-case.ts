import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError,
  type IInterviewRepository,
  type InterviewStatus,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface GetCandidateInterviewViewInput {
  readonly interviewId: string;
}

export interface CandidateInterviewView {
  readonly interviewId: string;
  readonly candidateName: string;
  readonly jobTitle: string;
  readonly company: string;
  readonly scheduledAt: string;
  readonly targetDurationMinutes: number | null;
  readonly status: InterviewStatus;
}

export interface GetCandidateInterviewViewOutput {
  readonly view: CandidateInterviewView;
}

export class GetCandidateInterviewViewUseCase extends UseCase<
  GetCandidateInterviewViewInput,
  GetCandidateInterviewViewOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: GetCandidateInterviewViewInput,
  ): Promise<Result<GetCandidateInterviewViewOutput, ServiceError>> {
    const interviewResult = await this.interviews.findById(input.interviewId);
    if (interviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          interviewResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    return interviewResult.unwrap().match({
      Some: (interview) =>
        Result.Ok({
          view: {
            interviewId: interview.id,
            candidateName: interview.candidateInfo.fullName,
            jobTitle: interview.jobDescription.title,
            company: interview.jobDescription.company,
            scheduledAt: interview.scheduledAt.toISOString(),
            targetDurationMinutes: interview.interviewPlan.match({
              Some: (plan) => plan.targetDurationMinutes,
              None: () => null,
            }),
            status: interview.status,
          },
        }),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
  }
}
