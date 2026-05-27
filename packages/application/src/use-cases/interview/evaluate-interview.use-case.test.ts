import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewPlan,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  JobDescription,
  PlannedTopic,
  RECOMMENDATION,
  Report,
  SPEAKER,
  TOPIC_PRIORITY,
  TopicScore,
  TranscriptEntry,
  type IInterviewRepository,
  type IReportRepository,
  type ReportCreateProps,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  EvaluatorOutputInvalidError,
  EvaluatorUnavailableError,
} from "../../ports/interview-evaluator/interview-evaluator-error.js";
import type { IInterviewEvaluatorService } from "../../ports/interview-evaluator/interview-evaluator.port.js";
import { EVALUATION_RUBRIC } from "./evaluation-rubric.js";
import { EvaluateInterviewUseCase } from "./evaluate-interview.use-case.js";

const unwrapOk = <T>(result: Result<T, Error>): T => {
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeJobDescription = (): JobDescription =>
  unwrapOk(
    JobDescription.create({
      title: "Senior Backend Engineer",
      company: "Acme Corp",
      responsibilities: ["Build APIs"],
      requirements: ["TypeScript"],
      rawText: "We need a backend engineer.",
    }),
  );

const makeCandidateInfo = (): CandidateInfo =>
  unwrapOk(
    CandidateInfo.create({
      fullName: "Jane Doe",
      email: "jane.doe@example.com",
      headline: "Senior Engineer",
      yearsOfExperience: 5,
      skills: ["TypeScript"],
      education: ["B.Sc. CS"],
      rawText: "Jane is an experienced engineer.",
    }),
  );

const makeFileRef = (key: string): FileRef =>
  unwrapOk(
    FileRef.create({
      key,
      contentType: "application/pdf",
      sizeBytes: 1024,
      originalFilename: key.endsWith("jd.pdf") ? "jd.pdf" : "cv.pdf",
      uploadedAt: new Date("2025-01-01T00:00:00Z"),
    }),
  );

const makeTranscript = (): ReadonlyArray<TranscriptEntry> => [
  unwrapOk(
    TranscriptEntry.create({
      speaker: SPEAKER.AGENT,
      text: "Tell me about a reliable API you built.",
      timestamp: new Date("2025-06-01T09:01:00Z"),
    }),
  ),
  unwrapOk(
    TranscriptEntry.create({
      speaker: SPEAKER.CANDIDATE,
      text: "I designed idempotent endpoints with retries and queue workers.",
      timestamp: new Date("2025-06-01T09:02:00Z"),
    }),
  ),
];

const makeInterviewPlan = (): InterviewPlan => {
  const topic = unwrapOk(
    PlannedTopic.create({
      name: "Backend Reliability",
      questions: ["How do you design retries?"],
      timeAllocationMinutes: 10,
      priority: TOPIC_PRIORITY.MUST_COVER,
    }),
  );

  return unwrapOk(
    InterviewPlan.create({
      topics: [topic],
      targetDurationMinutes: 15,
      maxDurationMinutes: 20,
      mustAskQuestions: [],
    }),
  );
};

const makeCompletedInterview = (): Interview => {
  const interview = Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on backend reliability.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });
  const scheduled = interview.schedule(makeInterviewPlan());
  const started = unwrapOk(scheduled).start(new Date("2025-06-01T09:00:30Z"));
  return unwrapOk(unwrapOk(started).complete(new Date("2025-06-01T09:15:00Z"), makeTranscript()));
};

const makeCreatedInterview = (): Interview =>
  Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on backend reliability.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });

const makeTopicScore = (): TopicScore =>
  unwrapOk(
    TopicScore.create({
      topicName: "Backend Reliability",
      score: 4,
      justification: "Gave concrete examples around retries and idempotency.",
    }),
  );

const makeReportProps = (interviewId: string): ReportCreateProps => ({
  interviewId,
  overallRecommendation: RECOMMENDATION.ADVANCE,
  topicScores: [makeTopicScore()],
  communicationAssessment: "Clear, structured, and grounded in production examples.",
  strengths: ["Strong reliability instincts"],
  concerns: ["Could go deeper on observability"],
  followUpQuestions: ["How would you tune retry backoff under load?"],
});

const makeReport = (interviewId: string): Report => unwrapOk(Report.create(makeReportProps(interviewId)));

const makeInterviewRepo = (
  overrides: Partial<IInterviewRepository> = {},
): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByElevenLabsSessionId: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

const makeReportRepo = (overrides: Partial<IReportRepository> = {}): IReportRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByInterviewId: vi.fn(),
  ...overrides,
});

const makeEvaluator = (
  evaluate = vi.fn(),
): IInterviewEvaluatorService => ({
  evaluate,
});

describe("EvaluateInterviewUseCase", () => {
  it("evaluates a completed interview, persists the report, marks the interview evaluated, and returns the serialized report", async () => {
    const interview = makeCompletedInterview();
    const saveInterview = vi.fn().mockImplementation(async (next: Interview) => Result.Ok(next));
    const saveReport = vi.fn().mockImplementation(async (report: Report) => Result.Ok(report));
    const evaluate = vi.fn().mockResolvedValue(Result.Ok(makeReportProps(interview.id)));
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      save: saveInterview,
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
      save: saveReport,
    });

    const result = await new EvaluateInterviewUseCase({
      interviews,
      reports,
      evaluator: makeEvaluator(evaluate),
    }).execute({ interviewId: interview.id });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().report.interviewId).toBe(interview.id);
    expect(evaluate).toHaveBeenCalledWith({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      transcript: interview.transcript,
      notes: interview.notes,
      internalScores: interview.internalScores,
      rubric: EVALUATION_RUBRIC,
    });
    expect(saveReport).toHaveBeenCalledTimes(1);
    expect(saveInterview).toHaveBeenCalledTimes(1);
    const savedInterview = saveInterview.mock.calls[0]![0] as Interview;
    expect(savedInterview.status).toBe(INTERVIEW_STATUS.EVALUATED);
    expect(savedInterview.reportId.unwrap()).toBe(result.unwrap().report.id);
  });

  it("returns ServiceUnknownError when interview lookup fails", async () => {
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });
    const reports = makeReportRepo();
    const evaluator = makeEvaluator(vi.fn());

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: "interview-001",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("InterviewRepository.findById");
    expect(reports.findByInterviewId).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("returns InterviewNotFoundError when the interview is missing", async () => {
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });
    const reports = makeReportRepo();
    const evaluator = makeEvaluator(vi.fn());

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: "missing-interview",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    expect(reports.findByInterviewId).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("returns InvalidInterviewStateTransitionError when the interview is not completed", async () => {
    const interview = makeCreatedInterview();
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo();
    const evaluator = makeEvaluator(vi.fn());

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    expect(reports.findByInterviewId).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("returns an existing report without calling the evaluator", async () => {
    const interview = makeCompletedInterview();
    const existing = makeReport(interview.id);
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.Some(existing))),
    });
    const evaluator = makeEvaluator(vi.fn());

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().report).toEqual(existing.serialize());
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(reports.save).not.toHaveBeenCalled();
    expect(interviews.save).not.toHaveBeenCalled();
  });

  it("returns ServiceUnknownError when existing report lookup fails", async () => {
    const interview = makeCompletedInterview();
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Err(new Error("read failed"))),
    });
    const evaluator = makeEvaluator(vi.fn());

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "ReportRepository.findByInterviewId",
    );
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it("propagates evaluator errors unchanged", async () => {
    const interview = makeCompletedInterview();
    const evaluatorError = new EvaluatorUnavailableError("Gemini unavailable");
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });
    const evaluator = makeEvaluator(vi.fn().mockResolvedValue(Result.Err(evaluatorError)));

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(evaluatorError);
    expect(reports.save).not.toHaveBeenCalled();
    expect(interviews.save).not.toHaveBeenCalled();
  });

  it("maps invalid evaluator report props to EvaluatorOutputInvalidError", async () => {
    const interview = makeCompletedInterview();
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });
    const evaluator = makeEvaluator(
      vi.fn().mockResolvedValue(
        Result.Ok({
          ...makeReportProps(interview.id),
          communicationAssessment: "   ",
        }),
      ),
    );

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(EvaluatorOutputInvalidError);
    expect(reports.save).not.toHaveBeenCalled();
    expect(interviews.save).not.toHaveBeenCalled();
  });

  it("returns ServiceUnknownError when saving the report fails", async () => {
    const interview = makeCompletedInterview();
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
      save: vi.fn().mockResolvedValue(Result.Err(new Error("write failed"))),
    });
    const evaluator = makeEvaluator(vi.fn().mockResolvedValue(Result.Ok(makeReportProps(interview.id))));

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("ReportRepository.save");
    expect(interviews.save).not.toHaveBeenCalled();
  });

  it("returns ServiceUnknownError when saving the evaluated interview fails", async () => {
    const interview = makeCompletedInterview();
    const interviews = makeInterviewRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      save: vi.fn().mockResolvedValue(Result.Err(new Error("write failed"))),
    });
    const reports = makeReportRepo({
      findByInterviewId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
      save: vi.fn().mockImplementation(async (report: Report) => Result.Ok(report)),
    });
    const evaluator = makeEvaluator(vi.fn().mockResolvedValue(Result.Ok(makeReportProps(interview.id))));

    const result = await new EvaluateInterviewUseCase({ interviews, reports, evaluator }).execute({
      interviewId: interview.id,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("InterviewRepository.save");
  });
});
