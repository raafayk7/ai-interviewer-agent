import { env } from "@/lib/env";
import type { CandidateErrorKind } from "@/components/CandidateErrorScreen";
import {
  CandidateInterviewViewSchema,
  type CandidateInterviewView,
} from "@/types";

export type CandidateViewLoad =
  | { kind: "ok"; view: CandidateInterviewView }
  | { kind: "invalid-link" }
  | { kind: "interview-not-found" }
  | { kind: "network"; message: string };

// 401 and 404 collapse to "invalid-link" so we never enumerate which
// candidate links exist (mirrors backend ADR-019: 404 over 403/409).
export function viewLoadToErrorKind(
  load: Exclude<CandidateViewLoad, { kind: "ok" }>,
): CandidateErrorKind {
  return load.kind === "network" ? "network" : "invalid-link";
}

// Documented carve-out from the "fetch only in services/" rule (mirrors
// lib/auth.ts:18-25): this helper is server-only — Server Components in
// app/(candidate)/* import it; client code never does. Server Components
// cannot import `"use client"` service files, so we duplicate the minimal
// fetch shape here.
export async function loadCandidateView(
  interviewId: string,
  token: string | undefined,
): Promise<CandidateViewLoad> {
  if (!token) return { kind: "invalid-link" };
  let res: Response;
  try {
    res = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/interviews/${encodeURIComponent(interviewId)}/candidate-view?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
  } catch (e) {
    return { kind: "network", message: e instanceof Error ? e.message : "fetch failed" };
  }
  if (res.status === 401) return { kind: "invalid-link" };
  if (res.status === 404) return { kind: "interview-not-found" };
  if (!res.ok) return { kind: "network", message: `HTTP ${res.status}` };
  const body: unknown = await res.json().catch(() => null);
  const parsed = CandidateInterviewViewSchema.safeParse(body);
  if (!parsed.success) return { kind: "network", message: "invalid response shape" };
  return { kind: "ok", view: parsed.data };
}
