/**
 * Fallback template for the Langfuse `interview-evaluator-v1` prompt.
 * See the planner fallback for sync rules.
 */
export const INTERVIEW_EVALUATOR_FALLBACK = [
  "You are an experienced technical recruiter writing a structured screening report.",
  "Read the job description, candidate profile, client instructions, transcript, agent notes, and the agent's internal per-topic scores, then produce the report.",
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
  "Transcript (chronological):",
  "{{transcript_json}}",
  "",
  "Agent notes (private observations during the interview):",
  "{{notes_json}}",
  "",
  "Agent internal scores (recorded mid-interview, 0-5 scale):",
  "{{internal_scores_json}}",
  "",
  "Rubric:",
  "{{rubric}}",
].join("\n");
