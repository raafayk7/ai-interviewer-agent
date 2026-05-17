import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlaybackQueue } from "./audio-playback-queue";

// ---------------------------------------------------------------------------
// Minimal stubs for browser APIs not available in jsdom
// ---------------------------------------------------------------------------

/**
 * A minimal SourceBuffer stub that lets tests control `updating` and manually
 * fire `updateend` events.
 */
class MockSourceBuffer extends EventTarget {
  updating = false;
  appendedChunks: Uint8Array[] = [];

  appendBuffer(chunk: Uint8Array): void {
    this.appendedChunks.push(chunk);
  }

  /** Test helper — simulates the browser signalling that a buffer update ended. */
  triggerUpdateEnd(): void {
    this.dispatchEvent(new Event("updateend"));
  }
}

/**
 * A minimal MediaSource stub that lets tests fire `sourceopen` manually.
 */
class MockMediaSource extends EventTarget {
  sourceBuffer: MockSourceBuffer | null = null;

  addSourceBuffer(): MockSourceBuffer {
    this.sourceBuffer = new MockSourceBuffer();
    return this.sourceBuffer;
  }

  /** Test helper — simulates the browser signalling that the source is open. */
  triggerSourceOpen(): void {
    this.dispatchEvent(new Event("sourceopen"));
  }
}

/**
 * Minimal HTMLAudioElement stub.
 */
class MockAudio extends EventTarget {
  autoplay = false;
  src = "";
  pause(): void {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Per-test instances and stubs
// ---------------------------------------------------------------------------

let mockMediaSource: MockMediaSource;
let mockAudioEl: MockAudio;
let createObjectURLSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockMediaSource = new MockMediaSource();
  mockAudioEl = new MockAudio();
  createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url");

  // Stub the browser globals the class uses in its constructor
  vi.stubGlobal("MediaSource", vi.fn(() => mockMediaSource));
  vi.stubGlobal("Audio", vi.fn(() => mockAudioEl));
  vi.stubGlobal("URL", { createObjectURL: createObjectURLSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AudioPlaybackQueue tests
// ---------------------------------------------------------------------------

describe("AudioPlaybackQueue — constructor", () => {
  it("constructs without throwing", () => {
    expect(() => new AudioPlaybackQueue()).not.toThrow();
  });

  it("creates a MediaSource and sets the audio element src via createObjectURL", () => {
    new AudioPlaybackQueue();
    expect(createObjectURLSpy).toHaveBeenCalledWith(mockMediaSource);
    expect(mockAudioEl.src).toBe("blob:mock-url");
  });

  it("starts with an empty pending queue (pendingLength === 0)", () => {
    const queue = new AudioPlaybackQueue();
    expect(queue.pendingLength).toBe(0);
  });
});

describe("AudioPlaybackQueue — enqueue before sourceopen", () => {
  it("adds to pending when sourceopen has not fired yet", () => {
    const queue = new AudioPlaybackQueue();
    queue.enqueue(new Uint8Array([1, 2, 3]));
    expect(queue.pendingLength).toBe(1);
  });

  it("accumulates multiple chunks in pending before sourceopen fires", () => {
    const queue = new AudioPlaybackQueue();
    queue.enqueue(new Uint8Array([1]));
    queue.enqueue(new Uint8Array([2]));
    queue.enqueue(new Uint8Array([3]));
    expect(queue.pendingLength).toBe(3);
  });

  it("does not call appendBuffer before sourceopen", () => {
    const queue = new AudioPlaybackQueue();
    queue.enqueue(new Uint8Array([1, 2, 3]));
    // No sourceBuffer exists yet, so appendBuffer should never have been called
    expect(mockMediaSource.sourceBuffer).toBeNull();
  });
});

describe("AudioPlaybackQueue — draining after sourceopen", () => {
  it("calls addSourceBuffer when sourceopen fires", () => {
    new AudioPlaybackQueue();
    const addSourceBufferSpy = vi.spyOn(mockMediaSource, "addSourceBuffer");
    mockMediaSource.triggerSourceOpen();
    expect(addSourceBufferSpy).toHaveBeenCalledWith("audio/mpeg");
  });

  it("drains a pending chunk into appendBuffer when sourceopen fires", () => {
    const queue = new AudioPlaybackQueue();
    const chunk = new Uint8Array([10, 20, 30]);
    queue.enqueue(chunk);

    // Fire sourceopen — should drain the pending chunk immediately
    mockMediaSource.triggerSourceOpen();

    expect(mockMediaSource.sourceBuffer).not.toBeNull();
    expect(mockMediaSource.sourceBuffer!.appendedChunks).toHaveLength(1);
    expect(mockMediaSource.sourceBuffer!.appendedChunks[0]).toEqual(chunk);
    // Pending queue is now drained
    expect(queue.pendingLength).toBe(0);
  });

  it("drains chunks on updateend after the first chunk", () => {
    const queue = new AudioPlaybackQueue();
    const chunk1 = new Uint8Array([1]);
    const chunk2 = new Uint8Array([2]);
    queue.enqueue(chunk1);
    queue.enqueue(chunk2);

    // sourceopen fires — first chunk is drained immediately
    mockMediaSource.triggerSourceOpen();
    expect(mockMediaSource.sourceBuffer!.appendedChunks).toHaveLength(1);
    expect(queue.pendingLength).toBe(1);

    // Simulate buffer finishing the first chunk
    mockMediaSource.sourceBuffer!.triggerUpdateEnd();

    // Second chunk should now be drained
    expect(mockMediaSource.sourceBuffer!.appendedChunks).toHaveLength(2);
    expect(queue.pendingLength).toBe(0);
  });

  it("does not call appendBuffer while sourceBuffer.updating is true", () => {
    const queue = new AudioPlaybackQueue();
    mockMediaSource.triggerSourceOpen();

    const sb = mockMediaSource.sourceBuffer!;
    sb.updating = true; // Simulate a buffer that is currently writing

    queue.enqueue(new Uint8Array([99]));

    // drain() checks updating === true and bails out
    expect(sb.appendedChunks).toHaveLength(0);
    expect(queue.pendingLength).toBe(1);
  });

  it("resumes draining once updating flips back to false via updateend", () => {
    const queue = new AudioPlaybackQueue();
    mockMediaSource.triggerSourceOpen();

    const sb = mockMediaSource.sourceBuffer!;
    sb.updating = true;
    queue.enqueue(new Uint8Array([42]));
    expect(sb.appendedChunks).toHaveLength(0);

    // Simulate the update completing
    sb.updating = false;
    sb.triggerUpdateEnd();

    expect(sb.appendedChunks).toHaveLength(1);
    expect(queue.pendingLength).toBe(0);
  });
});

describe("AudioPlaybackQueue — dispose", () => {
  it("does not throw when disposed", () => {
    const queue = new AudioPlaybackQueue();
    expect(() => queue.dispose()).not.toThrow();
  });

  it("pauses and clears the audio element src on dispose", () => {
    const pauseSpy = vi.spyOn(mockAudioEl, "pause");
    const queue = new AudioPlaybackQueue();
    queue.dispose();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(mockAudioEl.src).toBe("");
  });

  it("makes subsequent enqueue calls no-ops (pendingLength unchanged)", () => {
    const queue = new AudioPlaybackQueue();
    queue.dispose();
    const lengthBefore = queue.pendingLength;
    queue.enqueue(new Uint8Array([1, 2, 3]));
    expect(queue.pendingLength).toBe(lengthBefore);
  });

  it("does not call appendBuffer after dispose even if sourceopen fires", () => {
    const queue = new AudioPlaybackQueue();
    queue.dispose();
    mockMediaSource.triggerSourceOpen();
    // sourceBuffer was never added because disposed flag bails out early
    expect(mockMediaSource.sourceBuffer).toBeNull();
  });
});
