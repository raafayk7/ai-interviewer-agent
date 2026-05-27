export {
  buildElevenLabsClient,
  elevenLabsClientFromEnv,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./provider.js";
export type { ElevenLabsClientHandle, ElevenLabsProviderConfig } from "./provider.js";
export { ElevenLabsTextToSpeechService } from "./elevenlabs-tts.service.js";
export {
  buildConversationalClient,
  conversationalClientFromEnv,
} from "./conversational-provider.js";
export type { ConversationalClientHandle } from "./conversational-provider.js";
export { ElevenLabsConversationalService } from "./elevenlabs-conversational.service.js";
export {
  ConversationalAgentError,
  ConversationalAgentUnavailableError,
  ConversationalSignedUrlFailedError,
  ConversationalTranscriptFetchFailedError,
} from "@repo/application";
export type {
  ConversationalTranscriptRow,
  IssueSignedUrlInput,
  IssueSignedUrlOutput,
} from "@repo/application";
export {
  AgentConfigDriftError,
  assertElevenLabsAgentConfig,
} from "./agent-config-assertion.js";
