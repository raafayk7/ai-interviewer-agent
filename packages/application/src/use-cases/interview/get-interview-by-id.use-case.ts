import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError,
  type IInterviewRepository,
  type InterviewSerialized,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface GetInterviewByIdInput {
  readonly interviewId: string;
}

export interface GetInterviewByIdOutput {
  readonly interview: InterviewSerialized;
}

export class GetInterviewByIdUseCase extends UseCase<
  GetInterviewByIdInput,
  GetInterviewByIdOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: GetInterviewByIdInput,
  ): Promise<Result<GetInterviewByIdOutput, ServiceError>> {
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
      Some: (interview) => Result.Ok({ interview: interview.serialize() }),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
  }
}
