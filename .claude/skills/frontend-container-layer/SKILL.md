---
name: frontend-container-layer
description: Write, review, or reason about container code in apps/web/src/containers/<Feature>Container/. Containers are the FIRST "use client" boundary in the app and the ONLY layer allowed to use TanStack Query (useQuery/useMutation), React Hook Form, or Zustand. Each container folder must contain three files — <Feature>Container.tsx (thin JSX shell), use<Feature>.ts (orchestration hook with the data calls, form state, and error mapping), and index.ts (barrel). Use this skill when the user asks to build a feature container, wire up a form, integrate TanStack Query, dispatch mutations, read app state, or map service errors to UI feedback. Use proactively whenever the user is touching apps/web/src/containers/.
user-invocable: true
version: 1.0.0
---

# Container Layer (`apps/web/src/containers/`)

Containers are where data, forms, and UI state meet. They are the only layer allowed to call TanStack Query hooks (`useQuery`, `useMutation`), React Hook Form hooks (`useForm`, `useFormContext`), or Zustand stores. They render composites and primitives — they never own raw HTML layout that should live in a composite. Pages call exactly one container.

**Location:** `apps/web/src/containers/<Feature>Container/`
**Boundary:** Containers are the **first `"use client"` boundary** in the app. Pages and layouts above them stay on the server by default.

**The carbonteq split:** the container hook holds the logic and is the unit you test in isolation (mock services, mock stores). The container component is a thin shell that just renders states. Keeping these separate is why the layer is testable at all.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| `<Feature>Container.tsx` | Thin JSX shell. Calls `use<Feature>()`, renders composites for each state (loading / error / empty / data). |
| `use<Feature>.ts` | Orchestration hook — TanStack Query calls, mutations, RHF form, Zustand reads, error → toast/redirect mapping. |
| `index.ts` | Barrel that exports the container component. Lets pages import via `@/containers/<Feature>Container`. |

---

## Folder pattern (mandatory)

Every container is a folder with exactly these three files:

```
apps/web/src/containers/CampaignListContainer/
├── CampaignListContainer.tsx
├── useCampaignList.ts
└── index.ts
```

Without the `index.ts`, importers either dig into the folder (`from "@/containers/CampaignListContainer/CampaignListContainer"`) which leaks internal structure, or get auto-resolution to the wrong file. The barrel makes the public surface explicit.

---

## Container component pattern

The component is a switch over the states the hook returns. No branching business logic, no inline mutation calls, no `useState` for server data.

```tsx
"use client"
import { useCampaignList } from "./useCampaignList"
import { DataTable } from "@repo/ui/composites/data-table"
import { EmptyState } from "@repo/ui/composites/empty-state"
import { Button } from "@repo/ui/primitives/button"

export function CampaignListContainer() {
  const { campaigns, isLoading, isError, errorMessage, onRefresh, onCreate } = useCampaignList()

  if (isLoading) return <DataTable.Skeleton rows={5} />
  if (isError) {
    return (
      <EmptyState
        title="Couldn't load campaigns"
        description={errorMessage}
        action={<Button onClick={onRefresh}>Retry</Button>}
      />
    )
  }
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title="No campaigns yet"
        action={<Button onClick={onCreate}>Create campaign</Button>}
      />
    )
  }
  return <DataTable data={campaigns} columns={/* ... */} />
}
```

If you find a `useState`, a `fetch`, a `useQuery`, or an `if` over a discriminated error union inside the `.tsx` — push it into the hook.

---

## Container hook pattern (TanStack Query + Zustand + error mapping)

The hook is where all the work happens. It calls services, owns the query keys, maps `ServiceError` to UI feedback, and returns a tidy view-model.

```ts
"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { campaignService } from "@/services/campaign.service"
import { useUiStore } from "@/stores/useUiStore"
import type { ServiceError } from "@/services/errors"

function mapErrorToToast(error: ServiceError) {
  switch (error.kind) {
    case "AUTH": return { title: "Please sign in" }
    case "NOT_FOUND": return { title: "Campaign not found" }
    case "NETWORK": return { title: "Network error", description: "Check your connection" }
    case "RESPONSE_VALIDATION": return { title: "Unexpected server response" }
    case "SERVER": return { title: error.message }
  }
}

export function useCampaignList() {
  const router = useRouter()
  const qc = useQueryClient()
  const openCreateDialog = useUiStore((s) => s.openCreateCampaignDialog)

  const query = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const result = await campaignService.list()
      if (!result.ok) throw result.error
      return result.value
    },
  })

  const createMut = useMutation({
    mutationFn: async (input: { slug: string }) => {
      const result = await campaignService.create(input)
      if (!result.ok) throw result.error
      return result.value
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] })
      toast.success("Campaign created")
    },
    onError: (error: ServiceError) => {
      if (error.kind === "AUTH") router.push("/sign-in")
      else toast.error(mapErrorToToast(error).title)
    },
  })

  return {
    campaigns: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorMessage: query.error ? mapErrorToToast(query.error as ServiceError).title : undefined,
    onRefresh: () => query.refetch(),
    onCreate: () => openCreateDialog(),
    createCampaign: createMut.mutate,
    isCreating: createMut.isPending,
  }
}
```

The pattern of `throw result.error` inside `queryFn` / `mutationFn` is intentional: TanStack Query's `error` state needs an actual thrown value to model failure, and we want to preserve the typed discriminated union (`ServiceError`) so `onError` can switch on `error.kind` and the component can read a typed `error`. The `throw` happens inside the query function only — it's not a hole in the service layer's "no throw" rule, which applies to the service itself.

---

## Forms — RHF + zodResolver in the container hook

```ts
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { z } from "zod"
import { campaignService } from "@/services/campaign.service"

const CreateCampaignFormSchema = z.object({
  slug: z.string().min(3).max(50),
  name: z.string().optional(),
})
type CreateCampaignFormValues = z.infer<typeof CreateCampaignFormSchema>

export function useCreateCampaignForm(onSuccess: () => void) {
  const form = useForm<CreateCampaignFormValues>({
    resolver: zodResolver(CreateCampaignFormSchema),
    defaultValues: { slug: "", name: "" },
  })
  const mutation = useMutation({
    mutationFn: async (values: CreateCampaignFormValues) => {
      const result = await campaignService.create(values)
      if (!result.ok) throw result.error
      return result.value
    },
    onSuccess,
  })
  return {
    form,
    onSubmit: form.handleSubmit((values) => mutation.mutate(values)),
    isSubmitting: mutation.isPending,
  }
}
```

The container component wraps its rendering with `<FormProvider {...form}>` so descendant `FormField` composites can call `useFormContext()`. The form schema lives next to the form's container hook — there's no separate "validation layer."

---

## Zustand: UI state only

Containers read from and dispatch to Zustand stores, but never store server data in them. Server data lives in the TanStack Query cache — keeping two sources of truth in sync is a class of bugs we don't need.

Use Zustand for: dialog open/close flags, sidebar collapse, optimistic UI toggles, multi-step wizard step index, ephemeral user prefs that don't merit a server round-trip.

---

## Authentication

Containers use the better-auth React client (`authClient.useSession()`) for session reads when the container itself depends on the user. If a query returns an `AUTH` error, redirect to sign-in via `useRouter().push("/sign-in")`. The layout above the container is the primary gate; the container is defense-in-depth.

---

## What is forbidden

- Calling `fetch()` from a container — go through a service
- Using `useState` to hold server data — use the TanStack Query cache (cache is the source of truth, deduped, invalidated)
- Putting business logic in the `.tsx` file — push it into the hook
- Skipping the `index.ts` barrel — without it, imports leak internal structure
- Importing from `@repo/domain` or `@repo/application` — backend types do not cross the wire boundary
- Owning raw HTML layout (nested divs with grid classes, complex flex shells) — that belongs in a composite. If you're styling structure, you're in the wrong file.
- A container that doesn't have a co-located `use<Feature>.ts` — even a tiny container gets the hook split so logic stays mockable
- Storing query results in a Zustand store — double source of truth, never in sync
- Calling a service directly from the `.tsx` (bypassing `useMutation`) — you lose retry, loading, error state, and the typed `onError` switch

---

## File layout

```
apps/web/src/
├── containers/
│   ├── CampaignListContainer/
│   │   ├── CampaignListContainer.tsx
│   │   ├── useCampaignList.ts
│   │   └── index.ts
│   ├── CreateCampaignDialogContainer/
│   │   ├── CreateCampaignDialogContainer.tsx
│   │   ├── useCreateCampaignDialog.ts
│   │   └── index.ts
│   └── InterviewSessionContainer/
│       └── ...
└── stores/
    └── useUiStore.ts
```

---

## When in doubt

The container is where TanStack Query, RHF, and Zustand are allowed to live. Everything else stays dumb.

---

## Related ADRs

- [ADR-021](../../../docs/adr/ADR-021-adopt-zustand-for-frontend-client-state.md) — Zustand for UI state only; containers read but do not store server data here
- [ADR-022](../../../docs/adr/ADR-022-use-tanstack-query-for-frontend-server-state.md) — TanStack Query owns all server data; containers are the only place `useQuery`/`useMutation` may appear
- [ADR-024](../../../docs/adr/ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) — RHF + Zod 4 form schemas live next to the container hook
- [ADR-018](../../../docs/adr/ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) — error → UI feedback mapping consumes the backend's exhaustive code table
