# Phase 8.0.5 — Candidate Link Re-issuance Endpoint Progress

## Phase 8.0.5 Complete

This document records the Phase 8.0.5 changes for ai-interviewer-agent.

Phase 8.0.5 goal:

- Add `POST /interviews/:id/candidate-link` — a stateless, recruiter-authenticated endpoint that mints a fresh 7-day HMAC-signed candidate session link without re-running Gemini or mutating the interview plan
- Gate issuance to `SCHEDULED` and `IN_PROGRESS` interviews; return HTTP 409 for any other status
- Wire the endpoint through all layers without changing the domain model, Drizzle schema, or existing composition surface

Plan source: `.claude/plan/candidate-link-reissuance.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — HMAC-signed candidate link; updated to document re-issuance endpoint and multi-token semantics
- [ADR-018](../adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — HTTP error mapping by error code; `INVALID_INTERVIEW_STATE_TRANSITION` → 409 reused for status gate
- [ADR-019](../adr/ADR-019-ownership-checks-in-presentation-not-application.md) — ownership checks in presentation; recruiter mismatch returns 404, not 403

---

## Summary

Added a dedicated candidate-link re-issuance endpoint across the application and presentation layers of the backend. One new use case (`IssueCandidateLinkUseCase`) handles the interview lookup and status gate; the controller mints the HMAC token and constructs the URL via a new private `buildCandidateLink` helper that de-duplicates the same logic already present in `generatePlan`. No domain changes, no schema migrations, and no new ports were required — `CandidateSignedLink` and `IInterviewRepository` were sufficient.

Explicitly **not** included in this work:

- Refactoring `GenerateInterviewPlanUseCase` to delegate link issuance to the new use case (noted as follow-up; would change existing signatures)
- Token-level revocation (stateless HMAC model; only `CANDIDATE_LINK_SECRET` rotation revokes all live tokens)
- Rate-limiting or per-recruiter issuance quotas

## Implementation Notes

`CandidateLinkIssuer` stays in the presentation layer rather than being promoted to a `@repo/application` port. The use case only needs `IInterviewRepository` to check status; token issuance is a transport concern. This matches the existing `generatePlan` pattern and avoids coupling the application layer to a token-string concept.

The status gate reuses `InvalidInterviewStateTransitionError` (→ HTTP 409). The constructor takes `(from, to)` and the `to` field is set to `SCHEDULED` as a "joinable-state" sentinel. The wire-contract response code (`INVALID_INTERVIEW_STATE_TRANSITION`) is the stable interface; the prose message ("Cannot transition from COMPLETED to SCHEDULED") is acceptable for Phase 8.

Multiple concurrent live tokens for the same interview are possible by design — each re-issuance call produces a new token with a new `exp`; prior tokens remain valid until their 7-day TTL expires.

---

## Files Touched

### 1. `packages/application/src/use-cases/interview/issue-candidate-link.use-case.ts`

What changed:
- New `IssueCandidateLinkUseCase` extending `UseCase<IssueCandidateLinkInput, IssueCandidateLinkOutput>`
- `IssueCandidateLinkInput: { interviewId: string }`, `IssueCandidateLinkOutput: { interviewId: string; status: InterviewStatus }`
- `LINK_ALLOWED_STATUSES: [SCHEDULED, IN_PROGRESS]` module-level constant
- Repository `Err` → `ServiceUnknownError`; `None` → `InterviewNotFoundError`; disallowed status → `InvalidInterviewStateTransitionError`

Why:
- Centralises the status gate so presentation cannot issue a link for a CREATED, COMPLETED, EVALUATED, or CANCELLED interview; enforcing this in the use case keeps the controller thin and the rule testable without an HTTP stack
- Returning `{ interviewId, status }` (not the full entity) keeps the application→presentation boundary narrow

Impact:
- `issueCandidateLinkUseCase.execute()` is the single authorised entry point for link issuance status validation; the controller and future callers cannot bypass it

### 2. `packages/application/src/use-cases/interview/issue-candidate-link.use-case.test.ts`

What changed:
- New Vitest unit suite: 9 tests covering SCHEDULED success, IN_PROGRESS success, not-found (`None`), repo error (`Err` → `ServiceUnknownError`), parameterised bad-status for CREATED/COMPLETED/EVALUATED/CANCELLED, and a no-side-effect assertion that `save` is never called

Why:
- Status-gate logic lives in the use case; testing it at this layer avoids needing an HTTP stack and confirms all four disallowed statuses explicitly
- `makeInterviewWithStatus(status)` uses `Interview.fromSerialized` to round-trip a fixture to an arbitrary status without chaining state-transition methods

Impact:
- 9 new tests added to `@repo/application` suite (113 total)

### 3. `packages/application/src/use-cases/interview/index.ts`

What changed:
- Added barrel exports: `IssueCandidateLinkUseCase`, `IssueCandidateLinkInput`, `IssueCandidateLinkOutput`

Why:
- `@repo/application` package root re-exports `./use-cases/index.js` via `export *`; adding to the sub-barrel is sufficient to make the new names reachable as `import { IssueCandidateLinkUseCase } from "@repo/application"`

Impact:
- `apps/backend` composition root and controller can import the use case without deep relative paths

### 4. `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`

What changed:
- Added `type IssueCandidateLinkOutput` import from `@repo/application`
- Added `issueCandidateLinkUseCase: UseCaseLike<{ readonly interviewId: string }, IssueCandidateLinkOutput>` to `RecruiterInterviewControllerDeps`
- Added `async issueCandidateLink(req, reply)` method: ownership check → use case execute → `buildCandidateLink` → `200 { url, token, expiresInSeconds }`
- Extracted `private buildCandidateLink(interviewId): { url, token, expiresInSeconds }` helper — eliminates the duplicated 3-line URL-building block that previously existed only in `generatePlan`; `generatePlan` now also calls this helper

Why:
- Ownership check in presentation (404 on mismatch) and error mapping via `sendError → mapServiceErrorToHttp` are non-negotiable per ADR-019 and ADR-018; placing token issuance and URL construction here (not in the use case) keeps the application layer free of transport-shaped concepts
- `buildCandidateLink` is extracted because the identical 3-line block appeared in two controller methods; a future route rename or query-param change is now made once

Impact:
- The `RecruiterInterviewControllerDeps` interface now requires `issueCandidateLinkUseCase`; any test that constructs deps without it will fail to type-check — acting as a compile-time reminder to wire the composition root

### 5. `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts`

What changed:
- Added `issueCandidateLinkUseCase` default mock to `makeDeps()`
- Added `describe("[Integration] … POST /interviews/:id/candidate-link")` block with 6 tests: 200 happy path (response shape + `candidateLink.issue` call assertion), 401 unauthed, 404 ownership mismatch, 404 use-case not-found, 409 bad-status

Why:
- Controller integration tests exercise the full HTTP stack (`buildApp` + `app.inject`), confirming that `requireRecruiter`, `getOwnedInterview`, `sendError`, and the response shape all wire together correctly at the Fastify layer

Impact:
- 6 new tests added to `backend` suite (222 total); the `issueSpy` assertion confirms `candidateLink.issue(INTERVIEW_ID)` is called with the correct argument — catching any regression that accidentally issues a token for the wrong id

### 6. `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts`

What changed:
- Registered `app.post<{ Params: { id: string } }>("/interviews/:id/candidate-link", { preHandler: requireRecruiter }, (req, reply) => controller.issueCandidateLink(req, reply))`

Why:
- Route registration is the only change needed at the routing layer; `requireRecruiter` provides 401/403 enforcement before the controller is reached, consistent with all other recruiter routes

Impact:
- `POST /interviews/:id/candidate-link` is now a live endpoint in the Fastify application

### 7. `apps/backend/src/composition/recruiter-interview.composition.ts`

What changed:
- Added `IssueCandidateLinkUseCase` to the `@repo/application` import block
- Added `issueCandidateLinkUseCase: new IssueCandidateLinkUseCase(interviews)` to the returned `RecruiterInterviewControllerDeps` object

Why:
- The composition root is the only place where application use cases are instantiated with concrete repository implementations; adding it here with the existing `interviews` Drizzle repo is the single change needed to wire the full request path

Impact:
- `buildRecruiterInterviewDeps` now satisfies the updated `RecruiterInterviewControllerDeps` interface; the new endpoint is live for all server instances constructed via this factory

### 8. `docs/adr/ADR-017-candidate-access-via-hmac-signed-link.md`

What changed:
- Status flipped from `Proposed` to `Accepted, 2026-05-15`
- Context section updated: stale reference to `generatePlan` as the sole issuance site replaced with a description of both endpoints
- Decision section "Issuance" paragraph expanded to document the re-issuance endpoint, the `SCHEDULED`/`IN_PROGRESS` status gate, the 7-day TTL per token, and the multiple-concurrent-token trade-off

Why:
- ADR-017 previously stated token issuance happened only in `generatePlan`; this was factually wrong after the new endpoint was added; the ADR is the authoritative record of the link-lifecycle contract and must stay accurate
- Multiple concurrent live tokens is an explicit architectural commitment (not a side-effect) — documenting it prevents a future developer from adding per-call revocation and discovering the stateless model doesn't support it without a DB table

Impact:
- Future developers and the `adr-judge` pre-commit hook now have an accurate description of both issuance paths and the multi-token trade-off

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Results:

- application tests: **113 passed** (9 new)
- backend tests: **222 passed** (6 new)
- type-check passed for `@repo/domain`, `@repo/application`, `backend`

Architecture checks:
- `backend-arch-validator application` — CLEAN (no forbidden imports, no throw/catch, no T|null)
- `backend-arch-validator presentation` — CLEAN (no infra imports in presentation, no infra imports in composition that violate the convention)

---

## Code Review

`backend-code-reviewer` returned **PASS** on first submission.

Checks confirmed:
- Package/layer boundaries clean across all 7 source files
- FP/Result discipline: no `throw`, no `try/catch`, no `T | null` in application layer; `Result`/`Option` used throughout
- Error hierarchy correct: `InterviewNotFoundError` and `InvalidInterviewStateTransitionError` are `DomainError` subtypes; `ServiceUnknownError` extends `ServiceInfraError`; `as ServiceError` casts are type-widening only
- Barrel exports propagate correctly via `export *` chain
- Test classification: use-case tests mock only `IInterviewRepository`; controller tests are integration-level via `buildApp + app.inject`; `save` no-op assertion confirms stateless behaviour

Final test counts: application **113 passed**, backend **222 passed**.

---

## Notes

- The double DB read (one in `getOwnedInterview` + one in `IssueCandidateLinkUseCase.execute`) is a known inefficiency. The simplify review flagged it. The architecture's clean boundary between presentation and application prevents passing a pre-fetched entity into the use case without introducing a new port shape; the cost (one extra indexed primary-key lookup per request) is acceptable for Phase 8.
- `GenerateInterviewPlanUseCase` still issues the candidate link inline in the controller. The `buildCandidateLink` helper is now shared, but the plan use case is not refactored to delegate to `IssueCandidateLinkUseCase`. Noted for a future cleanup pass.
