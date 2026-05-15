# Phase 8 — Recruiter Frontend Progress

## Phase 8 — Recruiter Frontend Complete

This document records the Phase 8 changes for the ai-interviewer-agent monorepo.

Phase 8 goal:

- Build the full recruiter-side web application on top of the Phase 7 backend
- Implement landing → auth (login/signup) → dashboard (interview list + filter) → multi-step new-interview wizard → interview detail (pre-eval: share link; post-eval: report) → profile/sign-out
- Enforce strict layered architecture: routes as Server Components, containers as the first `"use client"` boundary, all `fetch()` in services, server data in TanStack Query, UI state in Zustand, forms in React Hook Form + Zod
- Wire `better-auth` email/password via the Option A proxy pattern (Next.js rewrites `/api/auth/*` → backend)
- Implement the "Quiet Signal" design language from `docs/DESIGN.md` with semantic token discipline (ADR-025)

Plan source: `.claude/plan/phase-8-recruiter-frontend.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-016](../adr/ADR-016-adopt-better-auth-for-recruiter-authentication.md) — better-auth with email/password adapter; Option A proxy wiring
- [ADR-017](../adr/ADR-017-candidate-access-via-hmac-signed-link.md) — HMAC signed link for candidate access (consumed, not modified)
- [ADR-018](../adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — HTTP error mapping by error code
- [ADR-019](../adr/ADR-019-ownership-checks-in-presentation-not-application.md) — 404 over 403/409 for missing resources
- [ADR-021](../adr/ADR-021-adopt-zustand-for-frontend-client-state.md) — Zustand 5 for UI state only
- [ADR-022](../adr/ADR-022-use-tanstack-query-for-frontend-server-state.md) — TanStack Query 5 for server data
- [ADR-023](../adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) — shadcn/Radix/Tailwind v4 component system
- [ADR-024](../adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) — React Hook Form 7 + Zod 4 for forms
- [ADR-025](../adr/ADR-025-design-language-and-visual-system.md) — Quiet Signal token discipline

---

## Summary

Completed:

- **Infrastructure (lib/):** Singleton `QueryClient` with error-kind-aware retry skip (`AUTH`, `NOT_FOUND`, `RESPONSE_VALIDATION` never retry); `QueryProvider` leaf component; `auth-client.ts` with explicit structural type annotation to work around TS2742 from pnpm's non-hoisted `@better-auth/core` subpaths; `auth.ts` server-only session helper using `next/headers` + documented fetch carve-out (cannot import "use client" services from Server Components).

- **Types (`apps/web/src/types/`):** Eight Zod schemas mirroring Phase 7 backend DTOs without importing `@repo/domain` or `@repo/application`: `FileRefSchema` (`z.coerce.date()` for `uploadedAt`), `DocumentSchema`, `InterviewStatusSchema`, `RecommendationSchema`, `InterviewPlanSchema`, `InterviewSchema`, `CandidateLinkSchema`, `ReportSchema`. All exported from a barrel `index.ts`.

- **Services (`apps/web/src/services/`):** `interview.service.ts` with seven functions (`listInterviews`, `getInterview`, `createInterview`, `generatePlan`, `issueCandidateLink`, `evaluateInterview`, `getReport`) backed by a shared `request<T>()` helper. `document.service.ts` with `uploadDocuments` (FormData, no manual Content-Type header) and `extractDocuments`. All functions return `Promise<Result<T, ServiceError>>` after Zod-validating the response body. `errors.ts` defines the `ServiceError` discriminated union (`NETWORK | RESPONSE_VALIDATION | AUTH | NOT_FOUND | SERVER`).

- **Store (`apps/web/src/stores/`):** `useInterviewFilterStore` (Zustand 5) with `statusFilter: InterviewStatus | "ALL"`, `setFilter`, and `reset`. Exposed via hook only; never used directly in components — filtered through the `InterviewListContainer` hook.

- **New primitives (`packages/ui/src/primitives/`):** `Dialog` (Radix `@radix-ui/react-dialog`, nine forwardRef subcomponents: `DialogOverlay`, `DialogContent` with close button, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogTrigger`, `Dialog`); `Textarea` (forwardRef, displayName).

- **New composites (`packages/ui/src/composites/`):** `InterviewStatusBadge` (six statuses → Badge variants, `dot` prop for IN_PROGRESS pulse); `RecommendationBadge` (advance → positive, hold → attention-warning, reject → negative); `FileUploadField` (drag-and-drop drop zone, pure UI, no fetch); `StepperHeader` (accessible `<ol>` with `aria-current="step"`); `TopicScoreRow` (score bar with inline `style={{ width }}` for data-driven widths); `SoftBlockScreen` (CSS-only soft mobile block with `max-[767px]:flex pointer-coarse:flex`, recruiter and candidate copy variants, `role="alert" aria-live="polite"`).

- **App components (`apps/web/src/components/`):** `AppSidebar` (nav rail with active route highlighting via `usePathname`, sign-out via `authClient.signOut()`); `PageHeader` (server-safe props-only heading block); `StatusFilterChips` (pure presentational, receives `statusFilter` and `onChange` props from `InterviewListContainer`); `InterviewListRow` (Link → `/interviews/[id]`, `InterviewStatusBadge`); `EmptyDashboardState`; `ShareLinkPanel` (clipboard copy + re-issue button, candidate link display); `EvaluateButton` (thin client button wrapper with loading state); `ReportViewer` (`RecommendationBadge` + `TopicScoreRow` grid).

- **Containers (`apps/web/src/containers/`):** Six containers, each with the mandatory three-file pattern (`<Feature>Container.tsx` thin shell, `use<Feature>.ts` orchestration hook, `index.ts` barrel):
  - `LoginContainer` — `authClient.signIn.email`, maps `INVALID_EMAIL_OR_PASSWORD` to a non-leaking generic message
  - `SignupContainer` — `authClient.signUp.email`, maps `USER_ALREADY_EXISTS` to neutral copy ("We couldn't create your account. If you already have one, sign in instead.") to prevent account enumeration
  - `InterviewListContainer` — `useQuery(["interviews"])`, client-side status filter + 20-item pagination via `useInterviewFilterStore`, exposes `statusFilter` and `setFilter` in return for prop-passing to `StatusFilterChips`
  - `NewInterviewContainer` — four-step wizard (upload JD → upload CV → instructions → review/launch) with upload, extract, create, and generatePlan mutations sequenced; `NewInterviewForm` type alias exported from `useNewInterview.ts` for type-safe prop threading to `Step3Instructions`
  - `InterviewDetailContainer` — three parallel queries (interview, candidate link with 30min stale time, report); evaluate mutation; conditional rendering based on interview status
  - `ProfileContainer` — `useProfile.ts` hook owns `useSession`, `useRouter`, and `onSignOut`; `ProfileContainer.tsx` is a thin switch on the `ProfileViewModel`

- **Routes (`apps/web/app/`):** `page.tsx` (landing with server-side session check → redirect to `/dashboard`); `(auth)/layout.tsx` (redirects authenticated users); `(auth)/login/page.tsx`, `(auth)/signup/page.tsx`; `(recruiter)/layout.tsx` (auth gate + `AppSidebar` + `SoftBlockScreen`); `(recruiter)/dashboard/page.tsx`, `(recruiter)/interviews/new/page.tsx`, `(recruiter)/interviews/[id]/page.tsx` (awaits `params: Promise<{ id: string }>` per Next.js 16 async params), `(recruiter)/profile/page.tsx`. No page or layout declares `"use client"`.

- **Tests:** 16 test files across `apps/web` (9 files, 121 tests) and `packages/ui` (7 new composite/primitive test files, 303 total). Service tests use `expectOk`/`expectErr` typed assertion helpers. Container hook tests mock at the service module boundary with a fresh `QueryClient` per test.

Explicitly **not** included in this work:

- Candidate-facing routes (`(candidate)/...`) — Phase 9
- WebSocket voice pipeline frontend (`InterviewSessionContainer`) — Phase 9
- Real-time interview conduct UI — Phase 9
- Email verification flows — deferred (ADR-016 decision)
- Toast provider wiring (Sonner) — deferred to Phase 9 when transient feedback is first needed
- E2E Playwright specs — deferred; backend must be running with fixtures

---

## Implementation Notes

**TS2742 workaround for `@better-auth/react`:** pnpm's non-hoisting of `@better-auth/core` subpaths causes TypeScript to infer an unresolvable `import(...)` type for `createAuthClient`'s return. Fixed by providing an explicit structural type annotation on the `authClient` export and casting the raw return value as `any` before assignment. The structural annotation documents the exact surface the frontend consumes (four methods: `signIn.email`, `signUp.email`, `signOut`, `useSession`).

**`fetch()` in `lib/auth.ts`:** Server Components and layouts cannot import `"use client"` service files. The `getServerSession` helper in `lib/auth.ts` uses `fetch()` directly with an inline comment documenting the carve-out. The call proxies through the Next.js rewrite at `/api/auth/*` → `NEXT_PUBLIC_API_URL/api/auth/*`.

**`@variant pointer-coarse` in globals.css:** Tailwind v4 does not include `pointer: coarse` as a built-in variant. Added `@variant pointer-coarse (@media (pointer: coarse));` to `globals.css` so `SoftBlockScreen` can use `pointer-coarse:flex` to detect touch-primary devices without JavaScript.

**`NewInterviewForm` type alias:** The three-generic `UseFormReturn<TFieldValues, TContext, TTransformedValues>` inferred by `useForm<InstructionsFormValues>()` didn't structurally unify with the explicit annotation in `Step3Instructions`'s prop type, requiring an `as any` cast. Resolved by exporting `type NewInterviewForm = ReturnType<typeof useNewInterview>["form"]` from `useNewInterview.ts` and importing just that type in `Step3Instructions.tsx`, eliminating the cast.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types lint test --filter=web --filter=@repo/ui
```

Results:

- `@repo/ui` type-check: **passed**
- `@repo/ui` lint: **passed** (0 warnings)
- `@repo/ui` tests: **303 passed** (16 test files — primitives + composites)
- `web` type-check: **passed**
- `web` lint: **passed** (0 warnings)
- `web` tests: **121 passed** (9 test files — services, store, containers)

---

## Code Review

**Round 1 — REVISION REQUIRED (6 violations):**

1. `apps/web/app/(recruiter)/profile/page.tsx` — missing route file. Created `ProfilePage` server component mounting `ProfileContainer` and `PageHeader`.

2. `apps/web/src/containers/SignupContainer/useSignup.ts:39` — `USER_ALREADY_EXISTS` error mapped to "An account with this email already exists." which leaks account existence. Changed to neutral copy: "We couldn't create your account. If you already have one, sign in instead." Updated `useSignup.test.ts` assertion.

3. `apps/web/src/services/interview.service.test.ts` and `document.service.test.ts` — inline `if (!result.ok) throw new Error("Expected Ok")` throw-to-narrow pattern. Added typed `expectOk<T, E>` and `expectErr<T, E>` assertion functions (`asserts result is ...`) and replaced all instances.

4. `apps/web/src/services/interview.service.test.ts:11` — unused `import { Ok, Err }`. Removed.

5. `apps/web/src/containers/NewInterviewContainer/NewInterviewContainer.tsx:49` — `form as any` cast to thread the hook's form return through to `Step3Instructions`. Fixed by exporting `NewInterviewForm = ReturnType<typeof useNewInterview>["form"]` from `useNewInterview.ts` and using it as the prop type in `Step3Instructions.tsx`.

6. `apps/web/src/lib/auth.ts` — undocumented `fetch()` outside services. Added inline comment explaining the server-only carve-out and why the services layer cannot be used here.

**Round 2 — REVISION REQUIRED (2 violations):**

1. `apps/web/src/containers/ProfileContainer/ProfileContainer.tsx` — orchestration (useSession, useRouter, onSignOut) lived directly in the component, violating the three-file container pattern. Created `useProfile.ts` returning `ProfileViewModel { isPending, user, onSignOut }`. Reduced `ProfileContainer.tsx` to a thin presentational shell. Updated `index.ts` to re-export `useProfile`. Existing component test continues to pass because `@/lib/auth-client` and `next/navigation` are mocked at module scope in `vi.mock`, which intercepts the calls through `useProfile.ts`.

2. `apps/web/src/components/StatusFilterChips.tsx:6-7` — direct `useInterviewFilterStore()` import in a component (Zustand forbidden in components layer). Changed `StatusFilterChips` to a purely presentational component accepting `statusFilter: InterviewStatusFilter` and `onChange: (filter: InterviewStatusFilter) => void` props. Added `setFilter` to `useInterviewList.ts` return. Passed both props from `InterviewListContainer.tsx` at both render branches (loading skeleton and success state).

**Final result: PASS** — 121 web tests, 303 @repo/ui tests, type-check and lint clean across all packages.

---

## Notes

- `AppSidebar.tsx` calls `authClient.signOut()` directly (not via a container hook). The code reviewer noted this as a style concern but not a rule violation (components only explicitly forbid services, TanStack Query, and Zustand — not auth-client). Aligning `AppSidebar` to the same prop-callback pattern as the rest of the shell is a natural follow-up in Phase 9 when the layout layer is revisited for the candidate route group.
- `auth-client.ts` hard-codes `"http://localhost:3002"` as the server-render `baseURL` branch in the TS2742 workaround (corrected during post-merge bring-up — see below). This is a dev-only constant; the deployed frontend will need `NEXT_PUBLIC_API_URL` plumbed through the structural type or a proper environment-conditional fallback before production deployment.
- Phase 9 owns the candidate route group, WebSocket voice pipeline, and `InterviewSessionContainer`. The `(candidate)/...` route group is not scaffolded; no placeholder routes were created.

---

## Post-Merge Bring-Up Fixes

After the initial Phase 8 commit, the recruiter app was brought up against the running backend for the first time. Seven issues surfaced — all integration / runtime concerns invisible to `pnpm check-types` + unit tests, all resolved without architectural changes.

### 1. Backend `.env` was never loaded

Symptom: `Boot failed: BETTER_AUTH_SECRET must be set (>= 32 chars)` despite a valid `.env` file present in `apps/backend/`.

Cause: `tsx watch src/main.ts` does not auto-load `.env`, and nothing in `main.ts` calls `dotenv.config()`.

Fix: `apps/backend/package.json:9` — `dev` script now passes Node 22's built-in flag: `tsx watch --env-file=.env src/main.ts`.

### 2. Missing local-storage configuration

Symptom: After fix #1, `Boot failed: FILE_STORAGE_ROOT is not set`, followed by `FILE_STORAGE_SIGNING_SECRET is not set`.

Cause: `LocalFileStorageService.fromEnv` requires both vars; `.env` lacked them.

Fix: created `local-storage/` directory at the monorepo root and added to `apps/backend/.env`:

```
FILE_STORAGE_ROOT=<repo-root>/local-storage
FILE_STORAGE_SIGNING_SECRET="<freshly generated 32-byte base64>"
```

### 3. `@repo/ui` primitive imports failing in Next.js Server Components

Symptom: First server-rendered page (`apps/web/app/page.tsx`) failed with `Module not found: Can't resolve './button.js'` (and the same message would have followed for every other primitive once each was first imported by an RSC). Containers had been importing these primitives all along without issue because they go through the client compilation pipeline.

Cause: `packages/ui/tsconfig.json` inherited `moduleResolution: NodeNext` from the shared `react-library.json` preset, which requires explicit `.js` extensions on relative imports. Next.js's webpack pipeline, when handed a workspace package via the `exports` map, could not map those `.js` strings back to the `.tsx` source files. The package is consumed only by bundlers (Next + Vitest), never by Node directly.

Fix (three coordinated changes):

- **`packages/ui/tsconfig.json`** — override the inherited resolution:
  ```json
  "module": "ESNext",
  "moduleResolution": "Bundler"
  ```
- **All `packages/ui/src/**/*.{ts,tsx}` files** — strip `.js` extensions from relative imports. Bulk-applied with a perl one-liner; covered ten primitive barrels, eight composite barrels, and `packages/ui/src/index.ts`.
- **`apps/web/next.config.js`** — added `transpilePackages: ["@repo/ui"]` so Next routes the package source through its SWC pipeline rather than treating it as pre-built ESM.

Intermediate dead ends explored before landing on this fix (kept here as a record so future debugging avoids the same paths):
- Converting `export *` barrels to named re-exports — did not change behaviour; the issue was the `.js` extension, not the wildcard form.
- Clearing `.next` cache — symptom looked cache-like ("no exports at all") but persisted across rebuilds.

### 4. Auth redirect loop after login

Symptom: Successful sign-in returned to `/dashboard`, which immediately redirected back to `/login`, which immediately redirected back to `/dashboard`, ad infinitum.

Cause: `apps/web/.env.local` had `NEXT_PUBLIC_API_URL=http://localhost:8080`, but the backend runs on `:3002` (per `BETTER_AUTH_URL` and `main.ts` defaults). Every auth call hit a dead port:
- The Next.js `/api/auth/*` rewrite forwarded to `http://localhost:8080/api/auth/*` → ECONNREFUSED.
- The server-side `getServerSession` in `apps/web/src/lib/auth.ts:22` called `http://localhost:8080/api/auth/get-session` directly → ECONNREFUSED → returned `null`.
- `auth-client.ts:14` had a hard-coded server-side fallback `baseURL: "http://localhost:8080"` (the same constant noted in the original Notes section above).

Result: client believed a stale browser cookie meant "signed in" → `(auth)/layout.tsx` redirected `/login` → `/dashboard`; server session lookup failed → `(recruiter)/layout.tsx` redirected `/dashboard` → `/login`.

Fix:
- `apps/web/.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:3002`.
- `apps/web/src/lib/auth-client.ts:14` — server-side fallback `baseURL` updated to `http://localhost:3002`.

After fix, stale `better-auth.*` cookies on the `localhost` domain must be cleared once via DevTools before sign-in works; subsequent sessions are clean.

### 5. Better Auth rejected the sign-in origin

Symptom: After fix #4, the backend started returning `403` with `ERROR [Better Auth]: Invalid origin: http://localhost:3000` on every `POST /api/auth/sign-in/email`.

Cause: Better Auth's built-in CSRF check rejects requests whose `Origin` header is not in `trustedOrigins` (which defaults to `baseURL` only). Backend `baseURL` is `http://localhost:3002`; frontend origin is `http://localhost:3000`; cross-origin POST → blocked.

Fix: `apps/backend/src/infrastructure/auth/auth.ts` — extended `AuthConfig` with an optional `trustedOrigins?: readonly string[]`, and added a default of `["http://localhost:3000"]` when not supplied. Composition layer can override this from env for prod deployments.

### 6. `SoftBlockScreen` rendered on every desktop page

Symptom: The "Sift's recruiter workspace is desktop-only." overlay text appeared at the top of every recruiter page on a regular non-touch laptop, with the actual dashboard layout visible below it (not "behind" — the overlay was not positioned as a fixed overlay at all).

Root cause: Tailwind v4 auto-source-detection excludes `node_modules` by default. `@repo/ui` is consumed by `apps/web` via a pnpm symlink that lives under `apps/web/node_modules/@repo/ui` — so Tailwind never scanned the composite source files. Classes used **only** inside `@repo/ui` (`hidden`, `fixed`, `inset-0`, `z-[100]`, the arbitrary breakpoint variant) were never emitted into the generated CSS. The component rendered with `display: block` (the browser default) and no positioning, appearing inline at the top of the page.

Confirming signal: classes like `bg-accent`, `rounded-pill`, `size-10` worked in the same component — those happened to also be used in `apps/web/app/page.tsx` and `AppSidebar.tsx`, so Tailwind generated them from the app side. `hidden` was used nowhere in `apps/web`.

Fix: `apps/web/app/globals.css` — added an explicit source directive immediately after the Tailwind import:

```css
@source "../../../packages/ui/src/**/*.{ts,tsx}";
```

Secondary improvements applied during the same investigation:
- `@variant pointer-coarse` redefined from `(@media (pointer: coarse))` to `(@media (hover: none) and (pointer: coarse))` — the original matched too aggressively on hybrid touchscreen laptops.
- `pointer-coarse:flex` removed from `SoftBlockScreen`'s className. The viewport-width check (`max-[767px]:flex`) alone is sufficient; touchscreen laptops with wide viewports are functionally desktop-class devices and should not be blocked. The variant remains defined in `globals.css` so it can be reintroduced for a more aggressive policy without redefining the media query.

Intermediate dead ends:
- Multiple media-query tweaks were tried before checking whether the underlying `hidden` rule was even being emitted. The lesson: when CSS appears to "not work", first verify the class is present in the generated stylesheet, not just in the JSX.

### 7. CORS errors blocking the interview list query

Symptom: `/dashboard` rendered "Connection lost. Try again." instead of the empty interview list. Browser DevTools showed a CORS preflight failure on `GET http://localhost:3002/api/interviews`.

Cause: Backend had no CORS middleware. Auth flows worked because they go through the Next.js `/api/auth/*` rewrite (same-origin from the browser); the interview service in `apps/web/src/services/interview.service.ts:22` calls the backend directly at `${env.NEXT_PUBLIC_API_URL}${path}`.

Fix:
- Installed `@fastify/cors@^11.2.0` in `apps/backend`.
- Registered in `apps/backend/src/app.ts` immediately after `installErrorHandler`:
  ```ts
  await app.register(cors, {
    origin: process.env["CORS_ALLOWED_ORIGINS"]?.split(",").map((s) => s.trim()) ?? [
      "http://localhost:3000",
    ],
    credentials: true,
  });
  ```

`credentials: true` is required so the browser sends the better-auth cookie on cross-origin requests (the `fetch(..., { credentials: "include" })` in the service helper depends on it). `CORS_ALLOWED_ORIGINS` is the prod knob; the dev default mirrors the Better Auth `trustedOrigins` default from fix #5.

---

## Follow-Ups Carried Forward

- `BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` should both be wired through `authEnvFrom` / a dedicated env parser before any non-local deployment, instead of relying on the localhost defaults.
- The `auth-client.ts` hard-coded `:3002` server-render branch (note carried over from the original draft of this doc) should be replaced with a proper env-conditional fallback. A potential approach: parse `NEXT_PUBLIC_API_URL` in `lib/env.ts` and pass it through the structural client type.
- The composite-only Tailwind classes that the `@source` directive now picks up should be considered intentional. If `packages/ui` grows to include classes that are app-specific (which it should not), the source list will need narrowing rather than broadening.
- Add a smoke E2E (`pnpm --filter web exec playwright test`) that hits `/dashboard` against a running backend after sign-up — would have caught fixes #4 / #5 / #7 in CI.
