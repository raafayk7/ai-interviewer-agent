# Phase 7.5 Progress

## Phase 7.5 Complete

This document records the Phase 7.5 changes for the **AI interviewer** monorepo, scoped to Langfuse-hosted prompt templates for the planner and evaluator.

Phase 7.5 goal:

- move planner and evaluator prompt template text out of Gemini adapter string literals
- fetch `interview-planner-v1` and `interview-evaluator-v1` through `@langfuse/client`
- keep code-resident fallback templates for missing credentials, unavailable Langfuse, or missing prompt keys
- attach `experimental_telemetry.metadata.langfusePrompt` only for real non-fallback prompt versions
- preserve existing application ports, output schemas, use cases, and presentation behavior

Plan source: `.claude/plan/phase-7-5-langfuse-prompt-hosting.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs authored:
- [ADR-020](../adr/ADR-020-host-llm-prompts-in-langfuse-with-code-resident-fallbacks.md) — host planner (`interview-planner-v1`) and evaluator (`interview-evaluator-v1`) system prompts in Langfuse via `@langfuse/client` with a three-layer code-resident fallback (`NullLangfusePromptClient` when env missing → SDK-native `isFallback` handle on unreachable Langfuse → synthetic local handle on unexpected `Result.Err`); `langfusePrompt` telemetry metadata attached only on real hosted versions; infrastructure-only change. Status: Proposed. Enforcement block uses `llm_judge: true`.

---

## Summary

Completed:

- **Dependency and prompt module:** Added `@langfuse/client` to `backend` and created `apps/backend/src/infrastructure/prompts/` with prompt key constants, `PromptFetchError`, planner/evaluator fallback templates, a Langfuse prompt client wrapper, a null fallback client, shared `renderTemplate`, and prompt-module tests.
- **Planner adapter:** Updated `GeminiInterviewPlannerService` to inject `ILangfusePromptClient`, assemble Langfuse variables from existing planner input, compile the fetched or fallback prompt, and add `langfusePrompt` telemetry only on the hosted-prompt success path.
- **Evaluator adapter:** Updated `GeminiInterviewEvaluatorService` with the same prompt-client flow while preserving the `interview.evaluation` span, evaluator JSON schema, AI error mapping, and report-lifting behavior.
- **Composition:** Wired `langfusePromptClientFromEnv` into generate-plan, evaluate-interview, and recruiter-interview composition roots. Missing Langfuse env now falls back to `NullLangfusePromptClient` so local dev can still plan/evaluate with the in-code templates.
- **Tests:** Added prompt module tests and updated planner/evaluator tests to cover hosted-link metadata, SDK fallback/no-link behavior, and unexpected prompt-client error fallback. Updated composition tests for configured and null prompt clients.

Explicitly **not** included in this work:

- agent prompt hosting in `gemini-interview-agent.service.ts`
- document-extraction prompt hosting
- programmatic Langfuse prompt seeding
- ADR-020 authoring or ADR status changes
- frontend/admin prompt management UI
- self-hosted Langfuse changes

---

## Implementation Notes

`@langfuse/client` was added alongside the existing `langfuse@3.38.20` dependency. The existing `langfuse` package remains because it is tied to the current `@langfuse/otel` path; product code imports `@langfuse/client` only inside the new prompt infrastructure wrapper.

The backend env var remains `LANGFUSE_BASE_URL`. `langfusePromptClientFromEnv` passes that value explicitly as `baseUrl`, avoiding the SDK default env-name mismatch with `LANGFUSE_BASEURL`.

Fallbacks are layered. With no Langfuse credentials, composition injects `NullLangfusePromptClient`. With SDK-supported fallback, the SDK returns an `isFallback` handle. With an unexpected prompt-client `Err`, the Gemini adapters synthesize a local fallback handle. All fallback paths skip `langfusePrompt` metadata.

The rendered prompt is never logged. It is only passed to `generateText`, preserving the existing Langfuse/OTel generation trace behavior.

---

## Verification

Commands run and passing:

```bash
pnpm --filter backend add @langfuse/client
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm --filter backend check-types
pnpm --filter backend test -- src/infrastructure/prompts src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts src/composition/evaluate-interview.composition.test.ts
pnpm turbo run test --filter=@repo/domain --filter=@repo/application
pnpm turbo run test --filter=backend
pnpm --filter backend exec eslint --max-warnings 0 src/infrastructure/prompts src/infrastructure/services/gemini/gemini-interview-planner.service.ts src/infrastructure/services/gemini/gemini-interview-planner.service.test.ts src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts src/infrastructure/services/gemini/gemini-interview-evaluator.service.test.ts src/composition/evaluate-interview.composition.ts src/composition/evaluate-interview.composition.test.ts src/composition/generate-interview-plan.composition.ts src/composition/recruiter-interview.composition.ts
git diff --check
```

Results:

- domain tests: **144 passed**
- application tests: **104 passed**
- focused backend tests: **32 passed**
- full backend tests: **216 passed**
- type-check passed for `@repo/domain`, `@repo/application`, and `backend`
- ESLint passed for touched backend files

The full backend suite required restarting the local `ai_interviewer_test_pg` Docker container for `TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test`. After the container became healthy, the Drizzle repository integration tests passed with the rest of the suite.

Architecture checks:

- no infrastructure imports from presentation in touched files
- no new direct `throw`, `try`, or `catch` in touched infrastructure files
- `@langfuse/client` is imported only by `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts`
- rendered prompt variables are not logged to console, pino, or Fastify logger

---

## Code Review

`backend-arch-validator` review result: **PASS**.

Checked the new prompt infrastructure and modified Gemini adapters for boundary imports, expected-failure handling, prompt logging, and telemetry fallback behavior. No boundary violations or FP correctness issues were found.

`backend-code-reviewer` returned **PASS** on first pass.

Reviewed Clean Architecture boundaries, `@carbonteq/fp` correctness (no `throw`/`try`/`catch` in production infrastructure; `Result.tryAsyncCatch` used in the Langfuse client wrapper), three-layer fallback wiring across `NullLangfusePromptClient`, SDK-native `isFallback`, and the synthetic `fallbackFetchedPrompt` handle in the Gemini services, zero edits to `packages/domain/` or `packages/application/`, `@langfuse/client` confined to `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts`, `experimental_telemetry.metadata.langfusePrompt` attached only when `handle.isFallback === false`, no rendered-prompt logging on any path, and per-service test coverage for hosted-success, SDK-fallback, and unexpected-`Err` fallback paths.

Non-blocking style notes (not addressed):
- The `fallbackFetchedPrompt(key, fallback)` helper is duplicated between `gemini-interview-planner.service.ts` and `gemini-interview-evaluator.service.ts` (~16 lines). Could be lifted to a shared `infrastructure/prompts/synthesize-fallback-handle.ts`. Plan called this out as intentional for 7.5.
- `NullLangfusePromptClient.toJSON()` returns `{ kind, key }` while the inline `fallback-on-error` handle returns `{ kind: "fallback-on-error", key }`. Distinct `kind` values aid debug-time disambiguation; no action needed.
- `render-template.test.ts` could optionally add an `it()` for an empty `variables` record returning the template unchanged.

Final verification: **PASS** for type-check, focused backend tests, full backend tests, domain tests, application tests, touched-file ESLint, and diff whitespace checks.

---

## Notes

No live Gemini/Langfuse HTTP smoke was run in this session. The user confirmed the two Langfuse prompt names were seeded in the dashboard, and `.env` contains the required Langfuse and Google key names, but the end-to-end recruiter API smoke was left for an environment with the app, auth, database, and provider calls running together.

Keep the fallback template files synchronized with meaningful hosted prompt edits. If a future outage forces fallback mode, production will use the checked-in template snapshot.
