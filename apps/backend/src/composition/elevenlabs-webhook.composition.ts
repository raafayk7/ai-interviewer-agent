import { createRequire } from "node:module";
import { Option, Result } from "@carbonteq/fp";
import {
  EndInterviewFromAgentUseCase,
  PersistCompletedTranscriptUseCase,
  RecordAgentNoteUseCase,
  RecordInternalScoreUseCase,
  ServiceUnknownError,
  StartInterviewFromWebhookUseCase,
} from "@repo/application";
import {
  elevenLabsWebhookVerifierFromEnv,
} from "../infrastructure/auth/elevenlabs-webhook-verifier.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
import {
  conversationalClientFromEnv,
} from "../infrastructure/services/elevenlabs/conversational-provider.js";
import {
  ElevenLabsConversationalService,
} from "../infrastructure/services/elevenlabs/elevenlabs-conversational.service.js";
import type {
  InterviewIdLike,
  ElevenLabsWebhookControllerDeps,
} from "../presentation/controllers/elevenlabs-webhook.controller.js";

const require = createRequire(import.meta.url);

export interface ElevenLabsWebhookCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildElevenLabsWebhookDeps(
  options: ElevenLabsWebhookCompositionOptions = {},
): ElevenLabsWebhookControllerDeps {
  const env = options.env ?? process.env;
  const verifierResult = elevenLabsWebhookVerifierFromEnv(env);
  if (verifierResult.isErr()) {
    throw new Error(`Boot failed: ${verifierResult.unwrapErr().message}`);
  }

  const handleResult = conversationalClientFromEnv(env);
  if (handleResult.isErr()) {
    throw new Error(`Boot failed: ${handleResult.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;
  const interviews = new DrizzleInterviewRepository(db);
  const agent = new ElevenLabsConversationalService(handleResult.unwrap());

  return {
    verifier: verifierResult.unwrap(),
    startInterviewFromWebhookUseCase: new StartInterviewFromWebhookUseCase(interviews),
    recordAgentNoteUseCase: new RecordAgentNoteUseCase(interviews),
    recordInternalScoreUseCase: new RecordInternalScoreUseCase(interviews),
    endInterviewFromAgentUseCase: new EndInterviewFromAgentUseCase(interviews),
    persistCompletedTranscriptUseCase: new PersistCompletedTranscriptUseCase(
      interviews,
      agent,
    ),
    interviewResolver: {
      async findByElevenLabsSessionId(elevenLabsSessionId: string) {
        const found = await interviews.findByElevenLabsSessionId(elevenLabsSessionId);
        if (found.isErr()) {
          return Result.Err(
            new ServiceUnknownError(
              found.unwrapErr().message,
              "InterviewRepository.findByElevenLabsSessionId",
            ),
          );
        }

        return Result.Ok(
          found.unwrap().match({
            Some: (interview) => Option.Some(interview as InterviewIdLike),
            None: () => Option.None,
          }),
        );
      },
    },
  };
}
