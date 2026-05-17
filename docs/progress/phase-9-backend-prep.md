# Phase 9 Backend Prep Progress

## Phase 9 Backend Prep Complete

This document records the Phase 9 backend preparation changes for ai-interviewer-agent.

Phase 9 backend prep goal:

- Add `GET /interviews/:id/candidate-view?token=<base64url>` — a public (no `requireRecruiter`) HTTP endpoint that lets a candidate fetch their interview's identity card after presenting a valid HMAC-signed token
- Update `buildCandidateLink` in `RecruiterInterviewController` so recruiter-issued candidate URLs point at the new frontend route `/c/:id` instead of the legacy WebSocket-bound path `/interviews/:id/session`

Plan source: `.claude/plan/phase-9-backend-prep.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — HMAC-signed candidate link: token format, TTL, and `CandidateSignedLink.verify` interface consumed (not modified)
- [ADR-018](../adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — HTTP error mapping by error code: `INVALID_CANDIDATE_TOKEN → 401` and `INTERVIEW_NOT_FOUND → 404` already present in the exhaustive table; no new codes added
- [ADR-019](../adr/ADR-019-ownership-checks-in-presentation-not-application.md) — Ownership checks in presentation: candidate-view endpoint deliberately has no ownership check — token presence is the auth; use case takes only `{ interviewId }` with no token parameter

---

## Summary

Added the first public (unauthenticated) REST endpoint in the backend: `GET /interviews/:id/candidate-view?token=…` returns a minimal projection of the `Interview` entity — candidate name, job title, company, scheduled time, duration, and status — after verifying the HMAC token and binding it to the path `id`. Token verification and interviewId binding live in the new `CandidateInterviewController`; the `GetCandidateInterviewViewUseCase` only receives `{ interviewId }`. Also changed the candidate-link URL path from `/interviews/${id}/session` to `/c/${id}` in `RecruiterInterviewController.buildCandidateLink`, aligning the recruiter-issued shareable URL with the Phase 9 candidate frontend route namespace.

Explicitly **not** included in this work:

- WebSocket session resumption or mid-call reconnection logic (Phase 10)
- TTS sample endpoint for the pre-interview device check (Phase 9 frontend ships a pre-baked MP3)
- Transcript-toggle preference persistence (frontend `localStorage` sufficient)
- Any change to the WebSocket wire protocol or the `GET /interviews/:id/session` WS path
- Email delivery of the candidate link (deferred per `project_email_resend_decision.md`)

---

## Implementation Notes

The candidate-view endpoint is the first REST route in the codebase with no `requireRecruiter` preHandler — the only prior public surface was the WebSocket upgrade. The `composeDefaults` gate in `app.ts` was extended to include `!options.candidateInterviews` so the new block follows the same opt-in pattern as `recruiterInterviews` and `recruiterDocuments`; `interviewSession` remains unconditionally registered (pre-existing behaviour, not changed here).

The `buildCandidateLink` URL change is a breaking change for any in-flight candidate links issued before Phase 9 deploys. Acceptable for pre-GA; would require a migration or dual-path support post-GA.

`targetDurationMinutes` is projected from `Option<InterviewPlan>` to `number | null` only at the use-case output boundary — matching the established `InterviewSerialized` pattern where `Option` collapses to `T | null` at the persistence/wire shape.

---

## Files Touched

### 1. `packages/application/src/use-cases/interview/get-candidate-interview-view.use-case.ts`

What changed:
- New `GetCandidateInterviewViewUseCase` extending `UseCase<GetCandidateInterviewViewInput, GetCandidateInterviewViewOutput>`
- Input: `{ interviewId: string }`
- Output: `{ view: CandidateInterviewView }` where `CandidateInterviewView` carries `interviewId`, `candidateName`, `jobTitle`, `company`, `scheduledAt` (ISO-8601 string), `targetDurationMinutes` (`number | null`), `status` (`InterviewStatus`)
- `interview.interviewPlan.match({ Some: plan => plan.targetDurationMinutes, None: () => null })` collapses the domain `Option<InterviewPlan>` to the wire-compatible `number | null`
- Repository errors translated to `ServiceUnknownError("...", "InterviewRepository.findById")` at the application boundary; `Option.None` maps to `InterviewNotFoundError`

Why:
- Token verification must not leak into the application layer (ADR-019); the use case receives only an interview id and returns a read-only projection — no auth concern in the domain or application
- `InterviewNotFoundError` (not a 403) is the correct response for a missing interview, consistent with the 404-masking ownership policy used throughout the recruiter routes

Impact:
- `GetCandidateInterviewViewUseCase`, `GetCandidateInterviewViewInput`, `GetCandidateInterviewViewOutput`, and `CandidateInterviewView` are exported from `@repo/application` via the barrel chain; the presentation layer and tests import them directly

### 2. `packages/application/src/use-cases/interview/index.ts`

What changed:
- Appended export block for `GetCandidateInterviewViewUseCase`, `GetCandidateInterviewViewInput`, `GetCandidateInterviewViewOutput`, and `CandidateInterviewView`

Why:
- All new public types must be reachable via `@repo/application`; the barrel chain `interview/index.ts → use-cases/index.ts → index.ts` already uses `export *`, so adding to this file is sufficient

Impact:
- Downstream packages (`apps/backend`) can import the new use case and its types with a single `@repo/application` import

### 3. `apps/backend/src/presentation/controllers/candidate-interview.controller.ts`

What changed:
- New `CandidateInterviewController` with a single `getView(req, reply)` method
- Defines `CandidateLinkVerifier` structural interface (`verify(token): Result<{ interviewId }, ServiceError>`) and `CandidateInterviewControllerDeps`
- Deps type uses `GetCandidateInterviewViewInput` (not an anonymous inline shape) to stay in sync with the use-case input interface
- Four guard clauses with early returns: missing token → 401, failed verify → 401, interviewId mismatch → 401, use-case error → mapped via `mapServiceErrorToHttp`
- `const { interviewId } = verifyResult.unwrap()` destructures once after the `isErr()` guard (no double-unwrap)
- All errors funnel through the module-private `sendError` helper (same pattern as `RecruiterInterviewController`)

Why:
- Separating this from `RecruiterInterviewController` keeps the auth model explicit: the recruiter controller requires a session; this controller requires only a valid signed token. Mixing them would obscure the two distinct access models in one file.
- Token verification in the controller is consistent with ADR-019: presentation owns auth/authz checks; the application use case is deliberately unaware of the token.

Impact:
- `CandidateInterviewControllerDeps` and `CandidateLinkVerifier` exported for composition and tests

### 4. `apps/backend/src/presentation/routes/candidate-interviews.routes.ts`

What changed:
- New `registerCandidateInterviewRoutes` Fastify plugin registering `GET /interviews/:id/candidate-view` with no `preHandler`
- Instantiates `CandidateInterviewController` once at plugin-registration time (not per request)

Why:
- Route files in this project are thin plugin wrappers; all logic lives in the controller. No `preHandler: requireRecruiter` because the endpoint is public — the token in the query string is the only credential.

Impact:
- Registered in `app.ts` with `prefix: ""` so the final path is `/interviews/:id/candidate-view`, not colliding with the WS prefix `/interviews`

### 5. `apps/backend/src/composition/candidate-interview.composition.ts`

What changed:
- New `buildCandidateInterviewDeps(options)` wiring `DrizzleInterviewRepository` + `GetCandidateInterviewViewUseCase` + the injected `CandidateLinkVerifier` into `CandidateInterviewControllerDeps`
- Accepts optional `db` override (same `createRequire` lazy-load pattern as `recruiter-interview.composition.ts`)

Why:
- The composition root is the only permitted location where infrastructure (`DrizzleInterviewRepository`) and presentation types (`CandidateInterviewControllerDeps`) meet — consistent with every other composition file in the project

Impact:
- `buildCandidateInterviewDeps` is called from `app.ts` under the `composeDefaults` gate when a `candidateLink` is available; tests pass a mock `CandidateLinkVerifier` directly

### 6. `apps/backend/src/app.ts`

What changed:
- `RegisterCandidateInterviewRoutesOptions` imported from the new routes module
- `candidateInterviews?: RegisterCandidateInterviewRoutesOptions` added to `BuildAppOptions`
- `!options.candidateInterviews` added to the `composeDefaults` conjunction
- New `candidateInterviews` lazy-compose block after `recruiterDocuments` (same conditional `await import(...)` pattern, gated on `composeDefaults && authDeps?.candidateLink`)
- Registered with `prefix: ""` to avoid inheriting the `/interviews` WS prefix

Why:
- Extending `BuildAppOptions` with an optional block keeps each route group independently injectable for tests — callers that don't care about the candidate routes pass nothing and the block is a no-op

Impact:
- In production (`composeDefaults` = true): candidate routes are auto-wired alongside recruiter routes whenever `authDeps.candidateLink` is present. In tests: callers pass `candidateInterviews: { deps }` directly with mocked deps.

### 7. `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`

What changed:
- Single line in `buildCandidateLink`: `new URL(\`/interviews/${interviewId}/session\`, ...)` → `new URL(\`/c/${interviewId}\`, ...)`

Why:
- The Next.js App Router `(recruiter)` route group already owns `/interviews/[id]`. The candidate frontend lives under `/c/[id]/...` to avoid a route-group collision. The shareable link must match the actual frontend URL. The backend WS path (`/interviews/:id/session`) is unaffected.

Impact:
- All recruiter-issued candidate links now point at `/c/<id>?token=…`. Existing in-flight links issued before this deploy will land on a 404 until the frontend for `/c/[id]` is deployed (Phase 9 frontend).

### 8. `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts`

What changed:
- `POST /interviews/:id/plan` happy-path test: added `expect(body.candidateLink.url).toContain(\`/c/${INTERVIEW_ID}\`)` and `expect(body.candidateLink.url).not.toContain("/session")`
- `POST /interviews/:id/candidate-link` happy-path test: same two assertions added

Why:
- The new assertions pin the exact URL shape so any future regression to the old `/session` path is caught at CI time rather than silently shipping

Impact:
- Tests now guard both the positive (`/c/<id>` present) and negative (`/session` absent) invariants of the URL change

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/application   # 116 passed (1 pre-existing failure unrelated to Phase 9)
pnpm turbo run test --filter=backend             # 240 passed
```

Results:

- application tests: **116 passed** (1 pre-existing failure: `CreateInterviewInputDto > returns Err when jdFileRef.uploadedAt is not a Date` — `z.coerce.date()` accepts ISO strings; present before Phase 9, unrelated to these changes)
- backend tests: **240 passed** (includes 8 new `candidate-interview.controller.test.ts` tests and 2 updated `recruiter-interview.controller.test.ts` assertions)
- type-check passed for `@repo/domain`, `@repo/application`, `backend`

Architecture checks:
- `backend-arch-validator application`: CLEAN — no forbidden imports, no `throw`/`try-catch` in use case, `Option.match` used correctly
- `backend-arch-validator presentation`: CLEAN — controller imports only `@repo/application` + `fastify` + presentation-internal error mapper; composition root is the only infrastructure/presentation crossover point

---

## Code Review

`backend-code-reviewer` returned **PASS** on first submission.

All eight verification points confirmed clean: layer boundary, FP correctness, error hierarchy, token verification scope, no `requireRecruiter` on the public route, test coverage for all error paths and the happy path, `GetCandidateInterviewViewInput` used in deps type, single `unwrap()` via destructuring after guard.

---

## Notes

- `sendError` helper and `UseCaseLike<I,O>` interface are structurally duplicated across three controller files (`recruiter-interview`, `recruiter-document`, `candidate-interview`). These are pre-existing patterns; Phase 9 follows the convention. Extracting them to a shared `apps/backend/src/presentation/utils/` module is a worthwhile follow-up refactor but out of scope here.
- `app.ts` registers `interviewSession` unconditionally (no `composeDefaults` gate), unlike every other route block. This pre-existing inconsistency is now visible by contrast with the `candidateInterviews` block. A follow-up should add the same conditional guard.
- The `/c/<id>` URL change is a breaking change for any candidate links issued before this deploy. Flag at release time if any live links exist.
