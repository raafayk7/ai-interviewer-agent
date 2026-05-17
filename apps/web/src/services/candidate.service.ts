import type { Result } from "@/lib/result";
import type { ServiceError } from "./errors";
import { request } from "./_request";
import { CandidateInterviewViewSchema, type CandidateInterviewView } from "@/types";

const CANDIDATE_OPTS = {
  // No `credentials: "include"` — token in URL is the only credential.
  authStatuses: [401] as const,
};

export function getCandidateInterviewView(input: {
  interviewId: string;
  token: string;
}): Promise<Result<CandidateInterviewView, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(input.interviewId)}/candidate-view?token=${encodeURIComponent(input.token)}`,
    { method: "GET" },
    CandidateInterviewViewSchema,
    CANDIDATE_OPTS,
  );
}
