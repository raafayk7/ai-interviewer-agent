export {
  buildDeepgramClient,
  deepgramClientFromEnv,
  DEFAULT_DEEPGRAM_ENCODING,
  DEFAULT_DEEPGRAM_LANGUAGE,
  DEFAULT_DEEPGRAM_MODEL,
  DEFAULT_DEEPGRAM_SAMPLE_RATE,
} from "./provider.js";
export type { DeepgramClientHandle, DeepgramProviderConfig } from "./provider.js";
export { DeepgramSpeechToTextService } from "./deepgram-stt.service.js";
