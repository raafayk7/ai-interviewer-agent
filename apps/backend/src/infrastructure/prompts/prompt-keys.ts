export const PROMPT_KEYS = {
  INTERVIEW_PLANNER: "interview-planner-v1",
  INTERVIEW_EVALUATOR: "interview-evaluator-v1",
} as const;

export type PromptKey = (typeof PROMPT_KEYS)[keyof typeof PROMPT_KEYS];
