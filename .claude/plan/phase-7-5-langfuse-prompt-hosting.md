# Plan: Phase 7.5 — Langfuse Prompt Hosting (Planner + Evaluator)

> Generated: 2026-05-13
> Slug: phase-7-5-langfuse-prompt-hosting
> Branch: TBD (suggest `phase-7-5-langfuse-prompts` off `main` after `phase-7` merges)
> Status: Planning — no code yet.

## Summary

Move the **planner** (`gemini-interview-planner.service.ts`) and **evaluator** (`gemini-interview-evaluator.service.ts`) prompt **text** out of TypeScript string literals and into Langfuse-hosted text prompts. The infra adapters keep ownership of variable assembly (JSON-serializing JD / CV / transcript / notes / scores / rubric), the Zod/JSON output schema, the `generateText` call, and error translation. Only the template body is externalised. A code-resident fallback string keeps both adapters functional when Langfuse is unreachable, the prompt key does not yet exist, or credentials are missing. Each successful (non-fallback) fetch is linked to the AI SDK generation trace via `experimental_telemetry.metadata.langfusePrompt = prompt.toJSON()` so Langfuse can correlate generations with prompt versions.

Out of scope: agent prompt (`gemini-interview-agent.service.ts`) and document-extraction prompts; self-host migration; programmatic prompt seeding; ADR-020 authoring (separate `/adr-kit:adr` run); any frontend admin UI.

## Layers touched

| Layer          | Package / Location                                  | Scope |
| -------------- | --------------------------------------------------- | ----- |
| Domain         | `packages/domain/`                                  | None. No edits. |
| Application    | `packages/application/`                             | None. Service ports (`IInterviewPlannerService`, `IInterviewEvaluatorService`) and their input/error types are unchanged. No port widening. |
| Infrastructure | `apps/backend/src/infrastructure/`                  | New `prompts/` subdirectory: client wrapper, prompt-key constants, fallback constants. Two existing Gemini adapters get a constructor-injected prompt client and a small render+telemetry chain replacing the inline `buildPrompt`. `services/gemini/index.ts` re-exports stay; new `prompts/index.ts` barrel added. |
| Presentation   | `apps/backend/src/presentation/`                    | None. No route or controller changes. |
| Composition    | `apps/backend/src/composition/`                     | `generate-interview-plan.composition.ts` and `evaluate-interview.composition.ts` construct one shared `LangfusePromptClient` from env and inject it into the two services. No new wiring elsewhere. |

## SDK decision

**Choice: add `@langfuse/client` alongside the existing `langfuse@3.38.20`. Do NOT remove `langfuse@3.x` in this phase.**

Reasoning:

- `langfuse@3.x` is a transitive dependency of `@langfuse/otel@5.1.0` (the OTel exporter that registers our trace bootstrap in `apps/backend/src/infrastructure/observability/otel.ts`). It is not imported anywhere in our source — `rg "from \"langfuse\"|require.*\"langfuse\"" apps/backend/src/` returns zero hits. The 3.x SDK is invisible to product code and we should not touch the OTel bootstrap mid-phase.
- `@langfuse/client` is the current canonical SDK for Prompt Management (per Langfuse docs, last updated 2025-10-07). Its `LangfuseClient.prompt.get(name, { type: "text", fallback })` shape is what the AI SDK integration docs target, and `prompt.toJSON()` is the documented metadata-linkage value.
- A future cleanup phase can drop `langfuse@3.x` if `@langfuse/otel` no longer requires it, or migrate the OTel layer to whatever the unified `@langfuse/*` family supports at that point.

**Follow-up deferred:** audit whether `@langfuse/otel@5.x` still requires `langfuse@3.x` and remove the 3.x dep in a hardening phase.

## PII boundary note (read before implementing)

The prompt **templates** are PII-free — they contain only instructions and `{{variable}}` placeholders. The **rendered** prompt (after `prompt.compile(...)`) interpolates candidate CV text, JD text, transcripts, and notes — i.e. PII. That rendered prompt is already sent to Langfuse Cloud today via the OTel exporter as part of every AI SDK generation trace (ADR-004 §Risks acknowledges this). This phase introduces **no new** PII flow:

- Prompt fetches send only the prompt key (`interview-planner-v1`, etc.) plus auth headers to Langfuse — no candidate data.
- Compiled prompt text continues to leave only via the existing OTel generation span, exactly as it does today.
- The implementation MUST NOT log the rendered prompt to pino, console, or any other sink. Only log on prompt-fetch error: `key`, `error message`, and `usingFallback: true` flag. No variable values.

## Environment variables

Already present (validated in `infrastructure/observability/otel.ts`):

```
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

`@langfuse/client` reads `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASEURL` by default. Our env var is `LANGFUSE_BASE_URL` (note the underscore between BASE and URL). The client wrapper must pass `baseUrl` **explicitly** from `env["LANGFUSE_BASE_URL"]` to avoid a silent mismatch. No new env vars.

## Bootstrap step (manual, one-time, before deploying)

Before merging this phase, seed two text prompts in the Langfuse UI (project → Prompts → New Prompt):

1. **`interview-planner-v1`** — Type: `Text`. Label: `production`. Body: copy from `infrastructure/prompts/fallbacks/interview-planner.fallback.ts` (Step 4 below). Variables: `{{target_duration_minutes}}`, `{{max_duration_minutes}}`, `{{job_description_json}}`, `{{candidate_profile_json}}`, `{{client_instructions}}`.
2. **`interview-evaluator-v1`** — Type: `Text`. Label: `production`. Body: copy from `infrastructure/prompts/fallbacks/interview-evaluator.fallback.ts`. Variables: `{{job_description_json}}`, `{{candidate_profile_json}}`, `{{client_instructions}}`, `{{transcript_json}}`, `{{notes_json}}`, `{{internal_scores_json}}`, `{{rubric}}`.

Manual seeding is acceptable for 7.5; a programmatic seeding script is explicit non-goal (see Deferred work).

If seeding is skipped, both adapters still work via fallback; the trace just won't carry a `langfusePrompt` link.

---

## Implementation steps

### Step 1 — Infrastructure: install `@langfuse/client`

**File:** `apps/backend/package.json` (MODIFY)

**What:** Add `@langfuse/client` to `dependencies`. Keep `langfuse@3.38.20` (transitive of `@langfuse/otel`).

**Command:**
```bash
pnpm --filter backend add @langfuse/client
```

**Invariant check:** Workspace-relative install. Re-run `pnpm install` at repo root if turbo cache complains. Confirm `apps/backend/package.json` shows both `@langfuse/client` and `langfuse` afterwards.

---

### Step 2 — Infrastructure: prompt-key constants

**File:** `apps/backend/src/infrastructure/prompts/prompt-keys.ts` (CREATE)

**What:** A typed map of every Langfuse prompt key the backend can fetch. Add only the two keys this phase requires; future phases extend this file.

**Code:**
```typescript
export const PROMPT_KEYS = {
  INTERVIEW_PLANNER: "interview-planner-v1",
  INTERVIEW_EVALUATOR: "interview-evaluator-v1",
} as const;

export type PromptKey = (typeof PROMPT_KEYS)[keyof typeof PROMPT_KEYS];
```

**Invariant check:** No external imports; no domain/application imports. Pure constants.

---

### Step 3 — Infrastructure: prompt-fetch error type

**File:** `apps/backend/src/infrastructure/prompts/errors.ts` (CREATE)

**What:** Infra-internal error type for prompt fetches. Never escapes the infra layer (per `RepositoryError` precedent in `repositories/errors/`).

**Code:**
```typescript
export class PromptFetchError extends Error {
  readonly code = "PROMPT_FETCH_FAILED";
  constructor(
    message: string,
    readonly promptKey: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PromptFetchError";
  }
}
```

**Invariant check:** Lives in infrastructure only. No re-export from any application barrel. Used internally by the prompt client; not exposed to use cases.

---

### Step 4 — Infrastructure: fallback templates

**File 4a:** `apps/backend/src/infrastructure/prompts/fallbacks/interview-planner.fallback.ts` (CREATE)

**What:** The exact text we want hosted in Langfuse as `interview-planner-v1`, rewritten with `{{var}}` placeholders. Variable names are kebab-or-snake case strings — pick `snake_case` to match the Langfuse skill's conventions (`{{job_description_json}}`).

**Code:**
```typescript
/**
 * Fallback template for the Langfuse `interview-planner-v1` prompt.
 *
 * Mirrors the body of the prompt hosted in Langfuse. When the Langfuse SDK
 * cannot reach the API (network failure, missing credentials, missing key)
 * the client falls back to this string and runs the same `{{var}}`
 * substitution locally via `prompt.compile(...)`.
 *
 * Keep this in sync with the hosted prompt body. When updating the hosted
 * version, also update this file and ship them in the same PR to avoid drift.
 */
export const INTERVIEW_PLANNER_FALLBACK = [
  "You are designing the plan for a short technical screening interview.",
  "Target duration: {{target_duration_minutes}} minutes. Maximum duration: {{max_duration_minutes}} minutes.",
  "",
  "Job description:",
  "{{job_description_json}}",
  "",
  "Candidate profile:",
  "{{candidate_profile_json}}",
  "",
  "Client instructions:",
  "{{client_instructions}}",
  "",
  "Produce 3-6 topics. Each topic should include 2-5 questions and a time allocation.",
  "The total time allocation should fit inside the target duration where possible.",
  "Use priority 'must_cover' for high-signal topics and 'if_time_permits' for optional topics.",
  "Put role-critical questions in mustAskQuestions.",
].join("\n");
```

**File 4b:** `apps/backend/src/infrastructure/prompts/fallbacks/interview-evaluator.fallback.ts` (CREATE)

**Code:**
```typescript
/**
 * Fallback template for the Langfuse `interview-evaluator-v1` prompt.
 * See the planner fallback for sync rules.
 */
export const INTERVIEW_EVALUATOR_FALLBACK = [
  "You are an experienced technical recruiter writing a structured screening report.",
  "Read the job description, candidate profile, client instructions, transcript, agent notes, and the agent's internal per-topic scores, then produce the report.",
  "",
  "Job description:",
  "{{job_description_json}}",
  "",
  "Candidate profile:",
  "{{candidate_profile_json}}",
  "",
  "Client instructions:",
  "{{client_instructions}}",
  "",
  "Transcript (chronological):",
  "{{transcript_json}}",
  "",
  "Agent notes (private observations during the interview):",
  "{{notes_json}}",
  "",
  "Agent internal scores (recorded mid-interview, 0-5 scale):",
  "{{internal_scores_json}}",
  "",
  "Rubric:",
  "{{rubric}}",
].join("\n");
```

**Invariant check:** Both files export pure string constants. No imports. Variable names match the Langfuse hosted template exactly (case-sensitive). The empty-instructions sentinel `(none)` that the original code produced for `clientInstructions.trim() === ""` is now produced at the **variable-assembly** site (Step 6/7), not in the template — the template just renders whatever value is passed.

---

### Step 5 — Infrastructure: Langfuse prompt client wrapper

**File:** `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts` (CREATE)

**What:** A thin, testable wrapper around `LangfuseClient.prompt.get`. Returns `Result<FetchedPrompt, PromptFetchError>` — never throws past its own boundary. The `FetchedPrompt` value carries the compiled string, an `isFallback` flag, and the SDK prompt object so adapters can call `.toJSON()` when linking telemetry.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import { LangfuseClient } from "@langfuse/client";
import { PromptFetchError } from "./errors.js";

// Structural type — keeps adapters decoupled from the SDK class. Real implementation
// satisfies it via the @langfuse/client TextPromptClient.
export interface LangfusePromptHandle {
  compile(variables: Record<string, string>): string;
  toJSON(): unknown;
  readonly isFallback: boolean;
}

export interface FetchedPrompt {
  readonly handle: LangfusePromptHandle;
  /** True when the SDK could not reach Langfuse and used the in-code fallback. */
  readonly isFallback: boolean;
}

export interface ILangfusePromptClient {
  /**
   * Fetch a text prompt by key. Always returns a usable handle thanks to the
   * `fallback` argument — the Result is `Err` only on genuinely unexpected SDK
   * errors (which is why we still wrap in Result.tryAsyncCatch).
   */
  getText(key: string, fallback: string): Promise<Result<FetchedPrompt, PromptFetchError>>;
}

export interface LangfusePromptClientConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

export class LangfusePromptClient implements ILangfusePromptClient {
  private readonly client: LangfuseClient;

  constructor(config: LangfusePromptClientConfig) {
    this.client = new LangfuseClient({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
    });
  }

  async getText(key: string, fallback: string): Promise<Result<FetchedPrompt, PromptFetchError>> {
    return Result.tryAsyncCatch(
      async () => {
        const handle = await this.client.prompt.get(key, { type: "text", fallback });
        return {
          handle: handle as unknown as LangfusePromptHandle,
          isFallback: Boolean((handle as { isFallback?: boolean }).isFallback),
        };
      },
      (err) =>
        new PromptFetchError(
          err instanceof Error ? err.message : String(err),
          key,
          err,
        ),
    ).toPromise();
  }
}

/**
 * Build the prompt client from env. Returns `Result.Err` when any of the three
 * Langfuse env vars is missing — the caller (composition root) decides whether
 * to inject a no-op client that always-fallbacks or hard-fail.
 *
 * We choose the always-fallback path in the compositions (see Step 8). That
 * lets local dev without Langfuse credentials still exercise the planner and
 * evaluator paths end-to-end.
 */
export const langfusePromptClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<LangfusePromptClient, PromptFetchError> => {
  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  const baseUrl = env["LANGFUSE_BASE_URL"];

  if (!publicKey || !secretKey || !baseUrl) {
    return Result.Err(
      new PromptFetchError(
        "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL not all set",
        "<bootstrap>",
      ),
    );
  }

  return Result.Ok(new LangfusePromptClient({ publicKey, secretKey, baseUrl }));
};

/**
 * No-op client used when Langfuse credentials are absent. Every fetch returns
 * a synthetic handle whose `compile` runs the same `{{var}}` substitution the
 * real SDK would; `isFallback` is true so adapters skip the `langfusePrompt`
 * telemetry attachment.
 */
export class NullLangfusePromptClient implements ILangfusePromptClient {
  async getText(_key: string, fallback: string): Promise<Result<FetchedPrompt, PromptFetchError>> {
    const handle: LangfusePromptHandle = {
      isFallback: true,
      compile: (variables) => renderTemplate(fallback, variables),
      toJSON: () => ({ kind: "null-langfuse-prompt-client", fallback }),
    };
    return Result.Ok({ handle, isFallback: true });
  }
}

/**
 * Minimal `{{var}}` renderer used only by the NullLangfusePromptClient. It
 * intentionally does NOT support conditionals, loops, or filters — same
 * surface as Langfuse hosted templates.
 */
export const renderTemplate = (template: string, variables: Record<string, string>): string =>
  Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template,
  );
```

**Invariant check:**
- No `throw` — `Result.tryAsyncCatch` + `.toPromise()` only.
- `LangfusePromptHandle` is a structural interface so we can swap the SDK without touching adapters or tests.
- Exposes `ILangfusePromptClient` so adapters depend on the abstraction; production wiring uses `LangfusePromptClient`; tests inject doubles.
- `renderTemplate` is exported for unit-testing.

---

### Step 6 — Infrastructure: refactor `gemini-interview-planner.service.ts`

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts` (MODIFY)

**What:** Inject `ILangfusePromptClient`, replace inline `buildPrompt` with a variable-assembly helper + Langfuse fetch + compile, attach `langfusePrompt` metadata when not a fallback. The Zod-equivalent JSON schema, `liftPlan`, and error mapping stay untouched.

**Code (delta — full file rewrite shown for clarity; bold edits highlighted in prose):**
```typescript
import { Result } from "@carbonteq/fp";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, RetryError } from "ai";
import {
  type IInterviewPlannerService,
  type InterviewPlannerInput,
  PlannerOutputInvalidError,
  PlannerUnavailableError,
  PlannerUnknownError,
  type PlannerError,
} from "@repo/application";
import {
  DEFAULT_MAX_DURATION_MIN,
  DEFAULT_TARGET_DURATION_MIN,
  InterviewPlan,
  type InterviewPlanSerialized,
  PlannedTopic,
  type PlannedTopicProps,
  TOPIC_PRIORITY,
} from "@repo/domain";
import type { GeminiProviderHandle } from "./provider.js";
import type { ILangfusePromptClient } from "../../prompts/langfuse-prompt-client.js";
import { PROMPT_KEYS } from "../../prompts/prompt-keys.js";
import { INTERVIEW_PLANNER_FALLBACK } from "../../prompts/fallbacks/interview-planner.fallback.js";

// ... (planSchema, isInterviewPlanSerialized, isLikelyUnavailableError, mapAiError, liftPlan
//      unchanged — keep exactly as today.)

const buildVariables = (input: InterviewPlannerInput): Record<string, string> => {
  const targetDurationMinutes = input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN;
  const maxDurationMinutes = input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN;

  return {
    target_duration_minutes: String(targetDurationMinutes),
    max_duration_minutes: String(maxDurationMinutes),
    job_description_json: JSON.stringify(input.jobDescription.serialize(), null, 2),
    candidate_profile_json: JSON.stringify(input.candidateInfo.serialize(), null, 2),
    client_instructions: input.clientInstructions.trim() ? input.clientInstructions : "(none)",
  };
};

export class GeminiInterviewPlannerService implements IInterviewPlannerService {
  constructor(
    private readonly handle: GeminiProviderHandle,
    private readonly prompts: ILangfusePromptClient,
  ) {}

  async generatePlan(input: InterviewPlannerInput): Promise<Result<InterviewPlan, PlannerError>> {
    const fetched = await this.prompts.getText(
      PROMPT_KEYS.INTERVIEW_PLANNER,
      INTERVIEW_PLANNER_FALLBACK,
    );

    // Even on Err the adapter must still run. Map the Err into a Null-equivalent handle
    // by building a synthetic FetchedPrompt that compiles the fallback locally.
    const fetchedOk = fetched.isOk()
      ? fetched.unwrap()
      : {
          isFallback: true,
          handle: {
            isFallback: true,
            compile: (vars: Record<string, string>) =>
              Object.entries(vars).reduce(
                (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
                INTERVIEW_PLANNER_FALLBACK,
              ),
            toJSON: () => ({ kind: "fallback-on-error", key: PROMPT_KEYS.INTERVIEW_PLANNER }),
          },
        };

    const variables = buildVariables(input);
    const compiledPrompt = fetchedOk.handle.compile(variables);

    const telemetryMetadata: Record<string, unknown> = {
      interviewId: input.interviewId,
      targetDurationMinutes: input.targetDurationMinutes ?? DEFAULT_TARGET_DURATION_MIN,
      maxDurationMinutes: input.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MIN,
    };

    // Only attach the prompt linkage when the SDK returned a real (non-fallback) prompt.
    // Per Langfuse docs: when fallback is used, no link is created.
    if (!fetchedOk.isFallback) {
      telemetryMetadata["langfusePrompt"] = fetchedOk.handle.toJSON();
    }

    return Result.tryAsyncCatch(
      () =>
        generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: planSchema,
            name: "InterviewPlan",
            description:
              "Structured plan for a screening interview scoped to the given job and candidate.",
          }),
          prompt: compiledPrompt,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewPlannerService.generatePlan",
            metadata: telemetryMetadata,
          },
        }),
      mapAiError(input.interviewId),
    )
      .flatMap((res) => liftPlan(res.output, input.interviewId))
      .toPromise();
  }
}
```

**Invariant check:**
- No new throws/try-catch in product code.
- Service port (`IInterviewPlannerService`) signature unchanged — `InterviewPlannerInput` and `PlannerError` are untouched.
- `langfusePrompt` only attached when the SDK confirms a real fetch (matches docs).
- Compiled prompt is never logged.
- Fallback-on-error path is structurally distinct from SDK-fallback path: both end up with `isFallback: true`, both run a local `replaceAll` substitution, both skip the telemetry link. This duplicates the renderer logic by ~3 lines — that is intentional to avoid an import cycle with the no-op renderer in Step 5; consolidate later if it grows.

---

### Step 7 — Infrastructure: refactor `gemini-interview-evaluator.service.ts`

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts` (MODIFY)

**What:** Same shape as Step 6. The evaluator already wraps `generateText` in a custom OTel span — that wrapping stays as-is; only the prompt-building section changes.

**Code (delta showing the changed parts only):**
```typescript
import type { ILangfusePromptClient } from "../../prompts/langfuse-prompt-client.js";
import { PROMPT_KEYS } from "../../prompts/prompt-keys.js";
import { INTERVIEW_EVALUATOR_FALLBACK } from "../../prompts/fallbacks/interview-evaluator.fallback.js";

// ... (evaluatorSchema, isEvaluatorRawOutput, mapAiError, liftReport unchanged.)

const buildVariables = (input: InterviewEvaluatorInput): Record<string, string> => ({
  job_description_json: JSON.stringify(input.jobDescription.serialize(), null, 2),
  candidate_profile_json: JSON.stringify(input.candidateInfo.serialize(), null, 2),
  client_instructions: input.clientInstructions.trim() ? input.clientInstructions : "(none)",
  transcript_json: JSON.stringify(input.transcript.map((entry) => entry.serialize()), null, 2),
  notes_json: JSON.stringify(input.notes.map((note) => note.serialize()), null, 2),
  internal_scores_json: JSON.stringify(input.internalScores.map((score) => score.serialize()), null, 2),
  rubric: input.rubric,
});

export class GeminiInterviewEvaluatorService implements IInterviewEvaluatorService {
  constructor(
    private readonly handle: GeminiProviderHandle,
    private readonly prompts: ILangfusePromptClient,
  ) {}

  async evaluate(input: InterviewEvaluatorInput): Promise<Result<ReportCreateProps, EvaluatorError>> {
    const fetched = await this.prompts.getText(
      PROMPT_KEYS.INTERVIEW_EVALUATOR,
      INTERVIEW_EVALUATOR_FALLBACK,
    );

    const fetchedOk = fetched.isOk()
      ? fetched.unwrap()
      : {
          isFallback: true,
          handle: {
            isFallback: true,
            compile: (vars: Record<string, string>) =>
              Object.entries(vars).reduce(
                (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
                INTERVIEW_EVALUATOR_FALLBACK,
              ),
            toJSON: () => ({ kind: "fallback-on-error", key: PROMPT_KEYS.INTERVIEW_EVALUATOR }),
          },
        };

    const variables = buildVariables(input);
    const compiledPrompt = fetchedOk.handle.compile(variables);

    const span: Span = tracer.startSpan("interview.evaluation", {
      attributes: {
        "interview.id": input.interviewId,
        "evaluator.model": this.handle.defaultModel,
        "evaluator.transcript_entries": input.transcript.length,
        "evaluator.notes": input.notes.length,
        "evaluator.internal_scores": input.internalScores.length,
      },
    });

    const telemetryMetadata: Record<string, unknown> = {
      interviewId: input.interviewId,
      transcriptEntries: input.transcript.length,
      notes: input.notes.length,
      internalScores: input.internalScores.length,
    };
    if (!fetchedOk.isFallback) {
      telemetryMetadata["langfusePrompt"] = fetchedOk.handle.toJSON();
    }

    const result = await Result.tryAsyncCatch(
      async () => {
        const res = await generateText({
          model: this.handle.provider(this.handle.defaultModel),
          output: Output.object({
            schema: evaluatorSchema,
            name: "InterviewEvaluation",
            description:
              "Structured screening report scored against the supplied rubric, transcript, JD, and CV.",
          }),
          prompt: compiledPrompt,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "GeminiInterviewEvaluatorService.evaluate",
            metadata: telemetryMetadata,
          },
        });

        span.setAttribute("evaluator.stop_reason", "stop");
        return res.output;
      },
      (err) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        return mapAiError(input.interviewId)(err);
      },
    )
      .flatMap((raw) => liftReport(raw, input.interviewId))
      .toPromise();

    span.end();
    return result;
  }
}
```

**Invariant check:** Same as Step 6. Custom OTel span behaviour unchanged. Constructor gains one parameter; nothing else is touched.

---

### Step 8 — Composition: wire the prompt client into both compositions

**File 8a:** `apps/backend/src/composition/generate-interview-plan.composition.ts` (MODIFY)

**What:** Build the prompt client at boot via `langfusePromptClientFromEnv`; on Err (missing creds, local dev), fall back to `NullLangfusePromptClient`. Inject into `GeminiInterviewPlannerService`.

**Code (delta):**
```typescript
import {
  langfusePromptClientFromEnv,
  NullLangfusePromptClient,
  type ILangfusePromptClient,
} from "../infrastructure/prompts/langfuse-prompt-client.js";

export function buildGenerateInterviewPlanDeps(
  options: GenerateInterviewPlanCompositionOptions,
): GenerateInterviewPlanDepsBundle {
  const env = options.env ?? process.env;
  const geminiHandle = geminiProviderFromEnv(env);
  if (geminiHandle.isErr()) {
    throw new Error(`Boot failed: ${geminiHandle.unwrapErr().message}`);
  }

  const promptClientResult = langfusePromptClientFromEnv(env);
  const promptClient: ILangfusePromptClient = promptClientResult.isOk()
    ? promptClientResult.unwrap()
    : new NullLangfusePromptClient();

  const db: Database =
    options.db ??
    (
      require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")
    ).db;

  const interviews = new DrizzleInterviewRepository(db);
  const planner = new GeminiInterviewPlannerService(geminiHandle.unwrap(), promptClient);

  return {
    buildUseCase: () => new GenerateInterviewPlanUseCase(interviews, planner),
    candidateLink: options.candidateLink,
  };
}
```

**File 8b:** `apps/backend/src/composition/evaluate-interview.composition.ts` (MODIFY)

**Code (delta):**
```typescript
import {
  langfusePromptClientFromEnv,
  NullLangfusePromptClient,
  type ILangfusePromptClient,
} from "../infrastructure/prompts/langfuse-prompt-client.js";

export function buildEvaluateInterviewDeps(
  options: EvaluateInterviewCompositionOptions = {},
): EvaluateInterviewDepsBundle {
  const env = options.env ?? process.env;
  const geminiHandleResult = geminiProviderFromEnv(env);
  if (geminiHandleResult.isErr()) {
    throw new Error(`Boot failed: ${geminiHandleResult.unwrapErr().message}`);
  }

  const promptClientResult = langfusePromptClientFromEnv(env);
  const promptClient: ILangfusePromptClient = promptClientResult.isOk()
    ? promptClientResult.unwrap()
    : new NullLangfusePromptClient();

  const db: Database =
    options.db ??
    (require("../infrastructure/persistence/db.js") as typeof import("../infrastructure/persistence/db.js")).db;

  const interviews = new DrizzleInterviewRepository(db);
  const reports = new DrizzleReportRepository(db);
  const evaluator = new GeminiInterviewEvaluatorService(geminiHandleResult.unwrap(), promptClient);

  return {
    buildEvaluateUseCase: () =>
      new EvaluateInterviewUseCase({ interviews, reports, evaluator }),
    buildGetReportUseCase: () => new GetReportByInterviewIdUseCase(reports),
  };
}
```

**Invariant check:** Composition root still owns env reading and boot-time error handling. Two compositions independently instantiate one client each — that is acceptable for 7.5 (one extra HTTP client object per composition). If/when a third adapter migrates, hoist `promptClient` to a shared `prompts.composition.ts`.

---

### Step 9 — Infrastructure: barrel for the new directory

**File:** `apps/backend/src/infrastructure/prompts/index.ts` (CREATE)

**Code:**
```typescript
export {
  LangfusePromptClient,
  NullLangfusePromptClient,
  langfusePromptClientFromEnv,
  renderTemplate,
  type FetchedPrompt,
  type ILangfusePromptClient,
  type LangfusePromptClientConfig,
  type LangfusePromptHandle,
} from "./langfuse-prompt-client.js";
export { PROMPT_KEYS, type PromptKey } from "./prompt-keys.js";
export { PromptFetchError } from "./errors.js";
export { INTERVIEW_PLANNER_FALLBACK } from "./fallbacks/interview-planner.fallback.js";
export { INTERVIEW_EVALUATOR_FALLBACK } from "./fallbacks/interview-evaluator.fallback.js";
```

**Invariant check:** Internal barrel only. Not re-exported from any `@repo/*` package.

---

## Pseudo-workflow — single planner call

```
1. POST /recruiter/interviews/:id/plan
2. controller calls GenerateInterviewPlanUseCase.execute(...)
3. use case calls plannerService.generatePlan(input)
   └── input contains jobDescription, candidateInfo, clientInstructions, durations
4. Service: await this.prompts.getText("interview-planner-v1", INTERVIEW_PLANNER_FALLBACK)
   ├── SUCCESS path (Langfuse Cloud reachable, key seeded):
   │     Result.Ok({ handle, isFallback: false })
   │     handle wraps the real SDK prompt
   └── FAILURE paths:
        a. SDK-internal fallback (network blip, key missing in Langfuse) →
           Result.Ok({ handle, isFallback: true })  // SDK gave us its own fallback handle
        b. Unexpected SDK error (auth, server 500 with no fallback support) →
           Result.Err(PromptFetchError) → adapter synthesises a local fallback handle inline
5. variables = buildVariables(input) // serialise JD/CV/instructions, stringify durations
6. compiledPrompt = handle.compile(variables) // {{...}} substitution; identical text shape to today
7. telemetryMetadata = { interviewId, targetDurationMinutes, maxDurationMinutes,
                         ...(isFallback ? {} : { langfusePrompt: handle.toJSON() }) }
8. generateText({ model, output: Output.object({ schema, ... }), prompt: compiledPrompt,
                  experimental_telemetry: { isEnabled: true, functionId, metadata: telemetryMetadata } })
9. liftPlan(res.output, interviewId) // unchanged
10. Return Result<InterviewPlan, PlannerError>
11. Use case persists plan via interviews repo; controller renders 200 OK
```

The evaluator flow is identical except for the additional `interview.evaluation` OTel span around steps 8-9 (preserved from today) and the variable set.

---

## Entry points (dependency order — innermost first)

| #  | File                                                                                          | Layer          | Operation | Purpose |
| -- | --------------------------------------------------------------------------------------------- | -------------- | --------- | ------- |
| 1  | `apps/backend/package.json`                                                                   | infra (dep)    | MODIFY    | Add `@langfuse/client` |
| 2  | `apps/backend/src/infrastructure/prompts/prompt-keys.ts`                                      | infra          | CREATE    | Typed prompt-key constants |
| 3  | `apps/backend/src/infrastructure/prompts/errors.ts`                                           | infra          | CREATE    | `PromptFetchError` (infra-internal) |
| 4  | `apps/backend/src/infrastructure/prompts/fallbacks/interview-planner.fallback.ts`             | infra          | CREATE    | Planner fallback string |
| 5  | `apps/backend/src/infrastructure/prompts/fallbacks/interview-evaluator.fallback.ts`           | infra          | CREATE    | Evaluator fallback string |
| 6  | `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts`                           | infra          | CREATE    | SDK wrapper, Null client, env factory |
| 7  | `apps/backend/src/infrastructure/prompts/index.ts`                                            | infra          | CREATE    | Barrel for `prompts/` |
| 8  | `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts`         | infra          | MODIFY    | Inject client, replace `buildPrompt`, attach `langfusePrompt` |
| 9  | `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts`       | infra          | MODIFY    | Same shape as planner |
| 10 | `apps/backend/src/composition/generate-interview-plan.composition.ts`                         | composition    | MODIFY    | Build + inject client; fall back to Null on missing env |
| 11 | `apps/backend/src/composition/evaluate-interview.composition.ts`                              | composition    | MODIFY    | Same |
| 12 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts`    | infra (tests)  | MODIFY    | Add fake client, fallback path, metadata assertion |
| 13 | `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts`  | infra (tests)  | MODIFY    | Same |
| 14 | `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.test.ts`                      | infra (tests)  | CREATE    | Unit test for client wrapper + renderer + Null client |

---

## Test plan

### Do NOT do

- No tests that hit the real Langfuse API. Mock `@langfuse/client` at the test boundary or inject a fake `ILangfusePromptClient`.
- No assertions on log output unless explicitly testing the "do not log rendered prompt" invariant (Step 12 includes one negative log assertion).

### Step 12 — Planner service tests

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts` (MODIFY)

**Add to the existing `createHandle()` block:** a fake prompt client factory.

```typescript
import type {
  FetchedPrompt,
  ILangfusePromptClient,
  LangfusePromptHandle,
} from "../../prompts/langfuse-prompt-client.js";

const makeFakeHandle = (compiledOutput: string, isFallback: boolean): LangfusePromptHandle => ({
  isFallback,
  compile: vi.fn(() => compiledOutput),
  toJSON: vi.fn(() => ({ name: "interview-planner-v1", version: 3, isFallback })),
});

const makeFakePromptClient = (handle: LangfusePromptHandle, isFallback: boolean): ILangfusePromptClient => ({
  getText: vi.fn(async () =>
    Result.Ok<FetchedPrompt, never>({ handle, isFallback }) as Result<FetchedPrompt, PromptFetchError>,
  ),
});
```

**New tests to add:**

1. **`attaches langfusePrompt metadata when Langfuse returns a non-fallback prompt`** — fake client returns `isFallback: false`; assert `options.experimental_telemetry.metadata.langfusePrompt` equals `{ name: "interview-planner-v1", version: 3, isFallback: false }`.
2. **`omits langfusePrompt metadata when SDK returns a fallback handle`** — fake client returns `isFallback: true`; assert metadata key is absent. Assert plan generation still succeeds.
3. **`falls back to in-code template when prompt client returns Err`** — fake client `getText` returns `Result.Err(new PromptFetchError(...))`; assert `generateText` was still called with a prompt string that contains "You are designing the plan" and the JD title.
4. **`passes the rendered prompt to generateText`** — assert the compiled prompt includes `"Senior Backend Engineer"`, `"Ada Lovelace"`, `"Focus on backend depth."` exactly as the existing assertions check, even after the refactor.
5. **`does not include raw JD/CV text in vitest console output`** — wrap the call with a `vi.spyOn(console, "log")` (and `error`/`warn`); assert none of the calls contain candidate name or CV body. Defensive — guards the PII rule.

**Update existing tests:** the three existing assertions that check prompt content (`"Senior Backend Engineer"`, `"Ada Lovelace"`, `"Focus on backend depth."`) must continue to pass after the refactor. Inject `makeFakePromptClient(makeFakeHandle(<built-by-test>, false), false)` into the service constructor and have the fake `compile` return the same template body the production fallback would produce — easiest: set `compile` to actually invoke `renderTemplate(INTERVIEW_PLANNER_FALLBACK, vars)`.

### Step 13 — Evaluator service tests

**File:** `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts` (MODIFY)

Mirror Step 12 with evaluator-specific assertions:

1. Same metadata-attach / fallback-omit / Err-fallback / PII-log tests.
2. **Preserve OTel span assertion** (the existing test verifies `tracer.startSpan` was called with `interview.evaluation`). Do not break this — the span code is untouched.
3. Compiled-prompt content assertions should target `"You are an experienced technical recruiter"`, the rubric text, and the candidate name as today.

### Step 14 — Prompt client unit tests

**File:** `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.test.ts` (CREATE)

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  LangfusePromptClient,
  NullLangfusePromptClient,
  renderTemplate,
  langfusePromptClientFromEnv,
} from "./langfuse-prompt-client.js";
import { PromptFetchError } from "./errors.js";

vi.mock("@langfuse/client", () => {
  const get = vi.fn();
  return {
    LangfuseClient: vi.fn(() => ({ prompt: { get } })),
    __get: get, // exposed for the test
  };
});

describe("renderTemplate", () => {
  it("substitutes single-variable templates", () => {
    expect(renderTemplate("Hello {{name}}", { name: "Ada" })).toBe("Hello Ada");
  });

  it("substitutes the same variable in multiple places", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });

  it("leaves unknown placeholders intact (Langfuse-parity)", () => {
    expect(renderTemplate("Hi {{name}}, {{unknown}}", { name: "Ada" })).toBe(
      "Hi Ada, {{unknown}}",
    );
  });
});

describe("NullLangfusePromptClient", () => {
  it("always returns Ok with isFallback=true", async () => {
    const c = new NullLangfusePromptClient();
    const r = await c.getText("any-key", "Hi {{name}}");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap().isFallback).toBe(true);
    expect(r.unwrap().handle.compile({ name: "Ada" })).toBe("Hi Ada");
  });
});

describe("LangfusePromptClient", () => {
  it("returns Ok with isFallback=false when SDK returns a real prompt", async () => {
    const mod = await import("@langfuse/client") as unknown as { __get: ReturnType<typeof vi.fn> };
    mod.__get.mockResolvedValue({
      isFallback: false,
      compile: () => "compiled",
      toJSON: () => ({ name: "k", version: 2 }),
    });
    const c = new LangfusePromptClient({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.example" });
    const r = await c.getText("k", "fallback");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap().isFallback).toBe(false);
  });

  it("returns Ok with isFallback=true when SDK reports fallback", async () => {
    const mod = await import("@langfuse/client") as unknown as { __get: ReturnType<typeof vi.fn> };
    mod.__get.mockResolvedValue({
      isFallback: true,
      compile: () => "fb",
      toJSON: () => ({}),
    });
    const c = new LangfusePromptClient({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.example" });
    const r = await c.getText("k", "fallback");
    expect(r.isOk()).toBe(true);
    expect(r.unwrap().isFallback).toBe(true);
  });

  it("returns Err(PromptFetchError) when SDK throws", async () => {
    const mod = await import("@langfuse/client") as unknown as { __get: ReturnType<typeof vi.fn> };
    mod.__get.mockRejectedValue(new Error("boom"));
    const c = new LangfusePromptClient({ publicKey: "pk", secretKey: "sk", baseUrl: "https://lf.example" });
    const r = await c.getText("k", "fallback");
    expect(r.isErr()).toBe(true);
    expect(r.unwrapErr()).toBeInstanceOf(PromptFetchError);
  });
});

describe("langfusePromptClientFromEnv", () => {
  it("returns Err when any env var is missing", () => {
    expect(langfusePromptClientFromEnv({}).isErr()).toBe(true);
    expect(
      langfusePromptClientFromEnv({
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      }).isErr(),
    ).toBe(true);
  });

  it("returns Ok with all three vars present", () => {
    const r = langfusePromptClientFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk",
      LANGFUSE_SECRET_KEY: "sk",
      LANGFUSE_BASE_URL: "https://lf.example",
    });
    expect(r.isOk()).toBe(true);
  });
});
```

---

## Verification checklist (run in order after implementation)

```bash
# 1. Types clean across all touched packages
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# 2. Backend tests — should include the new prompt client test, planner test, evaluator test
pnpm turbo run test --filter=backend

# 3. Domain + application tests — must remain green (no edits there)
pnpm turbo run test --filter=@repo/domain --filter=@repo/application

# 4. Manual smoke — Langfuse hit path
#    Prereq: seed `interview-planner-v1` and `interview-evaluator-v1` in Langfuse UI.
#    Env: LANGFUSE_PUBLIC_KEY/SECRET_KEY/BASE_URL set + GOOGLE_GENERATIVE_AI_API_KEY set.
pnpm --filter backend dev
# Create an interview via the recruiter API, then POST /recruiter/interviews/:id/plan
# In Langfuse UI → Traces → click the generation → confirm the Prompt panel shows
# "interview-planner-v1 v<N>". Then POST evaluate; confirm "interview-evaluator-v1 v<N>".

# 5. Manual smoke — fallback path
#    Unset LANGFUSE_PUBLIC_KEY then restart server. Run the same plan + evaluate calls.
#    Expectation: both succeed end-to-end. Langfuse UI shows the generation but no
#    prompt linkage (since the SDK never reached Langfuse and we skip toJSON()).

# 6. Manual smoke — partial fallback
#    Set Langfuse env vars but rename the seeded prompts in the UI (or delete one).
#    Expectation: both still succeed; the renamed/deleted one runs via SDK-internal
#    fallback (`isFallback: true`), no link in the trace; the other still links.
```

Task is complete when the type-check and three test commands are clean AND at least one of the three manual smokes (5 is mandatory) has been confirmed.

---

## Risk callouts

1. **SDK confusion** — two `langfuse-family` packages coexist (`langfuse@3.x` for OTel transitive, `@langfuse/client` for prompts). Adapters must import only from `@langfuse/client`. The plan client is the single allowlisted import site; lint enforcement is out of scope but a future ADR-020 enforcement block could `forbid_import` `from "langfuse"` outside `infrastructure/observability/`.
2. **Prompt-not-found at startup** — the SDK's `fallback` option means a missing key never throws; we never block boot. But the trace will silently lose its `langfusePrompt` link. Mitigation: include the bootstrap step in the deployment runbook; the manual smoke (#4) catches the linkage path; #6 catches the partial-fallback case.
3. **PII in rendered prompt logs** — the rendered prompt MUST NOT be logged. Guard in code: never pass `compiledPrompt` to pino. Guard in tests: Step 12/13 #5 negative log assertion. Guard in ops: the OTel span still carries the same data, but that is already covered by ADR-004.
4. **Version drift between code fallback and hosted prompt** — the fallback is a snapshot; the hosted version can be edited in the Langfuse UI independent of code. This is by design (the whole point of hosting), but means a long-running prod outage with the fallback active will use stale prompt text. Mitigation: when meaningful changes ship to the hosted prompt, port the change back to the fallback constant in the same PR. Note this in the PR template later.
5. **`baseUrl` env var name mismatch** — our env is `LANGFUSE_BASE_URL`; the SDK reads `LANGFUSE_BASEURL` by default. The client wrapper passes `baseUrl` explicitly to avoid the silent fallback to the SDK's default. Test in Step 14 confirms the wrapper instantiates with the correct value.
6. **Two `LangfuseClient` instances at runtime** — the two compositions independently call `langfusePromptClientFromEnv`. Per @langfuse/client docs, this is safe (each holds its own HTTP keep-alive). If we add a third migrated adapter, hoist construction into `apps/backend/src/composition/prompts.composition.ts` and inject the same instance everywhere.
7. **Telemetry shape regression** — Step 6/7 reshape `experimental_telemetry.metadata` from a static literal to a built object. The Step 12 existing test `expect(options["experimental_telemetry"]).toEqual({ isEnabled: true, functionId: ..., metadata: {...} })` uses `toEqual`, which fails when an extra `langfusePrompt` key is present. The updated test must split into two cases (Step 12 tests #1 and #2) and not use deep equality on the whole metadata object — switch to `expect.objectContaining(...)` for the always-present fields.
8. **`replaceAll` for `{{var}}` is order-independent only because Langfuse keys don't contain `{{`** — if a variable name accidentally collides with a Langfuse syntax token (e.g. `{{nested}}` appearing inside another variable's value), our `renderTemplate` is naive. Acceptable for now because all variable values are either JSON strings (which won't contain `{{var}}` patterns) or known short literals (durations, instructions, rubric). Document in the file header.

---

## Deferred follow-ups (post-7.5)

1. **Agent prompt hosting** — `gemini-interview-agent.service.ts` builds prompts dynamically per turn with conversation state. The `{{var}}` substitution surface doesn't map cleanly. Defer until either (a) we standardise the agent's turn-prompt to a stable skeleton with a single `{{history_json}}` variable, or (b) Langfuse adds a richer templating tier.
2. **Document-extraction prompt hosting** — `gemini-document-extraction.service.ts`. Two short, stable user-text prompts. Low iteration value today; revisit when we have signal that JD/CV extraction quality needs tuning.
3. **Drop `langfuse@3.x` dep** — once `@langfuse/otel` upgrades to a version that no longer pulls `langfuse@3.x`, remove the dep from `package.json`.
4. **Self-host evaluation** — ADR-004 §Risks names compliance as the trigger. Tracked separately under Phase 10 hardening.
5. **ADR-020 authoring** — user will run `/adr-kit:adr` separately. Suggested title: *"Host Planner and Evaluator Prompts in Langfuse with In-Code Fallbacks"*. Suggested Enforcement block: `forbid_import` against `from "@langfuse/client"` outside `apps/backend/src/infrastructure/prompts/`; `llm_judge: true` for the "no rendered prompt logging" invariant.
6. **Shared prompts composition root** — hoist `langfusePromptClientFromEnv()` into `apps/backend/src/composition/prompts.composition.ts` when adapter count >= 3.
7. **Lint rule for env var spelling** — `LANGFUSE_BASE_URL` vs SDK default `LANGFUSE_BASEURL` is a real footgun. Consider a project-level `env-keys.ts` constants file.
8. **A/B labeling strategy** — today we always fetch `production`. When iteration starts, document a `staging` label workflow (Langfuse UI → label new version `staging` → flip a per-environment env flag to read `staging`). Not needed now.
