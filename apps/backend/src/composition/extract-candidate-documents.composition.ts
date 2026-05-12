import {
  ExtractCandidateDocumentsUseCase,
  type DocumentExtractorFactory,
} from "@repo/application";
import {
  geminiProviderFromEnv,
  GeminiDocumentExtractionService,
} from "../infrastructure/services/gemini/index.js";
import { LocalFileStorageService } from "../infrastructure/services/index.js";

export interface ExtractCandidateDocumentsDepsBundle {
  readonly buildUseCase: () => ExtractCandidateDocumentsUseCase;
}

export interface ExtractCandidateDocumentsCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly storage?: LocalFileStorageService;
}

export function buildExtractCandidateDocumentsDeps(
  options: ExtractCandidateDocumentsCompositionOptions = {},
): ExtractCandidateDocumentsDepsBundle {
  const env = options.env ?? process.env;

  const storageResult =
    options.storage === undefined
      ? LocalFileStorageService.fromEnv(env)
      : undefined;
  if (storageResult?.isErr()) {
    throw new Error(`Boot failed: ${storageResult.unwrapErr().message}`);
  }

  const geminiHandle = geminiProviderFromEnv(env);
  if (geminiHandle.isErr()) {
    throw new Error(`Boot failed: ${geminiHandle.unwrapErr().message}`);
  }

  const storage = options.storage ?? storageResult?.unwrap();
  if (!storage) {
    throw new Error(
      "Boot failed: LocalFileStorageService could not be constructed",
    );
  }

  const handle = geminiHandle.unwrap();
  const extractorFactory: DocumentExtractorFactory = (context) =>
    new GeminiDocumentExtractionService(
      handle,
      context.documentKey,
      context.recruiterId,
    );

  return {
    buildUseCase: () =>
      new ExtractCandidateDocumentsUseCase(storage, extractorFactory),
  };
}
