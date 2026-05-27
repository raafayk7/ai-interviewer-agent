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
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  ConversationalTranscriptFetchFailedError,
  type IConversationalAgentService,
} from "../../ports/conversational-agent/index.js";
import { PersistCompletedTranscriptUseCase } from "./persist-completed-transcript.use-case.js";

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

const makeCompletedInterview = (): Interview => {
  const result = makeInProgressInterview().complete(now, []);
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

const makeAgent = (
  overrides: Partial<IConversationalAgentService> = {},
): IConversationalAgentService => ({
  issueSignedUrl: vi.fn().mockResolvedValue(Result.Ok({ signedUrl: "https://signed.example" })),
  getTranscript: vi.fn().mockResolvedValue(
    Result.Ok([
      { speaker: SPEAKER.AGENT, text: "Tell me about yourself.", timestamp: now },
      { speaker: SPEAKER.CANDIDATE, text: "   ", timestamp: now },
      { speaker: SPEAKER.CANDIDATE, text: "I build APIs.", timestamp: now },
    ]),
  ),
  ...overrides,
});

describe("[Integration] PersistCompletedTranscriptUseCase", () => {
  describe("execute() — happy path", () => {
    it("returns Ok({ applied: true, entryCount: 2 }) filtering the empty row", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: true, entryCount: 2 });
    });

    it("calls agent.getTranscript with the elevenLabsSessionId", async () => {
      const agent = makeAgent();
      const useCase = new PersistCompletedTranscriptUseCase(makeRepo(makeInProgressInterview()), agent);

      await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(agent.getTranscript).toHaveBeenCalledWith("conv-001");
    });

    it("saves the interview with COMPLETED status", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.COMPLETED);
    });

    it("saves transcript with only non-empty rows (empty row filtered out)", async () => {
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.transcript).toHaveLength(2);
    });
  });

  describe("execute() — all-rows-empty edge case", () => {
    it("completes with empty transcript when all rows are whitespace-only", async () => {
      const agent = makeAgent({
        getTranscript: vi.fn().mockResolvedValue(
          Result.Ok([
            { speaker: SPEAKER.AGENT, text: "   ", timestamp: now },
            { speaker: SPEAKER.CANDIDATE, text: "  ", timestamp: now },
          ]),
        ),
      });
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, agent);

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().entryCount).toBe(0);
    });
  });

  describe("execute() — idempotent no-op when already COMPLETED", () => {
    it("returns Ok({ applied: false, entryCount: 0 }) when interview is COMPLETED", async () => {
      const agent = makeAgent();
      const repo = makeRepo(makeCompletedInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, agent);

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ applied: false, entryCount: 0 });
    });

    it("does not call agent.getTranscript when interview is already COMPLETED", async () => {
      const agent = makeAgent();
      const repo = makeRepo(makeCompletedInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, agent);

      await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(agent.getTranscript).not.toHaveBeenCalled();
    });

    it("does not call repo.save when interview is already COMPLETED", async () => {
      const repo = makeRepo(makeCompletedInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — error paths", () => {
    it("propagates getTranscript failure as ConversationalTranscriptFetchFailedError", async () => {
      const error = new ConversationalTranscriptFetchFailedError("SDK error", "conv-001");
      const agent = makeAgent({
        getTranscript: vi.fn().mockResolvedValue(Result.Err(error)),
      });
      const repo = makeRepo(makeInProgressInterview());
      const useCase = new PersistCompletedTranscriptUseCase(repo, agent);

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBe(error);
    });

    it("returns Err(ServiceUnknownError) when repo.save fails", async () => {
      const repo = makeRepo(makeInProgressInterview(), {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
      });
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(InterviewNotFoundError) when interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      const result = await useCase.execute({
        interviewId: "missing-id",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("db error"))),
      });
      const useCase = new PersistCompletedTranscriptUseCase(repo, makeAgent());

      const result = await useCase.execute({
        interviewId: "interview-001",
        elevenLabsSessionId: "conv-001",
        occurredAt: now,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
