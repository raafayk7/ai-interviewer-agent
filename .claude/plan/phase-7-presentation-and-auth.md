# Plan: Phase 7 — REST Presentation Layer + Recruiter Auth + Candidate Signed Links

> Generated: 2026-05-12
> Slug: phase-7-presentation-and-auth
> Branch: `phase-7`
> Status: **All 10 open questions resolved** (2026-05-12). See "Resolved decisions" section at the end. No blockers to implementation.

## Summary

Phase 7 wraps every Phase 1–6 use case in HTTP so the backend becomes externally usable. It adds a recruiter authentication surface via `better-auth` (email + password only), introduces a DIY HMAC-signed candidate link helper to gate the existing WebSocket interview session, mounts REST routes for create / list / get / plan / evaluate / report / upload / extract, installs a single `setErrorHandler` that maps every `ServiceError` to an appropriate HTTP status, and adds composition roots for the four use cases that have none today. No Redis, no email, no OAuth, no frontend; recruiter copies the candidate link manually.

## Layers touched

| Layer          | Package / Location                              | Scope |
| -------------- | ----------------------------------------------- | ----- |
| Domain         | `packages/domain/`                              | None — no new entities or invariants. `recruiterId` remains opaque `text`. |
| Application    | `packages/application/`                         | New `InvalidCandidateTokenError` + `UnauthorizedError` + `ForbiddenError` service errors. New `IssueCandidateLinkPort` (optional — see Step 10 note). `CreateInterviewInput` schema: drop `recruiterId` from public input shape (split into runtime + public DTOs). |
| Infrastructure | `apps/backend/src/infrastructure/`              | better-auth instance + Drizzle adapter, new auth Drizzle schema + migration, `CandidateSignedLink` helper, env loader extensions. |
| Presentation   | `apps/backend/src/presentation/`                | Auth plugin (session decorator + `requireRecruiter`), HTTP error mapper, 3 route files + their controllers, `assertRecruiterOwnsInterview` helper, multipart support. |

## Skills the implementer must invoke (in order)

1. `backend-codebase-explorer` agent — already run (CONTEXT BLOCK above). Skip re-run.
2. `create-auth-skill` — scaffolds better-auth setup. **Ignore its UI page output.**
3. `better-auth-best-practices` — for server config (`betterAuth({...})`), Fastify integration, session helper shape.
4. `email-and-password-best-practices` — for password policy + hash config (use defaults).
5. `/backend-infrastructure-layer` — for `CandidateSignedLink`, auth adapter wiring, Drizzle migration.
6. `/backend-presentation-layer` — for every route/controller (recruiter-interviews, recruiter-documents, candidate-session WS guard) and the error mapper.
7. `/backend-arch-validator infrastructure` — after Step 7 (auth + signed link infra complete).
8. `/backend-arch-validator presentation` — after each presentation router added.
9. `/backend-test-suite` — for the test surface in Step 19.
10. `backend-code-reviewer` agent — final gate.

---

## Implementation steps

### Step 1 — Application: introduce auth-adjacent service errors

**File:** `packages/application/src/core/service-error.ts` (MODIFY)

**What:** Add three `ServiceInfraError` subclasses the presentation layer can map to 401/401/403. Keeping them in the application package — not infrastructure — because the candidate signed-link verify is called from a controller, and controllers must not import infrastructure error types directly.

**Code:**
```typescript
export class UnauthorizedError extends ServiceInfraError {
  readonly code = "UNAUTHORIZED";
  constructor(message: string = "Authentication required") {
    super(message);
  }
}

export class InvalidCandidateTokenError extends ServiceInfraError {
  readonly code = "INVALID_CANDIDATE_TOKEN";
  constructor(message: string = "Candidate link invalid or expired") {
    super(message);
  }
}

export class ForbiddenError extends ServiceInfraError {
  readonly code = "FORBIDDEN";
  constructor(message: string = "Not permitted") {
    super(message);
  }
}
```

**Invariant check:** ServiceError union remains `DomainError | ServiceInfraError`. No new outward import. Will surface through the existing barrel.

### Step 2 — Application: split `CreateInterviewInput` so `recruiterId` is not in the public DTO

**File:** `packages/application/src/dtos/create-interview.dto.ts` (MODIFY)

**What:** Remove `recruiterId` from `CreateInterviewInputSchema`. Add a separate `CreateInterviewExecuteInput` type the use case actually consumes, which the controller assembles by combining the validated public DTO with the session's `userId`. This prevents recruiter spoofing via request body and is the cleanest way to honour the CONTEXT BLOCK requirement.

**Code:**
```typescript
// Public (HTTP body) — no recruiterId
export const CreateInterviewInputSchema = z.object({
  jobDescription: JobDescriptionSchema,
  candidateInfo: CandidateInfoSchema,
  clientInstructions: z.string(),
  scheduledAt: z.coerce.date(),
  jdFileRef: FileRefSchema,
  cvFileRef: FileRefSchema,
});
export type CreateInterviewInput = z.infer<typeof CreateInterviewInputSchema>;

// What the use case executes against — assembled by controller, not by HTTP body
export interface CreateInterviewExecuteInput extends CreateInterviewInput {
  readonly recruiterId: string;
}
```

**Invariant check:** DTO still extends `BaseDto<T>` and uses `BaseDto.validate`. Use-case signature change is contained in Step 3.

### Step 3 — Application: update `CreateInterviewUseCase` signature to take `CreateInterviewExecuteInput`

**File:** `packages/application/src/use-cases/interview/create-interview.use-case.ts` (MODIFY)

**What:** Change generic from `CreateInterviewInput` to `CreateInterviewExecuteInput`. Body unchanged.

**Code:**
```typescript
export class CreateInterviewUseCase extends UseCase<
  CreateInterviewExecuteInput,
  CreateInterviewOutput
> {
  // unchanged body — input.recruiterId still resolves
}
```

**Invariant check:** All current callers of this use case live in tests; only test fixtures need an obvious 1-line update. No domain change.

### Step 4 — Application: barrel exports

**File:** `packages/application/src/index.ts` (MODIFY — implicit via existing re-exports)

**What:** Nothing new to add directly here — the new error classes and `CreateInterviewExecuteInput` flow out through `./core/index.js` and `./dtos/index.js`. Confirm `core/index.ts` and `dtos/index.ts` re-export. If `core/index.ts` does selective re-exports, add the three new error classes.

**Code:** N/A — confirm during implementation.

**Invariant check:** Every type used cross-package must be reachable from `@repo/application`.

### Step 5 — Infrastructure: install dependencies

**File:** `apps/backend/package.json` (MODIFY — via `pnpm add`)

**What:** Add `better-auth`, the Drizzle adapter (currently shipped inside `better-auth/adapters/drizzle` so no separate package), `@fastify/multipart` (for upload route), and (Node 22 already has `crypto`, no extra dep).

**Commands:**
```bash
pnpm --filter backend add better-auth @fastify/multipart
```

**Invariant check:** No new deps in `@repo/domain` or `@repo/application`. Auth-related code lives in `apps/backend/`.

### Step 6 — Infrastructure: better-auth config

**File:** `apps/backend/src/infrastructure/auth/auth.ts` (CREATE)

**What:** Construct the `betterAuth` instance. Use the Drizzle adapter against the existing `db` handle (lazy-loaded — preserves the OTel-init-first invariant from `main.ts`). Email + password only; no social, no 2FA, no orgs.

**Code skeleton:**
```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../persistence/db.js";
import * as schema from "../persistence/schema/index.js";

export interface AuthConfig {
  readonly secret: string;
  readonly baseUrl: string;
  readonly db: Database;
}

export function createAuth(config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // Defaults: min 8 chars, bcrypt-equivalent hashing. See email-and-password-best-practices.
    },
    // Explicitly disable everything else
    socialProviders: {},
    plugins: [],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
```

**Invariant check:** Imports only `@repo/domain` (none here), `@repo/application` (none here), and infra-internal modules. Reads no env directly — config injected.

### Step 7 — Infrastructure: candidate signed-link helper

**File:** `apps/backend/src/infrastructure/auth/candidate-signed-link.ts` (CREATE)

**What:** HMAC-SHA256 over `interviewId|exp` (base64url). Stdlib `crypto` only — do not add `jose`. The token is *not* persisted; it can be regenerated at any time from `(secret, interviewId, ttl)`. Verify returns `Result<{ interviewId }, InvalidCandidateTokenError>`.

**Code skeleton:**
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { InvalidCandidateTokenError } from "@repo/application";

export interface CandidateSignedLinkConfig {
  readonly secret: string;
  readonly defaultTtlSeconds: number;
}

export class CandidateSignedLink {
  constructor(private readonly config: CandidateSignedLinkConfig) {}

  issue(interviewId: string, ttlSeconds?: number): string {
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = `${interviewId}|${exp}`;
    const sig = createHmac("sha256", this.config.secret).update(payload).digest();
    return [
      Buffer.from(payload, "utf8").toString("base64url"),
      sig.toString("base64url"),
    ].join(".");
  }

  verify(token: string): Result<{ interviewId: string }, InvalidCandidateTokenError> {
    const parts = token.split(".");
    if (parts.length !== 2) return Result.Err(new InvalidCandidateTokenError("malformed"));
    const [payloadB64, sigB64] = parts as [string, string];

    let payload: string;
    let sig: Buffer;
    try {
      payload = Buffer.from(payloadB64, "base64url").toString("utf8");
      sig = Buffer.from(sigB64, "base64url");
    } catch {
      return Result.Err(new InvalidCandidateTokenError("malformed"));
    }

    const expected = createHmac("sha256", this.config.secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
      return Result.Err(new InvalidCandidateTokenError("signature mismatch"));
    }

    const [interviewId, expStr] = payload.split("|") as [string, string];
    const exp = Number.parseInt(expStr, 10);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      return Result.Err(new InvalidCandidateTokenError("expired"));
    }

    return Result.Ok({ interviewId });
  }
}

export function candidateSignedLinkFromEnv(
  env: NodeJS.ProcessEnv,
): Result<CandidateSignedLink, Error> {
  const secret = env["CANDIDATE_LINK_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(
      new Error("CANDIDATE_LINK_SECRET must be set (>= 32 chars)"),
    );
  }
  const ttlRaw = env["CANDIDATE_LINK_TTL_SECONDS"];
  const ttl = ttlRaw ? Number.parseInt(ttlRaw, 10) : 7 * 24 * 3600;
  return Result.Ok(new CandidateSignedLink({ secret, defaultTtlSeconds: ttl }));
}
```

**Invariant check:** Returns `Result` everywhere; no throws on bad token. The thrown `Error` in `candidateSignedLinkFromEnv` is the boot-boundary pattern matching `buildInterviewSessionDeps`. Imports `InvalidCandidateTokenError` from `@repo/application` — the application is the **owner** of the error type because controllers consume it without crossing into infrastructure.

### Step 8 — Infrastructure: Drizzle schema for better-auth tables

**File:** `apps/backend/src/infrastructure/persistence/schema/auth.ts` (CREATE)

**What:** Define the four better-auth tables (`users`, `sessions`, `accounts`, `verifications`) per better-auth's current Drizzle schema. **Authoritative source:** run `pnpm --filter backend exec better-auth generate --output ./auth-schema-preview.ts` (better-auth ships a generator). Then manually port the output into our schema convention (camelCase TS identifiers, snake_case column names — match the project's existing style as seen in `interviews.ts`).

**Code skeleton (will be replaced by generator output, kept here so reviewer can validate shape):**
```typescript
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});
```

**Then update** `apps/backend/src/infrastructure/persistence/schema/index.ts` to `export * from "./auth.js"`.

**Critical migration order:** Run the better-auth generator FIRST, then `pnpm --filter backend db:generate` to produce migration `0002_*.sql`. Do NOT hand-write the SQL — let drizzle-kit diff against the introspected DB and emit it.

**Invariant check:** No FK from `interviews.recruiter_id` to `users.id` — confirmed opaque-text decision (justified in ADR-7-AUTH).

### Step 9 — Infrastructure: produce migration `0002_phase7_auth.sql`

**File:** `apps/backend/drizzle/0002_<name>.sql` (CREATE via drizzle-kit)

**Commands:**
```bash
# Confirm DATABASE_URL points at the dev DB
pnpm --filter backend db:generate
# Inspect the produced SQL; commit verbatim
pnpm --filter backend db:migrate
```

**Invariant check:** Migration is deterministic; the existing migrations `0000` and `0001` stay untouched.

### Step 10 — Infrastructure: env loader

**File:** `apps/backend/src/infrastructure/auth/auth-env.ts` (CREATE)

**What:** Centralised env reader returning `Result<AuthEnv, Error>` so `buildAuthDeps` can `throw` on boot if anything's missing. Matches the `*FromEnv` factory pattern already used by `geminiProviderFromEnv` etc.

**Code skeleton:**
```typescript
import { Result } from "@carbonteq/fp";

export interface AuthEnv {
  readonly betterAuthSecret: string;
  readonly betterAuthUrl: string;
}

export function authEnvFrom(env: NodeJS.ProcessEnv): Result<AuthEnv, Error> {
  const secret = env["BETTER_AUTH_SECRET"];
  const url = env["BETTER_AUTH_URL"];
  if (!secret || secret.length < 32) {
    return Result.Err(new Error("BETTER_AUTH_SECRET must be set (>= 32 chars)"));
  }
  if (!url) {
    return Result.Err(new Error("BETTER_AUTH_URL must be set"));
  }
  return Result.Ok({ betterAuthSecret: secret, betterAuthUrl: url });
}
```

**Invariant check:** Pure function; no throws.

### Step 11 — Composition: `buildAuthDeps`

**File:** `apps/backend/src/composition/auth.composition.ts` (CREATE)

**What:** Boot-time factory. Lazy-requires `db` (preserves the OTel-first invariant in `main.ts` — see CONTEXT BLOCK). Returns `{ auth, candidateLink, getSession }`.

**Code skeleton:**
```typescript
import { createRequire } from "node:module";
import { authEnvFrom } from "../infrastructure/auth/auth-env.js";
import { createAuth, type AuthInstance } from "../infrastructure/auth/auth.js";
import {
  CandidateSignedLink,
  candidateSignedLinkFromEnv,
} from "../infrastructure/auth/candidate-signed-link.js";
import type { Database } from "../infrastructure/persistence/db.js";

const require = createRequire(import.meta.url);

export interface AuthDeps {
  readonly auth: AuthInstance;
  readonly candidateLink: CandidateSignedLink;
}

export interface AuthCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
}

export function buildAuthDeps(options: AuthCompositionOptions = {}): AuthDeps {
  const env = options.env ?? process.env;

  const authEnv = authEnvFrom(env);
  if (authEnv.isErr()) throw new Error(`Boot failed: ${authEnv.unwrapErr().message}`);

  const link = candidateSignedLinkFromEnv(env);
  if (link.isErr()) throw new Error(`Boot failed: ${link.unwrapErr().message}`);

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const auth = createAuth({
    secret: authEnv.unwrap().betterAuthSecret,
    baseUrl: authEnv.unwrap().betterAuthUrl,
    db,
  });

  return { auth, candidateLink: link.unwrap() };
}
```

**Invariant check:** Lazy-`require` matches the existing composition pattern; preserves `initOtel()`-before-`db` ordering.

### Step 12 — Composition: the four missing use-case roots

**File:** `apps/backend/src/composition/create-interview.composition.ts` (CREATE)
**File:** `apps/backend/src/composition/generate-interview-plan.composition.ts` (CREATE)
**File:** `apps/backend/src/composition/upload-candidate-documents.composition.ts` (CREATE)
**File:** `apps/backend/src/composition/extract-candidate-documents.composition.ts` (CREATE)

**What:** Mirror `interview-session.composition.ts` and `evaluate-interview.composition.ts`. The plan-generation composition additionally takes a `candidateLink` so the controller can mint the link from the use case's success response.

**Code skeleton — `generate-interview-plan.composition.ts`:**
```typescript
import { createRequire } from "node:module";
import { GenerateInterviewPlanUseCase } from "@repo/application";
import { GeminiInterviewPlannerService, geminiProviderFromEnv } from "../infrastructure/services/gemini/index.js";
import { DrizzleInterviewRepository } from "../infrastructure/repositories/index.js";
import type { Database } from "../infrastructure/persistence/db.js";
import { CandidateSignedLink } from "../infrastructure/auth/candidate-signed-link.js";

const require = createRequire(import.meta.url);

export interface GenerateInterviewPlanDeps {
  readonly buildUseCase: () => GenerateInterviewPlanUseCase;
  readonly candidateLink: CandidateSignedLink;
}

export interface GenerateInterviewPlanCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly db?: Database;
  readonly candidateLink: CandidateSignedLink; // passed in from authDeps
}

export function buildGenerateInterviewPlanDeps(
  options: GenerateInterviewPlanCompositionOptions,
): GenerateInterviewPlanDeps {
  const env = options.env ?? process.env;
  const gemini = geminiProviderFromEnv(env);
  if (gemini.isErr()) throw new Error(`Boot failed: ${gemini.unwrapErr().message}`);

  const db = options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const interviews = new DrizzleInterviewRepository(db);
  const planner = new GeminiInterviewPlannerService(gemini.unwrap());

  return {
    buildUseCase: () => new GenerateInterviewPlanUseCase(interviews, planner),
    candidateLink: options.candidateLink,
  };
}
```

**Other three:** analogous; create-interview only needs `InterviewRepository`; upload needs `LocalFileStorageService`; extract needs storage + Gemini factory closure (see `gemini-document-extraction.service.ts` pattern, ADR-009).

**Invariant check:** No composition imports presentation. Each is a pure boot-time DI factory.

### Step 13 — Presentation: auth plugin (session helper + `requireRecruiter`)

**File:** `apps/backend/src/presentation/auth/auth-plugin.ts` (CREATE)

**What:** Fastify plugin that:
1. Decorates `request.session: { userId, email } | null` via a `preHandler` that calls `auth.api.getSession({ headers })`.
2. Exports a `requireRecruiter` preHandler that responds 401 (and skips downstream handlers) if `request.session` is null.

**Code skeleton:**
```typescript
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { fromNodeHeaders } from "../utils/from-node-headers.js"; // small helper turning IncomingHttpHeaders -> Headers
import type { AuthInstance } from "../../infrastructure/auth/auth.js";

export interface AuthPluginOptions {
  readonly auth: AuthInstance;
}

declare module "fastify" {
  interface FastifyRequest {
    session: { userId: string; email: string } | null;
  }
}

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req) => {
    const result = await opts.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    req.session = result ? { userId: result.user.id, email: result.user.email } : null;
  });
};

export const authPlugin = fp(plugin, { name: "ai-interviewer-auth" });

export async function requireRecruiter(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session) {
    reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  }
}
```

**Note:** `fromNodeHeaders` is a 5-line helper; not a separate skill. Better-auth ships Web Standard handler — feeding it `Headers` is the easiest bridge.

**Invariant check:** Imports `AuthInstance` from infrastructure but lives in presentation — this is **the** crossing the architecture explicitly allows (presentation ↔ infrastructure via composition root). Note: the `AuthInstance` type IS infrastructure-owned, but ownership-checks remain in presentation. `/backend-arch-validator` should pass because the import is via a type, and the runtime instance is injected through composition.

### Step 14 — Presentation: ownership helper

**File:** `apps/backend/src/presentation/auth/assert-recruiter-owns-interview.ts` (CREATE)

**What:** Pure helper. Returns `Result<void, ForbiddenError>` (using application-layer `ForbiddenError`). Per CONTEXT BLOCK recommendation: respond **404** rather than 403 when ownership check fails, to avoid existence-disclosure of interviews the recruiter doesn't own. The helper returns `ForbiddenError`; the controller decides the status mapping (in this codebase the mapper turns `FORBIDDEN` → 403, so the controller calls a separate path for the not-owned case — see Step 16).

**Decision:** Recommended approach — controllers compare `interview.recruiterId === req.session.userId`; if mismatch, controllers respond **as if the interview were not found** (return `InterviewNotFoundError` mapped to 404). The helper exists only as a single inline check to keep route handlers small.

**Code skeleton:**
```typescript
import type { Interview, InterviewNotFoundError } from "@repo/domain";
import { InterviewNotFoundError as InterviewNotFoundErrorClass } from "@repo/domain";
import { Result } from "@carbonteq/fp";

export function assertRecruiterOwnsInterview(
  interview: Interview,
  recruiterId: string,
): Result<Interview, InterviewNotFoundError> {
  if (interview.recruiterId !== recruiterId) {
    return Result.Err(new InterviewNotFoundErrorClass(interview.id));
  }
  return Result.Ok(interview);
}
```

**Invariant check:** Presentation imports `@repo/domain` only (already allowed). No throw.

### Step 15 — Presentation: HTTP error mapper + `setErrorHandler`

**File:** `apps/backend/src/presentation/errors/http-error-mapper.ts` (CREATE)

**What:** Single function `mapServiceErrorToHttp(err) -> { status, body }`. Used both by `setErrorHandler` (for accidental throws) and by every controller's terminal `.match({ Ok: ..., Err: ... })`.

**Mapping table (authoritative — every error class in the codebase appears here):**

| Error class                              | `code`                                | HTTP | Notes |
| ---                                      | ---                                   | ---  | --- |
| `InterviewNotFoundError`                 | `INTERVIEW_NOT_FOUND`                 | 404  | also used for "not owned" |
| `ReportNotFoundError`                    | `REPORT_NOT_FOUND`                    | 404  | |
| `InvalidInterviewStateTransitionError`   | `INVALID_INTERVIEW_STATE_TRANSITION`  | 409  | |
| `InterviewPlanRequiredError`             | `INTERVIEW_PLAN_REQUIRED`             | 409  | |
| `InvalidInterviewInputError`             | `INVALID_INTERVIEW_INPUT`             | 400  | |
| `InvalidReportInputError`                | `INVALID_REPORT_INPUT`                | 400  | |
| `InvalidFileRefError`                    | `INVALID_FILE_REF`                    | 400  | |
| `DtoValidationError`                     | `DTO_VALIDATION_FAILED`               | 400  | body includes `issues` |
| `UnauthorizedError`                      | `UNAUTHORIZED`                        | 401  | |
| `InvalidCandidateTokenError`             | `INVALID_CANDIDATE_TOKEN`             | 401  | WS handler maps to close 1008 |
| `ForbiddenError`                         | `FORBIDDEN`                           | 403  | |
| `ServiceUnavailableError`                | `SERVICE_UNAVAILABLE`                 | 503  | |
| `ServiceTimeoutError`                    | `SERVICE_TIMEOUT`                     | 503  | |
| `StorageUnavailableError`                | `STORAGE_UNAVAILABLE`                 | 503  | |
| `StorageNotFoundError`                   | `STORAGE_NOT_FOUND`                   | 404  | |
| `StorageUnknownError`                    | `STORAGE_UNKNOWN`                     | 500  | |
| `ExtractionUnavailableError`             | `EXTRACTION_UNAVAILABLE`              | 503  | |
| `ExtractionParseFailedError`             | `EXTRACTION_PARSE_FAILED`             | 422  | |
| `ExtractionUnknownError`                 | `EXTRACTION_UNKNOWN`                  | 500  | |
| `AgentUnavailableError`                  | `AGENT_UNAVAILABLE`                   | 503  | |
| `AgentToolInputInvalidError`             | `AGENT_TOOL_INPUT_INVALID`            | 500  | internal — agent malformed call |
| `AgentTurnTimeoutError`                  | `AGENT_TURN_TIMEOUT`                  | 504  | |
| `AgentUnknownError`                      | `AGENT_UNKNOWN`                       | 500  | |
| `PlannerUnavailableError`                | `PLANNER_UNAVAILABLE`                 | 503  | |
| `PlannerOutputInvalidError`              | `PLANNER_OUTPUT_INVALID`              | 422  | |
| `PlannerUnknownError`                    | `PLANNER_UNKNOWN`                     | 500  | |
| `EvaluatorUnavailableError`              | `EVALUATOR_UNAVAILABLE`               | 503  | |
| `EvaluatorOutputInvalidError`            | `EVALUATOR_OUTPUT_INVALID`            | 422  | |
| `EvaluatorUnknownError`                  | `EVALUATOR_UNKNOWN`                   | 500  | |
| `SttUnavailableError` / `SttStreamError` / `SttUnknownError` | `STT_*`            | 503/500/500 | only reachable via WS, but mapper covers them |
| `TtsUnavailableError` / `TtsStreamError` / `TtsUnknownError` | `TTS_*`            | 503/500/500 | same |
| `ServiceUnknownError`                    | `SERVICE_UNKNOWN_ERROR`               | 500  | fallback |
| `RepositoryError` (any subclass)         | `REPO_*`                              | n/a  | **MUST NOT** reach here — translated at use-case boundary |
| Anything else (unknown `Error`)          | n/a                                   | 500  | log correlation ID, do NOT leak `cause` |

**Code skeleton:**
```typescript
import { ServiceError, DtoValidationError } from "@repo/application";

export interface HttpErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  INTERVIEW_NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  INVALID_INTERVIEW_STATE_TRANSITION: 409,
  INTERVIEW_PLAN_REQUIRED: 409,
  INVALID_INTERVIEW_INPUT: 400,
  INVALID_REPORT_INPUT: 400,
  INVALID_FILE_REF: 400,
  DTO_VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  INVALID_CANDIDATE_TOKEN: 401,
  FORBIDDEN: 403,
  SERVICE_UNAVAILABLE: 503,
  SERVICE_TIMEOUT: 503,
  STORAGE_UNAVAILABLE: 503,
  STORAGE_NOT_FOUND: 404,
  EXTRACTION_UNAVAILABLE: 503,
  EXTRACTION_PARSE_FAILED: 422,
  AGENT_UNAVAILABLE: 503,
  AGENT_TURN_TIMEOUT: 504,
  PLANNER_UNAVAILABLE: 503,
  PLANNER_OUTPUT_INVALID: 422,
  EVALUATOR_UNAVAILABLE: 503,
  EVALUATOR_OUTPUT_INVALID: 422,
  STT_UNAVAILABLE: 503,
  TTS_UNAVAILABLE: 503,
  // Everything not listed (incl. *_UNKNOWN, *_STREAM_ERROR) falls through to 500.
};

export function mapServiceErrorToHttp(err: ServiceError): { status: number; body: HttpErrorBody } {
  const status = STATUS_BY_CODE[err.code] ?? 500;
  const body: HttpErrorBody = { error: { code: err.code, message: err.message } };
  if (err instanceof DtoValidationError) {
    return { status, body: { error: { ...body.error, issues: err.issues } } };
  }
  return { status, body };
}

export function installErrorHandler(app: import("fastify").FastifyInstance, logger: import("fastify").FastifyBaseLogger): void {
  app.setErrorHandler((err, req, reply) => {
    if (isServiceError(err)) {
      const { status, body } = mapServiceErrorToHttp(err);
      reply.code(status).send(body);
      return;
    }
    logger.error({ err, reqId: req.id }, "unhandled error");
    reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
}

function isServiceError(err: unknown): err is ServiceError {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";
}
```

**Invariant check:** Mapper is exhaustive by code, with safe fallback. No `cause` leaked. Repository errors never reach this layer (use cases translate them — verified by `/backend-arch-validator`).

### Step 16 — Presentation: recruiter-interviews routes + controllers

**Files:**
- `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts` (CREATE)
- `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts` (CREATE)

**What:** Six endpoints, all guarded by `requireRecruiter`. Each handler is a thin adapter: parse DTO → call use case → match Result → respond.

**Route table:**

| Method | Path                            | Use case                                | Notes |
| ---    | ---                             | ---                                     | --- |
| POST   | `/interviews`                   | `CreateInterviewUseCase`                | body excludes `recruiterId`; controller injects `req.session.userId` |
| GET    | `/interviews`                   | `IInterviewRepository.listByRecruiter`  | direct repo read; trivial — wrap in a `ListMyInterviewsUseCase` (Step 16a) for symmetry |
| GET    | `/interviews/:id`               | `IInterviewRepository.findById`         | same — `GetInterviewByIdUseCase` (Step 16a); ownership-checked |
| POST   | `/interviews/:id/plan`          | `GenerateInterviewPlanUseCase`          | ownership-checked; mints candidate link from `candidateLink.issue(id)` and returns it in response body |
| POST   | `/interviews/:id/evaluate`      | `EvaluateInterviewUseCase`              | ownership-checked |
| GET    | `/interviews/:id/report`        | `GetReportByInterviewIdUseCase`         | ownership-checked; `Option.None` → 404 with `code: REPORT_NOT_AVAILABLE` (NOTE: this is the only case where the controller returns a `code` not present in the mapper — it's a custom presentation-level code because `Option.None` is not an error) |

**Step 16a — Two new lightweight use cases (in `@repo/application`):**

**File:** `packages/application/src/use-cases/interview/list-interviews-by-recruiter.use-case.ts` (CREATE)
```typescript
export interface ListInterviewsByRecruiterInput { readonly recruiterId: string; }
export interface ListInterviewsByRecruiterOutput { readonly interviews: ReadonlyArray<InterviewSerialized>; }

export class ListInterviewsByRecruiterUseCase extends UseCase<ListInterviewsByRecruiterInput, ListInterviewsByRecruiterOutput> {
  constructor(private readonly interviews: IInterviewRepository) { super(); }
  async execute(input: ListInterviewsByRecruiterInput): Promise<Result<ListInterviewsByRecruiterOutput, ServiceError>> {
    const r = await this.interviews.listByRecruiter(input.recruiterId);
    return r
      .map((list) => ({ interviews: list.map((i) => i.serialize()) }))
      .mapErr((e) => new ServiceUnknownError(e.message, "InterviewRepository.listByRecruiter"));
  }
}
```

**File:** `packages/application/src/use-cases/interview/get-interview-by-id.use-case.ts` (CREATE)
```typescript
export interface GetInterviewByIdInput { readonly interviewId: string; }
export interface GetInterviewByIdOutput { readonly interview: InterviewSerialized; }

export class GetInterviewByIdUseCase extends UseCase<GetInterviewByIdInput, GetInterviewByIdOutput> {
  constructor(private readonly interviews: IInterviewRepository) { super(); }
  async execute(input: GetInterviewByIdInput): Promise<Result<GetInterviewByIdOutput, ServiceError>> {
    const r = await this.interviews.findById(input.interviewId);
    if (r.isErr()) return Result.Err(new ServiceUnknownError(r.unwrapErr().message, "InterviewRepository.findById"));
    return r.unwrap().match({
      Some: (i) => Result.Ok({ interview: i.serialize() }),
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId)),
    });
  }
}
```

**Both exported via `use-cases/interview/index.ts` and reachable through `@repo/application`.**

**Controller code skeleton (excerpt — plan endpoint, illustrates link issuance):**
```typescript
async generatePlan(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const session = req.session!; // requireRecruiter guarantees non-null
  const dtoResult = GenerateInterviewPlanInputDto.parse({ interviewId: req.params.id, ...req.body as object });
  if (dtoResult.isErr()) {
    const { status, body } = mapServiceErrorToHttp(dtoResult.unwrapErr());
    reply.code(status).send(body); return;
  }

  // Ownership check first
  const ownResult = await this.deps.getInterviewByIdUseCase.execute({ interviewId: req.params.id });
  if (ownResult.isErr()) {
    const { status, body } = mapServiceErrorToHttp(ownResult.unwrapErr());
    reply.code(status).send(body); return;
  }
  if (ownResult.unwrap().interview.recruiterId !== session.userId) {
    reply.code(404).send({ error: { code: "INTERVIEW_NOT_FOUND", message: "Interview not found" } });
    return;
  }

  // Execute plan generation
  const result = await this.deps.generatePlanUseCase.execute(dtoResult.unwrap().value);
  if (result.isErr()) {
    const { status, body } = mapServiceErrorToHttp(result.unwrapErr());
    reply.code(status).send(body); return;
  }

  // Mint candidate link on success
  const token = this.deps.candidateLink.issue(req.params.id);
  const candidateUrl = `${this.deps.publicBaseUrl}/interviews/${req.params.id}/session?token=${token}`;
  reply.code(200).send({ ...result.unwrap(), candidateLink: { url: candidateUrl, token, expiresInSeconds: this.deps.candidateLinkTtlSeconds } });
}
```

**Invariant check:** Controllers never throw; they `.match` Result and call mapper. They never import `apps/backend/src/infrastructure/...` except via type imports (e.g. `CandidateSignedLink`) — runtime instance is injected through composition.

### Step 17 — Presentation: recruiter documents routes

**Files:**
- `apps/backend/src/presentation/controllers/recruiter-document.controller.ts` (CREATE)
- `apps/backend/src/presentation/routes/recruiter-documents.routes.ts` (CREATE)

**What:** Two endpoints, both guarded by `requireRecruiter`. Upload uses `@fastify/multipart` to stream incoming files into `Buffer`s; controller passes them into `UploadCandidateDocumentsUseCase`. Extract takes the previously-returned `{ jdRef, cvRef }` keys and calls `ExtractCandidateDocumentsUseCase`.

**Route table:**

| Method | Path                  | Use case                              | Body |
| ---    | ---                   | ---                                   | --- |
| POST   | `/documents/upload`   | `UploadCandidateDocumentsUseCase`     | multipart/form-data: `jdFile`, `cvFile` |
| POST   | `/documents/extract`  | `ExtractCandidateDocumentsUseCase`    | JSON: `{ jdFile: { key, contentType }, cvFile: { key, contentType } }` |

**`recruiterId` injection:** Both use cases currently expect `recruiterId` in their input DTO. Per the same Step 2/3 pattern, **option A** (recommended): leave DTOs as-is for now, controller passes `req.session.userId` as `recruiterId` explicitly. **Option B**: replicate the public/execute split. We pick **A** because the DTO already requires `recruiterId` and these are recruiter-only routes, so the data is internally consistent.

**Invariant check:** Multipart payload limit — set `attachFieldsToBody: false`, `limits: { fileSize: 25 MB, files: 2 }` to bound memory.

### Step 18 — Presentation: candidate WS guard

**File:** `apps/backend/src/presentation/routes/interview-session.ws.ts` (MODIFY)
**File:** `apps/backend/src/presentation/controllers/interview-session.controller.ts` (MODIFY — minimal: only the route layer changes, but the controller may need a `verifyCandidateToken` hook)

**What:** Add a `preValidation` (or run inline at the top of the route handler) that:
1. Reads `req.query.token` (string).
2. Calls `candidateLink.verify(token)`.
3. On `Result.Err`, the upgrade has not yet happened — return `reply.code(401).send(...)` to abort the WS upgrade.
4. On `Result.Ok`, verify `tokenInterviewId === params.id` (defence-in-depth — should be true by construction).
5. Then delegate to the existing controller.

**Code skeleton:**
```typescript
export interface RegisterInterviewSessionRouteOptions {
  readonly deps: InterviewSessionDeps;
  readonly candidateLink: CandidateSignedLink;
}

export async function registerInterviewSessionRoutes(app, options) {
  const controller = new InterviewSessionController(options.deps);

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/:id/session",
    { websocket: true },
    async (socket, req) => {
      const token = req.query.token;
      if (!token) {
        socket.close(1008, "missing token"); return;
      }
      const verifyResult = options.candidateLink.verify(token);
      if (verifyResult.isErr()) {
        socket.close(1008, "invalid token"); return;
      }
      if (verifyResult.unwrap().interviewId !== req.params.id) {
        socket.close(1008, "token mismatch"); return;
      }
      await controller.handle(socket, req);
    },
  );
}
```

**Why not a Fastify `preValidation` hook on WS routes:** `@fastify/websocket` v11 runs the hook chain BEFORE upgrade for the route, so an HTTP 401 response would be valid — but the WebSocket client SDK behaviour for receiving a 401 in lieu of an upgrade is uneven across browsers/Node `ws`. Closing with policy-violation (1008) inside the handler is more interoperable. The plan picks the close-inside-handler form.

**Invariant check:** The existing `mapErrorToWsClose` already covers session-time errors. We only add a *pre-session* token check. No domain change.

### Step 19 — Presentation: mount everything in `app.ts`

**File:** `apps/backend/src/app.ts` (MODIFY)

**What:** Compose all deps (auth, evaluate, generate-plan, create, upload, extract, session). Register `authPlugin` first, then `setErrorHandler`, then routes, then better-auth's own handler at `/api/auth/*`. The existing `GET /health` stays inline.

**Code skeleton:**
```typescript
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { authPlugin } from "./presentation/auth/auth-plugin.js";
import { installErrorHandler } from "./presentation/errors/http-error-mapper.js";
import { registerInterviewSessionRoutes } from "./presentation/routes/interview-session.ws.js";
import { registerRecruiterInterviewRoutes } from "./presentation/routes/recruiter-interviews.routes.js";
import { registerRecruiterDocumentRoutes } from "./presentation/routes/recruiter-documents.routes.js";
import { mountBetterAuth } from "./presentation/auth/better-auth-mount.js"; // tiny shim — see Step 19a

export interface BuildAppOptions {
  // ... existing
  readonly authDeps?: AuthDeps;
  readonly recruiterInterviewDeps?: RecruiterInterviewDeps;
  readonly recruiterDocumentDeps?: RecruiterDocumentDeps;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: true });

  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 2 } });

  // Compose deps (lazy)
  const authDeps = options.authDeps ?? (await import("./composition/auth.composition.js")).buildAuthDeps();

  installErrorHandler(app, app.log);
  await app.register(authPlugin, { auth: authDeps.auth });

  app.get("/health", async () => ({ status: "ok" }));

  // better-auth handler — mount at /api/auth/*
  await mountBetterAuth(app, authDeps.auth);

  // Recruiter routes
  const recruiterInterviewDeps = options.recruiterInterviewDeps ?? await buildRecruiterInterviewDepsLazy(authDeps);
  await app.register(registerRecruiterInterviewRoutes, { prefix: "", deps: recruiterInterviewDeps });

  const recruiterDocumentDeps = options.recruiterDocumentDeps ?? await buildRecruiterDocumentDepsLazy();
  await app.register(registerRecruiterDocumentRoutes, { prefix: "", deps: recruiterDocumentDeps });

  // Candidate WS (existing; now guarded by token)
  const interviewSession = options.interviewSession ?? {
    deps: (await import("./composition/interview-session.composition.js")).buildInterviewSessionDeps(),
    candidateLink: authDeps.candidateLink,
  };
  await app.register(registerInterviewSessionRoutes, { prefix: "/interviews", ...interviewSession });

  return app;
}
```

**Step 19a — `mountBetterAuth` shim:**

**File:** `apps/backend/src/presentation/auth/better-auth-mount.ts` (CREATE)

**What:** Better-auth ships a Web-Standard handler (`auth.handler(request: Request): Promise<Response>`). Fastify is Node-style. We add a catch-all route at `/api/auth/*` that converts Fastify req → standard `Request`, calls the handler, pipes back. ~30 LOC.

**Code skeleton:**
```typescript
export async function mountBetterAuth(app: FastifyInstance, auth: AuthInstance): Promise<void> {
  app.all("/api/auth/*", async (req, reply) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const request = new Request(url, {
      method: req.method,
      headers: fromNodeHeaders(req.headers),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const response = await auth.handler(request);
    reply.code(response.status);
    response.headers.forEach((v, k) => reply.header(k, v));
    reply.send(response.body ? await response.text() : null);
  });
}
```

**Invariant check:** `app.ts` still respects the OTel-init-first ordering — `db` lazy-required inside `buildAuthDeps`. Tests can pass `options.authDeps` to bypass the boot path entirely.

### Step 20 — Main: no change

**File:** `apps/backend/src/main.ts` (NO CHANGE)

The dynamic-import-after-OTel pattern still holds because `db.ts` is only touched inside the composition factories.

---

## Pseudo-workflow

### Flow A: Recruiter creates an interview

1. `POST /interviews` arrives with cookie session.
2. `authPlugin.preHandler` populates `req.session = { userId, email }` (or null).
3. `requireRecruiter` preHandler runs on the route → 401 if no session.
4. Controller parses body with `CreateInterviewInputDto.parse` → `Result<CreateInterviewInput, DtoValidationError>`. On Err: mapper → 400.
5. Controller builds `CreateInterviewExecuteInput = { ...input, recruiterId: req.session.userId }`.
6. `CreateInterviewUseCase.execute(execInput)` → `Promise<Result<CreateInterviewOutput, ServiceError>>`.
7. Use case calls domain factories + `interviews.save`. Repository error → `ServiceUnknownError`. Domain validation error → propagates.
8. Controller `.match`:
   - Ok → 201 with serialized interview.
   - Err → `mapServiceErrorToHttp` → status + body.

### Flow B: Recruiter generates plan + receives candidate link

1. `POST /interviews/:id/plan` → `requireRecruiter`.
2. Controller fetches interview via `GetInterviewByIdUseCase` → 404 on not found.
3. Ownership check: `interview.recruiterId !== session.userId` → 404 (existence hiding).
4. Validate body: `GenerateInterviewPlanInputDto.parse({ interviewId, ...body })` → 400 on Err.
5. `GenerateInterviewPlanUseCase.execute(input)` → transitions interview CREATED → SCHEDULED.
6. On success, controller calls `deps.candidateLink.issue(interviewId)`.
7. Response 200: `{ interviewId, status, topicCount, targetDurationMinutes, maxDurationMinutes, candidateLink: { url, token, expiresInSeconds } }`.

### Flow C: Candidate joins session via signed link

1. WS request `GET /interviews/:id/session?token=…`.
2. Route handler reads `token`; calls `candidateLink.verify(token)`.
3. Err → `ws.close(1008, "invalid token")`.
4. Ok but `decoded.interviewId !== params.id` → `ws.close(1008, "token mismatch")`.
5. Otherwise → delegate to existing `InterviewSessionController.handle(socket, req)`.
6. Existing voice pipeline runs unchanged (Phase 5 logic).

### Flow D: Recruiter fetches report

1. `GET /interviews/:id/report` → `requireRecruiter`.
2. Ownership check (same pattern).
3. `GetReportByInterviewIdUseCase.execute({ interviewId })` → `{ report: Option<ReportSerialized> }`.
4. Controller:
   - `Option.Some(report)` → 200 with body `{ report }`.
   - `Option.None` → 404 with `{ error: { code: "REPORT_NOT_AVAILABLE", message: "Report not yet available for this interview" } }`. (Note: this code is presentation-only because it's not an error in the use case — it's a successful "no report yet" return.)

---

## Entry points (dependency order — innermost first)

| #   | File                                                                                              | Layer           | Op       | Purpose |
| --- | ---                                                                                               | ---             | ---      | --- |
| 1   | `packages/application/src/core/service-error.ts`                                                  | application     | MODIFY   | add `UnauthorizedError`, `InvalidCandidateTokenError`, `ForbiddenError` |
| 2   | `packages/application/src/core/index.ts`                                                          | application     | MODIFY   | ensure new errors exported |
| 3   | `packages/application/src/dtos/create-interview.dto.ts`                                           | application     | MODIFY   | drop `recruiterId` from public schema; add `CreateInterviewExecuteInput` |
| 4   | `packages/application/src/use-cases/interview/create-interview.use-case.ts`                       | application     | MODIFY   | switch generic to `CreateInterviewExecuteInput` |
| 5   | `packages/application/src/use-cases/interview/get-interview-by-id.use-case.ts`                    | application     | CREATE   | thin wrap of `findById` |
| 6   | `packages/application/src/use-cases/interview/list-interviews-by-recruiter.use-case.ts`           | application     | CREATE   | thin wrap of `listByRecruiter` |
| 7   | `packages/application/src/use-cases/interview/index.ts`                                           | application     | MODIFY   | export the two new use cases |
| 8   | `apps/backend/package.json`                                                                       | infrastructure  | MODIFY   | `pnpm add better-auth @fastify/multipart` |
| 9   | `apps/backend/src/infrastructure/auth/auth.ts`                                                    | infrastructure  | CREATE   | better-auth instance factory |
| 10  | `apps/backend/src/infrastructure/auth/auth-env.ts`                                                | infrastructure  | CREATE   | env loader returning Result |
| 11  | `apps/backend/src/infrastructure/auth/candidate-signed-link.ts`                                   | infrastructure  | CREATE   | HMAC issue/verify helper |
| 12  | `apps/backend/src/infrastructure/persistence/schema/auth.ts`                                      | infrastructure  | CREATE   | better-auth Drizzle tables |
| 13  | `apps/backend/src/infrastructure/persistence/schema/index.ts`                                     | infrastructure  | MODIFY   | re-export auth schema |
| 14  | `apps/backend/drizzle/0002_<name>.sql` + `meta/0002_snapshot.json` + `meta/_journal.json`         | infrastructure  | CREATE   | via `pnpm db:generate` |
| 15  | `apps/backend/src/composition/auth.composition.ts`                                                | composition     | CREATE   | `buildAuthDeps` |
| 16  | `apps/backend/src/composition/create-interview.composition.ts`                                    | composition     | CREATE   | `buildCreateInterviewDeps` |
| 17  | `apps/backend/src/composition/generate-interview-plan.composition.ts`                             | composition     | CREATE   | `buildGenerateInterviewPlanDeps`, accepts `candidateLink` |
| 18  | `apps/backend/src/composition/upload-candidate-documents.composition.ts`                          | composition     | CREATE   | `buildUploadCandidateDocumentsDeps` |
| 19  | `apps/backend/src/composition/extract-candidate-documents.composition.ts`                         | composition     | CREATE   | `buildExtractCandidateDocumentsDeps` |
| 20  | `apps/backend/src/presentation/auth/auth-plugin.ts`                                               | presentation    | CREATE   | session decorator + `requireRecruiter` |
| 21  | `apps/backend/src/presentation/auth/better-auth-mount.ts`                                         | presentation    | CREATE   | Fastify → Web Request shim for `/api/auth/*` |
| 22  | `apps/backend/src/presentation/auth/assert-recruiter-owns-interview.ts`                           | presentation    | CREATE   | ownership Result helper |
| 23  | `apps/backend/src/presentation/utils/from-node-headers.ts`                                        | presentation    | CREATE   | tiny IncomingHttpHeaders → Headers shim |
| 24  | `apps/backend/src/presentation/errors/http-error-mapper.ts`                                       | presentation    | CREATE   | `mapServiceErrorToHttp` + `installErrorHandler` |
| 25  | `apps/backend/src/presentation/controllers/recruiter-interview.controller.ts`                     | presentation    | CREATE   | 6 method controller |
| 26  | `apps/backend/src/presentation/routes/recruiter-interviews.routes.ts`                             | presentation    | CREATE   | route registrar |
| 27  | `apps/backend/src/presentation/controllers/recruiter-document.controller.ts`                      | presentation    | CREATE   | 2 method controller (upload, extract) |
| 28  | `apps/backend/src/presentation/routes/recruiter-documents.routes.ts`                              | presentation    | CREATE   | route registrar |
| 29  | `apps/backend/src/presentation/routes/interview-session.ws.ts`                                    | presentation    | MODIFY   | add token guard before delegation |
| 30  | `apps/backend/src/app.ts`                                                                         | presentation    | MODIFY   | register multipart, auth plugin, error handler, all routes |
| 31  | `docs/adr/ADR-016-*.md` … `ADR-019-*.md`                                                          | docs            | CREATE   | four ADRs (see ADR section) |

---

## ADRs to author

Each ADR must pass the four gates (completeness, evidence, clarity, consistency). Each gets an Enforcement block where the rule is mechanically expressible; otherwise `llm_judge: true`.

### ADR-016 — Adopt `better-auth` for recruiter authentication

- **Alternatives:** Lucia (deprecated/maintenance mode), Clerk (vendor-hosted, $$, OAuth-flavoured), Auth.js a.k.a NextAuth (Next-coupled, awkward outside Next), DIY (cost-of-ownership trap).
- **Decision:** better-auth — self-hostable, Drizzle-native, email/password first-class, no UI lock-in.
- **Enforcement:** declarative — `forbid_import` on `lucia`, `next-auth`, `@clerk/*` anywhere under `apps/backend/src/`.
- **Risks (Phase-10 prerequisites — must be resolved before real recruiters use the system):**
  - `requireEmailVerification` is **disabled** in Phase 7 because there is no mail provider. Anyone can register with any email string. Re-enable once a Resend (or equivalent) adapter exists.
  - **No rate limiting** on `/api/auth/*` in Phase 7. Credential-stuffing is mitigated only by better-auth's built-in password hashing. Add `@fastify/rate-limit` (with Redis store once Redis is introduced) on `sign-in`, `sign-up`, and `forgot-password` routes as a Phase-10 hard gate.
  - **No CORS plugin** in Phase 7 — no frontend exists. better-auth's `BETTER_AUTH_URL` trusted-origin check is the only origin guard for auth routes. When Phase 8 frontend lands, add `@fastify/cors` with an explicit allowlist; do not rely solely on better-auth's check for app routes.
  - `recruiterId` is plain text, not FK to `users.id`. Deletion of a better-auth user does not cascade to orphan interviews. We do not hard-delete recruiters today; if that changes, add the FK migration before enabling the delete path.

### ADR-017 — Candidate access via HMAC-signed link, not better-auth user

- **Alternatives:** Issue better-auth "anonymous" sessions (heavyweight, persists rows we don't need); pure UUID-as-secret (no expiry, no revocation potential); JWT via `jose` (overhead, more crypto knobs to misconfigure); HMAC stdlib (chosen).
- **Decision:** Stdlib HMAC-SHA256, base64url, **7-day default TTL** (env-configurable via `CANDIDATE_LINK_TTL_SECONDS`), **not persisted** — token regeneratable from `(secret, interviewId)`. Rotation = rotate `CANDIDATE_LINK_SECRET` (invalidates all live links).
- **Enforcement:** `forbid_pattern` on `jose|jsonwebtoken` under `apps/backend/src/infrastructure/auth/`. `llm_judge: true` to ensure no controller bypasses verify.

### ADR-018 — HTTP error mapping by error `code` with exhaustive table

- **Alternatives:** Map by class hierarchy (rigid; small refactors break dozens of cases); map by error name (stringly typed but no compile guarantee); map by `code` with table (chosen).
- **Decision:** Single `STATUS_BY_CODE` table in `http-error-mapper.ts`. Unknown code → 500 with sanitized body. `cause` never surfaced. `setErrorHandler` is the safety net; controllers should still `.match` Result explicitly.
- **Enforcement:** `require_pattern` — every new file in `apps/backend/src/presentation/controllers/**` matching `class\s+\w+Controller` must contain `mapServiceErrorToHttp`. `llm_judge: true` to catch raw `throw` statements in controllers.

### ADR-019 — Ownership checks live in presentation, not application

- **Alternatives:** Put ownership predicate on `Interview` aggregate (domain); use cases enforce ownership (couples HTTP identity to domain); presentation-side check (chosen).
- **Decision:** Controllers fetch the aggregate and compare `interview.recruiterId === session.userId`. The use case stays agnostic of *who* is asking. Existence-disclosure mitigation: failed ownership returns 404, not 403.
- **Enforcement:** `forbid_pattern` — controllers may not pass an arbitrary `recruiterId` from `req.body` into `CreateInterviewExecuteInput.recruiterId`. Pattern: `recruiterId:\s*req\.body` under `apps/backend/src/presentation/`. `llm_judge: true` covers cases where the body is decoded into a DTO and then the recruiterId leaks through.

---

## Migration order (canonical — do not deviate)

1. Add deps (`pnpm --filter backend add better-auth @fastify/multipart`).
2. Author `infrastructure/auth/auth.ts` (Step 6) — type-only references at this point.
3. Author `infrastructure/persistence/schema/auth.ts` (Step 8). Re-export from schema barrel.
4. Run `pnpm --filter backend db:generate` → produces `0002_*.sql`. Inspect.
5. Run `pnpm --filter backend db:migrate` against the dev DB. Confirm the four auth tables exist.
6. Author `candidate-signed-link.ts`, `auth-env.ts`, then the auth composition (`auth.composition.ts`).
7. Author the four missing use-case compositions (Step 12).
8. Author `auth-plugin.ts`, `better-auth-mount.ts`, ownership helper, error mapper.
9. Add presentation routes one router at a time:
   a. Recruiter interviews → `/backend-arch-validator presentation`.
   b. Recruiter documents → `/backend-arch-validator presentation`.
   c. WS token guard → `/backend-arch-validator presentation`.
10. Wire everything in `app.ts`.
11. Tests (Step 19 below).
12. Author the four ADRs (16-19) — only flip to Accepted after human review.

---

## Test surface

All co-located `.test.ts`. Use `Fastify().inject(...)` against `buildApp({ ...mockedDeps })`. No live providers.

### Domain / application tests

- `create-interview.use-case.test.ts` (MODIFY) — pass `CreateInterviewExecuteInput`; assert `recruiterId` flows through.
- `list-interviews-by-recruiter.use-case.test.ts` (CREATE) — happy path; repo error → ServiceUnknownError.
- `get-interview-by-id.use-case.test.ts` (CREATE) — Some → Ok, None → InterviewNotFoundError, repo error → ServiceUnknownError.

### Infrastructure tests

- `candidate-signed-link.test.ts` (CREATE):
  - `issue` then `verify` → Ok with same `interviewId`.
  - Wrong secret → `InvalidCandidateTokenError`.
  - Tampered payload byte → `InvalidCandidateTokenError`.
  - Expired (TTL = -1s) → `InvalidCandidateTokenError`.
  - Malformed (no dot, garbage base64) → `InvalidCandidateTokenError`.
- `auth-env.test.ts` (CREATE):
  - Missing `BETTER_AUTH_SECRET` → Err.
  - Secret < 32 chars → Err.
  - Missing `BETTER_AUTH_URL` → Err.
  - All present → Ok.
- No live better-auth test — covered by route-level tests with a real auth instance against an in-memory or test DB.

### Presentation tests

- `http-error-mapper.test.ts` (CREATE) — for every code in the table, assert correct HTTP status; unknown code → 500 with sanitized body; `DtoValidationError` includes `issues`.
- `auth-plugin.test.ts` (CREATE) — mock auth `getSession`; assert `req.session` populated; `requireRecruiter` blocks 401.
- `recruiter-interview.controller.test.ts` (CREATE) — for each of the 6 endpoints, with mocked use cases:
  - happy path 200/201,
  - unauthenticated → 401,
  - other-recruiter's id → 404 (existence-hiding),
  - DTO validation failure → 400 with `issues`,
  - `INVALID_INTERVIEW_STATE_TRANSITION` from use case → 409,
  - plan endpoint additionally asserts `candidateLink.url` present in response.
- `recruiter-document.controller.test.ts` (CREATE) — upload happy path returns refs; missing file part → 400; file too large → 413 (fastify-multipart default).
- `interview-session.ws.test.ts` (MODIFY) — add cases:
  - no `?token` → close 1008.
  - tampered token → close 1008.
  - mismatched `interviewId` in token vs URL → close 1008.
  - valid token → existing session handler runs.

### Out of scope

- No live integration tests against Postgres for auth (better-auth has its own test surface; we trust the adapter).
- No load tests.
- No CSRF tests — better-auth handles its own CSRF tokens.

---

## Verification commands (run AFTER all edits)

```bash
# Type-check the whole backend graph
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Per-layer tests (in order from cheapest to slowest)
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend

# Lint
pnpm turbo run lint --filter=@repo/domain --filter=@repo/application --filter=backend

# Drizzle migration check (dry-run on dev DB)
pnpm --filter backend db:generate    # should produce NO new pending diff
```

Run `/backend-arch-validator infrastructure` after Step 12 (post-auth infra), then `/backend-arch-validator presentation` after each route group (Steps 16, 17, 18, 19).

Run `backend-code-reviewer` agent at the end against the full file list (Entry points 1–30). Iterate to PASS.

---

## Risk notes

1. **OTel-init-first invariant.** `main.ts` deliberately dynamically imports `app.ts` AFTER `initOtel()`. Any module that eagerly imports `db.ts` at top-level will load before OTel. **All auth modules must lazy-require `db.ts` inside their factories** — never `import { db } from "../persistence/db.js"` at top level. The composition pattern in `auth.composition.ts` (Step 11) is the template; copy it exactly.

2. **better-auth schema drift.** Better-auth's table shape evolves between minor versions. Use the official `better-auth generate` CLI to author Step 8's schema, not memory. After every `better-auth` upgrade, re-run the generator and diff against `auth.ts` schema file.

3. **`recruiterId` opaqueness.** Per CONTEXT BLOCK, we are NOT adding a FK from `interviews.recruiter_id` to `users.id`. Risk: orphan rows if a user is deleted. Acceptable for Phase 7 (no delete flow exists). ADR-019 records the decision; revisit when a user-delete flow lands.

4. **Existence disclosure.** Returning 404 instead of 403 on unauthorised access prevents enumeration but means a recruiter never gets feedback that "this interview belongs to someone else". For Phase 7 this is fine — recruiter UIs only show their own ids. If a frontend later allows direct URL entry, we may want to relax this.

5. **Candidate link is regeneratable.** Because the token is HMAC, anyone with `CANDIDATE_LINK_SECRET` can mint links. Treat the secret with the same care as `BETTER_AUTH_SECRET`. Rotating it invalidates all live candidate sessions and links — acceptable for now.

6. **Multipart memory.** `fastify/multipart` with `attachFieldsToBody: false` streams parts into Buffers via `await file.toBuffer()`. With a 25 MB limit × 2 files, peak per request is ~50 MB. Acceptable for a single-recruiter dev/staging workload; revisit before public launch.

7. **WS close semantics.** Some browsers expose only `1006` to JS regardless of server-sent close code. Documenting `1008` for token failures is for server logs and protocol-conformant clients; the candidate UI must read it from a server-side polling check, not from the WS close event alone.

8. **Test DB and auth.** Better-auth's signup mutates `users`, `accounts`, `sessions`. Use the existing `apps/backend/docker-compose.test.yml` Postgres for integration tests — do NOT mock the adapter. Truncate auth tables between tests.

---

## Resolved decisions (locked 2026-05-12)

All judgment calls flagged in the brief have been resolved. No open questions remain. Implementation may proceed against the steps above.

1. **Auth route mount prefix:** `/api/auth/*` (better-auth default). Leaves `/api/v1/...` namespace open later; clean separation from app routes.

2. **Public base URL for the candidate link:** new env var **`PUBLIC_BASE_URL`**. Not derived from `BETTER_AUTH_URL` (unnecessary coupling) and not from inbound `Host` header (injection risk). Step 16 wires this into the controller via composition.

3. **`GET /interviews/:id/report` when not yet evaluated:** **404 with `code: REPORT_NOT_AVAILABLE`** (NOT 409). The body `code` field disambiguates from `INTERVIEW_NOT_FOUND`. 409 is for "your write conflicts with current state"; a GET on an unmaterialized sub-resource is 404-shaped.

4. **`CANDIDATE_LINK_TTL_SECONDS` default:** **7 days** (changed from initial 14-day proposal). 14d is too long a window for a leaked screening link; 48h is too tight for reschedules. Env-configurable so recruiters can shorten further.

5. **Auth under test:** **hybrid** — real test DB for auth-flow integration tests (login/signup/session creation/expiry); mock `auth.api.getSession` in per-controller route tests (where the question is "given an authed request, does the controller behave?"). Keeps the bulk of the suite fast while still covering auth's storage surface.

6. **`recruiterId` FK to `users.id`:** **not added** in Phase 7. Stays as plain text. better-auth manages its own schema and may rename columns between versions; cross-package FK creates migration ordering pain. We do not hard-delete recruiters today. FK can be added later in one migration if integrity issues materialize.

7. **`ListInterviewsByRecruiterUseCase` + `GetInterviewByIdUseCase`:** **added as plain use cases.** Every other entry point goes through application — bypassing for GETs would erode the boundary and the next dev would copy the pattern. Two trivial files now is cheaper than the consistency debt. No query service yet; defer until pagination/projection actually shows up.

8. **Email verification flow:** **disabled** in better-auth config. No mail provider in Phase 7. Phase-10 prerequisite, documented in ADR-016 Risks. Implication accepted: any email-shaped string can register.

9. **CORS / origin allowlist:** **no `@fastify/cors` in Phase 7.** No frontend exists; picking origins blindly is worse than not picking. better-auth handles its own origin checks via `BETTER_AUTH_URL` for auth routes. When Phase 8 frontend origin is known, add `@fastify/cors` with an explicit allowlist (also documented in ADR-016 Risks).

10. **Rate limiting on auth endpoints:** **none in Phase 7.** Hard Phase-10 prerequisite, documented in ADR-016 Risks. Acceptable for closed-pilot / pre-real-recruiter use only.
