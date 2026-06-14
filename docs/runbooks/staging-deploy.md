# Runbook — Staging Deployment

End-to-end setup for the staging environment: **Vercel** (web) + **Render** (backend) +
**Supabase** (Postgres + Storage) + **ElevenLabs** (voice agent). Auto-deploys on push to
the `dev` branch. CI gate runs on every PR/push via `.github/workflows/ci.yml`.

> This is staging on free tiers. It is not a production hardening guide.

## Topology

| Component | Host | Notes |
|---|---|---|
| Web (Next.js) | Vercel → `app-dev.sift-ai.space` | Root Directory `apps/web`; deploys on `dev`. |
| Backend (Fastify) | Render free → `api-dev.sift-ai.space` | Single instance; cold-starts after 15min idle. Blueprint: `render.yaml`. |
| Postgres | Supabase `ai-interviewer-agent-staging` (`hdwsevhindcblvxkdlqp`), PG 17, ap-northeast-1 | Drizzle migrations via `drizzle-kit migrate`. |
| Object storage | Supabase Storage bucket `ai-interviewer-agent-staging` (private) | S3-compatible adapter (ADR-036), `FILE_STORAGE_DRIVER=s3`. |
| Voice | ElevenLabs Conversational AI | One static agent + per-session overrides (ADR-033); webhooks → Render (ADR-034). |
| Observability | Langfuse Cloud | OTel export. |

## Prerequisites

- Accounts: Vercel, Render, Supabase, ElevenLabs, Google AI Studio (Gemini), Langfuse — all linked to the GitHub repo `raafayk7/ai-interviewer-agent`.
- The Supabase project + bucket already exist (created 2026-06-13).
- Generate fresh secrets where needed: `openssl rand -base64 32`.

---

## Custom domains (sift-ai.space)

Staging runs on a **custom domain** so the frontend and backend are **same-site**
(both subdomains of `sift-ai.space`). This is the whole reason for the domain: the
platform defaults (`*.vercel.app` ↔ `*.onrender.com`) are **cross-site** — both
suffixes are on the Public Suffix List — which forced a same-origin Vercel `/be`
rewrite for first-party cookies, and that rewrite's **~30s edge timeout** 502'd
(`ROUTER_EXTERNAL_TARGET_ERROR`) the slow `gemini-2.5-pro` ops (document extract,
interview plan, evaluation). Same-site lets the frontend call the backend
**directly** — no proxy hop, no timeout, first-party cookie.

| Subdomain | Points at | How |
|---|---|---|
| `app-dev.sift-ai.space` | Vercel project `ai-interviewer-agent-web` | Vercel → project → Domains → add (DNS auto; domain was bought via Vercel) |
| `api-dev.sift-ai.space` | Render backend | Render → service → Settings → **Custom Domains** → add → it shows a CNAME target |

Steps:
1. Render → service → Settings → **Custom Domains** → add `api-dev.sift-ai.space`; note the CNAME target (`ai-interviewer-agent-backend.onrender.com`).
2. DNS is **Vercel-managed** (domain bought via Vercel): Vercel → **Domains** → `sift-ai.space` → add `CNAME` `api-dev → ai-interviewer-agent-backend.onrender.com` (or `vercel dns add sift-ai.space api-dev CNAME ai-interviewer-agent-backend.onrender.com`). It's plain Vercel DNS — no Cloudflare orange-cloud to disable.
3. Wait for TLS (Render: "Certificate Issued"; Vercel: green). Verify: `dig +short api-dev.sift-ai.space` chains to `…onrender.com`.

**Direct-vs-proxy toggle.** The frontend calls the backend directly by default; the
`/be` same-origin proxy is **kept** behind `NEXT_PUBLIC_USE_BE_PROXY` (unset/`false`
= direct; `true` = route via the `next.config.js` `/be` rewrite — for self-hosted
Docker, where `next start` has no edge timeout and same-origin avoids `NEXT_PUBLIC`
build-time inlining). On Vercel staging leave it unset/`false`. (`_request.ts`,
`document.service.ts`, `auth-client.ts`, `env.ts`.)

**Cross-subdomain session cookie (required — non-obvious).** Calling direct means
the session cookie is set on `api-dev`. The frontend's server-side auth gate
(`apps/web/src/lib/auth.ts`) forwards the browser's *inbound* cookie to
`api-dev/api/auth/get-session`; a **host-only** cookie on `api-dev` is invisible to
a request hitting `app-dev`, so login succeeds (200 + `Set-Cookie`) but `/dashboard`
bounces back to `/login`. Fix: set **`AUTH_COOKIE_DOMAIN=.sift-ai.space`** on Render
→ better-auth issues `__Secure-…; Domain=.sift-ai.space; SameSite=Lax; Secure`,
shared across both subdomains (`auth.ts` `advanced.crossSubDomainCookies`). Leave
unset locally (host-only Lax over http).

---

## Step 1 — Supabase

1. **Connection string (`DATABASE_URL`).** Dashboard → Connect → **Session pooler** (IPv4, port `5432`). **Copy the exact host from the dashboard** — the `aws-<N>` pooler-instance number varies per project (this one is `aws-1`, not `aws-0`), and a wrong instance gives a misleading `tenant/user … not found` error. Use the pooler, **not** the Direct/IPv6 host (Render cannot reach IPv6). **Append `?sslmode=require`** — Supabase requires SSL and `postgres()` does not enable it from a bare URL. Session mode supports DDL + prepared statements, so this one URL serves both runtime and `drizzle-kit migrate`.
   ```
   postgresql://postgres.hdwsevhindcblvxkdlqp:<DB_PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```
2. **Storage S3 keys.** Dashboard → Storage → **S3 Access Keys** → New access key. Gives `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`. Endpoint and region:
   ```
   S3_ENDPOINT=https://hdwsevhindcblvxkdlqp.storage.supabase.co/storage/v1/s3
   S3_REGION=ap-northeast-1
   S3_BUCKET=ai-interviewer-agent-staging
   S3_FORCE_PATH_STYLE=true
   ```
3. **Lock down the Data API** ✅ *(done 2026-06-14).* Our app talks to Postgres directly (Drizzle + better-auth as the `postgres` role, which bypasses RLS), **not** through Supabase's PostgREST. The auto-exposed Data API over the `public` schema is therefore pure attack surface. Done via Dashboard → Settings → API → **Exposed schemas** → removed `public`. (RLS is also enabled on all 6 tables with no policies → deny-all even if re-exposed.) Verify from outside with the anon key — `public` tables must be unreachable:
   ```
   ANON=<anon/publishable key from Settings → API>
   curl -s -w '\n%{http_code}\n' \
     "https://hdwsevhindcblvxkdlqp.supabase.co/rest/v1/users?select=id&limit=1" \
     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
   # expect 404 PGRST205 resolving against `graphql_public.users` (i.e. public no longer exposed),
   # NOT a 200 with rows/[]
   ```
   Re-check with the Supabase advisor after any DDL.

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
4. Env vars (Production target): `NEXT_PUBLIC_API_URL = https://api-dev.sift-ai.space` and `NEXT_PUBLIC_USE_BE_PROXY = false`. ⚠️ `NEXT_PUBLIC_*` is **inlined at build time** — set these *before* the deploy, and **redeploy** after any change or they won't take.
5. Set the backend's `BETTER_AUTH_URL = https://api-dev.sift-ai.space` and `BETTER_AUTH_TRUSTED_ORIGINS` / `CORS_ALLOWED_ORIGINS` / `CANDIDATE_PUBLIC_BASE_URL = https://app-dev.sift-ai.space`, plus `AUTH_COOKIE_DOMAIN = .sift-ai.space` (see Custom domains), then redeploy the backend.

## Step 4 — ElevenLabs agent + webhooks

The staging agent is already provisioned: `agent_3601kv2qk3a9fdys6ey9dgdzb9mq`
(`sift-staging-interviewer`), set in Render as `ELEVENLABS_AGENT_ID`. To create a
fresh one, run `apps/backend/scripts/live-validation/provision-agent.mjs` once and
copy the printed `agentId` into Render. (Boot-time `agent-config-assertion` needs
the override allow-list flags — the provision script sets them.)

**Wire / re-point webhooks** — one self-contained, idempotent script does the 3
tools **and** the post-call webhook (it reads the agent and derives its tool ids):
```
node --env-file=apps/backend/.env apps/backend/scripts/wire-staging-webhooks.mjs https://api-dev.sift-ai.space
```
It re-points (with the `x-voice-secret` header from `ELEVENLABS_TOOL_WEBHOOK_SECRET`):
- `POST /webhooks/elevenlabs/tools/{next_question,score_answer,take_note}`
- `POST /webhooks/elevenlabs/post-call`

and registers + links the post-call webhook, printing `ELEVENLABS_WEBHOOK_SECRET=wsec_…`
**only when it creates one**. Put that `wsec_…` into Render, then redeploy.

> **Re-pointing to a new backend URL** (e.g. the custom-domain cutover): re-run the
> script with the new URL. Tools re-point idempotently. The post-call webhook is
> matched by URL, so a **new** URL mints a **fresh** `wsec_` (good). But re-running
> against the **same** URL reuses the existing webhook and the secret is **not**
> reshown — to force a fresh one you must delete it first, and ElevenLabs refuses to
> delete a webhook that's **in use**: unlink it from the agent
> (`agents.update(agentId, { platformSettings: { workspaceOverrides: { webhooks: { postCallWebhookId: null } } } })`),
> then `DELETE /v1/workspace/webhooks/{id}`, then re-run the wire script. The old
> `onrender.com` webhook is now orphaned in the workspace — safe to delete in the dashboard.
>
> Ordering note: the backend boots fine with a placeholder `ELEVENLABS_WEBHOOK_SECRET`;
> webhooks just won't verify until the real `wsec_…` is set. Do **not** run `cleanup.mjs`
> on this agent — it's the staging agent, not a throwaway.

## Step 5 — First deploy & migrations

Pushing to `dev` triggers Render. The build runs `drizzle-kit migrate` against `DATABASE_URL` at
the end of the build (free tier has no pre-deploy hook), so the schema is created on first deploy.
To verify or pre-apply manually:
```
DATABASE_URL='<session-pooler-url>' pnpm --filter backend db:migrate
```

## Step 6 — Smoke test

> Last full pass: **2026-06-14** on the custom domain — all steps below green end-to-end (the document-extract op that previously 502'd now succeeds direct).

1. `GET https://api-dev.sift-ai.space/health` → `{ "status": "ok" }`.
2. Recruiter sign-up + sign-in on `https://app-dev.sift-ai.space` (exercises `/api/auth/*` cross-origin + the cross-subdomain cookie → land on `/dashboard`, not back on `/login`).
3. Create an interview, upload a JD + CV (exercises Gemini extraction + **Supabase Storage** upload).
4. Generate the candidate link, open it, start a session (exercises the candidate-session mint → ElevenLabs).
5. Complete a short interview → confirm the post-call webhook flips the interview to `COMPLETED` and evaluation produces a report.

---

## Env matrix

| Variable | Render (backend) | Vercel (web) | Source |
|---|:--:|:--:|---|
| `NEXT_PUBLIC_API_URL` | | ✅ | `https://api-dev.sift-ai.space` |
| `NEXT_PUBLIC_USE_BE_PROXY` | | ✅ | `false` (direct); `true` only for self-hosted Docker |
| `DATABASE_URL` | ✅ | | Supabase session pooler |
| `BETTER_AUTH_SECRET` | ✅ | | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | ✅ | | `https://api-dev.sift-ai.space` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | ✅ | | `https://app-dev.sift-ai.space` |
| `CORS_ALLOWED_ORIGINS` | ✅ | | `https://app-dev.sift-ai.space` |
| `AUTH_COOKIE_DOMAIN` | ✅ | | `.sift-ai.space` (cross-subdomain cookie; see Custom domains) |
| `CANDIDATE_LINK_SECRET` | ✅ | | `openssl rand -base64 32` |
| `CANDIDATE_PUBLIC_BASE_URL` | ✅ | | `https://app-dev.sift-ai.space` |
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
