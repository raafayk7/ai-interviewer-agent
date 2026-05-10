import { Result } from "@carbonteq/fp";

/**
 * Per-turn slice of an upstream candidate-audio iterator. Phase 4 only.
 */
export interface CandidateAudioTee {
  next(): AsyncIterable<Uint8Array>;
  endCurrent(): void;
  closeAll(): void;
}

interface PendingRead {
  readonly resolve: (value: IteratorResult<Uint8Array>) => void;
  readonly reject: (reason: Error) => void;
}

export function teeCandidateAudio(
  upstream: AsyncIterable<Uint8Array>,
): CandidateAudioTee {
  const iterator = upstream[Symbol.asyncIterator]();
  const queue: Uint8Array[] = [];
  const pendingReads: PendingRead[] = [];
  let upstreamDone = false;
  const upstreamErrors: Error[] = [];
  let sliceOpen = false;
  let allClosed = false;

  const finishPending = (): void => {
    const pending = pendingReads.shift();
    if (!pending) return;
    const upstreamError = upstreamErrors[0];
    if (upstreamError) {
      pending.reject(upstreamError);
      return;
    }
    pending.resolve({ value: undefined as never, done: true });
  };

  const pumpResult = Result.tryAsyncCatch(
    async () => {
      let nextFrame = await iterator.next();
      while (!nextFrame.done && !allClosed) {
        if (sliceOpen) {
          const pending = pendingReads.shift();
          if (pending) {
            pending.resolve({ value: nextFrame.value, done: false });
          } else {
            queue.push(nextFrame.value);
          }
        }
        nextFrame = await iterator.next();
      }
    },
    (err) => (err instanceof Error ? err : new Error(String(err))),
  ).toPromise();

  void pumpResult.then((result) => {
    if (result.isErr()) {
      upstreamErrors.push(result.unwrapErr());
    }
    upstreamDone = true;
    finishPending();
  });

  const endCurrent = (): void => {
    sliceOpen = false;
    queue.splice(0, queue.length);
    finishPending();
  };

  const closeAll = (): void => {
    allClosed = true;
    endCurrent();
    void Result.tryAsyncCatch(
      async () => {
        await iterator.return?.();
      },
      (err) => (err instanceof Error ? err : new Error(String(err))),
    ).toPromise();
  };

  const next = (): AsyncIterable<Uint8Array> => {
    sliceOpen = true;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (!sliceOpen || allClosed) {
              return { value: undefined as never, done: true };
            }
            const queued = queue.shift();
            if (queued) {
              return { value: queued, done: false };
            }
            const upstreamError = upstreamErrors[0];
            if (upstreamError) {
              return Promise.reject(upstreamError);
            }
            if (upstreamDone) {
              return { value: undefined as never, done: true };
            }
            return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              pendingReads.push({ resolve, reject });
            });
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            endCurrent();
            return { value: undefined as never, done: true };
          },
        };
      },
    };
  };

  return { next, endCurrent, closeAll };
}
