# AGENTS.md

Guidance for Codex in this repository.

## Shell Environment

Node and pnpm are installed through nvm. If `node`, `npm`, or `pnpm` are not on PATH, source nvm before running package commands:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

For one-off commands, use:

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; pnpm <command>
```

## Backend Scope

These backend rules apply to:

- `packages/domain/`
- `packages/application/`
- `apps/backend/`

Frontend work in `apps/web/`, `apps/docs/`, and `packages/ui/` follows the repo's frontend conventions and is not governed by these backend rules.

## Backend Workflow

Before backend edits, classify the task:

| Task | Path |
|---|---|
| Existing files only, one layer/package, no new abstraction | Fast path |
| New files, 2+ layers/packages, new entity/use case/repository/route/schema | Full implementation |

Default to full implementation when unsure.

If an existing backend plan is provided in `.claude/plan`, `.claude/plans`, `.agents/plan`, or `.agents/plans`, read it before implementation.

## Backend Skills

Use the relevant skill before editing a backend layer:

- `backend-domain-layer` for `packages/domain/src/`
- `backend-application-layer` for `packages/application/src/`
- `backend-infrastructure-layer` for `apps/backend/src/infrastructure/`
- `backend-presentation-layer` for `apps/backend/src/presentation/`
- `backend-arch-validator` after layer edits or before handoff

## Architecture

Clean Architecture + DDD. Dependencies flow inward:

```text
Presentation -> Application -> Domain <- Infrastructure
```

Layer locations:

| Layer | Location | Purpose |
|---|---|---|
| Domain | `packages/domain/` | Entities, value objects, repository ports, domain errors/events |
| Application | `packages/application/` | Use cases, DTOs, orchestration, query services |
| Infrastructure | `apps/backend/src/infrastructure/` | Drizzle repositories, DAOs, persistence, external services |
| Presentation | `apps/backend/src/presentation/` | Fastify controllers, routes, HTTP error mapping |

Forbidden imports:

- Domain must not import application, backend, Fastify, Drizzle, or Zod.
- Application must not import backend, Fastify, Drizzle, or infrastructure/presentation code.
- Infrastructure must not import presentation.
- Presentation must not import infrastructure or Drizzle.

## Backend Patterns

Use `Result<T, E>` and `Option<T>` from `@carbonteq/fp`.

In domain, application, and infrastructure:

- Do not throw for expected failures.
- Do not use direct `try/catch`; wrap throwing libraries with `Result.tryAsyncCatch`.
- Do not return `T | null`; use `Option<T>`.
- Map errors at every layer boundary.

Entities:

- Entity props are immutable.
- Methods return new instances rather than mutating `this`.
- Entities expose `serialize()`.
- Entities expose `static fromSerialized()`.

Application use cases:

- Validate input.
- Load aggregates through repository ports.
- Call domain behavior.
- Persist through repository ports.
- Return serialized output or `ServiceError`.

Infrastructure:

- Repositories implement domain ports.
- Repositories translate database errors before returning.
- No business decisions in repositories.

Presentation:

- Controllers validate HTTP input, call use cases, and map errors.
- Routes only register endpoints and delegate.
- No direct database or repository access from presentation.

## Verification

After backend edits, run the narrowest useful checks. Source nvm first if needed.

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Run only relevant test filters for touched packages when a full run is unnecessary.

Before handing off backend implementation, use `backend-arch-validator` against the touched layer or files.
