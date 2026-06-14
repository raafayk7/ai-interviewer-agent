# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for the AI Technical Interviewer Agent backend. Each ADR documents a significant architectural choice — what was decided, why, what alternatives were rejected, and what consequences the decision carries.

ADRs are immutable once accepted. To change a decision, supersede the old ADR with a new one.

---

## What are ADRs?

An ADR captures the context and reasoning behind a design choice that constrains future development. They answer the question "why does the code look like this?" — something that source code alone can never answer.

---

## Quick Navigation

| Category | Count |
|---|---|
| [Architecture & Cross-Cutting](#architecture--cross-cutting) | 1 |
| [AI & Voice Pipeline](#ai--voice-pipeline) | 10 |
| [Data & Storage](#data--storage) | 3 |
| [Observability](#observability) | 6 |
| [Domain & Application Design](#domain--application-design) | 4 |
| [Authentication & Security](#authentication--security) | 4 |
| [Presentation](#presentation) | 1 |
| [Frontend](#frontend) | 8 |

---

## ADR Index

### Architecture & Cross-Cutting

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-001](ADR-001-adopt-clean-architecture-ddd-with-immutable-entities-and-result-option-error-handling.md) | Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling | Accepted | 2026-05-09 |

### AI & Voice Pipeline

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-002](ADR-002-use-sandwich-architecture-for-voice-interviews.md) | Use Sandwich Architecture for Voice Interviews (superseded as primary by ADR-029; retained as fallback) | Superseded by ADR-029 | 2026-05-09 |
| [ADR-003](ADR-003-use-gemini-multimodal-for-document-ingestion.md) | Use Gemini Multimodal for Document Ingestion | Accepted | 2026-05-09 |
| [ADR-006](ADR-006-interview-duration-soft-target-with-hard-ceiling.md) | Interview Duration Is a Soft Target with a Hard Ceiling Enforced by the System | Accepted | 2026-05-09 |
| [ADR-010](ADR-010-use-async-iterable-stream-contracts-for-stt-tts-ports.md) | Use AsyncIterable Stream Contracts for STT and TTS Application Ports | Accepted | 2026-05-10 |
| [ADR-011](ADR-011-adopt-fastify-websocket-v11-for-websocket-transport.md) | Adopt @fastify/websocket v11 for WebSocket Transport in the Voice Pipeline | Accepted | 2026-05-10 |
| [ADR-013](ADR-013-conduct-interview-orchestration-and-tool-effects.md) | Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface | Accepted | 2026-05-15 |
| [ADR-029](ADR-029-adopt-elevenlabs-conversational-ai-for-voice-interviews.md) | Adopt ElevenLabs Conversational AI as the Primary Voice Interview Pipeline (supersedes ADR-002; sandwich retained as fallback) | Accepted | 2026-05-29 |
| [ADR-030](ADR-030-static-elevenlabs-agent-with-per-session-overrides.md) | Static ElevenLabs Agent with Per-Session Overrides via Conversation-Initiation Webhook | Superseded by ADR-033 | 2026-05-27 |
| [ADR-031](ADR-031-elevenlabs-webhooks-drive-interview-lifecycle.md) | ElevenLabs Webhooks Drive the Interview Lifecycle | Superseded by ADR-034 | 2026-05-27 |
| [ADR-033](ADR-033-elevenlabs-static-agent-server-built-overrides-via-browser-sdk.md) | ElevenLabs Static Agent: Server-Built Overrides Delivered Inline via Browser SDK (supersedes ADR-030; owns SCHEDULED to IN_PROGRESS transition at issuance) | Accepted | 2026-05-29 |
| [ADR-034](ADR-034-elevenlabs-lifecycle-two-webhooks-per-tool-urls-scoped-hmac.md) | ElevenLabs Lifecycle: Two Inbound Webhook Surfaces with Scoped HMAC, Per-Tool URLs, and Post-Call End-Reason Recovery (supersedes ADR-031) | Accepted | 2026-05-29 |
| [ADR-035](ADR-035-elevenlabs-session-integrity-idempotent-binding-best-transcript-wins-reconciliation-failed-state.md) | ElevenLabs Interview Session Integrity: Idempotent Binding, Best-Transcript-Wins, Reconciliation, and a FAILED Terminal State (extends/partially supersedes ADR-034) | Accepted | 2026-06-13 |

### Data & Storage

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-005](ADR-005-abstract-file-storage-via-port-adapter.md) | Abstract File Storage via Port and Adapter | Accepted | 2026-05-09 |
| [ADR-007](ADR-007-persist-extracted-jd-cv-through-interview-aggregate-jsonb-columns.md) | Persist Extracted JD/CV Through the Interview Aggregate's Existing JSONB Columns | Accepted | 2026-05-09 |
| [ADR-036](ADR-036-s3-compatible-file-storage-adapter-selectable-via-file-storage-driver.md) | S3-Compatible File Storage Adapter Selectable via FILE_STORAGE_DRIVER | Proposed | 2026-06-14 |

### Observability

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-004](ADR-004-use-langfuse-and-opentelemetry-for-llm-observability.md) | Use Langfuse and OpenTelemetry for LLM Observability | Accepted | 2026-05-09 |
| [ADR-012](ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md) | Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns | Accepted, amended by ADR-014 | 2026-05-10 |
| [ADR-014](ADR-014-extend-otel-span-hierarchy-with-agent-turn-and-rename-session-span.md) | Extend OTel Span Hierarchy with `interview.turn.agent` and Unify Session Span as `interview.session.agent` | Accepted | 2026-05-15 |
| [ADR-015](ADR-015-phase-6-evaluation-span-schema-explicit-invocation-and-hardcoded-rubric.md) | Phase 6 Evaluation: Span Schema, Explicit Invocation Policy, and Hardcoded Rubric | Accepted | 2026-05-15 |
| [ADR-020](ADR-020-host-llm-prompts-in-langfuse-with-code-resident-fallbacks.md) | Host LLM Prompts in Langfuse with Code-Resident Fallbacks | Accepted | 2026-05-13 |
| [ADR-032](ADR-032-otel-span-hierarchy-for-elevenlabs-conversational-sessions.md) | Extend OTel Span Hierarchy for ElevenLabs Conversational Sessions (extends ADR-012/014; no session-start-webhook span; D1 records SCHEDULED to IN_PROGRESS transition at issuance) | Accepted | 2026-05-29 |

### Domain & Application Design

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-008](ADR-008-two-step-orchestration-extract-then-generate-plan.md) | Two-Step Orchestration: Extract Then Generate Plan | Accepted | 2026-05-09 |
| [ADR-009](ADR-009-document-extraction-telemetry-via-factory-closure-not-port-widening.md) | Document-Extraction Telemetry via Factory Closure, Not Port Widening | Accepted | 2026-05-09 |
| [ADR-013](ADR-013-conduct-interview-orchestration-and-tool-effects.md) | Conduct Interview Orchestration: Tool Effects Persisted on the Aggregate, Per-Turn Persistence, and Agent Tool Surface | Accepted | 2026-05-15 |
| [ADR-015](ADR-015-phase-6-evaluation-span-schema-explicit-invocation-and-hardcoded-rubric.md) | Phase 6 Evaluation: Span Schema, Explicit Invocation Policy, and Hardcoded Rubric | Accepted | 2026-05-15 |

### Authentication & Security

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-016](ADR-016-adopt-better-auth-for-recruiter-authentication.md) | Adopt better-auth for Recruiter Authentication | Accepted | 2026-05-15 |
| [ADR-017](ADR-017-candidate-access-via-hmac-signed-link.md) | Candidate Access via HMAC-Signed Link | Accepted | 2026-05-15 |
| [ADR-019](ADR-019-ownership-checks-in-presentation-not-application.md) | Recruiter Ownership Checks Live in the Presentation Layer, Not the Application or Domain Layer | Accepted | 2026-05-15 |
| [ADR-037](ADR-037-rate-limiting-public-http-surfaces-via-fastify-rate-limit.md) | Rate Limiting Public HTTP Surfaces via @fastify/rate-limit | Proposed | 2026-06-14 |

### Presentation

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-018](ADR-018-http-error-mapping-by-error-code-with-exhaustive-table.md) | HTTP Error Mapping by Error Code String with an Exhaustive Status Table | Accepted | 2026-05-15 |

### Frontend

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-021](ADR-021-adopt-zustand-for-frontend-client-state.md) | Adopt Zustand for Frontend Client State (UI State Only) | Accepted | 2026-05-13 |
| [ADR-022](ADR-022-use-tanstack-query-for-frontend-server-state.md) | Use TanStack Query v5 for Frontend Server State | Accepted | 2026-05-13 |
| [ADR-023](ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md) | Adopt shadcn/ui (Radix + Tailwind v4) for the Frontend Component System | Accepted | 2026-05-13 |
| [ADR-024](ADR-024-react-hook-form-and-zod-4-for-frontend-forms.md) | Standardise on React Hook Form + Zod 4 for Frontend Forms and Wire Validation | Accepted | 2026-05-13 |
| [ADR-025](ADR-025-design-language-and-visual-system.md) | Design Language and Visual System ("Quiet Signal") | Accepted, partially superseded by ADR-028 | 2026-05-14 |
| [ADR-026](ADR-026-voice-presence-pattern-the-orb.md) | Voice Presence Pattern: The Orb as the Canonical AI Presence Element | Accepted | 2026-05-14 |
| [ADR-027](ADR-027-candidate-device-support.md) | Candidate Device Support: Desktop-Only for MVP, Soft-Block Mobile | Accepted | 2026-05-14 |
| [ADR-028](ADR-028-design-refresh-v2-warm-neutral-palette-instrument-serif-petrol-voice-tokens.md) | Design Refresh v2: Warm-Neutral Palette, Instrument Serif Typography, Petrol Voice Tokens | Accepted | 2026-05-15 |

---

## Key Architectural Themes

### Clean Architecture + FP discipline (ADR-001)

The entire backend is governed by ADR-001: Clean Architecture layers (domain → application → infrastructure → presentation), DDD aggregates, immutable entities, and `Result<T, E>` / `Option<T>` from `@carbonteq/fp` as the sole error mechanism. Every other ADR is a specific application of these rules.

### Single vendor for all AI surfaces (ADR-002, ADR-003, ADR-006)

Gemini (via Google AI Studio and the Vercel AI SDK) handles the voice interview agent, document extraction, and interview evaluation. ADR-002 chose Gemini over NVIDIA PersonaPlex for the voice pipeline; ADR-003 chose Gemini for document ingestion over a separate OCR pipeline. One API key, one billing surface, one SDK.

### Narrow ports, infrastructure adapters (ADR-001, ADR-003, ADR-005, ADR-009)

Application-layer ports (`IDocumentExtractionService`, `IInterviewPlannerService`, `IFileStorageService`) carry only domain types (`Buffer`, `Result<VO, DomainError>`). Infrastructure concerns — Gemini model selection, telemetry metadata, storage backend — live exclusively in adapter classes under `apps/backend/src/infrastructure/`. ADR-009 is the clearest example: telemetry context reaches the Gemini adapter via a factory closure rather than widening the port.

### Aggregate as single source of truth (ADR-007, ADR-008)

The `Interview` aggregate owns `JobDescription`, `CandidateInfo`, and `InterviewPlan`. Extraction results are persisted into the aggregate's JSONB columns (ADR-007), not a separate `documents` table. The orchestration that produces these values is split into single-purpose use cases that the presentation layer chains (ADR-008).

---

## Architectural Dependencies

```
ADR-001 (Clean Architecture)
  └── ADR-003 (Gemini Extraction — port/adapter pattern)
  │     └── ADR-009 (Factory closure for telemetry)
  │           └── ADR-008 (Two-step orchestration)
  └── ADR-005 (File Storage — port/adapter pattern)
  │     └── ADR-036 (S3-compatible adapter + FILE_STORAGE_DRIVER selection — extends ADR-005)
  │     └── ADR-007 (Store extracted VOs in aggregate JSONB)
  │           └── ADR-008 (Two-step orchestration)
  └── ADR-002 (Voice pipeline — port/adapter pattern)
  │     └── ADR-006 (Duration policy)
  │     │     └── ADR-013 (Agent orchestration implements duration policy)
  │     └── ADR-010 (AsyncIterable stream contracts)
  │     │     └── ADR-011 (WebSocket transport via @fastify/websocket v11)
  │     └── ADR-013 (Agent tool surface + per-turn persistence + event-sink pattern)
  │           └── ADR-014 (interview.turn.agent span schema)
  └── ADR-016 (better-auth recruiter auth — infrastructure layer, session in presentation)
  └── ADR-017 (HMAC-signed candidate link — stateless WS guard, complements ADR-016)
  │     └── ADR-011 (WebSocket transport being guarded)
  └── ADR-018 (HTTP error mapping — presentation boundary, enforces Result chain termination)
  └── ADR-019 (Ownership checks in presentation — depends on ADR-016 session.userId, depends on ADR-001 layer separation)

ADR-004 (Langfuse OTel)
  └── ADR-009 (Telemetry factory closure enriches Langfuse spans)
  └── ADR-012 (OTel span hierarchy for voice pipeline — concretizes ADR-004's trace structure)
  │     └── ADR-014 (Amends ADR-012: adds interview.turn.agent schema + session span rename)
  │           └── ADR-015 (Fulfills ADR-014 D7c: interview.evaluation span schema + invocation policy)
  └── ADR-020 (Host planner/evaluator prompts in Langfuse — realises ADR-004 prompt-versioning intent)

Frontend (Phase 8) — partitions the entire frontend state + presentation surface into non-overlapping libraries
  ADR-021 (Zustand — UI/ephemeral state)
  │     ↔ ADR-022 (TanStack Query — server state; complementary half of the state-management split)
  ADR-022 (TanStack Query)
  │     └── consumes ADR-018 (HTTP error mapping — ServiceError shape)
  │     ↔ ADR-024 (RHF — form submissions wired through useMutation)
  ADR-023 (shadcn/ui + Radix + Tailwind v4)
  │     ↔ ADR-024 (RHF forms built on shadcn primitives)
  ADR-024 (React Hook Form + Zod 4)
  │     └── consumes ADR-018 (ValidationError issues shape — RHF setError round-trip)
```

---

## When to Create an ADR

Create an ADR when the change:

- Introduces a new external dependency (library, service, API).
- Changes a public interface or domain contract.
- Affects more than one layer or package.
- Establishes a pattern that future code will follow.
- Makes a trade-off that will constrain future choices.
- Was driven by a specific constraint (compliance, performance budget, vendor limitation).

Do **not** create an ADR for bug fixes, refactors within an established pattern, or documentation changes.

---

## Superseding an ADR

1. Write a new ADR (next number) with `Status: Proposed`.
2. In its `## Related Decisions`, add: `Supersedes ADR-XXX (Title)`.
3. After the new ADR is accepted, update the old ADR's `## Status` line only: `Superseded by ADR-YYY, YYYY-MM-DD.`
4. Never edit any other section of an accepted ADR.

---

## Resources

- [ADR best practices](https://adr.github.io/)
- [Michael Nygard's original post (2011)](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [MADR template](https://github.com/adr/madr)
