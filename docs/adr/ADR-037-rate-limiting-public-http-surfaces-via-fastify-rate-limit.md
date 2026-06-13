# ADR-037 Rate Limiting Public HTTP Surfaces via @fastify/rate-limit

## Status

Proposed. Date: 2026-06-14.

## Context

ADR-016 explicitly deferred rate limiting on auth endpoints with the note "planned for Phase 10" (`docs/adr/ADR-016-adopt-better-auth-for-recruiter-authentication.md`, line 22) and identified the risk: "No rate limiting on `/api/auth/*` means credential-stuffing attacks can run at full network speed ... Add `@fastify/rate-limit` scoped to auth routes before any public exposure (Phase 10 prerequisite)." The deferral was intentional: the correct configuration (thresholds, store type, proxy keying) only makes sense once the deployment topology is known. That topology is now fixed for staging: a single backend instance on Render Free behind Render's TLS-terminating proxy, served to a Next.js frontend hosted on Vercel.

Two HTTP surfaces require rate limiting before public exposure:

**Credential endpoints.** `POST /api/auth/sign-in/*` and `POST /api/auth/sign-up/*` are brute-force and credential-stuffing targets. They are public (no authentication required to attempt them) and each invocation triggers a bcrypt verification, which is CPU-bound by design but not a sufficient deterrent on its own.

**Candidate-session mint.** `POST /interviews/:id/candidate-session` starts a paid ElevenLabs Conversational AI session (ADR-029, ADR-033). A single abusive caller can trigger unbounded ElevenLabs billing. The HMAC-signed candidate link (ADR-017) scopes the surface to a specific interview, but does not limit request rate.

Two other categories are explicitly excluded. `GET /api/auth/get-session` is called server-side from the Next.js frontend's Vercel egress IP during route auth gating on every page load. A blanket per-IP limit on all of `/api/auth/*` would route every recruiter's session check through one Vercel NAT bucket and throttle the entire application through a single counter. ElevenLabs lifecycle webhook routes (`/webhooks/elevenlabs/*`) are HMAC-authenticated server-to-server calls (ADR-034); per-IP limiting on webhook routes risks dropping legitimate lifecycle events and is unnecessary given the HMAC authentication already in place.

Render terminates TLS and forwards the real client IP in `X-Forwarded-For`. Without Fastify's `trustProxy` setting, `req.ip` resolves to the Render proxy address, and every caller shares one rate-limit bucket regardless of origin. The `TRUST_PROXY` environment variable, defaulting to `false` for local development and set to `1` on Render (one proxy hop), resolves `req.ip` from XFF and resists client-spoofed XFF headers (which `trustProxy: true` would not).

The project's Redis deferral decision (recorded in project memory, 2026-05) specifies no Redis until horizontal scaling, async queues, or rate limiting actually arrive. With a single Render instance, in-memory counters are per-process and therefore per-instance-correct. No shared store is required until the topology scales beyond one instance.

## Decision

Adopt `@fastify/rate-limit` v10.3.0 (pinned for Fastify 5 compatibility) for the backend's public HTTP surfaces. Register the plugin with `global: false` so limits are opt-in per route via `config.rateLimit`. Nothing is throttled unless it explicitly opts in.

Apply per-IP limits to exactly two surfaces:

1. The better-auth catch-all `app.all("/api/auth/*")` carries a `config.rateLimit` with an `allowList` function that returns `true` (skips limiting) for every request that is not a credential path and for all CORS preflight (OPTIONS) requests. Only requests whose URL contains `/sign-in` or `/sign-up` are counted. Default threshold: 10 requests per minute per IP, overridable via `RATE_LIMIT_AUTH_PER_MIN`.

2. `POST /interviews/:id/candidate-session` carries a `config.rateLimit` directly. Default threshold: 10 requests per minute per IP, overridable via `RATE_LIMIT_CANDIDATE_SESSION_PER_MIN`. The threshold is kept at 10 (not lower) because ADR-035 session reconnects re-issue the mint; a tighter limit would throttle legitimate reconnects.

Set Fastify `trustProxy` from a `TRUST_PROXY` environment variable. The value `false` (default when unset, for local development) uses the socket IP directly. The value `"1"` (one hop, the correct value on Render) reads the real client IP from the rightmost entry in `X-Forwarded-For` and resists a client spoofing its own XFF header. The value `"true"` trusts the full XFF chain from the left; it is supported but not recommended for production.

Use the plugin's default in-memory store. This is correct and sufficient for a single backend instance. A move to a Redis-backed store (via `@upstash/redis` or `rate-limit-redis`) is the migration path when horizontal scaling is introduced.

Do not rate-limit the ElevenLabs webhook routes. They are HMAC-authenticated server-to-server calls whose per-IP keying would be meaningless (ElevenLabs delivers from its own infrastructure IPs) and whose throttling would risk dropping paid-session lifecycle events (ADR-034).

The implementation surface is:
- `apps/backend/src/presentation/rate-limit/rate-limit.ts` — `installRateLimit` (registers `global: false`), `rateLimitsFromEnv` (reads env overrides), `trustProxyFromEnv` (parses `TRUST_PROXY`), `authRouteRateLimit` (constructs the `allowList` for the auth catch-all).
- `apps/backend/src/app.ts` — `Fastify({ trustProxy: trustProxyFromEnv() })`, `installRateLimit(app)`, `rateLimits.auth` threaded to `mountBetterAuth`, `rateLimits.candidateSession` threaded to `registerCandidateSessionRoutes`.
- `apps/backend/src/presentation/auth/better-auth-mount.ts` — auth catch-all applies `authRouteRateLimit(authRateLimit)` when a limit is provided.
- `apps/backend/src/presentation/routes/candidate-session.routes.ts` — mint route applies `{ config: { rateLimit: options.rateLimit } }` when a limit is provided.

## Alternatives Considered

### Alternative A: Global blanket limit on all routes including the full `/api/auth/*` catch-all

Register `@fastify/rate-limit` with `global: true`, or apply a single per-IP limit to the entire `/api/auth/*` catch-all without an `allowList`.

Rejected. The `/api/auth/get-session` path is called server-side from Next.js during route-level auth gating on every page load. All recruiter page loads originate from the Vercel egress IP, which is a shared NAT address. A global or blanket per-IP limit on `/api/auth/*` would route every recruiter user's session check through a single IP bucket and exhaust the limit before any real credential attempt was made, breaking auth gating app-wide. The opt-in `global: false` model combined with the `allowList` in `authRouteRateLimit` avoids this by counting only sign-in and sign-up requests.

### Alternative B: Redis-backed rate-limit store

Use a Redis-backed counter store via `@upstash/redis` or `rate-limit-redis` so that rate-limit counters are shared across process restarts and potential future instances.

Rejected for the current single-instance topology. The project's Redis deferral decision (project memory, 2026-05) specifies no Redis until horizontal scaling, async queues, or rate limiting actually arrive. The staging deployment is a single Render instance; in-memory counters are per-process and therefore per-instance-correct. Adding a Redis dependency and an external service for zero current benefit introduces an additional failure surface and operational cost. This alternative is the documented migration path when the topology scales beyond one instance.

### Alternative C: Rate limiting at a proxy, CDN, or WAF layer instead of in-application

Configure rate limiting on a reverse proxy (such as nginx), a CDN edge (such as Cloudflare), or a WAF rather than in the Fastify application.

Rejected. The staging topology has no such layer. In-application rate limiting keeps the rule versioned with the code that defines the protected surface, is testable in the existing Vitest harness without external services, and is enforced identically in local development and staging. A proxy or CDN layer may be introduced in a future phase; if it is, this ADR can be superseded to move the rule outward.

### Alternative D: Split the better-auth mount into separate find-my-way wildcard routes

Register a strict `/api/auth/sign-in/*` route and a separate `/api/auth/sign-up/*` route with rate limits, plus a remaining `/api/auth/*` route without a limit.

Rejected in favor of the `allowList` on the single catch-all. Fastify's `find-my-way` router does not guarantee stable priority ordering between overlapping wildcard routes at the same depth; the behavior of two competing `/*` wildcards is implementation-dependent. The single catch-all with an `allowList` avoids overlapping-wildcard ambiguity, keeps better-auth mounted as one handler as its documentation intends, and localizes the credential-path detection logic to one function (`isCredentialAuthPath`) with a clear unit test.

## Consequences

**Benefits**

- Credential endpoints and the candidate-session mint surface are protected from brute-force and cost-abuse attacks before public exposure, fulfilling the explicit prerequisite stated in ADR-016.
- Per-IP keying is correct behind Render's proxy via the `TRUST_PROXY` env var, so each real client gets its own bucket rather than sharing the proxy's IP.
- The `get-session` path is never throttled regardless of how many page loads originate from the Vercel egress IP.
- No new external infrastructure is required. The in-memory store is correct for the single-instance topology and requires no additional environment variables or services to operate.
- Rate-limit thresholds are tunable via environment variables (`RATE_LIMIT_AUTH_PER_MIN`, `RATE_LIMIT_CANDIDATE_SESSION_PER_MIN`) without code changes or redeployment.
- The opt-in `global: false` model prevents accidental throttling of unrelated routes added in future phases.
- The 14-test suite in `apps/backend/src/presentation/rate-limit/rate-limit.test.ts` includes an explicit invariant test ("NEVER throttles get-session, even past the auth max") that guards against the key regression risk.

**Trade-offs**

- The in-memory store is per-instance. Under horizontal scaling (more than one Render instance), each instance maintains its own counters and the effective per-IP limit becomes `max * instance_count`. This becomes ineffective and the Redis migration (Alternative B) must be executed before scaling beyond one instance.
- `TRUST_PROXY` must be set correctly per environment. A misconfigured value (for example, `false` on Render) causes `req.ip` to resolve to the Render proxy address and collapses all callers into one bucket. A misconfigured `"true"` (full XFF trust) allows a client to spoof its own `X-Forwarded-For` header and bypass the limit entirely.
- Candidates behind shared NAT (corporate networks, university networks, mobile carrier NAT) share a bucket. The 10/min default is generous enough that legitimate candidate use (at most a few reconnects per session per ADR-035) does not conflict with the bucket, but a large organization with many simultaneous candidates behind one NAT could approach the limit.
- The 10/min threshold is a deterrent, not a hard prevention. A motivated attacker with distributed IPs can still attempt credential stuffing at 10 attempts per minute per IP. This is defense-in-depth alongside better-auth's own bcrypt cost and session management, not a complete mitigation.

**Risks and mitigations**

- *Risk*: `TRUST_PROXY` is not set to `"1"` on the Render deployment, causing all callers to share the proxy's IP bucket. *Mitigation*: Document `TRUST_PROXY=1` as a required environment variable in the Render service configuration. The `trustProxyFromEnv` function defaults to `false` (safe for local dev) and the test suite covers the `"1"` parse path.
- *Risk*: The in-memory store resets on process restart (Render free tier restarts on deploy and on idle). A restart clears all counters, allowing a burst immediately after restart. *Mitigation*: The 10/min default is intentionally low so a one-reset bypass is not a meaningful attack advantage. Counter reset on restart is an accepted trade-off for zero-infrastructure operation.
- *Risk*: A future change moves `get-session` out of the `allowList` exclusion or changes the `isCredentialAuthPath` function to match non-credential paths, reintroducing the Vercel-egress-IP throttling regression. *Mitigation*: The Enforcement block below flags `global: true` as forbidden in the rate-limit module. The explicit test "NEVER throttles get-session, even past the auth max" in the test suite will catch an `allowList` regression.
- *Risk*: The ElevenLabs webhook routes are inadvertently added to the opt-in rate-limit configuration in a future change, throttling legitimate lifecycle deliveries. *Mitigation*: Webhook routes are not registered through `registerCandidateSessionRoutes` and do not call `installRateLimit`'s per-route config. The Enforcement block guards against `global: true`, which is the only mechanism that would throttle webhook routes without explicit opt-in.
- *Risk*: The dependency `@fastify/rate-limit` diverges from Fastify 5 compatibility on an unplanned minor bump. *Mitigation*: The dependency is declared `^10.3.0` in `package.json` and locked at `10.3.0` in the lockfile; CI installs with a frozen lockfile, so the resolved version does not drift without an explicit change. Any upgrade requires explicit review against Fastify 5 compatibility notes.

## Related Decisions

- **ADR-016 (Adopt better-auth for Recruiter Authentication)**: This ADR realizes the Phase 10 prerequisite explicitly named in ADR-016: "Add `@fastify/rate-limit` scoped to auth routes before any public exposure." This ADR complements ADR-016 and does not supersede it. The better-auth session table, cookie configuration, and bcrypt cost all remain as decided in ADR-016.
- **ADR-029 (Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline)**: The paid-session cost rationale for throttling `POST /interviews/:id/candidate-session` derives from ADR-029's adoption of ElevenLabs, which bills per conversation.
- **ADR-033 (ElevenLabs Static Agent: Server-Built Overrides via Browser SDK)**: ADR-033 owns the `StartCandidateSession` use case and the signed-URL issuance that mints a paid conversation. The candidate-session rate limit guards the entry point that ADR-033 defines.
- **ADR-034 (ElevenLabs Lifecycle: Two Inbound Webhook Surfaces with Scoped HMAC)**: Webhook routes are excluded from rate limiting because they are HMAC-authenticated server-to-server surfaces as established by ADR-034.
- **ADR-035 (ElevenLabs Interview Session Integrity)**: The candidate-session mint threshold is kept at 10/min (not lower) because ADR-035 session reconnects re-issue the mint. A tighter limit would throttle legitimate reconnects on an in-progress session.
- **Redis deferral decision (project memory, 2026-05)**: The in-memory store choice is consistent with the project-wide Redis deferral: no Redis until horizontal scaling, async queues, or rate limiting actually arrive. This ADR represents rate limiting arriving; the single-instance topology still does not require a shared store.

## References

- `apps/backend/src/presentation/rate-limit/rate-limit.ts` — `installRateLimit` (`global: false` registration), `rateLimitsFromEnv` (env-driven thresholds), `trustProxyFromEnv` (proxy hop parsing), `authRouteRateLimit` (allowList that skips non-credential paths and OPTIONS).
- `apps/backend/src/presentation/rate-limit/rate-limit.test.ts` — 14 tests covering `trustProxyFromEnv` parsing, `rateLimitsFromEnv` defaults and overrides, per-route opt-in behavior, sign-in throttle, sign-up throttle, the get-session never-throttled invariant, and preflight exclusion.
- `apps/backend/src/app.ts:64-66` — `Fastify({ trustProxy: trustProxyFromEnv() })`.
- `apps/backend/src/app.ts:89-93` — `installRateLimit(app)` and `rateLimitsFromEnv()` registered before routes.
- `apps/backend/src/app.ts:112` — `mountBetterAuth(app, authDeps.auth, rateLimits.auth)` threading auth limit.
- `apps/backend/src/app.ts:181` — `rateLimit: rateLimits.candidateSession` threaded to candidate-session routes.
- `apps/backend/src/presentation/auth/better-auth-mount.ts:19-23` — single `app.all("/api/auth/*")` catch-all with optional `config.rateLimit`.
- `apps/backend/src/presentation/routes/candidate-session.routes.ts:27` — mint route `config.rateLimit` opt-in.
- ADR-016 line 22: "Rate limiting on auth endpoints (planned for Phase 10)."
- ADR-016 Risk section: "Add `@fastify/rate-limit` scoped to auth routes before any public exposure (Phase 10 prerequisite)."
- `@fastify/rate-limit` v10 release notes (Fastify 5 compatibility): https://github.com/fastify/fastify-rate-limit/releases/tag/v10.0.0

## Enforcement

The key mechanically expressible regression guard is to prevent reintroduction of the rejected Alternative A: a `global: true` registration that would throttle all routes including `get-session`. A `forbid_pattern` on `global:\s*true` in the rate-limit module catches this directly. No other aspect of this decision (the `allowList` logic, the threshold values, the webhook exclusion) can be expressed as a simple pattern match without false positives on unrelated code.

```json
{
  "forbid_pattern": [
    {
      "pattern": "global:\\s*true",
      "path_glob": "apps/backend/src/presentation/rate-limit/**",
      "message": "global: true is forbidden in the rate-limit module (ADR-037). A global blanket limit throttles /api/auth/get-session from the Vercel shared egress IP and breaks server-side auth gating. Limits must be opt-in per route via config.rateLimit with global: false."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": false
}
```
