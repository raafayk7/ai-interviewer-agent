import { createRequire } from "node:module";
import { GetCandidateInterviewViewUseCase } from "@repo/application";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/index.js";
import type {
  CandidateInterviewControllerDeps,
  CandidateLinkVerifier,
} from "../presentation/controllers/candidate-interview.controller.js";

const require = createRequire(import.meta.url);

export interface CandidateInterviewCompositionOptions {
  readonly candidateLink: CandidateLinkVerifier;
  readonly db?: Database;
}

export function buildCandidateInterviewDeps(
  options: CandidateInterviewCompositionOptions,
): CandidateInterviewControllerDeps {
  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  return {
    getCandidateInterviewViewUseCase: new GetCandidateInterviewViewUseCase(
      new DrizzleInterviewRepository(db),
    ),
    candidateLink: options.candidateLink,
  };
}
