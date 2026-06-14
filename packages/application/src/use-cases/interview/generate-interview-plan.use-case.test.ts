import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InterviewPlan,
  InvalidInterviewStateTransitionError,
  JobDescription,
  PlannedTopic,
  TOPIC_PRIORITY,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import {
  PlannerOutputInvalidError,
  PlannerUnavailableError,
} from "../../ports/interview-planner/interview-planner-error.js";
import type { IInterviewPlannerService } from "../../ports/interview-planner/interview-planner.port.js";
import { GenerateInterviewPlanUseCase } from "./generate-interview-plan.use-case.js";

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
    yearsOfExperience: 5,
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
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  });
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeInterview = (): Interview =>
  Interview.create({
    recruiterId: "recruiter-001",
    jobDescription: makeJobDescription(),
    candidateInfo: makeCandidateInfo(),
    clientInstructions: "Focus on system design.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef: makeFileRef("interviews/abc/jd.pdf"),
    cvFileRef: makeFileRef("interviews/abc/cv.pdf"),
  });

const makePlan = (): InterviewPlan => {
  const topicResult = PlannedTopic.create({
    name: "Backend Architecture",
    questions: ["How would you design a reliable queue worker?"],
    timeAllocationMinutes: 10,
    priority: TOPIC_PRIORITY.MUST_COVER,
  });
  expect(topicResult.isOk()).toBe(true);

  const planResult = InterviewPlan.create({
    topics: [topicResult.unwrap()],
    targetDurationMinutes: 15,
    maxDurationMinutes: 25,
    mustAskQuestions: ["Describe a production incident you resolved."],
  });
  expect(planResult.isOk()).toBe(true);
  return planResult.unwrap();
};

const makeRepo = (
  overrides: Partial<IInterviewRepository> = {},
): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByElevenLabsSessionId: vi.fn(),
  findStuckInProgress: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

const makePlanner = (
  generatePlan = vi.fn(),
): IInterviewPlannerService => ({
  generatePlan,
});

describe("[Integration] GenerateInterviewPlanUseCase", () => {
  it("loads the interview, generates a plan, schedules it, persists it, and returns a scalar summary", async () => {
    const interview = makeInterview();
    const plan = makePlan();
    const save = vi.fn().mockImplementation(async (scheduled: Interview) => Result.Ok(scheduled));
    const generatePlan = vi.fn().mockResolvedValue(Result.Ok(plan));
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      save,
    });

    const useCase = new GenerateInterviewPlanUseCase(repo, makePlanner(generatePlan));
    const result = await useCase.execute({
      interviewId: interview.id,
      targetDurationMinutes: 15,
      maxDurationMinutes: 25,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      interviewId: interview.id,
      status: INTERVIEW_STATUS.SCHEDULED,
      topicCount: 1,
      targetDurationMinutes: 15,
      maxDurationMinutes: 25,
    });
    expect(generatePlan).toHaveBeenCalledWith({
      interviewId: interview.id,
      jobDescription: interview.jobDescription,
      candidateInfo: interview.candidateInfo,
      clientInstructions: interview.clientInstructions,
      targetDurationMinutes: 15,
      maxDurationMinutes: 25,
    });
    expect(save).toHaveBeenCalledTimes(1);
    const savedInterview = save.mock.calls[0]![0] as Interview;
    expect(savedInterview.status).toBe(INTERVIEW_STATUS.SCHEDULED);
  });

  it("returns ServiceUnknownError when repository lookup fails", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });
    const planner = makePlanner(vi.fn());

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: "interview-001" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("InterviewRepository.findById");
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns InterviewNotFoundError when the interview is missing", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });
    const planner = makePlanner(vi.fn());

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: "missing-interview" });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
    expect(planner.generatePlan).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns planner errors unchanged and does not persist", async () => {
    const interview = makeInterview();
    const plannerError = new PlannerUnavailableError("planner unavailable");
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const planner = makePlanner(vi.fn().mockResolvedValue(Result.Err(plannerError)));

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: interview.id });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(plannerError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns ServiceUnknownError when saving the scheduled interview fails", async () => {
    const interview = makeInterview();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      save: vi.fn().mockResolvedValue(Result.Err(new Error("write failed"))),
    });
    const planner = makePlanner(vi.fn().mockResolvedValue(Result.Ok(makePlan())));

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: interview.id });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe("InterviewRepository.save");
  });

  it("returns the domain transition error when the interview cannot be scheduled", async () => {
    const interview = makeInterview();
    const scheduleResult = interview.schedule(makePlan());
    expect(scheduleResult.isOk()).toBe(true);
    const scheduled = scheduleResult.unwrap();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(scheduled))),
    });
    const planner = makePlanner(vi.fn().mockResolvedValue(Result.Ok(makePlan())));

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: scheduled.id });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("returns planner output errors unchanged", async () => {
    const interview = makeInterview();
    const plannerError = new PlannerOutputInvalidError("invalid model output", interview.id);
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });
    const planner = makePlanner(vi.fn().mockResolvedValue(Result.Err(plannerError)));

    const useCase = new GenerateInterviewPlanUseCase(repo, planner);
    const result = await useCase.execute({ interviewId: interview.id });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(plannerError);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
