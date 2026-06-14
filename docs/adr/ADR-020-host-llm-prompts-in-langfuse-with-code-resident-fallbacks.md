# ADR-020 Host LLM Prompts in Langfuse with Code-Resident Fallbacks

## Status

Accepted. Date: 2026-05-13.

## Context

Phase 7 shipped recruiter authentication and the full plan-generate + evaluate pipeline. At that point, both the planner system prompt (inside `GeminiInterviewPlannerService`) and the evaluator system prompt (inside `GeminiInterviewEvaluatorService`) were hardcoded TypeScript string literals. Modifying either prompt required a code change, a CI run, and a deployment — a cadence too slow for the recruiter team's anticipated rubric-tuning and planner-heuristic iteration cycles post-launch.

ADR-004 adopted Langfuse as the LLM observability platform and explicitly anticipated prompt versioning as a future capability ("Prompt versioning and A/B comparison are available in the Langfuse UI without custom tooling"). Phase 7.5 realises that anticipated capability for the two highest-iteration prompts.

Three constraints shaped the design. First, availability: a Langfuse Cloud outage cannot block plan generation or evaluation — Phase 7 just shipped the recruiter auth flow and these paths are now on the critical path for recruiter-facing use cases. Second, architectural boundary preservation: the application-layer ports `IInterviewPlannerService` and `IInterviewEvaluatorService` and their input/output types must remain byte-identical to before this change, keeping domain and application packages entirely unaware of Langfuse. Third, PII posture: rendered prompts (which contain candidate CV JSON, transcript text, and job description JSON) already flow to Langfuse Cloud today via the OTel generation traces that ADR-004 established. This phase must not add new PII surfaces — prompt template fetches must carry only the prompt key and auth credentials, never candidate data.

The agent prompt (`gemini-interview-agent.service.ts`) and the document-extraction prompts were explicitly excluded from this phase. The agent prompt is dynamically assembled each turn from conversation state, tool descriptions, and accumulated turn history — it does not map cleanly to a single `{{variable}}` template. The document-extraction prompts are the most stable in the codebase and have the lowest expected iteration value. Phasing their migration separately avoids widening the slice past the 1.5-day target.

Implementation was delivered in Phase 7.5. All backend type-check, domain tests (144 passed), application tests (104 passed), and full backend tests (216 passed) are clean, per `docs/progress/phase-7-5.md`.

## Decision

Host the planner and evaluator system prompts as text templates in Langfuse under the keys `interview-planner-v1` and `interview-evaluator-v1`, fetched at request time via `@langfuse/client` from a new infrastructure module at `apps/backend/src/infrastructure/prompts/`, with a three-layer code-resident fallback that keeps both services fully functional when Langfuse is unavailable or misconfigured, and with `experimental_telemetry.metadata.langfusePrompt` attached to the AI SDK generation call only when the SDK confirms a real (non-fallback) hosted-prompt version was returned.

The new `apps/backend/src/infrastructure/prompts/` module owns: the `ILangfusePromptClient` port (`langfuse-prompt-client.ts:18-20`), the `LangfusePromptClient` production implementation (`langfuse-prompt-client.ts:32-62`), the `NullLangfusePromptClient` no-op used when Langfuse credentials are absent (`langfuse-prompt-client.ts:86-99`), the `PromptFetchError` infrastructure-internal error type (`errors.ts`), prompt-key constants (`prompt-keys.ts`), the `renderTemplate` helper for `{{snake_case_variable}}` substitution (`render-template.ts`), and the two code-resident fallback template strings (`fallbacks/interview-planner.fallback.ts`, `fallbacks/interview-evaluator.fallback.ts`).

`@langfuse/client` is imported by exactly one file: `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts`. No other source file in the monorepo imports it.

Prompt keys must be seeded manually in the Langfuse UI before the hosted-prompt success path can be reached. If seeding is skipped, all three fallback layers ensure the services continue to function; the Langfuse trace for those calls will not carry a prompt-version link.

## Alternatives Considered

### Alternative A: Keep prompts hardcoded in TypeScript string literals

The simplest path: change nothing. Rejected because (a) modifying the evaluator rubric — a change the recruiter team identified as a high-frequency need post-launch — requires a code edit, CI pipeline run, and deployment, adding at least one day of latency per iteration; (b) ADR-004 explicitly commits to Langfuse's prompt versioning surface; (c) the Langfuse UI's version-comparison view, which requires hosted prompts, is the intended debugging tool for "why did the scoring change between interview sessions?" queries.

### Alternative B: Self-managed prompt store using a Postgres table and an admin UI

Extend the existing PostgreSQL schema with a `prompts` table (key, body, version, label, created_at) and build a small admin endpoint. Rejected for three reasons: (a) this duplicates the prompt-version storage, label-based promotion, variable-rendering, and diff-view features that Langfuse already provides; (b) building and maintaining a prompt admin UI would compete directly with Phase 8 frontend engineering effort; (c) the make-vs-buy reasoning from ADR-004 applies here — the team's value-add is the interview product, not an internal prompt CMS.

### Alternative C: Host all four prompts (planner, evaluator, agent, document extraction) in one phase

Migrate every hosted-able prompt at once. Rejected on scope grounds. The agent prompt (`gemini-interview-agent.service.ts`) assembles its system message per turn from conversation history, tool-call results, and accumulated agent notes. Mapping this to a static `{{variable}}` template would require either a single enormous variable holding serialised conversation state (fragile) or a structural change to the agent prompt architecture (too wide for Phase 7.5). The document-extraction prompts are two short, stable strings with no known iteration backlog. Attempting all four would have pushed the implementation past the 1.5-day target and increased the risk of regressing the Phase 7 recruiter auth flows. Phased migration is safer.

### Alternative D: Fail closed when Langfuse prompt fetch fails

Remove the fallback entirely: if `@langfuse/client` cannot reach Langfuse or the prompt key does not exist, propagate a `PlannerUnavailableError` or `EvaluatorUnavailableError` to the caller. Rejected because Langfuse Cloud availability cannot be a prerequisite for recruiter-facing plan generation and evaluation. A Langfuse outage — or a misconfigured environment during staging — would silently break the core interview workflow. The three-layer fallback decouples application availability from Langfuse uptime, which is the correct availability posture for a vendor-provided supporting service.

### Alternative E: Do nothing

Defer prompt hosting indefinitely. Rejected. ADR-004 explicitly anticipates this capability, the evaluator rubric is already flagged as a high-iteration surface by the recruiter team, and the prompt surface has grown from two (planner, evaluator) to four (plus agent and document extraction) since Phase 3. Deferring adds opportunity cost each time a rubric change requires a full deploy cycle.

## Consequences

**Benefits**

- Recruiter team can iterate on the evaluator rubric and planner heuristics in the Langfuse UI and promote changes to production without a code deployment. The estimated latency reduction for a rubric edit is from approximately one day (code edit plus CI plus deploy) to under five minutes.
- Langfuse's version history and diff view enables answering "what prompt was active during interview session X?" by correlating the `langfusePrompt` metadata on the AI SDK generation trace with the prompt version record. This closes an observability gap that existed since Phase 3.
- The three-layer fallback means the services are functionally equivalent to Phase 7 when Langfuse is unreachable. The only visible difference in fallback mode is the absence of a `langfusePrompt` link on the generation trace.
- Architectural boundaries are unchanged. `packages/domain/` and `packages/application/` received zero edits. The `IInterviewPlannerService` and `IInterviewEvaluatorService` ports and their input/output shapes are byte-identical to the Phase 7 state. `@langfuse/client` is confined to the infrastructure layer.
- The `ILangfusePromptClient` interface enables injecting test doubles without mocking the SDK, keeping the planner and evaluator unit tests fast and deterministic.

**Trade-offs**

- Two Langfuse SDK packages coexist in `apps/backend/package.json`: `@langfuse/client@^5.3.0` (used by the prompts module) and `langfuse@^3.38.20` (a transitive dependency of `@langfuse/otel@^5.1.0`, not directly imported by any product source file). This will be cleaned up in a future hardening phase when `@langfuse/otel` no longer requires the `langfuse@3.x` package.
- Code-resident fallback templates must be kept in sync with meaningful hosted-prompt edits. If a significant rubric change is promoted in the Langfuse UI and then a Langfuse outage forces fallback mode, production will run on the older code-resident snapshot until the outage clears. This is an explicit operational discipline: any PR that edits the hosted prompt body should also update the corresponding fallback file (`fallbacks/interview-planner.fallback.ts` or `fallbacks/interview-evaluator.fallback.ts`) in the same commit.
- Each of the two affected composition roots (`generate-interview-plan.composition.ts`, `evaluate-interview.composition.ts`) independently instantiates a `LangfusePromptClient`. For Phase 7.5 with two adapters, this is two HTTP client objects — acceptable. If a third adapter migrates, the client construction should be hoisted into a shared `apps/backend/src/composition/prompts.composition.ts`.
- Prompt keys must be seeded manually in the Langfuse UI before the first deploy. There is no programmatic seeding; the bootstrap step is a one-time runbook action. Forgetting to seed causes silent fallback (services work, traces lose their prompt-version link) rather than a hard failure — this is intentional but requires operational awareness.
- The agent prompt (in `gemini-interview-agent.service.ts`) and document-extraction prompts remain hardcoded in code, growing the disparity between hosted and in-code prompts. This is tracked as a deferred follow-up; the plan file (`phase-7-5-langfuse-prompt-hosting.md` §Deferred follow-ups items 1 and 2) documents the migration prerequisites.

**Risks and mitigations**

- *Risk*: Fallback mode silently masks a Langfuse outage or a missing prompt key, giving no operational signal. The trace carries `langfusePrompt` only when the real hosted version is fetched, so absence of that metadata field is a silent indicator of fallback. *Mitigation*: Monitor Langfuse's own status page for outage alerts. Add a structured-log line (`key`, `usingFallback: true`, error message — but never variable values) at `WARN` level on fallback activation, enabling pino-based alerting. The implementation already logs on prompt-fetch error per the PII boundary note in the plan file.
- *Risk*: Template drift between code-resident fallback and the hosted prompt. A rubric change deployed to Langfuse UI and not mirrored in the fallback file will produce different evaluation output during a Langfuse outage. *Mitigation*: Establish the PR discipline described in the Trade-offs section. Consider adding a CI check that computes a hash of the fallback file content and fails if a `PROMPT_FALLBACK_HASH` constant in the file is out of date (deferred to a future hardening phase).
- *Risk*: PII in rendered prompts accidentally logged. Rendered prompts include candidate CV JSON and transcript text. *Mitigation*: The implementation passes `compiledPrompt` only to `generateText` and never to any logger. The planner and evaluator service tests include a negative assertion (`vi.spyOn(console, "log")`) confirming no PII appears in console output. The architecture check in `docs/progress/phase-7-5.md` confirms rendered prompt variables are not logged to console, pino, or Fastify logger in the touched files.
- *Risk*: The `LANGFUSE_BASE_URL` environment variable name differs from the SDK's default `LANGFUSE_BASEURL` (note: no underscore between BASE and URL). Silent mismatch would cause the SDK to fall back to its hardcoded default URL, sending prompts fetches to the wrong endpoint. *Mitigation*: `langfusePromptClientFromEnv` reads `LANGFUSE_BASE_URL` from `process.env` and passes it explicitly as the `baseUrl` constructor argument (`langfuse-prompt-client.ts:69`). The `langfusePromptClientFromEnv` unit tests in `langfuse-prompt-client.test.ts` confirm `Err` is returned when `LANGFUSE_BASE_URL` is missing.
- *Risk*: Future Langfuse SDK version breaks the `handle.isFallback` property or the `compile` / `toJSON` API shape. *Mitigation*: The `LangfusePromptHandle` structural interface (`langfuse-prompt-client.ts:7-11`) decouples adapters from the SDK class. A breaking SDK change requires updating only `LangfusePromptClient.getText` and the structural interface — the adapters and tests remain unchanged.

## Related Decisions

- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: This ADR depends on ADR-004 and realises the prompt-versioning capability that ADR-004 anticipated but did not implement. The three Langfuse environment variables (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`) introduced in ADR-004 are reused without addition. The PII risk noted in ADR-004 §Risks (candidate transcript data stored on Langfuse Cloud) is not worsened by this decision; rendered prompts already flow via the OTel generation traces from Phase 2 onward.
- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: The new `infrastructure/prompts/` module is an infrastructure-layer concern. `@langfuse/client` is imported only there. Domain and application packages receive no changes. `PromptFetchError` follows the `RepositoryError` precedent — it is infrastructure-internal and does not escape to the application layer.
- **ADR-009 (Document-Extraction Telemetry via Factory Closure, Not Port Widening)**: This ADR establishes the pattern of keeping infrastructure concerns out of application ports. ADR-020 applies the same principle: telemetry linkage (`langfusePrompt` metadata) is assembled and attached inside the infrastructure adapter, not threaded through the port.

## References

- Implementation plan: `.claude/plan/phase-7-5-langfuse-prompt-hosting.md`
- Shipped implementation summary: `docs/progress/phase-7-5.md`
- Prompt module entry point: `apps/backend/src/infrastructure/prompts/index.ts`
- Langfuse prompt client wrapper: `apps/backend/src/infrastructure/prompts/langfuse-prompt-client.ts` (lines 1-99)
- Prompt-fetch error type: `apps/backend/src/infrastructure/prompts/errors.ts`
- Template renderer: `apps/backend/src/infrastructure/prompts/render-template.ts`
- Prompt-key constants: `apps/backend/src/infrastructure/prompts/prompt-keys.ts`
- Planner fallback template: `apps/backend/src/infrastructure/prompts/fallbacks/interview-planner.fallback.ts`
- Evaluator fallback template: `apps/backend/src/infrastructure/prompts/fallbacks/interview-evaluator.fallback.ts`
- Planner adapter (prompt fetch and telemetry attach): `apps/backend/src/infrastructure/services/gemini/gemini-interview-planner.service.ts` (lines 193-229; telemetry attach lines 206-208)
- Evaluator adapter (prompt fetch and telemetry attach): `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts` (lines 219-246; telemetry attach lines 244-246)
- Plan composition wiring: `apps/backend/src/composition/generate-interview-plan.composition.ts`
- Evaluate composition wiring: `apps/backend/src/composition/evaluate-interview.composition.ts`
- Backend `package.json` Langfuse deps: `apps/backend/package.json` (lines 25, 26, 37 — `@langfuse/client@^5.3.0`, `@langfuse/otel@^5.1.0`, `langfuse@^3.38.20`)
- ADR-004: `docs/adr/ADR-004-use-langfuse-and-opentelemetry-for-llm-observability.md`
- Langfuse Prompt Management documentation: https://langfuse.com/docs/prompts/get-started
- `@langfuse/client` package: https://www.npmjs.com/package/@langfuse/client
- Vercel AI SDK `experimental_telemetry` documentation: https://sdk.vercel.ai/docs/ai-sdk-core/telemetry

## Enforcement

The core invariant has two parts: (1) `@langfuse/client` is imported only inside `apps/backend/src/infrastructure/prompts/`; (2) rendered prompt strings are never passed to any logger. Part (1) can be partially expressed as a declarative rule, but the `adr-judge` path_glob engine does not support glob negation (excluding the allowlisted directory from a broad glob). Part (2) requires semantic judgement — logger calls take many shapes and the "rendered prompt" is a local variable, not a recognisable symbol name. For both reasons the enforcement is set to `llm_judge: true`. The architecture verification in `docs/progress/phase-7-5.md` records the manual confirmation that both invariants hold in the shipped code.

```json
{
  "forbid_import": [],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```
