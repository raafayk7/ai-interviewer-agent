import type { Result } from "@carbonteq/fp";
import type { CandidateInfo, JobDescription } from "@repo/domain";
import type { DocumentExtractionError } from "./document-extraction-error.js";

/**
 * Phase 1 only defines the port. Adapter (`GeminiDocumentExtractionService`) lands in Phase 3.
 *
 * Inputs are raw bytes + content type so the adapter can hand them straight to Gemini's
 * multimodal `generateObject` (per §4.5).
 */
export interface IDocumentExtractionService {
  extractJobDescription(
    file: Buffer,
    contentType: string,
  ): Promise<Result<JobDescription, DocumentExtractionError>>;

  extractCandidateInfo(
    file: Buffer,
    contentType: string,
  ): Promise<Result<CandidateInfo, DocumentExtractionError>>;
}
