// scripts/provision-staging-agent.mjs
// Provisions the PERSISTENT staging ElevenLabs agent + its 3 webhook tools.
//
// Unlike live-validation/provision-agent.mjs (a throwaway "DELETEME" agent tracked
// in .artifacts.json that cleanup.mjs deletes), this creates a named staging agent
// and writes NO artifact — so cleanup.mjs cannot remove it. Run once; copy the
// printed ELEVENLABS_AGENT_ID into the backend's env on Render.
//
//   node --env-file=apps/backend/.env apps/backend/scripts/provision-staging-agent.mjs
//
// The override allow-list flags (prompt.prompt + firstMessage) are required by the
// backend boot assertion (agent-config-assertion.ts / ADR-033). After the backend
// is live at its Render URL, wire the tool + post-call webhook URLs with
// live-validation/{register-post-call-webhook,wire-webhooks}.mjs.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY not set");
  process.exit(2);
}

const AGENT_NAME = "sift-staging-interviewer";
const PLACEHOLDER = (name) =>
  `https://placeholder.invalid/webhooks/elevenlabs/tools/${name}`;
const client = new ElevenLabsClient({ apiKey });

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
        // Replaced with the real x-voice-secret by wire-webhooks.mjs at wiring time.
        requestHeaders: { "x-voice-secret": "CHANGE_ME_IN_WIRE_STEP" },
      },
    },
  });
  console.log(`  tool created: ${name} -> ${res.id}`);
  return res.id;
}

async function main() {
  console.log("Creating 3 staging webhook tools...");
  const tools = {
    next_question: await createWebhookTool(
      "next_question",
      "Advance to the next planned interview topic.",
      {
        type: "object",
        description: "Advance to the next planned interview topic.",
        required: ["interview_id"],
        properties: {
          interview_id: { type: "string", dynamicVariable: "interview_id" },
        },
      },
    ),
    score_answer: await createWebhookTool(
      "score_answer",
      "Internally record a score for the candidate's most recent answer.",
      {
        type: "object",
        description: "Score for the candidate's most recent answer.",
        required: ["interview_id", "topic_name", "score", "justification"],
        properties: {
          interview_id: { type: "string", dynamicVariable: "interview_id" },
          topic_name: {
            type: "string",
            description: "The planned topic this score applies to.",
          },
          score: {
            type: "integer",
            description: "Integer 0..5, where 5 is excellent.",
          },
          justification: {
            type: "string",
            description: "One-sentence reason for the score.",
          },
        },
      },
    ),
    take_note: await createWebhookTool(
      "take_note",
      "Record an observation about the candidate for the final report.",
      {
        type: "object",
        description: "An observation about the candidate.",
        required: ["interview_id", "note"],
        properties: {
          interview_id: { type: "string", dynamicVariable: "interview_id" },
          note: {
            type: "string",
            description: "A single observation, written as a complete sentence.",
          },
        },
      },
    ),
  };

  console.log("\nCreating staging agent...");
  const agentRes = await client.conversationalAi.agents.create({
    name: AGENT_NAME,
    conversationConfig: {
      agent: {
        prompt: {
          // Real instructions are injected per-session via startSession overrides.
          prompt:
            "You are a placeholder. Real instructions are injected per session via Conversation.startSession overrides.",
          llm: "gpt-4o-mini",
          toolIds: [tools.next_question, tools.score_answer, tools.take_note],
          builtInTools: {
            endCall: {
              name: "end_call",
              description: "End the call when the interview is complete.",
              params: { systemToolType: "end_call" },
            },
          },
        },
        firstMessage:
          "Hello. This is a placeholder first message; the real greeting is injected per session.",
        language: "en",
      },
      tts: { voiceId: "EXAVITQu4vr4xnSDxMaL", modelId: "eleven_turbo_v2" },
      // Hard backstop above the per-interview ceiling (~25min); the agent self-ends
      // earlier. ElevenLabs defaults to 600s which guillotines longer screens.
      conversation: { maxDurationSeconds: 1800 },
    },
    platformSettings: {
      // Required by agent-config-assertion.ts (ADR-033): the backend assembles the
      // per-session override server-side and the agent must allow-list these fields.
      overrides: {
        conversationConfigOverride: {
          agent: {
            firstMessage: true,
            language: true,
            prompt: { prompt: true },
          },
        },
      },
    },
  });

  console.log(`  agent created: ${agentRes.agentId}`);
  console.log("\n=== SET THIS IN RENDER ===");
  console.log(`ELEVENLABS_AGENT_ID=${agentRes.agentId}`);
  console.log("\ntool ids:", JSON.stringify(tools, null, 2));
}

main().catch((e) => {
  console.error("provision failed:", e?.message ?? e);
  if (e?.body) console.error("body:", JSON.stringify(e.body, null, 2));
  process.exit(1);
});
