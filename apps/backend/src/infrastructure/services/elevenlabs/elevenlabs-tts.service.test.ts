import { TtsStreamError, TtsUnavailableError } from "@repo/application";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsTextToSpeechService } from "./elevenlabs-tts.service.js";
import type { ElevenLabsClientHandle } from "./provider.js";

const chunks = async function* (items: Array<Uint8Array | Buffer>): AsyncIterable<Uint8Array | Buffer> {
  for (const item of items) {
    yield item;
  }
};

const failingChunks = async function* (): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1]);
  throw new Error("stream failed");
};

const createHandle = (convertAsStream = vi.fn()): ElevenLabsClientHandle => ({
  client: {
    textToSpeech: {
      convertAsStream,
    },
  } as unknown as ElevenLabsClientHandle["client"],
  defaultVoiceId: "voice-1",
  defaultModelId: "model-1",
  defaultOutputFormat: "mp3_44100_128",
});

describe("ElevenLabsTextToSpeechService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts text to an async iterable of Uint8Array audio chunks", async () => {
    const convertAsStream = vi.fn(async () => chunks([Buffer.from([1, 2]), new Uint8Array([3])]));
    const service = new ElevenLabsTextToSpeechService(createHandle(convertAsStream));

    const result = await service.synthesize("Hello", {
      interviewId: "interview-1",
      turnIndex: 1,
    });

    expect(result.isOk()).toBe(true);
    expect(convertAsStream).toHaveBeenCalledWith("voice-1", {
      text: "Hello",
      model_id: "model-1",
      output_format: "mp3_44100_128",
    });

    const out: number[] = [];
    for await (const chunk of result.unwrap()) {
      out.push(...chunk);
    }

    expect(out).toEqual([1, 2, 3]);
  });

  it("maps auth-like setup errors to TtsUnavailableError", async () => {
    const service = new ElevenLabsTextToSpeechService(
      createHandle(vi.fn(async () => Promise.reject(new Error("403 forbidden")))),
    );

    const result = await service.synthesize("Hello", {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(TtsUnavailableError);
  });

  it("throws mid-stream errors from the iterator", async () => {
    const service = new ElevenLabsTextToSpeechService(createHandle(vi.fn(async () => failingChunks())));

    const result = await service.synthesize("Hello", {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isOk()).toBe(true);
    const iterator = result.unwrap()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).rejects.toThrow("stream failed");
  });

  it("rejects blank text before opening a provider stream", async () => {
    const convertAsStream = vi.fn();
    const service = new ElevenLabsTextToSpeechService(createHandle(convertAsStream));

    const result = await service.synthesize("  ", {
      interviewId: "interview-1",
      turnIndex: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(TtsStreamError);
    expect(convertAsStream).not.toHaveBeenCalled();
  });
});
