// scripts/live-validation/cleanup.mjs
// Deletes the throwaway agent + 3 tools, clears the workspace initiation webhook
// baseline, deletes the seeded interview row. Idempotent.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import postgres from "postgres";
import fs from "node:fs/promises";

const ARTIFACT_PATH = new URL("./.artifacts.json", import.meta.url).pathname;
const artifacts = JSON.parse(await fs.readFile(ARTIFACT_PATH, "utf8"));
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

console.log("Cleanup starting…");

// 1. Detach agent's workspace_overrides + workspace-level initiation webhook
//    so other agents in the workspace don't keep pointing at the dead tunnel.
console.log("\n[1/5] Clearing agent workspace_overrides…");
try {
  await client.conversationalAi.agents.update(artifacts.agentId, {
    platformSettings: { workspaceOverrides: { conversationInitiationClientDataWebhook: null, webhooks: null } },
  });
  console.log("  cleared");
} catch (e) { console.log("  skip:", e?.message ?? e); }

console.log("\n[2/5] Clearing workspace baseline initiation webhook…");
try {
  const r = await fetch("https://api.elevenlabs.io/v1/convai/settings", {
    method: "PATCH",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ conversation_initiation_client_data_webhook: null }),
  });
  console.log("  PATCH /convai/settings ->", r.status);
} catch (e) { console.log("  skip:", e?.message ?? e); }

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
    await client.conversationalAi.tools.delete(id);
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
