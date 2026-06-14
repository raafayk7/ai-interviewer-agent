# CLAUDE.md

Guidance for Claude Code in this repository.

> **Scope:** Backend rules apply to `packages/domain/`, `packages/application/`, `apps/backend/`. Frontend rules apply to `apps/web/` and `packages/ui/`. Both stacks have full workflow harnesses described below.

## Documentation

After completing any milestone, feature, or development phase:
- `/progress-doc` — write a structured progress document to `docs/progress/`. Pass the milestone title as the argument. Automatically uses a per-file detailed format for ≤10 changed files, or a layer/component summary for >10 files.

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

# Frontend (per-package)
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web --filter=@repo/ui
pnpm --filter web dev                         # recruiter + candidate frontend on :3000
pnpm --filter web exec playwright test        # E2E (after `playwright install`)

# Drizzle (in apps/backend)
pnpm --filter backend db:generate    # Generate migrations
pnpm --filter backend db:migrate     # Run migrations
pnpm --filter backend db:studio      # Open Drizzle Studio
```

## Frontend Workflow — MANDATORY

### Pick a path first — always

Before doing anything else, classify the task:

| Task involves… | Path |
|----------------|------|
| Creating new files, OR touching 2+ layers, OR new primitive/composite/service/store/container/route | **Full chain** → `/frontend-implement` |
| Modifying existing files only, single layer, no new abstractions | **Fast path** → `/frontend-patch` |

**Default to `/frontend-implement` when in doubt.** Use `/frontend-patch` only when all four eligibility conditions in that skill are met.

---

These rules apply to the full chain (`/frontend-implement`). They are non-negotiable for that path.

### Rule 1 — Explore first
For any task touching 2+ layers OR an unfamiliar feature:
- **MUST run `frontend-codebase-explorer` agent** before writing any code.
- Feed its CONTEXT BLOCK output into subsequent agents.

### Rule 2 — Plan before coding
For any task that creates or modifies 2+ files:
- **MUST invoke `frontend-plan-generator` agent** → saves plan to `.claude/plan/<slug>.md`
- **MUST read the saved plan** before writing a single line of code
- If `.claude/plan/` already has a matching plan, read it first and skip re-generating

### Rule 3 — Use layer skills
Always invoke the matching skill before writing implementation code in any layer:
- `/frontend-primitive-layer` for `packages/ui/src/primitives/`
- `/frontend-composite-layer` for `packages/ui/src/composites/` and `apps/web/src/components/`
- `/frontend-service-layer` for `apps/web/src/services/` and `apps/web/src/types/`
- `/frontend-container-layer` for `apps/web/src/containers/`
- `/frontend-route-layer` for `apps/web/app/`
- `/frontend-voice-pipeline` for `InterviewSessionContainer/`, WebSocket, MediaRecorder, audio playback
- `/frontend-implement` for full features spanning multiple layers — it chains all of the above

### Rule 4 — Validate after each layer
Run `/frontend-arch-validator <layer>` after completing each layer to catch boundary, state-boundary, and token violations before they compound.

### Rule 5 — Verify after ALL edits are complete
Run in this order after finishing all implementation — never mid-session:
```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web        # if apps/web/* was touched
pnpm turbo run test --filter=@repo/ui   # if packages/ui/* was touched
pnpm --filter web exec playwright test  # only if route-level E2E changed
```
**Do not declare a task done until type-check + lint are clean and all relevant tests pass.**

### Rule 6 — Generate tests for new code
**MUST invoke `/frontend-test-suite`** for every new primitive, composite, service, store, or container created.

### Rule 7 — Code review before done
**MUST invoke `frontend-code-reviewer` agent** on all created/modified files before declaring the task complete.
- REVISION REQUIRED → fix all violations, re-run `frontend-code-reviewer`. Repeat until PASS.
- Task is complete ONLY when `frontend-code-reviewer` returns PASS.

### Rule 8 — Pass context forward
When invoking `frontend-test-generator` or `frontend-code-reviewer`, always pass:
- The plan file path: `.claude/plan/<slug>.md` (if it exists)
- The full list of files created/modified in the session

## Frontend Skills & Agents

Skills (invoke with `/skill-name`):
- `/frontend-implement` — **full chain** for new files, multi-layer features, new primitives/services/containers/routes — explore → plan → layer skills → arch-validator (per layer) → tests → type-check + lint → simplify → review → report
- `/frontend-patch` — **fast path** for single-layer modifications to existing files — layer skill → edit → type-check + narrowest test → done
- `/frontend-primitive-layer` — leaf UI in `packages/ui/src/primitives/` (Radix + Tailwind v4 + CVA)
- `/frontend-composite-layer` — composed UI in `packages/ui/src/composites/` and `apps/web/src/components/`
- `/frontend-service-layer` — `apps/web/src/services/` — the only `fetch()` boundary; Zod-validated responses; `Result<T, ServiceError>`
- `/frontend-container-layer` — `apps/web/src/containers/<Feature>Container/` — first `"use client"`; orchestrates TanStack Query + RHF + Zustand
- `/frontend-route-layer` — `apps/web/app/` — Server Components, route groups `(recruiter)` and `(candidate)`, auth gating
- `/frontend-voice-pipeline` — `InterviewSessionContainer/` — WS lifecycle, MediaRecorder, audio playback queue, reconnect/backoff
- `/frontend-arch-validator` — boundary + state-boundary + token-discipline check after each layer
- `/frontend-test-suite` — generate Vitest + RTL + Playwright suites

Agents (via `Agent` tool):
- `frontend-codebase-explorer` — maps frontend layers + surfaces violations; run before implementation
- `frontend-plan-generator` — detailed plans saved to `.claude/plan/`; run before non-trivial features
- `frontend-test-generator` — unit (primitive/composite/service/store) + integration (container) + E2E (Playwright) tests
- `frontend-code-reviewer` — final gate; returns PASS or revision list; never edits code

Optional design helpers (plugin skills, not part of the mandatory chain):
- `/ui-ux-pro-max` — UI/UX design intelligence: styles, color palettes, font pairings, UX guidelines
- `/frontend-design` — production-grade frontend interfaces with high design quality
- `/chat-ui` — chat UI building blocks (use only when the task involves AI chatbot or messaging interfaces)

## Frontend Architecture

**Clean Architecture** layered across two locations. Data flows inside-out; visuals build bottom-up; they meet at the container.

```
Routes (apps/web/app/) → Containers → Services       (data path)
                                   → Stores (Zustand) (UI state only)
                                   → Composites → Primitives (rendering path)
```

| Layer | Location | Purpose |
|---|---|---|
| Routes | `apps/web/app/` | Next.js 16 App Router. Server Components by default. Pages mount exactly one container. Layouts handle session/auth gating. |
| Containers | `apps/web/src/containers/<Feature>Container/` | First `"use client"`. Three-file pattern: `<Feature>Container.tsx` + `use<Feature>.ts` + `index.ts`. Orchestrates TanStack Query, RHF, Zustand. |
| Services | `apps/web/src/services/` | The only `fetch()` boundary. Every function returns `Promise<Result<T, ServiceError>>` after Zod-validating the response. |
| Stores | `apps/web/src/stores/` | Zustand stores for UI state ONLY. Never server data. |
| Composites | `packages/ui/src/composites/` and `apps/web/src/components/` | Compose 2+ primitives. No services, no TanStack Query, no Zustand. May use RHF via `FormProvider` context. |
| Primitives | `packages/ui/src/primitives/` | Radix + Tailwind v4 + CVA. `forwardRef` + `displayName` on interactive ones. |
| Types | `apps/web/src/types/` | Zod schemas mirroring backend wire contract. |
| Lib | `apps/web/src/lib/` | `env.ts`, `result.ts`, `query-client.ts`, `auth.ts` (server-side better-auth). |

**Forbidden imports — non-negotiable:**
- Anywhere in the frontend MUST NOT import `@repo/domain`, `@repo/application`, or anything from `apps/backend/`. The frontend talks to the backend over HTTP only.
- `fetch()` outside `apps/web/src/services/` is forbidden.
- TanStack Query (`useQuery`/`useMutation`) outside `apps/web/src/containers/` is forbidden.
- Zustand (`create(...)`) outside `apps/web/src/stores/` is forbidden.
- `packages/ui/*` MUST NOT import from `apps/web/*`, services, stores, or backend packages.
- `apps/web/app/**/page.tsx` and `**/layout.tsx` MUST NOT declare `"use client"` or use client hooks (`useState`, `useEffect`, `useQuery`, `useMutation`).
- Raw Tailwind color scales (`bg-blue-500`, `text-red-900`) — semantic tokens only (`bg-primary`, `text-muted-foreground`).

## Frontend Core Patterns

### Result type (mandatory in services)

Services return a discriminated `Result<T, ServiceError>` from `@/lib/result`. Containers consume them via TanStack Query — `if (!result.ok) throw result.error` inside `queryFn`/`mutationFn` preserves the typed error union for `onError`.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

### ServiceError discriminated union

```ts
type ServiceError =
  | { kind: "NETWORK"; message: string; cause?: unknown }
  | { kind: "RESPONSE_VALIDATION"; message: string; issues: unknown }
  | { kind: "AUTH"; status: 401 | 403; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "SERVER"; status: number; code?: string; message: string };
```

Map at the boundary in containers — never expose raw HTTP errors to the UI.

### Container three-file pattern (mandatory)

```
apps/web/src/containers/CampaignListContainer/
├── CampaignListContainer.tsx  ← thin JSX shell, switches on hook view-model
├── useCampaignList.ts          ← orchestration: TanStack Query, RHF, Zustand, error mapping
└── index.ts                    ← barrel
```

The hook holds the logic and is the unit you test in isolation. The component is a thin switch over the hook's view-model.

### State boundaries

| State kind | Required home |
|---|---|
| Server data | TanStack Query (`useQuery` / `useMutation`) |
| Form state | React Hook Form (`useForm` + `zodResolver`) |
| Auth session | better-auth React client |
| Global UI state | Zustand store |
| Local UI state | `useState` |

Server data in a Zustand store is forbidden — double source of truth.

### Render boundaries

- Pages and layouts: Server Components by default.
- The first `"use client"` lives in the container (and tiny leaf providers like `QueryProvider`).
- Auth gating: server-side in the route-group layout via `await auth.api.getSession({ headers: await headers() })`.
- Candidate signed-link verification: server-side in `(candidate)/.../layout.tsx` per ADR-017; the verified token is passed to the container as a prop.

### Tailwind tokens

Semantic only — `bg-primary`, `text-muted-foreground`, `border-input`, `text-destructive`. Tokens live in `apps/web/app/globals.css` under `@theme inline`. Extend the palette there, then use the new semantic token in components.

## Frontend Tech Stack

- **Framework:** Next.js 16 (App Router) · React 19
- **Components:** shadcn/ui style (copied into `packages/ui/src/primitives/`) · Radix UI primitives · `lucide-react` icons
- **Styling:** Tailwind v4 (`@tailwindcss/postcss`) · `tw-animate-css` · semantic tokens via `@theme inline`
- **Variants:** `class-variance-authority` · `clsx` + `tailwind-merge` (via `@repo/ui/lib/cn`)
- **Client state:** Zustand 5 (ADR-021)
- **Server state:** TanStack Query 5 (ADR-022)
- **Forms:** React Hook Form 7 + `@hookform/resolvers/zod` (ADR-024)
- **Validation:** Zod 4 (lockstep with backend `@repo/application`)
- **HTTP:** native `fetch` wrapped in services (no axios)
- **Auth:** `better-auth` React client (ADR-016) + HMAC signed link (ADR-017)
- **Voice/WS:** native WebSocket + MediaRecorder + Web Audio (no library)
- **Toasts:** `sonner`
- **Tests:** Vitest 3 · `@testing-library/react` · `@testing-library/user-event` · `@testing-library/jest-dom` · `jsdom` · `@playwright/test`

## Frontend Testing

Tests are co-located with source using `.test.{ts,tsx}` suffix. Playwright E2E specs live in `apps/web/e2e/`.

- **Primitives / composites:** Vitest + RTL — pure render, no mocks
- **Services:** Vitest — `vi.stubGlobal('fetch', ...)`; assert URL/method/body, every error path, Zod parse failures
- **Containers:** Vitest + RTL — `vi.mock('@/services/...')`, fresh `QueryClient` per test, `renderHook` + `waitFor`, assert view-model
- **Stores:** Vitest — call hook directly, reset with `useStore.setState(initial, true)`
- **E2E (routes):** Playwright — real browser; stub `page.route('**/api/**', ...)` for pure frontend; point at backend fixture for full-stack

```bash
pnpm turbo run test --filter=web        # web unit + integration
pnpm turbo run test --filter=@repo/ui   # primitive/composite unit
pnpm --filter web exec playwright test  # E2E (after `playwright install`)
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
