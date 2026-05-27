import { createRequire } from "node:module";
import { AssembleConversationInitiationContextUseCase } from "@repo/application";
import {
  conversationCorrelationTokenFromEnv,
} from "../infrastructure/auth/conversation-correlation-token.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
import type {
  ElevenLabsInitiationWebhookControllerDeps,
} from "../presentation/controllers/elevenlabs-initiation-webhook.controller.js";

const require = createRequire(import.meta.url);

export interface ElevenLabsInitiationWebhookCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildElevenLabsInitiationWebhookDeps(
  options: ElevenLabsInitiationWebhookCompositionOptions = {},
): ElevenLabsInitiationWebhookControllerDeps {
  const env = options.env ?? process.env;
  const tokenIssuerResult = conversationCorrelationTokenFromEnv(env);
  if (tokenIssuerResult.isErr()) {
    throw new Error(`Boot failed: ${tokenIssuerResult.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  return {
    assembleContextUseCase: new AssembleConversationInitiationContextUseCase(
      new DrizzleInterviewRepository(db),
      tokenIssuerResult.unwrap(),
    ),
  };
}
