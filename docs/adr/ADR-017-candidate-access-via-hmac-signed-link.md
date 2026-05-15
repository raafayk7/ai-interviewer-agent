# ADR-017 Candidate Access via HMAC-Signed Link

## Status

Accepted, 2026-05-15.

## Context

Candidates join interview sessions via a WebSocket URL. They do not have user accounts in the system: they are one-time participants identified solely by the interview they are joining. The recruiter generates the session and shares the link with the candidate manually (copy-paste, email, messaging app). The system needs a lightweight, stateless mechanism to guard the WebSocket upgrade: the candidate must prove they hold a valid, scoped, time-limited credential for a specific interview before the server allocates any session resources.

The recruiter authentication surface (ADR-016, `better-auth` with email and password) is entirely separate. Candidates are explicitly not recruiter accounts: they have no persistent identity, no personal profile, and no data retained beyond the interview session itself.

Key constraints that drove the choice:

- Candidates must not have persistent user accounts. Creating DB rows for them adds storage churn, a cleanup job, and PII exposure with no product benefit.
- The credential must be scoped to a single `interviewId` to prevent a token for interview A from being replayed against interview B.
- The credential must expire. The agreed default is 7 days (`CANDIDATE_LINK_TTL_SECONDS=604800`), configurable per deployment.
- Rotation and revocation of all live credentials must be possible without a database table (e.g., on suspected secret leak).
- No new npm dependencies. Node 22 stdlib (`node:crypto`) ships HMAC-SHA256, `timingSafeEqual`, and `base64url` encoding with no additional surface area to audit or pin.

The implementation lives at `apps/backend/src/infrastructure/auth/candidate-signed-link.ts`. The WebSocket guard lives at `apps/backend/src/presentation/routes/interview-session.ws.ts`. Token issuance happens in two places: the `generatePlan` method of `RecruiterInterviewController` after plan generation succeeds, and the dedicated `issueCandidateLink` method behind `POST /interviews/:id/candidate-link`.

## Decision

Use stdlib HMAC-SHA256 over a `${interviewId}|${unixExpiry}` payload, base64url-encoded, joined with a dot separator and a base64url HMAC signature. Tokens are not persisted: they are regeneratable from `(secret, interviewId, expiry)` and their validity is checked purely in memory.

Token format: `base64url(payload).base64url(hmac_sha256(payload, secret))` where `payload = "${interviewId}|${unixExpiry}"`.

Issuance: two endpoints issue candidate links.

1. `POST /interviews/:id/plan` — the `generatePlan` controller method issues a token after the plan generation use case succeeds and returns it to the recruiter as `candidateLink.url` in the response body.
2. `POST /interviews/:id/candidate-link` — a dedicated re-issuance endpoint (Phase 8+) that mints a fresh 7-day token without touching the interview plan. Restricted to interviews in `SCHEDULED` or `IN_PROGRESS` status; returns HTTP 409 for any other status. Each call produces a new token with a new `exp` value; previously issued tokens remain valid until their individual TTL expires (no revocation per call — only `CANDIDATE_LINK_SECRET` rotation revokes all live tokens).

Multiple concurrent live tokens for the same interview are therefore possible. This is an explicit trade-off: stateless issuance keeps the system simple at the cost of inability to invalidate a single lost link (only full rotation). Acceptable for Phase 7–8; revisit if token-level revocation becomes a requirement.

The recruiter forwards the URL to the candidate out-of-band.

Verification on WebSocket upgrade: the `interview-session.ws.ts` route reads `?token=` from the query string, calls `candidateLink.verify(token)`, and closes the socket with code `1008` (policy violation) on any of: missing token, invalid signature, expired token, or `interviewId` mismatch between token payload and URL path parameter.

Rotation: replace `CANDIDATE_LINK_SECRET` in the environment. This invalidates all currently live candidate links. Acceptable for Phase 7 (single deployment, single recruiter cohort). Revisit if multiple parallel cohorts need isolated rotation.

Verification uses `timingSafeEqual` (Node.js `node:crypto`) to prevent timing side-channel attacks on the HMAC comparison (`apps/backend/src/infrastructure/auth/candidate-signed-link.ts:53`).

## Alternatives Considered

### Alternative A: better-auth anonymous sessions

Better-auth supports anonymous or guest sessions that persist a session row per visitor. This would reuse the already-present better-auth infrastructure (ADR-016) and give candidates a consistent session identity within the WebSocket lifetime.

Rejected because candidates are ephemeral. Creating persistent DB rows for every candidate introduces: storage churn proportional to interview volume, a TTL cleanup job, and a PII-adjacent record that has no downstream use case. The added complexity produces no product benefit over a stateless token that expires naturally.

### Alternative B: pure UUID as query parameter secret

Issue a random UUID at plan generation time, store it in the `interviews` table, and compare on WebSocket upgrade. Simple to implement; no crypto.

Rejected because: (1) there is no expiry mechanism without adding a separate `expires_at` column and checking it on every upgrade; (2) there is no scope binding beyond the stored UUID matching a row; (3) revocation without a revocation table requires deleting the UUID, which breaks all legitimate unjoined sessions simultaneously. The result is functionally equivalent to the HMAC approach but requires an extra DB column, an extra DB read on every WS upgrade, and no rotation path.

### Alternative C: JWT via the `jose` library

Issue a signed JWT (HS256) containing `{ interviewId, exp }`. JWTs are a well-understood standard and `jose` is the Node.js ecosystem's preferred JWT library.

Rejected because: (1) `jose` adds approximately 20 kB to the bundle and is an additional auditable dependency with its own release cadence; (2) the JWT standard introduces algorithm-confusion attack surface (`none` algorithm, RS256 vs HS256 confusion) that must be hardened explicitly; (3) the problem does not require JWT's richer claim vocabulary or interoperability with third-party verifiers. The HMAC approach implemented here provides equivalent security for this use case using audited stdlib primitives only.

### Alternative D: server-side session table with random token

Store randomly generated tokens in a dedicated `candidate_tokens` table keyed by `interviewId`. Verify on WebSocket upgrade with a DB lookup.

Rejected because it requires: a new DB migration, a TTL-based cleanup job, and a synchronous DB read on every WebSocket upgrade before the session thread is allocated. None of these properties are required. The stateless HMAC approach avoids all three at equivalent security.

### Alternative E: do nothing (rely on interview ID alone)

Allow any client that knows the interview UUID to join the WebSocket. The UUID is unguessable so it functions as a bearer credential.

Rejected because a bare UUID has no expiry and no scope binding beyond "knows the ID". A leaked URL grants permanent access. The HMAC token adds expiry and scope at zero operational cost.

## Consequences

**Benefits**

- Zero additional npm dependencies. Only `node:crypto` (Node 22 stdlib) is used.
- Stateless verification: no DB read on WebSocket upgrade, no cleanup job required.
- Revocation via `CANDIDATE_LINK_SECRET` rotation is a single environment-variable change with no schema migration.
- `timingSafeEqual` prevents timing side-channels on the HMAC comparison.
- Token is scoped to a specific `interviewId`: replay against a different interview ID is rejected at the path-parameter comparison step.

**Trade-offs**

- Rotating `CANDIDATE_LINK_SECRET` invalidates ALL live candidate links, including those not yet used. Planned mitigation: document the rotation procedure and schedule it only outside active interview windows. Revisit with per-cohort sub-keys if multi-cohort isolation is required.
- No per-token revocation (e.g., if a specific link leaks): the only revocation mechanism is rotating the shared secret, which has the blast radius described above.
- `CANDIDATE_LINK_SECRET` must be protected with the same operational care as `BETTER_AUTH_SECRET`. Loss of the secret does not expose past sessions (the token carries no sensitive payload), but it does allow token forgery until the secret is rotated.

**Risks and mitigations**

- *Risk*: `CANDIDATE_LINK_SECRET` leaked from the environment. *Mitigation*: rotate immediately; all prior links are invalidated. Secret should be stored in a secrets manager and injected at runtime, not committed to version control.
- *Risk*: Clock skew between the token-issuing process and the verifying process causes spurious expiry. *Mitigation*: both issue and verify run in the same process (single Node.js instance in Phase 7). Revisit if the issuer and verifier are separated across services.
- *Risk*: 7-day TTL is long enough for a leaked link to be abused before detection. *Mitigation*: `CANDIDATE_LINK_TTL_SECONDS` is configurable; high-sensitivity deployments can reduce it. Phase 7 scope has no automated link-distribution pipeline so the TTL must accommodate manual forwarding latency.

## Related Decisions

- **ADR-016 (Adopt better-auth for recruiter authentication)**: complementary auth surface. Recruiters authenticate via better-auth session cookies; candidates authenticate via HMAC-signed link. The two mechanisms are independent and guard different routes.
- **ADR-011 (Adopt @fastify/websocket v11 for WebSocket transport)**: the WebSocket transport being guarded. The `1008` close code is the WebSocket protocol's "policy violation" code and is appropriate for authentication failures.

## References

- Implementation: `apps/backend/src/infrastructure/auth/candidate-signed-link.ts`
- WebSocket guard: `apps/backend/src/presentation/routes/interview-session.ws.ts`
- Token issuance: `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (`generatePlan` method, line 95)
- Phase 7 plan resolved decisions 4 and 5: `.claude/plan/phase-7-presentation-and-auth.md`
- Node.js `timingSafeEqual` documentation: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- WebSocket close code 1008 (policy violation): https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "jose|jsonwebtoken|jwks",
      "path_glob": "apps/backend/src/infrastructure/auth/**",
      "message": "Candidate tokens use stdlib HMAC-SHA256 (ADR-017). Do not introduce JWT libraries into the auth infrastructure."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
