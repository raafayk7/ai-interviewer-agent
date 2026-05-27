import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InterviewPlan,
  InvalidInterviewInputError,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  InvalidConversationCorrelationTokenError,
  type IConversationCorrelationTokenIssuer,
} from "../../ports/conversation-correlation-token/index.js";
import { AssembleConversationInitiationContextUseCase } from "./assemble-conversation-initiation-context.use-case.js";

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

const makeTokens = (
  overrides: Partial<IConversationCorrelationTokenIssuer> = {},
): IConversationCorrelationTokenIssuer => ({
  issue: vi.fn().mockReturnValue("session-token"),
  verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001", issuedAtMs: now.getTime() })),
  ...overrides,
});

describe("[Integration] AssembleConversationInitiationContextUseCase", () => {
  describe("execute() — success path with conversationId present", () => {
    it("returns Ok with systemPrompt and dynamicVariables", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isOk()).toBe(true);
    });

    it("includes job title in the assembled systemPrompt", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().systemPrompt).toContain("Senior Backend Engineer");
    });

    it("includes candidate name in the assembled systemPrompt", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().systemPrompt).toContain("Jane Doe");
    });

    it("returns correct dynamicVariables with all required keys", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isOk()).toBe(true);
      const { dynamicVariables } = result.unwrap();
      expect(dynamicVariables.candidate_name).toBe("Jane Doe");
      expect(dynamicVariables.job_title).toBe("Senior Backend Engineer");
      expect(dynamicVariables.target_duration_minutes).toBe("15");
      expect(dynamicVariables.interview_id).toBe(interview.id);
    });

    it("binds elevenLabsSessionId and saves when conversationId is present", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.serialize().elevenLabsSessionId).toBe("conv-001");
    });
  });

  describe("execute() — success path WITHOUT conversationId", () => {
    it("returns Ok with override wire shape even without conversationId", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.None,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().systemPrompt).toBeTruthy();
    });

    it("does not call repo.save when conversationId is absent", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.None,
      });

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — idempotent re-bind", () => {
    it("is a no-op save when same elevenLabsSessionId is already bound", async () => {
      const scheduled = makeScheduledInterview();
      const bound = scheduled.bindElevenLabsSession("conv-001");
      expect(bound.isOk()).toBe(true);
      const repo = makeRepo(bound.unwrap());
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(repo.save).not.toHaveBeenCalled();
    });

    it("re-binds and saves when a different elevenLabsSessionId is provided", async () => {
      const scheduled = makeScheduledInterview();
      const bound = scheduled.bindElevenLabsSession("conv-old");
      expect(bound.isOk()).toBe(true);
      const repo = makeRepo(bound.unwrap());
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-new"),
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.serialize().elevenLabsSessionId).toBe("conv-new");
    });
  });

  describe("execute() — fail-closed error paths", () => {
    it("fails closed on invalid correlation token (no repo read)", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new AssembleConversationInitiationContextUseCase(
        repo,
        makeTokens({
          verify: vi.fn().mockReturnValue(
            Result.Err(new InvalidConversationCorrelationTokenError("bad token")),
          ),
        }),
      );

      const result = await useCase.execute({
        correlationToken: "bad-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("fails closed on expired correlation token", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new AssembleConversationInitiationContextUseCase(
        repo,
        makeTokens({
          verify: vi.fn().mockReturnValue(
            Result.Err(new InvalidConversationCorrelationTokenError("Token expired")),
          ),
        }),
      );

      const result = await useCase.execute({
        correlationToken: "expired-token",
        conversationId: Option.None,
      });

      expect(result.isErr()).toBe(true);
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("returns Err(InterviewNotFoundError) when interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(InvalidInterviewInputError) when status is COMPLETED", async () => {
      const inProgress = makeInProgressInterview();
      const completed = inProgress.complete(now, []);
      expect(completed.isOk()).toBe(true);
      const repo = makeRepo(completed.unwrap());
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(InvalidInterviewInputError) when interview has no plan", async () => {
      const created = makeCreatedInterview();
      const repo = makeRepo(created);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("db error"))),
      });
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(ServiceUnknownError) when repo.save fails on bind", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview, {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("db write error"))),
      });
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-001"),
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });

  describe("execute() — IN_PROGRESS is also allowed", () => {
    it("returns Ok when interview is IN_PROGRESS and conversationId is present", async () => {
      const interview = makeInProgressInterview();
      const repo = makeRepo(interview);
      const useCase = new AssembleConversationInitiationContextUseCase(repo, makeTokens());

      const result = await useCase.execute({
        correlationToken: "session-token",
        conversationId: Option.Some("conv-reinit"),
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().systemPrompt).toBeTruthy();
    });
  });
});
