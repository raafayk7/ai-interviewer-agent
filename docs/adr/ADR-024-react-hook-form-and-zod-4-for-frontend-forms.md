# ADR-024 Standardise on React Hook Form + Zod 4 for Frontend Forms and Wire Validation

## Status

Accepted, 2026-05-13.

## Context

Phase 8 introduces multiple forms in `apps/web/`: recruiter sign-in / sign-up, create-interview, upload JD/CV (multi-file), settings, and inline edits in the dashboard. Each form needs four capabilities: (1) controlled input state with minimal re-renders, (2) client-side validation against a typed schema, (3) submission via TanStack Query mutation (ADR-022), (4) round-tripping of server-side `ValidationError` field messages from the backend (ADR-018) back into the form's field-level error display.

The relevant constraints:

1. **Backend DTO contract is Zod 4.** `packages/application/src/dtos/` defines every request/response DTO as a Zod 4 schema (`BaseDto` wrapper, `BaseDto.validate()` returning `Result<T, ValidationError>`). Sharing the same Zod schema shape between the frontend's form schema and the backend's DTO keeps the wire contract single-sourced — drift between client and server validation is the most common cause of "the form passed locally but the server rejected it" bugs.
2. **Backend `ValidationError` shape.** Per ADR-018, the backend returns 422 with a body containing `issues`: a Zod-style array of `{ path, message }` records. RHF's `setError(fieldName, { type, message })` consumes this shape directly: a server-side validation failure can be projected onto the form's field-level error state with no transformation layer.
3. **Upload JD/CV form** has multi-file input fields plus text fields. Re-rendering the entire form on every keystroke (the controlled-by-default pattern) would force file-input components to re-render unnecessarily during text entry — a class of subtle bug uncontrolled-by-default forms avoid.
4. **Carbonteq frontend dev portal** (https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/) lists "React Hook Forms" as the recommended forms library.
5. **Schema co-location.** Form schemas and wire schemas live together at `apps/web/src/types/`. A Zod schema there is consumed both by `useForm({ resolver: zodResolver(schema) })` and by the services layer's response-parser. The `z.infer<typeof schema>` derivation produces a single TypeScript type for both sides.

## Decision

Use `react-hook-form` with `@hookform/resolvers/zod` for every form in `apps/web/`. Zod 4 schemas in `apps/web/src/types/` define both the form shape and the wire contract for the corresponding services function. The schema is the single source of truth: services validate responses against it via `schema.parse()` / `schema.safeParse()`, and forms validate inputs against it via `zodResolver(schema)`. Form components use `useForm` from `react-hook-form`; raw `<form onSubmit>` with manual `useState`-based field tracking is not used.

## Alternatives Considered

### Alternative A: Formik + Yup

Use Formik for form state and Yup for validation.

Rejected because: (1) Formik is controlled-by-default — every keystroke triggers a re-render across the form tree. For the upload JD/CV form with multi-file inputs, this would force file-input components to re-render during text entry; (2) Yup is a separate schema language we would then have to keep in sync with the backend's Zod 4 DTOs. Two parallel schema systems describing the same wire contract is exactly the drift this ADR is meant to prevent; (3) Formik has had reduced maintenance velocity in 2025; RHF is the more actively-maintained option.

### Alternative B: Conform + Zod

Use Conform's progressive-enhancement model with Zod validation.

Rejected because: (1) Conform's strength is its Server Actions integration in Next.js App Router — forms that work without JavaScript by posting directly to a server action. Our forms run client-side against an HTTP backend (Fastify), not against Next.js Server Actions, so Conform's primary value proposition does not apply; (2) the RHF `register` / `useForm` API is closer to what the team already uses on other projects; (3) Conform's progressive-enhancement model would require a Next.js Server Action layer in front of the Fastify backend, expanding scope.

### Alternative C: TanStack Form

Use the (relatively new) TanStack Form library.

Rejected because: (1) TanStack Form is still maturing; the ecosystem (examples, third-party integrations, Stack Overflow coverage) is thinner than RHF; (2) `zodResolver` is a first-class RHF integration with broad community usage; the equivalent TanStack Form integration is less battle-tested; (3) there is no clear capability win for our scope. We may revisit when TanStack Form's ecosystem catches up.

### Alternative D: Raw HTML forms + manual useState

Skip a forms library entirely; use `<input>` + `useState` per field.

Rejected because: (1) per-field `useState` produces controlled-by-default re-renders (Alternative A's problem); (2) every form would manually wire client-side validation, server-side error round-trip, dirty-tracking, and submit-disabled logic — that is exactly the surface RHF + Zod is designed to abstract; (3) when a server-side `ValidationError` arrives, mapping `issues` to per-field error display would be reimplemented per form. Net effort is strictly higher than adopting RHF.

## Consequences

**Benefits**

- Minimal re-renders. RHF is uncontrolled-by-default — only the field that changes re-renders. Critical for the upload JD/CV form's mixed text-and-file input surface.
- Single source of truth for the wire contract. `z.infer<typeof signInSchema>` produces the TypeScript type used by both the form's `useForm<SignIn>()` and the services function's argument shape. Drift between client and server validation becomes a type error at compile time.
- Trivial server-error round-trip. The backend's 422 `issues` array (ADR-018) maps onto RHF's `setError(field, { type: 'server', message })` with a one-line `forEach`. Server-side `ValidationError` messages appear at the correct field with no custom error-mapper.
- Clean composition with TanStack Query mutations (ADR-022). `handleSubmit((data) => mutate(data))` is the canonical pattern; the form's submission handler is one line.
- Type-inferred form values via `z.infer<typeof schema>` eliminate manual interface duplication between the schema and the form-handler signature.

**Trade-offs**

- RHF's `register` API has a learning curve for engineers new to uncontrolled forms. The mental model ("the form is a DOM-driven uncontrolled tree; RHF tracks values out-of-band") is different from the controlled-by-default `useState` model most React tutorials teach.
- Complex nested array fields require `useFieldArray`. Not a problem for our Phase 8 forms (which are flat) but adds a wrinkle when we eventually need a dynamic-row form.
- The "every form uses `useForm`" discipline must be enforced. A developer reaching for `<form onSubmit>` + `useState` to "just throw together a quick form" bypasses the entire validation+server-error-roundtrip pipeline. The `llm_judge: true` rule catches this.

**Risks and mitigations**

- *Risk*: A competing forms library (Formik, Yup, TanStack Form) creeps in via a copy-pasted code sample. *Mitigation*: declarative `forbid_pattern` rule in the Enforcement block blocks imports of `formik`, `yup`, and `@tanstack/react-form` across `apps/web/**` at commit time.
- *Risk*: A developer bypasses `useForm` and writes a raw `<form onSubmit>` with manual `useState` field tracking, breaking the schema-as-single-source-of-truth invariant. *Mitigation*: `llm_judge: true` flags forms that submit without going through `useForm` or that validate without a `zodResolver`.
- *Risk*: A form's Zod schema diverges from the corresponding backend DTO's Zod schema, causing client-side validation to pass for inputs the server rejects (or vice versa). *Mitigation*: schemas in `apps/web/src/types/` should explicitly reference the backend DTO file in a header comment. A future hardening phase may publish the backend DTO schemas as a shared `@repo/dto` package; this is deferred until the wire-contract surface stabilises.
- *Risk*: Server-side `ValidationError` field paths do not match the form's field names (e.g. backend uses `candidate.email`, form uses `candidateEmail`). *Mitigation*: this is a per-form integration concern caught in code review. The shared schema approach makes the path naming consistent by construction.

## Related Decisions

- **ADR-018 (HTTP Error Mapping by Error Code with Exhaustive Status Table)**: defines the `ValidationError` body shape (`issues` array) that RHF's `setError` consumes. This ADR depends on ADR-018's contract.
- **ADR-022 (Use TanStack Query v5 for Frontend Server State)**: form submissions are wired through `useMutation`. RHF's `handleSubmit((data) => mutate(data))` is the canonical integration pattern.
- **ADR-023 (Adopt shadcn/ui (Radix + Tailwind v4) for the Frontend Component System)**: form fields are rendered using shadcn primitives (Input, Label, Button) and the FormField composite. The two ADRs together define the form-rendering stack.
- **ADR-021 (Adopt Zustand for Frontend Client State)**: form state is owned by RHF, not Zustand. Zustand stores hold UI/ephemeral state only.

## References

- React Hook Form: https://react-hook-form.com
- Zod 4: https://zod.dev
- `@hookform/resolvers/zod`: https://github.com/react-hook-form/resolvers
- Backend DTO contract: `packages/application/src/dtos/`
- Carbonteq frontend dev portal best practices: https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/
- Future frontend schema directory: `apps/web/src/types/`
- ADR-018 (HTTP error mapping): `docs/adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md`
- ADR-022 (TanStack Query for server state): `docs/adr/ADR-022-use-tanstack-query-for-frontend-server-state.md`
- ADR-023 (shadcn/ui component system): `docs/adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md`

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "from ['\"]formik['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use react-hook-form + zod resolver (ADR-024)."
    },
    {
      "pattern": "from ['\"]yup['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use react-hook-form + zod resolver (ADR-024)."
    },
    {
      "pattern": "from ['\"]@tanstack/react-form['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use react-hook-form + zod resolver (ADR-024)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
