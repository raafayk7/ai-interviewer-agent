import type { FastifyInstance } from "fastify";
import type { InterviewSessionDeps } from "../controllers/interview-session.controller.js";
import { InterviewSessionController } from "../controllers/interview-session.controller.js";

export interface RegisterInterviewSessionRouteOptions {
  readonly deps: InterviewSessionDeps;
}

export async function registerInterviewSessionRoutes(
  app: FastifyInstance,
  options: RegisterInterviewSessionRouteOptions,
): Promise<void> {
  const controller = new InterviewSessionController(options.deps);

  // Phase 5: real Gemini agent driven via ConductInterviewUseCase.
  app.get("/:id/session", { websocket: true }, async (socket, req) => {
    await controller.handle(socket, req);
  });
}
