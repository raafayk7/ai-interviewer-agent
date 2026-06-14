import { Result } from "@carbonteq/fp";
import { InvalidInterviewInputError } from "../errors/interview.errors.js";
import { PlannedTopic, type PlannedTopicProps } from "./planned-topic.js";

export const DEFAULT_TARGET_DURATION_MIN = 15;
export const DEFAULT_MAX_DURATION_MIN = 25;

export interface InterviewPlanProps {
  readonly topics: ReadonlyArray<PlannedTopic>;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly mustAskQuestions: ReadonlyArray<string>;
}

export interface InterviewPlanSerialized {
  readonly topics: ReadonlyArray<PlannedTopicProps>;
  readonly targetDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly mustAskQuestions: ReadonlyArray<string>;
}

export class InterviewPlan {
  private constructor(
    readonly topics: ReadonlyArray<PlannedTopic>,
    readonly targetDurationMinutes: number,
    readonly maxDurationMinutes: number,
    readonly mustAskQuestions: ReadonlyArray<string>,
  ) {}

  static create(props: InterviewPlanProps): Result<InterviewPlan, InvalidInterviewInputError> {
    if (props.topics.length === 0) {
      return Result.Err(new InvalidInterviewInputError("InterviewPlan.topics must not be empty"));
    }
    if (props.targetDurationMinutes <= 0) {
      return Result.Err(new InvalidInterviewInputError("InterviewPlan.targetDurationMinutes must be > 0"));
    }
    if (props.maxDurationMinutes < props.targetDurationMinutes) {
      return Result.Err(
        new InvalidInterviewInputError("InterviewPlan.maxDurationMinutes must be >= targetDurationMinutes"),
      );
    }
    return Result.Ok(
      new InterviewPlan(
        Object.freeze([...props.topics]),
        props.targetDurationMinutes,
        props.maxDurationMinutes,
        Object.freeze([...props.mustAskQuestions]),
      ),
    );
  }

  serialize(): InterviewPlanSerialized {
    return {
      topics: this.topics.map((t) => t.serialize()),
      targetDurationMinutes: this.targetDurationMinutes,
      maxDurationMinutes: this.maxDurationMinutes,
      mustAskQuestions: this.mustAskQuestions,
    };
  }

  static fromSerialized(data: InterviewPlanSerialized): InterviewPlan {
    return new InterviewPlan(
      Object.freeze(data.topics.map((t) => PlannedTopic.fromSerialized(t))),
      data.targetDurationMinutes,
      data.maxDurationMinutes,
      Object.freeze([...data.mustAskQuestions]),
    );
  }
}
