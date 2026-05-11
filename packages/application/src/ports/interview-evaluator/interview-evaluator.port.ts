import type { Result } from "@carbonteq/fp";
import type {
  AgentInternalScore,
  AgentNote,
  CandidateInfo,
  InterviewId,
  JobDescription,
  ReportCreateProps,
  TranscriptEntry,
} from "@repo/domain";
import type { EvaluatorError } from "./interview-evaluator-error.js";

export interface InterviewEvaluatorInput {
  readonly interviewId: InterviewId;
  readonly jobDescription: JobDescription;
  readonly candidateInfo: CandidateInfo;
  readonly clientInstructions: string;
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  readonly notes: ReadonlyArray<AgentNote>;
  readonly internalScores: ReadonlyArray<AgentInternalScore>;
  readonly rubric: string;
}

export interface IInterviewEvaluatorService {
  evaluate(input: InterviewEvaluatorInput): Promise<Result<ReportCreateProps, EvaluatorError>>;
}
