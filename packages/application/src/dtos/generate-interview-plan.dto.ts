import { z } from "zod";
import { Result } from "@carbonteq/fp";
import type { InterviewStatus } from "@repo/domain";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const GenerateInterviewPlanInputSchema = z
  .object({
    interviewId: z.string().min(1),
    targetDurationMinutes: z.number().int().positive().optional(),
    maxDurationMinutes: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.targetDurationMinutes === undefined ||
      v.maxDurationMinutes === undefined ||
      v.maxDurationMinutes >= v.targetDurationMinutes,
    {
      message: "maxDurationMinutes must be >= targetDurationMinutes",
      path: ["maxDurationMinutes"],
    },
  );

export type GenerateInterviewPlanInput = z.infer<typeof GenerateInterviewPlanInputSchema>;

export class GenerateInterviewPlanInputDto extends BaseDto<GenerateInterviewPlanInput> {
  static parse(raw: unknown): Result<GenerateInterviewPlanInputDto, DtoValidationError> {
    return BaseDto.validate(GenerateInterviewPlanInputSchema, raw).map(
      (v) => new GenerateInterviewPlanInputDto(v),
    );
  }
}

export interface GenerateInterviewPlanOutput {
  readonly interviewId: string;
  readonly status: InterviewStatus;
  readonly topicCount: number;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
}
