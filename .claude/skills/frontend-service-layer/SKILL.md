---
name: frontend-service-layer
description: Write, review, or reason about frontend service code in apps/web/src/services/<noun>.service.ts — the ONLY layer allowed to call fetch(). Each service function returns Promise<Result<T, ServiceError>>, validates every response with a Zod schema from apps/web/src/types/, and maps HTTP errors to a typed discriminated union (NetworkError | ResponseValidationError | AuthError | NotFoundError | ServerError). No React, no hooks, no axios, no throwing. Use this skill when the user asks to wrap a backend endpoint, add a service method, parse an API response, define wire types, or trace where a fetch call should live. Use proactively whenever the user is touching apps/web/src/services/.
user-invocable: true
version: 1.0.0
---

# Service Layer (`apps/web/src/services/`)

Services are the entire HTTP boundary of the frontend. Every interaction with the backend goes through a service function. No `fetch()` lives anywhere else in the app. Services are pure async TypeScript — no React, no hooks, no component imports. They are consumed by TanStack Query hooks living inside containers.

**Location:** `apps/web/src/services/<noun>.service.ts`
**Imports from:** `zod`, the in-app types (`@/types/*`), the in-app env helper (`@/lib/env`), the in-app `Result` helper (`@/lib/result`). Nothing else.

**Why this boundary exists:** a single chokepoint for API calls is where response validation (Zod), error mapping, auth cookies, retry policy, and tracing all live exactly once. If the wire shape changes, this is the only place we change it — components and containers never see raw `Response` objects.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Service function | Calls a specific backend endpoint, returns `Promise<Result<T, ServiceError>>` |
| Response schema | Zod schema in `apps/web/src/types/<noun>.types.ts` defining the wire shape |
| Error union | `ServiceError` discriminated union: `NETWORK`, `RESPONSE_VALIDATION`, `AUTH`, `NOT_FOUND`, `SERVER` |
| `Result` helper | `apps/web/src/lib/result.ts` — minimal `Ok`/`Err` type for frontend use |

---

## Response validation rule

Every response body, success or error, must be parsed through a Zod schema before reaching the caller. If parsing fails, return a `RESPONSE_VALIDATION` error. The reason is simple: the backend can drift, and we'd rather fail loudly here than render garbage into the UI. Containers downstream get a parsed, statically-typed value — they never see `unknown`.

---

## Code pattern

### Wire types live in `apps/web/src/types/`

```ts
// apps/web/src/types/campaign.types.ts
import { z } from "zod"

export const CampaignSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  status: z.enum(["DRAFT", "APPROVED", "ARCHIVED"]),
  name: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Campaign = z.infer<typeof CampaignSchema>

export const CampaignListSchema = z.object({
  items: z.array(CampaignSchema),
  total: z.number().int().nonnegative(),
})
export type CampaignList = z.infer<typeof CampaignListSchema>
```

### `Result` helper

```ts
// apps/web/src/lib/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

### Error union

```ts
// apps/web/src/services/errors.ts
export type ServiceError =
  | { kind: "NETWORK"; message: string; cause?: unknown }
  | { kind: "RESPONSE_VALIDATION"; message: string; issues: unknown }
  | { kind: "AUTH"; status: 401 | 403; message: string }
  | { kind: "NOT_FOUND"; message: string }
  | { kind: "SERVER"; status: number; code?: string; message: string }
```

### The service itself

```ts
// apps/web/src/services/campaign.service.ts
import { z } from "zod"
import { Ok, Err, type Result } from "@/lib/result"
import { env } from "@/lib/env"
import { CampaignSchema, CampaignListSchema, type Campaign, type CampaignList } from "@/types/campaign.types"
import type { ServiceError } from "./errors"

const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
})

async function request<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<Result<T, ServiceError>> {
  let res: Response
  try {
    res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
    })
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause })
  }

  const json = await res.json().catch(() => null)

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return Err({ kind: "AUTH", status: res.status, message: "Unauthorized" })
    }
    if (res.status === 404) {
      return Err({ kind: "NOT_FOUND", message: "Resource not found" })
    }
    const parsed = ApiErrorSchema.safeParse(json)
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : `Server error ${res.status}`,
    })
  }

  const parsed = schema.safeParse(json?.data ?? json)
  if (!parsed.success) {
    return Err({ kind: "RESPONSE_VALIDATION", message: "Response shape mismatch", issues: parsed.error.flatten() })
  }
  return Ok(parsed.data)
}

export const campaignService = {
  list(): Promise<Result<CampaignList, ServiceError>> {
    return request("/campaigns", { method: "GET" }, CampaignListSchema)
  },
  getById(id: string): Promise<Result<Campaign, ServiceError>> {
    return request(`/campaigns/${id}`, { method: "GET" }, CampaignSchema)
  },
  create(input: { slug: string; name?: string }): Promise<Result<Campaign, ServiceError>> {
    return request("/campaigns", { method: "POST", body: JSON.stringify(input) }, CampaignSchema)
  },
}
```

A few things to note about the pattern:

- `request<T>` is a private helper. Every public service method delegates to it so error mapping is uniform.
- `credentials: "include"` makes the browser send the better-auth session cookie automatically. There is no manual `Authorization` header for normal user requests.
- The JSON shape is `{ success, data, error }` (matches the backend envelope). We pass `json?.data ?? json` so endpoints that return the bare object still work.

---

## Auth

- For authenticated user sessions: `credentials: "include"` — the better-auth cookie does the rest. Services do not read tokens, do not touch `localStorage`, do not set headers manually.
- For candidate signed-link auth (backend ADR-017): the candidate container accepts the token from the URL and passes it to the service as a parameter. The service forwards it as a header or query param — it never reaches into storage to find it. This keeps services pure and testable.

---

## NEVER throw

Service functions are total. Every error path returns `Err(...)`. The caller (a TanStack Query hook in a container) decides what to render — toast, inline error, redirect to sign-in, retry. Throwing would defeat the entire design: `useQuery`'s `error` state can already model failure, but only if the service returns it rather than throwing past `react-query`'s boundary in a way that loses our error tag.

---

## What is forbidden

- Calling `fetch()` from anywhere outside `apps/web/src/services/` — primitives, composites, containers, pages, and route handlers must all go through a service
- Importing React, hooks, or components — services are framework-agnostic
- Using `axios` — `fetch` only. It's native, smaller bundle, sufficient.
- Throwing — return `Err(...)` always
- Returning a typed payload without first parsing the response through a Zod schema
- Coupling to TanStack Query (no `useQuery`, no `useMutation` imports here)
- Reading from `localStorage` or `sessionStorage` for auth — cookies handle it
- Importing `@repo/domain` or `@repo/application` — the frontend does not depend on backend packages. Wire shapes live in `apps/web/src/types/` as Zod schemas mirroring the backend DTO shape.
- Hard-coding URLs — read from `apps/web/src/lib/env.ts` (Zod-validated env)

---

## File layout

```
apps/web/src/
├── lib/
│   ├── env.ts           ← Zod-validated env, exports `env`
│   └── result.ts        ← Ok / Err / Result type
├── types/
│   ├── campaign.types.ts   ← wire Zod schemas + inferred types
│   ├── interview.types.ts
│   └── ...
└── services/
    ├── errors.ts        ← ServiceError discriminated union
    ├── campaign.service.ts
    ├── interview.service.ts
    └── ...
```

One service per backend noun. Service methods are exported as an object (`campaignService.list()`, `campaignService.getById(id)`) — easier to mock in tests via `vi.mock('@/services/campaign.service')`.

---

## When in doubt

The service layer is a contract between us and the backend. If the wire shape changes, this is the only place we change. Validate every response — trust nothing.

---

## Related ADRs

- [ADR-022](../../../docs/adr/ADR-022-use-tanstack-query-for-frontend-server-state.md) — TanStack Query consumes these service functions in container hooks
- [ADR-018](../../../docs/adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — backend HTTP error envelope shape that `ServiceError` mirrors
- [ADR-016](../../../docs/adr/ADR-016-adopt-better-auth-for-recruiter-authentication.md) — `credentials: "include"` for recruiter session cookie
- [ADR-017](../../../docs/adr/ADR-017-candidate-access-via-hmac-signed-link.md) — candidate signed-link token passed as a service parameter
