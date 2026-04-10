---
name: backend-test-suite
description: Generates a complete Vitest test suite (unit, integration, and/or e2e) for any target in the backend clean architecture — entities, DTOs, use cases, repositories, or HTTP routes. Use this skill when the user asks to write tests for backend code.
user-invocable: true
argument-hint: "<target: file path | class name | feature> [unit|integration|e2e|all]"
metadata:
  version: 1.0.0
---

# backend-test-suite

Generates production-quality Vitest tests for a given target in the backend clean architecture.

---

## Scope

| Scope | What is covered | Run command |
|-------|----------------|-------------|
| `unit` | Single class in isolation — entity methods, VO logic, DTO validation, use-case orchestration with mocked repos | `pnpm turbo run test --filter=@repo/domain` / `--filter=@repo/application` |
| `integration` | Multiple modules wired end-to-end — repository + Drizzle + test database | `pnpm turbo run test --filter=backend` |
| `e2e` | Full HTTP round-trip via Fastify `inject()` — route → controller → use case → response | `pnpm turbo run test --filter=backend` |
| `all` | All applicable suites _(default)_ | all commands above |

---

## Architecture & coding principles to follow

### Layer → package mapping
- `@repo/domain` (`packages/domain/`) is pure TypeScript — no framework imports, no HTTP, no ORM. Tests here need no mocks.
- `@repo/application` (`packages/application/`) orchestrates domain + repos. Tests here mock repositories with plain objects.
- `apps/backend/src/infrastructure/` implements domain ports with Drizzle. Tests here may wire Drizzle + a test database.
- `apps/backend/src/presentation/` is the HTTP boundary. E2E tests build a real Fastify app via `buildApp()`.

### Functional error handling (`@carbonteq/fp`)
Every fallible operation returns `Result<T, E>` or `Option<T>`. Tests assert with:
```typescript
expect(result.isOk()).toBe(true);          // success path
expect(result.isErr()).toBe(true);         // error path
expect(result.unwrap()).toMatchObject(…);  // assert value
expect(result.unwrapErr()).toBeInstanceOf(SomeDomainError);  // assert error type
```
Never `throw` or `try/catch` in domain/application tests.

### Immutable entities
All entity properties are `readonly`. Methods return new instances. Tests verify the returned
value, not mutation:
```typescript
const updated = original.approve().unwrap();
expect(updated.status).toBe('APPROVED');
expect(original.status).toBe('DRAFT'); // original unchanged
```

### Error hierarchy
```
DomainError (abstract, @repo/domain)
  ├── ValidationError          → HTTP 400
  ├── NotFoundError            → HTTP 404
  ├── ConflictError            → HTTP 409
  └── BusinessRuleViolationError → HTTP 400
```
Each aggregate defines concrete errors in `errors/{aggregate}.errors.ts`.

### Test file location
Tests are co-located with source code using the `.test.ts` suffix:
```
packages/domain/src/entities/campaign/campaign.entity.test.ts
packages/application/src/use-cases/campaign/create-campaign.use-case.test.ts
apps/backend/src/infrastructure/repositories/campaign.repository.test.ts
apps/backend/src/presentation/routes/campaign.routes.test.ts
```

### HTTP response shape (for e2e tests)
```typescript
{
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  timestamp: string;
}
```

---

## How to invoke

1. Identify the **target** from `$ARGUMENTS`.
2. Infer scope — default is `all`; honour explicit `unit`, `integration`, or `e2e`.
3. If the target is ambiguous, ask **one** clarifying question before proceeding.
4. Write tests following these steps:

```
Target: <resolved absolute path or feature description>
Scope: <unit | integration | e2e | all>

Write working tests — not a plan, not stubs.
Read the source and any existing tests for style reference.
Follow all conventions above.
Run every test you add and iterate until green.
```

5. Report results:
   - Files created / modified
   - Which suites were produced (unit / integration / e2e)
   - Exact commands to run each suite
   - Known blockers (env vars, live DB) and workarounds

---

## Running tests

```bash
# Domain tests
pnpm turbo run test --filter=@repo/domain

# Application tests
pnpm turbo run test --filter=@repo/application

# Infrastructure + E2E tests
pnpm turbo run test --filter=backend

# All backend tests
pnpm turbo run test --filter=@repo/domain --filter=@repo/application --filter=backend
```
