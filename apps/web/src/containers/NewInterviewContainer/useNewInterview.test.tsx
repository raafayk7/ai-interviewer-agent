import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/services/document.service", () => ({
  uploadDocuments: vi.fn(),
  extractDocuments: vi.fn(),
}));

vi.mock("@/services/interview.service", () => ({
  createInterview: vi.fn(),
  generatePlan: vi.fn(),
}));

import { useRouter } from "next/navigation";
import { uploadDocuments, extractDocuments } from "@/services/document.service";
import { createInterview, generatePlan } from "@/services/interview.service";
import { Ok, Err } from "@/lib/result";
import { useNewInterview } from "./useNewInterview";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseFileRef = {
  key: "uploads/file.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "file.pdf",
  uploadedAt: new Date("2026-05-01T00:00:00.000Z"),
};

const uploadResponse = {
  jdRef: { ...baseFileRef, key: "uploads/jd.pdf" },
  cvRef: { ...baseFileRef, key: "uploads/cv.pdf" },
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
// Router mock helpers
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({
    push: mockPush,
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  } as ReturnType<typeof useRouter>);
  mockPush.mockReset();
  vi.mocked(uploadDocuments).mockReset();
  vi.mocked(extractDocuments).mockReset();
  vi.mocked(createInterview).mockReset();
  vi.mocked(generatePlan).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useNewInterview — initial state
// ---------------------------------------------------------------------------

describe("[Integration] useNewInterview — initial state", () => {
  it("starts at step index 0", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    expect(result.current.stepIndex).toBe(0);
  });

  it("starts with no jdFile", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    expect(result.current.jdFile).toBeNull();
  });

  it("starts with no cvFile", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    expect(result.current.cvFile).toBeNull();
  });

  it("starts with no error", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    expect(result.current.error).toBeNull();
  });

  it("exposes the steps array from STEPS constant", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    expect(result.current.steps).toHaveLength(4);
    expect(result.current.steps[0]).toBe("Job description");
  });
});

// ---------------------------------------------------------------------------
// useNewInterview — next() from step 0 to step 1
// ---------------------------------------------------------------------------

describe("[Integration] useNewInterview — next() step 0 to 1", () => {
  it("advances from step 0 to step 1 when jdFile is set", async () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    const jdFile = new File(["content"], "jd.pdf", { type: "application/pdf" });

    // setJdFile in its own act so state is flushed before next() reads it
    act(() => {
      result.current.setJdFile(jdFile);
    });

    act(() => {
      result.current.next();
    });

    await waitFor(() => {
      expect(result.current.stepIndex).toBe(1);
    });
  });

  it("stays at step 0 if no jdFile is set", async () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });

    act(() => {
      result.current.next();
    });

    expect(result.current.stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useNewInterview — back() decrements stepIndex
// ---------------------------------------------------------------------------

describe("[Integration] useNewInterview — back()", () => {
  it("goes back from step 1 to step 0", async () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    const jdFile = new File(["content"], "jd.pdf", { type: "application/pdf" });

    // Set jdFile first, then next() reads the updated state
    act(() => {
      result.current.setJdFile(jdFile);
    });

    act(() => {
      result.current.next();
    });

    await waitFor(() => {
      expect(result.current.stepIndex).toBe(1);
    });

    act(() => {
      result.current.back();
    });

    expect(result.current.stepIndex).toBe(0);
  });

  it("does not go below step 0", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });

    act(() => {
      result.current.back();
    });

    expect(result.current.stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useNewInterview — close() navigates to /dashboard
// ---------------------------------------------------------------------------

describe("[Integration] useNewInterview — close()", () => {
  it("calls router.push('/dashboard') when close() is called", () => {
    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });

    act(() => {
      result.current.close();
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });
});

// ---------------------------------------------------------------------------
// useNewInterview — upload mutation at step 1
// ---------------------------------------------------------------------------

describe("[Integration] useNewInterview — upload at step 1", () => {
  it("advances to step 2 after successful upload", async () => {
    vi.mocked(uploadDocuments).mockResolvedValue(Ok(uploadResponse));

    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    const jdFile = new File(["content"], "jd.pdf", { type: "application/pdf" });
    const cvFile = new File(["content"], "cv.pdf", { type: "application/pdf" });

    // Set files first (each setState must be flushed before the next reads it)
    act(() => {
      result.current.setJdFile(jdFile);
    });
    act(() => {
      result.current.setCvFile(cvFile);
    });

    // Advance to step 1
    act(() => {
      result.current.next();
    });
    await waitFor(() => {
      expect(result.current.stepIndex).toBe(1);
    });

    // Trigger upload at step 1
    act(() => {
      result.current.next();
    });

    await waitFor(() => {
      expect(result.current.stepIndex).toBe(2);
    });
  });

  it("sets a NETWORK error message when upload fails with kind NETWORK", async () => {
    vi.mocked(uploadDocuments).mockResolvedValue(
      Err({ kind: "NETWORK" as const, message: "offline" }),
    );

    const { result } = renderHook(() => useNewInterview(), { wrapper: makeWrapper() });
    const jdFile = new File(["content"], "jd.pdf", { type: "application/pdf" });
    const cvFile = new File(["content"], "cv.pdf", { type: "application/pdf" });

    act(() => {
      result.current.setJdFile(jdFile);
    });
    act(() => {
      result.current.setCvFile(cvFile);
    });

    // Advance to step 1
    act(() => {
      result.current.next();
    });
    await waitFor(() => {
      expect(result.current.stepIndex).toBe(1);
    });

    // Trigger upload at step 1 (will fail)
    act(() => {
      result.current.next();
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Connection lost. Try again.");
    });
  });
});
