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

## Post-Launch Bug Fixes

Six bugs surfaced during hands-on testing of the full recruiter flow immediately after phase 8 stabilised. All are integration / runtime issues invisible to unit tests and type-checks.

### 1. Interview creation rejected — `uploadedAt: expected date, received string`

Symptom: Clicking "Launch interview" on the wizard review step showed `jdFileRef.uploadedAt: Invalid input: expected date, received string; cvFileRef.uploadedAt: Invalid input: expected date, received string`.

Cause: The backend `FileRefSchema` inside `packages/application/src/dtos/create-interview.dto.ts` used `z.date()` (strict). JSON serialisation converts the frontend's `Date` → ISO string; `z.date()` rejects strings. Every other date field in the same DTO (`scheduledAt`) already used `z.coerce.date()`.

Fix: `create-interview.dto.ts` — changed `uploadedAt: z.date()` → `uploadedAt: z.coerce.date()`.

### 2. Source fix had no effect — compiled `dist/` was stale

Symptom: After fix #1 the error persisted.

Cause: `@repo/application`'s `package.json` exports point to `./dist/index.js`, not the TypeScript source. The backend (`tsx watch`) imports the compiled artifact; editing the `.ts` source has no runtime effect until the package is rebuilt.

Fix: ran `pnpm turbo run build --filter=@repo/application` to recompile the package, then restarted the backend. The `dist/dtos/create-interview.dto.js` now contains `z.coerce.date()`.

Lesson: any change to a non-app workspace package (`@repo/domain`, `@repo/application`) requires an explicit rebuild before the backend dev server picks it up.

### 3. Interview detail page — "Couldn't load interview details. Try again."

Symptom: After a successful launch the browser redirected to `/interviews/:id`, which showed the generic error message. Backend logs confirmed a `200` response for `GET /interviews/:id`.

Cause: `InterviewSchema` in `apps/web/src/types/interview.types.ts` declared `recruiterId: z.string().uuid()`. Better Auth generates user IDs as random base-62 strings (e.g. `GrY4IZbOp8NHpbVv5iFHNjdAnpk7aSVi`), not UUIDs — so every valid 200 response failed Zod schema validation on the frontend, producing a `RESPONSE_VALIDATION` service error that surfaced as the generic error message.

Fix: `interview.types.ts` — `recruiterId: z.string().uuid()` → `recruiterId: z.string()`. The `id` field remains `.uuid()` because interview IDs are generated via Node's `randomUUID()`.

### 4. Candidate magic link pointed to the backend port

Symptom: The share link displayed in `ShareLinkPanel` had the form `http://localhost:3002/interviews/:id/session?token=...` instead of `http://localhost:3000/...`.

Cause: `buildRecruiterInterviewDeps` in `recruiter-interview.composition.ts` resolves `publicBaseUrl` as `CANDIDATE_PUBLIC_BASE_URL ?? BETTER_AUTH_URL ?? "http://localhost:3000"`. `BETTER_AUTH_URL` was already set to `http://localhost:3002` (the backend) in `apps/backend/.env`, so the frontend fallback `"http://localhost:3000"` was never reached.

Fix: added `CANDIDATE_PUBLIC_BASE_URL="http://localhost:3000"` to `apps/backend/.env`. Backend restart required to pick up the env change.

### 5. Status badge stretched to fixed column width

Symptom: The `InterviewStatusBadge` in the interview list appeared as a fixed-width pill matching the `140px` grid column rather than shrinking to fit its label text.

Cause: CSS Grid blockifies `inline-flex` on direct grid children, effectively computing it as `flex`. A `flex` container with no explicit width fills its grid track (140px). The badge `<span>` was a direct child of the row's `grid` Link element.

Fix: `InterviewListRow.tsx` — wrapped `<InterviewStatusBadge>` in a `<div>`. The `<div>` becomes the stretching grid item; the badge inside it is an `inline-flex` child of a block container and takes only its natural content width.

### 6. Status filter chips appeared for statuses with no interviews

Symptom: With a single "Scheduled" interview the dashboard showed chips for "In progress", "Report ready", and "Awaiting evaluation". Clicking any of those chips showed the empty state. Only the "All" and "Scheduled" chips were meaningful.

Cause: `StatusFilterChips` rendered a hardcoded list of five chips with no awareness of the actual data.

Fix (three files):
- `useInterviewList.ts` — added `availableStatuses: Set<InterviewStatus>` computed from all loaded interviews via `useMemo`.
- `StatusFilterChips.tsx` — added `availableStatuses: Set<InterviewStatus>` prop; filters the chip list to only show statuses present in the data (the "All" chip is always shown).
- `InterviewListContainer.tsx` — passes `availableStatuses` to both `StatusFilterChips` instances (loading skeleton and success state).

---

## Follow-Ups Carried Forward

- `BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` should both be wired through `authEnvFrom` / a dedicated env parser before any non-local deployment, instead of relying on the localhost defaults.
- The `auth-client.ts` hard-coded `:3002` server-render branch (note carried over from the original draft of this doc) should be replaced with a proper env-conditional fallback. A potential approach: parse `NEXT_PUBLIC_API_URL` in `lib/env.ts` and pass it through the structural client type.
- The composite-only Tailwind classes that the `@source` directive now picks up should be considered intentional. If `packages/ui` grows to include classes that are app-specific (which it should not), the source list will need narrowing rather than broadening.
- Add a smoke E2E (`pnpm --filter web exec playwright test`) that hits `/dashboard` against a running backend after sign-up — would have caught fixes #4 / #5 / #7 in CI.

---

## 2026-05-16 — Env Hardening + Stubbed Playwright Suite

Two of the carried-forward follow-ups were resolved in this session, one was declined as out of scope, and the smoke-E2E item was downgraded to a tier-2 follow-up (with the tier-1 stubbed surface landed).

### Resolved: Origin/CORS env wiring (was follow-up #1)

`BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` now flow through the composition layer in the same `Result<…, Error>` shape as the existing auth env parsing. Both are **required in production** — backend boot fails with a clear `Boot failed: …` if either is absent under `NODE_ENV=production`. In dev they both default to `["http://localhost:3000"]`.

Concrete changes:

- `apps/backend/src/infrastructure/auth/auth-env.ts` — `AuthEnv` gained `trustedOrigins: readonly string[]`. New `parseTrustedOrigins` helper splits the comma-separated list, trims, and rejects an empty/whitespace-only value. Production-vs-dev branching gates the default.
- `apps/backend/src/infrastructure/auth/auth.ts` — `AuthConfig.trustedOrigins` is now **required** (was optional with an inline `["http://localhost:3000"]` fallback inside `createAuth`). The fallback's removal forces all callers to go through the parsed env.
- `apps/backend/src/composition/auth.composition.ts` — destructures `trustedOrigins` from the parsed `AuthEnv` and threads it into `createAuth(...)`.
- `apps/backend/src/infrastructure/cors/cors-env.ts` (new) — same shape as `auth-env.ts`: `corsEnvFrom(env): Result<{ origins: readonly string[] }, Error>`. Mirrors the auth-env production/dev policy.
- `apps/backend/src/infrastructure/cors/cors-env.test.ts` (new) — 5 tests covering defaulting, production-required, single-origin, comma-separated parsing, and whitespace-only rejection.
- `apps/backend/src/app.ts` — replaced the inline `process.env["CORS_ALLOWED_ORIGINS"]?.split(",")…` read at boot with `corsEnvFrom(process.env)`. Failure throws `Boot failed: …` at the composition root, matching the auth-env error path. This is the only `process.env` read in `app.ts` now; everything else is composed in `composition/` files.
- `apps/backend/src/infrastructure/auth/auth-env.test.ts` — added 5 new tests for `trustedOrigins` (default, production-required, single, comma-separated, whitespace-only). Suite total grew from 7 to 12.
- `apps/backend/.env.example` — documents `BETTER_AUTH_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS` with prod-vs-dev semantics.

### Resolved: Hardcoded `:3002` in `auth-client.ts` (was follow-up #2)

`apps/web/src/lib/auth-client.ts` — the server-render `baseURL` branch (`typeof window === "undefined" ? "http://localhost:3002" : window.location.origin`) now reads `env.NEXT_PUBLIC_API_URL` from `lib/env.ts` instead of the hardcoded constant. Removes the deployment trap originally flagged in the "Notes" section of this doc.

### Declined: Composite-only Tailwind class concern (was follow-up #3)

`packages/ui` is consumed by a single app (`apps/web`) and is expected to stay that way for the foreseeable future. The `@source "../../../packages/ui/src/**/*.{ts,tsx}"` directive correctly picks up every class used in composites; no action needed unless a second consumer of `@repo/ui` appears.

### Partially addressed: Playwright E2E (was follow-up #4)

The original plan called for three Playwright specs using `page.route("**/api/auth/**", ...)`. That approach has a fundamental gap: `(recruiter)/layout.tsx` calls `getServerSession()` **server-side**, and the resulting `fetch` runs in the Next.js Node process — `page.route()` cannot intercept it. The three planned specs (auth happy path → dashboard, create-interview wizard, report-viewer) all sit behind that gate.

Chosen scope for this session: **pure-frontend stubbed specs only** — routes that don't sit behind the auth gate. Auth-gated specs are downgraded to a tier-2 follow-up (see below).

Concrete changes:

- `apps/web/playwright.config.ts` (new) — Chromium-only project, `baseURL: http://localhost:3000`, `webServer: pnpm dev` with `reuseExistingServer: !CI`, `retries: 1` and `workers: 1` under `CI`, `trace: "on-first-retry"`, `screenshot: "only-on-failure"`.
- `apps/web/e2e/landing.spec.ts` (new, 3 tests) — `/` renders Sift hero + both CTAs when anonymous; "Sign in" link → `/login`; "Create an account" link → `/signup`.
- `apps/web/e2e/login.spec.ts` (new, 6 tests) — field rendering; bad-email validation; empty-password validation; `INVALID_EMAIL_OR_PASSWORD` (stubbed via `page.route("**/api/auth/sign-in/email", …)`) → "Email or password is incorrect."; any other error code → generic fallback; `/signup` link navigation.
- `apps/web/e2e/signup.spec.ts` (new, 7 tests) — field rendering; bad-email, short-password, password-mismatch validation; `USER_ALREADY_EXISTS` → neutral non-enumerating copy **with an explicit `not.toContainText(/already exists/i)` regression guard against re-introducing the account-enumeration leak**; any other error code → generic fallback; `/login` link navigation.
- `turbo.json` — added `CI` and `NODE_ENV` to `globalEnv`. Required because the Turbo eslint plugin (`turbo/no-undeclared-env-vars`) flagged `process.env["CI"]` reads in `playwright.config.ts`; `NODE_ENV` is now read by `auth-env.ts` and `cors-env.ts`.
- `apps/web/src/containers/InterviewListContainer/useInterviewList.ts` — fixed a pre-existing `react-hooks/exhaustive-deps` warning (the `const all = query.data?.interviews ?? []` line allocated a fresh `[]` on every render when `data` was undefined, causing the two downstream `useMemo`s to re-run unnecessarily). Wrapped `all` in its own `useMemo` keyed on `query.data?.interviews`. Was blocking `eslint --max-warnings 0` for the suite once `playwright.config.ts` invalidated the lint cache.

Run command:

```bash
pnpm --filter web exec playwright install chromium   # one-time, ~113 MB headless shell
pnpm --filter web exec playwright test
```

Result: 16/16 specs pass in ~10s. `pnpm dev` is auto-spawned by `webServer`; if a dev server is already running, Playwright reuses it outside CI.

### Implementation note: `getByRole("alert")` and the Next.js route announcer

Next.js injects `<div role="alert" aria-live="assertive" id="__next-route-announcer__"></div>` at the app root for screen-reader route announcements. A naive `page.getByRole("alert")` matches both that and the form's own error `<p role="alert">`, producing a strict-mode violation. The specs scope the locator with `page.locator("form").getByRole("alert")` to constrain the match to the form subtree.

### Implementation note: `CardTitle` is not a semantic heading

`packages/ui/src/primitives/card/card.tsx` renders `CardTitle` as a `<div>`. On `/login` and `/signup`, the `CardTitle` is acting as the page's H1 but assistive tech sees a generic div. The first-pass specs used `getByRole("heading", { name: "Sign in" })` and failed for this reason. They now use text-based queries on the unique `CardDescription` strings ("Welcome back. Enter your credentials to continue.", "Enter your email to get started with Sift.") to detect page identity.

This is a real a11y gap — flagged as a tier-3 follow-up below.

### Verification

```bash
pnpm turbo run check-types --filter=backend --filter=web --filter=@repo/ui   # passed
pnpm turbo run lint --filter=backend --filter=web --filter=@repo/ui          # passed (web, ui, backend)
pnpm turbo run test --filter=backend                                          # 232/232 (was 215; +12 auth-env, +5 cors-env)
pnpm turbo run test --filter=web                                              # 121/121
pnpm turbo run test --filter=@repo/ui                                         # 303/303
pnpm --filter web exec playwright test                                        # 16/16 in ~10s
```

`@repo/application` still emits two pre-existing lint warnings (`AgentInternalScore`, `AgentNote` unused imports in `evaluate-interview.use-case.test.ts`) from commit `cd320e6`. Unrelated to this session.

### New follow-ups discovered

- **Tier-2 (carried forward):** smoke E2E against a real backend. Needs `apps/web/playwright.config.ts`'s `webServer` array extended with a second entry that boots `apps/backend` against a test database, plus a `.env.e2e` carrying `BETTER_AUTH_SECRET`, `FILE_STORAGE_*`, `CANDIDATE_LINK_SECRET`, and stubbed AI keys. One spec — sign up → land on `/dashboard` empty state — would catch the entire CORS/port/origin bug class (post-merge fixes #4, #5, #7).
- **Tier-3 (a11y):** ~~`CardTitle` should expose a heading role when used as a page title.~~ **Resolved 2026-05-17 — see section below.**
- **Tier-3 (housekeeping):** the two `@repo/application` lint warnings in `evaluate-interview.use-case.test.ts` should be cleaned up — they pre-date this session and have nothing to do with it, but they're blocking `pnpm turbo run lint` from being green at the monorepo level.

---

## 2026-05-17 — Tier-3 a11y follow-up resolved (CardTitle heading role)

Closed before Phase 9 frontend planning starts, since the candidate flow is the most a11y-sensitive surface in the product and shipping new screens against a primitive that disguises page identity from screen readers would be a clear regression.

### Approach

Took option (a) — polymorphic `as` prop on `CardTitle`. Default tag is `<h3>` (card-scope, easy to override upward to `<h1>` or `<h2>` for page-scope use).

Concrete changes:

- `packages/ui/src/primitives/card/card.tsx` — `CardTitle` now accepts `as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div"`, default `h3`. `forwardRef` and `displayName` preserved; existing classes unchanged. The `"div"` option is the escape hatch for non-semantic title use.
- `packages/ui/src/primitives/card/card.test.tsx` — `CardTitle` block rewritten: default-`h3` heading-role assertion, `as="h1"` / `as="h2"` / `as="div"` (negative: not matched by `getByRole("heading")`) tests added. Suite grew from 50 to 54 tests in this file; package total `303 → 306`. A pre-existing false-positive (`expect(...).toHaveClass("font-semibold")` against the old `<div>` selector, where the implementation never set that class) was also removed and replaced with assertions on classes the implementation actually has (`text-lg`, `leading-none`, `tracking-tight`).
- `apps/web/e2e/login.spec.ts:22` — page-identity probe swapped from `page.getByText("Welcome back…")` (targeting `CardDescription`) to `page.getByRole("heading", { name: "Sign in", level: 3 })`. Other queries unchanged — those target form error messages that are correctly `<p>` elements.
- `apps/web/e2e/signup.spec.ts:22` — same migration, `getByRole("heading", { name: "Create an account", level: 3 })`. (Heading text is "Create an account", not "Create account" — minor naming clarification.)

### Verification

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui   # passed
pnpm turbo run lint --filter=web --filter=@repo/ui          # passed
pnpm turbo run test --filter=@repo/ui                       # 306/306 (was 303)
pnpm turbo run test --filter=web                            # 121/121
pnpm --filter web exec playwright test                      # 16/16 in ~10s
```

### Why now, not inside Phase 9

A single-primitive change with cascading benefits — keeping it out of the Phase 9 plan means the plan can simply specify `<CardTitle as="h1">` on the candidate landing screen / `<CardTitle as="h2">` on pre-interview-check step cards without ambiguity, and the recruiter auth pages get the a11y fix for free. The two Playwright E2E specs that worked around the gap now use heading-role queries that more accurately reflect what assistive tech actually sees.
