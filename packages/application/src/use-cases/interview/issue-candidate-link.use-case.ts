import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  type IInterviewRepository,
  type InterviewStatus,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface IssueCandidateLinkInput {
  readonly interviewId: string;
}

export interface IssueCandidateLinkOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;
}

const LINK_ALLOWED_STATUSES: ReadonlyArray<InterviewStatus> = [
  INTERVIEW_STATUS.SCHEDULED,
  INTERVIEW_STATUS.IN_PROGRESS,
];

export class IssueCandidateLinkUseCase extends UseCase<
  IssueCandidateLinkInput,
  IssueCandidateLinkOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: IssueCandidateLinkInput,
  ): Promise<Result<IssueCandidateLinkOutput, ServiceError>> {
    const interviewResult = await this.interviews.findById(input.interviewId);
    if (interviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          interviewResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrErr = interviewResult.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () =>
        Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrErr.isErr()) {
      return interviewOrErr;
    }

    const interview = interviewOrErr.unwrap();
    if (!LINK_ALLOWED_STATUSES.includes(interview.status)) {
      return Result.Err(
        new InvalidInterviewStateTransitionError(
          interview.status,
          INTERVIEW_STATUS.SCHEDULED,
        ) as ServiceError,
      );
    }

    return Result.Ok({ interviewId: interview.id, status: interview.status });
  }
}
