import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireRecruiter } from "../auth/auth-plugin.js";
import {
  RecruiterInterviewController,
  type RecruiterInterviewControllerDeps,
} from "../controllers/recruiter-interview.controller.js";

export interface RegisterRecruiterInterviewRoutesOptions {
  readonly deps: RecruiterInterviewControllerDeps;
}

export const registerRecruiterInterviewRoutes: FastifyPluginAsync<
  RegisterRecruiterInterviewRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterRecruiterInterviewRoutesOptions,
): Promise<void> => {
  const controller = new RecruiterInterviewController(options.deps);

  app.post<{ Body: unknown }>("/interviews", { preHandler: requireRecruiter }, (req, reply) =>
    controller.create(req, reply),
  );
  app.get("/interviews", { preHandler: requireRecruiter }, (req, reply) =>
    controller.list(req, reply),
  );
  app.get<{ Params: { id: string } }>(
    "/interviews/:id",
    { preHandler: requireRecruiter },
    (req, reply) => controller.get(req, reply),
  );
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/interviews/:id/plan",
    { preHandler: requireRecruiter },
    (req, reply) => controller.generatePlan(req, reply),
  );
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/candidate-link",
    { preHandler: requireRecruiter },
    (req, reply) => controller.issueCandidateLink(req, reply),
  );
  app.post<{ Params: { id: string } }>(
    "/interviews/:id/evaluate",
    { preHandler: requireRecruiter },
    (req, reply) => controller.evaluate(req, reply),
  );
  app.get<{ Params: { id: string } }>(
    "/interviews/:id/report",
    { preHandler: requireRecruiter },
    (req, reply) => controller.getReport(req, reply),
  );
};
