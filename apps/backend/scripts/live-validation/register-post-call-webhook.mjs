// scripts/live-validation/register-post-call-webhook.mjs
// Registers the workspace-level post-call webhook for the live tunnel, captures
// its HMAC secret, and links it in the convai workspace settings (events +
// transcript format). Idempotent: reuses an existing webhook by URL when found.
//
// Usage: node register-post-call-webhook.mjs https://<tunnel-url>
//
// REQUIRED API KEY SCOPE: creating the workspace webhook needs Webhooks = Access.
// Linking is attempted per-agent first (platformSettings.workspaceOverrides —
// covered by ElevenAgents = Write, scoped to the throwaway agent) and falls back
// to workspace-wide convai settings (which may need Workspace = Write).
//
// NOTE: the HMAC secret is returned ONLY on create. If you lose it you must
// delete + recreate the webhook to get a new one.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";

const tunnel = process.argv[2];
if (!tunnel || !tunnel.startsWith("https://")) {
  console.error("usage: node register-post-call-webhook.mjs https://<tunnel-url>");
  process.exit(2);
}

console.warn(
  "\n[scope] Creating the workspace webhook needs Webhooks = Access on the API key.",
);
console.warn(
  "[scope] Linking tries per-agent override first (ElevenAgents = Write); falls back to workspace settings (Workspace = Write).\n",
);

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;

async function main() {
  const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));
  const POST_CALL_URL = `${tunnel}/webhooks/elevenlabs/post-call`;

  // 1. Idempotency: reuse from artifacts, then by URL lookup, else create.
  let webhookId = artifacts.postCallWebhookId;
  if (!webhookId) {
    const { webhooks } = await client.webhooks.list({ includeUsages: false });
    webhookId = webhooks.find((w) => w.webhookUrl === POST_CALL_URL)?.webhookId;
    if (webhookId) console.log(`  reusing existing webhook by URL -> ${webhookId}`);
  } else {
    console.log(`  reusing webhook from artifacts -> ${webhookId}`);
  }

  if (!webhookId) {
    console.log("  creating workspace post-call webhook…");
    const created = await client.webhooks.create({
      settings: {
        authType: "hmac",
        name: "sift-post-call-DELETEME",
        webhookUrl: POST_CALL_URL,
      },
    });
    webhookId = created.webhookId;
    artifacts.postCallWebhookSecret = created.webhookSecret;
    console.log(
      "\n>>> ELEVENLABS_WEBHOOK_SECRET (set this in apps/backend/.env):\n" +
        created.webhookSecret +
        "\n",
    );
    console.log("  (the secret is returned ONLY on create — losing it means delete + recreate)");
  }

  // 2. Link the webhook + set delivered events / transcript format.
  //    Prefer the per-agent override (scoped to the throwaway agent; covered by
  //    ElevenAgents = Write). Fall back to workspace-wide convai settings.
  const webhookCfg = {
    postCallWebhookId: webhookId,
    events: ["transcript", "call_initiation_failure"],
    transcriptFormat: "json",
  };
  let linked = false;
  if (artifacts.agentId) {
    try {
      await client.conversationalAi.agents.update(artifacts.agentId, {
        platformSettings: { workspaceOverrides: { webhooks: webhookCfg } },
      });
      linked = true;
      console.log(`  linked via per-agent workspaceOverrides on ${artifacts.agentId}`);
    } catch (e) {
      console.warn(`  per-agent link failed (${e?.message ?? e}); trying workspace settings…`);
    }
  }
  if (!linked) {
    await client.conversationalAi.settings.update({ webhooks: webhookCfg });
    console.log("  linked via convai workspace settings");
  }

  // 3. Persist ids back to artifacts.
  artifacts.postCallWebhookId = webhookId;
  artifacts.postCallUrl = POST_CALL_URL;
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(artifacts, null, 2));

  console.log(`\nDone. post-call webhook ${webhookId} -> ${POST_CALL_URL}`);
}

main().catch((e) => {
  console.error("register-post-call-webhook failed:", e?.message ?? e);
  if (e?.body) console.error("body:", JSON.stringify(e.body, null, 2));
  process.exit(1);
});
