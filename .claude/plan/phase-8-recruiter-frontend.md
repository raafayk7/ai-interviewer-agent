# Plan: Phase 8 — Recruiter Frontend

> Generated: 2026-05-15
> Slug: phase-8-recruiter-frontend
> Source-of-truth docs: `docs/DESIGN.md` (visual binding), `docs/ARCHITECTURE.md`, `docs/progress/phase-7.md`, `docs/design-refs/recruiter-dashboard.html`, `CLAUDE.md`
> Relevant ADRs: 015 (rubric), 016 (better-auth), 017 (HMAC link), 018 (HTTP errors), 019 (404 over 403), 021 (Zustand), 022 (TanStack Query), 023 (shadcn/Radix/Tailwind), 024 (RHF + Zod), 025 (token discipline)

---

## Summary

Phase 8 builds the recruiter-side web app on top of the Phase 7 backend: landing → auth → dashboard → multi-step new-interview wizard → interview details (pre-eval status + share link, OR post-eval report) → profile/sign-out. Strict layered build: infrastructure (env, providers, types) → auth feature (forces the better-auth wiring decision) → dashboard → wizard → detail → profile → landing → soft-block → tests → final review. Every route is a Server Component; the `"use client"` boundary lives inside containers (and the `QueryProvider` leaf). Every `fetch` lives in `apps/web/src/services/`; every server-data hook in containers; every Zustand store in `src/stores/`. No candidate routes are touched (Phase 9 owns `(candidate)/...`).

## Route group

`(recruiter)` — primary feature surface (auth-gated)
`(auth)` — login + signup, no session required
shared root — landing page at `/`

## Layers touched

| Layer            | Path                                  | Scope                                                             |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Routes           | `apps/web/app/(recruiter)/...`, `apps/web/app/(auth)/...`, `apps/web/app/page.tsx` | All recruiter pages, login/signup, landing |
| Containers       | `apps/web/src/containers/<Feature>/`  | Login, Signup, InterviewList, NewInterview (wizard), InterviewDetail, Profile, Landing (only if any client logic) |
| Components       | `apps/web/src/components/`            | App-shell (sidebar/topbar), filter chip row, app-specific rows |
| Services         | `apps/web/src/services/`              | `interview.service.ts`, `document.service.ts`, `auth.service.ts` (thin) |
| Stores           | `apps/web/src/stores/`                | `useInterviewFilterStore`                                          |
| Types            | `apps/web/src/types/`                 | All wire schemas mirroring Phase 7 backend DTOs                    |
| Lib              | `apps/web/src/lib/`                   | `query-client.ts` + `QueryProvider`, `auth-client.ts`, `auth.ts` (server, deferred), `clipboard.ts` (small helper) |
| UI primitives    | `packages/ui/src/primitives/`         | `Dialog`, `Textarea` (build); skip `Select`, `Tabs`, `Progress` (composite-only stepper) |
| UI composites    | `packages/ui/src/composites/`         | `InterviewStatusBadge`, `RecommendationBadge`, `FileUploadField`, `StepperHeader`, `TopicScoreRow`, `Toaster` (lazy on first toast use), `SoftBlockScreen` |
| App composites   | `apps/web/src/components/`            | `AppSidebar`, `PageHeader`, `InterviewListRow`, `StatusFilterChips`, `EmptyDashboardState`, `ShareLinkPanel`, `ReportViewer`, `EvaluateButton` |

---

## Architectural invariants — restated for this plan

1. **`apps/web/app/**/page.tsx` and `**/layout.tsx` MUST NOT declare `"use client"`** (CLAUDE.md). Every interactive surface lives behind a container.
2. **`fetch()` is forbidden outside `apps/web/src/services/`.**
3. **`useQuery` / `useMutation` are forbidden outside `apps/web/src/containers/`.**
4. **`create(...)` (Zustand) is forbidden outside `apps/web/src/stores/`.**
5. **`@repo/ui/*` MUST NOT import from `apps/web/*`** — no services, no stores, no auth client.
6. **No `@repo/domain` / `@repo/application` / `apps/backend/*` imports anywhere in the frontend.** Wire types are mirrored as Zod schemas in `apps/web/src/types/`.
7. **Semantic tokens only** (`bg-primary`, `text-positive`, `rounded-pill`). Raw color scales / hex literals are forbidden by ADR-025.
8. **Service contract:** every service function returns `Promise<Result<T, ServiceError>>`. Containers convert via `if (!result.ok) throw result.error` inside `queryFn`/`mutationFn` so the typed error union flows into `onError`.
9. **Three-file container pattern** (mandatory): `<Feature>Container.tsx` + `use<Feature>.ts` + `index.ts`. The hook is the unit tested in isolation; the component is a thin switch over its view-model.
10. **HTTP error mapping:** map by `error.code` from Phase 7's exhaustive `STATUS_BY_CODE` table — never expose raw HTTP strings to UI.

---

## Open decisions surfaced to the user (DO NOT silently pick during implementation)

| # | Decision | Default if unanswered | Trade-off |
|---|----------|----------------------|-----------|
| D1 | `auth.ts` wiring: **proxy** (Next.js rewrites `/api/auth/*` to backend) **vs shared-DB** (frontend instantiates better-auth against the same Postgres + secret) | **Proxy** — simpler, single source of session truth, no DB credentials in the frontend deployment surface, no schema-drift risk | Proxy adds one network hop per session check on the server (cheap inside a single VPC; noticeable across regions). Shared-DB is faster for `getSession` server-side but doubles the deployment surface that needs DB creds, the better-auth secret, and the auth schema. **Defer until Phase 1 of this plan (the login container is the first concrete consumer).** |
| D2 | New-interview wizard data lifecycle: **container-local** `useState` **vs Zustand store** (`useNewInterviewWizardStore`) | **Container-local** — the wizard is a single short-lived modal session; persistence across modal closures is not a stated requirement | Store buys cross-component sharing and devtools at the cost of one more file and a "remember to reset on close" footgun. RHF already handles step-3 form state; wizard cursor + uploaded refs are simple enough for `useState`. |
| D3 | `generatePlan` trigger: **auto-after-create** **vs explicit "Launch interview" button on step 4** | **Explicit** — recruiters get a final review screen with extracted JD/CV summary + duration knobs + "Launch interview" button that triggers `generatePlan`. Aligns with the "composed instrument" brand and gives the recruiter one final pause before the candidate link is issued | Auto-after-create is one fewer click but removes the recruiter's last chance to abort. The plan-generation step also takes a few seconds (LLM call) — surfacing it as an explicit action lets us show a clean loading state. |
| D4 | Logged-in users hitting `/`: **redirect to `/dashboard`** **vs render landing as-is** | **Redirect** — server-side `redirect()` in `app/page.tsx` if `getSession` returns a session. Landing is for unauthenticated visitors; sending a logged-in recruiter back to a marketing page is friction | Slight downside: makes "log out and look at landing" require explicit logout. Acceptable. |
| D5 | `SoftBlockScreen` detection scope: **inside `(recruiter)/layout.tsx` only** **vs in root `layout.tsx`** | **Inside `(recruiter)/layout.tsx`** — Phase 9 will own candidate-side gating with different copy; landing/auth pages are simple enough to render at narrow widths | The CSS-only detection (`@media (max-width: 767px), (pointer: coarse)`) means we toggle visibility via CSS, not JS, so there is no hydration cost — but we still want to keep auth/landing reachable from a phone (e.g., a recruiter checking their email link). |
| D6 | Profile/sign-out placement: **rail only**, **dedicated `/profile` page only**, **or both** | **Both** — the rail shows avatar + display name + a small "..." button that opens a popover with "Profile settings" + "Sign out". The dedicated `/profile` page exists for the same actions plus future expansion (preferred timezone, notifications). For Phase 8 the page contains: display name (editable? — see below), email (read-only), and a destructive Sign-out button | Rail-only forces every settings interaction into a popover, which doesn't scale. Page-only loses the always-visible sign-out the reference HTML shows. **Note:** since better-auth's email/password adapter does not expose a `displayName` field by default, "display name" in Phase 8 is **the email's local-part as a read-only label**; the future column lives in a separate ADR. |

---

## Pre-flight setup (must run BEFORE any code is written)

```bash
# 1. NEXT_PUBLIC_API_URL must be set or apps/web/src/lib/env.ts throws on first import.
#    The dev backend runs on :8080 by Phase 7 default; adjust if your setup differs.
echo 'NEXT_PUBLIC_API_URL=http://localhost:8080' >> apps/web/.env.local

# 2. Playwright browsers — one-time install before any E2E spec is added.
pnpm --filter web exec playwright install chromium

# 3. Confirm backend is running on the URL above and the four better-auth tables exist
#    (see docs/progress/phase-7.md "Notes" section).
```

**If `NEXT_PUBLIC_API_URL` is missing, `apps/web/src/lib/env.ts` will throw on the very first import.** Do not skip step 1.

---

## Phase 0 — Pre-flight & Infrastructure (no feature code)

### Phase-skill chain
1. (no layer skill — these are all module-level scaffolding files)
2. End with `/frontend-arch-validator infrastructure`

### Step 0.1 — TanStack Query client + provider

**File:** `apps/web/src/lib/query-client.ts` (CREATE)
**Render type:** Module
**What:** Singleton-per-tab `QueryClient` factory + browser-only memoized accessor.

```typescript
import { QueryClient } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't retry auth/4xx — they're not transient.
          const code = (error as { kind?: string } | null)?.kind;
          if (code === "AUTH" || code === "NOT_FOUND" || code === "RESPONSE_VALIDATION") {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server: always make a new one to avoid cross-request leaks.
    return makeQueryClient();
  }
  browserClient ??= makeQueryClient();
  return browserClient;
}
```

**Invariant check:** Module file, no React components, no `fetch`. Lives in `lib/` per CLAUDE.md.

### Step 0.2 — Query provider (the only client leaf outside containers)

**File:** `apps/web/src/lib/QueryProvider.tsx` (CREATE)
**Render type:** Client Component (one of the two allowed `"use client"` declarations outside containers, the other being individual containers themselves)
**What:** Wraps children in `QueryClientProvider` + devtools.

```typescript
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { getQueryClient } from "./query-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

**Invariant check:** This is the ONLY `"use client"` file in `lib/`. Mounted from the root `layout.tsx` (Server Component) wrapping `{children}`.

### Step 0.3 — Wire QueryProvider in root layout (modify existing)

**File:** `apps/web/app/layout.tsx` (MODIFY)
**Render type:** Server Component
**What:** Wrap `<body>` children in `<QueryProvider>`.

```typescript
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/QueryProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = { title: "Sift", description: "AI-powered voice screening interviewer" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@500,600,700&display=swap" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

**Invariant check:** `layout.tsx` stays a Server Component. The single `"use client"` boundary is inside `QueryProvider.tsx`.

### Step 0.4 — Better-auth React client (browser)

**File:** `apps/web/src/lib/auth-client.ts` (CREATE)
**Render type:** Module (used inside containers — never imported by route files directly)
**What:** Browser-side better-auth client used by Login/Signup/Profile containers.

```typescript
import { createAuthClient } from "better-auth/react";
import { env } from "./env";

// baseURL points at whichever surface mounts /api/auth/*. With the proxy
// wiring (D1 default), this is the Next.js origin itself. With shared-DB
// wiring, point this at a route handler under /api/auth that calls the
// frontend's auth instance.
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined"
    ? env.NEXT_PUBLIC_API_URL
    : window.location.origin,
});

export const { useSession, signIn, signUp, signOut } = authClient;
```

**Invariant check:** No `fetch` — better-auth wraps that internally. No imports from services or stores.

### Step 0.5 — Server-side auth instance placeholder (deferred wiring per D1)

**File:** `apps/web/src/lib/auth.ts` (CREATE)
**Render type:** Module (server-only — used in `(recruiter)/layout.tsx` for `await auth.api.getSession({ headers: await headers() })`)
**What:** Stub that exposes the `getSession` shape needed by route layouts. The actual implementation is decided in Phase 1 once the login flow forces the choice.

```typescript
// SERVER ONLY — never import from client components.
//
// D1 (open): two viable wirings for this module.
//
// Option A — Proxy:
//   Add Next.js rewrites /api/auth/:path* → ${NEXT_PUBLIC_API_URL}/api/auth/:path*
//   This file's getSession() forwards the inbound cookie to the backend's
//   /api/auth/get-session endpoint and returns the response.
//
// Option B — Shared-DB:
//   This file calls createAuth({ secret, baseUrl, db }) the same way the
//   backend does, against the same Postgres + BETTER_AUTH_SECRET, and uses
//   auth.api.getSession({ headers }) directly. Requires DATABASE_URL and
//   BETTER_AUTH_SECRET in apps/web/.env.local and adds frontend dependencies
//   on `better-auth/adapters/drizzle` and `drizzle-orm`.
//
// For Phase 0 we expose the contract the route layouts will call. The
// implementation is filled in during Phase 1 (login feature) once we pick.

import { headers } from "next/headers";

export interface ServerSession {
  readonly userId: string;
  readonly email: string;
}

export const auth = {
  api: {
    async getSession(_opts: { headers: Headers }): Promise<{ user: ServerSession } | null> {
      throw new Error(
        "auth.api.getSession not yet wired — see D1 in .claude/plan/phase-8-recruiter-frontend.md",
      );
    },
  },
};

// Convenience for route layouts.
export async function getServerSession(): Promise<ServerSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}
```

**Invariant check:** Module file. The throwing stub is intentional — it forces the wiring decision in Phase 1 instead of silently returning `null`. Server-only — no `"use client"`.

### Step 0.6 — Wire types (mirror Phase 7 backend DTOs)

Read the existing serialize shapes before writing — they're the source of truth:
- `packages/domain/src/entities/interview/interview.entity.ts` (`InterviewSerialized`)
- `packages/domain/src/entities/interview/interview-status.ts` (`INTERVIEW_STATUS`, `InterviewStatus`)
- `packages/domain/src/entities/interview/value-objects/{job-description,candidate-info,interview-plan,planned-topic,transcript-entry,agent-note,agent-internal-score}.ts`
- `packages/domain/src/shared/value-objects/file-ref.ts`
- `packages/domain/src/entities/report/report.entity.ts` (`ReportSerialized`, `Recommendation`)
- `packages/application/src/dtos/{create-interview,generate-interview-plan,evaluate-interview,upload-candidate-documents,extract-candidate-documents}.dto.ts`

**File:** `apps/web/src/types/interview-status.types.ts` (CREATE)
```typescript
import { z } from "zod";

export const InterviewStatusSchema = z.enum([
  "CREATED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "CANCELLED",
]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const ALL_INTERVIEW_STATUSES = InterviewStatusSchema.options;
```

**File:** `apps/web/src/types/recommendation.types.ts` (CREATE)
```typescript
import { z } from "zod";

export const RecommendationSchema = z.enum(["advance", "hold", "reject"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;
```

**File:** `apps/web/src/types/file-ref.types.ts` (CREATE)
```typescript
import { z } from "zod";

export const FileRefSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1),
  uploadedAt: z.coerce.date(),
});
export type FileRef = z.infer<typeof FileRefSchema>;
```

**File:** `apps/web/src/types/document.types.ts` (CREATE)
```typescript
import { z } from "zod";
import { FileRefSchema } from "./file-ref.types";

export const JobDescriptionSchema = z.object({
  title: z.string(),
  company: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  rawText: z.string(),
});
export type JobDescription = z.infer<typeof JobDescriptionSchema>;

export const CandidateInfoSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  headline: z.string(),
  yearsOfExperience: z.number().nonnegative(),
  skills: z.array(z.string()),
  education: z.array(z.string()),
  rawText: z.string(),
});
export type CandidateInfo = z.infer<typeof CandidateInfoSchema>;

export const UploadDocumentsResponseSchema = z.object({
  jdRef: FileRefSchema,
  cvRef: FileRefSchema,
});
export type UploadDocumentsResponse = z.infer<typeof UploadDocumentsResponseSchema>;

export const ExtractDocumentsResponseSchema = z.object({
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
});
export type ExtractDocumentsResponse = z.infer<typeof ExtractDocumentsResponseSchema>;
```

**File:** `apps/web/src/types/interview-plan.types.ts` (CREATE)
```typescript
import { z } from "zod";

export const TopicPrioritySchema = z.enum(["must_cover", "if_time_permits"]);
export type TopicPriority = z.infer<typeof TopicPrioritySchema>;

export const PlannedTopicSchema = z.object({
  name: z.string(),
  questions: z.array(z.string()),
  timeAllocationMinutes: z.number().positive(),
  priority: TopicPrioritySchema,
});
export type PlannedTopic = z.infer<typeof PlannedTopicSchema>;

export const InterviewPlanSchema = z.object({
  topics: z.array(PlannedTopicSchema),
  targetDurationMinutes: z.number().int().positive(),
  maxDurationMinutes: z.number().int().positive(),
  mustAskQuestions: z.array(z.string()),
});
export type InterviewPlanT = z.infer<typeof InterviewPlanSchema>;
```

**File:** `apps/web/src/types/interview.types.ts` (CREATE)
```typescript
import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";
import { JobDescriptionSchema, CandidateInfoSchema } from "./document.types";
import { InterviewPlanSchema } from "./interview-plan.types";
import { FileRefSchema } from "./file-ref.types";

const TranscriptEntrySchema = z.object({
  speaker: z.enum(["candidate", "agent"]),
  text: z.string(),
  timestamp: z.coerce.date(),
});

const AgentNoteSchema = z.object({
  text: z.string(),
  createdAt: z.coerce.date(),
});

const AgentInternalScoreSchema = z.object({
  topicName: z.string(),
  score: z.number(),
  rationale: z.string(),
  recordedAt: z.coerce.date(),
});

export const InterviewSchema = z.object({
  id: z.string().uuid(),
  recruiterId: z.string().uuid(),
  status: InterviewStatusSchema,
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
  clientInstructions: z.string(),
  interviewPlan: InterviewPlanSchema.nullable(),
  transcript: z.array(TranscriptEntrySchema),
  notes: z.array(AgentNoteSchema),
  internalScores: z.array(AgentInternalScoreSchema),
  jdFileRef: FileRefSchema,
  cvFileRef: FileRefSchema,
  scheduledAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  reportId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Interview = z.infer<typeof InterviewSchema>;

export const ListInterviewsResponseSchema = z.object({
  interviews: z.array(InterviewSchema),
});
export type ListInterviewsResponse = z.infer<typeof ListInterviewsResponseSchema>;

export const GetInterviewResponseSchema = z.object({
  interview: InterviewSchema,
});

export const CreateInterviewResponseSchema = z.object({
  interviewId: z.string().uuid(),
  status: InterviewStatusSchema,
  scheduledAt: z.coerce.date(),
});
export type CreateInterviewResponse = z.infer<typeof CreateInterviewResponseSchema>;
```

**File:** `apps/web/src/types/candidate-link.types.ts` (CREATE)
```typescript
import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";

export const CandidateLinkSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type CandidateLink = z.infer<typeof CandidateLinkSchema>;

export const GeneratePlanResponseSchema = z.object({
  interviewId: z.string().uuid(),
  status: InterviewStatusSchema,
  topicCount: z.number().int().nonnegative(),
  targetDurationMinutes: z.number().int().positive(),
  maxDurationMinutes: z.number().int().positive(),
  candidateLink: CandidateLinkSchema,
});
export type GeneratePlanResponse = z.infer<typeof GeneratePlanResponseSchema>;

// POST /interviews/:id/candidate-link — Phase 8.0.5 endpoint.
// Stateless re-issuance: each call mints a fresh 7-day token without re-running
// the planner. Backend gates issuance to SCHEDULED | IN_PROGRESS interviews;
// any other status returns HTTP 409 with code "INVALID_INTERVIEW_STATE_TRANSITION".
// See docs/progress/phase-8-0-5.md and ADR-017.
export const IssueCandidateLinkResponseSchema = CandidateLinkSchema;
export type IssueCandidateLinkResponse = z.infer<typeof IssueCandidateLinkResponseSchema>;
```

**File:** `apps/web/src/types/report.types.ts` (CREATE)
```typescript
import { z } from "zod";
import { RecommendationSchema } from "./recommendation.types";

export const TopicScoreSchema = z.object({
  topicName: z.string(),
  score: z.number().min(0).max(5),
  justification: z.string(),
});
export type TopicScore = z.infer<typeof TopicScoreSchema>;

export const ReportSchema = z.object({
  id: z.string().uuid(),
  interviewId: z.string().uuid(),
  overallRecommendation: RecommendationSchema,
  topicScores: z.array(TopicScoreSchema),
  communicationAssessment: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
  generatedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Report = z.infer<typeof ReportSchema>;

export const GetReportResponseSchema = z.object({ report: ReportSchema });
export type GetReportResponse = z.infer<typeof GetReportResponseSchema>;

export const EvaluateInterviewResponseSchema = z.object({ report: ReportSchema });
export type EvaluateInterviewResponse = z.infer<typeof EvaluateInterviewResponseSchema>;

export const HttpErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
  }),
});
```

**File:** `apps/web/src/types/index.ts` (CREATE — barrel)
```typescript
export * from "./interview-status.types";
export * from "./recommendation.types";
export * from "./file-ref.types";
export * from "./document.types";
export * from "./interview-plan.types";
export * from "./interview.types";
export * from "./candidate-link.types";
export * from "./report.types";
```

**Invariant check:** Pure Zod, no `@repo/*` imports. Each schema's shape was hand-mirrored from the backend serialize types and DTO output types listed at the top of this step.

### Step 0.7 — Empty route-group skeletons

**File:** `apps/web/app/(recruiter)/layout.tsx` (CREATE)
**Render type:** Server Component
**What:** Auth-gating layout. Calls `getServerSession()`; redirects to `/login` if absent. Renders the `AppSidebar` shell composite around `{children}`. The full implementation lands in Phase 2 once the sidebar exists; for Phase 0 it is a minimal redirect-only stub.

```typescript
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // Sidebar/app-shell wired in Phase 2.
  return <>{children}</>;
}
```

**File:** `apps/web/app/(auth)/layout.tsx` (CREATE)
**Render type:** Server Component
**What:** Auth-page layout. If a session exists, redirect to `/dashboard` so logged-in users don't see login/signup. No sidebar.

```typescript
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (session) redirect("/dashboard");
  return <main className="flex min-h-screen items-center justify-center bg-background">{children}</main>;
}
```

### Step 0.8 — Update `@repo/ui` package.json exports for new primitives (preview)

Adding `Dialog`, `Textarea`, `Toaster` exports up-front so importers don't trip on path map drift later. The actual primitive files are built in Phase 3 (Dialog, Textarea) and on first toast use (Toaster — Phase 2 most likely).

**File:** `packages/ui/package.json` (MODIFY — add to `"exports"`)
```json
"./primitives/dialog": "./src/primitives/dialog/index.ts",
"./primitives/textarea": "./src/primitives/textarea/index.ts",
"./composites/toaster": "./src/composites/toaster/index.tsx",
"./composites/soft-block-screen": "./src/composites/soft-block-screen/index.tsx",
"./composites/interview-status-badge": "./src/composites/interview-status-badge/index.tsx",
"./composites/recommendation-badge": "./src/composites/recommendation-badge/index.tsx",
"./composites/file-upload-field": "./src/composites/file-upload-field/index.tsx",
"./composites/stepper-header": "./src/composites/stepper-header/index.tsx",
"./composites/topic-score-row": "./src/composites/topic-score-row/index.tsx"
```

### Phase 0 verification

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
```
Run `/frontend-arch-validator infrastructure` — confirm no `fetch` in lib, no `"use client"` in route layouts (besides `QueryProvider.tsx`), and the `auth.ts` placeholder throws cleanly.

---

## Phase 1 — Auth feature (forces D1: `auth.ts` wiring)

### Phase-skill chain
1. `/frontend-service-layer` — `auth.service.ts` (thin)
2. `/frontend-container-layer` — `LoginContainer/`, `SignupContainer/`
3. `/frontend-route-layer` — `(auth)/login/page.tsx`, `(auth)/signup/page.tsx`
4. **Resolve D1 here.** See sub-step "D1 resolution".
5. `/frontend-arch-validator routes`

### Step 1.0 — D1 resolution: how to wire `apps/web/src/lib/auth.ts`

Pick one and document the choice in this section:

**Option A — Proxy (RECOMMENDED default):**
- Add `next.config.js` rewrite: `{ source: "/api/auth/:path*", destination: "${process.env.NEXT_PUBLIC_API_URL}/api/auth/:path*" }`
- The browser-side `authClient` (Step 0.4) calls same-origin URLs which Next.js forwards to the backend.
- `apps/web/src/lib/auth.ts` `getServerSession` becomes a `fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/get-session`, { headers: { cookie: ... } })` that forwards the inbound cookie. Since this is **server-side route-layout code** running before the page renders, this is the one allowed cross-cutting `fetch` outside `apps/web/src/services/` — isolate it inside `auth.ts` and document it as the explicit exception (no other route should ever call `fetch` directly).

**Option B — Shared-DB:**
- Add `better-auth/adapters/drizzle` + `drizzle-orm` + `postgres` to `apps/web/package.json`.
- Re-create the auth schema in `apps/web/src/lib/auth-schema.ts` (or import via a new `@repo/auth-schema` package — preferable to avoid drift).
- Add `DATABASE_URL` and `BETTER_AUTH_SECRET` to `apps/web/.env.local`.
- `apps/web/src/lib/auth.ts` calls `createAuth({ secret, baseUrl, db })` directly.

**Recommendation: pick A unless a concrete latency or deployment constraint argues for B.** A has zero schema drift risk and zero new env vars on the frontend.

### Step 1.1 — `auth.service.ts` (thin wrapper, optional)

The plan recommends **skipping a separate `auth.service.ts` and calling `signIn` / `signUp` / `signOut` from `authClient` directly inside containers.** Rationale: better-auth's React client already wraps fetch + error mapping; introducing a service layer in front of it would duplicate the work without adding type-narrowing benefits, and the better-auth result type is already a `Result`-like shape (`{ data, error }`). If we later need cross-cutting concerns (telemetry, custom error mapping), promote to a service then.

If during implementation the choice changes — invoke `/frontend-service-layer` and create `apps/web/src/services/auth.service.ts` returning `Result<T, ServiceError>` per the standard contract.

### Step 1.2 — `LoginContainer`

**Files:**
- `apps/web/src/containers/LoginContainer/LoginContainer.tsx` (CREATE)
- `apps/web/src/containers/LoginContainer/useLogin.ts` (CREATE)
- `apps/web/src/containers/LoginContainer/index.ts` (CREATE)

**Render type:** Client (first `"use client"` boundary for this feature)
**What:** RHF + zod schema for `{ email, password }`; submits via `authClient.signIn.email`; on success, `router.push("/dashboard")`; on error, set form-level error using better-auth's error shape.

`useLogin.ts`:
```typescript
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password required"),
});
export type LoginFormValues = z.infer<typeof LoginSchema>;

export function useLogin() {
  const router = useRouter();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      // Map better-auth error codes to user-facing copy. Calm, not cheerful.
      const message =
        error.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "Email or password is incorrect."
          : "Something went wrong. Try again in a moment.";
      setSubmitError(message);
      return;
    }
    router.push("/dashboard");
    router.refresh(); // re-run server-side getSession in (recruiter)/layout
  });

  return { form, onSubmit, submitError, isSubmitting: form.formState.isSubmitting };
}
```

`LoginContainer.tsx`:
```typescript
"use client";

import { Button } from "@repo/ui/primitives/button";
import { Input } from "@repo/ui/primitives/input";
import { Label } from "@repo/ui/primitives/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@repo/ui/primitives/card";
import Link from "next/link";
import { useLogin } from "./useLogin";

export function LoginContainer() {
  const { form, onSubmit, submitError, isSubmitting } = useLogin();
  const { register, formState: { errors } } = form;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Sign in</CardTitle>
        <CardDescription>Welcome back. Enter your credentials to continue.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />
            {errors.email && <p className="text-sm text-negative">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!errors.password} />
            {errors.password && <p className="text-sm text-negative">{errors.password.message}</p>}
          </div>
          {submitError && <p className="text-sm text-negative" role="alert">{submitError}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-sm text-muted-foreground">
            New to Sift? <Link href="/signup" className="text-primary underline-offset-4 hover:underline">Create an account</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`index.ts`:
```typescript
export { LoginContainer } from "./LoginContainer";
export { useLogin } from "./useLogin";
```

**Invariant check:** Container (Client). Calls `authClient` directly (the explicit no-`auth.service.ts` choice from Step 1.1). RHF + zod per ADR-024. Error copy matches DESIGN.md tone (no "Oops!" / "Error!"). Uses semantic tokens only.

### Step 1.3 — `SignupContainer`

Same shape as Login. Schema adds confirm-password equality check. On success, better-auth `autoSignIn: true` (per `apps/backend/src/infrastructure/auth/auth.ts`) signs the user in immediately, then `router.push("/dashboard")`.

**Files:**
- `apps/web/src/containers/SignupContainer/SignupContainer.tsx`
- `apps/web/src/containers/SignupContainer/useSignup.ts`
- `apps/web/src/containers/SignupContainer/index.ts`

```typescript
const SignupSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

// In the hook:
await authClient.signUp.email({
  email: values.email,
  password: values.password,
  name: values.email.split("@")[0]!, // better-auth requires a name; use email local-part as placeholder per D6
});
```

### Step 1.4 — Auth route pages

**File:** `apps/web/app/(auth)/login/page.tsx` (CREATE)
**Render type:** Server Component
```typescript
import { LoginContainer } from "@/containers/LoginContainer";
export default function LoginPage() {
  return <LoginContainer />;
}
```

**File:** `apps/web/app/(auth)/signup/page.tsx` (CREATE) — analogous.

**Invariant check:** Pages mount exactly one container. No `"use client"`. No client hooks.

### Step 1.5 — Test the auth feature

`/frontend-test-suite` for: `useLogin`, `useSignup`, both containers (RTL), and a Playwright spec `e2e/auth.spec.ts` that visits `/login`, fills the form, intercepts `/api/auth/sign-in/email` via `page.route(...)` to return a session, and asserts the redirect to `/dashboard`.

### Phase 1 verification

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web
```
Run `/frontend-arch-validator routes` and `/frontend-arch-validator containers`.

---

## Phase 2 — Recruiter dashboard

### Phase-skill chain
1. `/frontend-service-layer` — `interview.service.ts` (`listInterviews`, `getInterview` for later use)
2. `/frontend-composite-layer` — `InterviewStatusBadge`, `RecommendationBadge` (in `packages/ui/src/composites/`); `AppSidebar`, `PageHeader`, `InterviewListRow`, `StatusFilterChips`, `EmptyDashboardState` (in `apps/web/src/components/`)
3. `/frontend-container-layer` — `InterviewListContainer/`
4. `/frontend-route-layer` — `(recruiter)/layout.tsx` (full version), `(recruiter)/dashboard/page.tsx`
5. `/frontend-arch-validator services|composites|containers|routes` after each layer

### Step 2.1 — `interview.service.ts` skeleton

**File:** `apps/web/src/services/interview.service.ts` (CREATE)
**Render type:** Module
**What:** Functions for every recruiter REST endpoint listed in Phase 7. Each returns `Promise<Result<T, ServiceError>>`.

```typescript
import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import type { ServiceError } from "./errors";
import {
  ListInterviewsResponseSchema,
  GetInterviewResponseSchema,
  CreateInterviewResponseSchema,
  GeneratePlanResponseSchema,
  IssueCandidateLinkResponseSchema,
  GetReportResponseSchema,
  EvaluateInterviewResponseSchema,
  HttpErrorBodySchema,
  type ListInterviewsResponse,
  type Interview,
  type CreateInterviewResponse,
  type GeneratePlanResponse,
  type IssueCandidateLinkResponse,
  type Report,
} from "@/types";
import type { z } from "zod";

const BASE = env.NEXT_PUBLIC_API_URL;

async function request<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<Result<T, ServiceError>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "include", ...init });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }

  if (res.status === 401 || res.status === 403) {
    return Err({ kind: "AUTH", status: res.status, message: "Unauthorized" });
  }
  if (res.status === 404) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "NOT_FOUND",
      message: parsed.success ? parsed.data.error.message : "Not found",
    });
  }
  if (!res.ok) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : "Server error",
    });
  }

  const body = await safeJson(res);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Err({
      kind: "RESPONSE_VALIDATION",
      message: "Response shape invalid",
      issues: parsed.error.issues,
    });
  }
  return Ok(parsed.data);
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

export function listInterviews(): Promise<Result<ListInterviewsResponse, ServiceError>> {
  return request("/interviews", { method: "GET" }, ListInterviewsResponseSchema);
}

export function getInterview(id: string): Promise<Result<{ interview: Interview }, ServiceError>> {
  return request(`/interviews/${encodeURIComponent(id)}`, { method: "GET" }, GetInterviewResponseSchema);
}

export function createInterview(input: {
  jobDescription: unknown;
  candidateInfo: unknown;
  clientInstructions: string;
  scheduledAt: string;
  jdFileRef: unknown;
  cvFileRef: unknown;
}): Promise<Result<CreateInterviewResponse, ServiceError>> {
  return request(
    "/interviews",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    CreateInterviewResponseSchema,
  );
}

export function generatePlan(
  interviewId: string,
  body?: { targetDurationMinutes?: number; maxDurationMinutes?: number },
): Promise<Result<GeneratePlanResponse, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/plan`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) },
    GeneratePlanResponseSchema,
  );
}

// Phase 8.0.5 — cheap, stateless link re-issuance. Use this anywhere the
// recruiter needs the candidate URL after the wizard's plan-generation step.
// Returns 409 with code "INVALID_INTERVIEW_STATE_TRANSITION" if the interview
// is not SCHEDULED or IN_PROGRESS — surface to the user as "this interview
// can no longer be shared" rather than a hard error.
export function issueCandidateLink(
  interviewId: string,
): Promise<Result<IssueCandidateLinkResponse, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/candidate-link`,
    { method: "POST" },
    IssueCandidateLinkResponseSchema,
  );
}

export function evaluateInterview(interviewId: string): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/evaluate`,
    { method: "POST" },
    EvaluateInterviewResponseSchema,
  );
}

export function getReport(interviewId: string): Promise<Result<{ report: Report }, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(interviewId)}/report`,
    { method: "GET" },
    GetReportResponseSchema,
  );
}
```

**Invariant check:** Only file with `fetch`. Every function returns `Result`. Every response is Zod-validated. `credentials: "include"` carries the better-auth session cookie cross-origin (proxy wiring keeps it same-origin; either way it's correct).

### Step 2.2 — `document.service.ts`

**File:** `apps/web/src/services/document.service.ts` (CREATE)
```typescript
import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import type { ServiceError } from "./errors";
import {
  UploadDocumentsResponseSchema,
  ExtractDocumentsResponseSchema,
  HttpErrorBodySchema,
  type UploadDocumentsResponse,
  type ExtractDocumentsResponse,
  type FileRef,
} from "@/types";

const BASE = env.NEXT_PUBLIC_API_URL;

export async function uploadDocuments(
  jdFile: File,
  cvFile: File,
): Promise<Result<UploadDocumentsResponse, ServiceError>> {
  const fd = new FormData();
  fd.append("jdFile", jdFile);
  fd.append("cvFile", cvFile);
  let res: Response;
  try {
    res = await fetch(`${BASE}/documents/upload`, { method: "POST", body: fd, credentials: "include" });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }
  if (res.status === 401 || res.status === 403) return Err({ kind: "AUTH", status: res.status, message: "Unauthorized" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({ kind: "SERVER", status: res.status, code: parsed.success ? parsed.data.error.code : undefined, message: parsed.success ? parsed.data.error.message : "Upload failed" });
  }
  const parsed = UploadDocumentsResponseSchema.safeParse(await res.json());
  if (!parsed.success) return Err({ kind: "RESPONSE_VALIDATION", message: "Upload response invalid", issues: parsed.error.issues });
  return Ok(parsed.data);
}

export async function extractDocuments(
  jdFile: Pick<FileRef, "key" | "contentType">,
  cvFile: Pick<FileRef, "key" | "contentType">,
): Promise<Result<ExtractDocumentsResponse, ServiceError>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/documents/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jdFile, cvFile }),
      credentials: "include",
    });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }
  if (res.status === 401 || res.status === 403) return Err({ kind: "AUTH", status: res.status, message: "Unauthorized" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({ kind: "SERVER", status: res.status, code: parsed.success ? parsed.data.error.code : undefined, message: parsed.success ? parsed.data.error.message : "Extraction failed" });
  }
  const parsed = ExtractDocumentsResponseSchema.safeParse(await res.json());
  if (!parsed.success) return Err({ kind: "RESPONSE_VALIDATION", message: "Extraction response invalid", issues: parsed.error.issues });
  return Ok(parsed.data);
}
```

**Invariant check:** Multipart upload uses `FormData`; do NOT set the `Content-Type` header explicitly — the browser must set it with the boundary.

### Step 2.3 — `useInterviewFilterStore` (Zustand)

**File:** `apps/web/src/stores/useInterviewFilterStore.ts` (CREATE)
```typescript
import { create } from "zustand";
import type { InterviewStatus } from "@/types";

export type InterviewStatusFilter = InterviewStatus | "ALL";

interface InterviewFilterState {
  statusFilter: InterviewStatusFilter;
  setFilter: (filter: InterviewStatusFilter) => void;
  reset: () => void;
}

const INITIAL: Pick<InterviewFilterState, "statusFilter"> = { statusFilter: "ALL" };

export const useInterviewFilterStore = create<InterviewFilterState>((set) => ({
  ...INITIAL,
  setFilter: (statusFilter) => set({ statusFilter }),
  reset: () => set(INITIAL, true),
}));
```

**Invariant check:** UI state only. Zero references to server data. The `reset` method (with the second `true` arg) is the test seam used by `useStore.setState(initial, true)`.

### Step 2.4 — Composites: status + recommendation badges

**File:** `packages/ui/src/composites/interview-status-badge/interview-status-badge.tsx` (CREATE)
**Render type:** Client (`Badge` is rendered, no event handlers strictly required, but composites in `@repo/ui` are conventionally Client to keep them safe to mount anywhere)
```typescript
import { Badge, type BadgeProps } from "@repo/ui/primitives/badge";
import { cn } from "@repo/ui/lib/cn";

export type InterviewStatusValue =
  | "CREATED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "EVALUATED" | "CANCELLED";

const VARIANT: Record<InterviewStatusValue, BadgeProps["variant"]> = {
  CREATED: "secondary",
  SCHEDULED: "default",
  IN_PROGRESS: "positive",
  COMPLETED: "outline",
  EVALUATED: "positive",
  CANCELLED: "negative",
};

const LABEL: Record<InterviewStatusValue, string> = {
  CREATED: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  EVALUATED: "Report ready",
  CANCELLED: "Cancelled",
};

export interface InterviewStatusBadgeProps {
  status: InterviewStatusValue;
  className?: string;
}

export function InterviewStatusBadge({ status, className }: InterviewStatusBadgeProps) {
  return (
    <Badge
      variant={VARIANT[status]}
      dot={status === "IN_PROGRESS"}
      className={cn(className)}
    >
      {LABEL[status]}
    </Badge>
  );
}
```

**File:** `packages/ui/src/composites/interview-status-badge/index.ts` (CREATE) — re-export.

**File:** `packages/ui/src/composites/recommendation-badge/recommendation-badge.tsx` (CREATE)
```typescript
import { Badge, type BadgeProps } from "@repo/ui/primitives/badge";

export type RecommendationValue = "advance" | "hold" | "reject";

const VARIANT: Record<RecommendationValue, BadgeProps["variant"]> = {
  advance: "positive",
  hold: "attention-warning",
  reject: "negative",
};

const LABEL: Record<RecommendationValue, string> = {
  advance: "Advance",
  hold: "Hold",
  reject: "Reject",
};

export function RecommendationBadge({ recommendation }: { recommendation: RecommendationValue }) {
  return <Badge variant={VARIANT[recommendation]}>{LABEL[recommendation]}</Badge>;
}
```

**Invariant check:** Composites depend only on primitives + `cn`. No services, no stores. Variants map to ADR-025 token rules — `advance→positive`, `hold→attention-warning`, `reject→negative`.

### Step 2.5 — App-shell composites (in `apps/web/src/components/`)

These can depend on the recruiter's session and routing, so they live in `apps/web/src/components/` rather than `packages/ui/src/composites/`.

**File:** `apps/web/src/components/AppSidebar.tsx` (CREATE)
**Render type:** Client (uses `usePathname` for active-state)
**What:** Side rail per the reference HTML — brand mark, nav items (Dashboard, Profile), bottom-pinned account section (avatar + email + sign-out trigger).

```typescript
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@repo/ui/primitives/avatar";
import { Button } from "@repo/ui/primitives/button";
import { authClient } from "@/lib/auth-client";

const NAV = [
  { href: "/dashboard", label: "Interviews" },
  { href: "/profile",   label: "Profile" },
];

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = email.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 flex-col gap-6 border-r border-border bg-background p-5">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <span aria-hidden className="size-6 rounded-pill bg-accent shadow-[0_0_14px_var(--orb-halo)]" />
        <span className="font-heading text-base font-bold tracking-tight">Sift</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-sm px-2.5 py-2 text-sm transition-colors ${
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar className="size-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm">{email.split("@")[0]}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="w-full justify-start">
          Sign out
        </Button>
      </div>
    </aside>
  );
}
```

**File:** `apps/web/src/components/PageHeader.tsx` (CREATE)
**Render type:** Server-safe (no client hooks); props-only
```typescript
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6 border-b border-border px-8 py-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  );
}
```

**File:** `apps/web/src/components/StatusFilterChips.tsx` (CREATE)
**Render type:** Client (consumes the Zustand store)
**What:** Chip row — `All`, `Scheduled`, `In progress`, `Report ready`, etc. Only the displayed-relevant statuses get a chip (skip `CANCELLED` for v1).

```typescript
"use client";

import { Button } from "@repo/ui/primitives/button";
import { useInterviewFilterStore, type InterviewStatusFilter } from "@/stores/useInterviewFilterStore";

const CHIPS: { value: InterviewStatusFilter; label: string }[] = [
  { value: "ALL",         label: "All" },
  { value: "SCHEDULED",   label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "EVALUATED",   label: "Report ready" },
  { value: "COMPLETED",   label: "Awaiting evaluation" },
];

export function StatusFilterChips() {
  const { statusFilter, setFilter } = useInterviewFilterStore();
  return (
    <div role="tablist" aria-label="Filter interviews by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const active = statusFilter === chip.value;
        return (
          <Button
            key={chip.value}
            role="tab"
            aria-selected={active}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
          </Button>
        );
      })}
    </div>
  );
}
```

**File:** `apps/web/src/components/InterviewListRow.tsx` (CREATE)
**Render type:** Client (renders `Link` + interactive)
**What:** Single row in the dashboard list — candidate name, role, status badge, recommendation badge if available, `→` linking to `/interviews/[id]`.

```typescript
"use client";

import Link from "next/link";
import { InterviewStatusBadge } from "@repo/ui/composites/interview-status-badge";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import type { Interview } from "@/types";

export function InterviewListRow({ interview }: { interview: Interview }) {
  return (
    <Link
      href={`/interviews/${interview.id}`}
      className="grid grid-cols-[2fr_3fr_auto_auto] items-center gap-6 rounded-md border border-border bg-card px-5 py-4 transition-colors hover:bg-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-1">
        <span className="font-heading text-sm font-semibold">{interview.candidateInfo.fullName}</span>
        <span className="text-xs text-muted-foreground">{interview.candidateInfo.email}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm">{interview.jobDescription.title}</span>
        <span className="text-xs text-muted-foreground">{interview.jobDescription.company}</span>
      </div>
      <InterviewStatusBadge status={interview.status} />
      <span className="text-xs tabular-nums text-muted-foreground">
        {new Date(interview.scheduledAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
```

**File:** `apps/web/src/components/EmptyDashboardState.tsx` (CREATE) — Server-safe, props-only.
```typescript
import type { ReactNode } from "react";

export function EmptyDashboardState({ action }: { action: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-card p-8 text-center">
      <h2 className="font-heading text-lg font-semibold">No interviews yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Create an interview to share a private link with your candidate. They join from a desktop;
        you'll see results here when the conversation wraps.
      </p>
      {action}
    </div>
  );
}
```

### Step 2.6 — `InterviewListContainer`

**Files:**
- `apps/web/src/containers/InterviewListContainer/InterviewListContainer.tsx`
- `apps/web/src/containers/InterviewListContainer/useInterviewList.ts`
- `apps/web/src/containers/InterviewListContainer/index.ts`

**Render type:** Client
**What:** Reads `useInterviewFilterStore`, fetches `listInterviews` via `useQuery`, applies client-side status filter + simple "load more" page-size cursor (since the backend has no pagination yet — slice client-side, increment by 20). Renders a `Skeleton` array while loading; renders `EmptyDashboardState` when empty; renders `InterviewListRow[]` otherwise.

`useInterviewList.ts`:
```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { listInterviews } from "@/services/interview.service";
import { useInterviewFilterStore } from "@/stores/useInterviewFilterStore";
import type { Interview } from "@/types";

const PAGE_SIZE = 20;

export function useInterviewList() {
  const { statusFilter } = useInterviewFilterStore();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const query = useQuery({
    queryKey: ["interviews"],
    queryFn: async () => {
      const result = await listInterviews();
      if (!result.ok) throw result.error;
      return result.value;
    },
  });

  const filtered = useMemo<Interview[]>(() => {
    const all = query.data?.interviews ?? [];
    if (statusFilter === "ALL") return all;
    return all.filter((i) => i.status === statusFilter);
  }, [query.data, statusFilter]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as { kind?: string } | null,
    interviews: visible,
    total: filtered.length,
    canLoadMore: filtered.length > visibleCount,
    loadMore: () => setVisibleCount((c) => c + PAGE_SIZE),
    refetch: query.refetch,
  };
}
```

`InterviewListContainer.tsx`:
```typescript
"use client";

import { Button } from "@repo/ui/primitives/button";
import { Skeleton } from "@repo/ui/primitives/skeleton";
import Link from "next/link";
import { useInterviewList } from "./useInterviewList";
import { StatusFilterChips } from "@/components/StatusFilterChips";
import { InterviewListRow } from "@/components/InterviewListRow";
import { EmptyDashboardState } from "@/components/EmptyDashboardState";

export function InterviewListContainer() {
  const { isLoading, isError, error, interviews, total, canLoadMore, loadMore } = useInterviewList();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <StatusFilterChips />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
      </div>
    );
  }
  if (isError) {
    const message =
      error?.kind === "NETWORK" ? "Connection lost. Try again." : "Couldn't load interviews. Try again.";
    return <p className="text-sm text-negative" role="alert">{message}</p>;
  }
  if (total === 0) {
    return (
      <EmptyDashboardState
        action={
          <Button asChild variant="primary">
            <Link href="/interviews/new">New interview</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StatusFilterChips />
      <div className="flex flex-col gap-2">
        {interviews.map((i) => <InterviewListRow key={i.id} interview={i} />)}
      </div>
      {canLoadMore && (
        <Button variant="ghost" onClick={loadMore} className="self-center">
          Load more
        </Button>
      )}
    </div>
  );
}
```

### Step 2.7 — Recruiter layout (full version) + dashboard route

**File:** `apps/web/app/(recruiter)/layout.tsx` (MODIFY — replace stub from Step 0.7)
```typescript
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { SoftBlockScreen } from "@repo/ui/composites/soft-block-screen"; // built in Phase 7

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <>
      {/* Visible only on small/coarse-pointer devices via internal media query (Phase 7). */}
      <SoftBlockScreen audience="recruiter" />
      <div className="grid min-h-screen grid-cols-[240px_1fr]">
        <AppSidebar email={session.email} />
        <div className="flex min-h-screen flex-col">{children}</div>
      </div>
    </>
  );
}
```

**File:** `apps/web/app/(recruiter)/dashboard/page.tsx` (CREATE)
```typescript
import Link from "next/link";
import { Button } from "@repo/ui/primitives/button";
import { PageHeader } from "@/components/PageHeader";
import { InterviewListContainer } from "@/containers/InterviewListContainer";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Interviews"
        description="Every screening you've launched, every report waiting on your read."
        actions={
          <Button asChild variant="primary">
            <Link href="/interviews/new">+ New interview</Link>
          </Button>
        }
      />
      <main className="flex-1 px-8 py-6">
        <InterviewListContainer />
      </main>
    </>
  );
}
```

**Invariant check:** Page mounts exactly one container. No `"use client"`. Layout uses semantic tokens only.

### Phase 2 verification

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web --filter=@repo/ui
```
Run `/frontend-arch-validator services|composites|containers|routes` after each layer. **Reminder:** if a toast is added during this phase (e.g., "Couldn't load interviews"), invoke `/frontend-composite-layer` to build `Toaster` (sonner wrapper) at that moment, not speculatively.

---

## Phase 3 — New-interview multi-step modal

### Phase-skill chain
1. `/frontend-primitive-layer` — `Dialog` (Radix), `Textarea`
2. `/frontend-composite-layer` — `FileUploadField`, `StepperHeader`
3. `/frontend-container-layer` — `NewInterviewContainer/`
4. `/frontend-route-layer` — `(recruiter)/interviews/new/page.tsx` (renders the dialog open by default; cancel routes back to `/dashboard`)
5. `/frontend-arch-validator primitives|composites|containers|routes`

### Step 3.1 — `Dialog` primitive (Radix)

Add `@radix-ui/react-dialog` to `packages/ui/package.json`.

**File:** `packages/ui/src/primitives/dialog/dialog.tsx` (CREATE)
**Render type:** Client (Radix primitives use refs + portals)
**What:** Standard shadcn-style Dialog wrapper — `Root`, `Trigger`, `Portal`, `Overlay`, `Content`, `Header`, `Title`, `Description`, `Footer`, `Close`. Uses `rounded-md` (12px) per ADR-025 (panel radius). Background `bg-popover` (oklch 0.220), shadow tasteful, fade+scale enter at 220ms (DESIGN.md §6 motion).

```typescript
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@repo/ui/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      "duration-220",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4",
        "rounded-md border border-border bg-popover p-6 text-popover-foreground shadow-2xl",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        "duration-220",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-heading text-xl font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
```

**File:** `packages/ui/src/primitives/dialog/index.ts` (CREATE) — barrel.
**File:** `packages/ui/src/primitives/dialog/dialog.test.tsx` — generated by `/frontend-test-suite`.

### Step 3.2 — `Textarea` primitive

**File:** `packages/ui/src/primitives/textarea/textarea.tsx` (CREATE)
**Render type:** Client
```typescript
import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full rounded-sm border border-input bg-input px-3 py-2 text-sm text-foreground",
      "placeholder:text-muted-foreground",
      "transition-colors duration-150 ease-out",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
```

### Step 3.3 — `FileUploadField` composite

**File:** `packages/ui/src/composites/file-upload-field/file-upload-field.tsx` (CREATE)
**Render type:** Client
**What:** Dashed-border drop zone using a hidden `<input type="file">`. Shows filename + size + clear-button when a file is selected. Pure UI — does NOT upload. The container performs the upload after both files are selected.

```typescript
"use client";

import * as React from "react";
import { Button } from "@repo/ui/primitives/button";
import { cn } from "@repo/ui/lib/cn";

export interface FileUploadFieldProps {
  id: string;
  label: string;
  accept?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string;
  disabled?: boolean;
}

export function FileUploadField({ id, label, accept = ".pdf", file, onChange, error, disabled }: FileUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  function handleFiles(list: FileList | null) {
    onChange(list?.[0] ?? null);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-input bg-card p-6 text-center transition-colors",
          dragOver && "border-primary bg-popover",
          disabled && "opacity-50 pointer-events-none",
          error && "border-negative",
        )}
      >
        {file ? (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm">{file.name}</span>
            <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Remove</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Drop a {accept} here, or</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={disabled}
        />
      </div>
      {error && <p className="text-sm text-negative" role="alert">{error}</p>}
    </div>
  );
}
```

### Step 3.4 — `StepperHeader` composite

**File:** `packages/ui/src/composites/stepper-header/stepper-header.tsx` (CREATE)
**Render type:** Client (presentational — could be Server, but conventionally Client for `@repo/ui`)
```typescript
import { cn } from "@repo/ui/lib/cn";

export interface StepperHeaderProps {
  steps: ReadonlyArray<string>;
  currentIndex: number;
}

export function StepperHeader({ steps, currentIndex }: StepperHeaderProps) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((label, i) => {
        const completed = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={label} className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-pill text-xs font-medium tabular-nums",
                completed && "bg-primary text-primary-foreground",
                active && "bg-secondary text-secondary-foreground ring-1 ring-ring",
                !completed && !active && "bg-muted text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {i + 1}
            </div>
            <span className={cn("text-xs", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
```

### Step 3.5 — `NewInterviewContainer` (the wizard)

**Files:**
- `apps/web/src/containers/NewInterviewContainer/NewInterviewContainer.tsx`
- `apps/web/src/containers/NewInterviewContainer/useNewInterview.ts`
- `apps/web/src/containers/NewInterviewContainer/steps/Step1UploadJD.tsx`
- `apps/web/src/containers/NewInterviewContainer/steps/Step2UploadCV.tsx`
- `apps/web/src/containers/NewInterviewContainer/steps/Step3Instructions.tsx`
- `apps/web/src/containers/NewInterviewContainer/steps/Step4ReviewLaunch.tsx`
- `apps/web/src/containers/NewInterviewContainer/index.ts`

**Render type:** Client
**What (per D2 default — container-local state, per D3 default — explicit Launch):**

`useNewInterview.ts` orchestrates:
- step index (0..3) via `useState`
- two `File | null` slots for JD + CV
- a `useMutation` for `uploadDocuments` (advances step 1→2 / 2→3 — actually the recommended flow is to do BOTH uploads when the user clicks "Next" on step 2, since the backend `POST /documents/upload` is one multipart request with both files)
- a `useMutation` for `extractDocuments` (called when entering step 4 to preview JD/CV)
- RHF for step 3 (`clientInstructions`, `targetDurationMinutes`, `maxDurationMinutes`)
- a `useMutation` for `createInterview` followed by `generatePlan` chained (the "Launch" action on step 4)
- `queryClient.invalidateQueries({ queryKey: ["interviews"] })` after launch
- on success, return the new `interviewId` so the container can `router.push(\`/interviews/${id}\`)`

```typescript
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { uploadDocuments, extractDocuments } from "@/services/document.service";
import { createInterview, generatePlan } from "@/services/interview.service";
import type { FileRef, ExtractDocumentsResponse } from "@/types";

export const STEPS = ["Job description", "Candidate CV", "Instructions", "Review"] as const;

const InstructionsSchema = z.object({
  clientInstructions: z.string().min(0).max(4000),
  targetDurationMinutes: z.coerce.number().int().min(5).max(60).default(15),
  maxDurationMinutes: z.coerce.number().int().min(10).max(120).default(25),
}).refine((v) => v.maxDurationMinutes >= v.targetDurationMinutes, {
  path: ["maxDurationMinutes"],
  message: "Max duration must be ≥ target duration",
});
export type InstructionsFormValues = z.infer<typeof InstructionsSchema>;

interface UploadedRefs { jd: FileRef; cv: FileRef; }

export function useNewInterview() {
  const router = useRouter();
  const qc = useQueryClient();

  const [stepIndex, setStepIndex] = useState(0);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploadedRefs, setUploadedRefs] = useState<UploadedRefs | null>(null);
  const [extracted, setExtracted] = useState<ExtractDocumentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<InstructionsFormValues>({
    resolver: zodResolver(InstructionsSchema),
    defaultValues: { clientInstructions: "", targetDurationMinutes: 15, maxDurationMinutes: 25 },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!jdFile || !cvFile) throw new Error("Both files required");
      const result = await uploadDocuments(jdFile, cvFile);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: (refs) => {
      setUploadedRefs({ jd: refs.jdRef, cv: refs.cvRef });
      setStepIndex(2); // jump to instructions
    },
    onError: (err: { kind?: string; message?: string }) => {
      setError(err.kind === "NETWORK" ? "Connection lost. Try again." : (err.message ?? "Upload failed."));
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (!uploadedRefs) throw new Error("Files not uploaded");
      const result = await extractDocuments(
        { key: uploadedRefs.jd.key, contentType: uploadedRefs.jd.contentType },
        { key: uploadedRefs.cv.key, contentType: uploadedRefs.cv.contentType },
      );
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: (data) => setExtracted(data),
    onError: () => setError("Couldn't read your documents. Try uploading again."),
  });

  const launchMutation = useMutation({
    mutationFn: async (formValues: InstructionsFormValues) => {
      if (!uploadedRefs || !extracted) throw new Error("Wizard state incomplete");
      const created = await createInterview({
        jobDescription: extracted.jobDescription,
        candidateInfo: extracted.candidateInfo,
        clientInstructions: formValues.clientInstructions,
        scheduledAt: new Date().toISOString(),
        jdFileRef: uploadedRefs.jd,
        cvFileRef: uploadedRefs.cv,
      });
      if (!created.ok) throw created.error;
      const planned = await generatePlan(created.value.interviewId, {
        targetDurationMinutes: formValues.targetDurationMinutes,
        maxDurationMinutes: formValues.maxDurationMinutes,
      });
      if (!planned.ok) throw planned.error;
      return {
        interviewId: created.value.interviewId,
        // generatePlan returns a fresh candidate link for free; reuse it to
        // skip a redundant POST /:id/candidate-link on the detail page.
        candidateLink: planned.value.candidateLink,
      };
    },
    onSuccess: ({ interviewId, candidateLink }) => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      // Pre-seed the detail page's candidate-link query so the auto-issue
      // useQuery hits a warm cache instead of firing a second HMAC request.
      qc.setQueryData(["candidate-link", interviewId], candidateLink);
      router.push(`/interviews/${interviewId}`);
    },
    onError: (err: { kind?: string; message?: string }) =>
      setError(err.kind === "NETWORK" ? "Connection lost. Try again." : (err.message ?? "Couldn't launch interview.")),
  });

  function next() {
    setError(null);
    if (stepIndex === 0 && jdFile) setStepIndex(1);
    else if (stepIndex === 1 && cvFile && jdFile) uploadMutation.mutate();
    else if (stepIndex === 2) {
      form.handleSubmit(() => {
        setStepIndex(3);
        extractMutation.mutate();
      })();
    }
  }
  function back() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function close() {
    router.push("/dashboard");
  }
  function launch() {
    form.handleSubmit((values) => launchMutation.mutate(values))();
  }

  return {
    stepIndex, steps: STEPS,
    jdFile, setJdFile, cvFile, setCvFile,
    uploadedRefs, extracted, form,
    isUploading: uploadMutation.isPending,
    isExtracting: extractMutation.isPending,
    isLaunching: launchMutation.isPending,
    error,
    next, back, close, launch,
  };
}
```

`NewInterviewContainer.tsx` renders `<Dialog open onOpenChange={(open) => !open && close()}>` with the appropriate step component for `stepIndex` and Next/Back/Launch/Cancel buttons in `<DialogFooter>`. The `StepperHeader` lives in `<DialogHeader>`. Step 4 shows the extracted JD title + candidate name + duration knobs (read-only) and the Launch button.

### Step 3.6 — Route

**File:** `apps/web/app/(recruiter)/interviews/new/page.tsx` (CREATE)
```typescript
import { NewInterviewContainer } from "@/containers/NewInterviewContainer";
export default function NewInterviewPage() {
  return <NewInterviewContainer />;
}
```

The route renders the dialog `open` by default. Cancel/dismiss navigates back to `/dashboard`. (Alternative: render dialog from the dashboard via state, no route. The route-based approach gives shareable URLs and cleaner browser-back semantics — preferred.)

### Phase 3 verification

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web --filter=@repo/ui
```
Run `/frontend-arch-validator primitives|composites|containers|routes`.

---

## Phase 4 — Interview detail (two states under one route)

### Phase-skill chain
1. `/frontend-composite-layer` — `TopicScoreRow` (in `@repo/ui/composites/`); `ShareLinkPanel`, `ReportViewer`, `EvaluateButton` (in `apps/web/src/components/`)
2. `/frontend-container-layer` — `InterviewDetailContainer/`
3. `/frontend-route-layer` — `(recruiter)/interviews/[id]/page.tsx`
4. `/frontend-arch-validator composites|containers|routes`

### Step 4.1 — `TopicScoreRow` composite

**File:** `packages/ui/src/composites/topic-score-row/topic-score-row.tsx` (CREATE)
```typescript
export interface TopicScoreRowProps {
  topicName: string;
  score: number;       // 0..5
  justification: string;
}

export function TopicScoreRow({ topicName, score, justification }: TopicScoreRowProps) {
  const pct = Math.round((score / 5) * 100);
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-sm font-semibold">{topicName}</span>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{score.toFixed(1)} / 5</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-muted">
        <div className="h-full bg-primary transition-[width] duration-220 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">{justification}</p>
    </div>
  );
}
```

**Invariant check:** Inline `style={{ width }}` is acceptable for data-driven width; the only color is a token (`bg-primary`).

### Step 4.2 — `ShareLinkPanel` (app component)

**File:** `apps/web/src/components/ShareLinkPanel.tsx` (CREATE)
**Render type:** Client (clipboard + state)
```typescript
"use client";

import { useState } from "react";
import { Button } from "@repo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/primitives/card";

interface Props {
  url: string;
  expiresInSeconds: number;
}

export function ShareLinkPanel({ url, expiresInSeconds }: Props) {
  const [copied, setCopied] = useState(false);
  const days = Math.round(expiresInSeconds / 86400);

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Candidate link</CardTitle>
        <CardDescription>Share this link with the candidate. Expires in {days} days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <code className="break-all rounded-sm border border-border bg-input px-3 py-2 font-mono text-xs text-foreground">
          {url}
        </code>
        <Button onClick={handleCopy} variant="secondary" className="self-start">
          {copied ? "Copied" : "Copy link"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

### Step 4.3 — `EvaluateButton` (app component)

**File:** `apps/web/src/components/EvaluateButton.tsx` (CREATE) — small wrapper that exposes a button and calls a passed `onEvaluate` callback (the container holds the mutation).

```typescript
"use client";

import { Button } from "@repo/ui/primitives/button";

interface Props {
  onEvaluate: () => void;
  isPending: boolean;
}

export function EvaluateButton({ onEvaluate, isPending }: Props) {
  return (
    <Button onClick={onEvaluate} disabled={isPending} variant="primary">
      {isPending ? "Evaluating…" : "Run evaluation"}
    </Button>
  );
}
```

### Step 4.4 — `ReportViewer` (app component)

**File:** `apps/web/src/components/ReportViewer.tsx` (CREATE)
**Render type:** Client (presentational, but lives next to other client components)
**What:** Renders the `Report` per DESIGN.md "calm vertical stack" — overall recommendation pill at top, then communication assessment paragraph, then `TopicScoreRow[]`, then strengths / concerns / follow-ups as three card sections.

```typescript
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/primitives/card";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import { TopicScoreRow } from "@repo/ui/composites/topic-score-row";
import type { Report } from "@/types";

export function ReportViewer({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="font-heading text-lg">Recommendation</CardTitle>
          <RecommendationBadge recommendation={report.overallRecommendation} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{report.communicationAssessment}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-heading text-lg">Topic scores</CardTitle></CardHeader>
        <CardContent>
          {report.topicScores.map((t) => (
            <TopicScoreRow key={t.topicName} topicName={t.topicName} score={t.score} justification={t.justification} />
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <BulletCard title="Strengths" items={report.strengths} />
        <BulletCard title="Concerns" items={report.concerns} />
      </div>

      <BulletCard title="Suggested follow-up questions" items={report.followUpQuestions} />
    </div>
  );
}

function BulletCard({ title, items }: { title: string; items: ReadonlyArray<string> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="font-heading text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

### Step 4.5 — `InterviewDetailContainer`

**Files:**
- `apps/web/src/containers/InterviewDetailContainer/InterviewDetailContainer.tsx`
- `apps/web/src/containers/InterviewDetailContainer/useInterviewDetail.ts`
- `apps/web/src/containers/InterviewDetailContainer/index.ts`

**Render type:** Client
**What:** `useQuery(["interview", id])` for the interview; conditionally `useQuery(["report", interviewId], { enabled: status === "EVALUATED" })` for the report. `useMutation` for `evaluateInterview` (only used when status === "COMPLETED"). View-model branches:
- `CREATED` → status pill + "Plan not yet generated" copy (rare — wizard completes plan generation before redirecting here, so this state is transient)
- `SCHEDULED` → status pill + `<ShareLinkPanel>` driven by an auto-issued link from the **Phase 8.0.5** endpoint `POST /interviews/:id/candidate-link`. The link is issued via TanStack `useQuery(["candidate-link", id], { enabled: status === "SCHEDULED" || status === "IN_PROGRESS", staleTime: 30 * 60 * 1000 })` — a 30-minute staleTime means the wizard-seeded link (see Step 3.x `launchMutation.onSuccess`) and per-visit re-issuance both work without thrashing. A "Re-issue link" button calls a mutation that explicitly hits the endpoint and writes the new link into the cache via `qc.setQueryData`. **Multiple concurrent live tokens are by design** (per ADR-017 / phase-8-0-5.md) — re-issuing does NOT revoke prior tokens; both keep working until their individual TTLs expire.
- `IN_PROGRESS` → status pill with live blip + "Interview in progress" copy + `<ShareLinkPanel>` (re-issuance is allowed during the interview in case the candidate lost the link mid-session)
- `COMPLETED` → `EvaluateButton`
- `EVALUATED` → `ReportViewer`
- `CANCELLED` → empty-state copy

**Error handling for the link query:** if the backend returns 409 (`INVALID_INTERVIEW_STATE_TRANSITION`) — should not happen because `enabled` already gates by status, but treat defensively — render "This interview can no longer be shared" instead of a hard error toast.

```typescript
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInterview,
  getReport,
  evaluateInterview,
  issueCandidateLink,
} from "@/services/interview.service";

const LINK_SHAREABLE_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;
type LinkShareableStatus = (typeof LINK_SHAREABLE_STATUSES)[number];
const isLinkShareable = (s: string | undefined): s is LinkShareableStatus =>
  LINK_SHAREABLE_STATUSES.includes(s as LinkShareableStatus);

export function useInterviewDetail(interviewId: string) {
  const qc = useQueryClient();

  const interviewQuery = useQuery({
    queryKey: ["interview", interviewId],
    queryFn: async () => {
      const r = await getInterview(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

  const status = interviewQuery.data?.interview.status;

  // Phase 8.0.5: auto-issue a fresh candidate link on every detail-page visit
  // when the interview is in a shareable state. Cheap (HMAC, no LLM call).
  // Each issuance is a new 7-day token; prior tokens stay valid until TTL.
  const candidateLinkQuery = useQuery({
    queryKey: ["candidate-link", interviewId],
    queryFn: async () => {
      const r = await issueCandidateLink(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: isLinkShareable(status),
    // 30min staleTime: wizard-seeded link is reused, mid-session refetches
    // are skipped, but a recruiter coming back tomorrow gets a fresh 7-day TTL.
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      // Don't retry the 409 ("not in shareable state") — surface immediately.
      const e = error as { kind?: string; code?: string };
      if (e?.kind === "SERVER" && e.code === "INVALID_INTERVIEW_STATE_TRANSITION") return false;
      return failureCount < 2;
    },
  });

  // Explicit "Re-issue link" button — same endpoint, button-driven.
  const reissueLinkMutation = useMutation({
    mutationFn: async () => {
      const r = await issueCandidateLink(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (data) => {
      qc.setQueryData(["candidate-link", interviewId], data);
    },
  });

  const reportQuery = useQuery({
    queryKey: ["report", interviewId],
    queryFn: async () => {
      const r = await getReport(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: status === "EVALUATED",
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const r = await evaluateInterview(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interview", interviewId] });
      qc.invalidateQueries({ queryKey: ["report", interviewId] });
    },
  });

  return {
    interviewQuery,
    reportQuery,
    candidateLinkQuery,
    reissueLinkMutation,
    evaluateMutation,
    status,
  };
}
```

### Step 4.6 — Route

**File:** `apps/web/app/(recruiter)/interviews/[id]/page.tsx` (CREATE)
```typescript
import { PageHeader } from "@/components/PageHeader";
import { InterviewDetailContainer } from "@/containers/InterviewDetailContainer";

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Interview" />
      <main className="flex-1 px-8 py-6">
        <InterviewDetailContainer interviewId={id} />
      </main>
    </>
  );
}
```

**Invariant check:** Next.js 16 App Router params are async `Promise<{ id: string }>` — `await params` per current convention.

### Phase 4 verification — same as prior phases.

---

## Phase 5 — Profile page

### Phase-skill chain
1. `/frontend-container-layer` — `ProfileContainer/`
2. `/frontend-route-layer` — `(recruiter)/profile/page.tsx`
3. `/frontend-arch-validator containers|routes`

### Step 5.1 — `ProfileContainer`

**Files:** `apps/web/src/containers/ProfileContainer/{ProfileContainer.tsx, useProfile.ts, index.ts}`
**What:** Reads `useSession()` from `authClient`; displays email + display-name (= email local-part per D6); a destructive "Sign out" button that calls `authClient.signOut()` then `router.push("/login")`. No password change. No delete.

```typescript
"use client";

import { Button } from "@repo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/primitives/card";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

export function ProfileContainer() {
  const router = useRouter();
  const { data, isPending } = useSession();

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data?.user) return <p className="text-sm text-muted-foreground">Not signed in.</p>;

  const email = data.user.email;
  const displayName = email.split("@")[0]!;

  async function onSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Account</CardTitle>
          <CardDescription>Your sign-in details.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Field label="Display name" value={displayName} />
          <Field label="Email" value={email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Session</CardTitle>
          <CardDescription>Sign out of this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={onSignOut}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
```

### Step 5.2 — Route

**File:** `apps/web/app/(recruiter)/profile/page.tsx` (CREATE)
```typescript
import { PageHeader } from "@/components/PageHeader";
import { ProfileContainer } from "@/containers/ProfileContainer";

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" description="Your account and session." />
      <main className="flex-1 px-8 py-6">
        <ProfileContainer />
      </main>
    </>
  );
}
```

---

## Phase 6 — Landing page

### Phase-skill chain
1. `/frontend-route-layer` — modify `apps/web/app/page.tsx`
2. `/frontend-arch-validator routes`

### Step 6.1 — Landing page (Server Component, redirect-aware per D4)

**File:** `apps/web/app/page.tsx` (MODIFY)
```typescript
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@repo/ui/primitives/button";
import { getServerSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await getServerSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <span aria-hidden className="size-16 rounded-pill bg-accent shadow-[0_0_28px_var(--orb-halo)]" />
        <h1 className="font-heading text-4xl font-bold tracking-tight">Sift</h1>
        <p className="max-w-md text-base text-muted-foreground">
          A composed voice interviewer that listens carefully and reports plainly.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button asChild variant="primary"><Link href="/signup">Create an account</Link></Button>
        <Button asChild variant="ghost"><Link href="/login">Sign in</Link></Button>
      </div>
    </main>
  );
}
```

**Invariant check:** Server Component. Uses semantic tokens. The orb-halo glow uses CSS variables (allowed inside arbitrary values when the value is a token).

---

## Phase 7 — Soft-block screen (DESIGN.md §5)

### Phase-skill chain
1. `/frontend-composite-layer` — `SoftBlockScreen` in `packages/ui/src/composites/`
2. `/frontend-arch-validator composites`

### Step 7.1 — `SoftBlockScreen`

**File:** `packages/ui/src/composites/soft-block-screen/soft-block-screen.tsx` (CREATE)
**Render type:** Client (uses `data-audience` for variant copy; CSS-only visibility via `@media`)
**What:** Per D5 default, this composite is mounted inside `(recruiter)/layout.tsx` (Step 2.7 already wires it). Detection is CSS-only — no JS device sniffing. The recruiter variant's copy is canonical per DESIGN.md §5.

```typescript
"use client";

import { cn } from "@repo/ui/lib/cn";

interface SoftBlockScreenProps {
  audience: "recruiter" | "candidate";
  className?: string;
}

const COPY: Record<SoftBlockScreenProps["audience"], { heading: string; body: string; why: string }> = {
  recruiter: {
    heading: "Sift's recruiter workspace is desktop-only.",
    body: "Open this link from a laptop or desktop to manage interviews.",
    why: "Why? The dashboard is a wide table — squashing it into a phone viewport makes it unusable rather than degraded.",
  },
  candidate: {
    heading: "Sift works best on a laptop or desktop.",
    body: "Open this link from a computer to begin your interview. We'll keep your scheduled session ready — nothing expires when you switch devices.",
    why: "Why? The interview is a live voice conversation, and laptops give the most reliable mic and connection. Phones can drop the call when you switch apps or the screen locks.",
  },
};

export function SoftBlockScreen({ audience, className }: SoftBlockScreenProps) {
  const copy = COPY[audience];
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-6 bg-background px-6 text-center",
        // CSS-only detection per DESIGN.md §5 — viewport + pointer, never user-agent.
        "max-[767px]:flex pointer-coarse:flex",
        className,
      )}
      role="alert"
      aria-live="polite"
    >
      <span aria-hidden className="size-10 rounded-pill bg-accent opacity-70 shadow-[0_0_20px_var(--orb-halo)]" />
      <h2 className="font-heading text-2xl font-semibold">{copy.heading}</h2>
      <p className="max-w-md text-base text-muted-foreground">{copy.body}</p>
      <p className="max-w-md text-sm text-muted-foreground">{copy.why}</p>
    </div>
  );
}
```

**Important Tailwind v4 detail:** `pointer-coarse:` is a custom variant. If Tailwind v4 doesn't ship this out of the box, register it in `globals.css`:
```css
@variant pointer-coarse (@media (pointer: coarse));
```

**Invariant check:** Pure composite, no app state. Visibility entirely via CSS media queries — no `useEffect`, no hydration mismatch risk.

---

## Phase 8 — Tests

### Phase-skill chain
1. `/frontend-test-suite` — invoked once per layer with the pass-context-forward rule from CLAUDE.md (plan path + file list).

### What to generate

| Layer | Test file | Mock surface |
|-------|-----------|--------------|
| Primitive | `packages/ui/src/primitives/dialog/dialog.test.tsx` | none — pure render |
| Primitive | `packages/ui/src/primitives/textarea/textarea.test.tsx` | none |
| Composite | `packages/ui/src/composites/interview-status-badge/interview-status-badge.test.tsx` | none |
| Composite | `packages/ui/src/composites/recommendation-badge/recommendation-badge.test.tsx` | none |
| Composite | `packages/ui/src/composites/file-upload-field/file-upload-field.test.tsx` | none |
| Composite | `packages/ui/src/composites/stepper-header/stepper-header.test.tsx` | none |
| Composite | `packages/ui/src/composites/topic-score-row/topic-score-row.test.tsx` | none |
| Composite | `packages/ui/src/composites/soft-block-screen/soft-block-screen.test.tsx` | match-media |
| Service | `apps/web/src/services/interview.service.test.ts` | `vi.stubGlobal("fetch", ...)` — happy path + every error path (NETWORK throw, 401, 404, 500, body-parse failure) |
| Service | `apps/web/src/services/document.service.test.ts` | same — plus FormData boundary not set |
| Store | `apps/web/src/stores/useInterviewFilterStore.test.ts` | direct hook call; reset with `setState(initial, true)` |
| Container | `apps/web/src/containers/LoginContainer/useLogin.test.ts` | `vi.mock("@/lib/auth-client")` |
| Container | `apps/web/src/containers/SignupContainer/useSignup.test.ts` | same |
| Container | `apps/web/src/containers/InterviewListContainer/useInterviewList.test.ts` | `vi.mock("@/services/interview.service")` + fresh `QueryClient` per test |
| Container | `apps/web/src/containers/NewInterviewContainer/useNewInterview.test.ts` | mock both services |
| Container | `apps/web/src/containers/InterviewDetailContainer/useInterviewDetail.test.ts` | mock interview.service |
| Container | `apps/web/src/containers/ProfileContainer/useProfile.test.ts` | mock auth-client |
| E2E | `apps/web/e2e/auth.spec.ts` | `page.route("**/api/auth/**")` to stub better-auth responses |
| E2E | `apps/web/e2e/dashboard.spec.ts` | `page.route("**/interviews", ...)` returning a fixture |
| E2E | `apps/web/e2e/report-viewer.spec.ts` | `page.route("**/interviews/:id", ...)` + `page.route("**/interviews/:id/report", ...)` returning evaluated-status fixtures; assert that recommendation pill, topic rows, and bullet cards render |

**E2E recommended for MVP only (per user note):**
1. Auth happy path — login → land on dashboard
2. Create interview happy path — login → click "New interview" → fill 4 steps → land on detail page (mock all backend calls)
3. Report viewer rendering — visit interview detail with `EVALUATED` fixture and assert the report renders correctly

Skip E2E for: profile, signup, soft-block, dashboard error states, all the unit-coverable surface.

---

## Phase 9 — Final verification & review

```bash
# 1. Type-check (must pass)
pnpm turbo run check-types --filter=web --filter=@repo/ui

# 2. Lint (must pass — max-warnings 0)
pnpm turbo run lint --filter=web --filter=@repo/ui

# 3. Unit + integration (must pass)
pnpm turbo run test --filter=web
pnpm turbo run test --filter=@repo/ui

# 4. E2E (must pass — Playwright browsers installed in pre-flight)
pnpm --filter web exec playwright test
```

Then:
- Run `/frontend-arch-validator <each layer>` one more time across the entire surface.
- Invoke the `frontend-code-reviewer` agent on every file created/modified, passing this plan path. Iterate until PASS.

---

## Pseudo-workflow — full happy path

1. Recruiter visits `/`. `app/page.tsx` (Server) calls `getServerSession()` → null → renders landing.
2. Clicks "Sign in" → `(auth)/login` → `LoginContainer` (Client) submits via `authClient.signIn.email`.
3. better-auth sets the session cookie; container `router.push("/dashboard")` + `router.refresh()`.
4. `(recruiter)/layout` (Server) re-runs `getServerSession()` → returns user → renders `<AppSidebar email={...}>` + `{children}`.
5. `dashboard/page.tsx` (Server) mounts `<InterviewListContainer>` (Client).
6. `useInterviewList` calls `useQuery(["interviews"])` → `listInterviews()` service → `fetch ${API}/interviews` with cookie → backend `requireRecruiter` passes → `ListInterviewsByRecruiterUseCase` returns interviews → service Zod-validates → `Result.Ok({interviews})` → query data populated.
7. `useInterviewFilterStore` selects `"ALL"` → all interviews render as `<InterviewListRow>`.
8. Recruiter clicks "+ New interview" → `router.push("/interviews/new")` → `NewInterviewPage` mounts `<NewInterviewContainer>` with `<Dialog open>`.
9. Step 1: pick JD → Next. Step 2: pick CV → Next triggers `uploadMutation` → `uploadDocuments(jd, cv)` → POST multipart → returns `{jdRef, cvRef}` → store in container state, advance to Step 3.
10. Step 3: fill instructions + duration knobs → Next triggers `extractMutation` → `extractDocuments(jdRef, cvRef)` → returns `{jobDescription, candidateInfo}` → store, advance to Step 4.
11. Step 4: shows extracted JD title + candidate name → user clicks "Launch interview" → `launchMutation` calls `createInterview(...)` then `generatePlan(interviewId, {targetDur, maxDur})` → returns `{candidateLink}` → invalidate `["interviews"]` → `router.push(\`/interviews/${interviewId}\`)`.
12. Detail page (`InterviewDetailContainer`): `useQuery(["interview", id])` → status `SCHEDULED` → simultaneously fires `candidateLinkQuery` → `POST /interviews/:id/candidate-link` (Phase 8.0.5 endpoint, cheap HMAC-only) → returns `{url, token, expiresInSeconds}` → renders status pill + `<ShareLinkPanel>` driven by the query data. A "Re-issue link" button calls `reissueLinkMutation` → same endpoint → `qc.setQueryData` writes the new link into the cache (prior tokens stay valid until TTL — multiple concurrent live links are by design per ADR-017).
13. Candidate completes the interview elsewhere; recruiter returns to detail page → status becomes `COMPLETED` → `<EvaluateButton>` visible → click → `evaluateMutation` → POST `/interviews/:id/evaluate` → invalidates `["interview", id]` and `["report", id]`.
14. Status flips to `EVALUATED` → `reportQuery` enables → fetches `/interviews/:id/report` → `<ReportViewer>` renders.
15. Recruiter clicks "Sign out" in the rail → `authClient.signOut()` → `router.push("/login")` + `refresh()` → `(auth)/layout` sees no session → no redirect → login renders.

**Connection-loss path:** Any `fetch` rejection in any service returns `Err({kind: "NETWORK"})`. Containers catch in `onError` → render the calm "Connection lost. Try again." copy. **Never** "Oops" / "✗" / "Error!".

---

## Entry points (innermost first — implementation order)

| #  | File                                                                                  | Layer     | Op     | Purpose                                            |
|----|---------------------------------------------------------------------------------------|-----------|--------|----------------------------------------------------|
| 1  | `apps/web/.env.local`                                                                 | env       | CREATE | `NEXT_PUBLIC_API_URL=http://localhost:8080`        |
| 2  | `apps/web/src/lib/query-client.ts`                                                    | lib       | CREATE | TanStack Query singleton                           |
| 3  | `apps/web/src/lib/QueryProvider.tsx`                                                  | lib       | CREATE | Client provider                                    |
| 4  | `apps/web/app/layout.tsx`                                                             | route     | MODIFY | Wrap children in QueryProvider                     |
| 5  | `apps/web/src/lib/auth-client.ts`                                                     | lib       | CREATE | better-auth React client                           |
| 6  | `apps/web/src/lib/auth.ts`                                                            | lib       | CREATE | Server-side auth stub (D1 deferred)                |
| 7  | `apps/web/src/types/*.ts` (8 files + `index.ts`)                                      | types     | CREATE | Zod wire schemas                                    |
| 8  | `apps/web/app/(recruiter)/layout.tsx`                                                 | route     | CREATE | Auth gate stub (Phase 0)                           |
| 9  | `apps/web/app/(auth)/layout.tsx`                                                      | route     | CREATE | Inverse auth gate                                   |
| 10 | `packages/ui/package.json`                                                            | package   | MODIFY | Add export paths for new primitives/composites     |
| 11 | **D1 resolved** — implement `apps/web/src/lib/auth.ts` for real (proxy or shared-DB)  | lib       | MODIFY | Phase 1 step 1.0                                   |
| 12 | `apps/web/src/containers/LoginContainer/{LoginContainer.tsx, useLogin.ts, index.ts}`  | container | CREATE | Login form                                         |
| 13 | `apps/web/src/containers/SignupContainer/{SignupContainer.tsx, useSignup.ts, index.ts}` | container | CREATE | Signup form                                        |
| 14 | `apps/web/app/(auth)/login/page.tsx`                                                  | route     | CREATE | Mount LoginContainer                               |
| 15 | `apps/web/app/(auth)/signup/page.tsx`                                                 | route     | CREATE | Mount SignupContainer                              |
| 16 | `apps/web/src/services/interview.service.ts`                                          | service   | CREATE | All interview endpoints                            |
| 17 | `apps/web/src/services/document.service.ts`                                           | service   | CREATE | upload + extract                                   |
| 18 | `apps/web/src/stores/useInterviewFilterStore.ts`                                      | store     | CREATE | Status filter chip state                           |
| 19 | `packages/ui/src/composites/interview-status-badge/*`                                 | composite | CREATE | Status pill mapper                                 |
| 20 | `packages/ui/src/composites/recommendation-badge/*`                                   | composite | CREATE | Recommendation pill mapper                         |
| 21 | `apps/web/src/components/AppSidebar.tsx`                                              | component | CREATE | Side rail                                          |
| 22 | `apps/web/src/components/PageHeader.tsx`                                              | component | CREATE | Page title bar                                     |
| 23 | `apps/web/src/components/StatusFilterChips.tsx`                                       | component | CREATE | Filter chips (consumes Zustand)                    |
| 24 | `apps/web/src/components/InterviewListRow.tsx`                                        | component | CREATE | List row card                                       |
| 25 | `apps/web/src/components/EmptyDashboardState.tsx`                                     | component | CREATE | Empty state                                         |
| 26 | `apps/web/src/containers/InterviewListContainer/*`                                    | container | CREATE | Dashboard hook + JSX                               |
| 27 | `apps/web/app/(recruiter)/layout.tsx`                                                 | route     | MODIFY | Full layout w/ sidebar + soft-block                |
| 28 | `apps/web/app/(recruiter)/dashboard/page.tsx`                                         | route     | CREATE | Mount InterviewListContainer                       |
| 29 | `packages/ui/src/primitives/dialog/*`                                                 | primitive | CREATE | Radix Dialog wrapper                               |
| 30 | `packages/ui/src/primitives/textarea/*`                                               | primitive | CREATE | Textarea                                           |
| 31 | `packages/ui/src/composites/file-upload-field/*`                                      | composite | CREATE | Drag/drop file picker                              |
| 32 | `packages/ui/src/composites/stepper-header/*`                                         | composite | CREATE | Wizard step indicator                              |
| 33 | `apps/web/src/containers/NewInterviewContainer/*` (incl. 4 step files)                | container | CREATE | Multi-step wizard                                  |
| 34 | `apps/web/app/(recruiter)/interviews/new/page.tsx`                                    | route     | CREATE | Mount NewInterviewContainer                        |
| 35 | `packages/ui/src/composites/topic-score-row/*`                                        | composite | CREATE | Topic + score + bar                                 |
| 36 | `apps/web/src/components/ShareLinkPanel.tsx`                                          | component | CREATE | Copyable candidate link                            |
| 37 | `apps/web/src/components/EvaluateButton.tsx`                                          | component | CREATE | Triggers evaluation                                 |
| 38 | `apps/web/src/components/ReportViewer.tsx`                                            | component | CREATE | Report layout                                       |
| 39 | `apps/web/src/containers/InterviewDetailContainer/*`                                  | container | CREATE | View-model branching                                |
| 40 | `apps/web/app/(recruiter)/interviews/[id]/page.tsx`                                   | route     | CREATE | Mount detail container                             |
| 41 | `apps/web/src/containers/ProfileContainer/*`                                          | container | CREATE | Display + sign-out                                  |
| 42 | `apps/web/app/(recruiter)/profile/page.tsx`                                           | route     | CREATE | Mount profile container                            |
| 43 | `apps/web/app/page.tsx`                                                               | route     | MODIFY | Landing + redirect-if-logged-in (D4)               |
| 44 | `packages/ui/src/composites/soft-block-screen/*`                                      | composite | CREATE | Desktop-only soft block                            |
| 45 | `packages/ui/src/composites/toaster/*` (LAZY)                                         | composite | CREATE | sonner wrapper — only on first toast use           |
| 46 | All `.test.{ts,tsx}` files per Phase 8                                                | tests     | CREATE | Pyramid coverage                                   |
| 47 | `apps/web/e2e/{auth,dashboard,report-viewer}.spec.ts`                                 | e2e       | CREATE | Playwright happy paths                             |

---

## Verification commands (run in order; do NOT run mid-session)

```bash
# 1. Type safety
pnpm turbo run check-types --filter=web --filter=@repo/ui

# 2. Lint
pnpm turbo run lint --filter=web --filter=@repo/ui

# 3. Unit + integration
pnpm turbo run test --filter=web
pnpm turbo run test --filter=@repo/ui

# 4. E2E (Playwright browsers must already be installed — see pre-flight step 2)
pnpm --filter web exec playwright test

# UI sanity (manual): pnpm --filter web dev → visit /, /login, /signup, /dashboard
```

---

## Risk notes

- **Server-side `fetch` in `auth.ts` (proxy wiring):** This is the **only** sanctioned `fetch` outside `apps/web/src/services/`. Document the exception inline. If we ever add a second cross-cutting server-side HTTP call, promote to `apps/web/src/services/server-auth.service.ts` with a `// SERVER ONLY` banner.
- **Hydration mismatch on `(recruiter)/layout`:** The layout reads `getServerSession()` server-side and renders `<AppSidebar email>`. The browser-side `useSession()` hook may briefly disagree if the cookie is stale. Mitigation: the sidebar's `email` is rendered from server-passed prop, not from `useSession`, so the initial paint is correct. The client hook is only used in `ProfileContainer`.
- **Interview poll-vs-invalidate for status changes:** Phase 8 does NOT poll. The dashboard refetches only on focus + after wizard launch. If a recruiter is staring at the detail page during an interview, `IN_PROGRESS → COMPLETED` is invisible until they refresh. Ship as-is for MVP; add polling in Phase 10.
- **Candidate-link recopy gap — RESOLVED in Phase 8.0.5:** `POST /interviews/:id/candidate-link` (added in `docs/progress/phase-8-0-5.md`) returns a fresh HMAC-signed link without re-running the planner. The detail container auto-issues on first view (when status is `SCHEDULED` or `IN_PROGRESS`) and exposes a "Re-issue link" button. Multiple concurrent live tokens are by design per ADR-017 — re-issuance does NOT revoke prior tokens. The 409 `INVALID_INTERVIEW_STATE_TRANSITION` response is gated by the query's `enabled` flag plus a defensive `retry: false` for that error code.
- **`autoSignIn: true` on signup:** better-auth signs the user in immediately; the session cookie may not be present in the response that returns to the SignupContainer. The pattern `router.push + router.refresh` re-runs the layout's `getServerSession()` and picks up the cookie. Verify in the E2E.
- **D2 (wizard state) leakage on route navigation:** If the recruiter navigates away mid-wizard, container-local state evaporates (the wizard route unmounts). This is correct for MVP — the wizard is meant as a single-shot flow. If a "save draft" is ever requested, promote D2 to a Zustand store.
- **Sonner toaster mount:** When `Toaster` is created, mount its `<Toaster />` element exactly once — recommended location is at the top of `(recruiter)/layout.tsx`'s render tree (alongside the soft-block screen). Mounting it inside a container causes duplicate toasters when multiple routes mount their containers.
- **`pointer-coarse:` Tailwind variant:** If Tailwind v4 doesn't recognize this out of the box (verify before Phase 7), register it via `@variant pointer-coarse (@media (pointer: coarse));` in `globals.css`. Without this the soft block only gates by viewport width — fine, but less precise.
- **`Dialog` portal + `data-theme`:** Radix portals to `document.body` which is OUTSIDE the `<html>` element where `data-theme` lives. Verify dark-theme tokens still apply inside the portal — they should, because the tokens are defined on `:root`, but worth a quick visual check.
- **CORS in dev:** With proxy wiring, the browser sees same-origin and there is no CORS issue. With shared-DB wiring, the better-auth cookie must be `SameSite=Lax` and the backend needs CORS for the Next.js dev origin. Phase 7 explicitly deferred CORS — confirm before going to shared-DB.
- **Service test fetch mocking:** When stubbing `fetch`, remember `credentials: "include"` and `Content-Type` headers (don't set them on multipart). A common bug is asserting on a `Content-Type: multipart/form-data` header that the test expected but the runtime correctly omitted.
- **D6 display name:** Email local-part is a placeholder. If the user pushes back and wants editable display names in Phase 8, that requires a backend column on `users`, an ADR, and a `PATCH /api/auth/me` endpoint — all of which are out of Phase 8 scope as stated.

---

## File saved to

`.claude/plan/phase-8-recruiter-frontend.md`
