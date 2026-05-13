---
name: frontend-arch-validator
description: Lightweight mid-implementation boundary and state-boundary check for the frontend clean architecture. Scans the requested layer(s) for cross-layer import violations, state-boundary breaches (fetch outside services, TanStack Query outside containers, Zustand outside stores, server data in stores), Tailwind token discipline (no raw color scales), interactive primitives missing forwardRef, the container three-file pattern, and "use client" creeping into pages/layouts. Use this after finishing each layer during /frontend-implement to catch drift early — before it compounds. Also user-invocable at any time. Trigger proactively when the user finishes editing a frontend layer, asks "is this clean?", says "check the boundaries", or completes a layer in a multi-layer task.
user-invocable: true
argument-hint: "<file path(s) or layer name: primitives | composites | services | stores | containers | routes | all>"
version: 1.0.0
---

# frontend-arch-validator

A fast, focused architectural check for the frontend. Cheaper than a full code review — it only verifies boundary and state-boundary correctness. Run it after completing each layer so any drift is fixed before it compounds across the rest of the implementation.

---

## When to use

| Trigger | Usage |
|---------|-------|
| After finishing a layer in `/frontend-implement` | `/frontend-arch-validator <layer>` (e.g., `services`, `containers`) |
| After a `/frontend-patch` change, as a sanity check | `/frontend-arch-validator <file path>` |
| Suspect a layer boundary leaked | `/frontend-arch-validator all` |
| Before opening a PR on a branch with many frontend changes | `/frontend-arch-validator all` |

---

## What it checks

1. **Layer boundary imports** — no forbidden cross-layer imports
2. **State boundaries** — no TanStack Query in `packages/ui/`, no Zustand in `packages/ui/`, no `fetch()` outside services, no server data stored inside Zustand stores
3. **Tailwind token discipline** — no raw color scales (`bg-blue-500`, `text-red-900`, etc.)
4. **A11y / `forwardRef` on interactive primitives** — anything that renders `<button>`, `<input>`, `<textarea>`, `<select>`, or wraps Radix must use `React.forwardRef` and set `displayName`
5. **Container three-file pattern** — every `<Feature>Container/` folder has `<Feature>Container.tsx`, a `use*.ts`, and `index.ts`
6. **No `"use client"` in `page.tsx` or `layout.tsx`** — Server Components by default
7. **No `@repo/domain` or `@repo/application` imports** anywhere under `apps/web/` or `packages/ui/`

It does NOT check: test coverage, performance, exhaustive a11y, or subjective design quality.

---

## Allowed import directions

```
packages/ui/primitives/   → react, @radix-ui/react-*, class-variance-authority,
                            @repo/ui/lib/cn (which uses clsx + tailwind-merge),
                            lucide-react
packages/ui/composites/   → react, react-hook-form (form composites only),
                            @repo/ui/primitives/*, @repo/ui/lib/cn, lucide-react
apps/web/src/services/    → zod, @/lib/env, @/lib/result, @/types/*
apps/web/src/stores/      → zustand, react
apps/web/src/containers/  → @tanstack/react-query, react-hook-form,
                            @hookform/resolvers, zustand stores, services,
                            composites, primitives, next/navigation, sonner
apps/web/src/components/  → primitives, composites, react
apps/web/app/             → containers, server-side auth/utils, next/*
```

### Forbidden imports

| Layer | Must NOT import from |
|-------|---------------------|
| `packages/ui/*` | `apps/web/*`, `@repo/domain`, `@repo/application`, `@tanstack/react-query`, `zustand` |
| `apps/web/src/services/*` | `react`, `@tanstack/react-query`, `react-hook-form`, `zustand`, `@repo/domain`, `@repo/application` |
| `apps/web/src/stores/*` | services, `@tanstack/react-query`, `@repo/domain`, `@repo/application` |
| `apps/web/src/components/*` | services, `@tanstack/react-query`, `zustand` |
| `apps/web/app/**/{page,layout}.tsx` | client-only hooks (`useState`, `useEffect`, `useQuery`, `useMutation`), `"use client"` directive |
| anywhere in `apps/web/` | `@repo/domain`, `@repo/application` |

Note: TypeScript + `package.json` dependencies catch some of this already. This validator catches the conventions inside `apps/web` and `packages/ui` that the type system doesn't.

---

## State-boundary checks (grep patterns)

Run these as ripgrep searches over the in-scope files:

| Pattern | Violation if found in |
|---|---|
| `\bfetch\s*\(` | anywhere outside `apps/web/src/services/` |
| `\buse(Query\|Mutation\|QueryClient\|InfiniteQuery)\b` | anywhere outside `apps/web/src/containers/` |
| `from\s+["']zustand["']` with `create` | outside `apps/web/src/stores/` |
| `use(FormContext\|Form)\b` from `react-hook-form` | outside containers OR composites named `form-*` |
| `^["']use client["']` | inside `apps/web/app/**/{page,layout}.tsx` |
| `\buseState\b` or `\buseEffect\b` | inside `apps/web/app/**/{page,layout}.tsx` |
| Raw color scale regex: `\b(bg\|text\|border\|ring\|from\|to)-(red\|blue\|green\|yellow\|orange\|purple\|pink\|gray\|slate\|zinc\|neutral\|stone)-\d{2,3}\b` | anywhere in `apps/web/` or `packages/ui/` |

**Server data in a Zustand store** — heuristic only. Flag stores whose state fields mirror a service return type (e.g., a `campaigns: Campaign[]` field) for review. Don't auto-fail — sometimes the field is legitimately UI cache (e.g., optimistic UI). Mention it in the report and let the human decide.

---

## Container three-file pattern check

For each folder under `apps/web/src/containers/`, require all three:

- `<FolderName>.tsx`
- `use*.ts` (any file starting with `use` — the co-located hook)
- `index.ts`

Flag folders missing any of the three. Without `index.ts`, importers leak the internal folder structure into call sites.

---

## Interactive primitive `forwardRef` check

For each file under `packages/ui/src/primitives/`:

- If it imports from `@radix-ui/react-*`, OR
- Renders `<button>`, `<input>`, `<textarea>`, or `<select>`,

then it must use `React.forwardRef` AND set `<Component>.displayName = "<Component>"`. Flag missing either.

The reason this check matters: parents (RHF, Radix triggers, focus management utilities) attach refs to interactive elements. A primitive that swallows the ref breaks every downstream consumer in a way that is hard to debug from the consumer side.

---

## Execution

### Step 1 — Resolve scope

From `$ARGUMENTS`:

| Argument | Files to check |
|----------|---------------|
| `primitives` | `packages/ui/src/primitives/**` |
| `composites` | `packages/ui/src/composites/**` and `apps/web/src/components/**` |
| `services` | `apps/web/src/services/**` |
| `stores` | `apps/web/src/stores/**` |
| `containers` | `apps/web/src/containers/**` |
| `routes` | `apps/web/app/**` |
| `all` | every layer above |
| `<file path>` | that file only |
| _(no argument)_ | ask the user which layer or files to check |

### Step 2 — Check imports

For each file in scope, scan every `import` / `from` statement against the allowed-import table. Flag anything that crosses a forbidden boundary.

### Step 3 — Run state-boundary grep checks

Run the grep patterns from the table above. Flag every hit.

### Step 4 — Container three-file pattern check (only if `containers` in scope)

List subdirectories of `apps/web/src/containers/`. For each, check the three required files. Flag missing ones.

### Step 5 — Interactive primitive `forwardRef` check (only if `primitives` in scope)

For each primitive file, check if it qualifies as interactive (imports Radix or renders a native input element). If yes, ensure `React.forwardRef` and `displayName` are both present.

### Step 6 — Raw color scale grep

Always run when any in-scope files exist. The pattern above will catch every raw scale token. Report file + line.

### Step 7 — Report

If any violations were found, list them with file:line, the rule violated, and the fix. Block forward progress until they're resolved.

---

## Output format

### Clean

```
frontend-arch-validator: CLEAN

Files checked: <list>
No boundary, state, or token violations detected.
```

### Violations found

```
frontend-arch-validator: VIOLATIONS FOUND

Fix all items before proceeding to the next layer.

1. apps/web/src/components/header.tsx:7
   Forbidden import: `import { useQuery } from "@tanstack/react-query"`
   Fix: components must not call useQuery — move the data dependency up to a container

2. packages/ui/src/primitives/button.tsx:18
   Missing React.forwardRef on interactive primitive (renders <button>)
   Fix: wrap with React.forwardRef and set Button.displayName = "Button"

3. apps/web/src/services/campaign.service.ts:5
   Forbidden import: `import { useState } from "react"`
   Fix: services are framework-agnostic — remove React imports

4. apps/web/app/(recruiter)/campaigns/page.tsx:1
   "use client" in page.tsx
   Fix: pages are Server Components by default — move client logic into the container

5. apps/web/src/containers/CampaignListContainer/ (folder)
   Missing required file: index.ts
   Fix: add a barrel `export * from "./CampaignListContainer"`

6. apps/web/src/components/recruiter-page-shell.tsx:34
   Raw color scale: `bg-blue-500`
   Fix: use a semantic Tailwind token (bg-primary, bg-accent, etc.) defined in globals.css
```

---

## Position in the `/frontend-implement` chain

After finishing each layer and before starting the next:

```
Types/Services complete       → /frontend-arch-validator services       → CLEAN → proceed to Stores
Stores complete                → /frontend-arch-validator stores         → CLEAN → proceed to Containers
Containers complete            → /frontend-arch-validator containers     → CLEAN → proceed to Composites/Components
Composites/Components complete → /frontend-arch-validator composites     → CLEAN → proceed to Routes
Routes complete                → /frontend-arch-validator routes         → CLEAN → done
```

If `frontend-arch-validator` returns violations at any layer: fix them before proceeding. Carrying violations forward is the fastest way to accumulate technical debt that becomes expensive to remove later.
