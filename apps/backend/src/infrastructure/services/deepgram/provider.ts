import { Result } from "@carbonteq/fp";
import { DeepgramClient } from "@deepgram/sdk";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_DEEPGRAM_MODEL = "nova-3";
export const DEFAULT_DEEPGRAM_LANGUAGE = "en-US";
export const DEFAULT_DEEPGRAM_SAMPLE_RATE = 16000;
export const DEFAULT_DEEPGRAM_ENCODING = "linear16";

export interface DeepgramProviderConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultLanguage?: string;
  readonly defaultSampleRate?: number;
  readonly defaultEncoding?: string;
}

export interface DeepgramClientHandle {
  readonly client: DeepgramClient;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly defaultLanguage: string;
  readonly defaultSampleRate: number;
  readonly defaultEncoding: string;
}

export const buildDeepgramClient = (
  config: DeepgramProviderConfig,
): Result<DeepgramClientHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(new ServiceUnavailableError("DEEPGRAM_API_KEY is required for Deepgram adapters"));
  }

  return Result.Ok({
    client: new DeepgramClient({ apiKey: config.apiKey }),
    apiKey: config.apiKey,
    defaultModel: config.defaultModel ?? DEFAULT_DEEPGRAM_MODEL,
    defaultLanguage: config.defaultLanguage ?? DEFAULT_DEEPGRAM_LANGUAGE,
    defaultSampleRate: config.defaultSampleRate ?? DEFAULT_DEEPGRAM_SAMPLE_RATE,
    defaultEncoding: config.defaultEncoding ?? DEFAULT_DEEPGRAM_ENCODING,
  });
};

export const deepgramClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<DeepgramClientHandle, ServiceUnavailableError> => {
  const apiKey = env["DEEPGRAM_API_KEY"];

  if (!apiKey) {
    return Result.Err(new ServiceUnavailableError("DEEPGRAM_API_KEY is required for Deepgram adapters"));
  }

  const parsedSampleRate = Number(env["DEEPGRAM_SAMPLE_RATE"]);

  return buildDeepgramClient({
    apiKey,
    defaultModel: env["DEEPGRAM_MODEL"] ?? DEFAULT_DEEPGRAM_MODEL,
    defaultLanguage: env["DEEPGRAM_LANGUAGE"] ?? DEFAULT_DEEPGRAM_LANGUAGE,
    defaultSampleRate:
      Number.isFinite(parsedSampleRate) ? parsedSampleRate : DEFAULT_DEEPGRAM_SAMPLE_RATE,
    defaultEncoding: env["DEEPGRAM_ENCODING"] ?? DEFAULT_DEEPGRAM_ENCODING,
  });
};
