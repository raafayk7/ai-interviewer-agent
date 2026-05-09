# ADR-009 Document-Extraction Telemetry via Factory Closure, Not Port Widening

## Status

Accepted. Date: 2026-05-09.

## Context

`GeminiDocumentExtractionService` calls `generateObject` / `generateText + Output.object(...)` twice per interview setup (once for the JD, once for the CV). AI SDK's `experimental_telemetry` settings accept a `metadata` record — a `Record<string, AttributeValue>` — that Langfuse (the OTel backend from Phase 2) surfaces as per-span attributes in its trace view. Useful attributes for each extraction span are: the `recruiterId` who initiated the upload, the `documentKey` (the `FileRef.key` that resolves to the raw blob), and the document `kind` (`"jd"` or `"cv"`).

The application-layer port `IDocumentExtractionService` (in `packages/application/src/ports/document-extraction/document-extraction.port.ts`) has two methods:

```typescript
extractJobDescription(file: Buffer, contentType: string): Promise<Result<JobDescription, DocumentExtractionError>>;
extractCandidateInfo(file: Buffer, contentType: string): Promise<Result<CandidateInfo, DocumentExtractionError>>;
```

Neither method receives `recruiterId`, `documentKey`, or any telemetry context. The question is how to get that metadata into the adapter call without compromising the port's domain purity.

Two approaches are viable:

1. Widen the port to accept an optional telemetry context parameter.
2. Keep the port narrow; have the use case construct a new adapter instance per document, parameterized with the per-call context.

ADR-001 (Clean Architecture + DDD) prohibits infrastructure concerns from leaking into the application-layer port contracts. Telemetry metadata (`recruiterId`, `documentKey`, observability context) is an infrastructure concern.

## Decision

Keep `IDocumentExtractionService` narrow. The use case accepts a `DocumentExtractorFactory` — a function `(ctx: { recruiterId: string; documentKey: string }) => IDocumentExtractionService` — instead of a single service instance. For each extraction call the use case creates a purpose-built adapter instance with the correct per-document context, then discards it.

The factory type is defined in `packages/application/src/use-cases/documents/` and exported from the documents barrel:

```typescript
export interface DocumentExtractorContext {
  readonly recruiterId: string;
  readonly documentKey: string;
}

export type DocumentExtractorFactory = (ctx: DocumentExtractorContext) => IDocumentExtractionService;
```

`ExtractCandidateDocumentsUseCase` is constructed with a `DocumentExtractorFactory`:

```typescript
constructor(
  private readonly storage: IFileStorageService,
  private readonly extractorFactory: DocumentExtractorFactory,
) { super(); }
```

Inside `execute(input)`, two adapters are created:

```typescript
const jdExtractor = this.extractorFactory({ recruiterId: input.recruiterId, documentKey: input.jdFile.key });
const cvExtractor = this.extractorFactory({ recruiterId: input.recruiterId, documentKey: input.cvFile.key });
```

The composition root (Phase 7) wires the factory as a closure:

```typescript
const extractorFactory: DocumentExtractorFactory = (ctx) =>
  new GeminiDocumentExtractionService(geminiHandle, ctx.documentKey, ctx.recruiterId);
```

`IDocumentExtractionService` itself is unchanged. Other implementations of the port (for example a test double, or a future non-Gemini adapter) do not need to be aware of the factory pattern.

## Alternatives Considered

### Alternative A: Widen the port with an optional telemetry context parameter

Add a third parameter to both port methods:

```typescript
extractJobDescription(
  file: Buffer,
  contentType: string,
  telemetryCtx?: { recruiterId?: string; documentKey?: string },
): Promise<Result<JobDescription, DocumentExtractionError>>;
```

Rejected because:

- **Infrastructure concern in the application-layer contract.** `recruiterId` and `documentKey` are Langfuse metadata attributes — they mean nothing to the domain. Adding them to a domain-adjacent port couples the port's signature to a specific observability pattern. Swapping to a different telemetry backend (or removing Langfuse entirely) would require changing the port contract and every implementation.
- **Optional parameters invite silent omission.** Making the parameter optional (`telemetryCtx?`) means any caller that omits it silently loses per-document tracing with no compiler error. The factory pattern fails loudly if the composition root omits the factory — a missing constructor argument is a type error.
- **Every future port implementation must decide what to do with the parameter.** A mock adapter, an in-memory test double, and any future non-Gemini extraction adapter all receive a parameter they do not use. This is noise in every implementation.

### Alternative B: Widen the port with a required telemetry context parameter

Same as Alternative A but with the context required (no `?`). Every implementation must accept it.

Rejected for the same core reason (infrastructure concern in an application port), plus:

- All existing test doubles and mock adapters must be updated even if they use `vi.fn()` and never inspect the parameter.
- This is a breaking change to the Phase 1 port contract; any integration in other packages that calls the port directly must be updated.

### Alternative C: Pass telemetry context through a thread-local or ambient context (AsyncLocalStorage)

Use Node.js `AsyncLocalStorage` to propagate `recruiterId` and `documentKey` as ambient context that the infrastructure adapter reads without any parameter change to the port.

Rejected because:

- **Invisible coupling.** The adapter's behaviour changes based on ambient state that is not visible at the call site. Debugging "why is this span missing metadata" requires tracing AsyncLocalStorage scoping, which is non-trivial.
- **Test complexity.** Tests must set up and tear down the AsyncLocalStorage context for each test case. Forgetting to do so produces tests that pass in isolation but fail in parallel or when running in a different order.
- **Premature infrastructure.** The project does not currently use AsyncLocalStorage for any purpose. Introducing it solely for telemetry metadata adds a cross-cutting mechanism with significant cognitive overhead for a minor observability benefit.

### Alternative D: Accept a single shared adapter instance; document key and recruiter id are "unknown"

Inject one `GeminiDocumentExtractionService` instance constructed with `documentKey: "unknown"` and `recruiterId: "unknown"`. Telemetry spans exist but without per-document or per-recruiter filtering.

Rejected as a permanent decision because:

- **Langfuse's value proposition is per-session filtering.** Without `recruiterId` and `documentKey` in the metadata, it is impossible to filter "all extraction spans for recruiter X" or "the span for the JD that was extracted at key Y" in the Langfuse dashboard. The primary use case for telemetry metadata is post-hoc debugging (why did this extraction fail or produce wrong output?) — that use case requires document-level granularity.
- **The factory pattern costs nothing.** A `DocumentExtractorFactory` closure constructs a single `GeminiDocumentExtractionService` instance (one object allocation) per `execute()` call. At the frequency of document extraction (once per interview creation, not on the hot interview turn path) this is negligible.
- Accepted as a **temporary fallback** during development when the composition root is not yet wired (Phases 3–6); the production composition root (Phase 7) provides a real factory.

## Consequences

**Benefits**

- `IDocumentExtractionService` stays narrow and domain-clean: `(Buffer, string) → Result<VO, Error>`. No telemetry concepts in the port.
- Each extraction span in Langfuse includes `recruiterId`, `documentKey`, and `kind` (`"jd"` or `"cv"`), enabling per-document filtering for debugging and cost analysis.
- The factory pattern is fully type-safe. A composition root that fails to provide the factory produces a compile-time error, not a silent metadata omission.
- Other implementations of `IDocumentExtractionService` (test doubles, future non-Gemini adapters) are unaffected: they implement the narrow two-method port and ignore the factory concern entirely.

**Trade-offs**

- `ExtractCandidateDocumentsUseCase` no longer accepts a plain `IDocumentExtractionService`. Any composition root that injected a bare service instance must be updated to inject a factory closure instead. At the time of writing (before Phase 7), there is no production composition root — the change is cost-free.
- The factory type (`DocumentExtractorFactory`) is exported from the application layer, which means the application layer defines a type that is primarily implemented in the infrastructure layer. This is acceptable: the type is a function signature (`(ctx) => IDocumentExtractionService`), not a concrete class, and it belongs with the use case that consumes it.

**Risks and mitigations**

- *Risk*: The factory is incorrectly wired in Phase 7 (for example, `documentKey` and `recruiterId` are swapped), producing misleading telemetry. *Mitigation*: The `GeminiDocumentExtractionService` test suite verifies that `experimental_telemetry.metadata.documentKey` and `.recruiterId` match the constructor arguments — the test spy asserts the call arguments directly (`gemini-document-extraction.service.test.ts`).
- *Risk*: A future developer adds a second injection site for `IDocumentExtractionService` (a new use case) and injects a bare instance, losing the per-document context. *Mitigation*: The `llm_judge` enforcement block below checks for bare `IDocumentExtractionService` injections in new use-case constructors and suggests using `DocumentExtractorFactory` instead.

## Related Decisions

- **ADR-001 (Clean Architecture + DDD)**: Prohibits infrastructure concerns (telemetry metadata) in application-layer ports. This ADR resolves the tension between observability requirements and port purity.
- **ADR-003 (Use Gemini Multimodal for Document Ingestion)**: Defines `IDocumentExtractionService`. This ADR leaves that port unchanged.
- **ADR-004 (Langfuse and OpenTelemetry for LLM Observability)**: Establishes the telemetry infrastructure that makes per-span `metadata` attributes valuable. The factory closure pattern is the mechanism by which this phase's spans carry per-document attributes without violating ADR-001.
- **ADR-008 (Two-Step Orchestration: Extract Then Generate Plan)**: Defines `ExtractCandidateDocumentsUseCase`, the use case that adopts the factory pattern. The factory type is co-located with that use case.

## References

- `packages/application/src/use-cases/documents/extract-candidate-documents.use-case.ts` — `DocumentExtractorFactory` type, constructor signature.
- `packages/application/src/ports/document-extraction/document-extraction.port.ts` — `IDocumentExtractionService`; unchanged narrow signature.
- `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.ts` — `GeminiDocumentExtractionService` constructor: `(handle, documentKey, recruiterId)`.
- `apps/backend/src/infrastructure/services/gemini/gemini-document-extraction.service.test.ts` — test case that asserts `experimental_telemetry.metadata.documentKey` and `.recruiterId` match constructor arguments.
- `.claude/plan/phase-3-document-extraction-and-plan-generation.md` Step 11 update (lines 978-990) — original factory-pattern rationale from the plan generator.
- AI SDK `TelemetrySettings` type: `node_modules/.pnpm/ai@6.0.158_zod@4.3.6/.../index.d.ts` lines 1104-1142 — `metadata: Record<string, AttributeValue>`.

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "IDocumentExtractionService.*recruiterId|recruiterId.*IDocumentExtractionService",
      "path_glob": "packages/application/src/ports/**/*.ts",
      "message": "IDocumentExtractionService must not carry telemetry context parameters (ADR-009). Use DocumentExtractorFactory in the use case instead."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```
