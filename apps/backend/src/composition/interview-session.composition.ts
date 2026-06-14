import {
  ConductInterviewUseCase,
  type ConductInterviewDeps,
} from "@repo/application";
import { createRequire } from "node:module";
import {
  deepgramClientFromEnv,
  DeepgramSpeechToTextService,
} from "../infrastructure/services/deepgram/index.js";
import {
  elevenLabsClientFromEnv,
  ElevenLabsTextToSpeechService,
} from "../infrastructure/services/elevenlabs/index.js";
import {
  geminiProviderFromEnv,
  GeminiInterviewAgentService,
} from "../infrastructure/services/gemini/index.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/drizzle-interview.repository.js";
import type { InterviewSessionDeps } from "../presentation/controllers/interview-session.controller.js";

const require = createRequire(import.meta.url);

export interface InterviewSessionCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional injected DB handle. The production fallback lazy-loads the
   * module-level singleton because db.ts reads DATABASE_URL at import time.
   */
  readonly db?: Database;
}

/**
 * Phase 5 composition root.
 *
 * Env failures throw here because this is the boot boundary, not request
 * handling. The rest of the voice pipeline still returns typed Results.
 */
export function buildInterviewSessionDeps(
  options: InterviewSessionCompositionOptions = {},
): InterviewSessionDeps {
  const env = options.env ?? process.env;
  const deepgramHandleResult = deepgramClientFromEnv(env);
  if (deepgramHandleResult.isErr()) {
    throw new Error(`Boot failed: ${deepgramHandleResult.unwrapErr().message}`);
  }

  const elevenLabsHandleResult = elevenLabsClientFromEnv(env);
  if (elevenLabsHandleResult.isErr()) {
    throw new Error(`Boot failed: ${elevenLabsHandleResult.unwrapErr().message}`);
  }

  const geminiHandleResult = geminiProviderFromEnv(env);
  if (geminiHandleResult.isErr()) {
    throw new Error(`Boot failed: ${geminiHandleResult.unwrapErr().message}`);
  }

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const deps: ConductInterviewDeps = {
    interviews: new DrizzleInterviewRepository(db),
    agent: new GeminiInterviewAgentService(geminiHandleResult.unwrap()),
    stt: new DeepgramSpeechToTextService(deepgramHandleResult.unwrap()),
    tts: new ElevenLabsTextToSpeechService(elevenLabsHandleResult.unwrap()),
    timeRemainingIntervalTurns: parseNonNegativeInt(
      env["INTERVIEW_TIME_REMAINING_INTERVAL_TURNS"],
      3,
    ),
    hardCeilingGraceSeconds: parseNonNegativeInt(
      env["INTERVIEW_HARD_CEILING_GRACE_SECONDS"],
      30,
    ),
  };

  return {
    buildUseCase: () => new ConductInterviewUseCase(deps),
  };
}

function parseNonNegativeInt(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === "") return defaultValue;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return defaultValue;

  return n;
}
