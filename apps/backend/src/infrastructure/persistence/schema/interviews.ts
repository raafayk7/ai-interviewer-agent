import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  AgentInternalScoreProps,
  AgentNoteProps,
  CandidateInfoProps,
  FileRefProps,
  InterviewPlanSerialized,
  InterviewStatus,
  JobDescriptionProps,
  TranscriptEntryProps,
} from "@repo/domain";

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey(),
  recruiterId: text("recruiter_id").notNull(),
  status: text("status").$type<InterviewStatus>().notNull(),
  jobDescription: jsonb("job_description").$type<JobDescriptionProps>().notNull(),
  candidateInfo: jsonb("candidate_info").$type<CandidateInfoProps>().notNull(),
  clientInstructions: text("client_instructions").notNull(),
  interviewPlan: jsonb("interview_plan").$type<InterviewPlanSerialized | null>(),
  transcript: jsonb("transcript")
    .$type<ReadonlyArray<TranscriptEntryProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  notes: jsonb("notes")
    .$type<ReadonlyArray<AgentNoteProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  internalScores: jsonb("internal_scores")
    .$type<ReadonlyArray<AgentInternalScoreProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  jdFileRef: jsonb("jd_file_ref").$type<FileRefProps>().notNull(),
  cvFileRef: jsonb("cv_file_ref").$type<FileRefProps>().notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  reportId: uuid("report_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type InterviewRow = typeof interviews.$inferSelect;
export type InterviewInsertRow = typeof interviews.$inferInsert;
