# CLAUDE.md

Guidance for Claude Code in this repository.

> **Scope notice:** The workflow rules, skills, and agents described in this file apply to **backend work only** (`packages/domain/`, `packages/application/`, `apps/backend/`). Frontend apps (`apps/web/`, `apps/docs/`) and UI packages (`packages/ui/`) have their own conventions and are **not** governed by these rules.

## Frontend

For frontend work (`apps/web/`, `apps/docs/`, `packages/ui/`), use these skills:
- `/ui-ux-pro-max` — UI/UX design intelligence: styles, color palettes, font pairings, UX guidelines
- `/frontend-design` — production-grade frontend interfaces with high design quality
- `/chat-ui` — chat UI building blocks (use when the task involves AI chatbot or messaging interfaces)

## Commands

```bash
# Monorepo-wide
pnpm build                # Build all packages (via turbo)
pnpm check-types          # Type-check all packages (via turbo)
pnpm test                 # Run all tests (via turbo)
pnpm lint                 # Lint all packages (via turbo)
pnpm dev                  # Start all dev servers (via turbo)
pnpm format               # Prettier

# Per-package (use turbo --filter)
pnpm turbo run build --filter=@repo/domain
pnpm turbo run build --filter=@repo/application
pnpm turbo run build --filter=backend

pnpm turbo run check-types --filter=@repo/domain
pnpm turbo run check-types --filter=@repo/application
pnpm turbo run check-types --filter=backend

pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend

# All backend tests at once
pnpm turbo run test --filter=@repo/domain --filter=@repo/application --filter=backend

# Drizzle (in apps/backend)
pnpm --filter backend db:generate    # Generate migrations
pnpm --filter backend db:migrate     # Run migrations
pnpm --filter backend db:studio      # Open Drizzle Studio
```

## Backend Workflow — MANDATORY

### Pick a path first — always

Before doing anything else, classify the task:

| Task involves… | Path |
|----------------|------|
| Creating new files, OR touching 2+ layers/packages, OR new entity/use-case/repository/route | **Full chain** → `/backend-implement` |
| Modifying existing files only, single layer/package, no new abstractions | **Fast path** → `/backend-patch` |

**Default to `/backend-implement` when in doubt.** Use `/backend-patch` only when all four eligibility conditions in that skill are met.

---

These rules apply to the full chain (`/backend-implement`). They are non-negotiable for that path.

### Rule 1 — Explore first
For any task touching 2+ layers OR an unfamiliar aggregate:
- **MUST run `backend-codebase-explorer` agent** before writing any code.
- Feed its CONTEXT BLOCK output into subsequent agents.

### Rule 2 — Plan before coding
For any task that creates or modifies 2+ files:
- **MUST invoke `backend-plan-generator` agent** → saves plan to `.claude/plan/<slug>.md`
- **MUST read the saved plan** before writing a single line of code
- If `.claude/plan/` already has a matching plan, read it first and skip re-generating

### Rule 3 — Use layer skills
Always invoke the matching skill before writing implementation code in any layer:
- `/backend-domain-layer` for `packages/domain/src/`
- `/backend-application-layer` for `packages/application/src/`
- `/backend-infrastructure-layer` for `apps/backend/src/infrastructure/`
- `/backend-presentation-layer` for `apps/backend/src/presentation/`
- `/backend-implement` for full features spanning multiple layers — it chains all of the above

### Rule 4 — Validate after each layer
Run `/backend-arch-validator <layer>` after completing each layer to catch boundary violations before they compound.

### Rule 5 — Verify after ALL edits are complete
Run in this order after finishing all implementation — never mid-session:
```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain          # if packages/domain/ was touched
pnpm turbo run test --filter=@repo/application      # if packages/application/ was touched
pnpm turbo run test --filter=backend                # if apps/backend/ was touched
```
**Do not declare a task done until type-check is clean and all relevant tests pass.**

### Rule 6 — Generate tests for new code
**MUST invoke `/backend-test-suite`** for every new entity, use case, or repository created.

### Rule 7 — Code review before done
**MUST invoke `backend-code-reviewer` agent** on all created/modified files before declaring the task complete.
- REVISION REQUIRED → fix all violations, re-run `backend-code-reviewer`. Repeat until PASS.
- Task is complete ONLY when `backend-code-reviewer` returns PASS.

### Rule 8 — Pass context forward
When invoking `backend-test-generator` or `backend-code-reviewer`, always pass:
- The plan file path: `.claude/plan/<slug>.md` (if it exists)
- The full list of files created/modified in the session

## Backend Skills & Agents

Skills (invoke with `/skill-name`):
- `/backend-implement` — **full chain** for new files, multi-layer features, new entities/use-cases/routes — explore → plan → layer skills → arch-validator (per layer) → type-check → tests → simplify → review → report
- `/backend-patch` — **fast path** for single-layer modifications to existing files — layer skill → edit → type-check → narrowest test → done
- `/backend-domain-layer` — entities, value objects, domain errors, repository ports
- `/backend-application-layer` — use cases, DTOs, orchestration
- `/backend-infrastructure-layer` — repository impls (Drizzle), DAOs, infra error translation
- `/backend-presentation-layer` — controllers, routes, HTTP error mapping
- `/backend-arch-validator` — boundary + FP correctness check after each layer; use mid-implementation to catch drift early
- `/backend-test-suite` — generate full Vitest test suites

Agents (via `Agent` tool):
- `backend-codebase-explorer` — map backend layers + surface violations; run before implementation
- `backend-plan-generator` — detailed plans saved to `.claude/plan/`; run before non-trivial features
- `backend-test-generator` — unit (domain) + integration (use cases) tests; mocks only at repo boundary
- `backend-code-reviewer` — final gate; returns PASS or revision list; never edits code

## Backend Architecture

**Clean Architecture + DDD** split across turborepo packages. Dependencies flow strictly inward:

```
Presentation (apps/backend) → Application (@repo/application) → Domain (@repo/domain) ← Infrastructure (apps/backend)
```

| Layer | Package / Location | Purpose |
|---|---|---|
| Domain | `packages/domain/` (`@repo/domain`) | Entities, value objects, repo interfaces, errors, events. Zero outward imports. |
| Application | `packages/application/` (`@repo/application`) | Use cases, DTOs (Zod 4), query services. Orchestration only. Imports `@repo/domain`. |
| Infrastructure | `apps/backend/src/infrastructure/` | Drizzle repos, DAOs, external services. Imports `@repo/domain` + `@repo/application`. |
| Presentation | `apps/backend/src/presentation/` | Fastify controllers, routes, middleware. Imports `@repo/domain` + `@repo/application`. |

**Layer boundaries are enforced at two levels:**
1. **Package level** (domain ↔ application) — TypeScript rejects imports not declared in `package.json` dependencies
2. **Convention level** (infrastructure ↔ presentation within `apps/backend`) — enforced by `/backend-arch-validator`

Per-aggregate structure in domain: `packages/domain/src/entities/{name}/` → `{name}.entity.ts`, `{name}.repository.ts`, `errors/`, `events/`

## Backend Core Patterns

### Result/Option (mandatory)

Use `Result<T, E>` and `Option<T>` from `@carbonteq/fp`. **Never `throw`, `try/catch`, or `T | null`** in domain/application/infrastructure code. Always chain — never extract early.

Return types:
- Repository query: `Promise<Result<Option<T>, Error>>`
- Repository command: `Promise<Result<T, Error>>`
- Use case: `Promise<Result<T, ServiceError>>`
- Domain method: `Result<T, DomainError>`

Key operators: `map`, `flatMap`, `flatZip`, `validate`, `tap`/`tapErr`, `orElse`, `Result.all`, `toPromise()` (end of async chains), `Result.tryAsyncCatch` (wrap throwing libs).

### Entities

Immutable — all props `readonly`, methods return new instances. Must implement:
- `serialize(): SerializedEntity` — domain → persistence
- `static fromSerialized(data): Entity` — persistence → domain

No separate mapper files. Repos call `entity.serialize()` / `Entity.fromSerialized()`.

### Error hierarchy

```
Domain:         DomainError → ValidationError | NotFoundError | ConflictError | BusinessRuleViolationError
Application:    ServiceError = DomainError | ServiceInfraError
Infrastructure: RepositoryError  ← must NOT leak past application layer
Presentation:   HttpError  ← maps ServiceError → HTTP status
```

Map errors at every layer boundary.

### DTOs

`packages/application/src/dtos/` — extend `BaseDto<T>`, Zod 4 schema, `BaseDto.validate()` → `Result<T, ValidationError>`.

### Repos vs Query Services

Repos: simple CRUD per aggregate. Query services: multi-table reads, pagination, cross-aggregate — return DTOs, not entities.

## Backend Tech Stack

- **Runtime:** Node 22 · TypeScript 5.9 · pnpm 9
- **Build:** Turborepo
- **HTTP:** Fastify 5
- **Database:** Drizzle ORM · PostgreSQL (via `postgres` driver)
- **FP:** `@carbonteq/fp` ^0.9.1 · `@carbonteq/refined-type` ^0.1.1
- **Validation:** Zod 4
- **Testing:** Vitest 3 (per-package, co-located `.test.ts` files)

## Backend Testing

Tests are co-located with source using `.test.ts` suffix. Target: 85% statements/functions, 80% branches.
- Domain: pure functions, no mocks
- Application: mock repositories only
- Infrastructure: use test database or mocked Drizzle client

```bash
pnpm turbo run test --filter=@repo/domain          # domain tests
pnpm turbo run test --filter=@repo/application      # application tests
pnpm turbo run test --filter=backend                # infrastructure + e2e tests
```

<!-- ADR-KIT STUB START -->
<!-- DO NOT regenerate manually. Updated by `/adr-kit:init`, `/adr-kit:upgrade`, `/adr-kit:setup`. -->
## ADR Kit

This project uses [adr-kit](https://github.com/rvdbreemen/adr-kit). All architectural decisions live as ADRs in `docs/adr/`. Full guide: @.claude/adr-kit-guide.md

Authoring: `/adr-kit:adr` (or the `adr-generator` subagent).
Pre-commit verification: `bin/adr-judge` runs declarative `Enforcement` rules at commit time. ADRs with `llm_judge: true` are reviewed in-session via `/adr-kit:judge`.
<!-- ADR-KIT STUB END -->
