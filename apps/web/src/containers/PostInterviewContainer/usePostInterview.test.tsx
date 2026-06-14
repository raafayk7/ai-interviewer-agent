import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "http://localhost:8080",
    NEXT_PUBLIC_WS_URL: "ws://localhost:8080",
  },
}));

// ---------------------------------------------------------------------------
// Module mock
// ---------------------------------------------------------------------------
vi.mock("@/services/candidate.service", () => ({
  getCandidateInterviewView: vi.fn(),
}));

import { getCandidateInterviewView } from "@/services/candidate.service";
import { Ok, Err } from "@/lib/result";
import type { CandidateInterviewView } from "@/types";
import { usePostInterview } from "./usePostInterview";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test-token-abc123";

function baseView(
  overrides: Partial<CandidateInterviewView> = {},
): CandidateInterviewView {
  return {
    interviewId: INTERVIEW_ID,
    candidateName: "Jane Doe",
    jobTitle: "Senior Frontend Engineer",
    company: "Acme Corp",
    scheduledAt: new Date("2026-06-01T10:00:00.000Z"),
    targetDurationMinutes: 30,
    status: "SCHEDULED",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Wrapper factory — fresh QueryClient per test
// ---------------------------------------------------------------------------

let queryClient: QueryClient;

function makeWrapper() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(getCandidateInterviewView).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// usePostInterview — initial data
// ---------------------------------------------------------------------------

describe("[Integration] usePostInterview — initial data", () => {
  it("exposes the initial view without waiting for a fetch", () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.view).toEqual(initial);
  });

  it("sets isTerminal to false for SCHEDULED initial status", () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(false);
  });

  it("sets isTerminal to true for COMPLETED initial status", () => {
    const initial = baseView({ status: "COMPLETED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(true);
  });

  it("sets isTerminal to true for EVALUATED initial status", () => {
    const initial = baseView({ status: "EVALUATED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// usePostInterview — isTerminal reflects data status
// ---------------------------------------------------------------------------

describe("[Integration] usePostInterview — isTerminal reflects data status", () => {
  it("isTerminal is false for SCHEDULED", () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(false);
  });

  it("isTerminal is false for IN_PROGRESS", () => {
    const initial = baseView({ status: "IN_PROGRESS" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(false);
  });

  it("isTerminal is false for CANCELLED", () => {
    const initial = baseView({ status: "CANCELLED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(false);
  });

  it("isTerminal is true for COMPLETED", () => {
    const initial = baseView({ status: "COMPLETED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(true);
  });

  it("isTerminal is true for EVALUATED", () => {
    const initial = baseView({ status: "EVALUATED" });
    vi.mocked(getCandidateInterviewView).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isTerminal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// usePostInterview — view updates when service returns new data via refetch
// ---------------------------------------------------------------------------

describe("[Integration] usePostInterview — view updates via manual refetch", () => {
  it("updates view.status to IN_PROGRESS when service returns that status", async () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockResolvedValue(
      Ok(baseView({ status: "IN_PROGRESS" })),
    );

    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper },
    );

    // Manually trigger a refetch via the query client
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["candidate-view", INTERVIEW_ID],
      });
    });

    await waitFor(() => {
      expect(result.current.view?.status).toBe("IN_PROGRESS");
    });
  });

  it("sets isTerminal to true when service returns COMPLETED status", async () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockResolvedValue(
      Ok(baseView({ status: "COMPLETED" })),
    );

    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper },
    );

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["candidate-view", INTERVIEW_ID],
      });
    });

    await waitFor(() => {
      expect(result.current.isTerminal).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// usePostInterview — polling stops after MAX_POLLS
// ---------------------------------------------------------------------------

describe("[Integration] usePostInterview — polling cap", () => {
  it("stops calling the service after MAX_POLLS (5) refetches", async () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockResolvedValue(
      Ok(baseView({ status: "SCHEDULED" })),
    );

    vi.useFakeTimers();

    renderHook(() => usePostInterview({ initial, token: TOKEN }), {
      wrapper: makeWrapper(),
    });

    // Advance through 6 poll cycles — each cycle is 30s
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      await vi.runAllTimersAsync();
    }

    // Should have been called at most MAX_POLLS (5) times
    const callCount = vi.mocked(getCandidateInterviewView).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// usePostInterview — service error handling
// ---------------------------------------------------------------------------

describe("[Integration] usePostInterview — service error handling", () => {
  it("retains the initial view when the service returns a NETWORK error on refetch", async () => {
    const initial = baseView({ status: "SCHEDULED" });
    vi.mocked(getCandidateInterviewView).mockResolvedValue(
      Err({ kind: "NETWORK" as const, message: "Network down" }),
    );

    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => usePostInterview({ initial, token: TOKEN }),
      { wrapper },
    );

    // Initial view is present before any fetch
    expect(result.current.view).toEqual(initial);

    // Even after a failed refetch, the view from initialData is still defined
    await act(async () => {
      try {
        await queryClient.refetchQueries({
          queryKey: ["candidate-view", INTERVIEW_ID],
        });
      } catch {
        // Expected — the queryFn throws on error
      }
    });

    // view should still be defined from initialData
    expect(result.current.view).toBeDefined();
  });
});
