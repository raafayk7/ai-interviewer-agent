import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CandidateInterviewView } from "@/types";
import { useCandidateLanding } from "./useCandidateLanding";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";

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
// useCandidateLanding — view-model output
// ---------------------------------------------------------------------------

describe("useCandidateLanding — status SCHEDULED", () => {
  it("sets ctaEnabled to true", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "SCHEDULED" })));
    expect(result.current.ctaEnabled).toBe(true);
  });

  it("sets ctaCopy to include 'Begin device check'", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "SCHEDULED" })));
    expect(result.current.ctaCopy).toMatch(/begin device check/i);
  });

  it("sets blockedReason to undefined", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "SCHEDULED" })));
    expect(result.current.blockedReason).toBeUndefined();
  });
});

describe("useCandidateLanding — status COMPLETED", () => {
  it("sets ctaEnabled to false", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "COMPLETED" })));
    expect(result.current.ctaEnabled).toBe(false);
  });

  it("sets blockedReason mentioning already been completed", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "COMPLETED" })));
    expect(result.current.blockedReason).toMatch(/already been completed/i);
  });
});

describe("useCandidateLanding — status EVALUATED", () => {
  it("sets ctaEnabled to false", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "EVALUATED" })));
    expect(result.current.ctaEnabled).toBe(false);
  });

  it("sets blockedReason mentioning already been completed", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "EVALUATED" })));
    expect(result.current.blockedReason).toMatch(/already been completed/i);
  });
});

describe("useCandidateLanding — status IN_PROGRESS", () => {
  it("sets ctaEnabled to false", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "IN_PROGRESS" })));
    expect(result.current.ctaEnabled).toBe(false);
  });

  it("sets blockedReason mentioning already in progress", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "IN_PROGRESS" })));
    expect(result.current.blockedReason).toMatch(/already in progress/i);
  });
});

describe("useCandidateLanding — status CANCELLED", () => {
  it("sets ctaEnabled to false", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "CANCELLED" })));
    expect(result.current.ctaEnabled).toBe(false);
  });

  it("sets blockedReason mentioning cancelled", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "CANCELLED" })));
    expect(result.current.blockedReason).toMatch(/cancelled/i);
  });
});

describe("useCandidateLanding — status CREATED", () => {
  it("sets ctaEnabled to false", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "CREATED" })));
    expect(result.current.ctaEnabled).toBe(false);
  });

  it("sets blockedReason to 'isn't ready yet'", () => {
    const { result } = renderHook(() => useCandidateLanding(baseView({ status: "CREATED" })));
    expect(result.current.blockedReason).toMatch(/isn't ready yet/i);
  });
});

describe("useCandidateLanding — greeting", () => {
  it("derives greeting from first name of candidateName", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(baseView({ candidateName: "Jane Doe" })),
    );
    expect(result.current.greeting).toBe("Hi, Jane.");
  });

  it("uses single-word name as-is", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(baseView({ candidateName: "Mononymous" })),
    );
    expect(result.current.greeting).toBe("Hi, Mononymous.");
  });
});

describe("useCandidateLanding — durationLine", () => {
  it("shows 'Target length: not set' when targetDurationMinutes is null", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(baseView({ targetDurationMinutes: null })),
    );
    expect(result.current.durationLine).toBe("Target length: not set");
  });

  it("includes the minutes value when targetDurationMinutes is set", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(baseView({ targetDurationMinutes: 15 })),
    );
    expect(result.current.durationLine).toMatch(/15 min/);
  });

  it("formats 30 minutes correctly", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(baseView({ targetDurationMinutes: 30 })),
    );
    expect(result.current.durationLine).toMatch(/30 min/);
  });
});

describe("useCandidateLanding — jobLine", () => {
  it("combines jobTitle and company with a separator", () => {
    const { result } = renderHook(() =>
      useCandidateLanding(
        baseView({ jobTitle: "Staff Engineer", company: "TestCo" }),
      ),
    );
    expect(result.current.jobLine).toMatch(/Staff Engineer/);
    expect(result.current.jobLine).toMatch(/TestCo/);
  });
});
