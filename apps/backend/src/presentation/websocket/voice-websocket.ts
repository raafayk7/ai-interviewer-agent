import type { WebSocket } from "@fastify/websocket";
import { AsyncQueue } from "./async-queue.js";

type RawWebSocketData = Buffer | ArrayBuffer | Buffer[];

export function wsBinaryToAsyncIterable(ws: WebSocket, abort: AbortSignal): AsyncIterable<Uint8Array> {
  const queue = new AsyncQueue<Uint8Array>();
  const close = (): void => queue.close();

  ws.on("message", (data: RawWebSocketData, isBinary: boolean) => {
    if (!isBinary) return;
    queue.push(toUint8Array(data));
  });

  ws.on("close", close);
  ws.on("error", close);
  abort.addEventListener("abort", close, { once: true });

  return queue;
}

export async function sendBinaryFrame(ws: WebSocket, chunk: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.send(chunk, { binary: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function toUint8Array(data: RawWebSocketData): Uint8Array {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
