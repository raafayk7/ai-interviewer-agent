# ADR-016 Adopt better-auth for Recruiter Authentication

## Status

Proposed. Date: 2026-05-12.

## Context

Phase 7 exposes backend capabilities over HTTP and introduces the first authenticated surface: recruiter sign-up and sign-in. The system is a self-hosted TypeScript/Fastify 5 backend on Node 22 using Drizzle ORM and PostgreSQL.

Authentication requirements for Phase 7 are:

- Email and password only (no social providers in this phase).
- Session-based (cookie-backed, server-side session table).
- Self-hostable (no outbound vendor SaaS calls on the critical path).
- Compatible with Drizzle ORM and PostgreSQL without a separate ORM or migration tool.
- No coupling to any UI framework (Phase 8 will add a React frontend; its origin and OAuth callback shape are not yet known).

Phase 7 explicitly defers the following, which constrain the allowed configuration:

- Email verification (no email provider wired yet; Resend is planned for Phase 8+, see ADR memory entry "Email/Resend decision").
- Rate limiting on auth endpoints (planned for Phase 10).
- CORS policy (`@fastify/cors` allowlist cannot be written until the Phase 8 frontend origin is known).
- OAuth callback routes (no frontend exists to receive the redirect).

Additionally, `recruiterId` in the `interviews` table is stored as plain text rather than a foreign key to `users.id`. This is an intentional Phase 7 constraint to avoid cross-schema migration ordering complexity while no recruiter-delete flow exists.

The implemented integration is visible in `apps/backend/src/infrastructure/auth/auth.ts` (the `createAuth` factory), `apps/backend/src/composition/auth.composition.ts` (`buildAuthDeps`), and the Drizzle migration `apps/backend/drizzle/0002_opposite_proemial_gods.sql` which creates the `users`, `sessions`, `accounts`, and `verifications` tables.

## Decision

Use `better-auth` v1.6+ with the Drizzle PostgreSQL adapter and email/password plugin. Mount the handler at `/api/auth/*`. Disable email verification, social providers, two-factor authentication, and organisation plugins in Phase 7.

The `better-auth` instance is created by `createAuth()` in `apps/backend/src/infrastructure/auth/auth.ts`. It is composed at boot time through `buildAuthDeps()` in `apps/backend/src/composition/auth.composition.ts`. The Drizzle adapter maps to the four `better-auth` managed tables (`users`, `sessions`, `accounts`, `verifications`) created by migration `0002_opposite_proemial_gods.sql`.

This decision scopes only to the recruiter authentication surface. Candidate access is handled separately via HMAC-signed links (see ADR-017). The decision does not cover rate limiting, CORS, email verification, or social OAuth, all of which are deferred to later phases.

## Alternatives Considered

### Alternative A: Lucia

Lucia is a TypeScript auth library that supports Drizzle and session-based flows natively. It was eliminated because the library entered maintenance mode in late 2024 and the maintainer has publicly stated it will not receive new features or active bug fixes. Adopting a maintenance-mode library as the single point of failure for recruiter authentication introduces unacceptable long-term risk; security vulnerabilities discovered after the maintenance freeze would require a full auth migration anyway.

### Alternative B: Clerk

Clerk is a vendor-hosted authentication SaaS with a generous free tier and strong TypeScript support. It was eliminated on two grounds: (1) it requires outbound API calls to Clerk infrastructure for every authentication event, violating the self-hostability requirement; (2) its billing is per monthly active user, creating an unbounded cost surface the project does not accept at this stage.

### Alternative C: Auth.js (NextAuth v5)

Auth.js v5 provides Drizzle and PostgreSQL adapters and supports credential-based flows. It was eliminated because the library's request/response model is deeply coupled to the Next.js Web API fetch shape. Adapting it to Fastify 5 requires maintaining a custom bridge between Fastify's `Reply` and the standard `Response` object, and this bridge must be updated whenever either library changes its internals. The ongoing maintenance cost of this glue layer is not justified when purpose-built Fastify-compatible alternatives exist.

### Alternative D: DIY session authentication

Building session management with `crypto.randomBytes` for token generation, a manual Drizzle session table, and bcrypt via `bcryptjs` would avoid the `better-auth` dependency entirely. It was eliminated because of the high implementation cost and the expanded security surface: correct session token storage, rotation on privilege escalation, fixation attack prevention, and safe token comparison all require careful implementation. `better-auth` handles each of these correctly by default and has been audited by the open-source community. The DIY approach would replicate this work with no architectural benefit.

### Alternative E: Do nothing (no auth in Phase 7)

Deferring authentication to Phase 8 when the frontend exists was considered. It was rejected because Phase 7 exposes HTTP routes for recruiter-specific operations (creating interviews, uploading documents). Operating without authentication would require either exposing these routes publicly (unacceptable) or protecting them via non-standard mechanisms (API key header) that would need to be replaced when real auth arrives. Implementing auth now costs less than retrofitting it later and removes the risk of leaking recruiter data through unauthenticated endpoints.

## Consequences

**Benefits**

- Self-hostable with no outbound vendor dependency on the authentication critical path.
- Drizzle-native adapter: `better-auth` generates and manages its four tables through the existing Drizzle + PostgreSQL stack with no additional ORM.
- Email/password is a first-class plugin; password hashing (bcrypt with configurable cost) is handled by the library, not application code.
- Incremental: OAuth providers, two-factor authentication, and organisation features can be enabled via additional plugins without architectural change to the session or user model.
- Session decoration in the Fastify presentation layer is a thin wrapper; the `better-auth` instance stays in the infrastructure layer, consistent with ADR-001 layer boundaries.

**Trade-offs**

- `better-auth` adds one runtime dependency (`better-auth` package) and four new PostgreSQL tables (`users`, `sessions`, `accounts`, `verifications`).
- The Drizzle adapter requires the four table references to be passed explicitly to `drizzleAdapter()` (see `apps/backend/src/infrastructure/auth/auth.ts:16-23`); adding new `better-auth` plugins that require additional tables means updating this mapping.
- `recruiterId` in `interviews` is plain text, not a foreign key to `users.id`. Orphaned rows will accumulate if recruiter accounts are deleted. This is acceptable while no recruiter-delete flow exists but must be resolved before exposing a delete endpoint.

**Risks and mitigations**

- *Risk*: Email verification is disabled, so any email-shaped string can register a recruiter account. *Mitigation*: The backend is not publicly exposed in Phase 7. Re-enable `requireEmailVerification` in `better-auth` configuration once Resend is wired in Phase 8+.
- *Risk*: No rate limiting on `/api/auth/*` means credential-stuffing attacks can run at full network speed. The only cost imposed on an attacker is the bcrypt verification cost on sign-in. *Mitigation*: Add `@fastify/rate-limit` scoped to auth routes before any public exposure (Phase 10 prerequisite). The bcrypt cost factor provides time-based deterrence in the interim.
- *Risk*: No CORS policy means any origin can make cross-site requests to `/api/auth/*` in a browser context. `BETTER_AUTH_URL` trusted-origin check is the only origin guard in Phase 7. *Mitigation*: Add `@fastify/cors` with an explicit allowlist when the Phase 8 frontend origin is known. Do not set `BETTER_AUTH_URL` to a wildcard.
- *Risk*: `better-auth` is a younger library (v1.x) with a smaller community than Auth.js or Passport. A breaking change in the Drizzle adapter or session shape would require migration work. *Mitigation*: Pin to a minor version range (`^1.6`), subscribe to `better-auth` releases, and verify the adapter mapping after each upgrade.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: the `better-auth` instance is created in the infrastructure layer (`apps/backend/src/infrastructure/auth/`), composed at boot, and session validation occurs in the presentation layer. This respects the inward dependency rule: no auth concern leaks into application or domain packages.
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: the complementary auth surface for candidates. ADR-016 covers recruiter sessions; ADR-017 covers stateless candidate access. The two mechanisms coexist without conflict.

## References

- `better-auth` documentation: https://www.better-auth.com/docs
- `better-auth` Drizzle adapter: https://www.better-auth.com/docs/adapters/drizzle
- Implementation: `apps/backend/src/infrastructure/auth/auth.ts`
- Composition root: `apps/backend/src/composition/auth.composition.ts`
- Drizzle migration: `apps/backend/drizzle/0002_opposite_proemial_gods.sql`
- Phase 7 plan: `.claude/plan/phase-7-presentation-and-auth.md` (resolved questions 8, 9, 10)

## Enforcement

```json
{
  "forbid_import": [
    {
      "pattern": "lucia",
      "path_glob": "apps/backend/src/**",
      "message": "Use better-auth (ADR-016). Lucia is in maintenance mode and will not receive security fixes."
    },
    {
      "pattern": "next-auth|@auth/core",
      "path_glob": "apps/backend/src/**",
      "message": "Use better-auth (ADR-016). Auth.js is coupled to the Next.js request/response shape and requires a fragile Fastify bridge."
    },
    {
      "pattern": "@clerk/",
      "path_glob": "apps/backend/src/**",
      "message": "Use better-auth (ADR-016). Clerk is vendor-hosted and violates the self-hostability requirement."
    }
  ],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```
