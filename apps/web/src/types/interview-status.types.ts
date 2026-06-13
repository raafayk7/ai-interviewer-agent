import { z } from "zod";

export const InterviewStatusSchema = z.enum([
  "CREATED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "CANCELLED",
  "FAILED",
]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const ALL_INTERVIEW_STATUSES = InterviewStatusSchema.options;

const TERMINAL_STATUSES: ReadonlySet<InterviewStatus> = new Set([
  "COMPLETED",
  "EVALUATED",
  "FAILED",
]);

export function isTerminalStatus(status: InterviewStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
