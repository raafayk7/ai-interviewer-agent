import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  ElevenLabsWebhookController,
  type ElevenLabsWebhookControllerDeps,
  type RawBodyFastifyRequest,
} from "../../controllers/elevenlabs-webhook.controller.js";

export interface RegisterElevenLabsWebhookRoutesOptions {
  readonly deps: ElevenLabsWebhookControllerDeps;
}

export const registerElevenLabsWebhookRoutes: FastifyPluginAsync<
  RegisterElevenLabsWebhookRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterElevenLabsWebhookRoutesOptions,
): Promise<void> => {
  const controller = new ElevenLabsWebhookController(options.deps);

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    captureJsonRawBody,
  );

  app.post<{ Body: unknown }>("/tools/next_question", (req, reply) =>
    controller.handleNextQuestion(req as RawBodyFastifyRequest, reply),
  );
  app.post<{ Body: unknown }>("/tools/score_answer", (req, reply) =>
    controller.handleScoreAnswer(req as RawBodyFastifyRequest, reply),
  );
  app.post<{ Body: unknown }>("/tools/take_note", (req, reply) =>
    controller.handleTakeNote(req as RawBodyFastifyRequest, reply),
  );
  app.post<{ Body: unknown }>("/post-call", (req, reply) =>
    controller.handlePostCall(req as RawBodyFastifyRequest, reply),
  );
};

function captureJsonRawBody(
  req: unknown,
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
