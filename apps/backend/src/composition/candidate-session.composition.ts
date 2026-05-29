import { createRequire } from "node:module";
import { StartCandidateSessionUseCase } from "@repo/application";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
import {
  assertElevenLabsAgentConfig,
} from "../infrastructure/services/elevenlabs/agent-config-assertion.js";
import {
  conversationalClientFromEnv,
} from "../infrastructure/services/elevenlabs/conversational-provider.js";
import {
  ElevenLabsConversationalService,
} from "../infrastructure/services/elevenlabs/elevenlabs-conversational.service.js";
import type {
  CandidateLinkVerifier,
  CandidateSessionControllerDeps,
} from "../presentation/controllers/candidate-session.controller.js";

const require = createRequire(import.meta.url);

export interface CandidateSessionCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
  readonly candidateLink: CandidateLinkVerifier;
}

export async function buildCandidateSessionDeps(
  options: CandidateSessionCompositionOptions,
): Promise<CandidateSessionControllerDeps> {
  const env = options.env ?? process.env;
  const handleResult = conversationalClientFromEnv(env);
  if (handleResult.isErr()) {
    throw new Error(`Boot failed: ${handleResult.unwrapErr().message}`);
  }

  const handle = handleResult.unwrap();
  const assertion = await assertElevenLabsAgentConfig(handle);
  if (assertion.isErr()) {
    throw assertion.unwrapErr();
  }

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  return {
    startCandidateSessionUseCase: new StartCandidateSessionUseCase(
      new DrizzleInterviewRepository(db),
      new ElevenLabsConversationalService(handle),
    ),
    candidateLink: options.candidateLink,
    agentId: handle.agentId,
  };
}
