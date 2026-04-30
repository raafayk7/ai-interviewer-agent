import { randomUUID } from "node:crypto";
import { Option, Result } from "@carbonteq/fp";
import { BaseEntity } from "../../shared/base.entity.js";
import { FileRef, type FileRefProps } from "../../shared/value-objects/index.js";
import {
  InvalidInterviewStateTransitionError,
  InterviewPlanRequiredError,
} from "./errors/interview.errors.js";
import {
  INTERVIEW_STATUS,
  type InterviewStatus,
  InterviewStatusPolicy,
} from "./interview-status.js";
import {
  CandidateInfo,
  type CandidateInfoProps,
  InterviewPlan,
  type InterviewPlanSerialized,
  JobDescription,
  type JobDescriptionProps,
  TranscriptEntry,
  type TranscriptEntryProps,
} from "./value-objects/index.js";

export type InterviewId = string;
export type RecruiterId = string;
export type ReportId = string;

export interface InterviewCreateProps {
  readonly recruiterId: RecruiterId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly scheduledAt: Date;
  readonly jdFileRef: FileRef;
  readonly cvFileRef: FileRef;
}

export interface InterviewSerialized {
  readonly id: InterviewId;
  readonly recruiterId: RecruiterId;
  readonly status: InterviewStatus;
  readonly jobDescription: JobDescriptionProps;
  readonly candidateInfo: CandidateInfoProps;
  readonly clientInstructions: string;
  readonly interviewPlan: InterviewPlanSerialized | null;
  readonly transcript: ReadonlyArray<TranscriptEntryProps>;
  readonly jdFileRef: FileRefProps;
  readonly cvFileRef: FileRefProps;
  readonly scheduledAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly reportId: ReportId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Interview extends BaseEntity {
  override readonly id: InterviewId;
  override readonly createdAt: Date;
  override readonly updatedAt: Date;

  private constructor(
    id: InterviewId,
    readonly recruiterId: RecruiterId,
    readonly status: InterviewStatus,
    readonly jobDescription: JobDescription,
    readonly candidateInfo: CandidateInfo,
    readonly clientInstructions: string,
    readonly interviewPlan: Option<InterviewPlan>,
    readonly transcript: ReadonlyArray<TranscriptEntry>,
    readonly jdFileRef: FileRef,
    readonly cvFileRef: FileRef,
    readonly scheduledAt: Date,
    readonly startedAt: Option<Date>,
    readonly completedAt: Option<Date>,
    readonly reportId: Option<ReportId>,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super();
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /** Factory for a brand-new interview (always lands in CREATED). */
  static create(props: InterviewCreateProps): Interview {
    const now = new Date();
    return new Interview(
      randomUUID(),
      props.recruiterId,
      INTERVIEW_STATUS.CREATED,
      props.jobDescription,
      props.candidateInfo,
      props.clientInstructions,
      Option.None,
      Object.freeze([]),
      props.jdFileRef,
      props.cvFileRef,
      props.scheduledAt,
      Option.None,
      Option.None,
      Option.None,
      now,
      now,
    );
  }

  // ─── State transitions ─────────────────────────────────────────────

  /** CREATED → SCHEDULED — requires an InterviewPlan. */
  schedule(plan: InterviewPlan): Result<Interview, InvalidInterviewStateTransitionError | InterviewPlanRequiredError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.SCHEDULED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.SCHEDULED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.SCHEDULED, interviewPlan: Option.Some(plan) }));
  }

  /** SCHEDULED → IN_PROGRESS. */
  start(at: Date): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.IN_PROGRESS)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.IN_PROGRESS));
    }
    return Result.Ok(
      this.withChanges({ status: INTERVIEW_STATUS.IN_PROGRESS, startedAt: Option.Some(at) }),
    );
  }

  /** IN_PROGRESS → COMPLETED — captures final transcript. */
  complete(at: Date, transcript: ReadonlyArray<TranscriptEntry>): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.COMPLETED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.COMPLETED));
    }
    return Result.Ok(
      this.withChanges({
        status: INTERVIEW_STATUS.COMPLETED,
        completedAt: Option.Some(at),
        transcript: Object.freeze([...transcript]),
      }),
    );
  }

  /** COMPLETED → EVALUATED — links report. */
  markEvaluated(reportId: ReportId): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.EVALUATED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.EVALUATED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.EVALUATED, reportId: Option.Some(reportId) }));
  }

  /** IN_PROGRESS → CANCELLED. */
  cancel(): Result<Interview, InvalidInterviewStateTransitionError> {
    if (!InterviewStatusPolicy.canTransition(this.status, INTERVIEW_STATUS.CANCELLED)) {
      return Result.Err(new InvalidInterviewStateTransitionError(this.status, INTERVIEW_STATUS.CANCELLED));
    }
    return Result.Ok(this.withChanges({ status: INTERVIEW_STATUS.CANCELLED }));
  }

  // ─── Persistence ──────────────────────────────────────────────────

  serialize(): InterviewSerialized {
    return {
      id: this.id,
      recruiterId: this.recruiterId,
      status: this.status,
      jobDescription: this.jobDescription.serialize(),
      candidateInfo: this.candidateInfo.serialize(),
      clientInstructions: this.clientInstructions,
      interviewPlan: this.interviewPlan.match({
        Some: (p) => p.serialize(),
        None: () => null,
      }),
      transcript: this.transcript.map((t) => t.serialize()),
      jdFileRef: this.jdFileRef.serialize(),
      cvFileRef: this.cvFileRef.serialize(),
      scheduledAt: this.scheduledAt,
      startedAt: this.startedAt.match({ Some: (d) => d, None: () => null }),
      completedAt: this.completedAt.match({ Some: (d) => d, None: () => null }),
      reportId: this.reportId.match({ Some: (id) => id, None: () => null }),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromSerialized(data: InterviewSerialized): Interview {
    return new Interview(
      data.id,
      data.recruiterId,
      data.status,
      JobDescription.fromSerialized(data.jobDescription),
      CandidateInfo.fromSerialized(data.candidateInfo),
      data.clientInstructions,
      data.interviewPlan === null ? Option.None : Option.Some(InterviewPlan.fromSerialized(data.interviewPlan)),
      Object.freeze(data.transcript.map((t) => TranscriptEntry.fromSerialized(t))),
      FileRef.fromSerialized(data.jdFileRef),
      FileRef.fromSerialized(data.cvFileRef),
      data.scheduledAt,
      data.startedAt === null ? Option.None : Option.Some(data.startedAt),
      data.completedAt === null ? Option.None : Option.Some(data.completedAt),
      data.reportId === null ? Option.None : Option.Some(data.reportId),
      data.createdAt,
      data.updatedAt,
    );
  }

  // ─── Internal cloning helper ──────────────────────────────────────

  private withChanges(patch: Partial<{
    status: InterviewStatus;
    interviewPlan: Option<InterviewPlan>;
    transcript: ReadonlyArray<TranscriptEntry>;
    startedAt: Option<Date>;
    completedAt: Option<Date>;
    reportId: Option<ReportId>;
  }>): Interview {
    return new Interview(
      this.id,
      this.recruiterId,
      patch.status ?? this.status,
      this.jobDescription,
      this.candidateInfo,
      this.clientInstructions,
      patch.interviewPlan ?? this.interviewPlan,
      patch.transcript ?? this.transcript,
      this.jdFileRef,
      this.cvFileRef,
      this.scheduledAt,
      patch.startedAt ?? this.startedAt,
      patch.completedAt ?? this.completedAt,
      patch.reportId ?? this.reportId,
      this.createdAt,
      new Date(),
    );
  }
}
