import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export interface AgentInternalScoreProps {
  readonly topicName: string;
  readonly score: number;
  readonly justification: string;
  readonly recordedAtTurn: number;
  readonly recordedAt: Date;
}

export class AgentInternalScore {
  private constructor(
    readonly topicName: string,
    readonly score: number,
    readonly justification: string,
    readonly recordedAtTurn: number,
    readonly recordedAt: Date,
  ) {}

  static create(props: AgentInternalScoreProps): Result<AgentInternalScore, InvalidInterviewInputError> {
    if (!props.topicName.trim()) {
      return Result.Err(new InvalidInterviewInputError("AgentInternalScore.topicName must not be empty"));
    }
    if (!Number.isFinite(props.score) || props.score < 0 || props.score > 5) {
      return Result.Err(new InvalidInterviewInputError("AgentInternalScore.score must be in [0, 5]"));
    }
    if (!props.justification.trim()) {
      return Result.Err(
        new InvalidInterviewInputError("AgentInternalScore.justification must not be empty"),
      );
    }
    if (!Number.isInteger(props.recordedAtTurn) || props.recordedAtTurn < 0) {
      return Result.Err(
        new InvalidInterviewInputError(
          "AgentInternalScore.recordedAtTurn must be a non-negative integer",
        ),
      );
    }
    return Result.Ok(
      new AgentInternalScore(
        props.topicName,
        props.score,
        props.justification,
        props.recordedAtTurn,
        props.recordedAt,
      ),
    );
  }

  serialize(): AgentInternalScoreProps {
    return {
      topicName: this.topicName,
      score: this.score,
      justification: this.justification,
      recordedAtTurn: this.recordedAtTurn,
      recordedAt: this.recordedAt,
    };
  }

  static fromSerialized(data: AgentInternalScoreProps): AgentInternalScore {
    return new AgentInternalScore(
      data.topicName,
      data.score,
      data.justification,
      data.recordedAtTurn,
      data.recordedAt,
    );
  }
}
