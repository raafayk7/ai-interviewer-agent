# Runbook — ElevenLabs Conversational AI Live Validation

How to stand up the throwaway ElevenLabs agent + webhooks and run a full live voice
interview against a local backend, then tear it down. Governing ADRs: 029, 032, 033, 034.

Scripts live in `apps/backend/scripts/live-validation/` and share a `.artifacts.json`
(agent id, tool ids, tunnel, webhook id/secret, seeded interview id + token). **`.artifacts.json`
holds secrets and is git-ignored — never commit it.**

## Prerequisites

- **ElevenLabs API key scopes:** `ElevenAgents = Write`, `Webhooks = Access`, `Voices = Read`,
  `TTS = Access`. (`Webhooks = Access` is required to create the workspace post-call webhook and
  capture its HMAC secret.)
- **ngrok** authenticated (`ngrok config check`). A free static domain is fine.
- **Postgres** reachable via `DATABASE_URL`; Node 22 + pnpm.
- `apps/backend/.env` with at least: `ELEVENLABS_API_KEY`, `DATABASE_URL`, `CANDIDATE_LINK_SECRET`,
  `CANDIDATE_LINK_TTL_SECONDS` (e.g. `604800`), `ELEVENLABS_TOOL_WEBHOOK_SECRET`
  (≥32 chars — `openssl rand -base64 36`), `ELEVENLABS_VOICE_ID`, `CORS_ALLOWED_ORIGINS`
  (must include `http://localhost:3000`). `ELEVENLABS_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET`
  are filled in during steps 1 and 3.

All scripts read `process.env` — run them with `node --env-file=apps/backend/.env …`
(and `tsx` for the TypeScript seed).

## Setup (run in order)

1. **Provision the agent + 3 tools** (no tunnel needed; idempotent — skips anything already in
   `.artifacts.json`):
   ```bash
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/provision-agent.mjs
   ```
   Put the printed `agentId` into `.env` as `ELEVENLABS_AGENT_ID`.

2. **Start the tunnel** to the backend port (3002):
   ```bash
   ngrok http --url=https://<your-static-domain>.ngrok-free.dev 3002   # or: ngrok http 3002
   ```

3. **Register the post-call webhook** (creates it, prints the HMAC secret, links it per-agent):
   ```bash
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/register-post-call-webhook.mjs https://<tunnel>
   ```
   Put the printed `wsec_…` into `.env` as `ELEVENLABS_WEBHOOK_SECRET`.

4. **Wire the tool URLs** to the tunnel (+ `x-voice-secret` header + `interview_id` schema):
   ```bash
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/wire-webhooks.mjs https://<tunnel>
   ```

5. **Start the backend** (all required env is now present):
   ```bash
   pnpm --filter backend dev
   ```

6. **Seed a SCHEDULED interview** + candidate token:
   ```bash
   cd apps/backend && pnpm exec tsx --env-file=.env scripts/live-validation/seed-interview.ts
   ```
   Note the printed `interviewId` + `candidateToken`.

7. **Serve the harness over HTTP** (NOT `file://`):
   ```bash
   python3 -m http.server 3000 --bind 127.0.0.1 --directory apps/backend/scripts/live-validation
   ```
   Open `http://localhost:3000/harness.html`; set Backend `http://localhost:3002`; paste the
   `interviewId` + `candidateToken`; allow the mic; **Start**; have a short conversation.

## What to watch (backend logs)

- `POST /interviews/:id/candidate-session` → 200; the DB row flips to `IN_PROGRESS` with
  `eleven_labs_session_id` set.
- The agent's first utterance reflects the server-built override (drop a canary in
  `clientInstructions`, e.g. "say PINEAPPLE").
- `POST /webhooks/elevenlabs/tools/{score_answer,take_note}` → 200 carrying `interview_id`
  (no 401/400); scores/notes recorded.
- `POST /webhooks/elevenlabs/post-call` → 200 (HMAC verified); the DB row → `COMPLETED`,
  transcript persisted.

## Gotchas (learned the hard way — 2026-05-29)

- **`requestHeaders` must be an object map** `{ "x-voice-secret": "…" }`, not an array
  `[{ name, value }]` (the API returns 422 on the array form).
- **Harness `startSession` must pass `connectionType: "websocket"`** — `signedUrl` is a WebSocket
  credential; the SDK's default WebRTC transport hits a LiveKit `/rtc/v1` handshake bug and never
  connects.
- **Serve the harness over http on an allowlisted origin** (`http://localhost:3000`). Opening it as
  `file://` makes the origin `null`, which CORS blocks — the browser shows "Failed to fetch" even
  though the backend logs a 200.
- **`ELEVENLABS_AGENT_ID` must point at the provisioned agent**, or boot fails the agent-config
  drift assertion with a 404.
- **`CANDIDATE_LINK_TTL_SECONDS` must be set**, or the candidate-link composition fails to boot.
- **The signed URL is single-use** (`includeConversationId: true`); every Start re-issues and
  re-binds a fresh conversation id. `StartCandidateSession` is reconnect-tolerant (accepts SCHEDULED
  or IN_PROGRESS; transitions only from SCHEDULED).
- **There is no session-start webhook** for browser sessions — the SCHEDULED→IN_PROGRESS transition
  happens server-side at signed-URL issuance, not via a webhook (ADR-033/034).

## Teardown

```bash
node --env-file=apps/backend/.env apps/backend/scripts/live-validation/cleanup.mjs
```
Deletes the agent, the 3 tools, the post-call webhook, and the seeded interview row (idempotent).
Then stop the backend, ngrok, and the static-server processes. After teardown,
`ELEVENLABS_AGENT_ID` and `ELEVENLABS_WEBHOOK_SECRET` in `.env` point at deleted resources — re-run
from step 1 to set up again.
