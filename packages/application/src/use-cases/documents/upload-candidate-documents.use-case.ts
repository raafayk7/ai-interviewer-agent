import { Result } from "@carbonteq/fp";
import type { FileRef } from "@repo/domain";
import { UseCase } from "../../core/use-case.js";
import type { ServiceError } from "../../core/service-error.js";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";
import type {
  UploadCandidateDocumentsInput,
  UploadCandidateDocumentsOutput,
} from "../../dtos/upload-candidate-documents.dto.js";

const buildKey = (recruiterId: string, kind: "jd" | "cv", filename: string): string =>
  `recruiters/${recruiterId}/uploads/${kind}/${Date.now()}-${filename}`;

const toOutputRef = (ref: FileRef): UploadCandidateDocumentsOutput["jdRef"] => ({
  key: ref.key,
  contentType: ref.contentType,
  sizeBytes: ref.sizeBytes,
  originalFilename: ref.originalFilename,
  uploadedAt: ref.uploadedAt,
});

export class UploadCandidateDocumentsUseCase extends UseCase<
  UploadCandidateDocumentsInput,
  UploadCandidateDocumentsOutput
> {
  constructor(private readonly storage: IFileStorageService) {
    super();
  }

  async execute(
    input: UploadCandidateDocumentsInput,
  ): Promise<Result<UploadCandidateDocumentsOutput, ServiceError>> {
    const jdKey = buildKey(input.recruiterId, "jd", input.jdFile.filename);
    const cvKey = buildKey(input.recruiterId, "cv", input.cvFile.filename);

    const jdResult = await this.storage.upload(input.jdFile.buffer, jdKey, input.jdFile.contentType);
    const cvResult = await this.storage.upload(input.cvFile.buffer, cvKey, input.cvFile.contentType);

    return Result.all(jdResult, cvResult)
      .map(([jdRef, cvRef]) => ({ jdRef: toOutputRef(jdRef), cvRef: toOutputRef(cvRef) }))
      .mapErr((errs) => errs[0] as ServiceError);
  }
}
