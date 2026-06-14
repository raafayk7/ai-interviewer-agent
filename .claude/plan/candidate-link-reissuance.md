# Plan: Add POST /interviews/:id/candidate-link (candidate link reissuance)

> Generated: 2026-05-15
> Slug: candidate-link-reissuance

## Summary

Adds a recruiter-facing endpoint that issues a fresh HMAC-signed candidate session link for an existing interview. The endpoint is stateless: each call mints a new 7-day token from the existing `CandidateSignedLink` issuer; no DB persistence. Auth is recruiter-only via better-auth; ownership is verified in presentation (404 on mismatch per ADR-019); a domain status gate restricts issuance to `SCHEDULED` and `IN_PROGRESS` interviews (409 otherwise). The work introduces one new application use case (`IssueCandidateLinkUseCase`) that performs the lookup + status gate, plus one new controller method and one route. Token issuance and URL construction remain a presentation concern (matching the existing `generatePlan` pattern). No domain types, no repository changes, no schema migration, no new ports.

## Layers touched

| Layer          | Package / Location                  | Scope                                                                                          |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Domain         | `packages/domain/`                  | none (reuses `InvalidInterviewStateTransitionError`, `INTERVIEW_STATUS`, `InterviewNotFoundError`) |
| Application    | `packages/application/`             | new `IssueCandidateLinkUseCase` + barrel export                                                |
| Infrastructure | `apps/backend/src/infrastructure/`  | none (reuses existing `CandidateSignedLink`)                                                   |
| Presentation   | `apps/backend/src/presentation/`    | new controller method, new route, new dep wired into controller                                |

Composition (`apps/backend/src/composition/recruiter-interview.composition.ts`) is updated to construct and inject the new use case.

---

## Decisions (with rationale)

### Decision 1 — Status gate: `SCHEDULED` and `IN_PROGRESS`

**Choice:** Allow link issuance only when `interview.status ∈ { SCHEDULED, IN_PROGRESS }`.

**Rationale:** Pre-`SCHEDULED` (`CREATED`) there is no `interviewPlan` yet so the candidate has nothing to join. Post-`IN_PROGRESS` (`COMPLETED`, `EVALUATED`, `CANCELLED`) the interview is over and a candidate link has no meaning. `IN_PROGRESS` must be included because the candidate may lose the link mid-interview (closed tab, network drop) and need it reissued. The check is expressed as a discrete `if` against the two allowed statuses, returning `InvalidInterviewStateTransitionError` for any other status; the existing error code already maps to HTTP 409 via `STATUS_BY_CODE`.

### Decision 2 — `CandidateLinkIssuer` stays in presentation (not promoted to a port)

**Choice:** Keep the `CandidateLinkIssuer` structural interface in `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`. Do not introduce a `@repo/application` port for it.

**Rationale:** The use case only needs to load the interview and validate its status. It returns `{ interviewId }` on success; the controller calls `candidateLink.issue(id)` and builds the URL with `publicBaseUrl`. This mirrors the existing `generatePlan` flow where the controller is the issuance site. Promoting `CandidateLinkIssuer` to a port would (a) push a transport-shaped concept (token strings) into the application layer, (b) couple `IssueCandidateLinkUseCase` to a new dependency without architectural benefit, and (c) require parallel changes in `GenerateInterviewPlanUseCase` to remain consistent. The use case is therefore a thin lookup + gate; the URL/token construction lives in the controller where it already lives for plan generation.

### Decision 3 — Use case name: `IssueCandidateLinkUseCase`

**Choice:** `IssueCandidateLinkUseCase` in `packages/application/src/use-cases/interview/issue-candidate-link.use-case.ts`.

**Rationale:** Matches the verb-noun pattern in the existing barrel (`CreateInterviewUseCase`, `GenerateInterviewPlanUseCase`, `GetInterviewByIdUseCase`, `EvaluateInterviewUseCase`, `ListInterviewsByRecruiterUseCase`). "Issue" reads naturally for token/link minting and avoids ambiguity with "create" (already used for the interview itself) or "generate" (used for the plan).

### Decision 4 — Do not refactor `GenerateInterviewPlanUseCase`

**Choice:** Leave `GenerateInterviewPlanUseCase` untouched. Track a follow-up to optionally factor out a shared `issueCandidateLink` step.

**Rationale:** `GenerateInterviewPlanUseCase` currently returns `GenerateInterviewPlanOutput` and the controller issues the token inline at the call site. Refactoring it to delegate to `IssueCandidateLinkUseCase` would change its signature (require a new dependency or compose two use cases at the composition root), ripple into `RecruiterInterviewControllerDeps`, and force an existing test/contract change. The duplication is one line of `candidateLink.issue(id)` plus URL building — well below the threshold that justifies a refactor in the same PR.

---

## Implementation steps

### Step 1 — Application: create `IssueCandidateLinkUseCase`

**File:** `packages/application/src/use-cases/interview/issue-candidate-link.use-case.ts` (CREATE)

**What:** New use case that loads the interview, asserts status is `SCHEDULED` or `IN_PROGRESS`, and returns the interview id. No side effects (no token, no persistence).

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  type IInterviewRepository,
  type InterviewStatus,
} from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import {
  ServiceUnknownError,
  type ServiceError,
} from "../../core/service-error.js";

export interface IssueCandidateLinkInput {
  readonly interviewId: string;
}

export interface IssueCandidateLinkOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;
}

const ALLOWED_STATUSES: ReadonlyArray<InterviewStatus> = [
  INTERVIEW_STATUS.SCHEDULED,
  INTERVIEW_STATUS.IN_PROGRESS,
];

export class IssueCandidateLinkUseCase extends UseCase<
  IssueCandidateLinkInput,
  IssueCandidateLinkOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: IssueCandidateLinkInput,
  ): Promise<Result<IssueCandidateLinkOutput, ServiceError>> {
    const interviewResult = await this.interviews.findById(input.interviewId);
    if (interviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          interviewResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    const interviewOrErr = interviewResult.unwrap().match({
      Some: (interview) => Result.Ok(interview),
      None: () =>
        Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
    if (interviewOrErr.isErr()) {
      return interviewOrErr;
    }

    const interview = interviewOrErr.unwrap();
    if (!ALLOWED_STATUSES.includes(interview.status)) {
      // Re-use the existing state-transition error (maps to HTTP 409).
      // We pass the current status as `from` and SCHEDULED as the conceptual `to`
      // because the link is only meaningful when the interview is in a joinable state.
      return Result.Err(
        new InvalidInterviewStateTransitionError(
          interview.status,
          INTERVIEW_STATUS.SCHEDULED,
        ) as ServiceError,
      );
    }

    return Result.Ok({
      interviewId: interview.id,
      status: interview.status,
    });
  }
}
```

**Invariant check:**
- No `throw` / `try/catch`; all branches return `Result`.
- Repository error translated at boundary to `ServiceUnknownError`.
- Imports only from `@repo/domain` and intra-package relative paths — application → domain only.
- Use case extends `UseCase<TInput, TOutput>`; `execute` returns `Promise<Result<T, ServiceError>>`.

---

### Step 2 — Application: extend use-case barrel

**File:** `packages/application/src/use-cases/interview/index.ts` (MODIFY)

**What:** Export the new use case and its DTO types.

**Code:**
```typescript
// add to existing exports
export {
  IssueCandidateLinkUseCase,
  type IssueCandidateLinkInput,
  type IssueCandidateLinkOutput,
} from "./issue-candidate-link.use-case.js";
```

**Invariant check:** Barrel exports new public types so downstream packages (`apps/backend`) can import via `@repo/application`.

---

### Step 3 — Application: confirm package-root barrel re-exports

**File:** `packages/application/src/index.ts` (MODIFY — verify only)

**What:** Confirm that `./use-cases/interview/index.ts` is re-exported from the package root. If the existing pattern re-exports the `interview` sub-barrel wholesale, no edit is required — `IssueCandidateLinkUseCase` and its types will be auto-exposed via the new entry in Step 2. If the root barrel cherry-picks names, add the three new identifiers.

**Verification command:**
```bash
rg "use-cases/interview" /home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/application/src/index.ts -n
```

**Invariant check:** All new public types reachable via `import { IssueCandidateLinkUseCase, IssueCandidateLinkOutput } from "@repo/application";`.

---

### Step 4 — Application: unit tests for the new use case

**File:** `packages/application/src/use-cases/interview/issue-candidate-link.use-case.test.ts` (CREATE)

**What:** Vitest suite covering (1) success in `SCHEDULED`, (2) success in `IN_PROGRESS`, (3) `InterviewNotFoundError` when repo returns `None`, (4) `InvalidInterviewStateTransitionError` for `CREATED` / `COMPLETED` / `EVALUATED` / `CANCELLED`, (5) `ServiceUnknownError` when repo returns `Err`. Follow the mock pattern from `get-interview-by-id.use-case.test.ts` — `makeInterview()` + `makeRepo({ findById })`.

**Code:** (test outline — fill in fixtures using `makeInterview()` helper analogous to `get-interview-by-id.use-case.test.ts`)
```typescript
import { Option, Result } from "@carbonteq/fp";
import {
  INTERVIEW_STATUS,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { IssueCandidateLinkUseCase } from "./issue-candidate-link.use-case.js";

const makeRepo = (overrides: Partial<IInterviewRepository>): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

describe("IssueCandidateLinkUseCase", () => {
  it("succeeds when status is SCHEDULED", async () => { /* ... */ });
  it("succeeds when status is IN_PROGRESS", async () => { /* ... */ });
  it("returns InterviewNotFoundError when not found", async () => { /* ... */ });
  it.each([
    INTERVIEW_STATUS.CREATED,
    INTERVIEW_STATUS.COMPLETED,
    INTERVIEW_STATUS.EVALUATED,
    INTERVIEW_STATUS.CANCELLED,
  ])("returns InvalidInterviewStateTransitionError for %s", async (status) => { /* ... */ });
  it("maps repository errors at the boundary", async () => { /* ... */ });
});
```

**Invariant check:** Tests mock only the repository boundary; no infrastructure imports.

---

### Step 5 — Presentation: extend `RecruiterInterviewControllerDeps`

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (MODIFY)

**What:** Add a typed slot for the new use case alongside the existing entries.

**Code:**
```typescript
import type {
  CreateInterviewOutput,
  EvaluateInterviewOutput,
  GenerateInterviewPlanOutput,
  GetInterviewByIdOutput,
  IssueCandidateLinkOutput,           // <-- add
  ListInterviewsByRecruiterOutput,
  ServiceError,
} from "@repo/application";

// ...

export interface RecruiterInterviewControllerDeps {
  readonly createInterviewUseCase: UseCaseLike<unknown, CreateInterviewOutput>;
  readonly listInterviewsUseCase: UseCaseLike<
    { readonly recruiterId: string },
    ListInterviewsByRecruiterOutput
  >;
  readonly getInterviewByIdUseCase: UseCaseLike<
    { readonly interviewId: string },
    GetInterviewByIdOutput
  >;
  readonly generatePlanUseCase: UseCaseLike<unknown, GenerateInterviewPlanOutput>;
  readonly evaluateInterviewUseCase: UseCaseLike<unknown, EvaluateInterviewOutput>;
  readonly getReportByInterviewIdUseCase: UseCaseLike<
    unknown,
    { readonly report: ReportOptionLike }
  >;
  readonly issueCandidateLinkUseCase: UseCaseLike<       // <-- add
    { readonly interviewId: string },
    IssueCandidateLinkOutput
  >;
  readonly candidateLink: CandidateLinkIssuer;
  readonly publicBaseUrl: string;
}
```

**Invariant check:** Presentation only types depend on `@repo/application` types; no infra leak.

---

### Step 6 — Presentation: controller method `issueCandidateLink`

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (MODIFY — add method)

**What:** New method that follows the same shape as `generatePlan`: ownership check via `getOwnedInterview`, then use case, then token + URL minting in the controller. Body is ignored (no DTO).

**Code:**
```typescript
async issueCandidateLink(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const owned = await this.getOwnedInterview(
    req.params.id,
    req.session!.userId,
    reply,
  );
  if (!owned) return;

  const result = await this.deps.issueCandidateLinkUseCase.execute({
    interviewId: req.params.id,
  });
  if (result.isErr()) {
    sendError(reply, result.unwrapErr());
    return;
  }

  const token = this.deps.candidateLink.issue(req.params.id);
  const candidateUrl = new URL(
    `/interviews/${req.params.id}/session`,
    this.deps.publicBaseUrl,
  );
  candidateUrl.searchParams.set("token", token);

  await reply.code(200).send({
    url: candidateUrl.toString(),
    token,
    expiresInSeconds: this.deps.candidateLink.defaultTtlSeconds,
  });
}
```

**Invariant check:**
- Ownership check happens in presentation (returns 404 on mismatch per ADR-019).
- `ServiceError` is mapped to HTTP via `sendError` → `mapServiceErrorToHttp`.
- Response shape matches the spec: `{ url, token, expiresInSeconds }`.
- No domain types leak — only `req.params.id` (a string) passes through.

---

### Step 7 — Presentation: register the route

**File:** `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts` (MODIFY)

**What:** Register `POST /interviews/:id/candidate-link` behind `requireRecruiter`.

**Code:**
```typescript
app.post<{ Params: { id: string } }>(
  "/interviews/:id/candidate-link",
  { preHandler: requireRecruiter },
  (req, reply) => controller.issueCandidateLink(req, reply),
);
```

**Invariant check:** `requireRecruiter` already handles 401 (no session) and 403 (non-recruiter). Ownership 404 is handled by the controller. Status-gate 409 is handled by the use case via `InvalidInterviewStateTransitionError`.

---

### Step 8 — Composition: wire the new use case

**File:** `apps/backend/src/composition/recruiter-interview.composition.ts` (MODIFY)

**What:** Construct `IssueCandidateLinkUseCase` using the existing `interviews` repo and include it in the returned deps object.

**Code:**
```typescript
import {
  CreateInterviewUseCase,
  EvaluateInterviewUseCase,
  GenerateInterviewPlanUseCase,
  GetInterviewByIdUseCase,
  GetReportByInterviewIdUseCase,
  IssueCandidateLinkUseCase,         // <-- add
  ListInterviewsByRecruiterUseCase,
} from "@repo/application";

// ... inside buildRecruiterInterviewDeps:

return {
  createInterviewUseCase: new CreateInterviewUseCase(interviews),
  listInterviewsUseCase: new ListInterviewsByRecruiterUseCase(interviews),
  getInterviewByIdUseCase: new GetInterviewByIdUseCase(interviews),
  generatePlanUseCase: new GenerateInterviewPlanUseCase(
    interviews,
    new GeminiInterviewPlannerService(geminiHandle, promptClient),
  ),
  evaluateInterviewUseCase: new EvaluateInterviewUseCase({
    interviews,
    reports,
    evaluator: new GeminiInterviewEvaluatorService(geminiHandle, promptClient),
  }),
  getReportByInterviewIdUseCase: new GetReportByInterviewIdUseCase(reports),
  issueCandidateLinkUseCase: new IssueCandidateLinkUseCase(interviews),   // <-- add
  candidateLink: options.candidateLink,
  publicBaseUrl:
    env["CANDIDATE_PUBLIC_BASE_URL"] ?? env["BETTER_AUTH_URL"] ?? "http://localhost:3000",
};
```

**Invariant check:** Composition is the only place where application + infrastructure meet; controller deps are now type-complete.

---

### Step 9 — Presentation: controller tests

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts` (MODIFY)

**What:** Add a `describe("issueCandidateLink")` block with cases:
- **200:** session present, ownership ok, use case returns Ok → assert response body `{ url, token, expiresInSeconds }` and that `candidateLink.issue` was called with the interview id; assert the URL contains `/interviews/<id>/session?token=...`.
- **404 (not found):** use case returns `InterviewNotFoundError`.
- **404 (not owned):** `getInterviewByIdUseCase` returns an interview owned by a different recruiter → `assertRecruiterOwnsInterview` returns `InterviewNotFoundError`.
- **409 (bad status):** use case returns `InvalidInterviewStateTransitionError` → response status 409, body code `INVALID_INTERVIEW_STATE_TRANSITION`.

**Code:** (mock pattern mirrors existing `generatePlan` tests; use `vi.fn()` stubs for both `getInterviewByIdUseCase.execute` and `issueCandidateLinkUseCase.execute`).

**Invariant check:** Tests assert the controller's HTTP contract; no real fetch or DB. The 401 path is covered by the existing `auth-plugin.test.ts` since `requireRecruiter` is applied uniformly.

---

### Step 10 — Verify `INTERVIEW_STATUS` and `InvalidInterviewStateTransitionError` are exported from `@repo/domain`

**File:** `packages/domain/src/index.ts` (READ — no change expected)

**What:** Confirm the package root re-exports `INTERVIEW_STATUS`, `InterviewStatus`, `InterviewNotFoundError`, `InvalidInterviewStateTransitionError`, and `IInterviewRepository`. The existing `GenerateInterviewPlanUseCase` already imports `InterviewNotFoundError` and the entity already imports `InvalidInterviewStateTransitionError` from the same module, so the exports almost certainly exist; if `INTERVIEW_STATUS` is not at the package root, add a re-export.

**Verification command:**
```bash
rg "INTERVIEW_STATUS|InvalidInterviewStateTransitionError|InterviewStatus" \
  /home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/index.ts -n
```

**Invariant check:** Application layer must import these names from `@repo/domain`, not deep paths.

---

## Pseudo-workflow

1. `POST /interviews/:id/candidate-link` arrives at Fastify.
2. `requireRecruiter` preHandler validates session → 401 if no session, 403 if role is not recruiter; otherwise attaches `req.session`.
3. Route handler delegates to `RecruiterInterviewController.issueCandidateLink(req, reply)`.
4. Controller calls `getOwnedInterview(id, session.userId, reply)`:
   a. Invokes `getInterviewByIdUseCase.execute({ interviewId })` → `Promise<Result<GetInterviewByIdOutput, ServiceError>>`.
   b. If `Err`, `sendError(reply, err)` (404 for `InterviewNotFoundError`, 500 otherwise) and returns `null`.
   c. Calls `assertRecruiterOwnsInterview(interview, recruiterId)` → returns `InterviewNotFoundError` if mismatch (404 per ADR-019).
5. Controller calls `issueCandidateLinkUseCase.execute({ interviewId })`:
   a. Use case calls `interviews.findById(id)` → `Promise<Result<Option<Interview>, Error>>`.
   b. On repo `Err` → wrap in `ServiceUnknownError`.
   c. On `None` → `Result.Err(new InterviewNotFoundError(id))`.
   d. On `Some(interview)`, check `interview.status ∈ { SCHEDULED, IN_PROGRESS }` — otherwise `Result.Err(new InvalidInterviewStateTransitionError(status, SCHEDULED))`.
   e. Return `Result.Ok({ interviewId, status })`.
6. Controller maps any `ServiceError` to HTTP via `sendError → mapServiceErrorToHttp → STATUS_BY_CODE`:
   - `INTERVIEW_NOT_FOUND` → 404
   - `INVALID_INTERVIEW_STATE_TRANSITION` → 409
7. On success, controller calls `candidateLink.issue(id)` (returns a 7-day HMAC token string).
8. Controller builds `new URL("/interviews/<id>/session", publicBaseUrl)` and appends `?token=<token>`.
9. Controller sends `200 { url, token, expiresInSeconds: candidateLink.defaultTtlSeconds }`.

---

## Entry points

| #  | File                                                                                       | Package/Layer      | Operation | Purpose                                                          |
| -- | ------------------------------------------------------------------------------------------ | ------------------ | --------- | ---------------------------------------------------------------- |
| 1  | `packages/application/src/use-cases/interview/issue-candidate-link.use-case.ts`            | @repo/application  | CREATE    | New `IssueCandidateLinkUseCase`                                  |
| 2  | `packages/application/src/use-cases/interview/issue-candidate-link.use-case.test.ts`       | @repo/application  | CREATE    | Unit tests for the new use case                                  |
| 3  | `packages/application/src/use-cases/interview/index.ts`                                    | @repo/application  | MODIFY    | Export new use case + DTO types                                  |
| 4  | `packages/application/src/index.ts`                                                        | @repo/application  | VERIFY    | Confirm root barrel re-exports the interview sub-barrel          |
| 5  | `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`              | apps/backend (pres) | MODIFY    | Add `issueCandidateLinkUseCase` slot + `issueCandidateLink()`    |
| 6  | `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts`         | apps/backend (pres) | MODIFY    | Tests for the new controller method                              |
| 7  | `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts`                      | apps/backend (pres) | MODIFY    | Register `POST /interviews/:id/candidate-link`                   |
| 8  | `apps/backend/src/composition/recruiter-interview.composition.ts`                          | apps/backend (comp) | MODIFY    | Construct and wire `IssueCandidateLinkUseCase`                   |

No domain changes. No infrastructure changes. No new ports.

---

## Verification commands

Run in order after implementation:

```bash
# Confirm INTERVIEW_STATUS is exported at the domain package root (one-off sanity)
rg "INTERVIEW_STATUS|InvalidInterviewStateTransitionError" \
  /home/raafayk7_cteq/Documents/Experiments/ai-interviewer-agent/packages/domain/src/index.ts -n

# Type-check all backend packages
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Application unit tests (new use-case suite must pass)
pnpm turbo run test --filter=@repo/application

# Backend tests (controller + composition coverage)
pnpm turbo run test --filter=backend

# Full backend suite at once
pnpm turbo run test --filter=@repo/domain --filter=@repo/application --filter=backend
```

After all verification passes, run `/backend-arch-validator presentation` and `/backend-arch-validator application`, then invoke `backend-code-reviewer` with this plan path and the file list in §Entry points.

---

## Risk notes

1. **Status-gate error semantics.** Reusing `InvalidInterviewStateTransitionError` is correct from an HTTP-mapping perspective (409 is the right code for "not in a state that allows this") but the constructor takes `(from, to)` where `to` describes the *target transition*. There is no actual transition happening here, so we pass `SCHEDULED` as a conceptual "joinable-state" sentinel. The error message will read `Cannot transition Interview from COMPLETED to SCHEDULED` — slightly misleading. **Mitigation:** acceptable since the response code (`INVALID_INTERVIEW_STATE_TRANSITION`) is the contract, not the prose. If a clearer message is desired, a new `InterviewNotJoinableError extends BusinessRuleViolationError` could be added later with its own code + STATUS_BY_CODE entry — explicitly out of scope here to keep the change small.

2. **CANCELLED handling.** A cancelled interview is a terminal state. The current gate correctly rejects it with 409. Make sure tests cover `CANCELLED` alongside `COMPLETED` / `EVALUATED` so a future code reader sees the intent.

3. **`INTERVIEW_STATUS` availability at the `@repo/domain` root.** The aggregate sub-barrel re-exports it, but the package root must also re-export it for the application layer to import `INTERVIEW_STATUS` from `@repo/domain`. If it is not at the root, add a re-export in `packages/domain/src/index.ts` as part of Step 10. Skipping this surfaces as a TypeScript "has no exported member" error in CI.

4. **No DTO on the new endpoint.** The body is unused. Do not call `BaseDto.validate` on `req.body` — just ignore it. Adding an empty Zod schema is unnecessary and would only widen the test surface.

5. **Token freshness vs. idempotency.** Each call mints a fresh token (different `exp`, different signature). Recruiters who refresh repeatedly will accumulate live tokens until each one's individual 7-day TTL expires. This is by design for the stateless HMAC model (no revocation list in P7); a follow-up ADR may add token versioning if revocation is needed.

6. **No persistence side effect.** This use case does not call `interviews.save`. Reviewers should confirm no test accidentally asserts that `save` was called.

7. **Composition root coupling.** `recruiter-interview.composition.ts` is the only place that instantiates the use case. Forgetting to wire it there will compile cleanly (the controller deps interface is structural) but throw at runtime when the controller is constructed without the slot. The controller's unit tests should fail first, but make sure the composition is updated before running E2E.
