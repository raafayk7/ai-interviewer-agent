import { Result } from "@carbonteq/fp";
import type { TranscriptEntryProps } from "@repo/domain";
import { z } from "zod";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";

export const RunScriptedInterviewSessionInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type RunScriptedInterviewSessionInput = z.infer<
  typeof RunScriptedInterviewSessionInputSchema
>;

export class RunScriptedInterviewSessionInputDto extends BaseDto<RunScriptedInterviewSessionInput> {
  static parse(
    raw: unknown,
  ): Result<RunScriptedInterviewSessionInputDto, DtoValidationError> {
    return BaseDto.validate(RunScriptedInterviewSessionInputSchema, raw).map(
      (v) => new RunScriptedInterviewSessionInputDto(v),
    );
  }
}

export interface RunScriptedInterviewSessionOutput {
  readonly interviewId: string;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly turnsCompleted: number;
  readonly scriptVersion: string;
}
