import { UploadCandidateDocumentsUseCase, type IFileStorageService } from "@repo/application";
import { fileStorageFromEnv } from "../infrastructure/services/index.js";

export interface UploadCandidateDocumentsDepsBundle {
  readonly buildUseCase: () => UploadCandidateDocumentsUseCase;
}

export interface UploadCandidateDocumentsCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly storage?: IFileStorageService;
}

export function buildUploadCandidateDocumentsDeps(
  options: UploadCandidateDocumentsCompositionOptions = {},
): UploadCandidateDocumentsDepsBundle {
  const storageResult =
    options.storage === undefined
      ? fileStorageFromEnv(options.env ?? process.env)
      : undefined;

  if (storageResult?.isErr()) {
    throw new Error(`Boot failed: ${storageResult.unwrapErr().message}`);
  }

  const storage = options.storage ?? storageResult?.unwrap();
  if (!storage) {
    throw new Error(
      "Boot failed: file storage service could not be constructed",
    );
  }

  return {
    buildUseCase: () => new UploadCandidateDocumentsUseCase(storage),
  };
}
