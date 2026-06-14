import type { Result } from "@/lib/result";
import type { ServiceError } from "./errors";
import { request } from "./_request";
import {
  CandidateInterviewViewSchema,
  type CandidateInterviewView,
  CandidateSessionSchema,
  type CandidateSession,
} from "@/types";

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

/**
 * POST /interviews/:id/candidate-session?token=… — issues a single-use signed
 * URL plus the server-built per-session ElevenLabs payload (ADR-033). The
 * endpoint performs the SCHEDULED→IN_PROGRESS transition server-side at
 * issuance; no request body is sent (the candidate token in the URL is the only
 * credential). The validated payload is forwarded verbatim to the ElevenLabs
 * SDK by the container hook.
 */
export function startCandidateSession(input: {
  interviewId: string;
  token: string;
}): Promise<Result<CandidateSession, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(input.interviewId)}/candidate-session?token=${encodeURIComponent(input.token)}`,
    { method: "POST" },
    CandidateSessionSchema,
    CANDIDATE_OPTS,
  );
}
