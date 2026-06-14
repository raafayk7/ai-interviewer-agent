# ADR-003 Use Gemini Multimodal for Document Ingestion

## Status

Accepted. Date: 2026-05-09.

## Context

The system ingests recruiter-uploaded CVs (PDF or image) and Job Descriptions (JDs, PDF or plain text), then produces structured extraction — candidate skills, years of experience, prior roles; role responsibilities, required skills — to feed the interview agent at session start.

Two constraints shaped the choice:

1. Documents arrive in two distinct forms: text-native PDFs (which a simple text extractor can handle) and scanned or image-based PDFs (which require vision). An extraction strategy must handle both without branching at the call site.
2. Downstream code (the interview agent, the evaluation use case) must receive typed, validated objects — `JobDescription` and `CandidateInfo` domain value objects — not raw strings that require further parsing.

The chosen approach is documented in `docs/ARCHITECTURE.md` §4.5 (lines 188-197): "Uploaded CVs and JDs are parsed using Gemini's native multimodal capabilities via AI SDK, not a separate OCR service." The application-layer port that formalises this contract is already in place from Phase 1: `IDocumentExtractionService` in `packages/application/src/ports/document-extraction/document-extraction.port.ts` (lines 11-21), with its error hierarchy in `packages/application/src/ports/document-extraction/document-extraction-error.ts` (lines 1-18). The infrastructure adapter (`GeminiDocumentExtractionService`) is scheduled for Phase 3.

ADR-001 (Clean Architecture + DDD + FP) governs the port/adapter pattern and `Result<T, E>` discipline applied here.

## Decision

Document extraction uses Gemini 2.5 Pro's native multimodal capabilities via the Vercel AI SDK. A single `generateObject` call, parameterised with a Zod 4 schema, produces a typed, validated `JobDescription` or `CandidateInfo` value object. No separate OCR pipeline is introduced.

Scope of this decision:

- Gemini accepts PDF and image input directly; no preprocessing layer (no Tesseract binary, no Textract pipeline) is needed to handle scanned or image-based documents.
- Extraction happens once at upload time. The structured result is persisted alongside the raw file; no re-extraction occurs at interview runtime.
- The application layer depends on `IDocumentExtractionService` (the port in `packages/application/src/ports/document-extraction/`). The concrete infrastructure adapter (`GeminiDocumentExtractionService`) implements that port. All use cases call the port interface, never the adapter directly.
- `Result<T, E>` return types are used throughout, consistent with ADR-001: `extractJobDescription` and `extractCandidateInfo` both return `Promise<Result<JobDescription | CandidateInfo, DocumentExtractionError>>`.

This decision does not cover voice-pipeline inference (covered by ADR-002) or observability tracing (addressed separately in a forthcoming ADR).

## Alternatives Considered

### Alternative A: Tesseract or Textract OCR then a separate LLM extraction step

A two-stage pipeline: first run an OCR engine (Tesseract.js for local execution, or AWS Textract for a managed service) to produce a plain-text string, then pass that string to an LLM with a prompt asking it to extract structured fields.

Rejected because:

- Two sequential failure modes replace one. An OCR failure or a low-confidence OCR output silently degrades the LLM extraction step; each stage requires independent error handling and monitoring.
- Tesseract requires a native binary dependency and adds approximately 15-30 MB to the deployment image. AWS Textract requires IAM role configuration, region pinning, and a separate billing surface.
- Neither provides any quality advantage over Gemini's native multimodal for the document types this system handles (standard CV PDFs, job postings). Gemini processes the raw bytes directly; there is no intermediary lossy conversion step.
- The additional infrastructure complexity is unjustified when the project already uses Gemini for the voice pipeline (ADR-002) and has one vendor relationship with Google AI Studio.

### Alternative B: Self-hosted open-source vision-language model (for example Qwen-VL or LLaVA)

Run a vision-language model (VLM) on project-owned infrastructure to avoid vendor dependency for extraction.

Rejected for this phase because:

- The team has no GPU infrastructure. CPU inference on a multi-page PDF with a 7 B+ parameter VLM carries a latency penalty measured in tens of seconds per document — unacceptable for an upload-time extraction step.
- Structured-output reliability (the ability to follow a Zod schema reliably) is materially weaker in open-weights 7 B models than in Gemini 2.5 Pro at the time of this decision.
- Hosting, updating, and monitoring a self-hosted model introduces operational overhead the team cannot absorb in the current phase.
- Reconsider if data-residency regulations or per-document cost at scale become binding constraints. The port/adapter design means a swap requires only a new infrastructure class.

### Alternative C: Manual structured input from the recruiter (no extraction at all)

Require recruiters to fill in a structured form (skill checklist, years-of-experience field, role description textarea) instead of uploading a document.

Rejected because it defeats a core product promise. The value of the system is that a recruiter uploads an existing CV and JD and receives an interview — shifting data-entry burden onto the recruiter adds friction, increases error rates (manual transcription of a 10-page CV), and breaks the upload-to-interview workflow. The structured fields the agent needs (skill list, experience years, prior roles) are not consistently formatted in source documents, so a form would still require recruiter judgement to fill correctly.

## Consequences

**Benefits**

- One vendor call replaces a multi-stage pipeline. Fewer failure modes, less code, simpler observability: extraction produces a single Langfuse generation span rather than a chain of OCR span plus LLM span.
- Gemini's `generateObject` + Zod 4 schema gives type-safe extraction at the boundary. Downstream code receives a validated `JobDescription` or `CandidateInfo` value object, not a raw string requiring further parsing.
- Text-native and scanned/image-based documents are handled in one pass. No branching logic to detect document type before choosing an extraction path.
- Same vendor as the voice pipeline (ADR-002): one Google AI Studio API key, one billing surface for the full AI surface area of the product.
- The `IDocumentExtractionService` port is already in place (Phase 1). Adding the `GeminiDocumentExtractionService` adapter in Phase 3 requires zero changes to application-layer use cases.

**Trade-offs**

- Vendor lock-in to Google AI Studio for document extraction. Mitigated by the port/adapter boundary: swapping to a different provider (for example an Anthropic VLM) requires writing a new adapter class in `apps/backend/src/infrastructure/` without touching use cases or the domain.
- Per-document cost is higher than running an open-source OCR binary on owned hardware at high volume. Acceptable at current expected extraction volume; revisit if monthly extraction volume grows by an order of magnitude.
- Extraction at upload time means a Gemini API outage at upload time blocks the recruiter from creating an interview session. Mitigated by returning a `DocumentExtractionUnavailableError` (already defined in the error hierarchy) with a clear HTTP 503 and a retry recommendation; the raw file is persisted regardless.

**Risks and mitigations**

- *Risk*: Gemini hallucinates values for ambiguous fields (for example inferring "5 years experience" from prose that actually describes project duration, not tenure). *Mitigation*: Zod 4 schema validation rejects structurally invalid output at the extraction boundary before it reaches domain code. For high-stakes fields (years of experience, skill list), surface a confidence annotation to the recruiter UI where the model provides one; flag low-confidence extractions for recruiter review rather than failing silently.
- *Risk*: Large multi-page CVs (10+ pages) hit Gemini's per-request token limit or incur high per-call cost. *Mitigation*: Enforce an upload size limit (configurable, default 10 MB) at the presentation layer before the extraction use case is invoked. Log token counts per extraction call in Langfuse to track cost trends.
- *Risk*: Gemini structured-output changes (schema incompatibility across model versions) break extraction silently if the Zod schema is not updated. *Mitigation*: Pin the Gemini model version (for example `gemini-2.5-pro-001`) in the adapter configuration; treat a model upgrade as a deliberate change requiring extraction schema re-validation.

## Related Decisions

- **ADR-001 (Clean Architecture + DDD with Immutable Entities and Result/Option Error Handling)**: The port/adapter pattern applied here is ADR-001's prescribed model. `IDocumentExtractionService` is an application-layer port; `GeminiDocumentExtractionService` is an infrastructure-layer adapter. `Result<T, E>` governs all extraction return types.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The same Gemini provider (Google AI Studio, Vercel AI SDK) is used at voice-pipeline runtime. Using Gemini for extraction as well consolidates vendor relationships intentionally. ADR-002 notes at line 33: "document ingestion (CV/JD parsing uses Gemini multimodal directly — see §4.5)."

## References

- `docs/ARCHITECTURE.md` §4.5, lines 188-197: Document Ingestion section stating the chosen approach verbatim.
- `packages/application/src/ports/document-extraction/document-extraction.port.ts`, lines 11-21: `IDocumentExtractionService` port definition (`extractJobDescription`, `extractCandidateInfo`, both accepting `Buffer` + `contentType`).
- `packages/application/src/ports/document-extraction/document-extraction-error.ts`, lines 1-18: `DocumentExtractionError` hierarchy (`Unavailable`, `ParseFailed`, `Unknown` variants).
- `docs/progress/phase-1.md`, lines 387-402: Phase 1 delivery note for the document-extraction port directory.
- Vercel AI SDK `generateObject` reference: https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data
- Gemini multimodal document processing: https://ai.google.dev/gemini-api/docs/document-processing

## Enforcement

The core rule — use Gemini multimodal via the AI SDK, not a separate OCR pipeline — requires semantic judgement to evaluate: a reviewer must assess whether a new extraction code path is backed by `IDocumentExtractionService` or is bypassing it. `llm_judge: true` is set accordingly. The declarative block below catches direct imports of the three most likely OCR alternatives at the package level.

```json
{
  "forbid_import": [
    {
      "pattern": "from\\s+['\"](tesseract\\.js|node-tesseract-ocr|@aws-sdk/client-textract)['\"]",
      "path_glob": "apps/backend/src/**/*.ts",
      "message": "Document extraction uses Gemini multimodal via the Vercel AI SDK (ADR-003). Do not introduce Tesseract or Textract."
    }
  ],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```
