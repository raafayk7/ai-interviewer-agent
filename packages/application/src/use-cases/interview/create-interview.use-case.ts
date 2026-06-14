import { Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  Interview,
  type IInterviewRepository,
  JobDescription,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import type {
  CreateInterviewExecuteInput,
  CreateInterviewOutput,
} from "../../dtos/create-interview.dto.js";

export class CreateInterviewUseCase extends UseCase<
  CreateInterviewExecuteInput,
  CreateInterviewOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: CreateInterviewExecuteInput,
  ): Promise<Result<CreateInterviewOutput, ServiceError>> {
    const jdR = JobDescription.create(input.jobDescription);
    const ciR = CandidateInfo.create(input.candidateInfo);
    const jdRefR = FileRef.create(input.jdFileRef);
    const cvRefR = FileRef.create(input.cvFileRef);

    return Result.all(jdR, ciR, jdRefR, cvRefR)
      .mapErr((errs) => errs[0] as ServiceError)
      .map(([jobDescription, candidateInfo, jdFileRef, cvFileRef]) =>
        Interview.create({
          recruiterId: input.recruiterId,
          jobDescription,
          candidateInfo,
          clientInstructions: input.clientInstructions,
          scheduledAt: input.scheduledAt,
          jdFileRef,
          cvFileRef,
        }),
      )
      .flatMap((interview) =>
        Result.fromPromise(
          this.interviews
            .save(interview)
            .then((r) => r.mapErr((e) => new ServiceUnknownError(e.message, "InterviewRepository.save"))),
        ),
      )
      .map((saved) => ({
        interviewId: saved.id,
        status: saved.status,
        scheduledAt: saved.scheduledAt,
      }))
      .toPromise();
  }
}
