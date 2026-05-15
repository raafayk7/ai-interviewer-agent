import { beforeEach, describe, expect, it } from "vitest";
import { useInterviewFilterStore } from "./useInterviewFilterStore";

// ---------------------------------------------------------------------------
// Reset store to initial state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset only the data slice — do not pass `true` (replace) as that would
  // wipe out the action functions (setFilter / reset) that Zustand attaches.
  useInterviewFilterStore.setState({ statusFilter: "ALL" });
});

// ---------------------------------------------------------------------------
// useInterviewFilterStore — initial state
// ---------------------------------------------------------------------------

describe("useInterviewFilterStore — initial state", () => {
  it("starts with statusFilter set to 'ALL'", () => {
    expect(useInterviewFilterStore.getState().statusFilter).toBe("ALL");
  });
});

// ---------------------------------------------------------------------------
// useInterviewFilterStore — setFilter
// ---------------------------------------------------------------------------

describe("useInterviewFilterStore — setFilter", () => {
  it("sets statusFilter to 'SCHEDULED'", () => {
    useInterviewFilterStore.getState().setFilter("SCHEDULED");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("SCHEDULED");
  });

  it("sets statusFilter to 'CREATED'", () => {
    useInterviewFilterStore.getState().setFilter("CREATED");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("CREATED");
  });

  it("sets statusFilter to 'IN_PROGRESS'", () => {
    useInterviewFilterStore.getState().setFilter("IN_PROGRESS");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("IN_PROGRESS");
  });

  it("sets statusFilter to 'COMPLETED'", () => {
    useInterviewFilterStore.getState().setFilter("COMPLETED");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("COMPLETED");
  });

  it("sets statusFilter to 'EVALUATED'", () => {
    useInterviewFilterStore.getState().setFilter("EVALUATED");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("EVALUATED");
  });

  it("sets statusFilter to 'CANCELLED'", () => {
    useInterviewFilterStore.getState().setFilter("CANCELLED");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("CANCELLED");
  });

  it("sets statusFilter back to 'ALL' explicitly", () => {
    useInterviewFilterStore.getState().setFilter("SCHEDULED");
    useInterviewFilterStore.getState().setFilter("ALL");
    expect(useInterviewFilterStore.getState().statusFilter).toBe("ALL");
  });
});

// ---------------------------------------------------------------------------
// useInterviewFilterStore — reset
// ---------------------------------------------------------------------------

describe("useInterviewFilterStore — reset", () => {
  it("returns statusFilter to 'ALL' after a filter was set", () => {
    useInterviewFilterStore.getState().setFilter("EVALUATED");
    useInterviewFilterStore.getState().reset();
    expect(useInterviewFilterStore.getState().statusFilter).toBe("ALL");
  });

  it("is idempotent when called on already-default state", () => {
    useInterviewFilterStore.getState().reset();
    expect(useInterviewFilterStore.getState().statusFilter).toBe("ALL");
  });
});
