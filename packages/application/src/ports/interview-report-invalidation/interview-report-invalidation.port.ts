import type { Result } from "@carbonteq/fp";
import type { Interview } from "@repo/domain";

export interface IInterviewReportInvalidationService {
  invalidateStaleReport(interview: Interview): Promise<Result<void, Error>>;
}
