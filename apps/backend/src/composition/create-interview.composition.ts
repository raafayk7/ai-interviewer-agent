import { createRequire } from "node:module";
import { CreateInterviewUseCase } from "@repo/application";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/index.js";

const require = createRequire(import.meta.url);

export interface CreateInterviewDepsBundle {
  readonly buildUseCase: () => CreateInterviewUseCase;
}

export interface CreateInterviewCompositionOptions {
  readonly db?: Database;
}

export function buildCreateInterviewDeps(
  options: CreateInterviewCompositionOptions = {},
): CreateInterviewDepsBundle {
  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const interviews = new DrizzleInterviewRepository(db);

  return {
    buildUseCase: () => new CreateInterviewUseCase(interviews),
  };
}
