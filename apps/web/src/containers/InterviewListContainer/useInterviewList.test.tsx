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
  listInterviews: vi.fn(),
}));

import { listInterviews } from "@/services/interview.service";
import { Ok, Err } from "@/lib/result";
import { useInterviewFilterStore } from "@/stores/useInterviewFilterStore";
import { useInterviewList } from "./useInterviewList";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFileRef = {
  key: "uploads/file.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "file.pdf",
  uploadedAt: new Date("2026-05-01"),
};

const baseInterview = (overrides: Partial<{
  id: string;
  status: "CREATED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "EVALUATED" | "CANCELLED";
}> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  recruiterId: "22222222-2222-4222-8222-222222222222",
  status: "SCHEDULED" as const,
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
  ...overrides,
});

function makeInterviews(count: number, status: "SCHEDULED" | "EVALUATED" = "SCHEDULED") {
  return Array.from({ length: count }, (_, i) =>
    baseInterview({
      id: `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      status,
    }),
  );
}

// ---------------------------------------------------------------------------
// Wrapper factory — fresh QueryClient per test
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(listInterviews).mockReset();
  useInterviewFilterStore.setState({ statusFilter: "ALL" });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useInterviewList — loading state
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewList — loading state", () => {
  it("starts in loading state before the query resolves", () => {
    vi.mocked(listInterviews).mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useInterviewList(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useInterviewList — happy path
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewList — happy path", () => {
  it("returns interviews after the query resolves", async () => {
    const interviews = makeInterviews(3);
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.interviews).toHaveLength(3);
  });

  it("returns total count equal to the number of matching interviews", async () => {
    const interviews = makeInterviews(5);
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.total).toBe(5);
    });
  });

  it("sets isError to false on success", async () => {
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews: [] }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useInterviewList — error path
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewList — error path", () => {
  it("sets isError to true when the service returns Err", async () => {
    vi.mocked(listInterviews).mockResolvedValue(
      Err({ kind: "NETWORK" as const, message: "Network down" }),
    );

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it("exposes the error kind when the service returns Err", async () => {
    vi.mocked(listInterviews).mockResolvedValue(
      Err({ kind: "NETWORK" as const, message: "Network down" }),
    );

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.kind).toBe("NETWORK");
  });
});

// ---------------------------------------------------------------------------
// useInterviewList — statusFilter from store
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewList — statusFilter", () => {
  it("returns only SCHEDULED interviews when filter is 'SCHEDULED'", async () => {
    const interviews = [
      baseInterview({ id: "aaaaaaaa-1111-4111-8111-111111111111", status: "SCHEDULED" }),
      baseInterview({ id: "bbbbbbbb-1111-4111-8111-111111111111", status: "EVALUATED" }),
    ];
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));
    useInterviewFilterStore.setState({ statusFilter: "SCHEDULED" });

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.interviews).toHaveLength(1);
    expect(result.current.interviews[0]?.status).toBe("SCHEDULED");
  });

  it("returns all interviews when filter is 'ALL'", async () => {
    const interviews = [
      baseInterview({ id: "aaaaaaaa-1111-4111-8111-111111111111", status: "SCHEDULED" }),
      baseInterview({ id: "bbbbbbbb-1111-4111-8111-111111111111", status: "EVALUATED" }),
    ];
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));
    useInterviewFilterStore.setState({ statusFilter: "ALL" });

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.interviews).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// useInterviewList — canLoadMore (pagination)
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewList — canLoadMore", () => {
  it("sets canLoadMore to false when total is 20 or fewer", async () => {
    const interviews = makeInterviews(5);
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canLoadMore).toBe(false);
  });

  it("sets canLoadMore to true when total exceeds 20", async () => {
    const interviews = makeInterviews(21);
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canLoadMore).toBe(true);
  });

  it("shows only the first 20 interviews when there are 21", async () => {
    const interviews = makeInterviews(21);
    vi.mocked(listInterviews).mockResolvedValue(Ok({ interviews }));

    const { result } = renderHook(() => useInterviewList(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.interviews).toHaveLength(20);
  });
});
