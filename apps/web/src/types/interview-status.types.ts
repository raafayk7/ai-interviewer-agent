import { z } from "zod";

export const InterviewStatusSchema = z.enum([
  "CREATED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "CANCELLED",
]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const ALL_INTERVIEW_STATUSES = InterviewStatusSchema.options;
