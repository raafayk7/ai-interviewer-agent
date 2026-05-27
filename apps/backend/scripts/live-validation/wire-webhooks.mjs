// scripts/live-validation/wire-webhooks.mjs
// Wires the throwaway agent, workspace webhook, and the 3 tool URLs to the
// live ngrok tunnel. Captures the workspace webhook HMAC secret and writes it
// into .env so the backend's verifier signs/verifies with the right secret.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";

const tunnel = process.argv[2];
if (!tunnel || !tunnel.startsWith("https://")) {
  console.error("usage: node wire-webhooks.mjs https://<tunnel-url>");
  process.exit(2);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const client = new ElevenLabsClient({ apiKey });
const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));

const INITIATION_URL = `${tunnel}/webhooks/elevenlabs/initiation`;
const TOOLS_URL = `${tunnel}/webhooks/elevenlabs/tools`;
const POST_CALL_URL = `${tunnel}/webhooks/elevenlabs/post-call`;

// 1. (SKIPPED — API key lacks webhooks_write scope.) Workspace post-call webhook
//    is not provisioned for this validation run. Checks (a)/(b)/(c)/(d) do not
//    depend on it; check (d) verifies end_call dispatches to /tools (per-agent).
//    See operator setup checklist follow-up: add webhooks_write to the API key
//    when post-call/transcript handling is required.
console.log("Skipping workspace post-call webhook (API key lacks webhooks_write).");

// 3. Patch the 3 custom tools' apiSchema.url
console.log(`\nPatching 3 custom tools' apiSchema.url to ${TOOLS_URL}…`);
const TOOL_SCHEMAS = {
  next_question: { type: "object", description: "Empty payload.", properties: {} },
  score_answer: {
    type: "object", description: "Score for the candidate's most recent answer.",
    required: ["topic_name", "score", "justification"],
    properties: {
      topic_name: { type: "string", description: "Planned topic this score applies to." },
      score: { type: "integer", description: "Integer 0..5." },
      justification: { type: "string", description: "One-sentence reason for the score." },
    },
  },
  take_note: {
    type: "object", description: "An observation about the candidate.",
    required: ["note"],
    properties: { note: { type: "string", description: "A single observation, complete sentence." } },
  },
};
for (const [name, id] of Object.entries(artifacts.toolIds)) {
  await client.conversationalAi.tools.update(id, {
    toolConfig: {
      type: "webhook",
      name,
      description: `${name} (live-validation)`,
      responseTimeoutSecs: 5,
      apiSchema: { url: TOOLS_URL, method: "POST", requestBodySchema: TOOL_SCHEMAS[name] },
    },
  });
  console.log(`  ${name} -> ${TOOLS_URL}`);
}

// 4. Patch the agent's platform_settings.workspace_overrides with initiation webhook URL + post-call webhook id
console.log(`\nPatching agent platform_settings.workspace_overrides…`);
await client.conversationalAi.agents.update(artifacts.agentId, {
  platformSettings: {
    workspaceOverrides: {
      conversationInitiationClientDataWebhook: {
        url: INITIATION_URL,
        requestHeaders: {},
      },
    },
  },
});
console.log(`  initiation webhook URL -> ${INITIATION_URL}`);
console.log(`  (post-call webhook id  -> SKIPPED, see note above)`);

artifacts.tunnel = tunnel;
artifacts.initiationUrl = INITIATION_URL;
artifacts.toolsUrl = TOOLS_URL;
artifacts.postCallUrl = POST_CALL_URL;
await fs.writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));
console.log("\nArtifact updated. All webhooks wired.");
