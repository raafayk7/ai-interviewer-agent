import { describe, expect, it } from "vitest";
import { AsyncQueue } from "./async-queue.js";

describe("AsyncQueue", () => {
  it("yields pushed values in order", async () => {
    const queue = new AsyncQueue<Uint8Array>();
    queue.push(new Uint8Array([1]));
    queue.push(new Uint8Array([2]));
    queue.close();

    const values: number[] = [];
    for await (const value of queue) {
      values.push(value[0]!);
    }

    expect(values).toEqual([1, 2]);
  });

  it("resolves a pending reader when closed", async () => {
    const queue = new AsyncQueue<Uint8Array>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();

    queue.close();

    await expect(pending).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });
});
