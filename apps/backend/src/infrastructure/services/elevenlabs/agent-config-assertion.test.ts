import { describe, expect, it, vi } from "vitest";
import type { ConversationalClientHandle } from "./conversational-provider.js";
import {
  AgentConfigDriftError,
  assertElevenLabsAgentConfig,
} from "./agent-config-assertion.js";

const makeHandle = (agent: unknown): ConversationalClientHandle =>
  ({
    agentId: "agent-1",
    client: {
      conversationalAi: {
        agents: {
          get: vi.fn().mockResolvedValue(agent),
        },
      },
    },
  }) as unknown as ConversationalClientHandle;

describe("assertElevenLabsAgentConfig", () => {
  it("passes when prompt override allow-list flags are enabled", async () => {
    const result = await assertElevenLabsAgentConfig(
      makeHandle({
        platformSettings: {
          overrides: {
            conversationConfigOverride: {
              agent: {
                firstMessage: true,
                prompt: { prompt: true },
              },
            },
          },
        },
      }),
    );

    expect(result.isOk()).toBe(true);
  });

  it("returns drift error naming every missing required flag", async () => {
    const result = await assertElevenLabsAgentConfig(
      makeHandle({ platformSettings: { overrides: {} } }),
    );

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AgentConfigDriftError);
    expect(result.unwrapErr().message).toContain("agent.prompt.prompt");
    expect(result.unwrapErr().message).toContain("agent.firstMessage");
  });

  it("wraps SDK failures as drift errors", async () => {
    const handle = ({
      agentId: "agent-1",
      client: {
        conversationalAi: {
          agents: {
            get: vi.fn().mockRejectedValue(new Error("401 missing_permissions")),
          },
        },
      },
    } as unknown) as ConversationalClientHandle;

    const result = await assertElevenLabsAgentConfig(handle);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(AgentConfigDriftError);
    expect(result.unwrapErr().message).toContain("401 missing_permissions");
  });
});
