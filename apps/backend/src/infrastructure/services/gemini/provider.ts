import { Result } from "@carbonteq/fp";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
export const DEFAULT_GEMINI_AGENT_MODEL = "gemini-2.5-pro";

export interface GeminiProviderConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultAgentModel?: string;
}

export interface GeminiProviderHandle {
  readonly provider: GoogleGenerativeAIProvider;
  readonly defaultModel: string;
  readonly defaultAgentModel: string;
}

export const buildGeminiProvider = (
  config: GeminiProviderConfig,
): Result<GeminiProviderHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(new ServiceUnavailableError("GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini adapters"));
  }

  return Result.Ok({
    provider: createGoogleGenerativeAI({ apiKey: config.apiKey }),
    defaultModel: config.defaultModel ?? DEFAULT_GEMINI_MODEL,
    defaultAgentModel: config.defaultAgentModel ?? DEFAULT_GEMINI_AGENT_MODEL,
  });
};

export const geminiProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<GeminiProviderHandle, ServiceUnavailableError> => {
  const apiKey = env["GOOGLE_GENERATIVE_AI_API_KEY"];

  if (!apiKey) {
    return Result.Err(new ServiceUnavailableError("GOOGLE_GENERATIVE_AI_API_KEY is required for Gemini adapters"));
  }

  return buildGeminiProvider({
    apiKey,
    defaultModel: env["GEMINI_MODEL"] ?? DEFAULT_GEMINI_MODEL,
    defaultAgentModel: env["GEMINI_AGENT_MODEL"] ?? DEFAULT_GEMINI_AGENT_MODEL,
  });
};
