// scripts/live-validation/wire-webhooks.mjs
// Wires per-tool webhook URLs and x-voice-secret headers to the live ngrok tunnel.
// Also patches the agent's workspace_overrides to point at the post-call webhook.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";

const tunnel = process.argv[2];
if (!tunnel || !tunnel.startsWith("https://")) {
  console.error("usage: node wire-webhooks.mjs https://<tunnel-url>");
  process.exit(2);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const toolSecret = process.env.ELEVENLABS_TOOL_WEBHOOK_SECRET;
if (!toolSecret) {
  console.error("ELEVENLABS_TOOL_WEBHOOK_SECRET not set");
  process.exit(2);
}

const client = new ElevenLabsClient({ apiKey });
const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));

const POST_CALL_URL = `${tunnel}/webhooks/elevenlabs/post-call`;

const TOOL_URLS = {
  next_question: `${tunnel}/webhooks/elevenlabs/tools/next_question`,
  score_answer: `${tunnel}/webhooks/elevenlabs/tools/score_answer`,
  take_note: `${tunnel}/webhooks/elevenlabs/tools/take_note`,
};

// interview_id is injected from the session dynamic variable (dynamicVariable),
// NOT filled by the LLM — so it carries no description and is in `required`.
const TOOL_SCHEMAS = {
  next_question: {
    type: "object", description: "Advance to the next planned interview topic.",
    required: ["interview_id"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
    },
  },
  score_answer: {
    type: "object", description: "Score for the candidate's most recent answer.",
    required: ["interview_id", "topic_name", "score", "justification"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
      topic_name: { type: "string", description: "Planned topic this score applies to." },
      score: { type: "integer", description: "Integer 0..5." },
      justification: { type: "string", description: "One-sentence reason for the score." },
    },
  },
  take_note: {
    type: "object", description: "An observation about the candidate.",
    required: ["interview_id", "note"],
    properties: {
      interview_id: { type: "string", dynamicVariable: "interview_id" },
      note: { type: "string", description: "A single observation, complete sentence." },
    },
  },
};

// 1. Patch each tool to its dedicated URL + inject x-voice-secret header
console.log("\nPatching 3 custom tools to per-tool URLs with x-voice-secret header…");
for (const [name, id] of Object.entries(artifacts.toolIds)) {
  const url = TOOL_URLS[name];
  await client.conversationalAi.tools.update(id, {
    toolConfig: {
      type: "webhook",
      name,
      description: `${name} (live-validation)`,
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

// 2. Post-call webhook is now registered + linked by register-post-call-webhook.mjs
//    (workspace-level settings.update + HMAC secret capture). Run it separately.
console.log(`\nPost-call webhook: register + link with a separate script.`);
console.log(`  run: node register-post-call-webhook.mjs ${tunnel}`);
console.log(`  expected post-call URL: ${POST_CALL_URL}`);

artifacts.tunnel = tunnel;
artifacts.toolUrls = TOOL_URLS;
artifacts.postCallUrl = POST_CALL_URL;
await fs.writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));
console.log("\nArtifact updated. All tool webhooks wired.");
