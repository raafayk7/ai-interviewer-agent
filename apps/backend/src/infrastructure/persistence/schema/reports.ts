import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Recommendation, TopicScoreProps } from "@repo/domain";
import { interviews } from "./interviews.js";

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  overallRecommendation: text("overall_recommendation").$type<Recommendation>().notNull(),
  topicScores: jsonb("topic_scores")
    .$type<ReadonlyArray<TopicScoreProps>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  communicationAssessment: text("communication_assessment").notNull(),
  strengths: jsonb("strengths").$type<ReadonlyArray<string>>().notNull().default(sql`'[]'::jsonb`),
  concerns: jsonb("concerns").$type<ReadonlyArray<string>>().notNull().default(sql`'[]'::jsonb`),
  followUpQuestions: jsonb("follow_up_questions")
    .$type<ReadonlyArray<string>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export type ReportRow = typeof reports.$inferSelect;
export type ReportInsertRow = typeof reports.$inferInsert;
