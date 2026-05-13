---
name: frontend-primitive-layer
description: Write, review, or reason about leaf UI primitives in packages/ui/src/primitives/ — Button, Input, Label, Card, Dialog, Tooltip, and other atomic shadcn-style components built on Radix + Tailwind v4 + CVA. Use this skill when the user asks to create or modify a primitive, add a new shadcn-style atom, wire CVA variants, wrap a Radix primitive, or fix a11y/styling on a low-level UI element. Use proactively whenever the user is touching packages/ui/src/primitives/.
user-invocable: true
version: 1.0.0
---

# Primitive Layer (`@repo/ui/primitives`)

Primitives are the leaf layer of the UI. They are pure presentation — single-purpose, atomic, owned by us (shadcn-style: copied into the repo, not pulled from an installable component library). They know nothing about the user, the API, the route, or any business rule.

**Package:** `packages/ui/` — published as `@repo/ui`
**Location:** `packages/ui/src/primitives/`
**Imports from:** `react`, `@radix-ui/react-*` (when interactive), `class-variance-authority`, `clsx`/`tailwind-merge` (via `cn`), `lucide-react`. Nothing else.

**One question to ask at every decision point:** "Does this need to know about the user, the API, or the URL?" If yes, it does not belong here — push it up to a composite or container.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Primitive component | Single-purpose atomic UI (Button, Input, Label, Card, Dialog, Tooltip, etc.) |
| Variant definitions (CVA) | Size / intent / state variants, colocated as a sibling `cva()` call |
| Radix wrapping | Interactive primitives wrap `@radix-ui/react-*` to inherit focus, ARIA, and keyboard handling |

What does NOT belong here: any composite of two unrelated primitives (a search bar made of an Input + Button), any form schema, any data fetch, any toast/store coupling.

---

## Component shape

Every interactive primitive follows this exact shape. Static visual-only primitives (e.g., a non-interactive Card) may omit `forwardRef`, but everything that takes user input, focus, or imperative refs MUST forward refs and set `displayName`.

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@repo/ui/lib/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-6" },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"
```

Why `forwardRef` + `displayName`: parent components (composites, RHF wrappers, Radix triggers) need to attach refs for focus management, scrolling, and imperative handles. `displayName` makes the component legible in React DevTools and error stacks. Skipping either breaks debugging and forms integration.

Why CVA: variants are part of the component's contract. Encoding them in a sibling `cva()` const gives type-safe variant props (`VariantProps<typeof buttonVariants>`) and keeps class strings declarative instead of conditional soup inside JSX.

---

## Styling rules

- Use the `cn()` helper from `@repo/ui/lib/cn` for all className composition. It merges `clsx` conditional logic with `tailwind-merge` conflict resolution. Hand-concatenating strings or template literals defeats both.
- Use **semantic Tailwind tokens** that come from `apps/web/app/globals.css`: `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-input`, `ring-ring`, `bg-destructive`, `text-destructive-foreground`, `bg-accent`, `text-accent-foreground`, `bg-background`, `text-foreground`. These map through `@theme inline` to the project's design tokens.
- **Never** use raw color scales (`bg-blue-500`, `text-red-900`, `border-gray-200`). If a token is missing for what you need, extend the semantic palette in `globals.css` first, then use the new semantic token here.
- Variants live in a sibling const via `cva`. No inline ternaries that concatenate class strings inside JSX.
- Animations use `tw-animate-css` utilities (e.g., `animate-in fade-in-0`, `data-[state=open]:slide-in-from-top-2`). Don't write custom keyframes here.

---

## Accessibility

- Interactive primitives MUST wrap `@radix-ui/react-*` to inherit focus management, ARIA wiring, and keyboard handlers:
  - Dialog → `@radix-ui/react-dialog`
  - Tooltip → `@radix-ui/react-tooltip`
  - Popover → `@radix-ui/react-popover`
  - Select → `@radix-ui/react-select`
  - Checkbox → `@radix-ui/react-checkbox`
  - etc.
  Do not roll a custom Dialog, Popover, or Combobox — Radix has already solved focus-trap, ESC handling, return-focus, and screen-reader announcements.
- Always forward refs on interactive primitives. Always set `displayName`.
- Respect `prefers-reduced-motion` via Tailwind's `motion-reduce:` variants where animations are non-essential (e.g., `motion-reduce:transition-none`).

---

## Icons

`lucide-react` is the icon library. Icons are passed in as children or props by the consumer — they are not bundled into the primitive itself. A `<Button>` takes an `<Icon />` as a child; the primitive does not hard-code which icon to render.

```tsx
import { ChevronRight } from "lucide-react"
<Button variant="outline">Next <ChevronRight className="ml-2 h-4 w-4" /></Button>
```

---

## What is forbidden

- Importing from `apps/web/*` — primitives live in the package and must remain reusable
- Importing from `@repo/domain` or `@repo/application` — primitives know nothing about the backend
- Using `fetch`, `useQuery`, `useMutation`, `axios`, or any HTTP client — no network access at this layer
- Using Zustand or any app store hook
- Raw color scales (`bg-blue-500`, `text-red-900`, etc.) — use semantic tokens
- Component-specific design tokens (`--my-button-padding`) — extend the semantic palette in `globals.css` and use the new token instead
- Missing `forwardRef` on interactive primitives
- Inline `cn()` chains without the `cn` helper — always import and use it
- Bundling business strings into primitives (e.g., a Button that hard-codes "Submit application") — text is passed in by the consumer

---

## File layout

```
packages/ui/src/
├── primitives/
│   ├── button.tsx
│   ├── input.tsx
│   ├── label.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   ├── tooltip.tsx
│   └── ...
├── lib/
│   └── cn.ts
└── styles/         ← only if shared global utility styles are needed
```

One primitive per file. Sub-parts (e.g., `DialogTrigger`, `DialogContent`) live in the same file as the parent primitive.

---

## When in doubt

If it needs to know about the user, the API, or the URL — it does not belong here. Push the knowledge up to a composite or container, and keep the primitive a dumb leaf.

---

## Related ADRs

- [ADR-023](../../../docs/adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) — shadcn/ui + Radix + Tailwind v4 + semantic tokens. This is the architectural source of truth for everything in this layer.
