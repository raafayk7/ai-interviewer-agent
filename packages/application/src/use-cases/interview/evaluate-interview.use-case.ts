import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  type IInterviewRepository,
  type IReportRepository,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  Report,
  type ReportCreateProps,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type {
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
} from "../../dtos/evaluate-interview.dto.js";
import { EvaluatorOutputInvalidError } from "../../ports/interview-evaluator/interview-evaluator-error.js";
import type { IInterviewEvaluatorService } from "../../ports/interview-evaluator/interview-evaluator.port.js";
import { EVALUATION_RUBRIC } from "./evaluation-rubric.js";

export interface EvaluateInterviewDeps {
  readonly interviews: IInterviewRepository;
  readonly reports: IReportRepository;
  readonly evaluator: IInterviewEvaluatorService;
}

export class EvaluateInterviewUseCase extends UseCase<
  EvaluateInterviewInput,
  EvaluateInterviewOutput
> {
  constructor(private readonly deps: EvaluateInterviewDeps) {
    super();
  }

  async execute(
    input: EvaluateInterviewInput,
  ): Promise<Result<EvaluateInterviewOutput, ServiceError>> {
    const loadResult = await this.deps.interviews.findById(input.interviewId);
    if (loadResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          loadResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrError = loadResult.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrError.isErr()) {
      return interviewOrError;
    }

    const interview = interviewOrError.unwrap();
    if (interview.status !== INTERVIEW_STATUS.COMPLETED) {
      return Result.Err(
        new InvalidInterviewStateTransitionError(
          interview.status,
          INTERVIEW_STATUS.EVALUATED,
        ) as ServiceError,
      );
    }

    const existingReportResult = await this.deps.reports.findByInterviewId(input.interviewId);
    if (existingReportResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          existingReportResult.unwrapErr().message,
          "ReportRepository.findByInterviewId",
        ),
      );
    }

    const existingReport = existingReportResult.unwrap();
    if (existingReport.isSome()) {
      return Result.Ok({ report: existingReport.unwrap().serialize() });
    }

    const evaluateResult = await this.deps.evaluator.evaluate({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      transcript: interview.transcript,
      notes: interview.notes,
      internalScores: interview.internalScores,
      rubric: EVALUATION_RUBRIC,
    });
    if (evaluateResult.isErr()) {
      return Result.Err(evaluateResult.unwrapErr() as ServiceError);
    }

    const reportResult = this.createReport(evaluateResult.unwrap(), interview.id);
    if (reportResult.isErr()) {
      return Result.Err(reportResult.unwrapErr());
    }

    const saveReportResult = await this.deps.reports.save(reportResult.unwrap());
    if (saveReportResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(saveReportResult.unwrapErr().message, "ReportRepository.save"),
      );
    }

    const savedReport = saveReportResult.unwrap();
    const markResult = interview.markEvaluated(savedReport.id);
    if (markResult.isErr()) {
      return Result.Err(markResult.unwrapErr() as ServiceError);
    }

    const saveInterviewResult = await this.deps.interviews.save(markResult.unwrap());
    if (saveInterviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          saveInterviewResult.unwrapErr().message,
          "InterviewRepository.save",
        ),
      );
    }

    return Result.Ok({ report: savedReport.serialize() });
  }

  private createReport(
    props: ReportCreateProps,
    interviewId: string,
  ): Result<Report, ServiceError> {
    const reportResult = Report.create(props);
    if (reportResult.isErr()) {
      return Result.Err(
        new EvaluatorOutputInvalidError(reportResult.unwrapErr().message, interviewId),
      );
    }
    return Result.Ok(reportResult.unwrap());
  }
}
