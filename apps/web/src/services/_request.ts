import type { z } from "zod";
import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import { HttpErrorBodySchema } from "@/types";
import type { ServiceError } from "./errors";

// Direct by default: frontend (app-dev) and backend (api-dev) are same-site
// under sift-ai.space, so the session cookie is first-party with SameSite=Lax and
// calls go straight to NEXT_PUBLIC_API_URL — avoiding the ~30s Vercel edge-rewrite
// timeout that 502s the slow gemini ops. When NEXT_PUBLIC_USE_BE_PROXY=true (e.g.
// self-hosted Docker, or a cross-site host where third-party cookies are blocked),
// client calls route through the same-origin `/be` proxy (next.config rewrite).
// The server always calls directly — no cookie-origin problem there.
const USE_PROXY = env.NEXT_PUBLIC_USE_BE_PROXY === "true";
const BASE =
  typeof window === "undefined" || !USE_PROXY
    ? env.NEXT_PUBLIC_API_URL
    : `${window.location.origin}/be`;

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
