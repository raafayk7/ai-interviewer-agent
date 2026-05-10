import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface AgentNoteProps {
  readonly note: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}

export class AgentNote {
  private constructor(
    readonly note: string,
    readonly recordedAtTurn: number,
    readonly recordedAt: Date,
  ) {}

  static create(props: AgentNoteProps): Result<AgentNote, InvalidInterviewInputError> {
    if (!props.note.trim()) {
      return Result.Err(new InvalidInterviewInputError("AgentNote.note must not be empty"));
    }
    if (!Number.isInteger(props.recordedAtTurn) || props.recordedAtTurn < 0) {
      return Result.Err(
        new InvalidInterviewInputError("AgentNote.recordedAtTurn must be a non-negative integer"),
      );
    }
    return Result.Ok(new AgentNote(props.note, props.recordedAtTurn, props.recordedAt));
  }

  serialize(): AgentNoteProps {
    return {
      note: this.note,
      recordedAtTurn: this.recordedAtTurn,
      recordedAt: this.recordedAt,
    };
  }

  static fromSerialized(data: AgentNoteProps): AgentNote {
    return new AgentNote(data.note, data.recordedAtTurn, data.recordedAt);
  }
}
