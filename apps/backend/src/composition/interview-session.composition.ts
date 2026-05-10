import {
  RunScriptedInterviewSessionUseCase,
  type RunScriptedInterviewSessionDeps,
} from "@repo/application";
import {
  deepgramClientFromEnv,
  DeepgramSpeechToTextService,
} from "../infrastructure/services/deepgram/index.js";
import {
  elevenLabsClientFromEnv,
  ElevenLabsTextToSpeechService,
} from "../infrastructure/services/elevenlabs/index.js";
import type { InterviewSessionDeps } from "../presentation/controllers/interview-session.controller.js";

export interface InterviewSessionCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Phase 4 composition root.
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

  const deps: RunScriptedInterviewSessionDeps = {
    stt: new DeepgramSpeechToTextService(deepgramHandleResult.unwrap()),
    tts: new ElevenLabsTextToSpeechService(elevenLabsHandleResult.unwrap()),
  };

  return {
    buildUseCase: () => new RunScriptedInterviewSessionUseCase(deps),
  };
}
