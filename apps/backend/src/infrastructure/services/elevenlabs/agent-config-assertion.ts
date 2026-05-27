import { Result } from "@carbonteq/fp";
import type { ConversationalClientHandle } from "./conversational-provider.js";

export class AgentConfigDriftError extends Error {
  readonly code = "AGENT_CONFIG_DRIFT";

  constructor(message: string) {
    super(message);
    this.name = "AgentConfigDriftError";
  }
}

export async function assertElevenLabsAgentConfig(
  handle: ConversationalClientHandle,
): Promise<Result<void, AgentConfigDriftError>> {
  const agentResult = await Result.tryAsyncCatch(
    () => handle.client.conversationalAi.agents.get(handle.agentId),
    (err) =>
      new AgentConfigDriftError(
        `Failed to fetch ElevenLabs agent ${handle.agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
  ).toPromise();

  if (agentResult.isErr()) {
    return Result.Err(agentResult.unwrapErr());
  }

  const agent = agentResult.unwrap();
  const overrides = agent.platformSettings?.overrides;
  const promptAllow = overrides?.conversationConfigOverride?.agent?.prompt?.prompt;
  const firstMessageAllow = overrides?.conversationConfigOverride?.agent?.firstMessage;
  const problems: string[] = [];

  if (overrides?.enableConversationInitiationClientDataFromWebhook !== true) {
    problems.push(
      "platformSettings.overrides.enableConversationInitiationClientDataFromWebhook must be true",
    );
  }

  if (promptAllow !== true) {
    problems.push(
      "platformSettings.overrides.conversationConfigOverride.agent.prompt.prompt must be true",
    );
  }

  if (firstMessageAllow !== true) {
    problems.push(
      "platformSettings.overrides.conversationConfigOverride.agent.firstMessage must be true",
    );
  }

  if (problems.length > 0) {
    return Result.Err(
      new AgentConfigDriftError(
        `ElevenLabs agent ${handle.agentId} config drift:\n- ${problems.join("\n- ")}`,
      ),
    );
  }

  return Result.Ok(undefined);
}
