# ADR-022 Use TanStack Query v5 for Frontend Server State

## Status

Accepted, 2026-05-13.

## Context

Phase 8 introduces the first frontend application (`apps/web/`) which talks to the Fastify backend over HTTP for almost every interaction: list interviews, fetch interview detail, fetch evaluation report, create interview, upload JD/CV, sign in / sign out, fetch session info. Every one of these is server data: data that lives on the backend, has a non-trivial lifecycle (loading, error, stale, refetching after mutation), and must be reconciled with the local view when it changes.

The naïve approach — `useState` + `useEffect` for each fetch — produces a predictable set of bugs in every React codebase that takes it: missing cleanup on unmount, double-fetches in React Strict Mode dev, stale data after mutations, no request deduplication across components, no shared cache between adjacent screens, no loading/error states without manual plumbing, no devtools to inspect what is cached. Each of these is well-understood and well-solved by mature server-state libraries.

The relevant constraints:

1. **Carbonteq frontend best-practices portal** (https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/) explicitly lists "React Query" as the recommended HTTP / data-fetching layer. This is project-level guidance from the engineering organisation.
2. **Backend HTTP contract** is governed by ADR-018 (HTTP error mapping). The backend returns `ValidationError` with a typed `issues` field, `NotFoundError` as 404, `ConflictError` as 409, etc. The frontend services layer parses these against Zod schemas (see ADR-024) and exposes typed `Result<T, ServiceError>` shapes. TanStack Query's `queryFn` and `mutationFn` slot into this services layer one-to-one.
3. **Recruiter dashboard navigation pattern** is list → detail → back-to-list. Without a shared cache, every back-navigation re-fetches. TanStack Query's default 5-minute `staleTime` (we will tune per query) makes the back-navigation instant.
4. **Create-interview mutation** must optimistically update the interview-list query cache. TanStack Query's `useMutation` + `queryClient.invalidateQueries` is the canonical pattern for this.
5. **Candidate signed-link page** has a shorter-lived state surface (one session). `gcTime` on those queries should be lower than the dashboard default to avoid keeping stale data after the interview ends.
6. **Architectural boundary.** Server data must not be copied into Zustand (ADR-021) or into React local state. TanStack Query is the single source of truth for server data. `useQuery` / `useMutation` calls live in containers' co-located hooks (`apps/web/src/containers/<Feature>Container/use<Feature>.ts`) and call functions from `apps/web/src/services/`. Direct `fetch()` calls outside the services layer are forbidden.

## Decision

Use TanStack Query v5 (`@tanstack/react-query`) as the only mechanism for fetching, caching, and synchronising server data on the frontend. All `useQuery` and `useMutation` calls live in containers' co-located hooks at `apps/web/src/containers/<Feature>Container/use<Feature>.ts` and invoke typed functions from `apps/web/src/services/`. Server data is never copied into Zustand or into React local state. A single `QueryClientProvider` is mounted at the root client boundary.

## Alternatives Considered

### Alternative A: SWR

Adopt Vercel's SWR (`swr`) for server state. SWR is a smaller-footprint server-state library with a similar `useSWR(key, fetcher)` ergonomic.

Rejected because: (1) SWR's mutation cache management is weaker than TanStack Query's — `useSWRMutation` does not have the same first-class optimistic-update primitives, and cross-query invalidation requires more manual `mutate(key)` calls; (2) the devtools situation is weaker — TanStack Query's `@tanstack/react-query-devtools` is a mature in-app panel showing every cache entry, fetch status, and stale state, which is the primary debugging surface for "why didn't the screen update after I created the interview"; (3) the optimistic-update primitives matter specifically for the create-interview flow (ADR-024 + this ADR), and the create-interview UX requires the list to update before the network round-trip completes.

### Alternative B: Manual `useState` + `useEffect`

Hand-roll fetching with `useState` + `useEffect` per consumer.

Rejected because: (1) every consumer reimplements caching, request deduplication, retry, cleanup-on-unmount, and refetch — that is exactly the surface area that produces the well-known set of fetching bugs; (2) no shared cache between adjacent screens means every back-navigation re-fetches; (3) no devtools means debugging stale-data issues becomes archaeology in component logs; (4) the per-feature bug surface scales linearly with the number of screens.

### Alternative C: RTK Query (bundled with Redux Toolkit)

Use RTK Query for server state.

Rejected because: ADR-021 rejected Redux Toolkit for client state. Adopting RTK Query alone would mean either (a) pulling the entire RTK runtime into the bundle just for the Query slice, which contradicts ADR-021's reasoning; or (b) running two state-management runtimes side-by-side, which is a maintenance footgun. RTK Query is the right pick when you have already committed to Redux; we have not.

### Alternative D: Do nothing (defer server-state library to Phase 9)

Build Phase 8 with `useState` + `useEffect` and add a library later.

Rejected because: (1) retrofitting a server-state library after multiple screens have hand-rolled fetching is more work than adopting one now — every screen would need a rewrite of its data-fetching layer; (2) the cache and devtools benefits compound from the first screen, so deferring loses value immediately; (3) the bugs hand-rolled fetching produces (stale data after mutations, double-fetches in Strict Mode, missing cleanup) would have to be debugged once per screen and then fixed again during the library migration. Net effort is strictly higher.

## Consequences

**Benefits**

- Built-in cache, request deduplication, retry, and background refetch. Every consumer of `useQuery(['interviews'])` shares one in-flight request and one cache entry.
- First-class mutation API with `onSuccess` / `onError` hooks for cache invalidation. `queryClient.invalidateQueries(['interviews'])` after `createInterview` makes the list re-fetch automatically.
- `@tanstack/react-query-devtools` provides an in-app panel showing every cache entry and its state. This is the primary debugging surface for server-state issues.
- TypeScript inference flows end-to-end: a typed `queryFn` produces a typed `data` field on the consumer. Combined with Zod parsing in the services layer (ADR-024), the wire contract is single-sourced.
- Suspense integration is available if we adopt React's Suspense pattern later — non-breaking, opt-in.

**Trade-offs**

- Requires a `<QueryClientProvider>` at the root client boundary. This is one provider, not a tree, and is the standard pattern.
- `staleTime` / `gcTime` must be tuned per query. The library default (`staleTime: 0`, `gcTime: 5 min`) is conservative; the recruiter dashboard list queries will be set to `staleTime: 30s` or higher to make back-navigation instant. The candidate signed-link page will use lower `gcTime` (e.g. 1 minute) because the session is short-lived.
- Adds a runtime dependency (`@tanstack/react-query` + `@tanstack/react-query-devtools` in dev). Bundle cost is roughly 13 KB minified+gzipped — acceptable against the benefit.

**Risks and mitigations**

- *Risk*: A developer calls `fetch()` directly in a component, bypassing the services layer and TanStack Query. *Mitigation*: the Enforcement block's `forbid_pattern` rule blocks `fetch(` inside `apps/web/app/**`, `apps/web/src/components/**`, `apps/web/src/stores/**`, `apps/web/src/containers/**`, and `apps/web/src/hooks/**`. The services layer is the only place `fetch` is permitted.
- *Risk*: A developer pushes server data into Zustand to "share it across components", silently creating a second cache that drifts. *Mitigation*: the cross-ADR rule from ADR-021 forbids `@/services/` imports inside stores; `llm_judge: true` catches subtler "server data passed into setState" violations.
- *Risk*: A competing server-state library (SWR, RTK Query) creeps in via a copy-pasted code sample. *Mitigation*: declarative `forbid_pattern` blocks imports of `swr` and `@reduxjs/toolkit/query` across `apps/web/**` at commit time.
- *Risk*: Cache invalidation is forgotten after a mutation, leaving the UI showing stale data. *Mitigation*: `useMutation` callsites are co-located in container hooks (`apps/web/src/containers/<Feature>/use<Feature>.ts`) so the invalidation surface is small and reviewable. Frontend code review checks every `useMutation` has a corresponding `invalidateQueries` or `setQueryData` call.

## Related Decisions

- **ADR-021 (Adopt Zustand for Frontend Client State)**: the complementary half of the state-management split. Server data lives in TanStack Query (this ADR); UI/ephemeral state lives in Zustand (ADR-021). The "no service imports in stores" rule enforces the boundary.
- **ADR-024 (Standardise on React Hook Form + Zod 4 for Frontend Forms)**: form submissions are wired through `useMutation`. The form's submission handler calls a typed services function that already validates the response against the same Zod schema the form uses for inputs.
- **ADR-018 (HTTP Error Mapping by Error Code with Exhaustive Status Table)**: TanStack Query's `error` field carries the parsed `ServiceError` from the services layer. The backend's 4xx/5xx contract from ADR-018 maps cleanly onto `useQuery({ error })` and `useMutation({ onError })` consumers.

## References

- TanStack Query v5: https://tanstack.com/query/v5
- TanStack Query devtools: https://tanstack.com/query/v5/docs/framework/react/devtools
- Carbonteq frontend dev portal best practices: https://dev-portal-fuma.vercel.app/docs/best-practices/frontend/
- Future services directory: `apps/web/src/services/`
- Future containers directory: `apps/web/src/containers/<Feature>Container/use<Feature>.ts`
- ADR-021 (Zustand for client state): `docs/adr/ADR-021-adopt-zustand-for-frontend-client-state.md`
- ADR-024 (React Hook Form + Zod for forms): `docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md`
- ADR-018 (HTTP error mapping): `docs/adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md`

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "from ['\"](swr|@reduxjs/toolkit/query)['\"]",
      "path_glob": "apps/web/**/*.{ts,tsx}",
      "message": "Server state belongs in TanStack Query (ADR-022)."
    },
    {
      "pattern": "\\bfetch\\s*\\(",
      "path_glob": "apps/web/app/**/*.{ts,tsx}",
      "message": "Direct fetch() outside the services layer is forbidden. Wrap in a service function and call via TanStack Query (ADR-022)."
    },
    {
      "pattern": "\\bfetch\\s*\\(",
      "path_glob": "apps/web/src/components/**/*.{ts,tsx}",
      "message": "Direct fetch() outside the services layer is forbidden. Wrap in a service function and call via TanStack Query (ADR-022)."
    },
    {
      "pattern": "\\bfetch\\s*\\(",
      "path_glob": "apps/web/src/stores/**/*.{ts,tsx}",
      "message": "Direct fetch() outside the services layer is forbidden. Wrap in a service function and call via TanStack Query (ADR-022)."
    },
    {
      "pattern": "\\bfetch\\s*\\(",
      "path_glob": "apps/web/src/containers/**/*.{ts,tsx}",
      "message": "Direct fetch() outside the services layer is forbidden. Wrap in a service function and call via TanStack Query (ADR-022)."
    },
    {
      "pattern": "\\bfetch\\s*\\(",
      "path_glob": "apps/web/src/hooks/**/*.{ts,tsx}",
      "message": "Direct fetch() outside the services layer is forbidden. Wrap in a service function and call via TanStack Query (ADR-022)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
