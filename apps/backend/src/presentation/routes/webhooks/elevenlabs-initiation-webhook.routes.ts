import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import {
  ElevenLabsInitiationWebhookController,
  type ElevenLabsInitiationWebhookControllerDeps,
} from "../../controllers/elevenlabs-initiation-webhook.controller.js";
import type { RawBodyFastifyRequest } from "../../controllers/elevenlabs-webhook.controller.js";

export interface RegisterElevenLabsInitiationWebhookRoutesOptions {
  readonly deps: ElevenLabsInitiationWebhookControllerDeps;
}

export const registerElevenLabsInitiationWebhookRoutes: FastifyPluginAsync<
  RegisterElevenLabsInitiationWebhookRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterElevenLabsInitiationWebhookRoutesOptions,
): Promise<void> => {
  const controller = new ElevenLabsInitiationWebhookController(options.deps);

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    captureJsonRawBody,
  );

  app.post<{
    Body: unknown;
  }>("/", (req, reply) =>
    controller.handle(req as RawBodyFastifyRequest, reply),
  );
};

function captureJsonRawBody(
  req: FastifyRequest,
  body: string,
  done: (error: Error | null, value?: unknown) => void,
): void {
  (req as RawBodyFastifyRequest).rawBody = body;

  if (body.trim().length === 0) {
    done(null, {});
    return;
  }

  try {
    done(null, JSON.parse(body) as unknown);
  } catch (error) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
}
