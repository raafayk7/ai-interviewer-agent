import { describe, expect, it } from "vitest";
import { createCandidateAudioTurnGate } from "./candidate-audio-turn-gate.js";

const frame = (value: number): Uint8Array => Uint8Array.from([value]);

async function* frames(values: number[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield frame(value);
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("createCandidateAudioTurnGate", () => {
  it("nextTurn returns frames while a candidate turn is open", async () => {
    const gate = createCandidateAudioTurnGate(frames([1, 2]));
    const iterator = gate.nextTurn()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: frame(1),
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({
      value: frame(2),
      done: false,
    });

    gate.close();
  });

  it("drops frames received while no candidate turn is open", async () => {
    const gate = createCandidateAudioTurnGate(frames([1, 2]));

    await flushMicrotasks();
    const iterator = gate.nextTurn()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });

    gate.close();
  });

  it("endTurn terminates a pending turn reader", async () => {
    const gate = createCandidateAudioTurnGate({
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
        };
      },
    });
    const iterator = gate.nextTurn()[Symbol.asyncIterator]();
    const pending = iterator.next();

    gate.endTurn();

    await expect(pending).resolves.toEqual({
      value: undefined,
      done: true,
    });

    gate.close();
  });

  it("close terminates a pending turn reader", async () => {
    const gate = createCandidateAudioTurnGate({
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
          return() {
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    });
    const iterator = gate.nextTurn()[Symbol.asyncIterator]();
    const pending = iterator.next();

    gate.close();

    await expect(pending).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });
});
