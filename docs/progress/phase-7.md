# Phase 7 — REST Presentation Layer, Recruiter Auth, and Candidate Signed Links Progress

## Phase 7 Complete

This document records the Phase 7 changes for the **AI interviewer** monorepo, scoped to REST presentation, recruiter auth, candidate signed-link access, and the full test/ADR/review cycle.

Phase 7 goal:

- expose Phase 1–6 backend capabilities through Fastify HTTP routes
- add recruiter email/password authentication with Better Auth
- remove public `recruiterId` spoofing from interview creation
- issue HMAC-signed candidate interview links after plan generation
- guard the existing candidate WebSocket route with signed tokens
- add composition roots for REST-facing use cases
- add Better Auth persistence tables and migration
- author ADRs 016–019 and verify against the codebase

Plan source: `.claude/plan/phase-7-presentation-and-auth.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs authored:
- [ADR-016](../adr/ADR-016-adopt-better-auth-for-recruiter-authentication.md) — adopt `better-auth` v1.6+ with Drizzle adapter for recruiter email/password sessions
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — candidate access via stdlib HMAC-SHA256 signed link, not a user account
- [ADR-018](../adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — HTTP error mapping by `code` string with exhaustive `STATUS_BY_CODE` table
- [ADR-019](../adr/ADR-019-ownership-checks-in-presentation-not-application.md) — recruiter ownership checks in presentation layer; mismatch returns 404, not 403

---

## Summary

Completed:

- **Application — new service errors:** `UnauthorizedError`, `InvalidCandidateTokenError`, `ForbiddenError` added as `ServiceInfraError` subclasses; barrels updated.
- **Application — DTO split:** `CreateInterviewInputDto` public schema drops `recruiterId`; `CreateInterviewExecuteInput` interface carries it for controller-assembled input. `CreateInterviewUseCase` updated to consume the execute input.
- **Application — read use cases:** `GetInterviewByIdUseCase` and `ListInterviewsByRecruiterUseCase` added as thin repository wrappers; both exported from `@repo/application`.
- **Infrastructure — Better Auth:** `auth.ts` factory, `auth-env.ts` env-loader (returns `Result`), Drizzle auth schema (`users`, `sessions`, `accounts`, `verifications` tables in `schema/auth.ts`), schema barrel re-export.
- **Infrastructure — candidate signed link:** `CandidateSignedLink` class using stdlib HMAC-SHA256, 7-day default TTL, `timingSafeEqual` verification, `candidateSignedLinkFromEnv` factory. No external deps.
- **Infrastructure — migration:** `0002_opposite_proemial_gods.sql` generated via `drizzle-kit` and applied against the dev database.
- **Composition roots:** `auth.composition.ts` (`buildAuthDeps`), `create-interview.composition.ts`, `generate-interview-plan.composition.ts`, `upload-candidate-documents.composition.ts`, `extract-candidate-documents.composition.ts`, `recruiter-interview.composition.ts`, `recruiter-document.composition.ts`.
- **Presentation — auth plugin:** `installAuthPlugin` (session decorator via `better-auth` `getSession`), `requireRecruiter` preHandler (401 on missing session), `better-auth-mount.ts` (Fastify → Web Standard Request shim for `/api/auth/*`), `assert-recruiter-owns-interview.ts` (ownership → 404 hiding).
- **Presentation — HTTP error mapper:** `mapServiceErrorToHttp` with exhaustive `STATUS_BY_CODE` table (25 codes), `installErrorHandler` Fastify global handler.
- **Presentation — recruiter routes:** `RecruiterInterviewController` (create/list/get/generatePlan/evaluate/getReport) and `RecruiterDocumentController` (upload/extract) with full routes.
- **Presentation — WS token guard:** `interview-session.ws.ts` modified to verify candidate token before delegating to `InterviewSessionController`; closes with `1008` on missing/invalid/mismatched token.
- **App wiring:** `app.ts` registers multipart, WebSocket, auth plugin, Better Auth mount, error handler, recruiter routes, and guarded WS route. Test-friendly: all deps injectable; `composeDefaults` path used only when no deps are passed.
- **Tests:** 97 new tests across 7 files; all passing.
- **ADRs:** ADR-016 through ADR-019 authored and verified by `adr-judge` (0 violations, 12 ADRs checked including 9 `llm_judge` ADRs).

Explicitly **not** included in this work:

- email verification (`requireEmailVerification` disabled — no mail provider in Phase 7)
- rate limiting on `/api/auth/*` (Phase-10 prerequisite, documented in ADR-016)
- CORS policy (`@fastify/cors` deferred until Phase 8 frontend origin is known, documented in ADR-016)
- FK from `interviews.recruiter_id` to `users.id` (deferred — documented in ADR-019)
- frontend authentication or recruiter dashboard work
- OAuth, 2FA, organizations

---

## Implementation Notes

Better Auth 1.6.10 requires `drizzle-orm` `^0.45.2`; backend `drizzle-orm` was upgraded from the previous 0.44 line while preserving the existing Drizzle schema style.

`CandidateSignedLink` is stateless (tokens are not persisted). Rotation = rotate `CANDIDATE_LINK_SECRET`. `timingSafeEqual` prevents timing side-channels on signature comparison.

Recruiter ownership checks intentionally live in presentation. Controllers call `GetInterviewByIdUseCase`, compare `interview.recruiterId === session.userId`, and respond 404 on mismatch (existence hiding per OWASP BOLA guidance, documented in ADR-019).

`buildApp()` composes production dependencies only when no deps are passed (`composeDefaults` flag). Tests pass lightweight mocked deps without triggering auth/env/DB setup.

The test generator produced type errors in two controller test files (`Parameters<typeof buildApp>[0]["authDeps"]` and `InstanceType<typeof CreateInterviewInputDto>`) caused by default-parameter optionality inference and the protected `BaseDto` constructor. Fixed by importing `BuildAppOptions` directly and casting to `any` at the test-fixture boundary.

---

## Verification

Commands run and passing:

```bash
# Migration
pnpm --filter backend db:migrate

# Type-check
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Application tests (focused Phase 7 surface)
pnpm --filter @repo/application test -- \
  src/dtos/create-interview.dto.test.ts \
  src/use-cases/interview/get-interview-by-id.use-case.test.ts \
  src/use-cases/interview/list-interviews-by-recruiter.use-case.test.ts \
  src/use-cases/interview/create-interview.use-case.test.ts

# Backend Phase 7 tests
pnpm --filter backend test -- \
  src/infrastructure/auth/candidate-signed-link.test.ts \
  src/infrastructure/auth/auth-env.test.ts \
  src/presentation/errors/http-error-mapper.test.ts \
  src/presentation/auth/auth-plugin.test.ts \
  src/presentation/controllers/recruiter-interview.controller.test.ts \
  src/presentation/controllers/recruiter-document.controller.test.ts \
  src/presentation/routes/interview-session.ws.test.ts
```

Results:

- application focused tests: **20 passed**
- backend Phase 7 tests: **97 passed** (7 files)
- type-check passed for `@repo/domain`, `@repo/application`, and `backend`
- Drizzle migration applied successfully (`0002_opposite_proemial_gods.sql`)
- ADR judge: **0 violations** (12 ADRs checked, 9 `llm_judge` ADRs via Sonnet)

Pre-existing failures (unrelated to Phase 7): `drizzle-interview.repository.test.ts` and `drizzle-report.repository.test.ts` fail with `ECONNREFUSED` when no test Postgres instance is running.

Architecture checks:

- no presentation imports from infrastructure (except type-only via composition injection)
- no application/domain imports from backend/infrastructure/presentation
- no new `try/catch` in production application or infrastructure files (boot-time throws in composition are the approved pattern)
- `recruiterId` injected from `req.session.userId` only — never from `req.body`

---

## Code Review

`backend-code-reviewer` returned **PASS** on first pass.

Non-blocking style notes (not addressed):
- `get-interview-by-id.use-case.ts` and `list-interviews-by-recruiter.use-case.ts` use imperative `if (isErr()) return` instead of a full `flatMap` chain. Functionally equivalent; correcting to pure chain style is a future cleanup item.
- Controller test fixtures call `.unwrap()` on VO factory calls without a preceding `isOk()` assertion; consistent with the existing test pattern across the codebase.

---

## Notes

`DATABASE_URL` must be exported into the shell before running `pnpm --filter backend db:migrate`. The dev database now has the four better-auth tables (`users`, `sessions`, `accounts`, `verifications`).

ADRs 016–019 are in `Status: Proposed`. Flip to `Accepted` after human review per the adr-kit workflow.

Phase 10 prerequisites recorded in ADR-016: email verification, rate limiting on auth routes, CORS allowlist.
