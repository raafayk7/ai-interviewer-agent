/**
 * Fallback template for the Langfuse `interview-planner-v1` prompt.
 *
 * Mirrors the body of the prompt hosted in Langfuse. When the Langfuse SDK
 * cannot reach the API, the client falls back to this string and uses the same
 * `{{var}}` substitution shape as hosted Langfuse text prompts.
 *
 * Keep this in sync with the hosted prompt body. When updating the hosted
 * version, also update this file and ship them in the same PR to avoid drift.
 */
export const INTERVIEW_PLANNER_FALLBACK = [
  "You are designing the plan for a short technical screening interview.",
  "Target duration: {{target_duration_minutes}} minutes. Maximum duration: {{max_duration_minutes}} minutes.",
  "",
  "Job description:",
  "{{job_description_json}}",
  "",
  "Candidate profile:",
  "{{candidate_profile_json}}",
  "",
  "Client instructions:",
  "{{client_instructions}}",
  "",
  "Produce 3-6 topics. Each topic should include 2-5 questions and a time allocation.",
  "The total time allocation should fit inside the target duration where possible.",
  "Use priority 'must_cover' for high-signal topics and 'if_time_permits' for optional topics.",
  "Put role-critical questions in mustAskQuestions.",
].join("\n");
