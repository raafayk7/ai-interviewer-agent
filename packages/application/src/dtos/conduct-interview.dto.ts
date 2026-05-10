import { Result } from "@carbonteq/fp";
import type {
  AgentInternalScoreProps,
  AgentNoteProps,
  TranscriptEntryProps,
} from "@repo/domain";
import { z } from "zod";
import { BaseDto, type DtoValidationError } from "../core/base-dto.js";
import type { EndInterviewReason } from "../ports/interview-agent/index.js";

export const ConductInterviewInputSchema = z.object({
  interviewId: z.string().min(1),
});

export type ConductInterviewInput = z.infer<typeof ConductInterviewInputSchema>;

export class ConductInterviewInputDto extends BaseDto<ConductInterviewInput> {
  static parse(
    raw: unknown,
  ): Result<ConductInterviewInputDto, DtoValidationError> {
    return BaseDto.validate(ConductInterviewInputSchema, raw).map(
      (value) => new ConductInterviewInputDto(value),
    );
  }
}

export interface ConductInterviewOutput {
  readonly interviewId: string;
  readonly turnsCompleted: number;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly notes: ReadonlyArray<AgentNoteProps>;
  readonly internalScores: ReadonlyArray<AgentInternalScoreProps>;
  /** Mirrors what the agent emitted when it ended; null if the system forced end. */
  readonly endReason: EndInterviewReason | null;
  /** Whether the system enforced the hard ceiling. */
  readonly hardCeilingHit: boolean;
}
