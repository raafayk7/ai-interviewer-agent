import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InterviewPlan,
  JobDescription,
  PlannedTopic,
  SPEAKER,
  TOPIC_PRIORITY,
  TranscriptEntry,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import type { IInterviewReportInvalidationService } from "../../ports/interview-report-invalidation/index.js";
import {
  PersistCompletedTranscriptUseCase,
  type PostCallTranscriptEntry,
} from "./persist-completed-transcript.use-case.js";

const now = new Date("2026-05-25T10:00:00Z");

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const result = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 6,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeFileRef = (key: string): FileRef => {
  const result = FileRef.create({
    key,
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: key.endsWith("jd.pdf") ? "jd.pdf" : "cv.pdf",
    uploadedAt: now,
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makePlan = (): InterviewPlan => {
  const topic = PlannedTopic.create({
    name: "Backend Architecture",
    questions: ["How would you design a queue worker?"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  expect(topic.isOk()).toBe(true);
  const plan = InterviewPlan.create({
    topics: [topic.unwrap()],
    targetDurationMinutes: 15,
    maxDurationMinutes: 25,
    mustAskQuestions: ["Describe a production incident."],
  });
  expect(plan.isOk()).toBe(true);
  return plan.unwrap();
};

const makeCreatedInterview = (): Interview =>
  Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on system design.",
    scheduledAt: now,
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });

const makeScheduledInterview = (): Interview => {
  const result = makeCreatedInterview().schedule(makePlan());
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeInProgressInterview = (): Interview => {
  const result = makeScheduledInterview().start(now);
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeDomainTranscript = (count: number): ReadonlyArray<TranscriptEntry> =>
  Array.from({ length: count }, (_, index) => {
    const result = TranscriptEntry.create({
      speaker: index % 2 === 0 ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
      text: `Stored transcript entry ${index + 1}`,
      timestamp: new Date(now.getTime() + index * 1000),
    });
    expect(result.isOk()).toBe(true);
    return result.unwrap();
  });

const makeCompletedInterview = (
  transcript: ReadonlyArray<TranscriptEntry> = [],
): Interview => {
  const result = makeInProgressInterview().complete(now, transcript);
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeEvaluatedInterview = (
  transcript: ReadonlyArray<TranscriptEntry> = [],
): Interview => {
  const evaluated = makeCompletedInterview(transcript).markEvaluated("report-001");
  expect(evaluated.isOk()).toBe(true);
  return evaluated.unwrap();
};

const makeRepo = (
  interview: Interview | null,
  overrides: Partial<IInterviewRepository> = {},
): IInterviewRepository => ({
  save: vi.fn().mockImplementation(async (next: Interview) => Result.Ok(next)),
  findById: vi.fn().mockResolvedValue(
    Result.Ok(interview === null ? Option.None : Option.Some(interview)),
  ),
  findByElevenLabsSessionId: vi.fn().mockResolvedValue(
    Result.Ok(interview === null ? Option.None : Option.Some(interview)),
  ),
  findStuckInProgress: vi.fn().mockResolvedValue(Result.Ok([])),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

const makeReportInvalidation = (
  overrides: Partial<IInterviewReportInvalidationService> = {},
): IInterviewReportInvalidationService => ({
  invalidateStaleReport: vi.fn().mockResolvedValue(Result.Ok(undefined)),
  ...overrides,
});

const makeTranscript = (): ReadonlyArray<PostCallTranscriptEntry> => [
  { role: "agent", message: "Tell me about yourself.", timeInCallSecs: 0, toolResults: null },
  { role: "user", message: "   ", timeInCallSecs: 5, toolResults: null },
  { role: "user", message: "I build APIs.", timeInCallSecs: 10, toolResults: null },
];

const makeShortTranscript = (): ReadonlyArray<PostCallTranscriptEntry> => [
  { role: "agent", message: "One useful turn.", timeInCallSecs: 0, toolResults: null },
];

const makeTranscriptWithEndCall = (
  reason = "all_topics_covered",
  message = "Interview complete.",
): ReadonlyArray<PostCallTranscriptEntry> => [
  ...makeTranscript(),
  {
    role: "agent",
    message: null,
    timeInCallSecs: 60,
    toolResults: [{ resultType: "end_call_success", resultValue: { reason, message } }],
  },
];

const baseInput = {
  interviewId: "interview-001",
  elevenLabsSessionId: "conv-001",
  occurredAt: now,
};

describe("[Integration] PersistCompletedTranscriptUseCase", () => {
  describe("execute() — happy path without end_call_success", () => {
    it("returns Ok({ applied: true, entryCount: 2 }) filtering the empty row", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true, entryCount: 2 });
    });

    it("saves the interview with COMPLETED status", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.COMPLETED);
    });

    it("filters whitespace-only message rows from transcript", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.transcript).toHaveLength(2);
    });
  });

  describe("execute() — with end_call_success in transcript", () => {
    it("appends an AgentNote with the end_call reason before completing", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({
        ...baseInput,
        transcript: makeTranscriptWithEndCall("all_topics_covered", "Interview complete."),
      });

      expect(result.isOk()).toBe(true);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.COMPLETED);
      const notes = saved?.serialize().notes ?? [];
      const endCallNote = notes.find((n: { note: string }) =>
        n.note.startsWith("[end_call]"),
      );
      expect(endCallNote).toBeDefined();
      expect(endCallNote?.note).toContain("all_topics_covered");
    });

    it("includes end_call message in the note when present", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({
        ...baseInput,
        transcript: makeTranscriptWithEndCall("candidate_not_a_fit", "Not enough experience."),
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      const notes = saved?.serialize().notes ?? [];
      const endCallNote = notes.find((n: { note: string }) =>
        n.note.startsWith("[end_call]"),
      );
      expect(endCallNote?.note).toContain("Not enough experience.");
    });

    it("walks from the last turn when multiple turns have tool_results", async () => {
      const transcript: ReadonlyArray<PostCallTranscriptEntry> = [
        { role: "agent", message: "Hello.", timeInCallSecs: 0, toolResults: [{ resultType: "some_other_tool" }] },
        { role: "agent", message: null, timeInCallSecs: 60, toolResults: [{ resultType: "end_call_success", resultValue: { reason: "time_up" } }] },
      ];
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({ ...baseInput, transcript });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      const notes = saved?.serialize().notes ?? [];
      expect(notes.some((n: { note: string }) => n.note.includes("time_up"))).toBe(true);
    });

    it("applies default reason when resultValue is missing", async () => {
      const transcript: ReadonlyArray<PostCallTranscriptEntry> = [
        { role: "agent", message: "Goodbye.", timeInCallSecs: 30, toolResults: [{ resultType: "end_call_success" }] },
      ];
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({ ...baseInput, transcript });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      const notes = saved?.serialize().notes ?? [];
      expect(notes.some((n: { note: string }) => n.note.includes("agent_requested_end_call"))).toBe(true);
    });
  });

  describe("execute() — all-rows-empty edge case", () => {
    it("completes with empty transcript when all rows are whitespace-only", async () => {
      const transcript: ReadonlyArray<PostCallTranscriptEntry> = [
        { role: "agent", message: "   ", timeInCallSecs: 0, toolResults: null },
        { role: "user", message: "  ", timeInCallSecs: 5, toolResults: null },
      ];
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().entryCount).toBe(0);
    });

    it("completes with empty transcript when transcript is empty", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: [] });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().entryCount).toBe(0);
    });
  });

  describe("execute() — best-transcript-wins for already completed interviews", () => {
    it("recompletes and saves when a COMPLETED interview receives a strictly better transcript", async () => {
      const repo = makeRepo(makeCompletedInterview(makeDomainTranscript(1)));
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true, entryCount: 2 });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(saved?.transcript).toHaveLength(2);
    });

    it("does not save when a COMPLETED interview receives an equal transcript", async () => {
      const repo = makeRepo(makeCompletedInterview(makeDomainTranscript(2)));
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(repo.save).not.toHaveBeenCalled();
    });

    it("does not save when a COMPLETED interview receives a shorter transcript", async () => {
      const repo = makeRepo(makeCompletedInterview(makeDomainTranscript(2)));
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: makeShortTranscript() });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: false, entryCount: 0 });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("reverts EVALUATED to COMPLETED and invalidates the stale report atomically via the port", async () => {
      const repo = makeRepo(makeEvaluatedInterview(makeDomainTranscript(1)));
      const reportInvalidation = makeReportInvalidation();
      const useCase = new PersistCompletedTranscriptUseCase(repo, reportInvalidation);

      const result = await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true, entryCount: 2 });
      expect(repo.save).not.toHaveBeenCalled();
      expect(reportInvalidation.invalidateStaleReport).toHaveBeenCalledTimes(1);
      const invalidatedInterview = vi.mocked(
        reportInvalidation.invalidateStaleReport,
      ).mock.calls[0]?.[0];
      expect(invalidatedInterview?.status).toBe(INTERVIEW_STATUS.COMPLETED);
      expect(invalidatedInterview?.reportId.isNone()).toBe(true);
      expect(invalidatedInterview?.transcript).toHaveLength(2);
    });

    it("returns ServiceUnknownError when stale report invalidation fails", async () => {
      const repo = makeRepo(makeEvaluatedInterview(makeDomainTranscript(1)));
      const reportInvalidation = makeReportInvalidation({
        invalidateStaleReport: vi.fn().mockResolvedValue(Result.Err(new Error("tx failed"))),
      });
      const useCase = new PersistCompletedTranscriptUseCase(repo, reportInvalidation);

      const result = await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — error paths", () => {
    it("returns Err(ServiceUnknownError) when repo.save fails", async () => {
      const repo = makeRepo(makeInProgressInterview(), {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
      });
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: makeTranscript() });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(InterviewNotFoundError) when interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, interviewId: "missing-id", transcript: [] });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("db error"))),
      });
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeReportInvalidation());

      const result = await useCase.execute({ ...baseInput, transcript: [] });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
