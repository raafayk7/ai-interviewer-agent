import {
  ExtractCandidateDocumentsUseCase,
  type DocumentExtractorContext,
  UploadCandidateDocumentsUseCase,
} from "@repo/application";
import {
  GeminiDocumentExtractionService,
  geminiProviderFromEnv,
  fileStorageFromEnv,
} from "../infrastructure/services/index.js";
import type { RecruiterDocumentControllerDeps } from "../presentation/controllers/recruiter-document.controller.js";

export interface RecruiterDocumentCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
}

export function buildRecruiterDocumentDeps(
  options: RecruiterDocumentCompositionOptions = {},
): RecruiterDocumentControllerDeps {
  const env = options.env ?? process.env;
  const storage = fileStorageFromEnv(env);
  if (storage.isErr()) {
    throw new Error(`Boot failed: ${storage.unwrapErr().message}`);
  }

  const geminiHandleResult = geminiProviderFromEnv(env);
  if (geminiHandleResult.isErr()) {
    throw new Error(`Boot failed: ${geminiHandleResult.unwrapErr().message}`);
  }

  const storageService = storage.unwrap();
  const geminiHandle = geminiHandleResult.unwrap();

  return {
    uploadDocumentsUseCase: new UploadCandidateDocumentsUseCase(storageService),
    extractDocumentsUseCase: new ExtractCandidateDocumentsUseCase(
      storageService,
      (context: DocumentExtractorContext) =>
        new GeminiDocumentExtractionService(
          geminiHandle,
          context.documentKey,
          context.recruiterId,
        ),
    ),
  };
}
