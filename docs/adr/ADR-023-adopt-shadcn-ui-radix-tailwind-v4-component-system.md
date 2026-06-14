# ADR-023 Adopt shadcn/ui (Radix + Tailwind v4) for the Frontend Component System

## Status

Accepted, 2026-05-13.

## Context

Phase 8 introduces `apps/web/` (the recruiter dashboard and the candidate interview screen) and `packages/ui/` (a shared component library across `apps/web/` and the existing `apps/docs/`). The frontend needs a component system that delivers:

1. **Accessibility by default** — keyboard navigation, focus management, ARIA roles. Re-implementing these by hand for every Dialog, Popover, Select, etc. is the single largest source of accessibility bugs in React codebases.
2. **Customisable visual language** — the candidate interview screen has unique design requirements (live transcript pane, audio-level meter, large CTA) that a pre-built component library theme would fight against.
3. **Small bundle** — no library runtime tax. Every dependency we add must justify its bundle cost against an explicit need.
4. **Theming via design tokens** — light/dark mode and brand customisation should flow from CSS variables, not from a JavaScript theming runtime.

The relevant existing repository state (already in place from Phase 8 scaffolding):

- `apps/web/package.json` already pulls in Tailwind v4 (`tailwindcss@^4.1.16`) plus the shadcn-companion stack: `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
- `apps/web/postcss.config.mjs` is configured with `@tailwindcss/postcss`.
- `apps/web/app/globals.css` declares the full shadcn-compatible design-token palette under `@theme inline` using the `oklch()` color space, plus the dark-mode overrides.
- `packages/ui/src/lib/cn.ts` exports the canonical `cn()` helper (`clsx` + `tailwind-merge`).
- Radix primitives are not yet installed but will be added per-primitive as we adopt each shadcn component (`@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-select`, etc.).

The Carbonteq frontend dev portal (https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/) recommends an atomic component organisation (primitives → composites) and semantic design tokens — shadcn's directory model and token system match this verbatim. The portal's older "Chakra UI" mention predates Tailwind v4's native CSS-variable token support and the shadcn/ui ecosystem maturation.

## Decision

Adopt shadcn/ui-style components — Radix primitives wrapped with Tailwind v4 + Class Variance Authority (CVA) variants — copied into `packages/ui/src/primitives/` for atomic UI elements (Button, Input, Dialog, Popover, Select, etc.) and composed into higher-level patterns under `packages/ui/src/composites/`. Tailwind v4 is configured via `@tailwindcss/postcss`; design tokens live in `apps/web/app/globals.css` under `@theme inline` using the `oklch()` color space. The `cn()` helper at `packages/ui/src/lib/cn.ts` (clsx + tailwind-merge) is the only class merger. Other component libraries (Chakra UI, MUI, Ant Design) and other styling systems (SCSS, LESS, CSS Modules, Panda CSS) are not adopted. Raw Tailwind color scales (`bg-blue-500` etc.) are not used in product code — semantic tokens (`bg-primary`, `text-muted-foreground`) are mandatory.

## Alternatives Considered

### Alternative A: Chakra UI v3

Use Chakra UI's pre-built component library with its theming engine.

Rejected because: (1) Chakra ships its own styling runtime (Emotion) and theming engine, adding bundle weight and a second styling paradigm alongside Tailwind, which we already use for spacing/layout utilities; (2) customising Chakra's components for a non-default visual language (the candidate interview screen) fights the library's opinions; (3) the Carbonteq portal's historical Chakra recommendation predates Tailwind v4's native CSS-variable token support and the shadcn/ui ecosystem maturation — the technical landscape has shifted under the recommendation; (4) shadcn's "copy into your repo" model gives us source ownership of every component, removing the upstream-version-lock concern Chakra would introduce.

### Alternative B: Headless Radix + raw Tailwind (no shadcn templates)

Skip the shadcn copy-paste templates and build every primitive from Radix headless primitives directly.

Rejected because: maximum control but slowest to start. The first week of Phase 8 would be spent reinventing the same `button.tsx`, `dialog.tsx`, `input.tsx`, `select.tsx` patterns shadcn's templates already encode (CVA variant definitions, `cn()` plumbing, Radix prop forwarding). The shadcn templates are not a library — they are starting points that we are free to modify. Adopting them captures the value of the community's accumulated work without the version-lock cost.

### Alternative C: MUI (Material UI)

Use MUI v6 with its theming engine.

Rejected because: (1) heavy runtime bundle (Emotion-based, plus MUI's own component runtime); (2) the Material Design visual language is opinionated and would fight any non-Material brand direction; (3) MUI's `sx` prop and `styled` runtime would coexist awkwardly with Tailwind — picking one styling paradigm is necessary; (4) the primitive/composite split this ADR establishes does not map onto MUI's monolithic component model.

### Alternative D: Panda CSS (in place of Tailwind v4)

Adopt Panda CSS as the styling system instead of Tailwind v4.

Rejected because: (1) Tailwind v4's native CSS-variable tokens (under `@theme inline`) already provide the design-token capability that motivated interest in Panda; (2) Panda's build-time CSS-in-TS recipe model adds a tooling layer that Tailwind v4 does not need; (3) shadcn's templates ship as Tailwind classes — adopting Panda would require rewriting every shadcn template, eliminating the value of adopting them; (4) Panda is the right pick for very large component systems with hundreds of design tokens — we have one app's worth of UI.

### Alternative E: Do nothing (build everything inline with no shared library)

Skip `packages/ui/` entirely; let `apps/web/` define its own components ad-hoc.

Rejected because: (1) `apps/docs/` already exists and the docs site benefits from shared primitives (Button, Card, Code) with consistent visual language; (2) the candidate-interview and recruiter-dashboard screens both use Dialog, Card, Input, Button, Form components — duplicating these in two places would drift visually; (3) primitives are exactly the kind of code that benefits from a single canonical implementation reviewed once and reused everywhere.

## Consequences

**Benefits**

- Full source ownership of every UI primitive. No upstream version lock; we can fix bugs, restyle, or extend any primitive without forking a library.
- Small bundle. No library runtime — Radix primitives are headless (minimal JS, no styling runtime). Tailwind v4's static-extraction step produces only the classes we actually use.
- Accessibility for free. Radix primitives handle keyboard navigation, focus management, and ARIA attributes correctly by default; we do not re-implement them.
- Semantic theming via Tailwind v4 CSS variables. Light/dark mode and any future brand themes flow from `@theme inline` token edits, not from a runtime theme provider.
- Primitive/composite split (`packages/ui/src/primitives/` → `packages/ui/src/composites/`) matches the Carbonteq dev-portal recommendation and gives clear review boundaries: a primitive's diff stays small and reviewable; composites are where business-specific composition happens.

**Trade-offs**

- Each primitive we adopt is a one-time "copy + customise" step. We own its upgrades. When shadcn publishes an upstream change to a primitive, picking it up is a manual diff-and-apply, not a `pnpm update`. This is the price of source ownership.
- CVA variant configs add some boilerplate per primitive (`buttonVariants` object with `variants` and `defaultVariants`). The boilerplate is local and reviewable, but it is more code per primitive than `<MuiButton variant="contained" />`.
- The "no raw color scales" discipline must be enforced. A developer reaching for `bg-blue-500` to "just make this pop" bypasses the design-token system and creates visual inconsistency. The Enforcement block forbids this pattern.

**Risks and mitigations**

- *Risk*: A developer pulls in a second component library (`@chakra-ui/...`, `@mui/...`, `antd`) via a copy-pasted code sample. *Mitigation*: declarative `forbid_pattern` rule in the Enforcement block blocks imports of these libraries across `apps/web/**` and `packages/ui/**` at commit time.
- *Risk*: A developer uses raw Tailwind color scales (`bg-blue-500`, `text-gray-700`) instead of semantic tokens (`bg-primary`, `text-muted-foreground`), causing visual drift between light/dark modes and brand changes. *Mitigation*: declarative `forbid_pattern` rule blocks raw color-scale class names in `.tsx` and `.css` files under `apps/web/**` and `packages/ui/**`.
- *Risk*: A developer adds SCSS, LESS, or CSS Modules ("just for this one component"), fragmenting the styling system. *Mitigation*: declarative `forbid_pattern` rule blocks `.scss`, `.less`, and `.module.css` file paths.
- *Risk*: A developer hand-rolls keyboard handling for a Dialog or Popover instead of using Radix, missing focus-trap or Escape handling. *Mitigation*: `llm_judge: true` flags hand-rolled keyboard handlers in components that should use a Radix primitive.
- *Risk*: A developer hardcodes inline styles (`style={{ color: '#ff0000' }}`) instead of using a Tailwind class. *Mitigation*: `llm_judge: true` flags inline-style colour drift.

## Related Decisions

- **ADR-024 (Standardise on React Hook Form + Zod 4 for Frontend Forms)**: forms are built on shadcn primitives (Input, Label, Button, FormField composites). The two ADRs together define the form-rendering stack.
- **ADR-021 (Adopt Zustand for Frontend Client State)**: complementary in scope — ADR-021 owns state, this ADR owns presentation. Primitives are stateless or use Radix-managed local state; they never import Zustand or services.
- **ADR-022 (Use TanStack Query v5 for Frontend Server State)**: complementary in scope — server data flows in via container hooks (ADR-022) and is rendered by composites built on the primitives this ADR establishes.

## References

- shadcn/ui: https://ui.shadcn.com
- Radix Primitives: https://www.radix-ui.com/primitives
- Tailwind CSS v4: https://tailwindcss.com/docs/v4-beta
- Class Variance Authority (CVA): https://cva.style/docs
- Carbonteq frontend dev portal best practices: https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/
- Existing Tailwind v4 token setup: `apps/web/app/globals.css`
- PostCSS configuration: `apps/web/postcss.config.mjs`
- `cn()` helper: `packages/ui/src/lib/cn.ts`
- Future primitive directory: `packages/ui/src/primitives/`
- Future composite directory: `packages/ui/src/composites/`
- ADR-024 (React Hook Form + Zod for forms): `docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md`

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "from ['\"]@chakra-ui/",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "from ['\"]@chakra-ui/",
      "path_glob": "packages/ui/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "from ['\"]@mui/",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "from ['\"]@mui/",
      "path_glob": "packages/ui/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "from ['\"]antd['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "from ['\"]antd['\"]",
      "path_glob": "packages/ui/**/*.{ts,tsx}",
      "message": "Use shadcn/ui primitives in @repo/ui (ADR-023). Other component libraries are not adopted."
    },
    {
      "pattern": "bg-(red|blue|green|yellow|purple|pink|orange|cyan|teal|indigo|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900|950)\\b",
      "path_glob": "apps/web/**/*.{tsx,css}",
      "message": "Use semantic Tailwind tokens (bg-primary, text-muted-foreground, etc.) instead of raw color scales (ADR-023)."
    },
    {
      "pattern": "bg-(red|blue|green|yellow|purple|pink|orange|cyan|teal|indigo|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900|950)\\b",
      "path_glob": "packages/ui/**/*.{tsx,css}",
      "message": "Use semantic Tailwind tokens (bg-primary, text-muted-foreground, etc.) instead of raw color scales (ADR-023)."
    },
    {
      "pattern": "\\.(scss|less|module\\.css)$",
      "path_glob": "apps/web/**",
      "message": "Tailwind only; SCSS / LESS / CSS Modules are not adopted (ADR-023)."
    },
    {
      "pattern": "\\.(scss|less|module\\.css)$",
      "path_glob": "packages/ui/**",
      "message": "Tailwind only; SCSS / LESS / CSS Modules are not adopted (ADR-023)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
