import { randomUUID } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { BaseEntity } from "../../shared/base.entity.js";
import type { InterviewId, ReportId } from "../interview/interview.entity.js";
import { InvalidReportInputError } from "./errors/report.errors.js";
import { TopicScore, type TopicScoreProps } from "./value-objects/topic-score.js";

export const RECOMMENDATION = {
  ADVANCE: "advance",
  HOLD: "hold",
  REJECT: "reject",
} as const;

export type Recommendation = (typeof RECOMMENDATION)[keyof typeof RECOMMENDATION];

export interface ReportCreateProps {
  readonly interviewId: InterviewId;
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScore>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
}

export interface ReportSerialized {
  readonly id: ReportId;
  readonly interviewId: InterviewId;
  readonly overallRecommendation: Recommendation;
  readonly topicScores: ReadonlyArray<TopicScoreProps>;
  readonly communicationAssessment: string;
  readonly strengths: ReadonlyArray<string>;
  readonly concerns: ReadonlyArray<string>;
  readonly followUpQuestions: ReadonlyArray<string>;
  readonly generatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Report extends BaseEntity {
  override readonly id: ReportId;
  override readonly createdAt: Date;
  override readonly updatedAt: Date;

  private constructor(
    id: ReportId,
    readonly interviewId: InterviewId,
    readonly overallRecommendation: Recommendation,
    readonly topicScores: ReadonlyArray<TopicScore>,
    readonly communicationAssessment: string,
    readonly strengths: ReadonlyArray<string>,
    readonly concerns: ReadonlyArray<string>,
    readonly followUpQuestions: ReadonlyArray<string>,
    readonly generatedAt: Date,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super();
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create(props: ReportCreateProps): Result<Report, InvalidReportInputError> {
    if (!props.communicationAssessment.trim()) {
      return Result.Err(new InvalidReportInputError("Report.communicationAssessment must not be empty"));
    }
    if (props.topicScores.length === 0) {
      return Result.Err(new InvalidReportInputError("Report.topicScores must not be empty"));
    }
    const now = new Date();
    return Result.Ok(
      new Report(
        randomUUID(),
        props.interviewId,
        props.overallRecommendation,
        Object.freeze([...props.topicScores]),
        props.communicationAssessment,
        Object.freeze([...props.strengths]),
        Object.freeze([...props.concerns]),
        Object.freeze([...props.followUpQuestions]),
        now,
        now,
        now,
      ),
    );
  }

  serialize(): ReportSerialized {
    return {
      id: this.id,
      interviewId: this.interviewId,
      overallRecommendation: this.overallRecommendation,
      topicScores: this.topicScores.map((t) => t.serialize()),
      communicationAssessment: this.communicationAssessment,
      strengths: this.strengths,
      concerns: this.concerns,
      followUpQuestions: this.followUpQuestions,
      generatedAt: this.generatedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromSerialized(data: ReportSerialized): Report {
    return new Report(
      data.id,
      data.interviewId,
      data.overallRecommendation,
      Object.freeze(data.topicScores.map((t) => TopicScore.fromSerialized(t))),
      data.communicationAssessment,
      Object.freeze([...data.strengths]),
      Object.freeze([...data.concerns]),
      Object.freeze([...data.followUpQuestions]),
      data.generatedAt,
      data.createdAt,
      data.updatedAt,
    );
  }
}
