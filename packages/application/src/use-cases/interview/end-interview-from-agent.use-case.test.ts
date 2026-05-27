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
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { EndInterviewFromAgentUseCase } from "./end-interview-from-agent.use-case.js";

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
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

describe("[Integration] EndInterviewFromAgentUseCase", () => {
  describe("execute() — happy path (IN_PROGRESS)", () => {
    it("returns Ok({ applied: true }) when end_call note is appended", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAtTurn: 4,
        recordedAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true });
    });

    it("records the end reason as a note containing [end_call] marker", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAtTurn: 4,
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes[0]?.note).toContain("[end_call]");
    });

    it("includes the reason in the note text", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAtTurn: 4,
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes[0]?.note).toBe("[end_call] reason=all_topics_covered");
    });

    it("does NOT complete the aggregate — status remains IN_PROGRESS", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAtTurn: 4,
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
    });

    it("defaults recordedAtTurn to 0 when not provided", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        reason: "candidate_dropped",
        recordedAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.notes[0]?.recordedAtTurn).toBe(0);
    });
  });

  describe("execute() — idempotent no-op when not IN_PROGRESS", () => {
    it("returns Ok({ applied: false }) when interview is SCHEDULED", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        reason: "agent_requested_end_call",
        recordedAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: false });
    });

    it("does not call repo.save when interview is not IN_PROGRESS", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new EndInterviewFromAgentUseCase(repo);

      await useCase.execute({
        interviewId: "interview-001",
        reason: "agent_requested_end_call",
        recordedAt: now,
      });

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — repository error paths", () => {
    it("returns Err(InterviewNotFoundError) when interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new EndInterviewFromAgentUseCase(repo);

      const result = await useCase.execute({
        interviewId: "missing-id",
        reason: "all_topics_covered",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("db error"))),
      });
      const useCase = new EndInterviewFromAgentUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(ServiceUnknownError) when repo.save fails", async () => {
      const repo = makeRepo(makeInProgressInterview(), {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("write error"))),
      });
      const useCase = new EndInterviewFromAgentUseCase(repo);

      const result = await useCase.execute({
        interviewId: "interview-001",
        reason: "all_topics_covered",
        recordedAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
