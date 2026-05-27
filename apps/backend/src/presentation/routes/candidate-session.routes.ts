import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  CandidateSessionController,
  type CandidateSessionControllerDeps,
} from "../controllers/candidate-session.controller.js";

export interface RegisterCandidateSessionRoutesOptions {
  readonly deps: CandidateSessionControllerDeps;
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
  }>("/interviews/:id/candidate-session", (req, reply) =>
    controller.start(req, reply),
  );
};
