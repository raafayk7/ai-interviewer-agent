import { Option, Result } from "@carbonteq/fp";
import { and, eq, lt } from "drizzle-orm";
import {
  Interview,
  type IInterviewRepository,
  type InterviewId,
  type InterviewSerialized,
  type RecruiterId,
} from "@repo/domain";
import type { Database } from "../persistence/db.js";
import {
  interviews,
  type InterviewInsertRow,
  type InterviewRow,
} from "../persistence/schema/interviews.js";
import type { RepositoryError } from "./errors/repository-error.js";
import { translatePgError } from "./errors/translate-pg-error.js";

type TranscriptEntrySerialized = InterviewSerialized["transcript"][number];
type AgentNoteSerialized = InterviewSerialized["notes"][number];
type AgentInternalScoreSerialized = InterviewSerialized["internalScores"][number];
type FileRefSerialized = InterviewSerialized["jdFileRef"];

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

const reviveTranscriptEntry = (entry: TranscriptEntrySerialized): TranscriptEntrySerialized => ({
  ...entry,
  timestamp: asDate(entry.timestamp),
});

const reviveAgentNote = (note: AgentNoteSerialized): AgentNoteSerialized => ({
  ...note,
  recordedAt: asDate(note.recordedAt),
});

const reviveAgentInternalScore = (
  score: AgentInternalScoreSerialized,
): AgentInternalScoreSerialized => ({
  ...score,
  recordedAt: asDate(score.recordedAt),
});

const reviveFileRef = (fileRef: FileRefSerialized): FileRefSerialized => ({
  ...fileRef,
  uploadedAt: asDate(fileRef.uploadedAt),
});

const rowToSerialized = (row: InterviewRow): InterviewSerialized => ({
  id: row.id,
  recruiterId: row.recruiterId,
  status: row.status,
  jobDescription: row.jobDescription,
  candidateInfo: row.candidateInfo,
  clientInstructions: row.clientInstructions,
  interviewPlan: row.interviewPlan,
  transcript: row.transcript.map(reviveTranscriptEntry),
  notes: row.notes.map(reviveAgentNote),
  internalScores: row.internalScores.map(reviveAgentInternalScore),
  elevenLabsSessionId: row.elevenLabsSessionId,
  jdFileRef: reviveFileRef(row.jdFileRef),
  cvFileRef: reviveFileRef(row.cvFileRef),
  scheduledAt: row.scheduledAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  reportId: row.reportId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

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

export class DrizzleInterviewRepository implements IInterviewRepository {
  constructor(private readonly db: Database) {}

  async save(interview: Interview): Promise<Result<Interview, Error>> {
    const serialized = interview.serialize();
    const insertRow = serializedToInsertRow(serialized);

    return Result.tryAsyncCatch(
      () =>
        this.db
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
          })
          .returning(),
      translatePgError("InterviewRepository.save"),
    )
      .map((rows) => Interview.fromSerialized(rowToSerialized(rows[0]!)))
      .toPromise();
  }

  async findById(id: InterviewId): Promise<Result<Option<Interview>, Error>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(interviews).where(eq(interviews.id, id)).limit(1),
      translatePgError("InterviewRepository.findById"),
    )
      .map((rows) =>
        rows.length === 0
          ? Option.None
          : Option.Some(Interview.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }

  async listByRecruiter(recruiterId: RecruiterId): Promise<Result<ReadonlyArray<Interview>, Error>> {
    return Result.tryAsyncCatch(
      () => this.db.select().from(interviews).where(eq(interviews.recruiterId, recruiterId)),
      translatePgError("InterviewRepository.listByRecruiter"),
    )
      .map((rows) => rows.map((row) => Interview.fromSerialized(rowToSerialized(row))))
      .toPromise();
  }

  async findByElevenLabsSessionId(
    elevenLabsSessionId: string,
  ): Promise<Result<Option<Interview>, RepositoryError>> {
    return Result.tryAsyncCatch(
      () =>
        this.db
          .select()
          .from(interviews)
          .where(eq(interviews.elevenLabsSessionId, elevenLabsSessionId))
          .limit(1),
      translatePgError("InterviewRepository.findByElevenLabsSessionId"),
    )
      .map((rows) =>
        rows.length === 0
          ? Option.None
          : Option.Some(Interview.fromSerialized(rowToSerialized(rows[0]!))),
      )
      .toPromise();
  }

  async findStuckInProgress(cutoff: Date): Promise<Result<ReadonlyArray<Interview>, Error>> {
    return Result.tryAsyncCatch(
      () =>
        this.db
          .select()
          .from(interviews)
          .where(and(eq(interviews.status, "IN_PROGRESS"), lt(interviews.startedAt, cutoff))),
      translatePgError("InterviewRepository.findStuckInProgress"),
    )
      .map((rows) => rows.map((row) => Interview.fromSerialized(rowToSerialized(row))))
      .toPromise();
  }

  async delete(id: InterviewId): Promise<Result<void, Error>> {
    return Result.tryAsyncCatch(
      () => this.db.delete(interviews).where(eq(interviews.id, id)),
      translatePgError("InterviewRepository.delete"),
    )
      .map(() => undefined)
      .toPromise();
  }
}
