// scripts/live-validation/provision-agent.mjs
// Live-validation Phase 9.5: provisions the three custom tools + throwaway agent.
// Per-tool URLs and x-voice-secret headers are wired in step 7 once the tunnel
// URL is known. Outputs an artifact file with ids for cleanup.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY not set");
  process.exit(2);
}

// Per-tool placeholder URLs — wired to actual tunnel URLs by wire-webhooks.mjs
const PLACEHOLDER = (name) => `https://placeholder.invalid/webhooks/elevenlabs/tools/${name}`;
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
        url: PLACEHOLDER(name),
        method: "POST",
        requestBodySchema,
        requestHeaders: { "x-voice-secret": "CHANGE_ME_IN_WIRE_STEP" },
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
      {
        type: "object",
        description: "Advance to the next planned interview topic.",
        required: ["interview_id"],
        properties: {
          // Injected from the session dynamic variable, NOT filled by the LLM.
          interview_id: { type: "string", dynamicVariable: "interview_id" },
        },
      }),
    score_answer: await ensureTool(artifacts, "score_answer",
      "Internally record a score for the candidate's most recent answer.",
      {
        type: "object",
        description: "Score for the candidate's most recent answer.",
        required: ["interview_id", "topic_name", "score", "justification"],
        properties: {
          // Injected from the session dynamic variable, NOT filled by the LLM.
          interview_id: { type: "string", dynamicVariable: "interview_id" },
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
        required: ["interview_id", "note"],
        properties: {
          // Injected from the session dynamic variable, NOT filled by the LLM.
          interview_id: { type: "string", dynamicVariable: "interview_id" },
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
          // Real instructions are injected via Conversation.startSession({ overrides })
          prompt: "You are a placeholder. Your real instructions will be injected by the browser via Conversation.startSession overrides.",
          llm: "gemini-2.5-flash",
          toolIds: [tools.next_question, tools.score_answer, tools.take_note],
          builtInTools: {
            endCall: {
              name: "end_call",
              description: "End the call when the interview is complete.",
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
      // Hard backstop above the interview plan's max duration (~25min). The
      // agent self-ends via end_interview near the per-interview ceiling; this
      // only catches a runaway. ElevenLabs defaults to 600s (10min), which
      // guillotines longer screens mid-answer — raise it generously.
      conversation: { maxDurationSeconds: 1800 },
    },
    platformSettings: {
      overrides: {
        conversationConfigOverride: {
          agent: {
            firstMessage: true,
            language: true,
            prompt: { prompt: true },
          },
        },
      },
      // workspaceOverrides (post-call webhook) patched in step 7 once tunnel URL is known
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
