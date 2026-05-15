import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";

export const CandidateLinkSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type CandidateLink = z.infer<typeof CandidateLinkSchema>;

export const GeneratePlanResponseSchema = z.object({
  interviewId: z.string().uuid(),
  status: InterviewStatusSchema,
  topicCount: z.number().int().nonnegative(),
  targetDurationMinutes: z.number().int().positive(),
  maxDurationMinutes: z.number().int().positive(),
  candidateLink: CandidateLinkSchema,
});
export type GeneratePlanResponse = z.infer<typeof GeneratePlanResponseSchema>;

export const IssueCandidateLinkResponseSchema = CandidateLinkSchema;
export type IssueCandidateLinkResponse = z.infer<typeof IssueCandidateLinkResponseSchema>;
