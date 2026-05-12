import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "../utils/from-node-headers.js";

export interface BetterAuthHandlerLike {
  readonly handler: (request: Request) => Promise<Response>;
}

export async function mountBetterAuth(
  app: FastifyInstance,
  auth: BetterAuthHandlerLike,
): Promise<void> {
  app.all("/api/auth/*", async (req, reply) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const body =
      req.method === "GET" || req.method === "HEAD" || req.body === undefined
        ? undefined
        : JSON.stringify(req.body);
    const request = new Request(url, {
      method: req.method,
      headers: fromNodeHeaders(req.headers),
      body,
    });

    const response = await auth.handler(request);
    reply.code(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    await reply.send(response.body ? await response.text() : null);
  });
}
