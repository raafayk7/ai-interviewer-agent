# ADR-001 Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling

## Status

Accepted. Date: 2026-05-09.

## Context

The backend is a Turborepo monorepo (`packages/domain/`, `packages/application/`, `apps/backend/`) implementing an AI-driven voice screening interviewer. The system orchestrates a real-time pipeline: Deepgram speech-to-text (STT) feeds a Gemini agent (via AI SDK), which drives ElevenLabs text-to-speech (TTS), all over WebSocket. Post-session, a separate Gemini pass evaluates the transcript and produces a structured report.

Three constraints drove the architectural choice:

1. The voice pipeline has many partial-failure modes (provider timeout, transcription gap, tool-call error) that must be reasoned about explicitly, not swallowed by exception handlers.
2. The interview lifecycle has non-trivial state-transition rules (CREATED -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> EVALUATED, plus CANCELLED) that benefit from an explicit aggregate boundary.
3. The project plans to swap storage backends (Local -> S3/R2) and AI providers without rewriting orchestration logic. Use cases must be insulated from infrastructure choices.

These conventions are already in effect and are independently stated in three project documents: `AGENTS.md` lines 53-113 ("Architecture", "Backend Patterns"), `CLAUDE.md` lines 164-186 ("Backend Architecture", "Backend Core Patterns"), and `docs/ARCHITECTURE.md` section 3.2 ("Clean Architecture Mapping"). This ADR formalises them as the authoritative record.

## Decision

The backend follows Clean Architecture combined with Domain-Driven Design (DDD). Dependencies flow strictly inward:

```
Presentation -> Application -> Domain <- Infrastructure
```

**Layer rules:**

- **Domain** (`packages/domain/`): entities, value objects, repository ports, domain errors, domain events. Zero outward imports. Must NOT import `@repo/application`, `apps/backend`, Fastify, Drizzle ORM, or Zod.
- **Application** (`packages/application/`): use cases, Data Transfer Objects (DTOs, validated with Zod 4), query services. Imports `@repo/domain` only. Must NOT import backend, Fastify, Drizzle, or infrastructure/presentation code.
- **Infrastructure** (`apps/backend/src/infrastructure/`): Drizzle repositories, Data Access Objects (DAOs), external service adapters (Deepgram, ElevenLabs, Gemini, file storage). Imports `@repo/domain` and `@repo/application`. Must NOT import presentation.
- **Presentation** (`apps/backend/src/presentation/`): Fastify controllers, routes, WebSocket handlers, HTTP error mapping. Must NOT import infrastructure or Drizzle directly.

**Immutable entities:** All entity props are `readonly`. Methods return new instances rather than mutating `this`. Each entity exposes `serialize(): SerializedEntity` (domain to persistence) and `static fromSerialized(data): Entity` (persistence to domain). No separate mapper files — repositories call these methods directly.

**Error hierarchy (layered, must not leak upward):**

```
Domain:         DomainError -> ValidationError | NotFoundError | ConflictError | BusinessRuleViolationError
Application:    ServiceError = DomainError | ServiceInfraError
Infrastructure: RepositoryError  (must NOT leak past the application layer)
Presentation:   HttpError        (maps ServiceError to HTTP status)
```

Errors are mapped at every layer boundary. A `RepositoryError` must be translated to a `ServiceInfraError` before it reaches a use case return type.

**Result/Option for failure paths:** Use `Result<T, E>` and `Option<T>` from `@carbonteq/fp` ^0.9.1 throughout domain, application, and infrastructure. Never `throw` for expected failures, never use direct `try/catch` (wrap throwing third-party libraries with `Result.tryAsyncCatch`), never return `T | null` (use `Option<T>` instead). Always chain operators (`map`, `flatMap`, `flatZip`, `validate`, `tap`/`tapErr`, `orElse`, `Result.all`); do not extract `Result` values early. Async chains terminate with `toPromise()`.

This decision does not govern the frontend packages (`apps/web/`, `apps/docs/`, `packages/ui/`), which have separate conventions.

## Alternatives Considered

### Alternative A: Single Fastify app with no layering ("ports and adapters lite")

A flat structure where controllers call services directly, services call the database, and errors are thrown. No package split; everything lives in `apps/backend/`.

Rejected because: (1) the domain logic (interview state machine, scoring rubric, plan generation) needs to be unit-tested without a running database, HTTP server, or AI provider; flat coupling makes that impossible without heavy mocking at the wrong abstraction level. (2) The project explicitly plans provider swaps (Local -> S3/R2 storage, potential LLM provider changes) — without a use-case layer, those swaps require touching orchestration logic.

### Alternative B: Hexagonal architecture without DDD aggregates

Ports-and-adapters with plain service objects and no aggregate boundaries. Layer separation is maintained but domain objects are anemic (data bags passed to services).

Rejected because: the interview lifecycle is a natural aggregate root with a non-trivial state machine (CREATED -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> EVALUATED, plus CANCELLED). Encoding state-transition rules as methods on an `Interview` aggregate root keeps the invariants co-located with the data they guard. Anemic models push those rules into use cases, which then become large and difficult to test in isolation.

### Alternative C: Throw exceptions for failure paths (idiomatic Node.js)

Use `throw` / `try/catch` as the standard error-signalling mechanism, returning plain values on the happy path.

Rejected because: the asynchronous voice pipeline (STT -> LLM -> TTS per turn, across a 15-minute session) has many partial-failure modes that the caller must handle distinctly — Deepgram timeout, ElevenLabs audio gap, Gemini tool-call error, transcript save failure. Exception-based code hides these in `catch` blocks and makes it easy to accidentally swallow or conflate them. `Result<T, E>` makes every failure mode visible at the type level and forces explicit handling at each layer boundary.

### Alternative D: Do nothing (proceed without a documented architecture)

The conventions are already in effect in `AGENTS.md` and `CLAUDE.md`. One could argue no formal ADR is needed.

Rejected because: those files are workflow instructions for AI agents, not architectural rationale. They state the rules but not the reasoning or the rejected alternatives. Without a formal ADR, contributors have no canonical record explaining why the constraints exist, making them easier to erode under time pressure.

## Consequences

**Benefits**

- Domain logic is unit-testable without mocks, fixtures, or a running database: entities and value objects are pure TypeScript.
- Layer boundaries are enforced at two levels: the TypeScript compiler rejects undeclared cross-package imports (package-level), and `/backend-arch-validator` catches intra-package violations (convention level).
- All failure paths are explicit at the type level. `Result<T, E>` means a reviewer can see every error a use case can return without reading its implementation.
- Provider and adapter swaps require zero use-case changes. Swapping `LocalFileStorageService` for `S3FileStorageService` (planned) touches only infrastructure.
- The error hierarchy prevents infrastructure concerns (e.g., a Drizzle `PostgresError`) from leaking into use-case signatures or HTTP responses.

**Trade-offs**

- More boilerplate: per-aggregate folder structure, explicit error classes at each layer, boundary-mapping code. A simple CRUD endpoint requires more files than in a flat architecture.
- `Result`/`Option` chains have a learning curve. New contributors must become familiar with `flatMap`, `flatZip`, `Result.all`, `tap`/`tapErr`, `toPromise()`, and `Result.tryAsyncCatch` before they can contribute to domain or application code.
- Cross-cutting refactors (adding a field to a value object, renaming a domain concept) touch multiple files across packages and require running type-checks across the full monorepo.

**Risks and mitigations**

- *Risk*: Contributors unfamiliar with functional programming (FP) patterns bypass `Result` chains by extracting values early or using `.unwrap()` unsafely, reintroducing hidden control flow. *Mitigation*: The Enforcement block below catches `throw new` in domain/application at the pre-commit stage. Code review rules in `instructions/adr.review.md` include a check for early extraction. The `backend-code-reviewer` agent is a mandatory gate before any task is declared done (CLAUDE.md Rule 7).
- *Risk*: Layer boundary violations are introduced incrementally and compound before they are caught. *Mitigation*: `/backend-arch-validator` is run after each layer during feature implementation (CLAUDE.md Rule 4); TypeScript package boundaries catch cross-package leaks at compile time.
- *Risk*: The error hierarchy is not maintained and `RepositoryError` leaks into use-case return types. *Mitigation*: The architecture validator checks for this; new use cases must pass the `backend-code-reviewer` gate before merge.

## Related Decisions

No prior ADRs exist. This is the foundational record. Future ADRs that govern specific aggregates, infrastructure adapters, or use-case patterns will cite this record as their architectural baseline.

## References

- `AGENTS.md` lines 53-113 — "Architecture" and "Backend Patterns" sections (rules already in effect)
- `CLAUDE.md` lines 164-186 — "Backend Architecture" and "Backend Core Patterns" sections
- `docs/ARCHITECTURE.md` section 3.2 — "Clean Architecture Mapping" table and dependency arrow
- `@carbonteq/fp` v0.9.1 — https://github.com/carbonteq/fp (Result/Option primitives)
- `docs/ARCHITECTURE.md` section 5.4 — Interview state machine (CREATED -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> EVALUATED)
- `docs/ARCHITECTURE.md` section 4.7 — File storage port/adapter pattern (`IFileStorageService`)

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "\\bthrow\\s+new\\s+",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain code must return Result<T, E> from @carbonteq/fp instead of throwing (ADR-001)."
    },
    {
      "pattern": "\\bthrow\\s+new\\s+",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application code must return Result<T, E> from @carbonteq/fp instead of throwing (ADR-001)."
    },
    {
      "pattern": "\\btry\\s*\\{",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain must not use try/catch; wrap throwing libraries with Result.tryAsyncCatch (ADR-001)."
    }
  ],
  "forbid_import": [
    {
      "pattern": "from\\s+['\"](@repo/application|fastify|drizzle-orm|zod)['\"]",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain layer must not import application, Fastify, Drizzle, or Zod (ADR-001)."
    },
    {
      "pattern": "from\\s+['\"](fastify|drizzle-orm)['\"]",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must not import Fastify or Drizzle (ADR-001)."
    }
  ],
  "require_pattern": [],
  "llm_judge": false
}
```
