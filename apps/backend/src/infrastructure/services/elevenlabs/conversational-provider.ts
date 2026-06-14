import { Result } from "@carbonteq/fp";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ServiceUnavailableError } from "@repo/application";

export interface ConversationalClientHandle {
  readonly client: ElevenLabsClient;
  readonly agentId: string;
}

export const buildConversationalClient = (config: {
  readonly apiKey: string;
  readonly agentId: string;
}): Result<ConversationalClientHandle, ServiceUnavailableError> => {
  if (!config.apiKey.trim()) {
    return Result.Err(
      new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs Conversational AI"),
    );
  }

  if (!config.agentId.trim()) {
    return Result.Err(
      new ServiceUnavailableError("ELEVENLABS_AGENT_ID is required for ElevenLabs Conversational AI"),
    );
  }

  return Result.Ok({
    client: new ElevenLabsClient({ apiKey: config.apiKey }),
    agentId: config.agentId,
  });
};

export const conversationalClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<ConversationalClientHandle, ServiceUnavailableError> => {
  const apiKey = env["ELEVENLABS_API_KEY"];
  const agentId = env["ELEVENLABS_AGENT_ID"];

  if (!apiKey) {
    return Result.Err(
      new ServiceUnavailableError("ELEVENLABS_API_KEY is required for ElevenLabs Conversational AI"),
    );
  }

  if (!agentId) {
    return Result.Err(
      new ServiceUnavailableError(
        "ELEVENLABS_AGENT_ID is required for ElevenLabs Conversational AI",
      ),
    );
  }

  return buildConversationalClient({ apiKey, agentId });
};
