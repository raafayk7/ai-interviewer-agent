# ADR-021 Adopt Zustand for Frontend Client State (UI State Only)

## Status

Accepted, 2026-05-13.

## Context

Phase 8 introduces the first frontend application in this monorepo (`apps/web/`), built on Next.js App Router + React Server Components. The frontend must manage three distinct categories of state: (1) server data (interview lists, evaluation reports, candidate records) fetched from the Fastify backend; (2) form state (sign-in, create-interview, upload JD/CV); (3) UI / ephemeral state (microphone-on flag during a live interview, WebSocket connection status, modal-open flags, transcript chunks accumulated during a session). Each category has different lifecycle requirements, and conflating them in a single store is the most common source of stale-data bugs in React applications.

ADR-022 (TanStack Query for server state) and ADR-024 (React Hook Form + Zod 4 for forms) own the first two categories. This ADR is responsible for the third: a small, discrete set of UI/ephemeral state slices that need cross-component access but are not server-derived.

The relevant constraints:

1. **State surface is small.** A walkthrough of the two screens being built in Phase 8 (recruiter dashboard, candidate interview) identifies fewer than ten true client-state slices. The bulk of "state" on every screen is server data (governed by ADR-022) or form state (governed by ADR-024). What remains — mic-on flag, WS connection status, modal-open flags, transcript chunks — is genuinely ephemeral UI state.
2. **Next.js App Router compatibility.** Any provider-based state library forces a `"use client"` boundary at the root of the rendered tree. This is workable but adds a coupling between the state library and the rendering model that we prefer to avoid given how often the App Router rendering rules change.
3. **Carbonteq frontend best-practices portal** (https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/) lists React Query and React Hook Form as the recommended stack but is intentionally unopinionated about which client-state library to adopt, leaving the choice to the project.
4. **Industry trend evidence.** Reference: Syncfusion "Top 5 React State Management Tools 2026" identifies Zustand as the dominant pick for small-to-medium client state surfaces, ahead of Redux Toolkit, Jotai, and Recoil for new projects with limited middleware needs.
5. **Architectural boundary.** Server data must not be copied into a Zustand store — that introduces a second source of truth and re-creates the staleness bugs TanStack Query exists to prevent. This boundary needs mechanical enforcement (see Enforcement block).

Stores will live at `apps/web/src/stores/use<X>Store.ts`. The services layer (`apps/web/src/services/`) — which is where HTTP fetches and Zod response parsing live — must not be imported into stores.

## Decision

Use Zustand as the only client-side state-management library in `apps/web/`. Stores live at `apps/web/src/stores/use<X>Store.ts` and hold UI / ephemeral state only (mic-on flag, WebSocket connection status, modal-open flags, transcript chunks during a live session). Server data is not permitted in Zustand — it must live in TanStack Query per ADR-022. Stores must not import the services layer (`apps/web/src/services/`).

## Alternatives Considered

### Alternative A: Redux Toolkit + RTK Query

Adopt Redux Toolkit for client state and RTK Query for server state. RTK is the industry-default state library and has a mature ecosystem.

Rejected because: (1) the boilerplate cost is real — slices, action creators, reducers, and typed selectors per feature multiply quickly even with `createSlice` sugar; (2) the middleware features that justify RTK (logger, persist, time-travel devtools, saga/thunk orchestration of complex client workflows) are unused at our state surface; (3) Redux's `<Provider>` requirement forces a `"use client"` wrapper at the root of the App Router tree, which entangles state-management choice with the RSC rendering model; (4) bundling RTK Query would compete with the ADR-022 choice of TanStack Query without offering a meaningful capability gain.

### Alternative B: Jotai

Adopt Jotai's atom-graph model: each piece of state is an `atom`, and derived state is composed by reading other atoms.

Rejected because: (1) the atom-graph mental model is overkill for the discrete, mostly-independent state slices we need (mic flag, WS status, modal flags do not derive from each other); (2) team familiarity with hook-style stores (`useStore((s) => s.x)`) is higher than with the atom primitive; (3) Jotai's strength — fine-grained derived-state graphs — pays off in computation-heavy UIs (3D editors, spreadsheets), which we do not have.

### Alternative C: React Context only

Use only built-in React Context with `useReducer` for any cross-component state.

Rejected because: (1) re-render fan-out — every consumer of a Context re-renders when any property in the value object changes, regardless of which property they read. During a live WebSocket session with frequently-updating transcript chunks, this would force every consumer to re-render on every transcript token; (2) avoiding this requires manual memoization plumbing (`useMemo`, splitting Context per slice, custom selector hooks), which reinvents Zustand badly; (3) no devtools.

### Alternative D: Do nothing (no client-state library; lift everything to component state)

Keep all state in component-local `useState` and lift state up to a common parent when needed.

Rejected because: (1) the mic-on flag and WS connection status must be readable from multiple non-sibling components (the top navbar shows connection status; the interview panel shows mic indicator; a settings drawer toggles them) — lifting to a common ancestor would push state to the root of the page, defeating the purpose of components; (2) the transcript-chunks slice during a live session is genuinely a shared store, not component state; (3) prop-drilling through five layers of components is the worst maintenance outcome.

## Consequences

**Benefits**

- Zero-provider setup. Stores are plain modules; any client component imports the hook directly. No App Router rendering-mode entanglement.
- Tiny runtime. Zustand's published bundle is roughly 1 KB minified+gzipped — negligible against the rest of the frontend bundle.
- Per-feature slice files. Each store lives at `apps/web/src/stores/use<Name>Store.ts`, so the state surface is auditable from one directory.
- Easy testing. `store.setState(initialState)` resets a store between Vitest tests without needing a custom test harness.
- Works cleanly with RSC client boundaries. The store hook is just a hook; calling it from a `"use client"` component is the only requirement.

**Trade-offs**

- No built-in middleware ecosystem analogous to Redux's. Logger / persist / devtools are available as plugins if and when needed. We do not adopt them in Phase 8.
- The "no server data in stores" invariant is not type-enforceable; it requires both review discipline and the Enforcement block below. A reviewer must explicitly check that any new store does not import from `apps/web/src/services/`.
- Devtools support is via the optional `zustand/middleware/devtools` plugin, which we do not enable by default. If state debugging becomes a pain point, the plugin is one-line additive.

**Risks and mitigations**

- *Risk*: A developer imports a service function inside a store to "cache the result", silently re-creating the staleness bug TanStack Query is meant to prevent. *Mitigation*: the Enforcement block's `forbid_pattern` rule forbids `@/services/` imports inside `apps/web/src/stores/**`. `llm_judge: true` also catches subtler "server data in store" violations a regex cannot see (e.g. passing a fetched object into `setState`).
- *Risk*: A second state library creeps in via a copy-pasted code sample (Redux, Jotai, Recoil, Valtio). *Mitigation*: declarative `forbid_pattern` in the Enforcement block blocks imports of `redux`, `@reduxjs/toolkit`, `jotai`, `recoil`, and `valtio` across `apps/web/**` and `packages/ui/**` at commit time.
- *Risk*: Selector functions are not memoized, causing unnecessary re-renders. *Mitigation*: Zustand's `useStore((s) => s.fieldA)` selector model is already shallow-compared by default; only object-returning selectors need `shallow` from `zustand/shallow`. This is a per-consumer concern caught in code review.

## Related Decisions

- **ADR-022 (Use TanStack Query v5 for Frontend Server State)**: the complementary half of the state-management split. Server data lives in TanStack Query; UI/ephemeral state lives in Zustand. The "no service imports in stores" rule in this ADR enforces the boundary.
- **ADR-024 (Standardise on React Hook Form + Zod 4 for Frontend Forms)**: form state is owned by React Hook Form, not Zustand. Together, ADR-021/022/024 partition the entire frontend state surface into three non-overlapping libraries.

## References

- Carbonteq frontend dev portal best practices: https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/
- Syncfusion "Top 5 React State Management Tools 2026" (industry trend evidence)
- Zustand: https://github.com/pmndrs/zustand
- Zustand bundle size: https://bundlephobia.com/package/zustand
- Future store directory: `apps/web/src/stores/`
- ADR-022 (TanStack Query for server state): `docs/adr/ADR-022-use-tanstack-query-for-frontend-server-state.md`
- ADR-024 (React Hook Form + Zod for forms): `docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md`

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "^import .* from ['\"](redux|@reduxjs/toolkit|jotai|recoil|valtio)['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Use Zustand (ADR-021). Redux/Jotai/Recoil/Valtio are not the chosen state library."
    },
    {
      "pattern": "^import .* from ['\"](redux|@reduxjs/toolkit|jotai|recoil|valtio)['\"]",
      "path_glob": "packages/ui/**/*.{ts,tsx}",
      "message": "Use Zustand (ADR-021). Redux/Jotai/Recoil/Valtio are not the chosen state library."
    },
    {
      "pattern": "from ['\"]@/services/",
      "path_glob": "apps/web/src/stores/**/*.ts",
      "message": "Zustand stores hold UI state only. Services must not be imported into stores (ADR-021 / ADR-022)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
