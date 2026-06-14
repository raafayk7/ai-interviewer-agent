import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { CandidateInfoProps, JobDescriptionProps } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

const FileRefLikeSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
});

export const ExtractCandidateDocumentsInputSchema = z.object({
  recruiterId: z.string().min(1),
  jdFile: FileRefLikeSchema,
  cvFile: FileRefLikeSchema,
});

export type ExtractCandidateDocumentsInput = z.infer<typeof ExtractCandidateDocumentsInputSchema>;

export class ExtractCandidateDocumentsInputDto extends BaseDto<ExtractCandidateDocumentsInput> {
  static parse(raw: unknown): Result<ExtractCandidateDocumentsInputDto, DtoValidationError> {
    return BaseDto.validate(ExtractCandidateDocumentsInputSchema, raw).map(
      (v) => new ExtractCandidateDocumentsInputDto(v),
    );
  }
}

export interface ExtractCandidateDocumentsOutput {
  readonly jobDescription: JobDescriptionProps;
  readonly candidateInfo: CandidateInfoProps;
}
