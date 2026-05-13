---
name: frontend-test-suite
description: Generates a complete Vitest + React Testing Library + user-event test suite (unit, integration, and/or E2E with Playwright) for any frontend target — primitives, composites, services, containers, stores, or routes. Delegates the actual writing to the frontend-test-generator agent and provides the conventions, mock policies, file-location rules, and run commands. Use this skill when the user asks to write tests for frontend code, add coverage for a component, mock a service, set up a QueryClient test wrapper, or scaffold a Playwright E2E for a route.
user-invocable: true
argument-hint: "<target: file path | component | feature> [unit|integration|e2e|all]"
version: 1.0.0
---

# frontend-test-suite

Generates production-quality Vitest + React Testing Library tests for any target in the frontend clean architecture. The actual writing is delegated to the `frontend-test-generator` agent — this skill defines the conventions, mock policy, and folder layout the agent must follow.

---

## Scope

| Scope | What is covered | Run command |
|-------|----------------|-------------|
| `unit` | One unit in isolation — a primitive (RTL render), a composite (RTL + optional form context), a service (`fetch` stubbed via `vi.stubGlobal`), a Zustand store (direct hook test) | `pnpm turbo run test --filter=web` or `--filter=@repo/ui` |
| `integration` | Container hook with mocked service + a fresh `QueryClient` + RTL user interactions | `pnpm turbo run test --filter=web` |
| `e2e` | Playwright route-level: real browser, real network to a backend fixture or stubbed via `page.route()` | `pnpm --filter=web exec playwright test` |
| `all` | All applicable suites _(default)_ | all commands above |

---

## Architecture & coding principles

### Layer → test-file mapping

- **Primitives** in `packages/ui/src/primitives/<name>.test.tsx` — render, assert ARIA attributes (`getByRole`), assert applied variant classes, simulate clicks/typing via user-event, assert ref forwarding by passing a `ref` and verifying it points at the DOM node.
- **Composites** in `packages/ui/src/composites/<name>.test.tsx` or `apps/web/src/components/<name>.test.tsx` — render with the providers the composite expects (`FormProvider` for form composites), assert composition behaviour (error display, conditional rendering).
- **Services** in `apps/web/src/services/<name>.service.test.ts` — stub `fetch` via `vi.stubGlobal('fetch', ...)` with a typed mock, exercise both success and every error path, assert the `Result` discriminated union shape, assert Zod parse failures land in `RESPONSE_VALIDATION`.
- **Containers** in `apps/web/src/containers/<Feature>Container/use<Feature>.test.tsx` — `vi.mock('@/services/<noun>.service')`, provide a fresh `QueryClient` per test inside a `QueryClientProvider` wrapper, use `renderHook` + `waitFor`, assert the view-model the hook returns.
- **Stores** in `apps/web/src/stores/<name>.test.ts` — call the hook directly (or `useStore.getState()`), dispatch actions, assert resulting state.
- **Routes (E2E)** in `apps/web/e2e/<route>.spec.ts` — Playwright; spin up the dev server, assert page-level flows.

### Mock policy

- **Primitives & composites:** no mocks. Render the real component. The point is to assert the component's contract — mocking removes that signal.
- **Services:** mock `fetch` via `vi.stubGlobal('fetch', ...)`. Restore in `afterEach`. We are testing our error mapping and Zod parsing — the network is not under test.
- **Containers:** mock the service module: `vi.mock('@/services/<noun>.service', () => ({ <noun>Service: { list: vi.fn(), getById: vi.fn(), ... } }))`. Provide a fresh `QueryClient` per test to prevent cache leak across tests.
- **Stores:** no mocks. Reset state between tests with the store's own reset helper or `useStore.setState(initial, true)`.

### QueryClient pattern for container tests

```ts
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

it("loads campaigns and renders the list", async () => {
  vi.mocked(campaignService.list).mockResolvedValue(Ok({ items: [/* fixture */], total: 1 }))
  const { result } = renderHook(() => useCampaignList(), { wrapper })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.campaigns).toHaveLength(1)
})
```

`retry: false` keeps tests deterministic — without it, TanStack Query's default exponential backoff slows error tests and makes them flaky.

### `Result` discriminated union assertions for services

```ts
// Success path
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ data: { items: [/* … */], total: 2 } }), { status: 200 }),
))
const result = await campaignService.list()
expect(result.ok).toBe(true)
if (result.ok) expect(result.value.items).toHaveLength(2)

// Error path
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
const r = await campaignService.list()
expect(r.ok).toBe(false)
if (!r.ok) expect(r.error.kind).toBe("NOT_FOUND")
```

Use the type narrowing pattern (`if (result.ok)`) so the test is type-safe — there's no `as` cast.

### User interaction

- Use `@testing-library/user-event` v14: `const user = userEvent.setup()` once per test, then `await user.click(...)`, `await user.type(...)`. Never `fireEvent` — user-event simulates real focus, keyboard, and pointer events that match how a person uses the app.
- Prefer accessible queries: `getByRole`, `getByLabelText`, `getByText` over `getByTestId`. If you can't find a node by role, the component is probably not accessible — fix that, then the test gets easier.

### Async waiting

- `findBy*` for "wait until this element appears", `waitFor` for arbitrary assertions. Never `setTimeout`-based sleeps — they make CI flaky.

### Playwright E2E

- One spec per route group flow: `recruiter-campaign-crud.spec.ts`, `candidate-interview.spec.ts`, etc.
- For pure frontend E2E (no real backend), stub responses with `page.route('**/api/**', route => route.fulfill({ ... }))`.
- For full end-to-end, point Playwright's `baseURL` at a backend test fixture spun up alongside the dev server.

---

## Test file locations

```
packages/ui/src/primitives/button.test.tsx
packages/ui/src/composites/form-field.test.tsx
apps/web/src/components/header.test.tsx
apps/web/src/services/campaign.service.test.ts
apps/web/src/stores/useUiStore.test.ts
apps/web/src/containers/CampaignListContainer/useCampaignList.test.tsx
apps/web/e2e/recruiter-campaigns.spec.ts
```

Co-locate unit/integration tests with the source. E2E specs live in `apps/web/e2e/`.

---

## How to invoke

1. Identify the **target** from `$ARGUMENTS`.
2. Infer **scope** — default `all`; honour explicit `unit`, `integration`, or `e2e`.
3. If the target is ambiguous, ask **one** clarifying question.
4. Spawn the `frontend-test-generator` agent via the `Agent` tool, passing:
   - The resolved file path (or feature description)
   - The chosen scope
   - A note to follow the conventions in this skill
5. The agent reads the source file and any existing tests for stylistic consistency, writes the test file(s), runs them, and iterates until green.
6. Report back:
   - Files created / modified
   - Suites produced (unit / integration / e2e)
   - Exact commands to run each suite
   - Any blockers (missing devDependencies, env vars, dev-server requirements for Playwright)

Why delegate to the agent: the test files are themselves a small project (imports, fixtures, mocks, multiple `it` blocks). The agent works in its own context window, runs the tests, and iterates without polluting the main conversation. This skill provides the rules; the agent provides the keystrokes.

---

## Running tests

```bash
# Web app unit + integration (Vitest)
pnpm turbo run test --filter=web

# UI package unit (Vitest)
pnpm turbo run test --filter=@repo/ui

# Playwright E2E
pnpm --filter=web exec playwright test

# All frontend tests
pnpm turbo run test --filter=web --filter=@repo/ui && pnpm --filter=web exec playwright test
```

---

## Coverage targets

Soft goals, parity with the backend:
- 80% statements / 75% branches for any new feature
- Primitives close to 100% — they're small, high-value, and shipped to every consumer
- Container hooks: every distinct view-model state (loading, error, empty, data, mutating) gets at least one test
- Services: every endpoint, every error kind (`NETWORK`, `RESPONSE_VALIDATION`, `AUTH`, `NOT_FOUND`, `SERVER`)
