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
  ConversationalSignedUrlFailedError,
  type IConversationalAgentService,
} from "../../ports/conversational-agent/index.js";
import type { IConversationCorrelationTokenIssuer } from "../../ports/conversation-correlation-token/index.js";
import { StartCandidateSessionUseCase } from "./start-candidate-session.use-case.js";

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
  issueSignedUrl: vi.fn().mockResolvedValue(Result.Ok({ signedUrl: "https://signed.example/session" })),
  getTranscript: vi.fn().mockResolvedValue(Result.Ok([])),
  ...overrides,
});

const makeTokens = (
  overrides: Partial<IConversationCorrelationTokenIssuer> = {},
): IConversationCorrelationTokenIssuer => ({
  issue: vi.fn().mockReturnValue("session-token"),
  verify: vi.fn().mockReturnValue(Result.Ok({ interviewId: "interview-001", issuedAtMs: now.getTime() })),
  ...overrides,
});

describe("[Integration] StartCandidateSessionUseCase", () => {
  describe("execute() — success path", () => {
    it("returns Ok with signedUrl and sessionToken", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const agent = makeAgent();
      const tokens = makeTokens();
      const useCase = new StartCandidateSessionUseCase(repo, agent, tokens);

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        signedUrl: "https://signed.example/session",
        sessionToken: "session-token",
      });
    });

    it("calls agent.issueSignedUrl with the provided agentId", async () => {
      const interview = makeScheduledInterview();
      const agent = makeAgent();
      const useCase = new StartCandidateSessionUseCase(makeRepo(interview), agent, makeTokens());

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(agent.issueSignedUrl).toHaveBeenCalledWith({ agentId: "agent-001" });
    });

    it("calls token issuer with the interview id", async () => {
      const interview = makeScheduledInterview();
      const tokens = makeTokens();
      const useCase = new StartCandidateSessionUseCase(makeRepo(interview), makeAgent(), tokens);

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(tokens.issue).toHaveBeenCalledWith(interview.id);
    });

    it("does not call repo.save (interview state is not mutated)", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(repo.save).not.toHaveBeenCalled();
    });

    it("does not call interview.start() — status stays SCHEDULED", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(interview.status).toBe(INTERVIEW_STATUS.SCHEDULED);
    });

    it("does not bind elevenLabsSessionId — it remains null after the use case", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(interview.serialize().elevenLabsSessionId).toBeNull();
    });
  });

  describe("execute() — error paths", () => {
    it("returns Err(InterviewNotFoundError) when the interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      const result = await useCase.execute({ interviewId: "missing-id", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(InvalidInterviewInputError) when interview status is not SCHEDULED", async () => {
      const inProgress = makeScheduledInterview().start(now);
      expect(inProgress.isOk()).toBe(true);
      const repo = makeRepo(inProgress.unwrap());
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(InvalidInterviewInputError) when interview has no plan", async () => {
      const created = makeCreatedInterview();
      const repo = makeRepo(created);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      const result = await useCase.execute({ interviewId: created.id, agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("propagates provider error when agent.issueSignedUrl fails", async () => {
      const error = new ConversationalSignedUrlFailedError("signed URL failed", "interview-001");
      const repo = makeRepo(makeScheduledInterview());
      const tokens = makeTokens();
      const useCase = new StartCandidateSessionUseCase(
        repo,
        makeAgent({ issueSignedUrl: vi.fn().mockResolvedValue(Result.Err(error)) }),
        tokens,
      );

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBe(error);
    });

    it("does not issue a token when provider fails", async () => {
      const tokens = makeTokens();
      const useCase = new StartCandidateSessionUseCase(
        makeRepo(makeScheduledInterview()),
        makeAgent({
          issueSignedUrl: vi.fn().mockResolvedValue(
            Result.Err(new ConversationalSignedUrlFailedError("fail", "id")),
          ),
        }),
        tokens,
      );

      await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
      });
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent(), makeTokens());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
