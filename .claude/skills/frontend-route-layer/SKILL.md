---
name: frontend-route-layer
description: Write, review, or reason about Next.js App Router pages and layouts under apps/web/app/ — including the two role-based route groups (recruiter) and (candidate). Pages and layouts are Server Components by default. NO useState, useEffect, useQuery, useMutation, or business logic in page.tsx or layout.tsx — the "use client" boundary starts at the container. Layouts handle session/auth gating (better-auth for recruiters, signed-link verification for candidates per backend ADR-017). Route handlers (route.ts) are rare — services call the backend directly. Use this skill when the user asks to add a route, build a page, set up a route group layout, gate access, configure providers, or arrange loading/error/not-found boundaries. Use proactively whenever the user is touching apps/web/app/.
user-invocable: true
version: 1.0.0
---

# Route Layer (`apps/web/app/`)

The route layer is the Next.js App Router surface. Pages and layouts are Server Components by default — they do not call `useState`, `useEffect`, `useQuery`, `useMutation`, or any client hook. Their job is to compose global providers, gate access at the layout level, and mount exactly one container per route.

**Location:** `apps/web/app/`
**Two route groups:** `(recruiter)` (better-auth session) and `(candidate)` (signed-link verification per backend ADR-017)
**Boundary rule:** The first `"use client"` lives in the container, not in `page.tsx`. If a page needs client behaviour, wrap it in a container.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| `app/layout.tsx` (root) | Global providers (QueryClientProvider, ThemeProvider, Toaster), base HTML shell |
| `app/(recruiter)/layout.tsx` | Recruiter session gate, recruiter app shell |
| `app/(candidate)/layout.tsx` (or per-route) | Candidate signed-link verification, minimal shell |
| `app/(recruiter)/.../page.tsx` | Server Component that mounts one container |
| `app/(candidate)/interview/[id]/page.tsx` | Server Component that mounts the InterviewSession container |
| `app/globals.css` | Tailwind v4 `@theme inline`, semantic design tokens |
| `app/.../loading.tsx`, `error.tsx`, `not-found.tsx` | Suspense / error / 404 boundaries |
| `app/.../route.ts` | Rare — server-only proxies or webhooks, never business logic |

---

## Page pattern (Server Component)

A page is a one-line shell that mounts its container. Anything heavier and you've drifted into the container layer.

```tsx
// app/(recruiter)/campaigns/page.tsx
import { CampaignListContainer } from "@/containers/CampaignListContainer"

export default function CampaignsPage() {
  return <CampaignListContainer />
}
```

Why so thin: keeping the page free of state and effects means it stays a Server Component, ships zero JS for its own logic, and the boundary between "what is this URL" (page) and "what does this feature do" (container) is sharp.

---

## Layout with session gating (recruiter group)

The session check happens on the server. By the time the container renders, we already know the user is a recruiter — no flicker, no client redirect.

```tsx
// app/(recruiter)/layout.tsx
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"  // server-side better-auth instance
import { RecruiterShell } from "@/components/recruiter-shell"

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || session.user.role !== "recruiter") redirect("/sign-in")
  return <RecruiterShell user={session.user}>{children}</RecruiterShell>
}
```

---

## Layout with signed-link verification (candidate group)

Per backend ADR-017, the candidate route's auth lives on a signed link. The layout verifies it server-side and hands the token (or its decoded claims) down to the container. If verification fails, render `notFound()` — the route should not leak whether the interview ID exists.

```tsx
// app/(candidate)/interview/[id]/layout.tsx
import { notFound } from "next/navigation"
import { verifyCandidateLink } from "@/lib/candidate-auth"  // server util

export default async function CandidateInterviewLayout({
  children,
  params,
  searchParams,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { id } = await params
  const { token } = await searchParams
  if (!token) notFound()
  const result = await verifyCandidateLink(id, token)
  if (!result.ok) notFound()
  return <>{children}</>
}
```

The verified token is then passed to the `InterviewSessionContainer` (via prop or via a server-set header) — the container uses it as the WS handshake credential. Per ADR-017, the container does not re-verify the signature; the route has already done that.

---

## Root layout — global providers

```tsx
// app/layout.tsx
import "./globals.css"
import { QueryProvider } from "@/components/query-provider"
import { Toaster } from "@repo/ui/composites/toaster"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
      </body>
    </html>
  )
}
```

`QueryProvider` is a small `"use client"` component that owns the `QueryClient` instance and renders `QueryClientProvider`. Isolating the `"use client"` directive to `QueryProvider` keeps the root layout itself a Server Component, which keeps the whole tree above containers server-rendered.

---

## Route handlers (`route.ts`) — use sparingly

Default to calling the backend Fastify API directly from services. A Next route handler is a duplicated HTTP boundary that adds latency and a place for logic to leak.

Legitimate reasons to add one:
- A webhook the backend can't receive (e.g., third-party callback that must hit our domain)
- A proxy for an API that can't be CORS'd from the browser
- A one-off auth callback (OAuth redirect, SSO assertion)

When you do write a route handler: keep it thin (parse, forward, respond) and put nothing that resembles business logic there. Business logic belongs in the backend.

---

## Loading, error, and not-found files

- `loading.tsx` — Server Component returning a skeleton built from primitives/composites. Triggered automatically by Suspense boundaries Next places around the page.
- `error.tsx` — Client Component (Next requires `"use client"`). Renders an inline error with a Retry button wired to the `reset` prop. Keep it generic; per-feature error states live in the container.
- `not-found.tsx` — Server Component for 404. Reachable via `notFound()` or unmatched URLs.

---

## `params` and `searchParams` in Next 16

Both are async — always `await` them inside the async Server Component function before reading their fields. If the container needs them, pass them as props to the container (containers run on the client and can't `await` route params themselves).

---

## What is forbidden

- `"use client"` in `page.tsx` or `layout.tsx` — Server Components by default. If something needs client behaviour, wrap that thing in a container.
- `useState` / `useEffect` / `useQuery` / `useMutation` in `page.tsx` or `layout.tsx`
- Calling `fetch()` from `page.tsx` — if data is needed at the route level, use a server util that goes through the same service layer, never an inline `fetch`
- Business logic in pages (filtering, sorting, computing derived values) — push it into the container hook
- Importing `@repo/domain` or `@repo/application`
- Skipping the session/role check in `(recruiter)/layout.tsx` or the signed-link verification in `(candidate)/.../layout.tsx`
- Hand-rolling a sign-in form in a page — use a `SignInContainer`
- Putting `"use client"` on the root layout — only on small leaf providers like `QueryProvider`

---

## File layout

```
apps/web/app/
├── layout.tsx                       ← root, Server Component, global providers
├── globals.css                      ← Tailwind v4 @theme inline, semantic tokens
├── (recruiter)/
│   ├── layout.tsx                   ← recruiter session gate (better-auth)
│   ├── campaigns/
│   │   ├── page.tsx                 ← mounts CampaignListContainer
│   │   ├── loading.tsx
│   │   └── [id]/
│   │       ├── page.tsx
│   │       └── loading.tsx
│   └── ...
├── (candidate)/
│   └── interview/
│       └── [id]/
│           ├── layout.tsx           ← signed-link verification (ADR-017)
│           ├── page.tsx             ← mounts InterviewSessionContainer
│           ├── loading.tsx
│           └── error.tsx
├── sign-in/
│   └── page.tsx                     ← mounts SignInContainer
└── not-found.tsx
```

---

## When in doubt

The route layer composes — providers, layouts, gates, and one container per page. If you're writing logic here, you're in the wrong file.
