// scripts/wire-staging-webhooks.mjs
// Wires the staging agent's 3 tools to the deployed backend URL (+ x-voice-secret
// header) and registers/links the workspace post-call webhook. Self-contained: it
// reads the agent (ELEVENLABS_AGENT_ID) and derives its tools, so no artifact file
// is needed. Idempotent — safe to re-run: tools re-point to the same URLs and an
// existing post-call webhook is reused (its HMAC secret is only shown on first
// create — delete + re-run to mint a fresh one).
//
//   ELEVENLABS_AGENT_ID=<staging agent> \
//   node --env-file=apps/backend/.env apps/backend/scripts/wire-staging-webhooks.mjs https://<backend-url>
//
// API key scopes: ElevenAgents = Write (tools + agent), Webhooks = Access (post-call).
// Set the printed wsec_ as ELEVENLABS_WEBHOOK_SECRET on the backend, and ensure the
// backend's ELEVENLABS_TOOL_WEBHOOK_SECRET equals the x-voice-secret written here.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const base = process.argv[2];
if (!base || !base.startsWith("https://")) {
  console.error("usage: node wire-staging-webhooks.mjs https://<backend-url>");
  process.exit(2);
}
const apiKey = process.env.ELEVENLABS_API_KEY;
const agentId = process.env.ELEVENLABS_AGENT_ID;
const toolSecret = process.env.ELEVENLABS_TOOL_WEBHOOK_SECRET;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY not set");
  process.exit(2);
}
if (!agentId) {
  console.error("ELEVENLABS_AGENT_ID not set");
  process.exit(2);
}
if (!toolSecret) {
  console.error("ELEVENLABS_TOOL_WEBHOOK_SECRET not set");
  process.exit(2);
}

const client = new ElevenLabsClient({ apiKey });

// interview_id is injected from the session dynamic variable (dynamicVariable),
// not filled by the LLM — so it carries no description and is in `required`.
const TOOL_SCHEMAS = {
  next_question: {
    type: "object",
    description: "Advance to the next planned interview topic.",
    required: ["interview_id"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
    },
  },
  score_answer: {
    type: "object",
    description: "Score for the candidate's most recent answer.",
    required: ["interview_id", "topic_name", "score", "justification"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
      topic_name: { type: "string", description: "Planned topic this score applies to." },
      score: { type: "integer", description: "Integer 0..5." },
      justification: { type: "string", description: "One-sentence reason for the score." },
    },
  },
  take_note: {
    type: "object",
    description: "An observation about the candidate.",
    required: ["interview_id", "note"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
      note: { type: "string", description: "A single observation, complete sentence." },
    },
  },
};

async function main() {
  // 1. Derive the agent's tool ids.
  const agent = await client.conversationalAi.agents.get(agentId);
  const toolIds = agent?.conversationConfig?.agent?.prompt?.toolIds ?? [];
  if (toolIds.length === 0) {
    console.error(`agent ${agentId} has no toolIds — nothing to wire`);
    process.exit(1);
  }

  console.log(`Wiring ${toolIds.length} tool(s) for agent ${agentId}...`);
  for (const id of toolIds) {
    const tool = await client.conversationalAi.tools.get(id);
    const name = tool?.toolConfig?.name ?? tool?.name;
    if (!name || !(name in TOOL_SCHEMAS)) {
      console.warn(`  skip ${id}: unrecognized tool name "${name}"`);
      continue;
    }
    const url = `${base}/webhooks/elevenlabs/tools/${name}`;
    await client.conversationalAi.tools.update(id, {
      toolConfig: {
        type: "webhook",
        name,
        description: `${name} (staging)`,
        responseTimeoutSecs: 5,
        apiSchema: {
          url,
          method: "POST",
          requestBodySchema: TOOL_SCHEMAS[name],
          requestHeaders: { "x-voice-secret": toolSecret },
        },
      },
    });
    console.log(`  ${name} -> ${url}`);
  }

  // 2. Register (or reuse) the workspace post-call webhook.
  const postCallUrl = `${base}/webhooks/elevenlabs/post-call`;
  const { webhooks } = await client.webhooks.list({ includeUsages: false });
  let webhookId = webhooks.find((w) => w.webhookUrl === postCallUrl)?.webhookId;
  let secret;
  if (webhookId) {
    console.log(`\n  post-call webhook already exists -> ${webhookId} (secret only shown on create)`);
  } else {
    const created = await client.webhooks.create({
      settings: { authType: "hmac", name: "sift-staging-post-call", webhookUrl: postCallUrl },
    });
    webhookId = created.webhookId;
    secret = created.webhookSecret;
    console.log(`\n  post-call webhook created -> ${webhookId}`);
  }

  // 3. Link it to the agent.
  await client.conversationalAi.agents.update(agentId, {
    platformSettings: {
      workspaceOverrides: {
        webhooks: {
          postCallWebhookId: webhookId,
          events: ["transcript", "call_initiation_failure"],
          transcriptFormat: "json",
        },
      },
    },
  });
  console.log(`  linked post-call webhook to agent ${agentId}`);

  if (secret) {
    console.log(`\n=== set on the backend ===\nELEVENLABS_WEBHOOK_SECRET=${secret}`);
  } else {
    console.log(
      `\n(post-call webhook reused — the wsec_ HMAC secret is shown only at create time; delete it in ElevenLabs + re-run to mint a fresh one)`,
    );
  }
}

main().catch((e) => {
  console.error("wire-staging-webhooks failed:", e?.message ?? e);
  if (e?.body) console.error("body:", JSON.stringify(e.body, null, 2));
  process.exit(1);
});
