import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewPlan,
  JobDescription,
  PlannedTopic,
  SPEAKER,
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import {
  ConversationalTranscriptFetchFailedError,
  type IConversationalAgentService,
} from "../../ports/conversational-agent/index.js";
import { ReconcileStuckInterviewsUseCase } from "./reconcile-stuck-interviews.use-case.js";

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

const makeScheduledInterview = (): Interview => {
  const interview = Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on system design.",
    scheduledAt: now,
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });
  const scheduled = interview.schedule(makePlan());
  expect(scheduled.isOk()).toBe(true);
  return scheduled.unwrap();
};

const makeInProgressInterview = (sessionId?: string): Interview => {
  const started = makeScheduledInterview().start(now);
  expect(started.isOk()).toBe(true);
  if (sessionId === undefined) {
    return started.unwrap();
  }
  const bound = started.unwrap().bindElevenLabsSession(sessionId);
  expect(bound.isOk()).toBe(true);
  return bound.unwrap();
};

const makeRepo = (
  stuck: ReadonlyArray<Interview>,
  overrides: Partial<IInterviewRepository> = {},
): IInterviewRepository => ({
  save: vi.fn().mockImplementation(async (next: Interview) => Result.Ok(next)),
  findById: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
  findByElevenLabsSessionId: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
  findStuckInProgress: vi.fn().mockResolvedValue(Result.Ok(stuck)),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

const makeAgent = (
  overrides: Partial<IConversationalAgentService> = {},
): IConversationalAgentService => ({
  issueSignedUrl: vi.fn(),
  getTranscript: vi.fn().mockResolvedValue(
    Result.Ok([
      {
        speaker: SPEAKER.AGENT,
        text: "Tell me about yourself.",
        timestamp: new Date("2026-05-25T10:01:00Z"),
      },
      {
        speaker: SPEAKER.CANDIDATE,
        text: "I build reliable APIs.",
        timestamp: new Date("2026-05-25T10:02:00Z"),
      },
    ]),
  ),
  ...overrides,
});

describe("[Integration] ReconcileStuckInterviewsUseCase", () => {
  it("completes a stuck interview when ElevenLabs returns a non-empty transcript", async () => {
    const interview = makeInProgressInterview("conv-001");
    const repo = makeRepo([interview]);
    const useCase = new ReconcileStuckInterviewsUseCase(repo, makeAgent());

    const result = await useCase.execute({ thresholdMinutes: 90, now });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ scanned: 1, completed: [interview.id], failed: [] });
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
    expect(saved?.status).toBe(INTERVIEW_STATUS.COMPLETED);
    expect(saved?.transcript).toHaveLength(2);
  });

  it("fails a stuck interview with no bound session id", async () => {
    const interview = makeInProgressInterview();
    const repo = makeRepo([interview]);
    const agent = makeAgent();
    const useCase = new ReconcileStuckInterviewsUseCase(repo, agent);

    const result = await useCase.execute({ thresholdMinutes: 90, now });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ scanned: 1, completed: [], failed: [interview.id] });
    expect(agent.getTranscript).not.toHaveBeenCalled();
    const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
    expect(saved?.status).toBe(INTERVIEW_STATUS.FAILED);
  });

  it("fails a stuck interview when transcript retrieval fails", async () => {
    const interview = makeInProgressInterview("conv-001");
    const repo = makeRepo([interview]);
    const agent = makeAgent({
      getTranscript: vi.fn().mockResolvedValue(
        Result.Err(new ConversationalTranscriptFetchFailedError("not found", "conv-001")),
      ),
    });
    const useCase = new ReconcileStuckInterviewsUseCase(repo, agent);

    const result = await useCase.execute({ thresholdMinutes: 90, now });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ scanned: 1, completed: [], failed: [interview.id] });
    const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
    expect(saved?.status).toBe(INTERVIEW_STATUS.FAILED);
  });

  it("fails a stuck interview when the fetched transcript is empty", async () => {
    const interview = makeInProgressInterview("conv-001");
    const repo = makeRepo([interview]);
    const agent = makeAgent({
      getTranscript: vi.fn().mockResolvedValue(
        Result.Ok([
          {
            speaker: SPEAKER.AGENT,
            text: "   ",
            timestamp: new Date("2026-05-25T10:01:00Z"),
          },
        ]),
      ),
    });
    const useCase = new ReconcileStuckInterviewsUseCase(repo, agent);

    const result = await useCase.execute({ thresholdMinutes: 90, now });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ scanned: 1, completed: [], failed: [interview.id] });
    const saved = vi.mocked(repo.save).mock.calls[0]?.[0];
    expect(saved?.status).toBe(INTERVIEW_STATUS.FAILED);
  });

  it("returns an empty summary and computes cutoff from now minus threshold", async () => {
    const repo = makeRepo([]);
    const useCase = new ReconcileStuckInterviewsUseCase(repo, makeAgent());

    const result = await useCase.execute({ thresholdMinutes: 90, now });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ scanned: 0, completed: [], failed: [] });
    expect(repo.findStuckInProgress).toHaveBeenCalledWith(
      new Date("2026-05-25T08:30:00Z"),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});
