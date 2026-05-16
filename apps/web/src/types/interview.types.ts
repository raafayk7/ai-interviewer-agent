import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";
import { JobDescriptionSchema, CandidateInfoSchema } from "./document.types";
import { InterviewPlanSchema } from "./interview-plan.types";
import { FileRefSchema } from "./file-ref.types";

const TranscriptEntrySchema = z.object({
  speaker: z.enum(["candidate", "agent"]),
  text: z.string(),
  timestamp: z.coerce.date(),
});

const AgentNoteSchema = z.object({
  text: z.string(),
  createdAt: z.coerce.date(),
});

const AgentInternalScoreSchema = z.object({
  topicName: z.string(),
  score: z.number(),
  rationale: z.string(),
  recordedAt: z.coerce.date(),
});

export const InterviewSchema = z.object({
  id: z.string().uuid(),
  recruiterId: z.string(),
  status: InterviewStatusSchema,
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
  clientInstructions: z.string(),
  interviewPlan: InterviewPlanSchema.nullable(),
  transcript: z.array(TranscriptEntrySchema),
  notes: z.array(AgentNoteSchema),
  internalScores: z.array(AgentInternalScoreSchema),
  jdFileRef: FileRefSchema,
  cvFileRef: FileRefSchema,
  scheduledAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  reportId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Interview = z.infer<typeof InterviewSchema>;

export const ListInterviewsResponseSchema = z.object({
  interviews: z.array(InterviewSchema),
});
export type ListInterviewsResponse = z.infer<typeof ListInterviewsResponseSchema>;

export const GetInterviewResponseSchema = z.object({
  interview: InterviewSchema,
});

export const CreateInterviewResponseSchema = z.object({
  interviewId: z.string().uuid(),
  status: InterviewStatusSchema,
  scheduledAt: z.coerce.date(),
});
export type CreateInterviewResponse = z.infer<typeof CreateInterviewResponseSchema>;
