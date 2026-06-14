import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  Interview,
  InterviewNotFoundError,
  InterviewPlan,
  InvalidInterviewInputError,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { RecordAgentNoteUseCase } from "./record-agent-note.use-case.js";

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

describe("[Integration] RecordAgentNoteUseCase", () => {
  describe("execute() — happy path (IN_PROGRESS)", () => {
    it("returns Ok({ applied: true }) when note is appended to in-progress interview", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "Candidate communicated clearly.",
        recordedAtTurn: 2,
        recordedAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true });
    });

    it("saves the interview with the note appended", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        note: "Strong technical depth.",
        recordedAtTurn: 1,
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes).toHaveLength(1);
    });

    it("preserves note text in the saved aggregate", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        note: "Candidate gave detailed API design answer.",
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes[0]?.note).toBe("Candidate gave detailed API design answer.");
    });

    it("defaults recordedAtTurn to 0 when not provided", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        note: "Good answer.",
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes[0]?.recordedAtTurn).toBe(0);
    });
  });

  describe("execute() — idempotent no-op when not IN_PROGRESS", () => {
    it("returns Ok({ applied: false }) when interview is SCHEDULED", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "Late duplicate webhook.",
        recordedAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: false });
    });

    it("does not call repo.save when interview is not IN_PROGRESS", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        note: "Note on non-in-progress interview.",
        recordedAt: now,
      });

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — domain validation errors", () => {
    it("returns Err(InvalidInterviewInputError) when note is empty", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(InvalidInterviewInputError) when note is all whitespace", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "   ",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("does not call repo.findById when note validation fails early", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new RecordAgentNoteUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        note: "",
        recordedAt: now,
      });

      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe("execute() — repository error paths", () => {
    it("returns Err(InterviewNotFoundError) when interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "missing-id",
        note: "valid note",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("db error"))),
      });
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "valid note",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(ServiceUnknownError) when repo.save fails", async () => {
      const repo = makeRepo(makeInProgressInterview(), {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("write error"))),
      });
      const useCase = new RecordAgentNoteUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        note: "valid note",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
