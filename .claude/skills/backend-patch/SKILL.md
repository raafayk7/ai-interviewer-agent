---
name: backend-patch
description: Fast path for small, single-layer, modification-only changes — bug fixes, field additions, method tweaks, validation fixes, small refactors within one layer or package. No plan, no backend-codebase-explorer. Invoke the matching layer skill, make the change, verify, done. Trigger proactively whenever the user describes a small, well-scoped change to an existing file in a single layer.
user-invocable: true
argument-hint: "<what to change and where>"
metadata:
  version: 1.0.0
---

# backend-patch

Fast-path workflow for small, single-layer changes. Skips the full orchestration chain and goes straight to implementation.

---

## Eligibility check — ALL conditions must be true

Before using this path, confirm every condition:

| # | Condition | If false → |
|---|-----------|------------|
| 1 | Modifying **existing** files only — no new files created | Use `/backend-implement` |
| 2 | **Single package/layer** only (domain, application, infrastructure, or presentation) | Use `/backend-implement` |
| 3 | No new entity, use case, repository, route, or Drizzle schema table | Use `/backend-implement` |
| 4 | The affected aggregate is already known from the current conversation or a quick read | Use `/backend-implement` |

If any condition is false, stop and invoke `/backend-implement` instead.

---

## Fast-path workflow

### Step 1 — Invoke the matching layer skill

Always load the layer skill for the layer being touched before writing any code:

| Layer / Package | Skill |
|----------------|-------|
| `packages/domain/src/` | `/backend-domain-layer` |
| `packages/application/src/` | `/backend-application-layer` |
| `apps/backend/src/infrastructure/` | `/backend-infrastructure-layer` |
| `apps/backend/src/presentation/` | `/backend-presentation-layer` |

This ensures the relevant rules, patterns, and FP conventions are active.

### Step 2 — Read the target file(s)

Read every file you will modify before changing anything. Never edit blind.

### Step 3 — Make the change

Follow all rules from the layer skill. Key reminders:
- Entity properties stay `readonly` — methods return new instances
- No `throw`, `try/catch`, or `T | null` — use `Result` and `Option`
- Errors extend the correct base class with a `readonly code` string
- No imports crossing layer/package boundaries illegally
- If adding new exports, update the package barrel (`index.ts`)

### Step 4 — Verify

Run type-check on the affected package(s):

```bash
pnpm turbo run check-types --filter=@repo/domain          # for packages/domain/ changes
pnpm turbo run check-types --filter=@repo/application      # for packages/application/ changes
pnpm turbo run check-types --filter=backend                # for apps/backend/ changes
```

Fix every error before continuing. Then run the narrowest test that covers the change:

```bash
pnpm turbo run test --filter=@repo/domain          # for packages/domain/ changes
pnpm turbo run test --filter=@repo/application      # for packages/application/ changes
pnpm turbo run test --filter=backend                # for apps/backend/ changes
```

If tests fail: fix the root cause. Never skip.

### Step 5 — Done

Report what changed and confirm type-check + tests passed. No plan file needed.

---

## Examples of patch-eligible tasks

- Add a new field to an existing entity (`readonly newField: string`)
- Fix a validation rule in a domain method
- Add a new error class to an existing `errors/` file
- Fix a wrong HTTP status mapping in a controller
- Update a Zod schema field in a DTO
- Add a new method to an existing repository implementation
- Fix a type mismatch in a use case
- Rename a method within one layer (find + replace in that layer only)
- Add a column to an existing Drizzle schema table

## Examples that require `/backend-implement` instead

- Adding a new entity, use case, or repository (new files)
- A fix that requires touching both the entity AND the use case
- Adding a new route (presentation + application + possibly domain)
- Adding a new Drizzle schema table with a new repository
