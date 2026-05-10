export {
  buildElevenLabsClient,
  elevenLabsClientFromEnv,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./provider.js";
export type { ElevenLabsClientHandle, ElevenLabsProviderConfig } from "./provider.js";
export { ElevenLabsTextToSpeechService } from "./elevenlabs-tts.service.js";
