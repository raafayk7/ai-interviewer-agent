import { Result } from "@carbonteq/fp";
import { eq } from "drizzle-orm";
import { type Interview, type InterviewSerialized } from "@repo/domain";
import type { Database } from "./db.js";
import { interviews, type InterviewInsertRow } from "./schema/interviews.js";
import { reports } from "./schema/reports.js";
import { translatePgError } from "../repositories/errors/translate-pg-error.js";

const serializedToInsertRow = (serialized: InterviewSerialized): InterviewInsertRow => ({
  id: serialized.id,
  recruiterId: serialized.recruiterId,
  status: serialized.status,
  jobDescription: serialized.jobDescription,
  candidateInfo: serialized.candidateInfo,
  clientInstructions: serialized.clientInstructions,
  interviewPlan: serialized.interviewPlan,
  transcript: serialized.transcript,
  notes: serialized.notes,
  internalScores: serialized.internalScores,
  elevenLabsSessionId: serialized.elevenLabsSessionId,
  jdFileRef: serialized.jdFileRef,
  cvFileRef: serialized.cvFileRef,
  scheduledAt: serialized.scheduledAt,
  startedAt: serialized.startedAt,
  completedAt: serialized.completedAt,
  reportId: serialized.reportId,
  createdAt: serialized.createdAt,
  updatedAt: serialized.updatedAt,
});

export class DrizzleInterviewReportInvalidationService {
  constructor(private readonly db: Database) {}

  async invalidateStaleReport(interview: Interview): Promise<Result<void, Error>> {
    const insertRow = serializedToInsertRow(interview.serialize());

    return Result.tryAsyncCatch(
      () =>
        this.db.transaction(async (tx) => {
          await tx
            .insert(interviews)
            .values(insertRow)
            .onConflictDoUpdate({
              target: interviews.id,
              set: {
                recruiterId: insertRow.recruiterId,
                status: insertRow.status,
                jobDescription: insertRow.jobDescription,
                candidateInfo: insertRow.candidateInfo,
                clientInstructions: insertRow.clientInstructions,
                interviewPlan: insertRow.interviewPlan,
                transcript: insertRow.transcript,
                notes: insertRow.notes,
                internalScores: insertRow.internalScores,
                elevenLabsSessionId: insertRow.elevenLabsSessionId,
                jdFileRef: insertRow.jdFileRef,
                cvFileRef: insertRow.cvFileRef,
                scheduledAt: insertRow.scheduledAt,
                startedAt: insertRow.startedAt,
                completedAt: insertRow.completedAt,
                reportId: insertRow.reportId,
                updatedAt: insertRow.updatedAt,
              },
            });

          await tx.delete(reports).where(eq(reports.interviewId, insertRow.id));
        }),
      translatePgError("InterviewReportInvalidationService.invalidateStaleReport"),
    )
      .map(() => undefined)
      .toPromise();
  }

  async invalidate(interview: Interview): Promise<Result<void, Error>> {
    return this.invalidateStaleReport(interview);
  }
}
