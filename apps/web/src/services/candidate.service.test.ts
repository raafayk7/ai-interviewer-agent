import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it,
// since env.ts throws synchronously if NEXT_PUBLIC_API_URL is missing.
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "http://localhost:8080",
    NEXT_PUBLIC_WS_URL: "ws://localhost:8080",
  },
}));

import { getCandidateInterviewView } from "./candidate.service";

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

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test-token-abc123";

const baseCandidateView = {
  interviewId: INTERVIEW_ID,
  candidateName: "Jane Doe",
  jobTitle: "Senior Frontend Engineer",
  company: "Acme Corp",
  scheduledAt: "2026-06-01T10:00:00.000Z",
  targetDurationMinutes: 30,
  status: "SCHEDULED",
};

const httpErrorBody = {
  error: { code: "SOME_ERROR", message: "Something failed" },
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
// getCandidateInterviewView
// ---------------------------------------------------------------------------

describe("candidate.service — getCandidateInterviewView", () => {
  it("returns Ok with parsed CandidateInterviewView on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateView));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectOk(result);
    expect(result.value.interviewId).toBe(INTERVIEW_ID);
    expect(result.value.candidateName).toBe("Jane Doe");
    expect(result.value.status).toBe("SCHEDULED");
  });

  it("sends a GET request with the interview ID and token in the URL", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateView));

    await getCandidateInterviewView({ interviewId: INTERVIEW_ID, token: TOKEN });

    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain(`/interviews/${INTERVIEW_ID}/candidate-view`);
    expect(calledUrl).toContain(`token=${TOKEN}`);

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("does NOT include credentials: include in the request (token-only auth)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateView));

    await getCandidateInterviewView({ interviewId: INTERVIEW_ID, token: TOKEN });

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBeUndefined();
  });

  it("returns Err with kind AUTH on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
    if (result.error.kind !== "AUTH") throw new Error("Wrong kind");
    expect(result.error.status).toBe(401);
  });

  it("returns Err with kind NOT_FOUND on 404", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 404));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("NOT_FOUND");
  });

  it("returns Err with kind SERVER on 500", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 500));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
    if (result.error.kind !== "SERVER") throw new Error("Wrong kind");
    expect(result.error.status).toBe(500);
  });

  it("plumbs the error code through on 500 with structured error body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Server exploded" } }, 500),
    );

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
    if (result.error.kind !== "SERVER") throw new Error("Wrong kind");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.message).toBe("Server exploded");
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network down"));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with missing required field", async () => {
    // Omit candidateName to fail Zod validation
    const malformed = {
      interviewId: INTERVIEW_ID,
      jobTitle: "Engineer",
      company: "Acme",
      scheduledAt: "2026-06-01T10:00:00.000Z",
      targetDurationMinutes: 30,
      status: "SCHEDULED",
      // candidateName is intentionally missing
    };

    vi.mocked(fetch).mockResolvedValue(jsonResponse(malformed));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });

  it("returns Err with kind SERVER (not AUTH) on 403 — candidate authStatuses is [401] only", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(403));

    const result = await getCandidateInterviewView({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });

    expectErr(result);
    // 403 is NOT in candidate's authStatuses ([401]) so it falls through to SERVER
    expect(result.error.kind).toBe("SERVER");
  });

  it("encodes a UUID interviewId in the URL correctly", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateView));

    await getCandidateInterviewView({ interviewId: INTERVIEW_ID, token: TOKEN });

    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain(INTERVIEW_ID);
  });
});
