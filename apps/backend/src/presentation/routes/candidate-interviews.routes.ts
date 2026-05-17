import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  CandidateInterviewController,
  type CandidateInterviewControllerDeps,
} from "../controllers/candidate-interview.controller.js";

export interface RegisterCandidateInterviewRoutesOptions {
  readonly deps: CandidateInterviewControllerDeps;
}

export const registerCandidateInterviewRoutes: FastifyPluginAsync<
  RegisterCandidateInterviewRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterCandidateInterviewRoutesOptions,
): Promise<void> => {
  const controller = new CandidateInterviewController(options.deps);

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/interviews/:id/candidate-view",
    (req, reply) => controller.getView(req, reply),
  );
};
