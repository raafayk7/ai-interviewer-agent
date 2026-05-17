import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";

export const CandidateInterviewViewSchema = z.object({
  interviewId: z.string().uuid(),
  candidateName: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  scheduledAt: z.coerce.date(),
  targetDurationMinutes: z.number().int().positive().nullable(),
  status: InterviewStatusSchema,
});
export type CandidateInterviewView = z.infer<typeof CandidateInterviewViewSchema>;
