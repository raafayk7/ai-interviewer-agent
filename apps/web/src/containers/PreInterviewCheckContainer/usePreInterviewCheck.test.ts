import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMicCheckStore } from "@/stores/useMicCheckStore";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";
import { usePreInterviewCheck, STEPS } from "./usePreInterviewCheck";

// ---------------------------------------------------------------------------
// Helpers — minimal fakes
// ---------------------------------------------------------------------------

function makeFakeTrack(): { stop: ReturnType<typeof vi.fn> } {
  return { stop: vi.fn() };
}

function makeFakeStream(tracks = [makeFakeTrack()]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
}

function makeFakeAnalyser(frequencyBinCount = 512) {
  return {
    fftSize: 1024,
    frequencyBinCount,
    getByteTimeDomainData: vi.fn(),
    connect: vi.fn(),
  };
}

function makeFakeSource() {
  return { connect: vi.fn() };
}

function makeFakeAudioContext(sampleRate = 16000) {
  const analyser = makeFakeAnalyser();
  const source = makeFakeSource();
  return {
    sampleRate,
    createMediaStreamSource: vi.fn().mockReturnValue(source),
    createAnalyser: vi.fn().mockReturnValue(analyser),
    close: vi.fn().mockResolvedValue(undefined),
    _analyser: analyser,
    _source: source,
  };
}

// ---------------------------------------------------------------------------
// Module-level setup
// ---------------------------------------------------------------------------

const mockGetUserMedia = vi.fn();
let defaultFakeAudioCtx: ReturnType<typeof makeFakeAudioContext>;

beforeEach(() => {
  // Reset stores
  useMicCheckStore.getState().reset();
  useInterviewSessionStore.getState().reset();

  // Default AudioContext stub — individual tests can override with vi.stubGlobal
  defaultFakeAudioCtx = makeFakeAudioContext(16000);
  vi.stubGlobal(
    "AudioContext",
    vi.fn().mockImplementation(() => defaultFakeAudioCtx),
  );

  // Stub navigator.mediaDevices — jsdom may not expose it
  // Use Object.defineProperty so production code's navigator.mediaDevices works
  mockGetUserMedia.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });

  // Default: resolve with a valid stream
  const defaultTrack = { stop: vi.fn() };
  const defaultStream = {
    getTracks: () => [defaultTrack],
    getAudioTracks: () => [defaultTrack],
  } as unknown as MediaStream;
  mockGetUserMedia.mockResolvedValue(defaultStream);

  // Stub requestAnimationFrame — do NOT call the callback synchronously; that
  // causes infinite recursion because `tick()` calls rAF again. Just capture
  // the call and return a fake id so the source code can call
  // cancelAnimationFrame with a truthy value.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn().mockReturnValue(42),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — initial state", () => {
  it("starts on mic step with stepIndex 0 and totalSteps 4", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    expect(result.current.step).toBe("mic");
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.totalSteps).toBe(STEPS.length);
    expect(result.current.totalSteps).toBe(4);
  });

  it("starts with permission idle", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    expect(result.current.permission).toBe("idle");
  });

  it("starts with audioTestState idle", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    expect(result.current.audioTestState).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// requestMic — success path
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — requestMic success", () => {
  it("sets permission to granted after getUserMedia resolves", async () => {
    // Uses the default mocks from beforeEach (16kHz context, valid stream)
    const { result, unmount } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      await result.current.requestMic();
    });

    expect(result.current.permission).toBe("granted");
    unmount(); // ensure React cleanup runs before afterEach vi.restoreAllMocks()
  });

  it("calls createMediaStreamSource and createAnalyser on the AudioContext", async () => {
    const fakeStream = makeFakeStream();
    mockGetUserMedia.mockResolvedValue(fakeStream);

    const { result, unmount } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      await result.current.requestMic();
    });

    expect(defaultFakeAudioCtx.createMediaStreamSource).toHaveBeenCalledWith(
      fakeStream,
    );
    expect(defaultFakeAudioCtx.createAnalyser).toHaveBeenCalledTimes(1);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// requestMic — denial
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — requestMic denied", () => {
  it("sets permission to denied when getUserMedia rejects", async () => {
    // Override the default (which resolves) to reject
    mockGetUserMedia.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      await result.current.requestMic();
    });

    expect(result.current.permission).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// AudioContext sample-rate warning
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — AudioContext sample-rate warning", () => {
  it("calls console.warn when AudioContext returns sampleRate !== 16000", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Override default AudioContext with one that returns 48kHz
    const fakeCtx48k = makeFakeAudioContext(48000);
    vi.stubGlobal(
      "AudioContext",
      vi.fn().mockImplementation(() => fakeCtx48k),
    );

    const { result, unmount } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      await result.current.requestMic();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("48000"),
    );
    unmount(); // ensure React cleanup runs before afterEach vi.restoreAllMocks()
  });
});

// ---------------------------------------------------------------------------
// next() and prev() navigation
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — next and prev navigation", () => {
  it("next() advances from mic to audio", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    act(() => result.current.next());
    expect(result.current.step).toBe("audio");
    expect(result.current.stepIndex).toBe(1);
  });

  it("next() advances through all 4 steps", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    act(() => result.current.next()); // audio
    act(() => result.current.next()); // quiet
    act(() => result.current.next()); // ready
    expect(result.current.step).toBe("ready");
    expect(result.current.stepIndex).toBe(3);
  });

  it("next() does not go beyond the last step", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next()); // extra call — should stay at 3
    expect(result.current.stepIndex).toBe(3);
  });

  it("prev() goes back from audio to mic", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.step).toBe("mic");
    expect(result.current.stepIndex).toBe(0);
  });

  it("prev() does not go below the first step", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    act(() => result.current.prev()); // should stay at 0
    expect(result.current.stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// playSample — idle initial state
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — playSample initial state", () => {
  it("audioTestState starts as idle", () => {
    const { result } = renderHook(() => usePreInterviewCheck());
    expect(result.current.audioTestState).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// playSample — playing transition
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — playSample transitions to playing", () => {
  it("sets audioTestState to playing after playSample() is called", async () => {
    let endedListener: (() => void) | null = null;
    const fakeAudio = {
      addEventListener: vi.fn().mockImplementation((event: string, handler: () => void) => {
        if (event === "ended") endedListener = handler;
      }),
      play: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
      currentTime: 0,
    };

    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => fakeAudio),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    act(() => result.current.playSample());

    expect(result.current.audioTestState).toBe("playing");

    // Suppress the unused variable warning — endedListener is captured for
    // the "ended" test below but captured here so the mock works.
    void endedListener;
  });
});

// ---------------------------------------------------------------------------
// playSample — play() rejection
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — playSample browser-unsupported on play rejection", () => {
  it("sets audioTestState to browser-unsupported when play() rejects", async () => {
    const fakeAudio = {
      addEventListener: vi.fn(),
      play: vi.fn().mockRejectedValue(new DOMException("Not allowed")),
      currentTime: 0,
    };

    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => fakeAudio),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      result.current.playSample();
      // give the rejected promise a tick to settle
      await Promise.resolve();
    });

    expect(result.current.audioTestState).toBe("browser-unsupported");
  });
});

// ---------------------------------------------------------------------------
// playSample — "ended" event
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — playSample transitions to played on ended", () => {
  it("sets audioTestState to played when the ended event fires", async () => {
    let endedCallback: (() => void) | undefined;
    const fakeAudio = {
      addEventListener: vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === "ended") endedCallback = cb;
      }),
      play: vi.fn().mockResolvedValue(undefined),
      currentTime: 1, // non-zero so the 3s timeout branch does not fire
    };

    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => fakeAudio),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      result.current.playSample();
      await Promise.resolve();
    });

    // Simulate "ended" event
    act(() => {
      endedCallback?.();
    });

    expect(result.current.audioTestState).toBe("played");
  });
});

// ---------------------------------------------------------------------------
// playSample — 3-second timeout with fake timers
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — playSample 3s timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions to browser-unsupported after 3s when currentTime stays at 0", async () => {
    const fakeAudio = {
      addEventListener: vi.fn(),
      play: vi.fn().mockReturnValue(new Promise(() => {})), // stuck
      currentTime: 0, // never advanced
    };

    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => fakeAudio),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    act(() => result.current.playSample());
    expect(result.current.audioTestState).toBe("playing");

    // Advance 3 seconds
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.audioTestState).toBe("browser-unsupported");
  });

  it("does NOT transition to browser-unsupported when currentTime > 0 after 3s", async () => {
    const fakeAudio = {
      addEventListener: vi.fn(),
      play: vi.fn().mockReturnValue(new Promise(() => {})), // stuck
      currentTime: 0.5, // audio is playing
    };

    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => fakeAudio),
    );

    const { result } = renderHook(() => usePreInterviewCheck());

    act(() => result.current.playSample());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // Should remain "playing" (or any other non-unsupported state)
    expect(result.current.audioTestState).not.toBe("browser-unsupported");
  });
});

// ---------------------------------------------------------------------------
// Cleanup on unmount
// ---------------------------------------------------------------------------

describe("[Integration] usePreInterviewCheck — cleanup on unmount", () => {
  it("cancels the rAF, closes AudioContext, stops tracks, and resets store on unmount", async () => {
    const track = makeFakeTrack();
    const fakeStream = makeFakeStream([track]);

    // Override default stream so we can check track.stop()
    mockGetUserMedia.mockResolvedValue(fakeStream);

    const { result, unmount } = renderHook(() => usePreInterviewCheck());

    await act(async () => {
      await result.current.requestMic();
    });

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(defaultFakeAudioCtx.close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    // Store should be reset
    expect(useMicCheckStore.getState().permission).toBe("idle");
  });
});
