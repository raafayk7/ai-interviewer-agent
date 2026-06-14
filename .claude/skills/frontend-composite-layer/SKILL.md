---
name: frontend-composite-layer
description: Write, review, or reason about composite UI components that combine multiple primitives — FormField, EmptyState, DataTable, PageShell, ConfirmDialog, app headers, page sections. Scope is BOTH packages/ui/src/composites/ (cross-app reusable) and apps/web/src/components/ (web-app-specific). Composites may use React Hook Form via FormProvider context, but never call services, useQuery, useMutation, or Zustand stores. Use this skill when the user asks to build a form field, wrap a Dialog with buttons, lay out a header, design an empty state, or any component that composes 2+ primitives. Use proactively whenever the user is touching packages/ui/src/composites/ or apps/web/src/components/.
user-invocable: true
version: 1.0.0
---

# Composite Layer (`@repo/ui/composites` and `apps/web/src/components/`)

Composites combine primitives into reusable patterns — `FormField`, `EmptyState`, `DataTable`, `ConfirmDialog`, `PageShell`, app headers, page sections. They still know nothing about specific API endpoints, specific business entities, or specific routes. They take all data and event handlers as props.

**Locations:**
- `packages/ui/src/composites/` — generic, cross-app composites (`@repo/ui`)
- `apps/web/src/components/` — web-app-specific composites

**Imports from:** `react`, `react-hook-form` (forms only), `@repo/ui/primitives/*`, `@repo/ui/lib/cn`, `lucide-react`. Nothing else.

**One question at every decision point:** "Does this need an API call, a query cache, or a global store to do its job?" If yes, it's a container, not a composite.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Layout composite | `Header`, `Footer`, `Sidebar`, `EmptyState`, `PageShell` — pure layout shells |
| Form composite | `FormField` (Label + Input + error), `FormSection`, `FormError` — wired to RHF via `useFormContext` |
| Data composite | `DataTable`, `Pagination`, `FiltersBar` — render rows/columns from props, no fetching |
| Feedback composite | Toast container wrapper, `ConfirmDialog` (Dialog primitive + button row), `Alert` |

If the component composes only one primitive and adds nothing, it's not a composite — keep using the primitive. If the component owns query state or calls a service, it's a container — push it up to `apps/web/src/containers/`.

---

## Where does it live?

Use this decision rule, in order:

1. If the composite is generic (`FormField`, `EmptyState`, `ConfirmDialog`, `DataTable`) AND would make sense in any future app → `packages/ui/src/composites/`
2. If the composite hard-codes web-app structure (`RecruiterPageHeader`, `CandidateInterviewBanner`, `AppShell` with our nav layout) → `apps/web/src/components/`
3. Default: prefer `packages/ui/src/composites/`. Demote to `apps/web/src/components/` only when web-only assumptions creep in.

The reason for the bias toward `@repo/ui`: anything that gets pulled into a future second app (docs site, internal tool) without modification belongs in the package; the only thing that justifies living in `apps/web` is project-specific structure.

---

## Composition rule

Composites consume primitives from the package's public exports:

```tsx
import { Button } from "@repo/ui/primitives/button"
import { Input } from "@repo/ui/primitives/input"
import { Label } from "@repo/ui/primitives/label"
```

They do not reach into another composite's internals or import private modules. If a composite needs a piece of another composite, that piece needs to be promoted to a primitive or exported explicitly.

---

## Form composites with React Hook Form

`FormField` is the canonical example. It assumes a `<FormProvider>` ancestor — it does not own the form, it does not handle submit, it does not call any mutation. The container above it owns all of that.

```tsx
"use client"
import * as React from "react"
import { useFormContext, type FieldPath, type FieldValues } from "react-hook-form"
import { Label } from "@repo/ui/primitives/label"
import { Input } from "@repo/ui/primitives/input"
import { cn } from "@repo/ui/lib/cn"

interface FormFieldProps<TFields extends FieldValues> {
  name: FieldPath<TFields>
  label: string
  type?: React.HTMLInputTypeAttribute
  placeholder?: string
  className?: string
}

export function FormField<TFields extends FieldValues>({
  name, label, type = "text", placeholder, className,
}: FormFieldProps<TFields>) {
  const { register, formState: { errors } } = useFormContext<TFields>()
  const error = errors[name]
  const errorMsg = typeof error?.message === "string" ? error.message : undefined
  const inputId = React.useId()
  const errorId = `${inputId}-error`
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        type={type}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        {...register(name)}
      />
      {errorMsg && <p id={errorId} className="text-sm text-destructive">{errorMsg}</p>}
    </div>
  )
}
```

Why a render-context split: the form schema, mutation, and toast wiring belong in the container. The composite's only job is "given a name + label, render the labelled input and surface RHF errors." This is what makes `FormField` reusable across every form in the app.

---

## Styling rules (same as primitives)

- Use the `cn()` helper from `@repo/ui/lib/cn` for all className composition
- Use semantic Tailwind tokens (`bg-primary`, `text-muted-foreground`, `border-input`, `text-destructive`, etc.) — never raw color scales (`bg-blue-500`)
- Component-specific design tokens belong in `apps/web/app/globals.css` as semantic tokens first, then referenced here
- Animations use `tw-animate-css` utilities; respect `motion-reduce:` where animation is non-essential

---

## Client / server boundary

- Composites that use React hooks (`useFormContext`, `useId`, `useState`, refs) MUST declare `"use client"` at the top of the file. Without it, Next.js will try to render them on the server and fail.
- Pure visual composites with no hooks (e.g., a static `EmptyState` that's just JSX over primitives) can stay server-renderable. Don't add `"use client"` unless the composite actually needs client-only APIs — it widens the client bundle.

---

## What is forbidden

- Importing services (`apps/web/src/services/*`) — composites do not call the API
- Importing TanStack Query hooks (`useQuery`, `useMutation`, `useQueryClient`)
- Importing Zustand stores from `apps/web/src/stores/*`
- Importing from `@repo/domain` or `@repo/application` — composites do not know backend types
- Hard-coding business strings the consumer should pass in (e.g., a `ConfirmDialog` that bakes "Are you sure you want to delete this campaign?" inside) — accept the strings as props
- Reaching into another composite's internals — use the public export
- Raw Tailwind color scales (`bg-blue-500`, `text-red-900`) — semantic tokens only
- Owning a form schema or submit handler — that lives in the container

---

## File layout

```
packages/ui/src/
├── primitives/...
└── composites/
    ├── form-field.tsx
    ├── form-section.tsx
    ├── empty-state.tsx
    ├── confirm-dialog.tsx
    ├── data-table.tsx
    └── pagination.tsx

apps/web/src/components/
├── header.tsx
├── candidate-interview-banner.tsx
├── recruiter-page-shell.tsx
└── ...
```

One composite per file. Sub-parts of a single composite (e.g., `DataTable` + `DataTableHeader` + `DataTableRow`) live in the same file.

---

## When in doubt

Composites compose. They don't fetch, they don't store, they don't decide what data means — they just lay it out and pass events back up. If you're reaching for `useQuery` or `useStore`, you've drifted into the container layer; stop and push that responsibility up.

---

## Related ADRs

- [ADR-023](../../../docs/adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) — shadcn/ui + Radix + Tailwind v4 + semantic tokens
- [ADR-024](../../../docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) — RHF + Zod 4 (form composites consume `FormProvider` context per this ADR)
