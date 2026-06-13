import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  CandidateSessionController,
  type CandidateSessionControllerDeps,
} from "../controllers/candidate-session.controller.js";
import type { RouteRateLimit } from "../rate-limit/rate-limit.js";

export interface RegisterCandidateSessionRoutesOptions {
  readonly deps: CandidateSessionControllerDeps;
  /** Per-IP throttle (ADR-037): this mint can start a paid ElevenLabs conversation. */
  readonly rateLimit?: RouteRateLimit;
}

export const registerCandidateSessionRoutes: FastifyPluginAsync<
  RegisterCandidateSessionRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterCandidateSessionRoutesOptions,
): Promise<void> => {
  const controller = new CandidateSessionController(options.deps);

  app.post<{
    Params: { id: string };
    Querystring: { token?: string };
  }>(
    "/interviews/:id/candidate-session",
    options.rateLimit ? { config: { rateLimit: options.rateLimit } } : {},
    (req, reply) => controller.start(req, reply),
  );
};
