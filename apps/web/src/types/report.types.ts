import { z } from "zod";
import { RecommendationSchema } from "./recommendation.types";

export const TopicScoreSchema = z.object({
  topicName: z.string(),
  score: z.number().min(0).max(5),
  justification: z.string(),
});
export type TopicScore = z.infer<typeof TopicScoreSchema>;

export const ReportSchema = z.object({
  id: z.string().uuid(),
  interviewId: z.string().uuid(),
  overallRecommendation: RecommendationSchema,
  topicScores: z.array(TopicScoreSchema),
  communicationAssessment: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
  generatedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Report = z.infer<typeof ReportSchema>;

export const GetReportResponseSchema = z.object({ report: ReportSchema });
export type GetReportResponse = z.infer<typeof GetReportResponseSchema>;

export const EvaluateInterviewResponseSchema = z.object({ report: ReportSchema });
export type EvaluateInterviewResponse = z.infer<typeof EvaluateInterviewResponseSchema>;

export const HttpErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          message: z.string(),
        }),
      )
      .optional(),
  }),
});
