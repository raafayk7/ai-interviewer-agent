---
name: backend-implement
description: End-to-end implementation orchestrator for the backend clean architecture. Use this skill for any feature, fix, or refactor spanning multiple files or layers. Chains the backend-codebase-explorer + backend-plan-generator agents → layer skills (domain→application→infrastructure→presentation) with /backend-arch-validator after each → /backend-test-suite → type-check → tests → /simplify → backend-code-reviewer agent → final report. Trigger proactively whenever the user describes a multi-layer task or asks to implement a backend feature.
user-invocable: true
argument-hint: "<feature or task description>"
metadata:
  version: 1.0.0
---

# backend-implement

One-shot orchestrator for the backend clean architecture. Runs every mandatory step in the correct order so nothing is skipped. Invoke this skill before writing a single line of code.

---

## When to use this skill

Use `/backend-implement <task>` for any task that:
- Touches more than one file, or
- Crosses more than one layer, or
- Introduces a new entity, use case, route, or repository

For a single-file change in a known aggregate, invoke the layer skill directly instead (`/backend-domain-layer`, `/backend-application-layer`, etc.) or use `/backend-patch`.

---

## Package → layer mapping

| Layer | Package / Location | Skill |
|-------|-------------------|-------|
| Domain | `packages/domain/` (`@repo/domain`) | `/backend-domain-layer` |
| Application | `packages/application/` (`@repo/application`) | `/backend-application-layer` |
| Infrastructure | `apps/backend/src/infrastructure/` | `/backend-infrastructure-layer` |
| Presentation | `apps/backend/src/presentation/` | `/backend-presentation-layer` |

---

## Orchestration chain — execute every step in order

### Step 1 — Check for an existing plan

Before exploring or planning, check whether `.claude/plan/` already has a plan file relevant to this task:

```bash
ls .claude/plan/
```

- If a matching plan file exists → read it completely, then skip to Step 4.
- If no plan exists or it is stale → continue to Step 2.

---

### Step 2 — Explore the codebase (invoke `backend-codebase-explorer` agent)

Spawn the `backend-codebase-explorer` agent via the `Agent` tool. The agent maps backend layers, extracts live conventions, and surfaces violation hotspots in the target area.

Why this is delegated: the agent reads many files at once and returns a single CONTEXT BLOCK — this protects the main conversation from excessive file content while still grounding Step 3 in the real codebase.

What the agent reports back:
- Aggregates and entities that already exist in the affected packages
- Established patterns (naming, error handling, FP usage, file layout)
- Any pre-existing boundary or FP violations in the target area
- Pointers to comparable prior implementations to copy from

Save the agent's CONTEXT BLOCK — it is the required input for Step 3.

---

### Step 3 — Generate a plan (invoke `backend-plan-generator` agent)

Spawn the `backend-plan-generator` agent via the `Agent` tool, passing the CONTEXT BLOCK from Step 2 and the user's task description. The agent writes a detailed, architecture-safe plan to `.claude/plan/<slug>.md`.

Why this is delegated: the plan-generator agent enforces clean-architecture + DDD invariants while drafting the plan, so the file paths, snippets, and verification checklist are guaranteed to obey package boundaries before a single line of code is written.

The plan must specify:
- Which packages/layers will be touched
- What files will be created or modified
- Entry points in each layer
- Dependencies between layers

After the agent returns:
1. Confirm the file was written to `.claude/plan/<slug>.md`
2. Read the entire plan before proceeding to Step 4 — never code from the agent's summary alone

---

### Step 4 — Implement layer by layer

Follow the plan's entry points. Work innermost-first:

**Domain (`@repo/domain`) → Application (`@repo/application`) → Infrastructure (`apps/backend`) → Presentation (`apps/backend`)**

For each layer, invoke the matching skill before writing any code:

| Layer | Skill | Location |
|-------|-------|----------|
| Domain | `/backend-domain-layer` | `packages/domain/src/` |
| Application | `/backend-application-layer` | `packages/application/src/` |
| Infrastructure | `/backend-infrastructure-layer` | `apps/backend/src/infrastructure/` |
| Presentation | `/backend-presentation-layer` | `apps/backend/src/presentation/` |

**After completing each layer**, run `/backend-arch-validator <layer>` to catch drift before it compounds.

**Rules during implementation:**
- Follow the plan exactly — do not add unrequested behaviour
- One layer at a time — do not interleave domain and application code
- All entity properties must be `readonly`; methods return new instances
- No `throw`, `try/catch`, or `T | null` — use `Result` and `Option` from `@carbonteq/fp`
- All async pipelines must end with `.toPromise()`
- Export new public types from the package barrel (`index.ts`)

---

### Step 5 — Generate tests for new code

Invoke `/backend-test-suite` for every new file created in Step 4:

```
/backend-test-suite <file paths or feature name> all
```

Why this comes before type-check and the test run: test files exercise the public surface of new code, so type errors introduced by the new tests should be caught in Step 6 alongside any errors in the implementation itself, and the new tests should run as part of the same suite in Step 7 — not separately.

---

### Step 6 — Verify types

After implementation and test generation, run type-check across the affected packages:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
```

If there are type errors: fix every one before proceeding. Do not continue to Step 7 with a failing type-check. Repeat until clean.

---

### Step 7 — Run all tests

Run the test suite(s) that cover the changed packages — this includes both pre-existing tests and the new tests generated in Step 5:

```bash
pnpm turbo run test --filter=@repo/domain       # if packages/domain/ was touched
pnpm turbo run test --filter=@repo/application   # if packages/application/ was touched
pnpm turbo run test --filter=backend             # if apps/backend/ was touched
```

If tests fail: fix the implementation (or the tests if they are wrong), never suppress failures.

---

### Step 8 — Simplify

Invoke `/simplify` on all files changed in Steps 4–5. Apply non-controversial suggestions. If a suggestion conflicts with a plan invariant or an architectural rule, skip it and note it in the final report.

After applying changes from `/simplify`, re-run type-check and tests one more time to confirm nothing regressed.

---

### Step 9 — Code review (invoke `backend-code-reviewer` agent)

Spawn the `backend-code-reviewer` agent via the `Agent` tool, passing:
- The plan file path (`.claude/plan/<slug>.md`)
- The full list of files created or modified in Steps 4–8

Why this is the final gate: the code-reviewer agent is read-only — it audits the submitted output against Clean Architecture package boundaries, `@carbonteq/fp` correctness, error hierarchy rules, and test completeness, then returns either PASS or a structured revision list. It never modifies code itself, so violations come back to this orchestrator for fixing.

Handle the result:
- **PASS** → proceed to Step 10.
- **REVISION REQUIRED** → fix every violation, then re-spawn `backend-code-reviewer` with the same file list. Repeat until PASS. The task is not complete until PASS is returned.

---

### Step 10 — Final report

Output this summary:

```
## Implementation Complete

### Task
<task description>

### Plan
.claude/plan/<slug>.md

### Files changed
| File | Operation | Layer/Package |
|------|-----------|---------------|
| packages/domain/src/... | CREATE | @repo/domain |
| packages/application/src/... | MODIFY | @repo/application |
| apps/backend/src/... | CREATE | backend |

### Verification
turbo check-types          ✅ 0 errors
turbo test (domain)        ✅ N passed
turbo test (application)   ✅ N passed
turbo test (backend)       ✅ N passed
backend-code-reviewer       ✅ PASS

### How to run tests
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

---

## Non-negotiable rules

1. **Never skip the plan step** for cross-layer tasks — a bad plan wastes more time than making one.
2. **Never proceed past a failing type-check** — fix errors before moving forward.
3. **Always work innermost-first**: Domain → Application → Infrastructure → Presentation.
4. **Always invoke layer skills** — do not write layer code from scratch without invoking the matching skill.
5. **Always run `/backend-arch-validator`** after each layer before proceeding to the next.
6. **Never suppress test failures** — fix the root cause.
7. **Always export new public types** from the package barrel (`index.ts`) so downstream packages can import them.
8. **Never declare the task done until `backend-code-reviewer` returns PASS** — the agent is the final architectural gate, and any revision list it produces must be fully resolved.
