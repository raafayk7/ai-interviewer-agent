import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";

export const TOPIC_PRIORITY = {
  MUST_COVER: "must_cover",
  IF_TIME_PERMITS: "if_time_permits",
} as const;

export type TopicPriority = (typeof TOPIC_PRIORITY)[keyof typeof TOPIC_PRIORITY];

export interface PlannedTopicProps {
  readonly name: string;
  readonly questions: ReadonlyArray<string>;
  readonly timeAllocationMinutes: number;
  readonly priority: TopicPriority;
}

export class PlannedTopic {
  private constructor(
    readonly name: string,
    readonly questions: ReadonlyArray<string>,
    readonly timeAllocationMinutes: number,
    readonly priority: TopicPriority,
  ) {}

  static create(props: PlannedTopicProps): Result<PlannedTopic, InvalidInterviewInputError> {
    if (!props.name.trim()) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.name must not be empty"));
    }
    if (props.questions.length === 0) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.questions must contain at least one question"));
    }
    if (!Number.isFinite(props.timeAllocationMinutes) || props.timeAllocationMinutes <= 0) {
      return Result.Err(new InvalidInterviewInputError("PlannedTopic.timeAllocationMinutes must be > 0"));
    }
    return Result.Ok(
      new PlannedTopic(
        props.name,
        Object.freeze([...props.questions]),
        props.timeAllocationMinutes,
        props.priority,
      ),
    );
  }

  serialize(): PlannedTopicProps {
    return {
      name: this.name,
      questions: this.questions,
      timeAllocationMinutes: this.timeAllocationMinutes,
      priority: this.priority,
    };
  }

  static fromSerialized(data: PlannedTopicProps): PlannedTopic {
    return new PlannedTopic(data.name, Object.freeze([...data.questions]), data.timeAllocationMinutes, data.priority);
  }
}
