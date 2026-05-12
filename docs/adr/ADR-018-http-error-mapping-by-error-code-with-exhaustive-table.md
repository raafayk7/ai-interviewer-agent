# ADR-018 HTTP Error Mapping by Error Code String with an Exhaustive Status Table

## Status

Proposed. Date: 2026-05-12.

## Context

The backend has a deep error hierarchy spanning 25+ distinct error classes across `packages/domain/` and `packages/application/`. At the presentation layer, every controller and the Fastify global error handler must convert a `ServiceError` into an HTTP response without leaking internal details: no stack traces, no infrastructure error types, no raw database messages.

Three concrete constraints drove the need for a deliberate strategy:

1. The domain defines at least four abstract error roots (`ValidationError`, `NotFoundError`, `ConflictError`, `BusinessRuleViolationError`) each with multiple concrete subclasses. Infrastructure adds `ServiceInfraError` subclasses (`ServiceUnavailableError`, `ServiceTimeoutError`, `UnauthorizedError`, `ForbiddenError`, etc.). The number grows with every new aggregate.
2. `DtoValidationError` must include Zod `issues` in the response body so clients can render field-level error messages. No other error type exposes its internal structure to callers.
3. `RepositoryError` subclasses must never reach the presentation layer: the use-case boundary is responsible for translating them into `ServiceError` subclasses. The presentation layer needs a safe fallback (500) for the case where this invariant is violated.

Evidence: The implemented solution lives in `apps/backend/src/presentation/errors/http-error-mapper.ts`. It exports a `STATUS_BY_CODE` table with 24 entries and a `mapServiceErrorToHttp(err: ServiceError)` function. The error type union is defined in `packages/application/src/core/service-error.ts`.

## Decision

Maintain a single `STATUS_BY_CODE: Record<string, number>` lookup table in `apps/backend/src/presentation/errors/http-error-mapper.ts`. The `mapServiceErrorToHttp(err: ServiceError)` function resolves `err.code` against this table; codes absent from the table fall through to 500. `DtoValidationError` is special-cased to attach `err.issues` to the response body. `installErrorHandler` registers a Fastify `setErrorHandler` that calls `mapServiceErrorToHttp` as a safety net for any `ServiceError` that escapes a controller. Controllers call `mapServiceErrorToHttp` directly in their `Result.match` branches so no error needs to be thrown to reach the global handler.

`RepositoryError` subclasses must not reach this mapper. The 500 fallback handles the case where this boundary invariant is violated, but does not replace it. The invariant is enforced by code review and the `llm_judge` rule below.

The mapper never forwards `err.cause` or `err.stack` to the HTTP response.

## Alternatives Considered

### Alternative A: Map by class hierarchy (instanceof chains)

Controllers switch on `instanceof DomainError`, `instanceof ServiceInfraError`, etc., branching into nested conditionals to reach a concrete class. This approach requires no lookup table.

Rejected because: the hierarchy is deep (domain errors have at least 10 concrete leaf classes as of phase 7). Every new leaf class requires updating multiple switch arms scattered across all controllers. A class rename or reorganisation silently breaks the instanceof chain at runtime without a compile error, because TypeScript does not check instanceof exhaustiveness.

### Alternative B: Map by constructor name string (err.constructor.name)

Map `err.constructor.name` to a status code. Simpler than instanceof and avoids the hierarchy problem.

Rejected because: constructor names are not stable across minification or bundling. More importantly, `code` is an explicit, versioned string literal defined as a `readonly` field in each error class. Relying on `constructor.name` couples the mapping to class naming conventions rather than the explicit identity the error declares.

### Alternative C: Map by error code with a centralized table (chosen)

A single `Record<string, number>` table with an explicit fallback to 500. Controllers use `Result.match` and call `mapServiceErrorToHttp` in the error branch.

Chosen because: the table is a single file to audit, the fallback prevents crashes on unknown codes, and adding a new error class requires only one table entry. The `code` field is already an immutable literal on every error class, making it a stable key.

### Alternative D: Throw ServiceErrors and rely solely on setErrorHandler

Controllers throw (or re-throw) errors out of their handlers, and `setErrorHandler` is the sole mapping point. Eliminates per-controller error-branch code.

Rejected because: it breaks the `@carbonteq/fp` Result chain discipline established in ADR-001. Use cases return `Result<T, ServiceError>` precisely so that control flow is explicit. Converting a `Result` error branch into a thrown exception re-introduces hidden control flow and makes the error path invisible in the controller's type signature.

## Consequences

**Benefits**

- Single source of truth: all HTTP status assignments are auditable from one 24-entry table.
- Unknown codes produce a 500 with a stable body shape rather than an unhandled rejection.
- `DtoValidationError.issues` is exposed only at this boundary, keeping the domain and application layers free of HTTP concerns.
- `cause` chains, stack traces, and infrastructure error class names never reach HTTP clients.
- Controller error branches are explicit and type-safe: `Result.match` requires handling the error case, and `mapServiceErrorToHttp` narrows it to a status and body.

**Trade-offs**

- Adding a new error class requires a corresponding table entry. If the entry is omitted, the code falls through to 500 silently rather than 4xx. This is the most likely failure mode.
- The table is not type-checked against the `ServiceError` union. A typo in a `code` string silently falls through to 500 with no compile-time warning.

**Risks and mitigations**

- *Risk*: A new `DomainError` or `ServiceInfraError` subclass is added without a table entry, causing 500s where a 4xx is correct. *Mitigation*: `llm_judge: true` enforcement rule prompts review of any new error class diff against the table. Monitoring via OTel span status will surface unexpected 500s in staging.
- *Risk*: A controller bypasses the mapper and hardcodes `reply.code(N).send(...)`. *Mitigation*: `forbid_pattern` rule blocks direct `reply.code(\d+).send(` calls in controller files at commit time, with a documented exception for the ownership-hiding 404 in `recruiter-interview.controller.ts`.
- *Risk*: A `RepositoryError` reaches `mapServiceErrorToHttp` (boundary invariant violation). *Mitigation*: The 500 fallback handles it safely. The LLM judge flags any use-case that forwards a `RepositoryError` unwrapped.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: This ADR is a direct implementation of ADR-001's mandate that errors are matched via `Result`, not thrown. `mapServiceErrorToHttp` is the terminal step of the Result chain at the presentation boundary.
- **ADR-019 (Ownership-Hiding 404 in Recruiter Interview Controller)**: Documents the one controller where a 404 is sent directly without going through the mapper, to avoid leaking resource existence to unauthorized callers. ADR-018's `forbid_pattern` rule carries an exception comment pointing to ADR-019.

## References

- Implementation: `apps/backend/src/presentation/errors/http-error-mapper.ts`
- Error type union: `packages/application/src/core/service-error.ts`
- Domain error hierarchy: `packages/domain/src/` (multiple entity subdirectories under `entities/`)
- Phase 7 plan, Step 15: `.claude/plan/phase-7-presentation-and-auth.md`
- Controllers that consume the mapper: `apps/backend/src/presentation/controllers/recruiter-document.controller.ts`, `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`, `apps/backend/src/presentation/controllers/interview-session.controller.ts`

## Enforcement

```json
{
  "require_pattern": [
    {
      "pattern": "mapServiceErrorToHttp",
      "path_glob": "apps/backend/src/presentation/controllers/**/*.ts",
      "message": "Every controller must use mapServiceErrorToHttp for error responses (ADR-018)."
    }
  ],
  "forbid_pattern": [
    {
      "pattern": "reply\\.code\\(\\d+\\)\\.send\\(",
      "path_glob": "apps/backend/src/presentation/controllers/**/*.ts",
      "message": "Controllers must use mapServiceErrorToHttp for error status codes, not hardcoded reply.code() calls (ADR-018). Exception: the ownership-hiding 404 in recruiter-interview.controller.ts is documented in ADR-019."
    }
  ],
  "forbid_import": [],
  "llm_judge": true
}
```
