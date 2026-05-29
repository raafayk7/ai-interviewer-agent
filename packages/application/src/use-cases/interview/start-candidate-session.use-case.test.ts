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
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  ConversationalSignedUrlFailedError,
  type IConversationalAgentService,
} from "../../ports/conversational-agent/index.js";
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

/** A SCHEDULED interview with a plan — the normal entry state for the use case. */
const makeScheduledInterview = (): Interview => {
  const result = makeCreatedInterview().schedule(makePlan());
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

/** An already IN_PROGRESS interview, bound to a prior session id (reconnect path). */
const makeInProgressInterview = (sessionId = "conv-prior-000"): Interview => {
  const started = makeScheduledInterview().start(now);
  expect(started.isOk()).toBe(true);
  const bound = started.unwrap().bindElevenLabsSession(sessionId);
  expect(bound.isOk()).toBe(true);
  return bound.unwrap();
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
  issueSignedUrl: vi.fn().mockResolvedValue(
    Result.Ok({ signedUrl: "https://signed.example/session", conversationId: "conv-abc-123" }),
  ),
  getTranscript: vi.fn().mockResolvedValue(Result.Ok([])),
  ...overrides,
});

describe("[Integration] StartCandidateSessionUseCase", () => {
  describe("execute() — success path (SCHEDULED → IN_PROGRESS)", () => {
    it("returns Ok with signedUrl, overrides, and dynamicVariables", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(result.isOk()).toBe(true);
      const output = result.unwrap();
      expect(output.signedUrl).toBe("https://signed.example/session");
      expect(output.overrides.agent.prompt.prompt).toBeTruthy();
      expect(output.dynamicVariables.candidate_name).toBe("Jane Doe");
      expect(output.dynamicVariables.job_title).toBe("Senior Backend Engineer");
      expect(output.dynamicVariables.target_duration_minutes).toBe("15");
      expect(output.dynamicVariables.interview_id).toBe(interview.id);
    });

    it("transitions the saved interview to IN_PROGRESS, sets startedAt, and binds the conversationId", async () => {
      const interview = makeScheduledInterview();
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(result.isOk()).toBe(true);
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved).toBeDefined();
      expect(saved?.status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
      expect(saved?.startedAt.isSome()).toBe(true);
      const serialized = saved?.serialize();
      expect(serialized?.elevenLabsSessionId).toBe("conv-abc-123");
      expect(serialized?.startedAt).not.toBeNull();
    });

    it("calls agent.issueSignedUrl with the provided agentId", async () => {
      const interview = makeScheduledInterview();
      const agent = makeAgent();
      const useCase = new StartCandidateSessionUseCase(makeRepo(interview), agent);

      await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(agent.issueSignedUrl).toHaveBeenCalledWith({ agentId: "agent-001" });
    });

    it("system prompt contains candidate name and job title", async () => {
      const interview = makeScheduledInterview();
      const useCase = new StartCandidateSessionUseCase(makeRepo(interview), makeAgent());

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      const prompt = result.unwrap().overrides.agent.prompt.prompt;
      expect(prompt).toContain("Jane Doe");
      expect(prompt).toContain("Senior Backend Engineer");
    });
  });

  describe("execute() — reconnect path (already IN_PROGRESS)", () => {
    it("returns the envelope without erroring and re-binds the new conversationId", async () => {
      const interview = makeInProgressInterview("conv-prior-000");
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(result.isOk()).toBe(true);
      const output = result.unwrap();
      expect(output.signedUrl).toBe("https://signed.example/session");
      expect(output.dynamicVariables.interview_id).toBe(interview.id);

      // Re-issued single-use signed URL binds the new conversationId; save once.
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
      expect(saved?.status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
      expect(saved?.serialize().elevenLabsSessionId).toBe("conv-abc-123");
    });

    it("does not re-save when the same conversationId is already bound (idempotent)", async () => {
      const interview = makeInProgressInterview("conv-abc-123");
      const repo = makeRepo(interview);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: interview.id, agentId: "agent-001" });

      expect(result.isOk()).toBe(true);
      // bindElevenLabsSession returns the same reference and start() is skipped — no change to persist.
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("execute() — error paths", () => {
    it("returns Err(InterviewNotFoundError) when the interview does not exist", async () => {
      const repo = makeRepo(null);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: "missing-id", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    });

    it("returns Err(InvalidInterviewInputError) when interview status is CREATED", async () => {
      const repo = makeRepo(makeCreatedInterview());
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(InvalidInterviewInputError) when interview status is COMPLETED", async () => {
      const completed = makeInProgressInterview().complete(now, []);
      expect(completed.isOk()).toBe(true);
      const repo = makeRepo(completed.unwrap());
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("returns Err(InvalidInterviewInputError) when interview has no plan", async () => {
      // A SCHEDULED interview always has a plan; construct an IN_PROGRESS-but-plan-less
      // interview via fromSerialized to exercise the plan-present guard directly.
      const serialized = makeScheduledInterview().serialize();
      const planless = Interview.fromSerialized({
        ...serialized,
        status: INTERVIEW_STATUS.IN_PROGRESS,
        interviewPlan: null,
        startedAt: now,
      });
      const repo = makeRepo(planless);
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: planless.id, agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewInputError);
    });

    it("propagates provider error when agent.issueSignedUrl fails", async () => {
      const error = new ConversationalSignedUrlFailedError("signed URL failed", "interview-001");
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new StartCandidateSessionUseCase(
        repo,
        makeAgent({ issueSignedUrl: vi.fn().mockResolvedValue(Result.Err(error)) }),
      );

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBe(error);
    });

    it("does not call repo.save when provider fails", async () => {
      const repo = makeRepo(makeScheduledInterview());
      const useCase = new StartCandidateSessionUseCase(
        repo,
        makeAgent({
          issueSignedUrl: vi.fn().mockResolvedValue(
            Result.Err(new ConversationalSignedUrlFailedError("fail", "id")),
          ),
        }),
      );

      await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(repo.save).not.toHaveBeenCalled();
    });

    it("returns Err(ServiceUnknownError) when repo.findById fails", async () => {
      const repo = makeRepo(null, {
        findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
      });
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });

    it("returns Err(ServiceUnknownError) when repo.save fails after bind/start", async () => {
      const repo = makeRepo(makeScheduledInterview(), {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("db write error"))),
      });
      const useCase = new StartCandidateSessionUseCase(repo, makeAgent());

      const result = await useCase.execute({ interviewId: "interview-001", agentId: "agent-001" });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    });
  });
});
