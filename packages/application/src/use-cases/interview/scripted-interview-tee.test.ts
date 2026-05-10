import { describe, expect, it } from "vitest";
import { teeCandidateAudio } from "./scripted-interview-tee.js";

const frame = (value: number): Uint8Array => Uint8Array.from([value]);

async function* frames(values: number[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield frame(value);
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("teeCandidateAudio", () => {
  it("next() returns a slice that yields upstream frames", async () => {
    const tee = teeCandidateAudio(frames([1, 2]));
    const iterator = tee.next()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: frame(1),
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({
      value: frame(2),
      done: false,
    });
  });

  it("endCurrent() terminates a pending slice", async () => {
    const tee = teeCandidateAudio({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
        };
      },
    });
    const iterator = tee.next()[Symbol.asyncIterator]();
    const pending = iterator.next();

    tee.endCurrent();

    await expect(pending).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it("drops frames while no slice is open", async () => {
    const tee = teeCandidateAudio(frames([1, 2]));

    await flushMicrotasks();
    const iterator = tee.next()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it("closeAll() terminates a pending reader", async () => {
    const tee = teeCandidateAudio({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
          async return() {
            return { value: undefined as never, done: true };
          },
        };
      },
    });
    const iterator = tee.next()[Symbol.asyncIterator]();
    const pending = iterator.next();

    tee.closeAll();

    await expect(pending).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });
});
