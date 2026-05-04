---
name: backend-arch-validator
description: Lightweight mid-implementation boundary and FP correctness check for the backend clean architecture. Use this after finishing each layer during /backend-implement to catch drift early — before it compounds across layers. Also user-invocable at any time.
user-invocable: true
argument-hint: "<file path(s) or layer name: domain | application | infrastructure | presentation | all>"
metadata:
  version: 1.0.0
---

# backend-arch-validator

A fast, focused architectural check. Invoke this after completing a layer to confirm no boundary violations or FP pipeline errors crept in before moving to the next layer. Cheaper than a full review — it only checks boundaries and FP correctness.

---

## When to use

| Trigger | Usage |
|---------|-------|
| After implementing a layer in `/backend-implement` Step 4 | `/backend-arch-validator <layer>` — e.g., `domain` or `application` |
| After a `/backend-patch` change, as a quick sanity check | `/backend-arch-validator <file path>` |
| Any time you suspect a layer boundary leaked | `/backend-arch-validator all` — scans all layers |
| Before opening a PR on a branch with many changes | `/backend-arch-validator all` |

---

## What it checks

1. **Package/layer boundary imports** — no forbidden cross-layer imports
2. **FP pipeline correctness** — no `throw`, `try/catch`, or `T | null` in domain/application/infrastructure; async chains end with `.toPromise()`
3. **Early unwrap patterns** — no extraction from `Result`/`Option` outside the pipeline

It does NOT check: test completeness, entity immutability, error hierarchy depth.

---

## Allowed import directions

The monorepo enforces boundaries at the package level. Within `apps/backend`, layer boundaries must be enforced by convention:

```
@repo/domain          → @carbonteq/fp, @carbonteq/refined-type (nothing else)
@repo/application     → @repo/domain, @carbonteq/fp, zod
apps/backend/infrastructure → @repo/domain, @repo/application, drizzle-orm, postgres
apps/backend/presentation   → @repo/domain, @repo/application, fastify
```

### Forbidden imports

| Layer | Must NOT import from |
|-------|---------------------|
| `@repo/domain` | `@repo/application`, `drizzle-orm`, `fastify`, `apps/backend/*` |
| `@repo/application` | `drizzle-orm`, `fastify`, `apps/backend/src/infrastructure/*`, `apps/backend/src/presentation/*` |
| `apps/backend/src/infrastructure/` | `apps/backend/src/presentation/*` |
| `apps/backend/src/presentation/` | `apps/backend/src/infrastructure/*` |

Note: `@repo/domain` and `@repo/application` boundaries are enforced by TypeScript + `package.json` dependencies — if it's not in `dependencies`, `tsc` will reject the import. The infrastructure/presentation boundary within `apps/backend` is convention-only and must be checked here.

---

## Execution

### Step 1 — Resolve scope

From `$ARGUMENTS`, determine what to review:

| Argument | Files to check |
|----------|---------------|
| `domain` | All modified files in `packages/domain/src/` this session |
| `application` | All modified files in `packages/application/src/` this session |
| `infrastructure` | All modified files in `apps/backend/src/infrastructure/` this session |
| `presentation` | All modified files in `apps/backend/src/presentation/` this session |
| `all` | All modified files across all layers |
| `<file path>` | That specific file |
| _(no argument)_ | Ask the user which layer or files to check |

### Step 2 — Check imports

For each file in scope, scan all `import` and `from` statements. Flag any that violate the allowed import directions table above.

### Step 3 — Check FP correctness

For files in domain, application, and infrastructure layers, flag:
- `throw` statements (except in presentation layer)
- `try { ... } catch` blocks (except in presentation layer)
- `T | null` or `T | undefined` type annotations (use `Option<T>` instead)
- Async `Result` chains that don't end with `.toPromise()`

### Step 4 — Report

If violations are found: list them and block progress. Fix violations before moving to the next layer or declaring the task done.

If clean: output the clean report and continue.

---

## Output format

### Clean

```
backend-arch-validator: CLEAN

Files checked: <list>
No boundary violations or FP pipeline errors detected.
```

### Violations found

```
backend-arch-validator: VIOLATIONS FOUND

Fix all items before proceeding to the next layer.

1. packages/application/src/use-cases/campaign/create-campaign.use-case.ts:12
   Forbidden import: `import { campaigns } from 'drizzle-orm'`
   Fix: remove direct infrastructure import — access data only through the repository port

2. packages/domain/src/entities/campaign/campaign.entity.ts:83
   throw statement in domain layer
   Fix: return Result.Err(new CampaignLockedError()) instead

3. apps/backend/src/presentation/controllers/campaign.controller.ts:5
   Forbidden import: `import { db } from '../infrastructure/persistence/db.js'`
   Fix: use a use case, not direct DB access
```

---

## Position in the `/backend-implement` chain

In Step 4 of `/backend-implement`, after finishing each layer and before starting the next:

```
Domain code complete → /backend-arch-validator domain → CLEAN → proceed to Application
Application code complete → /backend-arch-validator application → CLEAN → proceed to Infrastructure
Infrastructure code complete → /backend-arch-validator infrastructure → CLEAN → proceed to Presentation
```

If `backend-arch-validator` returns violations at any layer: fix them before proceeding. Do not carry violations forward — they compound.
