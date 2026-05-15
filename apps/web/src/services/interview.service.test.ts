import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it,
// since env.ts throws synchronously if NEXT_PUBLIC_API_URL is missing.
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

import {
  listInterviews,
  getInterview,
  createInterview,
  issueCandidateLink,
  getReport,
} from "./interview.service";

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
// Shared fixtures
// ---------------------------------------------------------------------------

const baseFileRef = {
  key: "uploads/jd.pdf",
  contentType: "application/pdf",
  sizeBytes: 51200,
  originalFilename: "jd.pdf",
  uploadedAt: "2026-05-01T00:00:00.000Z",
};

const baseInterview = {
  id: "11111111-1111-4111-8111-111111111111",
  recruiterId: "22222222-2222-4222-8222-222222222222",
  status: "SCHEDULED",
  jobDescription: {
    title: "Senior Frontend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build UIs"],
    requirements: ["React"],
    rawText: "...",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "FE Dev",
    yearsOfExperience: 5,
    skills: ["React"],
    education: ["B.Sc. CS"],
    rawText: "...",
  },
  clientInstructions: "Focus on React.",
  interviewPlan: null,
  transcript: [],
  notes: [],
  internalScores: [],
  jdFileRef: baseFileRef,
  cvFileRef: baseFileRef,
  scheduledAt: "2026-06-01T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  reportId: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const baseReport = {
  id: "33333333-3333-4333-8333-333333333333",
  interviewId: "11111111-1111-4111-8111-111111111111",
  overallRecommendation: "advance",
  topicScores: [{ topicName: "React", score: 4.5, justification: "Strong." }],
  communicationAssessment: "Clear and concise.",
  strengths: ["React expertise"],
  concerns: [],
  followUpQuestions: [],
  generatedAt: "2026-05-15T00:00:00.000Z",
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
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
// listInterviews
// ---------------------------------------------------------------------------

describe("listInterviews", () => {
  it("returns Ok with parsed interviews on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ interviews: [baseInterview] }),
    );

    const result = await listInterviews();
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.interviews).toHaveLength(1);
    expect(result.value.interviews[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns Ok with an empty interviews array when the list is empty", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ interviews: [] }));

    const result = await listInterviews();
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.interviews).toHaveLength(0);
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network down"));

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind AUTH on 401 response", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
    if (result.error.kind !== "AUTH") throw new Error("Wrong kind");
    expect(result.error.status).toBe(401);
  });

  it("returns Err with kind AUTH on 403 response", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(403));

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
    if (result.error.kind !== "AUTH") throw new Error("Wrong kind");
    expect(result.error.status).toBe(403);
  });

  it("returns Err with kind NOT_FOUND on 404 response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(httpErrorBody, 404),
    );

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NOT_FOUND");
  });

  it("returns Err with kind SERVER on 500 response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(httpErrorBody, 500),
    );

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
    if (result.error.kind !== "SERVER") throw new Error("Wrong kind");
    expect(result.error.status).toBe(500);
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ bogus: true }),
    );

    const result = await listInterviews();
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });
});

// ---------------------------------------------------------------------------
// getInterview
// ---------------------------------------------------------------------------

describe("getInterview", () => {
  it("returns Ok with parsed interview on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ interview: baseInterview }),
    );

    const result = await getInterview("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.interview.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("encodes the interview ID in the URL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ interview: baseInterview }),
    );

    await getInterview("11111111-1111-4111-8111-111111111111");
    const calledUrl = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(calledUrl).toContain("/interviews/11111111-1111-4111-8111-111111111111");
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const result = await getInterview("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind AUTH on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await getInterview("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
  });

  it("returns Err with kind NOT_FOUND on 404", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 404));

    const result = await getInterview("missing-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NOT_FOUND");
  });

  it("returns Err with kind SERVER on 500", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 500));

    const result = await getInterview("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ wrong: "shape" }));

    const result = await getInterview("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });
});

// ---------------------------------------------------------------------------
// createInterview
// ---------------------------------------------------------------------------

const baseCreateInput = {
  jobDescription: { title: "FE Dev", company: "Acme", responsibilities: [], requirements: [], rawText: "" },
  candidateInfo: { fullName: "Jane", email: "jane@a.com", headline: "Dev", yearsOfExperience: 3, skills: [], education: [], rawText: "" },
  clientInstructions: "Focus on React.",
  scheduledAt: "2026-06-01T10:00:00.000Z",
  jdFileRef: baseFileRef,
  cvFileRef: baseFileRef,
};

const baseCreateResponse = {
  interviewId: "11111111-1111-4111-8111-111111111111",
  status: "SCHEDULED",
  scheduledAt: "2026-06-01T10:00:00.000Z",
};

describe("createInterview", () => {
  it("returns Ok with interview ID on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCreateResponse));

    const result = await createInterview(baseCreateInput);
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.interviewId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("sends a POST request with JSON content-type", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCreateResponse));

    await createInterview(baseCreateInput);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const result = await createInterview(baseCreateInput);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });

  it("returns Err with kind AUTH on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await createInterview(baseCreateInput);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
  });

  it("returns Err with kind SERVER on 500", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 500));

    const result = await createInterview(baseCreateInput);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
  });

  it("returns Err with kind RESPONSE_VALIDATION on 200 with malformed body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ missing: "required fields" }));

    const result = await createInterview(baseCreateInput);
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("RESPONSE_VALIDATION");
  });
});

// ---------------------------------------------------------------------------
// issueCandidateLink
// ---------------------------------------------------------------------------

const baseCandidateLink = {
  url: "https://app.sift.ai/interview/tok123",
  token: "tok123",
  expiresInSeconds: 604800,
};

describe("issueCandidateLink", () => {
  it("returns Ok with candidate link on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateLink));

    const result = await issueCandidateLink("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.token).toBe("tok123");
  });

  it("sends a POST request to the candidate-link endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(baseCandidateLink));

    await issueCandidateLink("11111111-1111-4111-8111-111111111111");
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/candidate-link");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("returns Err with kind SERVER including code on 409 response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { error: { code: "INVALID_INTERVIEW_STATE_TRANSITION", message: "Bad state" } },
        409,
      ),
    );

    const result = await issueCandidateLink("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
    if (result.error.kind !== "SERVER") throw new Error("Wrong kind");
    expect(result.error.code).toBe("INVALID_INTERVIEW_STATE_TRANSITION");
  });

  it("returns Err with kind AUTH on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(401));

    const result = await issueCandidateLink("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("AUTH");
  });

  it("returns Err with kind NOT_FOUND on 404", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 404));

    const result = await issueCandidateLink("missing-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NOT_FOUND");
  });

  it("returns Err with kind NETWORK when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const result = await issueCandidateLink("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NETWORK");
  });
});

// ---------------------------------------------------------------------------
// getReport
// ---------------------------------------------------------------------------

describe("getReport", () => {
  it("returns Ok with parsed report on 200 + valid body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ report: baseReport }));

    const result = await getReport("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(true);
    expectOk(result);
    expect(result.value.report.id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("returns Err with kind NOT_FOUND on 404", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 404));

    const result = await getReport("missing-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("NOT_FOUND");
  });

  it("returns Err with kind SERVER on 500", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(httpErrorBody, 500));

    const result = await getReport("some-id");
    expect(result.ok).toBe(false);
    expectErr(result);
    expect(result.error.kind).toBe("SERVER");
  });
});
