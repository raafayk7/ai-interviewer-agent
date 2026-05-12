import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireRecruiter } from "../auth/auth-plugin.js";
import {
  RecruiterDocumentController,
  type RecruiterDocumentControllerDeps,
} from "../controllers/recruiter-document.controller.js";

export interface RegisterRecruiterDocumentRoutesOptions {
  readonly deps: RecruiterDocumentControllerDeps;
}

export const registerRecruiterDocumentRoutes: FastifyPluginAsync<
  RegisterRecruiterDocumentRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterRecruiterDocumentRoutesOptions,
): Promise<void> => {
  const controller = new RecruiterDocumentController(options.deps);

  app.post("/documents/upload", { preHandler: requireRecruiter }, (req, reply) =>
    controller.upload(req, reply),
  );
  app.post<{ Body: unknown }>(
    "/documents/extract",
    { preHandler: requireRecruiter },
    (req, reply) => controller.extract(req, reply),
  );
};
