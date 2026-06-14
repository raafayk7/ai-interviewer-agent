import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@/services/interview.service", () => ({
  getInterview: vi.fn(),
  getReport: vi.fn(),
  issueCandidateLink: vi.fn(),
  evaluateInterview: vi.fn(),
}));

import {
  getInterview,
  getReport,
  issueCandidateLink,
  evaluateInterview,
} from "@/services/interview.service";
import { Ok, Err } from "@/lib/result";
import { useInterviewDetail } from "./useInterviewDetail";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";

const baseFileRef = {
  key: "uploads/file.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "file.pdf",
  uploadedAt: new Date("2026-05-01"),
};

function makeInterview(status: "CREATED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "EVALUATED" | "CANCELLED" = "SCHEDULED") {
  return {
    id: INTERVIEW_ID,
    recruiterId: "22222222-2222-4222-8222-222222222222",
    status,
    jobDescription: {
      title: "FE Dev",
      company: "Acme",
      responsibilities: [],
      requirements: [],
      rawText: "",
    },
    candidateInfo: {
      fullName: "Jane Doe",
      email: "jane@example.com",
      headline: "FE Dev",
      yearsOfExperience: 5,
      skills: [],
      education: [],
      rawText: "",
    },
    clientInstructions: "",
    interviewPlan: null,
    transcript: [],
    notes: [],
    internalScores: [],
    jdFileRef: baseFileRef,
    cvFileRef: baseFileRef,
    scheduledAt: new Date("2026-06-01"),
    startedAt: null,
    completedAt: null,
    reportId: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
  };
}

const baseReport = {
  id: "33333333-3333-4333-8333-333333333333",
  interviewId: INTERVIEW_ID,
  overallRecommendation: "advance" as const,
  topicScores: [],
  communicationAssessment: "Good.",
  strengths: [],
  concerns: [],
  followUpQuestions: [],
  generatedAt: new Date("2026-05-15"),
  createdAt: new Date("2026-05-15"),
  updatedAt: new Date("2026-05-15"),
};

const baseCandidateLink = {
  url: "https://app.sift.ai/interview/tok123",
  token: "tok123",
  expiresInSeconds: 604800,
};

// ---------------------------------------------------------------------------
// Wrapper factory — fresh QueryClient per test
// ---------------------------------------------------------------------------

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getInterview).mockReset();
  vi.mocked(getReport).mockReset();
  vi.mocked(issueCandidateLink).mockReset();
  vi.mocked(evaluateInterview).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useInterviewDetail — loading state
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — loading state", () => {
  it("starts with interviewQuery in loading state", () => {
    vi.mocked(getInterview).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    expect(result.current.interviewQuery.isLoading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useInterviewDetail — happy path
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — happy path", () => {
  it("loads the interview data from the service", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("SCHEDULED") }),
    );
    vi.mocked(issueCandidateLink).mockResolvedValue(Ok(baseCandidateLink));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(result.current.interviewQuery.data?.interview.id).toBe(INTERVIEW_ID);
  });

  it("exposes the interview status via the status field", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("SCHEDULED") }),
    );
    vi.mocked(issueCandidateLink).mockResolvedValue(Ok(baseCandidateLink));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("SCHEDULED");
    });
  });
});

// ---------------------------------------------------------------------------
// useInterviewDetail — candidateLinkQuery enabled for SCHEDULED status
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — candidateLinkQuery enabled", () => {
  it("fetches the candidate link when status is SCHEDULED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("SCHEDULED") }),
    );
    vi.mocked(issueCandidateLink).mockResolvedValue(Ok(baseCandidateLink));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.candidateLinkQuery.isSuccess).toBe(true);
    });
    expect(issueCandidateLink).toHaveBeenCalledWith(INTERVIEW_ID);
  });

  it("fetches the candidate link when status is IN_PROGRESS", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("IN_PROGRESS") }),
    );
    vi.mocked(issueCandidateLink).mockResolvedValue(Ok(baseCandidateLink));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.candidateLinkQuery.isSuccess).toBe(true);
    });
    expect(issueCandidateLink).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useInterviewDetail — candidateLinkQuery disabled for non-shareable statuses
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — candidateLinkQuery disabled", () => {
  it("does not fetch the candidate link when status is CREATED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("CREATED") }),
    );

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(issueCandidateLink).not.toHaveBeenCalled();
    expect(result.current.candidateLinkQuery.fetchStatus).toBe("idle");
  });

  it("does not fetch the candidate link when status is COMPLETED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("COMPLETED") }),
    );

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(issueCandidateLink).not.toHaveBeenCalled();
  });

  it("does not fetch the candidate link when status is EVALUATED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("EVALUATED") }),
    );
    vi.mocked(getReport).mockResolvedValue(Ok({ report: baseReport }));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(issueCandidateLink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useInterviewDetail — reportQuery enabled for EVALUATED status
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — reportQuery", () => {
  it("fetches the report when status is EVALUATED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("EVALUATED") }),
    );
    vi.mocked(getReport).mockResolvedValue(Ok({ report: baseReport }));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.reportQuery.isSuccess).toBe(true);
    });
    expect(getReport).toHaveBeenCalledWith(INTERVIEW_ID);
  });

  it("does not fetch the report when status is SCHEDULED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("SCHEDULED") }),
    );
    vi.mocked(issueCandidateLink).mockResolvedValue(Ok(baseCandidateLink));

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(getReport).not.toHaveBeenCalled();
    expect(result.current.reportQuery.fetchStatus).toBe("idle");
  });

  it("does not fetch the report when status is COMPLETED", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Ok({ interview: makeInterview("COMPLETED") }),
    );

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isSuccess).toBe(true);
    });
    expect(getReport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useInterviewDetail — interviewQuery error
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewDetail — interviewQuery error", () => {
  it("sets interviewQuery to error state when service returns Err", async () => {
    vi.mocked(getInterview).mockResolvedValue(
      Err({ kind: "NOT_FOUND" as const, message: "Interview not found" }),
    );

    const { result } = renderHook(
      () => useInterviewDetail(INTERVIEW_ID),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.interviewQuery.isError).toBe(true);
    });
  });
});
