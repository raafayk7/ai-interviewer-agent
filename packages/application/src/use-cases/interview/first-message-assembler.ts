import type { CandidateInfo, JobDescription } from "@repo/domain";

export interface FirstMessageInput {
  readonly candidateInfo: CandidateInfo;
  readonly jobDescription: JobDescription;
}

/**
 * Builds the agent's spoken opening line, delivered via the allow-listed
 * `overrides.agent.firstMessage` override (ADR-033). Assembled server-side from
 * the candidate's name and the role so the greeting is personalized before the
 * first word — the browser only forwards it verbatim. The opener stays warm and
 * hands off to the agent's planned first question (driven by the system prompt)
 * rather than asking a specific question here.
 */
export const assembleInterviewFirstMessage = (
  input: FirstMessageInput,
): string => {
  const { candidateInfo, jobDescription } = input;
  const firstName = toFirstName(candidateInfo.fullName);
  const greeting = firstName ? `Hi ${firstName}` : "Hi there";
  return (
    `${greeting}, thanks for joining, and welcome. ` +
    `I'm Sift, your AI interviewer, and I'll be running a short voice screen for the ` +
    `${jobDescription.title} role at ${jobDescription.company}. ` +
    `This is a relaxed conversation about your background and experience — ` +
    `there are no trick questions. Whenever you're ready, let's get started.`
  );
};

// Candidate names often arrive upper-cased from CV parsing; present a single,
// title-cased first name so the spoken (and transcribed) greeting reads
// naturally instead of shouting the candidate's name.
function toFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (first.length === 0) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
