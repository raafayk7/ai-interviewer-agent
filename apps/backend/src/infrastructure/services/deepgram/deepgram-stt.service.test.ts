import { SttStreamError, SttUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramSpeechToTextService } from "./deepgram-stt.service.js";
import type { DeepgramClientHandle } from "./provider.js";

type HandlerName = "message" | "error" | "close";

class FakeDeepgramSocket {
  readonly handlers: Partial<Record<HandlerName, (value?: unknown) => void>> = {};
  readonly sentMedia: Uint8Array[] = [];
  readonly sendCloseStream = vi.fn();
  readonly close = vi.fn();
  readonly connect = vi.fn(() => this);
  readonly waitForOpen = vi.fn(async () => ({}));

  on(event: HandlerName, handler: (value?: unknown) => void): void {
    this.handlers[event] = handler;
  }

  sendMedia(frame: Uint8Array): void {
    this.sentMedia.push(frame);
  }

  emit(event: HandlerName, value?: unknown): void {
    this.handlers[event]?.(value);
  }
}

const frames = async function* (items: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const item of items) {
    yield item;
  }
};

const transcriptMessage = (text: string, isFinal = true) => ({
  type: "Results",
  is_final: isFinal,
  channel: {
    alternatives: [{ transcript: text, confidence: 0.87, words: [] }],
  },
});

const createHandle = (socket: FakeDeepgramSocket, connect = vi.fn(async () => socket)): DeepgramClientHandle => ({
  client: {
    listen: {
      v1: {
        connect,
      },
    },
  } as unknown as DeepgramClientHandle["client"],
  apiKey: "dg-key",
  defaultModel: "nova-3",
  defaultLanguage: "en-US",
  defaultSampleRate: 16000,
  defaultEncoding: "linear16",
});

describe("DeepgramSpeechToTextService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a Deepgram v1 socket, sends audio frames, and yields transcript chunks", async () => {
    const socket = new FakeDeepgramSocket();
    const connect = vi.fn(async () => socket);
    const service = new DeepgramSpeechToTextService(createHandle(socket, connect));

    const result = await service.transcribe(frames([new Uint8Array([1, 2])]), {
      interviewId: "interview-1",
      turnIndex: 2,
    });

    expect(result.isOk()).toBe(true);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        Authorization: "Token dg-key",
        model: "nova-3",
        language: "en-US",
        sample_rate: 16000,
        encoding: "linear16",
        smart_format: "true",
        interim_results: "true",
      }),
    );
    expect(socket.connect).toHaveBeenCalled();
    expect(socket.waitForOpen).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(socket.sentMedia).toHaveLength(1);
    });

    const iterator = result.unwrap()[Symbol.asyncIterator]();
    socket.emit("message", transcriptMessage("hello there"));

    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        text: "hello there",
        isFinal: true,
        confidence: 0.87,
      },
      done: false,
    });

    socket.emit("close");
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("maps auth-like setup failures to SttUnavailableError", async () => {
    const socket = new FakeDeepgramSocket();
    const service = new DeepgramSpeechToTextService(
      createHandle(socket, vi.fn(async () => Promise.reject(new Error("401 unauthorized")))),
    );

    const result = await service.transcribe(frames([]), {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(SttUnavailableError);
  });

  it("surfaces unknown setup failures as stream errors", async () => {
    const socket = new FakeDeepgramSocket();
    const service = new DeepgramSpeechToTextService(
      createHandle(socket, vi.fn(async () => Promise.reject(new Error("invalid model")))),
    );

    const result = await service.transcribe(frames([]), {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(SttStreamError);
  });

  it("throws mid-stream socket errors from the iterator", async () => {
    const socket = new FakeDeepgramSocket();
    const service = new DeepgramSpeechToTextService(createHandle(socket));
    const result = await service.transcribe(frames([]), {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isOk()).toBe(true);
    const iterator = result.unwrap()[Symbol.asyncIterator]();
    const pending = iterator.next();

    socket.emit("error", new Error("socket dropped"));

    await expect(pending).rejects.toThrow("socket dropped");
  });

  it("ignores malformed transcript messages", async () => {
    const socket = new FakeDeepgramSocket();
    const service = new DeepgramSpeechToTextService(createHandle(socket));
    const result = await service.transcribe(frames([]), {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isOk()).toBe(true);
    const iterator = result.unwrap()[Symbol.asyncIterator]();
    socket.emit("message", { type: "Metadata" });
    socket.emit("close");

    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
