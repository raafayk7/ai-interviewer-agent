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
| [AI & Voice Pipeline](#ai--voice-pipeline) | 5 |
| [Data & Storage](#data--storage) | 2 |
| [Observability](#observability) | 2 |
| [Domain & Application Design](#domain--application-design) | 2 |

---

## ADR Index

### Architecture & Cross-Cutting

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-001](ADR-001-adopt-clean-architecture-ddd-with-immutable-entities-and-result-option-error-handling.md) | Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling | Accepted | 2026-05-09 |

### AI & Voice Pipeline

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-002](ADR-002-use-sandwich-architecture-for-voice-interviews.md) | Use Sandwich Architecture for Voice Interviews | Accepted | 2026-05-09 |
| [ADR-003](ADR-003-use-gemini-multimodal-for-document-ingestion.md) | Use Gemini Multimodal for Document Ingestion | Accepted | 2026-05-09 |
| [ADR-006](ADR-006-interview-duration-soft-target-with-hard-ceiling.md) | Interview Duration Is a Soft Target with a Hard Ceiling Enforced by the System | Accepted | 2026-05-09 |
| [ADR-010](ADR-010-use-async-iterable-stream-contracts-for-stt-tts-ports.md) | Use AsyncIterable Stream Contracts for STT and TTS Application Ports | Accepted | 2026-05-10 |
| [ADR-011](ADR-011-adopt-fastify-websocket-v11-for-websocket-transport.md) | Adopt @fastify/websocket v11 for WebSocket Transport in the Voice Pipeline | Accepted | 2026-05-10 |

### Data & Storage

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-005](ADR-005-abstract-file-storage-via-port-adapter.md) | Abstract File Storage via Port and Adapter | Accepted | 2026-05-09 |
| [ADR-007](ADR-007-persist-extracted-jd-cv-through-interview-aggregate-jsonb-columns.md) | Persist Extracted JD/CV Through the Interview Aggregate's Existing JSONB Columns | Accepted | 2026-05-09 |

### Observability

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-004](ADR-004-use-langfuse-and-opentelemetry-for-llm-observability.md) | Use Langfuse and OpenTelemetry for LLM Observability | Accepted | 2026-05-09 |
| [ADR-012](ADR-012-define-otel-span-hierarchy-for-voice-pipeline.md) | Define OTel Span Hierarchy for Voice Pipeline Sessions and Turns | Accepted | 2026-05-10 |

### Domain & Application Design

| # | Title | Status | Date |
|---|---|---|---|
| [ADR-008](ADR-008-two-step-orchestration-extract-then-generate-plan.md) | Two-Step Orchestration: Extract Then Generate Plan | Accepted | 2026-05-09 |
| [ADR-009](ADR-009-document-extraction-telemetry-via-factory-closure-not-port-widening.md) | Document-Extraction Telemetry via Factory Closure, Not Port Widening | Accepted | 2026-05-09 |

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
  │     └── ADR-007 (Store extracted VOs in aggregate JSONB)
  │           └── ADR-008 (Two-step orchestration)
  └── ADR-002 (Voice pipeline — port/adapter pattern)
        └── ADR-006 (Duration policy)
        └── ADR-010 (AsyncIterable stream contracts)
              └── ADR-011 (WebSocket transport via @fastify/websocket v11)

ADR-004 (Langfuse OTel)
  └── ADR-009 (Telemetry factory closure enriches Langfuse spans)
  └── ADR-012 (OTel span hierarchy for voice pipeline — concretizes ADR-004's trace structure)
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
