# Plan: Phase 9 Backend Prep — Candidate Interview View Endpoint + Link URL Update

> Generated: 2026-05-17
> Slug: phase-9-backend-prep

## Summary

Adds a public (unauthenticated) `GET /interviews/:id/candidate-view?token=<base64url>` endpoint that lets a candidate fetch a minimal projection of their interview after presenting a valid HMAC-signed token. The endpoint is auth-gated only by the existing `CandidateSignedLink.verify` + interviewId binding (no `requireRecruiter`). Adds a new `GetCandidateInterviewViewUseCase` in `@repo/application` that loads the interview by id and returns the trimmed view DTO. Also updates `buildCandidateLink` in `RecruiterInterviewController` so the recruiter-issued candidate URL points at the new frontend route `/c/:id` (the candidate-facing landing page introduced in Phase 9) instead of the legacy `/interviews/:id/session` WebSocket-bound URL.

Token verification continues to live in the presentation layer — the use case only takes `{ interviewId }`. The existing `INVALID_CANDIDATE_TOKEN` (HTTP 401) and `INTERVIEW_NOT_FOUND` (HTTP 404) codes are already wired in `http-error-mapper.ts`, so no new HTTP code mappings are required.

## Layers touched

| Layer          | Package / Location                  | Scope                                                                 |
| -------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Domain         | `packages/domain/`                  | none                                                                  |
| Application    | `packages/application/`             | `GetCandidateInterviewViewUseCase` + barrel exports                   |
| Infrastructure | `apps/backend/src/infrastructure/`  | none (reuses `DrizzleInterviewRepository`, `CandidateSignedLink`)     |
| Presentation   | `apps/backend/src/presentation/`    | New `CandidateInterviewController` + `candidate-interviews.routes.ts`; URL change in `RecruiterInterviewController.buildCandidateLink`; new composition `candidate-interview.composition.ts`; `app.ts` registration; existing controller test URL assertions updated |

## Implementation steps

### Step 1 — Application: `GetCandidateInterviewViewUseCase`

**File:** `packages/application/src/use-cases/interview/get-candidate-interview-view.use-case.ts` (CREATE)

**What:** A use case that loads an `Interview` by id and projects it into the minimal candidate-facing view. Mirrors `GetInterviewByIdUseCase` for error translation; differs by returning a projected DTO instead of the full `InterviewSerialized`.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError,
  type IInterviewRepository,
  type InterviewStatus,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface GetCandidateInterviewViewInput {
  readonly interviewId: string;
}

export interface CandidateInterviewView {
  readonly interviewId: string;
  readonly candidateName: string;
  readonly jobTitle: string;
  readonly company: string;
  readonly scheduledAt: string; // ISO-8601
  readonly targetDurationMinutes: number | null;
  readonly status: InterviewStatus;
}

export interface GetCandidateInterviewViewOutput {
  readonly view: CandidateInterviewView;
}

export class GetCandidateInterviewViewUseCase extends UseCase<
  GetCandidateInterviewViewInput,
  GetCandidateInterviewViewOutput
> {
  constructor(private readonly interviews: IInterviewRepository) {
    super();
  }

  async execute(
    input: GetCandidateInterviewViewInput,
  ): Promise<Result<GetCandidateInterviewViewOutput, ServiceError>> {
    const interviewResult = await this.interviews.findById(input.interviewId);
    if (interviewResult.isErr()) {
      return Result.Err(
        new ServiceUnknownError(
          interviewResult.unwrapErr().message,
          "InterviewRepository.findById",
        ),
      );
    }

    return interviewResult.unwrap().match({
      Some: (interview) =>
        Result.Ok({
          view: {
            interviewId: interview.id,
            candidateName: interview.candidateInfo.fullName,
            jobTitle: interview.jobDescription.title,
            company: interview.jobDescription.company,
            scheduledAt: interview.scheduledAt.toISOString(),
            targetDurationMinutes: interview.interviewPlan.match({
              Some: (plan) => plan.targetDurationMinutes,
              None: () => null,
            }),
            status: interview.status,
          },
        }),
      None: () =>
        Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
    });
  }
}
```

**Invariant check:**
- No `throw` / `try/catch` / `T | null` in control flow — uses `Result` and `Option.match`.
- Repository error translated at the application boundary to `ServiceUnknownError`.
- `Option<InterviewPlan>` collapsed into `number | null` only at the projection boundary (DTO is wire-shape, not domain-shape).
- No import from infrastructure or presentation.

---

### Step 2 — Application: export the use case

**File:** `packages/application/src/use-cases/interview/index.ts` (MODIFY)

**What:** Add named exports for the new use case and its DTO types so the backend composition layer can import them via `@repo/application`.

**Code (append to existing barrel):**
```typescript
export {
  GetCandidateInterviewViewUseCase,
  type GetCandidateInterviewViewInput,
  type GetCandidateInterviewViewOutput,
  type CandidateInterviewView,
} from "./get-candidate-interview-view.use-case.js";
```

**Invariant check:** New public types are exported from the package barrel so downstream packages can import them.

---

### Step 3 — Application: top-level barrel passthrough

**File:** `packages/application/src/index.ts` (no change required)

**What:** Verify only — `packages/application/src/index.ts` already does `export * from "./use-cases/index.js";` and `packages/application/src/use-cases/index.ts` re-exports the `interview/` subdirectory. No edit needed, but confirm by ripgrep before declaring done.

**Verification command (run during implementation):**
```bash
rg "GetCandidateInterviewViewUseCase" packages/application/src/index.ts \
   packages/application/src/use-cases/index.ts
```

If `use-cases/index.ts` does NOT use `export *` from `interview/index.js`, also append:
```typescript
export * from "./interview/index.js";
```

**Invariant check:** Public types reachable via `@repo/application` import.

---

### Step 4 — Presentation: `CandidateInterviewController`

**File:** `apps/backend/src/presentation/controllers/candidate-interview.controller.ts` (CREATE)

**What:** Controller exposes one method `getView(req, reply)` that performs token presence + verification + interviewId binding, then delegates to `GetCandidateInterviewViewUseCase`. Errors are funneled through the existing `mapServiceErrorToHttp` mapper. No session is required, no `requireRecruiter` preHandler.

**Code:**
```typescript
import type { Result } from "@carbonteq/fp";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  InvalidCandidateTokenError,
  type GetCandidateInterviewViewOutput,
  type ServiceError,
} from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

export interface UseCaseLike<I, O> {
  execute(input: I): Promise<Result<O, ServiceError>>;
}

export interface CandidateLinkVerifier {
  verify(token: string): Result<{ readonly interviewId: string }, ServiceError>;
}

export interface CandidateInterviewControllerDeps {
  readonly getCandidateInterviewViewUseCase: UseCaseLike<
    { readonly interviewId: string },
    GetCandidateInterviewViewOutput
  >;
  readonly candidateLink: CandidateLinkVerifier;
}

export class CandidateInterviewController {
  constructor(private readonly deps: CandidateInterviewControllerDeps) {}

  async getView(
    req: FastifyRequest<{
      Params: { id: string };
      Querystring: { token?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const token = req.query.token;
    if (!token) {
      sendError(reply, new InvalidCandidateTokenError("Candidate token is required"));
      return;
    }

    const verifyResult = this.deps.candidateLink.verify(token);
    if (verifyResult.isErr()) {
      sendError(reply, verifyResult.unwrapErr());
      return;
    }

    if (verifyResult.unwrap().interviewId !== req.params.id) {
      sendError(
        reply,
        new InvalidCandidateTokenError("Candidate token does not match interview"),
      );
      return;
    }

    const result = await this.deps.getCandidateInterviewViewUseCase.execute({
      interviewId: req.params.id,
    });
    if (result.isErr()) {
      sendError(reply, result.unwrapErr());
      return;
    }

    await reply.code(200).send(result.unwrap().view);
  }
}

function sendError(reply: FastifyReply, error: ServiceError): void {
  const { status, body } = mapServiceErrorToHttp(error);
  reply.code(status).send(body);
}
```

**Invariant check:**
- Imports only `@repo/application` (no `@repo/domain` types needed here, no `apps/backend/src/infrastructure/...` import).
- All branches funnel through `mapServiceErrorToHttp` — never inline HTTP status codes for known service errors.
- No `throw`, no `try/catch`.
- `CandidateLinkVerifier` is a structural interface; it matches `CandidateSignedLink.verify` since `InvalidCandidateTokenError` is a `ServiceError`.

---

### Step 5 — Presentation: candidate routes plugin

**File:** `apps/backend/src/presentation/routes/candidate-interviews.routes.ts` (CREATE)

**What:** Fastify plugin that registers `GET /interviews/:id/candidate-view` with NO preHandler (public, token-in-querystring auth). Follows the same shape as `recruiter-interviews.routes.ts`.

**Code:**
```typescript
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  CandidateInterviewController,
  type CandidateInterviewControllerDeps,
} from "../controllers/candidate-interview.controller.js";

export interface RegisterCandidateInterviewRoutesOptions {
  readonly deps: CandidateInterviewControllerDeps;
}

export const registerCandidateInterviewRoutes: FastifyPluginAsync<
  RegisterCandidateInterviewRoutesOptions
> = async (
  app: FastifyInstance,
  options: RegisterCandidateInterviewRoutesOptions,
): Promise<void> => {
  const controller = new CandidateInterviewController(options.deps);

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/interviews/:id/candidate-view",
    (req, reply) => controller.getView(req, reply),
  );
};
```

**Invariant check:**
- No `preHandler: requireRecruiter` — endpoint is public by design.
- Route path is on the recruiter prefix root (`""`) so it sits at `/interviews/:id/candidate-view`, NOT under `/interviews` prefix (which is reserved for the WS route).

---

### Step 6 — Composition: `candidate-interview.composition.ts`

**File:** `apps/backend/src/composition/candidate-interview.composition.ts` (CREATE)

**What:** Wires `DrizzleInterviewRepository` + `CandidateSignedLink` + `GetCandidateInterviewViewUseCase` into a `CandidateInterviewControllerDeps`. Mirrors `recruiter-interview.composition.ts` in style.

**Code:**
```typescript
import { createRequire } from "node:module";
import { GetCandidateInterviewViewUseCase } from "@repo/application";
import type { Database } from "../infrastructure/persistence/db.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/index.js";
import type {
  CandidateInterviewControllerDeps,
  CandidateLinkVerifier,
} from "../presentation/controllers/candidate-interview.controller.js";

const require = createRequire(import.meta.url);

export interface CandidateInterviewCompositionOptions {
  readonly candidateLink: CandidateLinkVerifier;
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildCandidateInterviewDeps(
  options: CandidateInterviewCompositionOptions,
): CandidateInterviewControllerDeps {
  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const interviews = new DrizzleInterviewRepository(db);

  return {
    getCandidateInterviewViewUseCase: new GetCandidateInterviewViewUseCase(interviews),
    candidateLink: options.candidateLink,
  };
}
```

**Invariant check:**
- Imports `@repo/application` + `apps/backend/src/infrastructure/...` only (composition root, allowed).
- No presentation→infrastructure path crossing inside the controller — the composition root is the only place these layers meet.

---

### Step 7 — App registration

**File:** `apps/backend/src/app.ts` (MODIFY)

**What:** Add `candidateInterviews` to `BuildAppOptions`, register the route plugin, and lazy-build defaults via the new composition.

**Code (additions):**

```typescript
// 1. Add to imports
import {
  registerCandidateInterviewRoutes,
  type RegisterCandidateInterviewRoutesOptions,
} from "./presentation/routes/candidate-interviews.routes.js";
```

```typescript
// 2. Extend BuildAppOptions
export interface BuildAppOptions {
  readonly authDeps?: AuthDeps;
  readonly interviewSession?: RegisterInterviewSessionRouteOptions;
  readonly recruiterInterviews?: RegisterRecruiterInterviewRoutesOptions;
  readonly recruiterDocuments?: RegisterRecruiterDocumentRoutesOptions;
  readonly candidateInterviews?: RegisterCandidateInterviewRoutesOptions;
}
```

```typescript
// 3. Update composeDefaults gate
const composeDefaults =
  !options.authDeps &&
  !options.interviewSession &&
  !options.recruiterInterviews &&
  !options.recruiterDocuments &&
  !options.candidateInterviews;
```

```typescript
// 4. Register after recruiterDocuments block, before interviewSessionOptions
const candidateInterviews =
  options.candidateInterviews ??
  (composeDefaults && authDeps?.candidateLink
    ? {
        deps: (await import(
          "./composition/candidate-interview.composition.js"
        )).buildCandidateInterviewDeps({
          candidateLink: authDeps.candidateLink,
        }),
      }
    : undefined);

if (candidateInterviews) {
  await app.register(registerCandidateInterviewRoutes, {
    prefix: "",
    ...candidateInterviews,
  });
}
```

**Invariant check:**
- `prefix: ""` so the route resolves to `/interviews/:id/candidate-view` (NOT under `/interviews` prefix used by the WS route).
- Default composition only activates when `composeDefaults` is true AND `authDeps.candidateLink` exists, mirroring the pattern used for `recruiterInterviews`.

---

### Step 8 — Recruiter controller: URL change in `buildCandidateLink`

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (MODIFY)

**What:** Change the candidate URL path from `/interviews/${interviewId}/session` to `/c/${interviewId}`.

**Code (only the changed line in `private buildCandidateLink`):**
```typescript
// before:
const url = new URL(`/interviews/${interviewId}/session`, this.deps.publicBaseUrl);
// after:
const url = new URL(`/c/${interviewId}`, this.deps.publicBaseUrl);
```

**Invariant check:** Pure string change — does not touch token issuance, TTL, or response shape. The token query param is still appended via `url.searchParams.set("token", token)`.

---

### Step 9 — Recruiter controller test: assertions update

**File:** `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts` (MODIFY)

**What:** The test currently asserts `body.candidateLink.url.toContain(INTERVIEW_ID)` and `toContain("token=")`. Those assertions remain true after the change. Tighten them so the test pins the new URL shape (`/c/<id>`) and rejects accidental regression to `/session`.

**Edits:**

1. In the `POST /interviews/:id/plan` happy-path test (around line 386–402), after the existing assertions, add:
```typescript
expect(body.candidateLink.url).toContain(`/c/${INTERVIEW_ID}`);
expect(body.candidateLink.url).not.toContain("/session");
```

2. In the `POST /interviews/:id/candidate-link` happy-path test (around line 579–595), after the existing `toContain(INTERVIEW_ID)` assertion, add:
```typescript
expect(body.url).toContain(`/c/${INTERVIEW_ID}`);
expect(body.url).not.toContain("/session");
```

**Invariant check:**
- No new spies or mocks introduced — test uses the existing `candidateLink.issue` mock returning `"token-abc"`.
- Negative assertion (`not.toContain("/session")`) guards against future regression.

---

## Pseudo-workflow

**Request flow for `GET /interviews/:id/candidate-view?token=<base64url>`:**

1. HTTP request arrives at Fastify; matched by `registerCandidateInterviewRoutes` → `CandidateInterviewController.getView(req, reply)`.
2. Controller reads `req.query.token`. Missing → `sendError(reply, new InvalidCandidateTokenError("Candidate token is required"))` → mapper emits 401 `INVALID_CANDIDATE_TOKEN`.
3. Controller calls `this.deps.candidateLink.verify(token)` (= `CandidateSignedLink.verify`). On `Err` → `sendError` with the `InvalidCandidateTokenError` → 401.
4. Controller checks `verifyResult.unwrap().interviewId === req.params.id`. Mismatch → 401 `INVALID_CANDIDATE_TOKEN`.
5. Controller calls `this.deps.getCandidateInterviewViewUseCase.execute({ interviewId: req.params.id })`.
6. Use case calls `this.interviews.findById(interviewId)` → `Promise<Result<Option<Interview>, Error>>`.
7. Use case maps repository `Err` → `ServiceUnknownError("...", "InterviewRepository.findById")` at the boundary.
8. Use case matches `Option`: `None` → `Result.Err(new InterviewNotFoundError(id))` → mapper emits 404 `INTERVIEW_NOT_FOUND`. `Some(interview)` → projects to `CandidateInterviewView` shape.
9. Use case returns `Result.Ok({ view })`.
10. Controller sends `reply.code(200).send(result.unwrap().view)` — the JSON body matches the spec exactly (`interviewId`, `candidateName`, `jobTitle`, `company`, `scheduledAt` ISO string, `targetDurationMinutes` number-or-null, `status`).

**Request flow for `POST /interviews/:id/plan` and `POST /interviews/:id/candidate-link` (URL change only):**

The flow is unchanged. `buildCandidateLink(interviewId)` now produces a URL of the form `https://app.example.com/c/<id>?token=<token>` instead of `https://app.example.com/interviews/<id>/session?token=<token>`.

## Entry points

| #   | File                                                                                            | Package/Layer       | Operation | Purpose                                                                |
| --- | ----------------------------------------------------------------------------------------------- | ------------------- | --------- | ---------------------------------------------------------------------- |
| 1   | `packages/application/src/use-cases/interview/get-candidate-interview-view.use-case.ts`         | @repo/application   | CREATE    | New use case that projects an `Interview` into the candidate view DTO  |
| 2   | `packages/application/src/use-cases/interview/index.ts`                                         | @repo/application   | MODIFY    | Export the new use case + its input/output/view types                  |
| 3   | `packages/application/src/use-cases/index.ts`                                                   | @repo/application   | VERIFY    | Confirm `export * from "./interview/index.js";` already exists; add if not |
| 4   | `apps/backend/src/presentation/controllers/candidate-interview.controller.ts`                   | backend/presentation | CREATE   | Public-facing controller; token verify + interviewId binding + use case dispatch |
| 5   | `apps/backend/src/presentation/routes/candidate-interviews.routes.ts`                           | backend/presentation | CREATE   | Fastify plugin: `GET /interviews/:id/candidate-view` with NO preHandler |
| 6   | `apps/backend/src/composition/candidate-interview.composition.ts`                               | backend/composition | CREATE    | Compose Drizzle repo + signed-link verifier + use case                  |
| 7   | `apps/backend/src/app.ts`                                                                       | backend/composition | MODIFY    | Add `candidateInterviews` to `BuildAppOptions`; register route plugin   |
| 8   | `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`                   | backend/presentation | MODIFY   | Change `buildCandidateLink` URL path from `/interviews/<id>/session` to `/c/<id>` |
| 9   | `apps/backend/src/presentation/controllers/recruiter-interview.controller.test.ts`              | backend/presentation | MODIFY   | Add `toContain("/c/<id>")` and `not.toContain("/session")` assertions   |

## Verification commands

Run these in order after implementation:

```bash
# 1. Type-check everything
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# 2. Application unit tests (new use case will be covered by /backend-test-suite)
pnpm turbo run test --filter=@repo/application

# 3. Backend integration tests (controller test assertions updated)
pnpm turbo run test --filter=backend
```

After type-check + tests are green, invoke `/backend-test-suite` for the new use case + controller, then `backend-code-reviewer` over the full file list above.

## Risk notes

1. **Public endpoint exposure** — this is the first non-auth-gated REST route in the codebase (the existing public surface is the WS upgrade only). Double-check `prefix: ""` so it does not accidentally inherit the `/interviews` prefix used for the WS route (which would produce `/interviews/interviews/:id/candidate-view`). The WS route is registered with `prefix: "/interviews"` at line 127 of `app.ts`; the new route MUST use `prefix: ""` like `recruiterInterviews` and `recruiterDocuments`.

2. **Route collision** — `GET /interviews/:id/candidate-view` shares the `/interviews/:id/...` namespace with recruiter routes. Fastify's radix tree distinguishes by suffix, but ordering of plugin registration matters if both define `/interviews/:id` at the bare params level (they don't here). Smoke test by running both an authenticated `GET /interviews/<id>` and unauthenticated `GET /interviews/<id>/candidate-view?token=...` in the same app instance during the controller test.

3. **InvalidCandidateTokenError already exported** — confirmed at `packages/application/src/core/index.ts:6`. No new export needed.

4. **`status` typing** — the DTO declares `status` as a string union literal type. Returning `interview.status` directly is correct because `InterviewStatus` is the same string union (`"CREATED" | "SCHEDULED" | ...`) from `@repo/domain`. Import `InterviewStatus` as a type from `@repo/domain` (it's already exported from the domain barrel).

5. **`scheduledAt.toISOString()`** — the entity stores `scheduledAt: Date`. JSON serialisation via Fastify's default serialiser would also produce an ISO string, but emitting it explicitly in the use case keeps the wire shape decoupled from Fastify's defaults and removes ambiguity for the frontend Zod schema.

6. **`targetDurationMinutes` projection** — `interview.interviewPlan` is `Option<InterviewPlan>`. The DTO field is `number | null`. The `Option.match` collapsing pattern here matches the existing pattern in `Interview.serialize()` (line 211–213 of `interview.entity.ts`) so it is idiomatic.

7. **`CandidateLinkVerifier` interface in the controller** — kept structural to allow the existing `CandidateSignedLink` instance to satisfy it without a cast. `CandidateSignedLink.verify` returns `Result<{ interviewId }, InvalidCandidateTokenError>`, and `InvalidCandidateTokenError extends ServiceInfraError` (i.e. is a `ServiceError`), so the assignment is type-safe.

8. **Frontend URL change is breaking** — any existing recruiter that opened a candidate link in flight before Phase 9 will land on `/c/<id>` which only exists in the new web build. Acceptable for pre-GA; not acceptable post-GA. Flag this in the Phase 9 progress doc.

9. **No new HTTP status code mappings required** — both `INVALID_CANDIDATE_TOKEN` (401) and `INTERVIEW_NOT_FOUND` (404) already live in `STATUS_BY_CODE` at lines 16 and 25 of `http-error-mapper.ts`. Do not duplicate them.

10. **Test scaffolding for the new controller** — `/backend-test-suite` will likely generate an integration test that calls `buildApp({ authDeps, candidateInterviews: { deps } })`. Confirm that `buildApp` does not require `recruiterInterviews` or `interviewSession` to be defined when `candidateInterviews` is the only opt-in — the existing `composeDefaults` gate already permits this because each block is independent.
