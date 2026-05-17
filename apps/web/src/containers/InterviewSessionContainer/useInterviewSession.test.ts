import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";

// ---------------------------------------------------------------------------
// Mock @/lib/env FIRST — before it is imported by useInterviewSession
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "http://localhost:8080",
    NEXT_PUBLIC_WS_URL: "ws://localhost:8080",
  },
}));

// ---------------------------------------------------------------------------
// Mock sonner toast so no DOM noise
// ---------------------------------------------------------------------------
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock AudioPlaybackQueue at the module boundary.
//
// vi.mock() is hoisted before ANY module-scope variable declarations, so we
// CANNOT reference a module-scope variable from inside the factory. Instead,
// the factory returns a vi.fn() constructor. In beforeEach we call
//   vi.mocked(AudioPlaybackQueue).mockImplementation(() => currentPlaybackMock)
// to swap the instance returned, which is safe because the import happens
// after vi.mock() registration.
// ---------------------------------------------------------------------------
vi.mock("./audio-playback-queue", () => ({
  AudioPlaybackQueue: vi.fn(),
}));

// Import the mocked constructor after vi.mock registration
import { AudioPlaybackQueue } from "./audio-playback-queue";

// ---------------------------------------------------------------------------
// Import the hook AFTER all vi.mock() calls
// ---------------------------------------------------------------------------
import { useInterviewSession } from "./useInterviewSession";

// ---------------------------------------------------------------------------
// MockWebSocket infrastructure
// ---------------------------------------------------------------------------

const mockWebSocketInstances: MockWebSocket[] = [];

class MockWebSocket {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  binaryType = "";
  readyState = 0; // CONNECTING
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  sent: unknown[] = [];
  closeCalled = false;
  closeCode: number | undefined;
  closeReason: string | undefined;

  constructor(public url: string) {
    mockWebSocketInstances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Fake AudioContext + AudioWorkletNode
// ---------------------------------------------------------------------------

function makeFakeAudioContext(sampleRate = 16000) {
  const fakeSource = { connect: vi.fn() };
  return {
    sampleRate,
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn().mockReturnValue(fakeSource),
    close: vi.fn().mockResolvedValue(undefined),
    _fakeSource: fakeSource,
  };
}

const mockWorkletPort = { onmessage: null as unknown };
const mockWorkletNode = { port: mockWorkletPort };

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let fakeAudioCtx: ReturnType<typeof makeFakeAudioContext>;
const mockGetUserMedia = vi.fn();

// Current playback mock instance — reset in beforeEach
let currentPlaybackMock: { enqueue: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };

// Track renderHook results to unmount before afterEach
const hookHandles: Array<{ unmount: () => void }> = [];

const ARGS = { interviewId: "interview-id-1", token: "tok-abc" };

function renderInterviewSession(args = ARGS) {
  const handle = renderHook(() => useInterviewSession(args));
  hookHandles.push(handle);
  return handle;
}

function latestWs(): MockWebSocket {
  return mockWebSocketInstances[mockWebSocketInstances.length - 1]!;
}

function openLatestWs(): void {
  const ws = latestWs();
  ws.readyState = MockWebSocket.OPEN;
  ws.onopen?.(new Event("open"));
}

// Flush pending microtasks (Promise chains) without relying on timers.
// Must be called inside act() to keep React happy.
async function flushPromises(): Promise<void> {
  // 4 awaits is sufficient to drain getUserMedia -> addModule -> connect chains
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  // Fresh spy references per test
  currentPlaybackMock = {
    enqueue: vi.fn(),
    dispose: vi.fn(),
  };

  // Wire the mock constructor to return our fresh instance
  vi.mocked(AudioPlaybackQueue).mockImplementation(
    () => currentPlaybackMock as unknown as AudioPlaybackQueue,
  );

  // Clear instance tracking
  mockWebSocketInstances.length = 0;
  hookHandles.length = 0;

  // Reset store and getUserMedia
  useInterviewSessionStore.getState().reset();
  mockGetUserMedia.mockReset();

  // Default fake stream
  const track = { stop: vi.fn() };
  const fakeStream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  mockGetUserMedia.mockResolvedValue(fakeStream);

  // Stub navigator.mediaDevices — jsdom may not expose it
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });

  // Fake AudioContext
  fakeAudioCtx = makeFakeAudioContext(16000);
  vi.stubGlobal(
    "AudioContext",
    vi.fn().mockImplementation(() => fakeAudioCtx),
  );

  // Fake AudioWorkletNode
  vi.stubGlobal(
    "AudioWorkletNode",
    vi.fn().mockImplementation(() => mockWorkletNode),
  );

  // Fake WebSocket
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  // Unmount all hooks BEFORE vi.unstubAllGlobals so that React cleanup
  // (ctx.close etc.) runs while stubs are still active.
  act(() => {
    for (const h of hookHandles) {
      try { h.unmount(); } catch { /* ignore double-unmount */ }
    }
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Connect success path
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — connect success path", () => {
  it("calls getUserMedia and sets up AudioContext on mount", async () => {
    renderInterviewSession();

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    });
    await waitFor(() => {
      expect(fakeAudioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
        "/audio-worklet/pcm-downsampler.js",
      );
    });
  });

  it("constructs a WebSocket with the correct URL after mic setup", async () => {
    renderInterviewSession();

    await waitFor(() => {
      expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1);
    });

    const ws = latestWs();
    expect(ws.url).toContain("interview-id-1");
    expect(ws.url).toContain("tok-abc");
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("sets connectionState to connected after ws.onopen fires", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    expect(useInterviewSessionStore.getState().connectionState).toBe("connected");
  });
});

// ---------------------------------------------------------------------------
// Binary frame — MP3 chunk enqueued
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — binary frame received", () => {
  it("enqueues binary frame in AudioPlaybackQueue", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const ws = latestWs();
    await act(async () => {
      ws.onmessage?.({ data: new ArrayBuffer(8) } as MessageEvent);
    });

    expect(currentPlaybackMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it("sets speaker to ai when a binary frame is received", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const ws = latestWs();
    await act(async () => {
      ws.onmessage?.({ data: new ArrayBuffer(8) } as MessageEvent);
    });

    expect(useInterviewSessionStore.getState().speaker).toBe("ai");
  });
});

// ---------------------------------------------------------------------------
// session.completed text frame
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — session.completed text frame", () => {
  it("sets connectionState to completed on session.completed message", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const completedPayload = {
      type: "session.completed",
      payload: {
        transcript: [
          {
            speaker: "candidate",
            text: "Hello there",
            timestamp: new Date("2026-05-17T10:00:00.000Z").toISOString(),
          },
        ],
      },
    };

    const ws = latestWs();
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify(completedPayload),
      } as MessageEvent);
    });

    expect(useInterviewSessionStore.getState().connectionState).toBe("completed");
  });

  it("appends transcript entries on session.completed", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const ws = latestWs();
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.completed",
          payload: {
            transcript: [
              {
                speaker: "candidate",
                text: "Hi from candidate",
                timestamp: new Date("2026-05-17T10:00:00.000Z").toISOString(),
              },
            ],
          },
        }),
      } as MessageEvent);
    });

    const transcript = useInterviewSessionStore.getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.text).toBe("Hi from candidate");
    expect(transcript[0]?.speaker).toBe("candidate");
  });
});

// ---------------------------------------------------------------------------
// 1008 POLICY_VIOLATION close — terminal, no reconnect
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — 1008 close is terminal", () => {
  it("sets connectionState to interrupted on 1008 close", async () => {
    renderInterviewSession();

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const wsCountBefore = mockWebSocketInstances.length;
    const ws = latestWs();

    await act(async () => {
      ws.onclose?.({ code: 1008, reason: "Policy violation" } as CloseEvent);
    });

    expect(useInterviewSessionStore.getState().connectionState).toBe("interrupted");
    // No new WebSocket should have been created
    expect(mockWebSocketInstances.length).toBe(wsCountBefore);
  });
});

// ---------------------------------------------------------------------------
// Non-1008 close triggers reconnect
//
// These tests use vi.useFakeTimers(). After mounting, we flush the promise
// chain (getUserMedia -> addModule -> connect) with multiple awaits inside
// act(), then advance timers to drive reconnect logic.
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — non-1008 close triggers reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("creates a new WebSocket after initial backoff (250ms) on 1006 close", async () => {
    renderInterviewSession();

    // Flush the async mic + worklet + connect chain via microtask awaits.
    // With fake timers active, Promise-based microtasks still run; only
    // setTimeout/setInterval are frozen.
    await act(async () => {
      await flushPromises();
    });

    // A WebSocket should now have been constructed
    expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      openLatestWs();
    });

    const wsCountAfterConnect = mockWebSocketInstances.length;
    const ws = latestWs();

    await act(async () => {
      ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
    });

    // Advance past initial 250ms backoff
    await act(async () => {
      vi.advanceTimersByTime(300);
      // flush the connect() call that fires from setTimeout callback
      await flushPromises();
    });

    expect(mockWebSocketInstances.length).toBeGreaterThan(wsCountAfterConnect);
  });

  it("sets connectionState to reconnecting after the 2s UI delay", async () => {
    renderInterviewSession();

    // Flush mic + worklet + connect chain
    await act(async () => {
      await flushPromises();
    });

    expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      openLatestWs();
    });

    const ws = latestWs();
    await act(async () => {
      ws.readyState = MockWebSocket.CLOSED;
      ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
    });

    // Before 2s, connection state should NOT be reconnecting yet (DESIGN.md §7)
    expect(useInterviewSessionStore.getState().connectionState).not.toBe(
      "reconnecting",
    );

    // Advance past the 2s UI delay
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(useInterviewSessionStore.getState().connectionState).toBe(
      "reconnecting",
    );
  });
});

// ---------------------------------------------------------------------------
// Reconnect attempts cap
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — reconnect attempts cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("transitions to interrupted when MAX_RECONNECTS (10) is exceeded", async () => {
    renderInterviewSession();

    // Flush the async mic + worklet + connect chain
    await act(async () => {
      await flushPromises();
    });

    expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1);

    // Open the initial WS (resets reconnectAttemptRef to 0)
    await act(async () => {
      openLatestWs();
    });
    expect(useInterviewSessionStore.getState().connectionState).toBe("connected");

    // Now simulate repeated failures WITHOUT ever calling onopen on the
    // reconnected WebSockets. This causes reconnectAttemptRef to accumulate.
    //
    // After the initial-ws close:  attempt becomes 1
    // After reconnect-ws-1 close:  attempt becomes 2
    // ...
    // After reconnect-ws-9 close:  attempt becomes 10 → next close checks
    //                               10 >= MAX_RECONNECTS(10) → interrupted
    //
    // We need 11 closes total: 1 on the opened WS + 10 on never-opened WS.
    for (let i = 0; i < 11; i++) {
      const ws = latestWs();
      await act(async () => {
        ws.readyState = MockWebSocket.CLOSED;
        ws.onclose?.({ code: 1006, reason: "" } as CloseEvent);
      });

      // Advance past both the UI-delay timer (2s) and the backoff cap (4s)
      // so the setTimeout(connect) fires if one was scheduled.
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await flushPromises();
      });

      // Intentionally do NOT call onopen on the new WS — we want attempts
      // to accumulate so the cap triggers.
    }

    expect(useInterviewSessionStore.getState().connectionState).toBe("interrupted");
  });
});

// ---------------------------------------------------------------------------
// Unmount cleanup
// ---------------------------------------------------------------------------

describe("[Integration] useInterviewSession — unmount cleanup", () => {
  it("closes the WebSocket with code 1000 and reason 'client unmount' on unmount", async () => {
    // Manual handle — not tracked in hookHandles to avoid double-unmount
    const handle = renderHook(() => useInterviewSession(ARGS));

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    const ws = latestWs();

    act(() => {
      handle.unmount();
    });

    expect(ws.closeCalled).toBe(true);
    expect(ws.closeCode).toBe(1000);
    expect(ws.closeReason).toBe("client unmount");
  });

  it("closes AudioContext on unmount", async () => {
    const handle = renderHook(() => useInterviewSession(ARGS));

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    act(() => {
      handle.unmount();
    });

    expect(fakeAudioCtx.close).toHaveBeenCalled();
  });

  it("stops stream tracks on unmount", async () => {
    const track = { stop: vi.fn() };
    const trackStream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    mockGetUserMedia.mockResolvedValue(trackStream);

    const handle = renderHook(() => useInterviewSession(ARGS));

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    act(() => {
      handle.unmount();
    });

    expect(track.stop).toHaveBeenCalled();
  });

  it("calls dispose on AudioPlaybackQueue on unmount", async () => {
    const handle = renderHook(() => useInterviewSession(ARGS));

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    act(() => {
      handle.unmount();
    });

    expect(currentPlaybackMock.dispose).toHaveBeenCalled();
  });

  it("resets the interview session store on unmount", async () => {
    const handle = renderHook(() => useInterviewSession(ARGS));

    await waitFor(() => expect(mockWebSocketInstances.length).toBeGreaterThanOrEqual(1));

    await act(async () => {
      openLatestWs();
    });

    // Dirty some state via a binary frame
    await act(async () => {
      latestWs().onmessage?.({ data: new ArrayBuffer(4) } as MessageEvent);
    });
    expect(useInterviewSessionStore.getState().speaker).toBe("ai");

    act(() => {
      handle.unmount();
    });

    expect(useInterviewSessionStore.getState().connectionState).toBe("idle");
    expect(useInterviewSessionStore.getState().speaker).toBe("silent");
  });
});
