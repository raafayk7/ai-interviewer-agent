import { Result } from "@carbonteq/fp";
import type { ReportSerialized } from "@repo/domain";
import { z } from "zod";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const EvaluateInterviewInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type EvaluateInterviewInput = z.infer<typeof EvaluateInterviewInputSchema>;

export class EvaluateInterviewInputDto extends BaseDto<EvaluateInterviewInput> {
  static parse(raw: unknown): Result<EvaluateInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(EvaluateInterviewInputSchema, raw).map(
      (value) => new EvaluateInterviewInputDto(value),
    );
  }
}

export interface EvaluateInterviewOutput {
  readonly report: ReportSerialized;
}
