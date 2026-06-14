import {
  EvaluateInterviewUseCase,
  GetReportByInterviewIdUseCase,
} from "@repo/application";
import { createRequire } from "node:module";
import {
  geminiProviderFromEnv,
  GeminiInterviewEvaluatorService,
} from "../infrastructure/services/gemini/index.js";
import {
  langfusePromptClientFromEnv,
  NullLangfusePromptClient,
  type ILangfusePromptClient,
} from "../infrastructure/prompts/langfuse-prompt-client.js";
import type { Database } from "../infrastructure/persistence/db.js";
import {
  DrizzleInterviewRepository,
  DrizzleReportRepository,
} from "../infrastructure/repositories/index.js";

const require = createRequire(import.meta.url);

export interface EvaluateInterviewCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional injected DB handle. The production fallback lazy-loads the
   * module-level singleton because db.ts reads DATABASE_URL at import time.
   */
  readonly db?: Database;
}

export interface EvaluateInterviewDepsBundle {
  readonly buildEvaluateUseCase: () => EvaluateInterviewUseCase;
  readonly buildGetReportUseCase: () => GetReportByInterviewIdUseCase;
}

/**
 * Phase 6 evaluation composition root.
 *
 * Env failures throw here because this is the boot boundary, not request
 * handling. Evaluation itself still returns typed Results through the use case.
 */
export function buildEvaluateInterviewDeps(
  options: EvaluateInterviewCompositionOptions = {},
): EvaluateInterviewDepsBundle {
  const env = options.env ?? process.env;
  const geminiHandleResult = geminiProviderFromEnv(env);
  if (geminiHandleResult.isErr()) {
    throw new Error(`Boot failed: ${geminiHandleResult.unwrapErr().message}`);
  }

  const promptClientResult = langfusePromptClientFromEnv(env);
  const promptClient: ILangfusePromptClient = promptClientResult.isOk()
    ? promptClientResult.unwrap()
    : new NullLangfusePromptClient();

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const interviews = new DrizzleInterviewRepository(db);
  const reports = new DrizzleReportRepository(db);
  const evaluator = new GeminiInterviewEvaluatorService(
    geminiHandleResult.unwrap(),
    promptClient,
  );

  return {
    buildEvaluateUseCase: () =>
      new EvaluateInterviewUseCase({ interviews, reports, evaluator }),
    buildGetReportUseCase: () => new GetReportByInterviewIdUseCase(reports),
  };
}
