import { createRequire } from "node:module";
import { Option, Result } from "@carbonteq/fp";
import {
  PersistCompletedTranscriptUseCase,
  RecordAgentNoteUseCase,
  RecordInternalScoreUseCase,
  ServiceUnknownError,
} from "@repo/application";
import {
  elevenLabsWebhookVerifierFromEnv,
  elevenLabsToolSecretVerifierFromEnv,
} from "../infrastructure/auth/index.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewReportInvalidationService } from "../infrastructure/persistence/drizzle-interview-report-invalidation.service.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
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
  const hmacVerifierResult = elevenLabsWebhookVerifierFromEnv(env);
  if (hmacVerifierResult.isErr()) {
    throw new Error(`Boot failed: ${hmacVerifierResult.unwrapErr().message}`);
  }

  const toolSecretVerifierResult = elevenLabsToolSecretVerifierFromEnv(env);
  if (toolSecretVerifierResult.isErr()) {
    throw new Error(`Boot failed: ${toolSecretVerifierResult.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;
  const interviews = new DrizzleInterviewRepository(db);
  const reportInvalidation = new DrizzleInterviewReportInvalidationService(db);

  return {
    hmacVerifier: hmacVerifierResult.unwrap(),
    toolSecretVerifier: toolSecretVerifierResult.unwrap(),
    recordAgentNoteUseCase: new RecordAgentNoteUseCase(interviews),
    recordInternalScoreUseCase: new RecordInternalScoreUseCase(interviews),
    persistCompletedTranscriptUseCase: new PersistCompletedTranscriptUseCase(
      interviews,
      reportInvalidation,
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
