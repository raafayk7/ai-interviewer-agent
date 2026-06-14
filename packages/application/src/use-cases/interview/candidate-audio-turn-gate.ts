import { Result } from "@carbonteq/fp";

interface PendingRead {
  readonly resolve: (value: IteratorResult<Uint8Array>) => void;
  readonly reject: (reason: Error) => void;
}

export interface CandidateAudioTurnGate {
  nextTurn(): AsyncIterable<Uint8Array>;
  endTurn(): void;
  close(): void;
}

export function createCandidateAudioTurnGate(
  upstream: AsyncIterable<Uint8Array>,
): CandidateAudioTurnGate {
  const iterator = upstream[Symbol.asyncIterator]();
  const queue: Uint8Array[] = [];
  const pendingReads: PendingRead[] = [];
  const upstreamErrors: Error[] = [];
  let upstreamDone = false;
  let turnOpen = false;
  let closed = false;

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
      while (!nextFrame.done && !closed) {
        if (turnOpen) {
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

  const endTurn = (): void => {
    turnOpen = false;
    queue.splice(0, queue.length);
    finishPending();
  };

  const close = (): void => {
    closed = true;
    endTurn();
    void Result.tryAsyncCatch(
      async () => {
        await iterator.return?.();
      },
      (err) => (err instanceof Error ? err : new Error(String(err))),
    ).toPromise();
  };

  const nextTurn = (): AsyncIterable<Uint8Array> => {
    turnOpen = true;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          next(): Promise<IteratorResult<Uint8Array>> {
            if (!turnOpen || closed) {
              return Promise.resolve({ value: undefined as never, done: true });
            }

            const queued = queue.shift();
            if (queued) {
              return Promise.resolve({ value: queued, done: false });
            }

            const upstreamError = upstreamErrors[0];
            if (upstreamError) {
              return Promise.reject(upstreamError);
            }

            if (upstreamDone) {
              return Promise.resolve({ value: undefined as never, done: true });
            }

            return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
              pendingReads.push({ resolve, reject });
            });
          },
          return(): Promise<IteratorResult<Uint8Array>> {
            endTurn();
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    };
  };

  return { nextTurn, endTurn, close };
}
