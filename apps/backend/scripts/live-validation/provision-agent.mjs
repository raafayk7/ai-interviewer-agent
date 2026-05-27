// scripts/live-validation/provision-agent.mjs
// Live-validation Phase 9.5: provisions the three custom tools + throwaway agent.
// Stub URLs for initiation webhook + post-call webhook are wired in step 7 once
// the tunnel URL is known. Outputs an artifact file with ids for cleanup.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY not set");
  process.exit(2);
}

const PLACEHOLDER_URL = "https://placeholder.invalid/webhooks/elevenlabs/tools";
const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const client = new ElevenLabsClient({ apiKey });

async function readArtifacts() {
  try {
    return JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));
  } catch {
    return { createdAt: new Date().toISOString(), agentId: null, toolIds: {} };
  }
}

async function writeArtifacts(artifacts) {
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));
}

async function ensureTool(artifacts, name, description, requestBodySchema) {
  if (artifacts.toolIds[name]) {
    console.log(`  tool already exists: ${name} -> ${artifacts.toolIds[name]} (skipping)`);
    return artifacts.toolIds[name];
  }
  const id = await createWebhookTool(name, description, requestBodySchema);
  artifacts.toolIds[name] = id;
  await writeArtifacts(artifacts);
  return id;
}

async function createWebhookTool(name, description, requestBodySchema) {
  const res = await client.conversationalAi.tools.create({
    toolConfig: {
      type: "webhook",
      name,
      description,
      responseTimeoutSecs: 5,
      apiSchema: {
        url: PLACEHOLDER_URL,
        method: "POST",
        requestBodySchema,
      },
    },
  });
  console.log(`  tool created: ${name} -> ${res.id}`);
  return res.id;
}

async function main() {
  const artifacts = await readArtifacts();

  console.log("Ensuring 3 custom webhook tools...");
  const tools = {
    next_question: await ensureTool(artifacts, "next_question",
      "Advance to the next planned interview topic.",
      { type: "object", description: "Empty payload.", properties: {} }),
    score_answer: await ensureTool(artifacts, "score_answer",
      "Internally record a score for the candidate's most recent answer.",
      {
        type: "object",
        description: "Score for the candidate's most recent answer.",
        required: ["topic_name", "score", "justification"],
        properties: {
          topic_name: { type: "string", description: "The planned topic this score applies to." },
          score: { type: "integer", description: "Integer 0..5, where 5 is excellent." },
          justification: { type: "string", description: "One-sentence reason for the score." },
        },
      }),
    take_note: await ensureTool(artifacts, "take_note",
      "Record an observation about the candidate for the final report.",
      {
        type: "object",
        description: "An observation about the candidate.",
        required: ["note"],
        properties: {
          note: { type: "string", description: "A single observation, written as a complete sentence." },
        },
      }),
  };

  if (artifacts.agentId) {
    console.log(`\nAgent already exists: ${artifacts.agentId} (skipping create)`);
    console.log(JSON.stringify(artifacts, null, 2));
    return;
  }

  console.log("\nCreating throwaway agent...");
  const agentRes = await client.conversationalAi.agents.create({
    name: "sift-live-validation-DELETEME",
    conversationConfig: {
      agent: {
        prompt: {
          prompt:
            "You are a placeholder. Your real instructions will be injected by the conversation-initiation webhook.",
          llm: "gemini-2.5-flash",
          toolIds: [tools.next_question, tools.score_answer, tools.take_note],
          builtInTools: {
            endCall: {
              name: "end_call",
              description:
                "End the call when the interview is complete.",
              params: { systemToolType: "end_call" },
            },
          },
        },
        firstMessage: "Hello. This is the placeholder first message.",
        language: "en",
      },
      tts: {
        voiceId: "EXAVITQu4vr4xnSDxMaL",
        modelId: "eleven_turbo_v2",
      },
    },
    platformSettings: {
      overrides: {
        enableConversationInitiationClientDataFromWebhook: true,
        conversationConfigOverride: {
          agent: {
            firstMessage: true,
            language: true,
            prompt: { prompt: true },
          },
        },
      },
      // workspaceOverrides patched in step 7 once tunnel URL is known
    },
  });
  console.log(`  agent created: ${agentRes.agentId}`);

  artifacts.agentId = agentRes.agentId;
  artifacts.toolIds = tools;
  await writeArtifacts(artifacts);
  console.log(`\nArtifact written: ${ARTIFACT_PATH}`);
  console.log(JSON.stringify(artifacts, null, 2));
}

main().catch((e) => {
  console.error("provision failed:", e?.message ?? e);
  if (e?.body) console.error("body:", JSON.stringify(e.body, null, 2));
  process.exit(1);
});
