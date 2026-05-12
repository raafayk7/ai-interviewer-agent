import { Result } from "@carbonteq/fp";
import type { IInterviewRepository, InterviewSerialized } from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface ListInterviewsByRecruiterInput {
  readonly recruiterId: string;
}

export interface ListInterviewsByRecruiterOutput {
  readonly interviews: ReadonlyArray<InterviewSerialized>;
}

export class ListInterviewsByRecruiterUseCase extends UseCase<
  ListInterviewsByRecruiterInput,
  ListInterviewsByRecruiterOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: ListInterviewsByRecruiterInput,
  ): Promise<Result<ListInterviewsByRecruiterOutput, ServiceError>> {
    const result = await this.interviews.listByRecruiter(input.recruiterId);
    if (result.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          result.unwrapErr().message,
          "InterviewRepository.listByRecruiter",
        ),
      );
    }

    return Result.Ok({
      interviews: result.unwrap().map((interview) => interview.serialize()),
    });
  }
}
