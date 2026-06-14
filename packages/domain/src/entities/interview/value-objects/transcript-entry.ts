import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export const SPEAKER = { AGENT: "agent", CANDIDATE: "candidate" } as const;
export type Speaker = (typeof SPEAKER)[keyof typeof SPEAKER];

export interface TranscriptEntryProps {
  readonly speaker: Speaker;
  readonly text: string;
  readonly timestamp: Date;
}

export class TranscriptEntry {
  private constructor(
    readonly speaker: Speaker,
    readonly text: string,
    readonly timestamp: Date,
  ) {}

  static create(props: TranscriptEntryProps): Result<TranscriptEntry, InvalidInterviewInputError> {
    if (!props.text.trim()) {
      return Result.Err(new InvalidInterviewInputError("TranscriptEntry.text must not be empty"));
    }
    return Result.Ok(new TranscriptEntry(props.speaker, props.text, props.timestamp));
  }

  serialize(): TranscriptEntryProps {
    return { speaker: this.speaker, text: this.text, timestamp: this.timestamp };
  }

  static fromSerialized(data: TranscriptEntryProps): TranscriptEntry {
    return new TranscriptEntry(data.speaker, data.text, data.timestamp);
  }
}
