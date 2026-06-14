import { ServiceInfraError } from "../../core/service-error.js";

export abstract class DocumentExtractionError extends ServiceInfraError {}

export class DocumentExtractionUnavailableError extends DocumentExtractionError {
  readonly code = "EXTRACTION_UNAVAILABLE";
}

export class DocumentExtractionParseFailedError extends DocumentExtractionError {
  readonly code = "EXTRACTION_PARSE_FAILED";
  constructor(message: string, readonly documentKey: string) {
    super(message);
  }
}

export class DocumentExtractionUnknownError extends DocumentExtractionError {
  readonly code = "EXTRACTION_UNKNOWN";
}
