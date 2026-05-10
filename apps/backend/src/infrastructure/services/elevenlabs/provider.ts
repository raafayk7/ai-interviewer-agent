import { Result } from "@carbonteq/fp";
import { ElevenLabsClient, type ElevenLabs } from "elevenlabs";
import { ServiceUnavailableError } from "@repo/application";

export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";
export const DEFAULT_ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT: ElevenLabs.TextToSpeechConvertAsStreamRequestOutputFormat =
  "mp3_44100_128";

export interface ElevenLabsProviderConfig {
  readonly apiKey: string;
  readonly defaultVoiceId?: string;
  readonly defaultModelId?: string;
  readonly defaultOutputFormat?: ElevenLabs.TextToSpeechConvertAsStreamRequestOutputFormat;
}

export interface ElevenLabsClientHandle {
  readonly client: ElevenLabsClient;
  readonly defaultVoiceId: string;
  readonly defaultModelId: string;
  readonly defaultOutputFormat: ElevenLabs.TextToSpeechConvertAsStreamRequestOutputFormat;
}

export const buildElevenLabsClient = (
  config: ElevenLabsProviderConfig,
): Result<ElevenLabsClientHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs adapters"));
  }

  return Result.Ok({
    client: new ElevenLabsClient({ apiKey: config.apiKey }),
    defaultVoiceId: config.defaultVoiceId ?? DEFAULT_ELEVENLABS_VOICE_ID,
    defaultModelId: config.defaultModelId ?? DEFAULT_ELEVENLABS_MODEL_ID,
    defaultOutputFormat: config.defaultOutputFormat ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  });
};

export const elevenLabsClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<ElevenLabsClientHandle, ServiceUnavailableError> => {
  const apiKey = env["ELEVENLABS_API_KEY"];

  if (!apiKey) {
    return Result.Err(new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs adapters"));
  }

  return buildElevenLabsClient({
    apiKey,
    defaultVoiceId: env["ELEVENLABS_VOICE_ID"] ?? DEFAULT_ELEVENLABS_VOICE_ID,
    defaultModelId: env["ELEVENLABS_MODEL_ID"] ?? DEFAULT_ELEVENLABS_MODEL_ID,
    defaultOutputFormat:
      (env["ELEVENLABS_OUTPUT_FORMAT"] as ElevenLabs.TextToSpeechConvertAsStreamRequestOutputFormat) ??
      DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  });
};
