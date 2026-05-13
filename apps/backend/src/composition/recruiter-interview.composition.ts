import { createRequire } from "node:module";
import {
  CreateInterviewUseCase,
  EvaluateInterviewUseCase,
  GenerateInterviewPlanUseCase,
  GetInterviewByIdUseCase,
  GetReportByInterviewIdUseCase,
  ListInterviewsByRecruiterUseCase,
} from "@repo/application";
import type { Database } from "../infrastructure/persistence/db.js";
import {
  DrizzleInterviewRepository,
  DrizzleReportRepository,
} from "../infrastructure/repositories/index.js";
import {
  GeminiInterviewEvaluatorService,
  GeminiInterviewPlannerService,
  geminiProviderFromEnv,
} from "../infrastructure/services/gemini/index.js";
import {
  langfusePromptClientFromEnv,
  NullLangfusePromptClient,
  type ILangfusePromptClient,
} from "../infrastructure/prompts/langfuse-prompt-client.js";
import type {
  CandidateLinkIssuer,
  RecruiterInterviewControllerDeps,
} from "../presentation/controllers/recruiter-interview.controller.js";

const require = createRequire(import.meta.url);

export interface RecruiterInterviewCompositionOptions {
  readonly candidateLink: CandidateLinkIssuer;
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildRecruiterInterviewDeps(
  options: RecruiterInterviewCompositionOptions,
): RecruiterInterviewControllerDeps {
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
  const geminiHandle = geminiHandleResult.unwrap();

  return {
    createInterviewUseCase: new CreateInterviewUseCase(interviews),
    listInterviewsUseCase: new ListInterviewsByRecruiterUseCase(interviews),
    getInterviewByIdUseCase: new GetInterviewByIdUseCase(interviews),
    generatePlanUseCase: new GenerateInterviewPlanUseCase(
      interviews,
      new GeminiInterviewPlannerService(geminiHandle, promptClient),
    ),
    evaluateInterviewUseCase: new EvaluateInterviewUseCase({
      interviews,
      reports,
      evaluator: new GeminiInterviewEvaluatorService(geminiHandle, promptClient),
    }),
    getReportByInterviewIdUseCase: new GetReportByInterviewIdUseCase(reports),
    candidateLink: options.candidateLink,
    publicBaseUrl: env["CANDIDATE_PUBLIC_BASE_URL"] ?? env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
  };
}
