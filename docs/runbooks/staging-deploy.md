# Runbook — Staging Deployment

End-to-end setup for the staging environment: **Vercel** (web) + **Render** (backend) +
**Supabase** (Postgres + Storage) + **ElevenLabs** (voice agent). Auto-deploys on push to
the `dev` branch. CI gate runs on every PR/push via `.github/workflows/ci.yml`.

> This is staging on free tiers. It is not a production hardening guide.

## Topology

| Component | Host | Notes |
|---|---|---|
| Web (Next.js) | Vercel | Root Directory `apps/web`; deploys on `dev`. |
| Backend (Fastify) | Render free | Single instance; cold-starts after 15min idle. Blueprint: `render.yaml`. |
| Postgres | Supabase `ai-interviewer-agent-staging` (`hdwsevhindcblvxkdlqp`), PG 17, ap-northeast-1 | Drizzle migrations via `drizzle-kit migrate`. |
| Object storage | Supabase Storage bucket `ai-interviewer-agent-staging` (private) | S3-compatible adapter (ADR-036), `FILE_STORAGE_DRIVER=s3`. |
| Voice | ElevenLabs Conversational AI | One static agent + per-session overrides (ADR-033); webhooks → Render (ADR-034). |
| Observability | Langfuse Cloud | OTel export. |

## Prerequisites

- Accounts: Vercel, Render, Supabase, ElevenLabs, Google AI Studio (Gemini), Langfuse — all linked to the GitHub repo `raafayk7/ai-interviewer-agent`.
- The Supabase project + bucket already exist (created 2026-06-13).
- Generate fresh secrets where needed: `openssl rand -base64 32`.

---

## Step 1 — Supabase

1. **Connection string (`DATABASE_URL`).** Dashboard → Connect → **Session pooler** (IPv4, port `5432`). Use this — **not** the Direct/IPv6 string (Render cannot reach IPv6). Session mode supports DDL + prepared statements, so it serves both runtime and `drizzle-kit migrate`.
   ```
   postgresql://postgres.hdwsevhindcblvxkdlqp:<DB_PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
   ```
2. **Storage S3 keys.** Dashboard → Storage → **S3 Access Keys** → New access key. Gives `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`. Endpoint and region:
   ```
   S3_ENDPOINT=https://hdwsevhindcblvxkdlqp.storage.supabase.co/storage/v1/s3
   S3_REGION=ap-northeast-1
   S3_BUCKET=ai-interviewer-agent-staging
   S3_FORCE_PATH_STYLE=true
   ```
3. **Lock down the Data API.** Our app talks to Postgres directly (Drizzle + better-auth), **not** through Supabase's PostgREST. The auto-exposed Data API over the `public` schema is therefore pure attack surface. After migrations land (Step 5), either:
   - Dashboard → Settings → API → **Exposed schemas** → remove `public` (preferred — we don't use the API), **or**
   - enable deny-by-default RLS on every table.
   Re-check with the Supabase advisor afterward.

## Step 2 — Render backend

**Either** apply the `render.yaml` blueprint (Dashboard → Blueprints → New → this repo) **or** create the web service manually with these exact values:

| Field | Value |
|---|---|
| Language | Node |
| Branch | `dev` |
| Region | Singapore (closest free to the Tokyo DB) |
| **Root Directory** | **(leave blank — repo root)** |
| **Build Command** | `corepack enable && NODE_ENV=development pnpm install --frozen-lockfile && pnpm turbo run build --filter=backend && pnpm --filter backend exec drizzle-kit migrate` |
| **Start Command** | `pnpm --filter backend start` |
| Health Check Path | `/health` |

> ⚠️ **Do not set Root Directory to `apps/backend`.** The backend imports the built `dist/`
> of `@repo/domain` + `@repo/application`; `pnpm run build` inside `apps/backend` only builds
> the backend, so those packages never get built → runtime crash. It also means changes under
> `packages/**` would not trigger a redeploy. Build from the repo root with `turbo --filter=backend`
> (`^build` builds the workspace deps first). `yarn start` is also wrong — this repo uses pnpm.
>
> Optional: set Build Filters (Included Paths) to `apps/backend/**`, `packages/**`,
> `pnpm-lock.yaml`, `turbo.json`, `package.json` so web-only changes don't redeploy the backend.

Then set the environment variables (see the **Env matrix** below). The structural ones are in
`render.yaml`; the rest are `sync:false` secrets you paste in.

## Step 3 — Vercel frontend

1. New Project → import the repo.
2. **Root Directory = `apps/web`** (Vercel detects Next.js + Turborepo).
3. Production branch = `dev` (or your chosen staging branch).
4. Env var: `NEXT_PUBLIC_API_URL = https://<render-service>.onrender.com` (the Render backend URL).
5. After the backend URL is known, set the backend's `BETTER_AUTH_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, and `CANDIDATE_PUBLIC_BASE_URL` to the Vercel web origin, then redeploy the backend.

## Step 4 — ElevenLabs agent + webhooks

Reuse the live-validation scripts (`apps/backend/scripts/live-validation/`), pointing them at the
Render URL instead of an ngrok tunnel. Run locally with `apps/backend/.env` populated.

1. **Provision the static agent + 3 tools** (idempotent):
   ```
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/provision-agent.mjs
   ```
   Put the printed `agentId` into Render as `ELEVENLABS_AGENT_ID`. (The boot-time
   `agent-config-assertion` requires the override allow-list flags — the script sets them.)
2. **Register the post-call webhook** at the Render URL (prints the `wsec_…` secret):
   ```
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/register-post-call-webhook.mjs https://<render-service>.onrender.com
   ```
   Put the printed `wsec_…` into Render as `ELEVENLABS_WEBHOOK_SECRET`, then redeploy.
3. **Wire the tool URLs** to the Render URL (adds the `x-voice-secret` header from `ELEVENLABS_TOOL_WEBHOOK_SECRET`):
   ```
   node --env-file=apps/backend/.env apps/backend/scripts/live-validation/wire-webhooks.mjs https://<render-service>.onrender.com
   ```
   The wired endpoints are:
   - `POST /webhooks/elevenlabs/tools/next_question`
   - `POST /webhooks/elevenlabs/tools/score_answer`
   - `POST /webhooks/elevenlabs/tools/take_note`
   - `POST /webhooks/elevenlabs/post-call`

> Ordering note: the backend boots fine with a placeholder `ELEVENLABS_WEBHOOK_SECRET`; webhooks
> just won't verify until the real `wsec_…` from step 2 is set. So: deploy → register webhook →
> set the secret → redeploy. Unlike local validation, **do not** run `cleanup.mjs` — this agent is
> the staging agent, not throwaway.

## Step 5 — First deploy & migrations

Pushing to `dev` triggers Render. The build runs `drizzle-kit migrate` against `DATABASE_URL` at
the end of the build (free tier has no pre-deploy hook), so the schema is created on first deploy.
To verify or pre-apply manually:
```
DATABASE_URL='<session-pooler-url>' pnpm --filter backend db:migrate
```

## Step 6 — Smoke test

1. `GET https://<render>/health` → `{ "status": "ok" }`.
2. Recruiter sign-up + sign-in on the Vercel app (exercises `/api/auth/*` through CORS).
3. Create an interview, upload a JD + CV (exercises Gemini extraction + **Supabase Storage** upload).
4. Generate the candidate link, open it, start a session (exercises the candidate-session mint → ElevenLabs).
5. Complete a short interview → confirm the post-call webhook flips the interview to `COMPLETED` and evaluation produces a report.

---

## Env matrix

| Variable | Render (backend) | Vercel (web) | Source |
|---|:--:|:--:|---|
| `NEXT_PUBLIC_API_URL` | | ✅ | Render backend URL |
| `DATABASE_URL` | ✅ | | Supabase session pooler |
| `BETTER_AUTH_SECRET` | ✅ | | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | ✅ | | Render backend URL |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ✅ | | Vercel web origin |
| `CORS_ALLOWED_ORIGINS` | ✅ | | Vercel web origin |
| `CANDIDATE_LINK_SECRET` | ✅ | | `openssl rand -base64 32` |
| `CANDIDATE_PUBLIC_BASE_URL` | ✅ | | Vercel web origin |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ✅ | | Google AI Studio |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | ✅ | | ElevenLabs + Step 4 |
| `ELEVENLABS_WEBHOOK_SECRET` | ✅ | | Step 4 (`wsec_…`) |
| `ELEVENLABS_TOOL_WEBHOOK_SECRET` | ✅ | | `openssl rand -base64 36` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | ✅ | | Langfuse |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✅ | | Supabase Storage (Step 1) |
| `FILE_STORAGE_DRIVER=s3`, `S3_FORCE_PATH_STYLE=true`, `TRUST_PROXY=1`, `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=22` | ✅ (structural, in `render.yaml`) | | — |
| `DEEPGRAM_API_KEY` (+ legacy `DEEPGRAM_*`, `ELEVENLABS_VOICE_ID/MODEL_ID/OUTPUT_FORMAT`) | ✅ | | Legacy boot requirement (see caveats) |

GitHub Actions (optional, for turbo remote cache): `TURBO_TOKEN` secret + `TURBO_TEAM` variable.

## CI gate

`.github/workflows/ci.yml` runs `turbo run check-types lint test` on PRs and pushes to `main`/`dev`,
with a Postgres 17 service for the Drizzle integration tests. The MinIO/S3 integration tests skip
when `S3_TEST_ENDPOINT` is unset. The gate must be green before merging to `dev`.

## Caveats

- **Cold starts.** Render free spins down after 15min idle; the first request (and the post-call webhook) waits ~30–60s. ElevenLabs retries webhooks, so a cold-start webhook still lands. Warm the service before a demo.
- **In-memory rate limiting.** Correct for the single Render instance (ADR-037). Scaling to >1 instance requires a shared Redis store.
- **Legacy Deepgram boot vars.** The pre-ElevenLabs "sandbox" voice path is still compiled and constructs Deepgram/EL-TTS clients at boot, so `DEEPGRAM_API_KEY` and the `ELEVENLABS_VOICE_ID/MODEL_ID/OUTPUT_FORMAT` config must be present or the process won't start. The WebSocket route they back is dead (live voice is browser↔ElevenLabs). Remove the sandbox to drop these.
- **`NODE_ENV=production` is intentional on staging** — it's a runtime *mode*, not an environment name. `cors-env.ts` / `auth-env.ts` only require (and use) the real CORS + better-auth origins when `NODE_ENV === "production"`; any other value defaults them to `http://localhost:3000`, which breaks the deployed frontend. To distinguish staging from prod in code or observability, use a separate var (e.g. `APP_ENV`), never `NODE_ENV`. (The build install runs with `NODE_ENV=development` so pnpm keeps devDeps; runtime stays production.)
- **PG 17.** Supabase is Postgres 17; CI/local test DBs are aligned to 17. Our migrations are standard DDL — no version-specific concerns.
- **Supabase free tier** pauses the DB after 7 days idle (a request wakes it).

## Rollback

- **Backend:** Render → the service → Deploys → Rollback to a previous deploy. (Note: migrations are not auto-reverted — Drizzle has no down-migrations here. A schema rollback is manual.)
- **Web:** Vercel → Deployments → promote a previous deployment.
- **Stop auto-deploy:** pause the Render service / disable the Vercel Git integration, or revert the `dev` branch.
