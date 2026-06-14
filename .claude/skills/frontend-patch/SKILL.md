---
name: frontend-patch
description: Fast path for small, single-layer, modification-only frontend changes — fixing a primitive variant, adding a field to a Zod wire type, tweaking a service error map, adjusting a container hook, fixing a layout gate, etc. No plan, no codebase explorer. Invoke the matching frontend layer skill, make the change, verify with type-check + the narrowest test, done. Trigger proactively whenever the user describes a small, well-scoped change to an existing frontend file in a single layer.
user-invocable: true
argument-hint: "<what to change and where>"
version: 1.0.0
---

# frontend-patch

Fast-path workflow for small, single-layer frontend changes. Skips the full `/frontend-implement` orchestration chain and goes straight to making the change.

---

## Eligibility check — ALL conditions must be true

Before using this path, confirm every condition:

| # | Condition | If false → |
|---|-----------|------------|
| 1 | Modifying **existing** files only — no new files created | Use `/frontend-implement` |
| 2 | **Single layer/package** only (primitives, composites, services, stores, containers, or routes) | Use `/frontend-implement` |
| 3 | No **new** primitive, composite, service module, store, container folder, or route | Use `/frontend-implement` |
| 4 | The affected unit is already known from the current conversation or a quick read | Use `/frontend-implement` |

If any condition is false, stop and invoke `/frontend-implement` instead. The fast path is a tool for small, well-bounded edits — anything that crosses a boundary or introduces a new abstraction is better served by the full chain.

---

## Fast-path workflow

### Step 1 — Invoke the matching layer skill

Load the layer skill for the layer being touched before writing any code. The skill brings the relevant patterns and forbidden-list into the conversation so the patch stays consistent with the rest of the codebase.

| Layer / Location | Skill |
|------------------|-------|
| `packages/ui/src/primitives/` | `/frontend-primitive-layer` |
| `packages/ui/src/composites/`, `apps/web/src/components/` | `/frontend-composite-layer` |
| `apps/web/src/services/` | `/frontend-service-layer` |
| `apps/web/src/stores/` | _(rules are short — see reminders below)_ |
| `apps/web/src/containers/<Feature>Container/` | `/frontend-container-layer` |
| `apps/web/app/` | `/frontend-route-layer` |
| WebSocket / MediaRecorder / audio playback in `InterviewSessionContainer` | `/frontend-voice-pipeline` |

### Step 2 — Read the target file(s)

Read every file you will modify before changing anything. Never edit blind, even on the fast path — small patches still depend on local context (existing variant names, current export shape, neighbouring tests).

### Step 3 — Make the change

Follow all rules from the layer skill. Key reminders by layer:

- **Primitives:** use the `cn()` helper, semantic Tailwind tokens only, `forwardRef` + `displayName` on interactive primitives.
- **Composites:** no services, no `useQuery`/`useMutation`, no Zustand. Forms assume a `FormProvider` ancestor.
- **Services:** no React imports, no `throw`, every response parsed through a Zod schema, return `Result<T, ServiceError>`.
- **Stores:** UI state only — never server data (that lives in the TanStack Query cache).
- **Containers:** data calls and orchestration live in the co-located `use<Feature>.ts` hook, not in the `.tsx`. Keep the component a thin switch over the hook's view-model.
- **Routes:** `page.tsx` and `layout.tsx` stay Server Components — no `"use client"`, no `useState`/`useEffect`/`useQuery`. Auth/session gating happens in the layout server-side.

### Step 4 — Verify

Run type-check on the affected package:

```bash
pnpm turbo run check-types --filter=web        # apps/web/* changes
pnpm turbo run check-types --filter=@repo/ui   # packages/ui/* changes
```

Fix every type error before continuing. Then run the narrowest test that covers the change:

```bash
pnpm turbo run test --filter=web         # apps/web/*
pnpm turbo run test --filter=@repo/ui    # packages/ui/*
```

If tests fail, fix the root cause — don't suppress.

### Step 4b — (optional) `/frontend-arch-validator`

If the change is at all near a layer boundary, run `/frontend-arch-validator <layer>` afterwards. It's a fast grep-style check and catches the obvious boundary mistakes (`fetch` in a component, raw color scale, missing `forwardRef`, missing barrel) before they slip in.

### Step 5 — Done

Report what changed and confirm type-check + tests passed. No plan file needed.

---

## Examples of patch-eligible tasks

- Add a new variant to an existing primitive (`variant: "destructive"` for `Button`)
- Tweak Tailwind classes on an existing composite (still using semantic tokens)
- Add a new field to an existing wire type in `apps/web/src/types/<noun>.types.ts` AND its consumer service method
- Add a new branch to a container's `mapErrorToToast` switch (e.g., handle a new server error code)
- Fix a missing `aria-label` or `aria-describedby` on a primitive
- Add a new action to an existing Zustand store (e.g., `closeAllDialogs`)
- Update an existing service method body (e.g., add a query param, change a header)
- Fix a wrong `queryKey` or stale `enabled` condition in an existing container hook
- Adjust the gating logic in an existing `(recruiter)/layout.tsx` or `(candidate)/.../layout.tsx`
- Add a new `toast.success(...)` trigger inside an existing container hook
- Fix a Zod schema field type (e.g., make a nullable field optional)

---

## Examples that require `/frontend-implement` instead

- Creating a new primitive, composite, service module, store, or container folder
- Adding a new route (a new `page.tsx`)
- A change that touches a service AND the container that consumes it
- Adding TanStack Query to a feature that didn't have it before
- Setting up a new form (RHF + zodResolver + container + FormField wiring)
- Anything in the voice pipeline that introduces a new state machine event or state
- Migrating components from raw color scales to semantic tokens across many files
- Adding a new role-based route group

---

## Why this skill exists

Every small patch that goes through the full chain spends time on exploration and planning that doesn't pay off when the change is one variant or one field. The full chain is right when boundaries are at stake; the fast path is right when they aren't. The eligibility check is the gate that protects against using the fast path for something it isn't meant to handle.
