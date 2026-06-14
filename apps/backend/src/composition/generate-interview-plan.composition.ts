import { createRequire } from "node:module";
import { GenerateInterviewPlanUseCase } from "@repo/application";
import { CandidateSignedLink } from "../infrastructure/auth/candidate-signed-link.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/index.js";
import {
  geminiProviderFromEnv,
  GeminiInterviewPlannerService,
} from "../infrastructure/services/gemini/index.js";
import {
  langfusePromptClientFromEnv,
  NullLangfusePromptClient,
  type ILangfusePromptClient,
} from "../infrastructure/prompts/langfuse-prompt-client.js";

const require = createRequire(import.meta.url);

export interface GenerateInterviewPlanDepsBundle {
  readonly buildUseCase: () => GenerateInterviewPlanUseCase;
  readonly candidateLink: CandidateSignedLink;
}

export interface GenerateInterviewPlanCompositionOptions {
  readonly candidateLink: CandidateSignedLink;
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildGenerateInterviewPlanDeps(
  options: GenerateInterviewPlanCompositionOptions,
): GenerateInterviewPlanDepsBundle {
  const env = options.env ?? process.env;
  const geminiHandle = geminiProviderFromEnv(env);
  if (geminiHandle.isErr()) {
    throw new Error(`Boot failed: ${geminiHandle.unwrapErr().message}`);
  }

  const promptClientResult = langfusePromptClientFromEnv(env);
  const promptClient: ILangfusePromptClient = promptClientResult.isOk()
    ? promptClientResult.unwrap()
    : new NullLangfusePromptClient();

  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const interviews = new DrizzleInterviewRepository(db);
  const planner = new GeminiInterviewPlannerService(geminiHandle.unwrap(), promptClient);

  return {
    buildUseCase: () => new GenerateInterviewPlanUseCase(interviews, planner),
    candidateLink: options.candidateLink,
  };
}
