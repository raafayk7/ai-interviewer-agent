import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { buildInterviewSessionDeps } from "./composition/interview-session.composition.js";
import {
  registerInterviewSessionRoutes,
  type RegisterInterviewSessionRouteOptions,
} from "./presentation/routes/interview-session.ws.js";

export interface BuildAppOptions {
  readonly interviewSession?: RegisterInterviewSessionRouteOptions;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  await app.register(registerInterviewSessionRoutes, {
    prefix: "/interviews",
    deps: options.interviewSession?.deps ?? buildInterviewSessionDeps(),
    ...options.interviewSession,
  });

  return app;
}
