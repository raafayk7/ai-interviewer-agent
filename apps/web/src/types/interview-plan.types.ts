import { z } from "zod";

export const TopicPrioritySchema = z.enum(["must_cover", "if_time_permits"]);
export type TopicPriority = z.infer<typeof TopicPrioritySchema>;

export const PlannedTopicSchema = z.object({
  name: z.string(),
  questions: z.array(z.string()),
  timeAllocationMinutes: z.number().positive(),
  priority: TopicPrioritySchema,
});
export type PlannedTopic = z.infer<typeof PlannedTopicSchema>;

export const InterviewPlanSchema = z.object({
  topics: z.array(PlannedTopicSchema),
  targetDurationMinutes: z.number().int().positive(),
  maxDurationMinutes: z.number().int().positive(),
  mustAskQuestions: z.array(z.string()),
});
export type InterviewPlanT = z.infer<typeof InterviewPlanSchema>;
