import { Option, Result } from "@carbonteq/fp";
import type { IReportRepository, ReportSerialized } from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface GetReportByInterviewIdInput {
  readonly interviewId: string;
}

export interface GetReportByInterviewIdOutput {
  readonly report: Option<ReportSerialized>;
}

export class GetReportByInterviewIdUseCase extends UseCase<
  GetReportByInterviewIdInput,
  GetReportByInterviewIdOutput
> {
  constructor(private readonly reports: IReportRepository) {
    super();
  }

  async execute(
    input: GetReportByInterviewIdInput,
  ): Promise<Result<GetReportByInterviewIdOutput, ServiceError>> {
    const reportResult = await this.reports.findByInterviewId(input.interviewId);
    if (reportResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          reportResult.unwrapErr().message,
          "ReportRepository.findByInterviewId",
        ),
      );
    }

    return Result.Ok({
      report: reportResult.unwrap().map((report) => report.serialize()),
    });
  }
}
