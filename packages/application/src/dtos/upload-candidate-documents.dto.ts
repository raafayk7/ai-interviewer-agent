import { z } from "zod";
import { Result } from "@carbonteq/fp";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileInputSchema = z.object({
  buffer: z.instanceof(Buffer),
  contentType: z.string().min(1),
  filename: z.string().min(1),
});

export const UploadCandidateDocumentsInputSchema = z.object({
  recruiterId: z.string().min(1),
  jdFile: FileInputSchema,
  cvFile: FileInputSchema,
});

export type UploadCandidateDocumentsInput = z.infer<typeof UploadCandidateDocumentsInputSchema>;

export class UploadCandidateDocumentsInputDto extends BaseDto<UploadCandidateDocumentsInput> {
  static parse(raw: unknown): Result<UploadCandidateDocumentsInputDto, DtoValidationError> {
    return BaseDto.validate(UploadCandidateDocumentsInputSchema, raw).map(
      (v) => new UploadCandidateDocumentsInputDto(v),
    );
  }
}

// ---------- Output DTO ----------

export interface UploadCandidateDocumentsOutput {
  readonly jdRef: {
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly originalFilename: string;
    readonly uploadedAt: Date;
  };
  readonly cvRef: UploadCandidateDocumentsOutput["jdRef"];
}
