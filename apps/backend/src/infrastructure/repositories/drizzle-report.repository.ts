import { Option, Result } from "@carbonteq/fp";
import { eq } from "drizzle-orm";
import {
  type InterviewId,
  type IReportRepository,
  Report,
  type ReportSerialized,
} from "@repo/domain";
import type { Database } from "../persistence/db.js";
import { reports, type ReportInsertRow, type ReportRow } from "../persistence/schema/reports.js";
import { translatePgError } from "./errors/translate-pg-error.js";

const rowToSerialized = (row: ReportRow): ReportSerialized => ({
  id: row.id,
  interviewId: row.interviewId,
  overallRecommendation: row.overallRecommendation,
  topicScores: row.topicScores,
  communicationAssessment: row.communicationAssessment,
  strengths: row.strengths,
  concerns: row.concerns,
  followUpQuestions: row.followUpQuestions,
  generatedAt: row.generatedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const serializedToInsertRow = (serialized: ReportSerialized): ReportInsertRow => ({
  id: serialized.id,
  interviewId: serialized.interviewId,
  overallRecommendation: serialized.overallRecommendation,
  topicScores: serialized.topicScores,
  communicationAssessment: serialized.communicationAssessment,
  strengths: serialized.strengths,
  concerns: serialized.concerns,
  followUpQuestions: serialized.followUpQuestions,
  generatedAt: serialized.generatedAt,
  createdAt: serialized.createdAt,
  updatedAt: serialized.updatedAt,
});

export class DrizzleReportRepository implements IReportRepository {
  constructor(private readonly db: Database) {}

  async save(report: Report): Promise<Result<Report, Error>> {
    const serialized = report.serialize();
    const insertRow = serializedToInsertRow(serialized);

    return Result.tryAsyncCatch(
      () =>
        this.db
          .insert(reports)
          .values(insertRow)
          .onConflictDoUpdate({
            target: reports.id,
            set: {
              interviewId: insertRow.interviewId,
              overallRecommendation: insertRow.overallRecommendation,
              topicScores: insertRow.topicScores,
              communicationAssessment: insertRow.communicationAssessment,
              strengths: insertRow.strengths,
              concerns: insertRow.concerns,
              followUpQuestions: insertRow.followUpQuestions,
              generatedAt: insertRow.generatedAt,
              updatedAt: insertRow.updatedAt,
            },
          })
          .returning(),
      translatePgError("ReportRepository.save"),
    )
      .map((rows) => Report.fromSerialized(rowToSerialized(rows[0]!)))
      .toPromise();
  }

  async findById(id: string): Promise<Result<Option<Report>, Error>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(reports).where(eq(reports.id, id)).limit(1),
      translatePgError("ReportRepository.findById"),
    )
      .map((rows) =>
        rows.length === 0 ? Option.None : Option.Some(Report.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }

  async findByInterviewId(interviewId: InterviewId): Promise<Result<Option<Report>, Error>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(reports).where(eq(reports.interviewId, interviewId)).limit(1),
      translatePgError("ReportRepository.findByInterviewId"),
    )
      .map((rows) =>
        rows.length === 0 ? Option.None : Option.Some(Report.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }
}
