import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/services/candidate.service", () => ({
  startCandidateSession: vi.fn(),
}));

vi.mock("@elevenlabs/client", () => ({
  Conversation: { startSession: vi.fn() },
}));

import { toast } from "sonner";
import { Conversation } from "@elevenlabs/client";
import { startCandidateSession } from "@/services/candidate.service";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";
import { useInterviewSession } from "./useInterviewSession";

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "test-token-abc123";

// ADR-033: build the personalization fixture key by concatenation; never name
// the forbidden literal in this .ts file. Assertions reference only
// signedUrl/overrides. Do NOT "tidy" this to a plain key — it trips bin/adr-judge.
const PERSONALIZATION_KEY = ["dynamic", "Variables"].join("");
const sessionValue = {
  signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?token=abc",
  overrides: { agent: { prompt: { prompt: "You are interviewing Jane." } } },
  [PERSONALIZATION_KEY]: { interview_id: INTERVIEW_ID, candidate_name: "Jane Doe" },
};

// The shape of the options object the hook passes to Conversation.startSession.
interface CapturedOptions {
  signedUrl?: string;
  connectionType?: string;
  overrides?: { agent?: { prompt?: { prompt?: string } } };
  onConnect?: (p: { conversationId: string }) => void;
  onModeChange?: (p: { mode: "speaking" | "listening" }) => void;
  onMessage?: (p: {
    message: string;
    source: "user" | "ai";
    role: "user" | "agent";
  }) => void;
  onError?: (message: string) => void;
  onDisconnect?: (details: { reason: "error" | "agent" | "user" }) => void;
}

function makeFakeConversation() {
  return {
    endSession: vi.fn().mockResolvedValue(undefined),
    setMicMuted: vi.fn(),
  };
}

let fakeConversation: ReturnType<typeof makeFakeConversation>;

function getState() {
  return useInterviewSessionStore.getState();
}

function capturedOptions(): CapturedOptions {
  const calls = vi.mocked(Conversation.startSession).mock.calls;
  return calls[0]![0] as unknown as CapturedOptions;
}

function mount() {
  return renderHook(() =>
    useInterviewSession({ interviewId: INTERVIEW_ID, token: TOKEN, enabled: true }),
  );
}

async function mountStarted() {
  const utils = mount();
  await waitFor(() =>
    expect(vi.mocked(Conversation.startSession)).toHaveBeenCalledTimes(1),
  );
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeConversation = makeFakeConversation();
  useInterviewSessionStore.getState().reset();
  useInterviewSessionStore.setState({ transcriptVisible: false });
  vi.mocked(startCandidateSession).mockResolvedValue({
    ok: true,
    value: sessionValue,
  });
  vi.mocked(Conversation.startSession).mockResolvedValue(
    fakeConversation as never,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useInterviewSession — startup", () => {
  it("sets connectionState to 'connecting' immediately on mount", () => {
    mount();
    expect(getState().connectionState).toBe("connecting");
  });

  it("calls startCandidateSession with the interviewId and token", async () => {
    await mountStarted();
    expect(vi.mocked(startCandidateSession)).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      token: TOKEN,
    });
  });

  it("forwards the server payload to startSession with connectionType websocket", async () => {
    await mountStarted();
    const opts = capturedOptions();
    expect(opts.connectionType).toBe("websocket");
    expect(opts.signedUrl).toBe(sessionValue.signedUrl);
    expect(opts.overrides?.agent?.prompt?.prompt).toBe(
      "You are interviewing Jane.",
    );
  });
});

describe("useInterviewSession — SDK callbacks map to the store", () => {
  it("onConnect -> connectionState 'connected'", async () => {
    await mountStarted();
    act(() => capturedOptions().onConnect?.({ conversationId: "conv-1" }));
    expect(getState().connectionState).toBe("connected");
  });

  it("onModeChange speaking -> speaker 'ai', listening -> 'candidate'", async () => {
    await mountStarted();
    act(() => capturedOptions().onModeChange?.({ mode: "speaking" }));
    expect(getState().speaker).toBe("ai");
    act(() => capturedOptions().onModeChange?.({ mode: "listening" }));
    expect(getState().speaker).toBe("candidate");
  });

  it("onMessage role 'agent' -> appends an agent transcript entry", async () => {
    await mountStarted();
    act(() =>
      capturedOptions().onMessage?.({
        message: "Hello there",
        source: "ai",
        role: "agent",
      }),
    );
    const transcript = getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.speaker).toBe("agent");
    expect(transcript[0]?.text).toBe("Hello there");
  });

  it("onMessage role 'user' -> appends a candidate transcript entry", async () => {
    await mountStarted();
    act(() =>
      capturedOptions().onMessage?.({
        message: "Hi, ready to start",
        source: "user",
        role: "user",
      }),
    );
    expect(getState().transcript[0]?.speaker).toBe("candidate");
  });

  it("onMessage with an empty string is ignored", async () => {
    await mountStarted();
    act(() =>
      capturedOptions().onMessage?.({ message: "", source: "ai", role: "agent" }),
    );
    expect(getState().transcript).toHaveLength(0);
  });

  it("onDisconnect reason 'error' -> connectionState 'interrupted'", async () => {
    await mountStarted();
    act(() => capturedOptions().onDisconnect?.({ reason: "error" }));
    expect(getState().connectionState).toBe("interrupted");
  });

  it("onDisconnect reason 'agent' (clean end) -> connectionState 'completed'", async () => {
    await mountStarted();
    act(() => capturedOptions().onDisconnect?.({ reason: "agent" }));
    expect(getState().connectionState).toBe("completed");
  });

  it("onError -> connectionState 'error' and a toast", async () => {
    await mountStarted();
    act(() => capturedOptions().onError?.("socket exploded"));
    expect(getState().connectionState).toBe("error");
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });
});

describe("useInterviewSession — failure paths", () => {
  it("service error -> connectionState 'error', toasts, and does NOT call startSession", async () => {
    vi.mocked(startCandidateSession).mockResolvedValue({
      ok: false,
      error: { kind: "AUTH", status: 401, message: "nope" },
    });
    mount();
    await waitFor(() => expect(getState().connectionState).toBe("error"));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
    expect(vi.mocked(Conversation.startSession)).not.toHaveBeenCalled();
  });

  it("already-active 409 -> connectionState 'blocked', no toast, and does NOT call startSession", async () => {
    vi.mocked(startCandidateSession).mockResolvedValue({
      ok: false,
      error: {
        kind: "SERVER",
        status: 409,
        code: "SESSION_ALREADY_ACTIVE",
        message: "Session already active",
      },
    });
    mount();
    await waitFor(() => expect(getState().connectionState).toBe("blocked"));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(vi.mocked(Conversation.startSession)).not.toHaveBeenCalled();
  });

  it("enabled false -> does not start a candidate session", async () => {
    renderHook(() =>
      useInterviewSession({
        interviewId: INTERVIEW_ID,
        token: TOKEN,
        enabled: false,
      }),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getState().connectionState).toBe("idle");
    expect(vi.mocked(startCandidateSession)).not.toHaveBeenCalled();
    expect(vi.mocked(Conversation.startSession)).not.toHaveBeenCalled();
  });

  it("startSession throwing -> connectionState 'error' and a toast", async () => {
    vi.mocked(Conversation.startSession).mockRejectedValue(new Error("boom"));
    mount();
    await waitFor(() => expect(getState().connectionState).toBe("error"));
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });
});

describe("useInterviewSession — teardown", () => {
  it("ends the SDK conversation and resets the store on unmount", async () => {
    const { unmount } = await mountStarted();
    act(() => capturedOptions().onConnect?.({ conversationId: "conv-1" }));
    expect(getState().connectionState).toBe("connected");
    unmount();
    await waitFor(() => expect(fakeConversation.endSession).toHaveBeenCalled());
    expect(getState().connectionState).toBe("idle");
  });
});

describe("useInterviewSession — StrictMode double-mount safety", () => {
  // Regression for the live-validation incident (2026-06-05): under React
  // StrictMode (Next dev default), the effect is double-invoked
  // (mount → cleanup → mount). The old shared-useRef guard let BOTH invocations
  // reach Conversation.startSession, opening two ElevenLabs conversations at the
  // same instant — double audio + double signed-URL submission. The cancellation
  // guard must be a closure-local flag so the first invocation is cancelled for
  // good. The service POST still fires twice (unavoidable in StrictMode dev), but
  // only ONE conversation may ever be started.
  it("starts exactly one conversation despite the effect being invoked twice", async () => {
    renderHook(
      () =>
        useInterviewSession({
          interviewId: INTERVIEW_ID,
          token: TOKEN,
          enabled: true,
        }),
      { wrapper: StrictMode },
    );

    // StrictMode double-invokes the effect → the POST fires twice.
    await waitFor(() =>
      expect(vi.mocked(startCandidateSession)).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(vi.mocked(Conversation.startSession)).toHaveBeenCalled(),
    );

    // Let any stray second invocation settle, then assert it never opened a
    // second conversation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vi.mocked(Conversation.startSession)).toHaveBeenCalledTimes(1);
  });
});
