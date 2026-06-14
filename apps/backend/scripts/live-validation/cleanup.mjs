// scripts/live-validation/cleanup.mjs
// Deletes the throwaway agent + 3 tools, deletes the workspace post-call webhook,
// clears the workspace initiation webhook baseline, deletes the seeded interview
// row. Idempotent.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import postgres from "postgres";
import fs from "node:fs/promises";

const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

console.log("Cleanup starting…");

// 0. Delete the workspace post-call webhook (registered by
//    register-post-call-webhook.mjs). Tolerate 404 / already-deleted.
console.log("\n[0/5] Deleting workspace post-call webhook…");
if (artifacts.postCallWebhookId) {
  try {
    await client.webhooks.delete(artifacts.postCallWebhookId);
    console.log(`  deleted ${artifacts.postCallWebhookId}`);
  } catch (e) { console.log("  skip:", e?.message ?? e); }
} else {
  console.log("  no postCallWebhookId in artifacts — nothing to delete");
}

// 1. Detach agent's workspace_overrides + workspace-level initiation webhook
//    so other agents in the workspace don't keep pointing at the dead tunnel.
console.log("\n[1/5] Clearing agent workspace_overrides…");
try {
  await client.conversationalAi.agents.update(artifacts.agentId, {
    platformSettings: { workspaceOverrides: { conversationInitiationClientDataWebhook: null, webhooks: null } },
  });
  console.log("  cleared");
} catch (e) { console.log("  skip:", e?.message ?? e); }

// [2/5] Legacy cleanup — initiation webhook pattern removed in Phase 9.5 revision (ADR-033/034); no-op.
console.log("\n[2/5] Initiation webhook cleanup — no-op (removed in Phase 9.5 revision).");

// 3. Delete agent
console.log("\n[3/5] Deleting agent…");
try {
  await client.conversationalAi.agents.delete(artifacts.agentId);
  console.log(`  deleted ${artifacts.agentId}`);
} catch (e) { console.log("  skip:", e?.message ?? e); }

// 4. Delete tools
console.log("\n[4/5] Deleting tools…");
for (const [name, id] of Object.entries(artifacts.toolIds)) {
  try {
    await client.conversationalAi.tools.delete(id, { force: true });
    console.log(`  deleted ${name} (${id})`);
  } catch (e) { console.log(`  skip ${name}:`, e?.message ?? e); }
}

// 5. Delete seeded interview row
console.log("\n[5/5] Deleting seeded interview row…");
const sql = postgres(process.env.DATABASE_URL);
try {
  const r = await sql`DELETE FROM interviews WHERE id = ${artifacts.interviewId}`;
  console.log(`  deleted ${artifacts.interviewId} (count=${r.count})`);
} catch (e) { console.log("  skip:", e?.message ?? e); }
await sql.end();

console.log("\nCleanup done.");
