import type { FastifyInstance } from "fastify";
import type { Result } from "@carbonteq/fp";
import type { ServiceError } from "@repo/application";
import type { InterviewSessionDeps } from "../controllers/interview-session.controller.js";
import {
  InterviewSessionController,
  WS_CLOSE,
} from "../controllers/interview-session.controller.js";

export interface CandidateLinkVerifier {
  verify(token: string): Result<{ readonly interviewId: string }, ServiceError>;
}

export interface RegisterInterviewSessionRouteOptions {
  readonly deps: InterviewSessionDeps;
  readonly candidateLink?: CandidateLinkVerifier;
}

export async function registerInterviewSessionRoutes(
  app: FastifyInstance,
  options: RegisterInterviewSessionRouteOptions,
): Promise<void> {
  const controller = new InterviewSessionController(options.deps);

  // Phase 5: real Gemini agent driven via ConductInterviewUseCase.
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/:id/session",
    { websocket: true },
    async (socket, req) => {
      if (options.candidateLink) {
        const token = req.query.token;
        if (!token) {
          socket.close(WS_CLOSE.POLICY_VIOLATION, "missing token");
          return;
        }

        const verifyResult = options.candidateLink.verify(token);
        if (verifyResult.isErr()) {
          socket.close(WS_CLOSE.POLICY_VIOLATION, "invalid token");
          return;
        }

        if (verifyResult.unwrap().interviewId !== req.params.id) {
          socket.close(WS_CLOSE.POLICY_VIOLATION, "token mismatch");
          return;
        }
      }

      await controller.handle(socket, req);
    },
  );
}
