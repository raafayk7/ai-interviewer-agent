import { Result } from "@carbonteq/fp";
import { UseCase } from "../../core/use-case.js";
import type { ServiceError } from "../../core/service-error.js";
import type {
  ExtractCandidateDocumentsInput,
  ExtractCandidateDocumentsOutput,
} from "../../dtos/extract-candidate-documents.dto.js";
import type { IDocumentExtractionService } from "../../ports/document-extraction/document-extraction.port.js";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";

export interface DocumentExtractorContext {
  readonly recruiterId: string;
  readonly documentKey: string;
}

export type DocumentExtractorFactory = (
  context: DocumentExtractorContext,
) => IDocumentExtractionService;

export class ExtractCandidateDocumentsUseCase extends UseCase<
  ExtractCandidateDocumentsInput,
  ExtractCandidateDocumentsOutput
> {
  constructor(
    private readonly storage: IFileStorageService,
    private readonly extractorFactory: DocumentExtractorFactory,
  ) {
    super();
  }

  async execute(
    input: ExtractCandidateDocumentsInput,
  ): Promise<Result<ExtractCandidateDocumentsOutput, ServiceError>> {
    const jdBytesResult = await this.storage.download(input.jdFile.key);
    if (jdBytesResult.isErr()) {
      return Result.Err(jdBytesResult.unwrapErr() as ServiceError);
    }

    const cvBytesResult = await this.storage.download(input.cvFile.key);
    if (cvBytesResult.isErr()) {
      return Result.Err(cvBytesResult.unwrapErr() as ServiceError);
    }

    const jdExtractor = this.extractorFactory({
      recruiterId: input.recruiterId,
      documentKey: input.jdFile.key,
    });
    const jdResult = await jdExtractor.extractJobDescription(
      jdBytesResult.unwrap(),
      input.jdFile.contentType,
    );
    if (jdResult.isErr()) {
      return Result.Err(jdResult.unwrapErr() as ServiceError);
    }

    const cvExtractor = this.extractorFactory({
      recruiterId: input.recruiterId,
      documentKey: input.cvFile.key,
    });
    const candidateResult = await cvExtractor.extractCandidateInfo(
      cvBytesResult.unwrap(),
      input.cvFile.contentType,
    );
    if (candidateResult.isErr()) {
      return Result.Err(candidateResult.unwrapErr() as ServiceError);
    }

    return Result.Ok({
      jobDescription: jdResult.unwrap().serialize(),
      candidateInfo: candidateResult.unwrap().serialize(),
    });
  }
}
