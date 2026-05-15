import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import type { ServiceError } from "./errors";
import {
  ListInterviewsResponseSchema,
  GetInterviewResponseSchema,
  CreateInterviewResponseSchema,
  GeneratePlanResponseSchema,
  IssueCandidateLinkResponseSchema,
  GetReportResponseSchema,
  EvaluateInterviewResponseSchema,
  HttpErrorBodySchema,
  type ListInterviewsResponse,
  type Interview,
  type CreateInterviewResponse,
  type GeneratePlanResponse,
  type IssueCandidateLinkResponse,
  type Report,
} from "@/types";
import type { z } from "zod";

const BASE = env.NEXT_PUBLIC_API_URL;

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<Result<T, ServiceError>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }

  if (res.status === 401 || res.status === 403) {
    return Err({ kind: "AUTH", status: res.status as 401 | 403, message: "Unauthorized" });
  }
  if (res.status === 404) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "NOT_FOUND",
      message: parsed.success ? parsed.data.error.message : "Not found",
    });
  }
  if (!res.ok) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : "Server error",
    });
  }

  const body = await safeJson(res);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Err({
      kind: "RESPONSE_VALIDATION",
      message: "Response shape invalid",
      issues: parsed.error.issues,
    });
  }
  return Ok(parsed.data);
}

export function listInterviews(): Promise<Result<ListInterviewsResponse, ServiceError>> {
  return request("/interviews", { method: "GET" }, ListInterviewsResponseSchema);
}

export function getInterview(id: string): Promise<Result<{ interview: Interview }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(id)}`,
    { method: "GET" },
    GetInterviewResponseSchema,
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
  );
}

export function issueCandidateLink(
  interviewId: string,
): Promise<Result<IssueCandidateLinkResponse, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/candidate-link`,
    { method: "POST" },
    IssueCandidateLinkResponseSchema,
  );
}

export function evaluateInterview(
  interviewId: string,
): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/evaluate`,
    { method: "POST" },
    EvaluateInterviewResponseSchema,
  );
}

export function getReport(
  interviewId: string,
): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/report`,
    { method: "GET" },
    GetReportResponseSchema,
  );
}
