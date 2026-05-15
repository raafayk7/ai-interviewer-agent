import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it,
// since env.ts throws synchronously if NEXT_PUBLIC_API_URL is missing.
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

import { uploadDocuments, extractDocuments } from "./document.service";

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function expectOk<T, E>(
  result: { ok: true; value: T } | { ok: false; error: E },
): asserts result is { ok: true; value: T } {
  expect(result.ok).toBe(true);
}

function expectErr<T, E>(
  result: { ok: true; value: T } | { ok: false; error: E },
): asserts result is { ok: false; error: E } {
  expect(result.ok).toBe(false);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFileRef = {
  key: "uploads/file.pdf",
  contentType: "application/pdf",
  sizeBytes: 20480,
  originalFilename: "file.pdf",
  uploadedAt: "2026-05-01T00:00:00.000Z",
};

const uploadResponse = {
  jdRef: baseFileRef,
  cvRef: { ...baseFileRef, key: "uploads/cv.pdf", originalFilename: "cv.pdf" },
};

const extractResponse = {
  jobDescription: {
    title: "Senior FE Engineer",
    company: "Acme",
    responsibilities: ["Build UI"],
    requirements: ["React"],
    rawText: "raw jd text",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "Frontend Dev",
    yearsOfExperience: 5,
    skills: ["React"],
    education: ["B.Sc. CS"],
    rawText: "raw cv text",
  },
};

const httpErrorBody = {
  error: { code: "UPLOAD_FAILED", message: "Upload failed" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response("", { status });
}

function makeFile(name = "file.pdf"): File {
  return new File(["content"], name, { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// uploadDocuments
// ---------------------------------------------------------------------------

describe("uploadDocuments", () => {
  it("returns Ok with file refs on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(uploadResponse));

    const result = await uploadDocuments(makeFile("jd.pdf"), makeFile("cv.pdf"));
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.jdRef.key).toBe("uploads/file.pdf");
    expect(result.value.cvRef.key).toBe("uploads/cv.pdf");
  });

  it("sends a POST request to the documents/upload endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(uploadResponse));

    await uploadDocuments(makeFile(), makeFile());
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/documents/upload");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("sends FormData as the request body (no JSON content-type header)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(uploadResponse));

    await uploadDocuments(makeFile("jd.pdf"), makeFile("cv.pdf"));
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    // Must NOT set content-type manually — browser must set it with boundary
    const headers = init.headers as Record<string, string> | undefined;
    expect(headers?.["content-type"]).toBeUndefined();
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const result = await uploadDocuments(makeFile(), makeFile());
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind AUTH on 401 response", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await uploadDocuments(makeFile(), makeFile());
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
    if (result.error.kind !== "AUTH") throw new Error("Wrong kind");
    expect(result.error.status).toBe(401);
  });

  it("returns Err with kind AUTH on 403 response", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(403));

    const result = await uploadDocuments(makeFile(), makeFile());
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
    if (result.error.kind !== "AUTH") throw new Error("Wrong kind");
    expect(result.error.status).toBe(403);
  });

  it("returns Err with kind SERVER on 500 response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 500));

    const result = await uploadDocuments(makeFile(), makeFile());
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
    if (result.error.kind !== "SERVER") throw new Error("Wrong kind");
    expect(result.error.status).toBe(500);
    expect(result.error.code).toBe("UPLOAD_FAILED");
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ totally: "wrong" }));

    const result = await uploadDocuments(makeFile(), makeFile());
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });
});

// ---------------------------------------------------------------------------
// extractDocuments
// ---------------------------------------------------------------------------

const jdRef = { key: "uploads/jd.pdf", contentType: "application/pdf" };
const cvRef = { key: "uploads/cv.pdf", contentType: "application/pdf" };

describe("extractDocuments", () => {
  it("returns Ok with parsed extraction on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(extractResponse));

    const result = await extractDocuments(jdRef, cvRef);
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.jobDescription.title).toBe("Senior FE Engineer");
    expect(result.value.candidateInfo.fullName).toBe("Jane Doe");
  });

  it("sends a POST request to the documents/extract endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(extractResponse));

    await extractDocuments(jdRef, cvRef);
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/documents/extract");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("sends JSON with content-type header", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(extractResponse));

    await extractDocuments(jdRef, cvRef);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const result = await extractDocuments(jdRef, cvRef);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind AUTH on 401 response", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await extractDocuments(jdRef, cvRef);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
  });

  it("returns Err with kind SERVER on 500 response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "EXTRACT_FAILED", message: "Extraction failed" } }, 500),
    );

    const result = await extractDocuments(jdRef, cvRef);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ bad: "data" }));

    const result = await extractDocuments(jdRef, cvRef);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });
});
