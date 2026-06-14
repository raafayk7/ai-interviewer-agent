---
name: frontend-implement
description: End-to-end implementation orchestrator for the frontend clean architecture. Use this skill for any feature, fix, or refactor spanning multiple files or layers. Chains the frontend-codebase-explorer + frontend-plan-generator agents → layer skills (types → services → stores → containers → composites/components → primitives if new → routes) with /frontend-arch-validator after each → /frontend-test-suite → type-check + lint → /simplify → frontend-code-reviewer agent → final report. Trigger proactively whenever the user describes a multi-layer frontend task or asks to implement a frontend feature.
user-invocable: true
argument-hint: "<feature or task description>"
version: 1.0.0
---

# frontend-implement

One-shot orchestrator for the frontend clean architecture. Runs every mandatory step in the correct order so nothing is skipped. Invoke this skill before writing a single line of code on a multi-layer feature.

---

## When to use this skill

Use `/frontend-implement <task>` for any task that:
- Touches more than one file, or
- Crosses more than one layer, or
- Introduces a new primitive, composite, service, store, container, or route

For a single-file change in a known unit, invoke the layer skill directly (`/frontend-primitive-layer`, `/frontend-service-layer`, etc.) or use `/frontend-patch`.

---

## Layer → skill mapping

| Layer | Location | Skill |
|-------|----------|-------|
| Types (wire schemas) | `apps/web/src/types/` | _(handled inline with services)_ |
| Services | `apps/web/src/services/` | `/frontend-service-layer` |
| Stores | `apps/web/src/stores/` | _(simple — follow `/frontend-arch-validator` rules)_ |
| Containers | `apps/web/src/containers/<Feature>Container/` | `/frontend-container-layer` |
| Composites (cross-app) | `packages/ui/src/composites/` | `/frontend-composite-layer` |
| Components (web-only) | `apps/web/src/components/` | `/frontend-composite-layer` |
| Primitives | `packages/ui/src/primitives/` | `/frontend-primitive-layer` |
| Routes | `apps/web/app/` | `/frontend-route-layer` |
| Voice pipeline | `apps/web/src/containers/InterviewSessionContainer/` | `/frontend-voice-pipeline` |

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

### Step 2 — Explore the codebase (invoke `frontend-codebase-explorer` agent)

Spawn the `frontend-codebase-explorer` agent via the `Agent` tool. It maps the frontend layers, extracts live conventions (naming, state placement, error mapping patterns), and surfaces violation hotspots in the target area.

Why delegated: the agent reads many files at once and returns a single CONTEXT BLOCK — this protects the main conversation from raw file content while still grounding Step 3 in the real codebase.

What the agent reports:
- Containers, services, and stores that already exist in the affected area
- Established patterns (naming, query keys, error-to-toast mapping, file layout)
- Pre-existing boundary or state-boundary violations near the target
- Comparable prior implementations to copy from

Save the CONTEXT BLOCK — it is the required input for Step 3.

---

### Step 3 — Generate a plan (invoke `frontend-plan-generator` agent)

Spawn the `frontend-plan-generator` agent via the `Agent` tool, passing the CONTEXT BLOCK from Step 2 and the user's task description. The agent writes a detailed, architecture-safe plan to `.claude/plan/<slug>.md`.

Why delegated: the plan-generator enforces clean-architecture + state-boundary invariants while drafting, so the file paths, snippets, and verification checklist are guaranteed to obey the layer boundaries before a single line of code is written.

The plan must specify:
- Which layers will be touched
- What files will be created or modified
- Entry points in each layer
- Dependencies between layers

After the agent returns:
1. Confirm the file was written to `.claude/plan/<slug>.md`
2. Read the entire plan before proceeding — never code from the agent's summary alone

---

### Step 4 — Implement layer by layer

Follow the plan's entry points. Implementation order:

**Types → Services → Stores → Primitives (if new) → Composites → Containers → Routes**

The rationale: types must exist before the service that returns them; services before the stores or containers that reference their error union; stores before the containers that read from them; primitives before the composites that compose them; composites before the containers that render them; containers before the routes that mount them. Build bottom-up on the rendering path and inside-out on the data path; the two meet at the container.

For each layer, invoke the matching skill before writing any code:

| Layer | Skill |
|-------|-------|
| services | `/frontend-service-layer` |
| stores | _(rules short — follow `/frontend-arch-validator`)_ |
| primitives | `/frontend-primitive-layer` |
| composites | `/frontend-composite-layer` |
| containers | `/frontend-container-layer` |
| routes | `/frontend-route-layer` |
| voice pipeline (if applicable) | `/frontend-voice-pipeline` |

## Related ADRs

- [ADR-021](../../../docs/adr/ADR-021-adopt-zustand-for-frontend-client-state.md) — Zustand for UI state
- [ADR-022](../../../docs/adr/ADR-022-use-tanstack-query-for-frontend-server-state.md) — TanStack Query for server state
- [ADR-023](../../../docs/adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) — shadcn/ui + Radix + Tailwind v4
- [ADR-024](../../../docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) — React Hook Form + Zod 4

**After completing each layer**, run `/frontend-arch-validator <layer>` to catch drift before it compounds.

**Rules during implementation:**
- Follow the plan exactly — no unrequested behaviour
- One layer at a time — never interleave services and containers
- Containers always get the three-file folder pattern (`<Feature>Container.tsx` + `use<Feature>.ts` + `index.ts`)
- Services return `Result<T, ServiceError>` — never `throw`, every response Zod-parsed
- No `fetch()` outside services, no `useQuery`/`useMutation` outside containers, no Zustand inside `packages/ui`
- `"use client"` only on the container (and small client-only providers like `QueryProvider`) — never on `page.tsx`/`layout.tsx`
- Semantic Tailwind tokens only; never raw color scales (`bg-blue-500`)
- `forwardRef` + `displayName` on interactive primitives

---

### Step 5 — Generate tests for new code

Invoke `/frontend-test-suite` for every new file created in Step 4:

```
/frontend-test-suite <file paths or feature name> all
```

This delegates the actual writing to the `frontend-test-generator` agent.

Why before type-check: the test files exercise the public surface of new code, so type errors introduced by the tests should be caught in Step 6 alongside any in the implementation itself, and the new tests run as part of the same suite in Step 7.

---

### Step 6 — Verify types and lint

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui    # if a lint task is wired
```

Fix every error before continuing. Do not proceed to Step 7 with a failing type-check.

---

### Step 7 — Run all tests

Run the suites covering the changed packages — both pre-existing tests and the new ones from Step 5:

```bash
pnpm turbo run test --filter=web         # if apps/web/* was touched
pnpm turbo run test --filter=@repo/ui    # if packages/ui/* was touched
pnpm --filter=web exec playwright test   # if E2E specs were added
```

If tests fail: fix the implementation (or the tests if they are wrong). Never suppress failures.

---

### Step 8 — Simplify

Invoke `/simplify` on all files changed in Steps 4–5. Apply non-controversial suggestions. If a suggestion conflicts with a layer rule or a plan invariant, skip it and note it in the final report.

After applying changes from `/simplify`, re-run type-check + tests once more to confirm nothing regressed.

---

### Step 9 — Code review (invoke `frontend-code-reviewer` agent)

Spawn the `frontend-code-reviewer` agent via the `Agent` tool, passing:
- The plan file path (`.claude/plan/<slug>.md`)
- The full list of files created or modified in Steps 4–8

Why this is the final gate: the reviewer is read-only — it audits the submitted output against clean-architecture layer boundaries, state-boundary rules, FP/error correctness in services, token discipline, and test completeness, then returns PASS or a structured revision list. It never modifies code, so violations come back here to fix.

Handle the result:
- **PASS** → proceed to Step 10.
- **REVISION REQUIRED** → fix every violation, then re-spawn `frontend-code-reviewer` with the same file list. Repeat until PASS. The task is not complete until PASS is returned.

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
| File | Operation | Layer |
|------|-----------|-------|
| apps/web/src/types/...              | CREATE | types |
| apps/web/src/services/...           | CREATE | services |
| apps/web/src/stores/...             | CREATE | stores |
| apps/web/src/containers/<Feature>Container/... | CREATE | containers |
| packages/ui/src/composites/...      | CREATE | composites |
| apps/web/app/(recruiter)/.../page.tsx | CREATE | routes |

### Verification
turbo check-types         ✅ 0 errors
turbo test (web)          ✅ N passed
turbo test (@repo/ui)     ✅ N passed
Playwright e2e            ✅ N passed (if applicable)
frontend-arch-validator   ✅ CLEAN (per layer)
frontend-code-reviewer    ✅ PASS

### How to run tests
pnpm turbo run test --filter=web
pnpm turbo run test --filter=@repo/ui
pnpm --filter=web exec playwright test
```

---

## Non-negotiable rules

1. **Never skip the plan step** for cross-layer tasks — a bad plan wastes more time than making one.
2. **Never proceed past a failing type-check** — fix errors before moving forward.
3. **Always work in dependency order**: Types → Services → Stores → Primitives (if new) → Composites → Containers → Routes. Visuals build bottom-up; data flows inside-out; the two meet at the container.
4. **Always invoke layer skills** — never write layer code from scratch without loading the matching skill first.
5. **Always run `/frontend-arch-validator <layer>`** after each layer before proceeding to the next.
6. **Never suppress test failures** — fix the root cause.
7. **Always include the `index.ts` barrel** for every new container folder — without it, imports leak the folder's internal structure.
8. **Never declare the task done until `frontend-code-reviewer` returns PASS** — the agent is the final architectural gate, and any revision list it produces must be fully resolved.
