import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import type { ServiceError } from "./errors";
import {
  UploadDocumentsResponseSchema,
  ExtractDocumentsResponseSchema,
  HttpErrorBodySchema,
  type UploadDocumentsResponse,
  type ExtractDocumentsResponse,
  type FileRef,
} from "@/types";

// Client → same-origin `/be` proxy so the session cookie is sent first-party
// (both upload + extract are authenticated); server → backend directly. Mirrors
// _request.ts — every authenticated path must route through the proxy.
const BASE =
  typeof window === "undefined"
    ? env.NEXT_PUBLIC_API_URL
    : `${window.location.origin}/be`;

export async function uploadDocuments(
  jdFile: File,
  cvFile: File,
): Promise<Result<UploadDocumentsResponse, ServiceError>> {
  const fd = new FormData();
  fd.append("jdFile", jdFile);
  fd.append("cvFile", cvFile);
  // IMPORTANT: Do NOT set Content-Type header — browser must set it with boundary
  let res: Response;
  try {
    res = await fetch(`${BASE}/documents/upload`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }
  if (res.status === 401 || res.status === 403) {
    return Err({ kind: "AUTH", status: res.status as 401 | 403, message: "Unauthorized" });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : "Upload failed",
    });
  }
  const parsed = UploadDocumentsResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return Err({
      kind: "RESPONSE_VALIDATION",
      message: "Upload response invalid",
      issues: parsed.error.issues,
    });
  }
  return Ok(parsed.data);
}

export async function extractDocuments(
  jdFile: Pick<FileRef, "key" | "contentType">,
  cvFile: Pick<FileRef, "key" | "contentType">,
): Promise<Result<ExtractDocumentsResponse, ServiceError>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/documents/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jdFile, cvFile }),
      credentials: "include",
    });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }
  if (res.status === 401 || res.status === 403) {
    return Err({ kind: "AUTH", status: res.status as 401 | 403, message: "Unauthorized" });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : "Extraction failed",
    });
  }
  const parsed = ExtractDocumentsResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return Err({
      kind: "RESPONSE_VALIDATION",
      message: "Extraction response invalid",
      issues: parsed.error.issues,
    });
  }
  return Ok(parsed.data);
}
