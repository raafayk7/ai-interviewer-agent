import type { z } from "zod";
import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import { HttpErrorBodySchema } from "@/types";
import type { ServiceError } from "./errors";

const BASE = env.NEXT_PUBLIC_API_URL;

export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export interface RequestOptions {
  /** Whether the browser should send cookies. Recruiter routes set this; candidate routes do not. */
  credentials?: RequestCredentials;
  /** Which HTTP statuses map to `AUTH`. Recruiter passes [401, 403]; candidate passes [401]. */
  authStatuses?: ReadonlyArray<401 | 403>;
}

const DEFAULT_AUTH_STATUSES: ReadonlyArray<401 | 403> = [401, 403];

export async function request<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<Result<T, ServiceError>> {
  const authStatuses = options.authStatuses ?? DEFAULT_AUTH_STATUSES;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: options.credentials, ...init });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }

  if (authStatuses.includes(res.status as 401 | 403)) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "AUTH",
      status: res.status as 401 | 403,
      message: parsed.success ? parsed.data.error.message : "Unauthorized",
    });
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
