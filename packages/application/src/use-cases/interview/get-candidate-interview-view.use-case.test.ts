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
import { GetCandidateInterviewViewUseCase } from "./get-candidate-interview-view.use-case.js";

const makeInterview = (): Interview => {
  const jobDescription = JobDescription.create({
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  }).unwrap();
  const candidateInfo = CandidateInfo.create({
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 5,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  }).unwrap();
  const jdFileRef = FileRef.create({
    key: "interviews/abc/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  }).unwrap();
  const cvFileRef = FileRef.create({
    key: "interviews/abc/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  }).unwrap();

  return Interview.create({
    recruiterId: "recruiter-001",
    jobDescription,
    candidateInfo,
    clientInstructions: "Focus on system design.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef,
    cvFileRef,
  });
};

const makeInterviewPlan = (): InterviewPlan => {
  const topic = PlannedTopic.create({
    name: "System Design",
    questions: ["Design a URL shortener"],
    timeAllocationMinutes: 15,
    priority: TOPIC_PRIORITY.MUST_COVER,
  }).unwrap();
  return InterviewPlan.create({
    topics: [topic],
    targetDurationMinutes: 45,
    maxDurationMinutes: 60,
    mustAskQuestions: [],
  }).unwrap();
};

const makeRepo = (overrides: Partial<IInterviewRepository>): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByElevenLabsSessionId: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

describe("GetCandidateInterviewViewUseCase", () => {
  it("returns candidate view with null targetDurationMinutes when interview has no plan", async () => {
    const interview = makeInterview();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });

    const result = await new GetCandidateInterviewViewUseCase(repo).execute({
      interviewId: interview.id,
    });

    expect(result.isOk()).toBe(true);
    const view = result.unwrap().view;
    expect(view.interviewId).toBe(interview.id);
    expect(view.candidateName).toBe("Jane Doe");
    expect(view.jobTitle).toBe("Senior Backend Engineer");
    expect(view.company).toBe("Acme Corp");
    expect(view.scheduledAt).toBe(new Date("2025-06-01T09:00:00Z").toISOString());
    expect(view.targetDurationMinutes).toBeNull();
    expect(view.status).toBe(INTERVIEW_STATUS.CREATED);
  });

  it("returns targetDurationMinutes from plan when interview is scheduled", async () => {
    const interview = makeInterview().schedule(makeInterviewPlan()).unwrap();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });

    const result = await new GetCandidateInterviewViewUseCase(repo).execute({
      interviewId: interview.id,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().view.targetDurationMinutes).toBe(45);
    expect(result.unwrap().view.status).toBe(INTERVIEW_STATUS.SCHEDULED);
  });

  it("returns InterviewNotFoundError when interview is missing", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });

    const result = await new GetCandidateInterviewViewUseCase(repo).execute({
      interviewId: "missing-id",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
  });

  it("maps repository errors to ServiceUnknownError at the boundary", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });

    const result = await new GetCandidateInterviewViewUseCase(repo).execute({
      interviewId: "interview-001",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "InterviewRepository.findById",
    );
  });
});
