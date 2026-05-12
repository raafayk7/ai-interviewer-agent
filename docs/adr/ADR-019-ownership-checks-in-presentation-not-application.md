# ADR-019 Recruiter Ownership Checks Live in the Presentation Layer, Not the Application or Domain Layer

## Status

Proposed. Date: 2026-05-12.

## Context

Multiple REST endpoints must ensure that a recruiter can only access their own interviews. The `Interview` aggregate contains a `recruiterId` field (an opaque string that currently equals the better-auth `users.id`). The session context (`req.session.userId`) is available only within the HTTP request cycle — it is not a domain or application concept.

A decision was needed about where to enforce `interview.recruiterId === session.userId`: in the domain entity, in the application use case, or in the presentation layer.

Additionally, the phase-7 plan explicitly prohibits controllers from forwarding `recruiterId` from `req.body` into `CreateInterviewExecuteInput.recruiterId`. The session `userId` must be the only authoritative source for that field, to prevent recruiter-identity spoofing by a malicious client.

Implementation reference: `apps/backend/src/presentation/auth/assert-recruiter-owns-interview.ts` and `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (`getOwnedInterview` private method).

## Decision

Ownership enforcement lives entirely in the presentation layer. Controllers fetch the aggregate via `GetInterviewByIdUseCase`, then call `assertRecruiterOwnsInterview(interview, req.session.userId)`, and on mismatch respond with HTTP 404 (not 403) to avoid existence disclosure. The use case is agnostic of who is asking. `recruiterId` is never accepted from `req.body` — controllers inject it exclusively from `req.session.userId`.

The helper `assertRecruiterOwnsInterview` in `apps/backend/src/presentation/auth/assert-recruiter-owns-interview.ts` encapsulates the comparison and returns `Result<InterviewSerialized, InterviewNotFoundError>`, so the controller can remain in the Result chain without manual branching.

This rule is in scope for all recruiter-scoped endpoints that operate on an interview identified by `req.params.id`. It does not affect admin or service-to-service paths (none exist in phase 7).

## Alternatives Considered

### Alternative A: Ownership predicate on the Interview aggregate

The domain entity exposes `isOwnedBy(recruiterId: string): boolean`. The caller (use case or controller) invokes it before proceeding.

Rejected because the domain entity would gain knowledge of a string type whose semantic identity is defined by the better-auth infrastructure layer. The `recruiterId` field is already on the entity as a storage field; encoding ownership semantics against an externally-sourced identity concept couples the domain implicitly to an infrastructure/auth concern. Domain purity is the load-bearing guarantee of the architecture (ADR-001).

### Alternative B: Use cases enforce ownership by accepting a requestingRecruiterId input parameter

Use cases accept a `requestingRecruiterId` parameter alongside the target interview ID and return `ForbiddenError` or `NotFoundError` when ownership fails.

Rejected because this introduces HTTP session identity into the application layer. Use cases become untestable without constructing better-auth session fixtures. The application layer's contract should be callable from CLI, background jobs, and integration tests without session context. Coupling it to an HTTP session string violates the dependency rule (ADR-001) and undermines the testability guarantee the clean-architecture split exists to provide.

### Alternative C: Presentation-side ownership check returning 403 on mismatch

Same placement as the chosen approach, but the controller returns HTTP 403 (Forbidden) rather than 404 when ownership fails.

Rejected because 403 confirms that a resource with the requested ID exists. An unauthenticated or unauthorized caller can enumerate valid interview IDs by comparing 403 vs 404 responses. The 404 response is the OWASP-recommended countermeasure for BOLA/IDOR (Broken Object Level Authorization) when the goal is to hide resource existence from callers who do not own the resource.

### Alternative D: Do nothing (no explicit ownership enforcement)

Leave it to database-layer row-level security or rely on the recruiter to not guess other recruiters' IDs.

Rejected because the database layer has no row-level security policy in the current schema, and interview IDs are UUIDs (v4) which are not secret. Without an explicit check, any authenticated recruiter can read, update, or delete any other recruiter's interview by guessing or observing a UUID. This is a textbook IDOR vulnerability.

## Consequences

**Benefits**

- Use cases remain pure: no HTTP/auth concept intrudes into the application layer, and they are callable from any context without session fixtures.
- Domain entity stays clean: no coupling to better-auth identity semantics.
- Existence hiding: returning 404 on mismatch prevents interview-ID enumeration attacks (OWASP BOLA/IDOR).
- Result discipline preserved: `assertRecruiterOwnsInterview` returns `Result<InterviewSerialized, InterviewNotFoundError>`, keeping the controller in a monadic chain consistent with ADR-001.
- Single, auditable enforcement point: all ownership checks flow through one helper function, making future changes (e.g. multi-recruiter access) locatable in one place.

**Trade-offs**

- Controllers that need to act on a specific interview make two use-case calls: `GetInterviewByIdUseCase` for the ownership check, then the action use case. At current scale (single-node, low concurrency) this is acceptable. A combined query service could collapse them later.
- The 404-on-ownership-mismatch pattern is deliberately non-standard and will surprise developers who expect 403. It must be documented (this ADR) to prevent it being "fixed" to 403 by a well-intentioned future author.
- The `recruiterId` injection rule (session only, never body) is a convention enforced by the Enforcement block below and code review; the compiler cannot enforce it directly.

**Risks and mitigations**

- *Risk*: A future controller author forgets the ownership check and exposes an unguarded endpoint. *Mitigation*: The `llm_judge: true` Enforcement block below asks the judge to flag any controller method that resolves an interview by ID without calling `assertRecruiterOwnsInterview` or an equivalent check.
- *Risk*: A future refactor moves `recruiterId` into a DTO that is populated from `req.body` as a convenience, silently enabling spoofing. *Mitigation*: The declarative `forbid_pattern` in the Enforcement block catches `recruiterId: req.body` or `recruiterId: body.` patterns at commit time.
- *Risk*: ADR-016's `users.id` format changes (e.g. from string UUID to a typed value object), breaking the string comparison. *Mitigation*: Both sides of the comparison (`interview.recruiterId` and `session.userId`) are plain strings today. If the type changes, the TypeScript compiler will surface a type mismatch at `assertRecruiterOwnsInterview`'s call site.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: This decision is a concrete application of the dependency rule. The application layer must not know about HTTP session identity; therefore ownership enforcement sits in the presentation layer.
- **ADR-016 (Adopt better-auth for Recruiter Authentication)**: `req.session.userId` is populated by better-auth. The `recruiterId` field on the `Interview` aggregate is set equal to `users.id` at interview creation time, which is why the string comparison is valid.
- **ADR-018 (HTTP Error Mapping)**: Ownership mismatch is the one case where a controller emits a hardcoded 404 without routing the error through the central HTTP error mapper. That exemption should be noted in ADR-018 when it is authored.

## References

- Ownership helper: `apps/backend/src/presentation/auth/assert-recruiter-owns-interview.ts`
- Controller usage: `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (`getOwnedInterview` private method, lines 180+)
- Phase 7 plan (Step 14, Step 16, Resolved decision no. 4): `.claude/plan/phase-7-presentation-and-auth.md`
- OWASP API Security Top 10 — API1:2023 Broken Object Level Authorization (BOLA/IDOR): https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP recommendation to use 404 over 403 to avoid existence disclosure: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "recruiterId:\\s*req\\.body|recruiterId:\\s*body\\.",
      "path_glob": "apps/backend/src/presentation/controllers/**/*.ts",
      "message": "recruiterId must come from req.session.userId, never from req.body (ADR-019). Injecting recruiterId from the request body enables recruiter-identity spoofing."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
