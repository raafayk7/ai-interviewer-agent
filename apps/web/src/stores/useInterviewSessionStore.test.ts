import { beforeEach, describe, expect, it } from "vitest";
import { useInterviewSessionStore } from "./useInterviewSessionStore";

// ---------------------------------------------------------------------------
// Reset store to initial state before each test using the reset() action.
// reset() restores all fields except transcriptVisible (per source signature).
// For transcriptVisible we separately reset it to false.
// ---------------------------------------------------------------------------

beforeEach(() => {
  useInterviewSessionStore.getState().reset();
  // reset() does not touch transcriptVisible — restore it manually
  useInterviewSessionStore.setState({ transcriptVisible: false });
  // Also clear localStorage side-effect
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — initial state", () => {
  it("starts with connectionState 'idle'", () => {
    expect(useInterviewSessionStore.getState().connectionState).toBe("idle");
  });

  it("starts with speaker 'silent'", () => {
    expect(useInterviewSessionStore.getState().speaker).toBe("silent");
  });

  it("starts with micMuted false", () => {
    expect(useInterviewSessionStore.getState().micMuted).toBe(false);
  });

  it("starts with an empty transcript", () => {
    expect(useInterviewSessionStore.getState().transcript).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setConnectionState
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — setConnectionState", () => {
  it("transitions to 'connecting'", () => {
    useInterviewSessionStore.getState().setConnectionState("connecting");
    expect(useInterviewSessionStore.getState().connectionState).toBe("connecting");
  });

  it("transitions to 'connected'", () => {
    useInterviewSessionStore.getState().setConnectionState("connected");
    expect(useInterviewSessionStore.getState().connectionState).toBe("connected");
  });

  it("transitions to 'reconnecting'", () => {
    useInterviewSessionStore.getState().setConnectionState("reconnecting");
    expect(useInterviewSessionStore.getState().connectionState).toBe("reconnecting");
  });

  it("transitions to 'completed'", () => {
    useInterviewSessionStore.getState().setConnectionState("completed");
    expect(useInterviewSessionStore.getState().connectionState).toBe("completed");
  });

  it("transitions to 'interrupted'", () => {
    useInterviewSessionStore.getState().setConnectionState("interrupted");
    expect(useInterviewSessionStore.getState().connectionState).toBe("interrupted");
  });

  it("transitions to 'error'", () => {
    useInterviewSessionStore.getState().setConnectionState("error");
    expect(useInterviewSessionStore.getState().connectionState).toBe("error");
  });

  it("transitions to 'blocked'", () => {
    useInterviewSessionStore.getState().setConnectionState("blocked");
    expect(useInterviewSessionStore.getState().connectionState).toBe("blocked");
  });

  it("transitions back to 'idle'", () => {
    useInterviewSessionStore.getState().setConnectionState("connected");
    useInterviewSessionStore.getState().setConnectionState("idle");
    expect(useInterviewSessionStore.getState().connectionState).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// setSpeaker
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — setSpeaker", () => {
  it("sets speaker to 'candidate'", () => {
    useInterviewSessionStore.getState().setSpeaker("candidate");
    expect(useInterviewSessionStore.getState().speaker).toBe("candidate");
  });

  it("sets speaker to 'ai'", () => {
    useInterviewSessionStore.getState().setSpeaker("ai");
    expect(useInterviewSessionStore.getState().speaker).toBe("ai");
  });

  it("sets speaker back to 'silent'", () => {
    useInterviewSessionStore.getState().setSpeaker("candidate");
    useInterviewSessionStore.getState().setSpeaker("silent");
    expect(useInterviewSessionStore.getState().speaker).toBe("silent");
  });
});

// ---------------------------------------------------------------------------
// appendTranscript
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — appendTranscript", () => {
  const entry1 = {
    speaker: "candidate" as const,
    text: "Hello",
    timestamp: new Date("2026-05-01T10:00:00.000Z"),
  };
  const entry2 = {
    speaker: "agent" as const,
    text: "Hi there",
    timestamp: new Date("2026-05-01T10:00:05.000Z"),
  };

  it("appends a single entry to an empty transcript", () => {
    useInterviewSessionStore.getState().appendTranscript([entry1]);
    expect(useInterviewSessionStore.getState().transcript).toHaveLength(1);
    expect(useInterviewSessionStore.getState().transcript[0]?.text).toBe("Hello");
  });

  it("is additive — calling twice keeps all prior entries", () => {
    useInterviewSessionStore.getState().appendTranscript([entry1]);
    useInterviewSessionStore.getState().appendTranscript([entry2]);
    const transcript = useInterviewSessionStore.getState().transcript;
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.text).toBe("Hello");
    expect(transcript[1]?.text).toBe("Hi there");
  });

  it("preserves order of entries across multiple calls", () => {
    useInterviewSessionStore.getState().appendTranscript([entry1]);
    useInterviewSessionStore.getState().appendTranscript([entry2]);
    expect(useInterviewSessionStore.getState().transcript[0]?.speaker).toBe("candidate");
    expect(useInterviewSessionStore.getState().transcript[1]?.speaker).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// setTranscriptVisible
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — setTranscriptVisible", () => {
  it("sets transcriptVisible to true in state", () => {
    useInterviewSessionStore.getState().setTranscriptVisible(true);
    expect(useInterviewSessionStore.getState().transcriptVisible).toBe(true);
  });

  it("writes '1' to localStorage when called with true", () => {
    useInterviewSessionStore.getState().setTranscriptVisible(true);
    expect(localStorage.getItem("sift.transcriptVisible")).toBe("1");
  });

  it("sets transcriptVisible to false in state", () => {
    useInterviewSessionStore.getState().setTranscriptVisible(true);
    useInterviewSessionStore.getState().setTranscriptVisible(false);
    expect(useInterviewSessionStore.getState().transcriptVisible).toBe(false);
  });

  it("writes '0' to localStorage when called with false", () => {
    useInterviewSessionStore.getState().setTranscriptVisible(false);
    expect(localStorage.getItem("sift.transcriptVisible")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("useInterviewSessionStore — reset", () => {
  it("returns connectionState to 'idle'", () => {
    useInterviewSessionStore.getState().setConnectionState("connected");
    useInterviewSessionStore.getState().reset();
    expect(useInterviewSessionStore.getState().connectionState).toBe("idle");
  });

  it("clears the transcript", () => {
    useInterviewSessionStore.getState().appendTranscript([
      { speaker: "candidate", text: "test", timestamp: new Date() },
    ]);
    useInterviewSessionStore.getState().reset();
    expect(useInterviewSessionStore.getState().transcript).toHaveLength(0);
  });

  it("resets speaker to 'silent'", () => {
    useInterviewSessionStore.getState().setSpeaker("ai");
    useInterviewSessionStore.getState().reset();
    expect(useInterviewSessionStore.getState().speaker).toBe("silent");
  });

  it("does NOT reset transcriptVisible — it retains its current value", () => {
    useInterviewSessionStore.getState().setTranscriptVisible(true);
    useInterviewSessionStore.getState().reset();
    // reset() does not touch transcriptVisible per the source implementation
    expect(useInterviewSessionStore.getState().transcriptVisible).toBe(true);
  });
});
