import type { Result } from "@/lib/result";
import type { ServiceError } from "./errors";
import { request } from "./_request";
import {
  ListInterviewsResponseSchema,
  GetInterviewResponseSchema,
  CreateInterviewResponseSchema,
  GeneratePlanResponseSchema,
  IssueCandidateLinkResponseSchema,
  GetReportResponseSchema,
  EvaluateInterviewResponseSchema,
  type ListInterviewsResponse,
  type Interview,
  type CreateInterviewResponse,
  type GeneratePlanResponse,
  type IssueCandidateLinkResponse,
  type Report,
} from "@/types";

const RECRUITER_OPTS = { credentials: "include" as RequestCredentials };

export function listInterviews(): Promise<Result<ListInterviewsResponse, ServiceError>> {
  return request("/interviews", { method: "GET" }, ListInterviewsResponseSchema, RECRUITER_OPTS);
}

export function getInterview(id: string): Promise<Result<{ interview: Interview }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(id)}`,
    { method: "GET" },
    GetInterviewResponseSchema,
    RECRUITER_OPTS,
  );
}

export function createInterview(input: {
  jobDescription: unknown;
  candidateInfo: unknown;
  clientInstructions: string;
  scheduledAt: string;
  jdFileRef: unknown;
  cvFileRef: unknown;
}): Promise<Result<CreateInterviewResponse, ServiceError>> {
  return request(
    "/interviews",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    CreateInterviewResponseSchema,
    RECRUITER_OPTS,
  );
}

export function generatePlan(
  interviewId: string,
  body?: { targetDurationMinutes?: number; maxDurationMinutes?: number },
): Promise<Result<GeneratePlanResponse, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    GeneratePlanResponseSchema,
    RECRUITER_OPTS,
  );
}

export function issueCandidateLink(
  interviewId: string,
): Promise<Result<IssueCandidateLinkResponse, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/candidate-link`,
    { method: "POST" },
    IssueCandidateLinkResponseSchema,
    RECRUITER_OPTS,
  );
}

export function evaluateInterview(
  interviewId: string,
): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/evaluate`,
    { method: "POST" },
    EvaluateInterviewResponseSchema,
    RECRUITER_OPTS,
  );
}

export function getReport(
  interviewId: string,
): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/report`,
    { method: "GET" },
    GetReportResponseSchema,
    RECRUITER_OPTS,
  );
}
