# ADR-015 Phase 6 Evaluation: Span Schema, Explicit Invocation Policy, and Hardcoded Rubric

## Status

Proposed. Date: 2026-05-11.

## Context

Phase 6 introduced `EvaluateInterviewUseCase` and `GeminiInterviewEvaluatorService` to evaluate a `COMPLETED` interview and produce a structured `Report`. Three architectural decisions were made during implementation that are not yet formally recorded.

**D15a** — ADR-014 D7c reserves the `interview.evaluation.*` OTel span namespace and explicitly states: *"Phase 6's ADR will specify the exact name and attribute schema."* The Phase 6 adapter (`GeminiInterviewEvaluatorService`) opens a span at `gemini-interview-evaluator.service.ts:221`; without a recorded schema, Phase 10 resilience instrumentation and any future evaluation adapter will independently coin attribute keys, producing inconsistent telemetry in Langfuse.

**D15b** — Evaluation involves a 5–10 s Gemini `generateText` call. It can be triggered synchronously at the end of `ConductInterviewUseCase` (auto-fire) or as a separate explicit call. The choice determines whether the candidate's WebSocket session close is blocked by evaluation latency and whether Phase 7 can expose evaluation independently.

**D15c** — The rubric that guides the evaluator can live in: (i) a hardcoded constant, (ii) the `Interview` aggregate, or (iii) a `rubrics` database table. The choice affects schema migration scope, aggregate size, and the effort required to support per-recruiter or per-JD rubric variation.

## Decision

### D15a — Span name `interview.evaluation`, root span, fixed attribute schema

`GeminiInterviewEvaluatorService.evaluate()` opens a root OTel span named **`interview.evaluation`** at `gemini-interview-evaluator.service.ts:221`, before the first `await` (consistent with ADR-012's lifecycle rule). It is a root span (no parent context) because evaluation runs after the WebSocket session has closed and `interview.session.agent` has already ended; parenting under a closed span is impossible under OTel semantics.

**Attributes set at span open** (`gemini-interview-evaluator.service.ts:222–228`):

| Key | Type | Value |
|---|---|---|
| `interview.id` | string | Interview UUID |
| `evaluator.model` | string | Gemini model identifier (e.g. `gemini-2.5-pro`) |
| `evaluator.transcript_entries` | number | Count of transcript entries passed to the evaluator |
| `evaluator.notes` | number | Count of agent notes passed |
| `evaluator.internal_scores` | number | Count of agent internal scores passed |

**Attribute set lazily on success** (`gemini-interview-evaluator.service.ts:253`):

| Key | Type | Value |
|---|---|---|
| `evaluator.stop_reason` | string | `"stop"` on normal completion |

Span is closed via `span.end()` after the `Result` chain resolves (line 264), covering both success and error paths. The AI SDK `experimental_telemetry: { isEnabled: true }` auto-emits a child Generation span under `interview.evaluation` when the Gemini call succeeds.

The resulting Langfuse trace for one evaluation is:

```
interview.evaluation         (GeminiInterviewEvaluatorService — root span)
  └── [AI SDK Generation]    (auto-emitted by AI SDK experimental_telemetry)
```

Cross-phase correlation to the matching session trace uses the `interview.id` attribute present on both `interview.session.agent` and `interview.evaluation`.

### D15b — Evaluation is an explicit call, not auto-fired at end of ConductInterviewUseCase

`EvaluateInterviewUseCase` is a standalone use case. `ConductInterviewUseCase` transitions the interview to `COMPLETED` and returns; it does **not** invoke the evaluator. The caller — a Phase 7 HTTP route, a background job, or an operator script — explicitly calls `EvaluateInterviewUseCase.execute({ interviewId })`.

### D15c — Rubric is a hardcoded constant in the application layer

`EVALUATION_RUBRIC` is an exported string constant at `packages/application/src/use-cases/interview/evaluation-rubric.ts`. It is passed to the evaluator via the existing `InterviewEvaluatorInput.rubric` field, which is already typed as `string` on the port — the port shape already supports per-interview rubric injection. Changes to the rubric are auditable via `git log` on a single file.

## Alternatives Considered

### Alternative A: Auto-fire evaluation at end of ConductInterviewUseCase

Chain `EvaluateInterviewUseCase` from the end of `ConductInterviewUseCase` in the composition root. Rejected: the Gemini evaluation call takes 5–10 s. Embedding it inside `ConductInterviewUseCase` would block the WebSocket close response, holding the candidate's audio loop open for the duration of the Gemini round-trip. Decoupling lets the voice session terminate cleanly and gives Phase 7 full control over when and how evaluation is triggered.

### Alternative B: Nest `interview.evaluation` under `interview.session.agent` as a child span

Pass the session span context into the evaluator adapter and open `interview.evaluation` as a child. Rejected: `interview.session.agent` is opened by the WebSocket controller and closed when the WebSocket closes — before evaluation begins. OTel spans cannot be re-opened; holding the session span open across an unknown evaluation window would misrepresent the session lifetime and produce an artificially long session duration in Langfuse. A root span keyed by `interview.id` supports the same cross-phase query pattern.

### Alternative C: Use a synthetic OTel Link from `interview.evaluation` to the closed session span

Create an `interview.evaluation` root span and attach a `Link` pointing to the `interview.session.agent` trace. Technically valid per OTel spec. Rejected: Langfuse's Traces view does not surface linked spans prominently; the `interview.id` attribute already correlates evaluation traces to session traces without a Link. Adding a Link adds implementation complexity with no observable benefit until Langfuse UI renders cross-trace links natively.

### Alternative D: Persist rubric on the `Interview` aggregate

Add a `rubric: string` field to the `Interview` domain entity. Rejected: it requires a schema migration (new column) and a domain change (aggregate field + value-object consideration) before any product driver exists for per-recruiter or per-JD variation. The application port (`InterviewEvaluatorInput.rubric`) already accepts a `string` — the constant can be promoted to a lookup without changing the port when a real driver emerges.

### Alternative E: Persist rubric in a `rubrics` database table

Create a `rubrics` table, a `RubricRepository`, and a lookup step in the use case. Rejected for the same reason as Alternative D, compounded by an additional repository and the complexity of deciding which rubric applies to which interview. A future ADR can introduce this when product requires it.

## Consequences

**Benefits**

- The `interview.evaluation` span schema is recorded; Phase 10 resilience instrumentation and future evaluation adapters can add attributes without independently inventing key names.
- Evaluation decoupled from the voice session: Phase 7 can trigger evaluation via HTTP, a queue message, or a cron job without changing any inner contract.
- The `EvaluateInterviewUseCase` is idempotent (checks for an existing report before calling the evaluator), making explicit re-invocation safe.
- Single-source rubric is auditable via git history; a rubric change is a one-line diff in one file.

**Trade-offs**

- Callers must explicitly invoke evaluation after a session completes — there is no automatic trigger. Phase 7 must wire this call.
- Per-JD or per-recruiter rubric variation requires a future ADR, a port-shape change, and a new repository or aggregate field.
- `interview.evaluation` is a root span; Langfuse does not automatically nest it under the session trace. Cross-phase correlation requires querying by `interview.id` attribute.

**Risks and mitigations**

- *Risk*: A future adapter opens `interview.evaluation` in the application layer or uses a different span name, creating attribute drift. *Mitigation*: The Enforcement block below forbids `startSpan("interview.evaluation"` outside the infrastructure layer and adds an `llm_judge: true` guard for nuanced drift.
- *Risk*: Evaluation is never triggered for some `COMPLETED` interviews (caller forgets to wire Phase 7 route). *Mitigation*: The interview row stays `COMPLETED` with `reportId = null`; a monitoring query or a Phase 10 sweep job can identify un-evaluated interviews. The idempotency branch ensures a late call is safe.
- *Risk*: Rubric drifts by accumulating edits without a review process. *Mitigation*: Single file, visible in git log. If the project introduces a review gate for rubric changes, the constant can be extracted to a separate package with an owner CODEOWNERS entry.

## Related Decisions

- **ADR-014 (Extend OTel Span Hierarchy with `interview.turn.agent`)**: D7c reserves `interview.evaluation.*` and mandates that "Phase 6's ADR will specify the exact name and attribute schema." **This ADR fulfills that mandate.** ADR-014's `interview.evaluation.*` namespace reservation is now resolved.
- **ADR-012 (Define OTel Span Hierarchy for Voice Pipeline)**: The lifecycle rule (span opened before first `await`, closed in finally/tap on both paths) applies to `interview.evaluation` unchanged. This ADR adds `interview.evaluation` to the canonical span name list.
- **ADR-013 (Conduct Interview Orchestration)**: ADR-013 records the agent notes and internal scores that feed evaluation; this ADR records what happens to those artefacts after the session ends.
- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: `experimental_telemetry` on the Gemini `generateText` call produces the child Generation span; this ADR documents the resulting Langfuse subtree for `interview.evaluation`.
- **ADR-001 (Adopt Clean Architecture and DDD)**: The explicit-invocation policy keeps the use-case boundary clean — evaluation is a separate command, not a side effect of `ConductInterviewUseCase`.

## References

- `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts:221` — `interview.evaluation` span opened before first `await`
- `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts:222–228` — span-open attributes
- `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts:253` — `evaluator.stop_reason` set on success
- `apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts:264` — `span.end()` after Result chain
- `packages/application/src/use-cases/interview/evaluation-rubric.ts` — `EVALUATION_RUBRIC` constant
- `packages/application/src/ports/interview-evaluator/interview-evaluator.port.ts` — `InterviewEvaluatorInput.rubric: string` port field
- `apps/backend/src/composition/evaluate-interview.composition.ts` — explicit use-case factory; no auto-fire wiring
- `docs/adr/ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md` — D7c namespace reservation
- `.claude/plan/phase-6-evaluation-and-reporting.md` — Q3/Q4/Q5/Q6 decision rationale
- OTel Semantic Conventions for GenAI (incubating): https://opentelemetry.io/docs/specs/semconv/gen-ai/

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "startSpan\\([\"']interview\\.evaluation[\"']",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "interview.evaluation span must be opened by the infrastructure adapter (GeminiInterviewEvaluatorService), not the application layer (ADR-015, ADR-012)."
    },
    {
      "pattern": "startSpan\\([\"']interview\\.evaluation[\"']",
      "path_glob": "apps/backend/src/presentation/**/*.ts",
      "message": "interview.evaluation span must be opened by the infrastructure adapter, not the presentation layer (ADR-015, ADR-012)."
    }
  ],
  "forbid_import": [],
  "require_pattern": [
    {
      "pattern": "evaluator\\.model",
      "path_glob": "apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts",
      "message": "interview.evaluation span must set evaluator.model attribute (ADR-015 D15a)."
    },
    {
      "pattern": "interview\\.id",
      "path_glob": "apps/backend/src/infrastructure/services/gemini/gemini-interview-evaluator.service.ts",
      "message": "interview.evaluation span must set interview.id attribute (ADR-015 D15a)."
    }
  ],
  "llm_judge": true
}
```
