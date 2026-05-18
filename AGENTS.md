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

## Project Scope

Backend rules apply to:

- `packages/domain/`
- `packages/application/`
- `apps/backend/`

Frontend rules apply to:

- `apps/web/`
- `packages/ui/`

## Documentation

After completing any milestone, feature, or development phase, use `progress-doc` to write a structured progress document to `docs/progress/`.

Pass the milestone title as the argument. The skill automatically uses a per-file detailed format for 10 or fewer changed files, or a layer/component summary for more than 10 files.

## ADR Kit

This project uses adr-kit for Architecture Decision Records. ADRs live in `docs/adr/`, and `docs/adr/README.md` is the project-specific ADR index and convention reference.

Codex/generic ADR assets live in `.agents/`:

- Skill: `.agents/skills/adr/SKILL.md`
- Coding rules: `.agents/instructions/adr.coding.md`
- Review checks: `.agents/instructions/adr.review.md`

Codex custom agent:

- ADR generator: `.codex/agents/adr-generator.toml`

Before architecturally significant code changes, follow `.agents/instructions/adr.coding.md`. When reviewing PRs or diffs, follow `.agents/instructions/adr.review.md`. To create an ADR, use the `adr-generator` custom agent or read `.agents/skills/adr/SKILL.md` and write the ADR directly.

## Frontend Workflow

Before frontend edits, classify the task:

| Task | Path |
|---|---|
| Existing files only, one layer/package, no new abstraction | Fast path |
| New files, 2+ layers/packages, new primitive/composite/service/store/container/route | Full implementation |

Default to full implementation when unsure.

If an existing frontend plan is provided in `.claude/plan`, `.claude/plans`, `.agents/plan`, or `.agents/plans`, read it before implementation.

## Frontend Skills

Use the relevant skill before editing a frontend layer:

- `frontend-service-layer` for `apps/web/src/services/` and `apps/web/src/types/`
- `frontend-container-layer` for `apps/web/src/containers/`
- `frontend-composite-layer` for `packages/ui/src/composites/` and `apps/web/src/components/`
- `frontend-primitive-layer` for `packages/ui/src/primitives/`
- `frontend-route-layer` for `apps/web/app/`
- `frontend-voice-pipeline` for `InterviewSessionContainer`, WebSocket, MediaRecorder, or audio playback work
- `frontend-arch-validator` after layer edits or before handoff
- `chat-ui` when building chat or messaging interfaces

## Frontend Architecture

Dependencies flow:

```text
Routes -> Containers -> Services
                  -> Stores
                  -> Composites -> Primitives
```

Frontend rules:

- Services are the only frontend layer that calls `fetch()`.
- Containers are the only layer that uses TanStack Query, React Hook Form orchestration, or Zustand stores.
- Stores hold UI state only, not server data.
- Pages and layouts stay Server Components by default; do not add `"use client"` to `page.tsx` or `layout.tsx`.
- UI primitives and composites must not import from `apps/web`, services, stores, backend, domain, or application packages.
- Frontend code must not import `@repo/domain` or `@repo/application`.
- Use semantic Tailwind tokens, not raw color scales.
- Interactive primitives must use `forwardRef` and set `displayName`.

## Frontend Verification

After frontend edits, run the narrowest useful checks. Source nvm first if needed.

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
```

Run only relevant filters for touched packages when a full run is unnecessary. Run Playwright only when route-level E2E behavior changed.

Before handing off frontend implementation, use `frontend-arch-validator` against the touched layer or files.

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

## Backend Architecture

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

## Backend Verification

After backend edits, run the narrowest useful checks. Source nvm first if needed.

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

Run only relevant test filters for touched packages when a full run is unnecessary.

Before handing off backend implementation, use `backend-arch-validator` against the touched layer or files.
