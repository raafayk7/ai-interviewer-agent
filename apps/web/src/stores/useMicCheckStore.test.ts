import { beforeEach, describe, expect, it } from "vitest";
import { useMicCheckStore } from "./useMicCheckStore";

// ---------------------------------------------------------------------------
// Reset store to initial state before each test using the reset() action.
// ---------------------------------------------------------------------------

beforeEach(() => {
  useMicCheckStore.getState().reset();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("useMicCheckStore — initial state", () => {
  it("starts with permission 'idle'", () => {
    expect(useMicCheckStore.getState().permission).toBe("idle");
  });

  it("starts with level 0", () => {
    expect(useMicCheckStore.getState().level).toBe(0);
  });

  it("starts with outcome 'pending'", () => {
    expect(useMicCheckStore.getState().outcome).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// setLevel — clamping
// ---------------------------------------------------------------------------

describe("useMicCheckStore — setLevel", () => {
  it("clamps negative values to 0", () => {
    useMicCheckStore.getState().setLevel(-0.5);
    expect(useMicCheckStore.getState().level).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    useMicCheckStore.getState().setLevel(1.5);
    expect(useMicCheckStore.getState().level).toBe(1);
  });

  it("passes through a value within [0, 1]", () => {
    useMicCheckStore.getState().setLevel(0.42);
    expect(useMicCheckStore.getState().level).toBeCloseTo(0.42);
  });

  it("accepts exactly 0", () => {
    useMicCheckStore.getState().setLevel(0);
    expect(useMicCheckStore.getState().level).toBe(0);
  });

  it("accepts exactly 1", () => {
    useMicCheckStore.getState().setLevel(1);
    expect(useMicCheckStore.getState().level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// setPermission
// ---------------------------------------------------------------------------

describe("useMicCheckStore — setPermission", () => {
  it("transitions from idle to requesting", () => {
    useMicCheckStore.getState().setPermission("requesting");
    expect(useMicCheckStore.getState().permission).toBe("requesting");
  });

  it("transitions from requesting to granted", () => {
    useMicCheckStore.getState().setPermission("requesting");
    useMicCheckStore.getState().setPermission("granted");
    expect(useMicCheckStore.getState().permission).toBe("granted");
  });

  it("transitions from granted to denied", () => {
    useMicCheckStore.getState().setPermission("granted");
    useMicCheckStore.getState().setPermission("denied");
    expect(useMicCheckStore.getState().permission).toBe("denied");
  });

  it("can cycle back to idle", () => {
    useMicCheckStore.getState().setPermission("denied");
    useMicCheckStore.getState().setPermission("idle");
    expect(useMicCheckStore.getState().permission).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// markPassed
// ---------------------------------------------------------------------------

describe("useMicCheckStore — markPassed", () => {
  it("flips outcome to 'passed'", () => {
    useMicCheckStore.getState().markPassed();
    expect(useMicCheckStore.getState().outcome).toBe("passed");
  });

  it("is idempotent — calling twice keeps outcome as 'passed'", () => {
    useMicCheckStore.getState().markPassed();
    useMicCheckStore.getState().markPassed();
    expect(useMicCheckStore.getState().outcome).toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("useMicCheckStore — reset", () => {
  it("returns permission to 'idle'", () => {
    useMicCheckStore.getState().setPermission("granted");
    useMicCheckStore.getState().reset();
    expect(useMicCheckStore.getState().permission).toBe("idle");
  });

  it("returns level to 0", () => {
    useMicCheckStore.getState().setLevel(0.75);
    useMicCheckStore.getState().reset();
    expect(useMicCheckStore.getState().level).toBe(0);
  });

  it("returns outcome to 'pending'", () => {
    useMicCheckStore.getState().markPassed();
    useMicCheckStore.getState().reset();
    expect(useMicCheckStore.getState().outcome).toBe("pending");
  });

  it("restores all fields simultaneously", () => {
    useMicCheckStore.getState().setPermission("denied");
    useMicCheckStore.getState().setLevel(0.9);
    useMicCheckStore.getState().markPassed();
    useMicCheckStore.getState().reset();
    const state = useMicCheckStore.getState();
    expect(state.permission).toBe("idle");
    expect(state.level).toBe(0);
    expect(state.outcome).toBe("pending");
  });
});
