import type { Option, Result } from "@carbonteq/fp";
import type { InterviewId } from "../interview/interview.entity.js";
import type { Report } from "./report.entity.js";

export interface IReportRepository {
  save(report: Report): Promise<Result<Report, Error>>;
  findById(id: string): Promise<Result<Option<Report>, Error>>;
  findByInterviewId(interviewId: InterviewId): Promise<Result<Option<Report>, Error>>;
}
