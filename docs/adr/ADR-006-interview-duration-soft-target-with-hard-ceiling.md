# ADR-006 Interview Duration Is a Soft Target Communicated to the Agent with a Hard Ceiling Enforced by the System

## Status

Accepted. Date: 2026-05-09.

## Context

Voice screening interviews need a finite, predictable runtime: long enough to gather signal, short enough to respect candidate and recruiter time.

Pure prompt-based time guidance ("aim for 15 minutes") is unreliable. Large language models do not honour wall-clock guidance with precision; an unattended model may run long, enter a tool-call loop, or end abruptly before all must-ask questions are covered. A runaway interview session is a real failure mode, not an edge case.

A pure system-enforced hard cap (end at exactly N minutes) is equally unsatisfactory: it produces jarring mid-sentence cutoffs, removes the agent's ability to use a few extra seconds productively when a strong answer is mid-flow, and makes interview length brittle to speech-to-text (STT) and text-to-speech (TTS) latency variance.

The existing `InterviewPlan` value object (introduced in Phase 1) already models this two-knob design with `targetDurationMinutes` and `maxDurationMinutes` (see `packages/domain/src/entities/interview/value-objects/interview-plan.ts`). This ADR documents and ratifies that design as the authoritative policy.

Source references: `docs/ARCHITECTURE.md` section 5.2 "Interview Duration (Soft Target, Not Hard Cap)" (lines 288-304) and `docs/progress/phase-1.md` lines 137-156.

## Decision

Each interview carries two duration fields on its `InterviewPlan` value object:

- `targetDurationMinutes` (default 15) — the soft target the agent aims for. Communicated to the agent via the session system prompt and via periodic "time remaining" context injections during the interview.
- `maxDurationMinutes` (default 25) — the hard ceiling enforced by the system. When reached, the system instructs the agent to wrap up; if the agent does not comply, the system terminates the session unconditionally.

The agent has discretion within the soft target. It may end earlier if all must-ask questions are covered and signal is clear, if the candidate is clearly not a fit, or if the candidate requests to end. It may run longer, up to the hard ceiling, if the candidate is on a strong topic worth exploring or if critical must-ask questions remain uncovered.

The hard ceiling is a runaway-protection safety net, not the primary scheduling mechanism. The agent's `end_interview` tool (see ADR-002) is the normal termination path. The hard ceiling acts only when the agent fails to use that tool.

Both fields are validated at `InterviewPlan.create` time: `targetDurationMinutes > 0` and `maxDurationMinutes >= targetDurationMinutes`. The defaults (15 and 25) are exported constants (`DEFAULT_TARGET_DURATION_MIN`, `DEFAULT_MAX_DURATION_MIN`) at `packages/domain/src/entities/interview/value-objects/interview-plan.ts` lines 5-6. They are not buried in environment configuration; a recruiter overrides them per `InterviewPlan` instance.

Runtime enforcement of the hard ceiling (timer, force-wrap-up, force-terminate) is a Phase 10 deliverable ("Hard ceiling enforcement and graceful wrap-up", `docs/ARCHITECTURE.md` section 7, line 444). The policy is decided and encoded now; the runtime guard is a known follow-up item.

## Alternatives Considered

### Alternative A: prompt-only guidance with no hard cap

The agent receives "aim for 15 minutes" in its system prompt and has no system-enforced ceiling.

Rejected because LLMs do not reliably honour wall-clock guidance. An unattended runaway interview is a concrete failure mode: a model that misjudges remaining topics or enters a tool-call loop will continue indefinitely. A hard ceiling is a correctness requirement, not polish. Without it, cost forecasting (Gemini, Deepgram, ElevenLabs per-minute billing) and concurrent-session capacity planning have no worst-case bound.

### Alternative B: hard cap only, no soft target

The system enforces a single duration limit and terminates the session at that point.

Rejected because (a) it produces jarring mid-sentence cutoffs that degrade candidate experience, (b) it removes the agent's ability to use 30 extra seconds productively when a strong answer is mid-flow, and (c) it makes effective interview length brittle to STT/TTS latency variance — the agent may have only 12 of 15 planned minutes of actual conversation time if pipeline latency consumes the rest. Candidate experience and signal quality suffer without compensating gain.

### Alternative C: single configurable duration with no soft/hard distinction

One field (e.g., `durationMinutes`) that serves as both target and ceiling.

Rejected because operators and recruiters conflate two different specifications: "the interview should usually take approximately X minutes" (a steering signal with latitude) and "the interview must never exceed X minutes" (a hard constraint for cost and capacity). Conflating them into one field forces recruiters to pick the constraint value as the steering value, which degrades agent behaviour, or to pick the steering value as the constraint, which removes the safety net. Naming them separately in the domain model prevents the mismatch and makes code reading unambiguous: `plan.maxDurationMinutes` is the safety net; `plan.targetDurationMinutes` is the steering signal.

### Alternative D: per-topic time budgets only, no overall ceiling

Each `PlannedTopic` carries its own time allocation; the agent manages time at the topic level.

Rejected because per-topic budgets do not protect against the agent looping inside a single topic indefinitely. The overall ceiling is the runaway guard that per-topic budgets cannot provide. Both can coexist: `PlannedTopic` already carries a `timeAllocationMinutes` field, and the overall ceiling acts as the outer bound regardless of per-topic behaviour.

### Alternative E: do nothing (no duration policy in the domain model)

Leave duration as an implicit convention documented only in the system prompt or operator runbook.

Rejected because implicit conventions drift. The domain model is the authoritative source of policy; encoding duration constraints in `InterviewPlan` makes them checkable, testable, and visible to every layer. Leaving them out means future code reading a session start event has no way to recover the intended ceiling without parsing the system prompt.

## Consequences

**Benefits**

- The `InterviewPlan` domain model expresses the duration policy directly. No magic numbers: `plan.targetDurationMinutes` is the steering signal; `plan.maxDurationMinutes` is the safety net. The distinction is explicit at the call site.
- The agent retains productive latitude: early end on poor fit, slight overrun on strong signal, without unbounded license.
- Operations and on-call have a deterministic worst-case session length for capacity planning, cost forecasting (Gemini, Deepgram, and ElevenLabs charge per minute), and queue management.
- Default values (15 / 25) are explicit exported constants in the domain, not buried in environment configuration. A recruiter who wants a different interview length overrides them per `InterviewPlan` instance.
- Validation at `InterviewPlan.create` ensures the constraint `max >= target` is enforced at construction time via `Result<InterviewPlan, InvalidInterviewInputError>`, consistent with ADR-001 error handling patterns.

**Trade-offs**

- Two fields instead of one means more validation surface and a richer mental model for recruiters configuring a plan. The names themselves (`target` vs. `max`) carry the intent, but documentation and UI copy must reinforce the distinction.
- The hard ceiling runtime enforcement is deferred to Phase 10. Until that phase ships, `maxDurationMinutes` is encoded in the domain but not actively enforced at the session level. The value exists and is correct; the enforcement mechanism is a known gap.

**Risks and mitigations**

- *Risk*: A recruiter sets `maxDurationMinutes` equal to `targetDurationMinutes`, effectively removing the agent's overrun latitude and making every interview end abruptly at the target. *Mitigation*: validation only requires `max >= target`; a UI layer should recommend a buffer (e.g., `max >= target + 5`) and explain the distinction. This is a UX concern, not a domain invariant.
- *Risk*: Phase 10 ships late, leaving a window where a runaway agent has no system-enforced ceiling. *Mitigation*: the risk is accepted and tracked explicitly. The session orchestrator can implement a lightweight process-level timeout as an interim measure before the full graceful wrap-up logic is in place.
- *Risk*: The agent ignores the soft target entirely and relies on the hard ceiling as its termination signal. *Mitigation*: periodic time-remaining context injections reinforce the target throughout the session; the `end_interview` tool is the documented normal path; observability (ADR-004 Langfuse + OTel traces) will surface sessions that consistently reach the ceiling.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: `InterviewPlan` is a value object created via a `Result`-returning factory per the patterns mandated by ADR-001. The duration policy lives in the domain layer, not in application configuration.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: the agent's `end_interview` tool is the normal early-termination mechanism. The hard ceiling acts only when the agent fails to use it. The two-phase wrap-up behaviour (agent-initiated vs. system-forced) integrates directly with the sandwich pipeline's session lifecycle.
- **ADR-004 (Use Langfuse and OpenTelemetry for LLM Observability)**: sessions that reach the hard ceiling are observable via traces. Ceiling-reached events should be a named span event so on-call can distinguish normal agent terminations from forced terminations.

## References

- `docs/ARCHITECTURE.md` section 5.2 "Interview Duration (Soft Target, Not Hard Cap)" (lines 288-304) — authoritative policy description.
- `docs/ARCHITECTURE.md` section 7 Phase 10 "Hard ceiling enforcement and graceful wrap-up" (line 444) — implementation phase for the runtime enforcement mechanism.
- `packages/domain/src/entities/interview/value-objects/interview-plan.ts` lines 5-6 — `DEFAULT_TARGET_DURATION_MIN` and `DEFAULT_MAX_DURATION_MIN` constants.
- `packages/domain/src/entities/interview/value-objects/interview-plan.ts` lines 30-41 — `InterviewPlan.create` factory with `targetDurationMinutes > 0` and `maxDurationMinutes >= targetDurationMinutes` validation guards.
- `docs/progress/phase-1.md` lines 137-156 — Phase 1 implementation notes for `InterviewPlan` and related value objects.

## Enforcement

This ADR governs a domain-policy decision: any code that constructs an `InterviewPlan`, reads duration fields to drive session behaviour, or handles the hard-ceiling termination path must respect the soft-target / hard-ceiling intent. No declarative regex is sharp enough to catch semantic violations (e.g., code that reads `maxDurationMinutes` but uses it as the steering signal, or code that constructs an `InterviewPlan` with `max == target` for a non-test context). LLM judgement is the appropriate review mechanism.

```json
{
  "forbid_pattern": [],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
