import { Result } from "@carbonteq/fp";
import { InvalidReportInputError } from "../errors/report.errors.js";

export interface TopicScoreProps {
  readonly topicName: string;
  readonly score: number; // 0..5 (rubric scale)
  readonly justification: string;
}

export class TopicScore {
  private constructor(
    readonly topicName: string,
    readonly score: number,
    readonly justification: string,
  ) {}

  static create(props: TopicScoreProps): Result<TopicScore, InvalidReportInputError> {
    if (!props.topicName.trim()) {
      return Result.Err(new InvalidReportInputError("TopicScore.topicName must not be empty"));
    }
    if (!Number.isFinite(props.score) || props.score < 0 || props.score > 5) {
      return Result.Err(new InvalidReportInputError("TopicScore.score must be between 0 and 5"));
    }
    if (!props.justification.trim()) {
      return Result.Err(new InvalidReportInputError("TopicScore.justification must not be empty"));
    }
    return Result.Ok(new TopicScore(props.topicName, props.score, props.justification));
  }

  serialize(): TopicScoreProps {
    return { topicName: this.topicName, score: this.score, justification: this.justification };
  }

  static fromSerialized(data: TopicScoreProps): TopicScore {
    return new TopicScore(data.topicName, data.score, data.justification);
  }
}
