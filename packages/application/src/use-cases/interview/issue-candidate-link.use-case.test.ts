import { Option, Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  INTERVIEW_STATUS,
  Interview,
  InterviewNotFoundError,
  InvalidInterviewStateTransitionError,
  JobDescription,
  type IInterviewRepository,
  type InterviewStatus,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { IssueCandidateLinkUseCase } from "./issue-candidate-link.use-case.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

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

const makeInterviewWithStatus = (status: InterviewStatus): Interview =>
  Interview.fromSerialized({ ...makeInterview().serialize(), status });

const makeRepo = (overrides: Partial<IInterviewRepository>): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  findByElevenLabsSessionId: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("IssueCandidateLinkUseCase", () => {
  it("succeeds and returns interviewId + status when interview is SCHEDULED", async () => {
    const interview = makeInterviewWithStatus(INTERVIEW_STATUS.SCHEDULED);
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });

    const result = await new IssueCandidateLinkUseCase(repo).execute({
      interviewId: interview.id,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().interviewId).toBe(interview.id);
    expect(result.unwrap().status).toBe(INTERVIEW_STATUS.SCHEDULED);
  });

  it("succeeds and returns interviewId + status when interview is IN_PROGRESS", async () => {
    const interview = makeInterviewWithStatus(INTERVIEW_STATUS.IN_PROGRESS);
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
    });

    const result = await new IssueCandidateLinkUseCase(repo).execute({
      interviewId: interview.id,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().interviewId).toBe(interview.id);
    expect(result.unwrap().status).toBe(INTERVIEW_STATUS.IN_PROGRESS);
  });

  it("returns InterviewNotFoundError when the interview does not exist", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.None)),
    });

    const result = await new IssueCandidateLinkUseCase(repo).execute({
      interviewId: "missing-id",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(InterviewNotFoundError);
  });

  it("maps repository errors to ServiceUnknownError at the boundary", async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });

    const result = await new IssueCandidateLinkUseCase(repo).execute({
      interviewId: "interview-001",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "InterviewRepository.findById",
    );
  });

  it.each([
    INTERVIEW_STATUS.CREATED,
    INTERVIEW_STATUS.COMPLETED,
    INTERVIEW_STATUS.EVALUATED,
    INTERVIEW_STATUS.CANCELLED,
  ])(
    "returns InvalidInterviewStateTransitionError for status %s",
    async (status) => {
      const interview = makeInterviewWithStatus(status);
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      });

      const result = await new IssueCandidateLinkUseCase(repo).execute({
        interviewId: interview.id,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(InvalidInterviewStateTransitionError);
    },
  );

  it("does not call save on the repository (stateless — no side effects)", async () => {
    const interview = makeInterviewWithStatus(INTERVIEW_STATUS.SCHEDULED);
    const saveSpy = vi.fn();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(Result.Ok(Option.Some(interview))),
      save: saveSpy,
    });

    await new IssueCandidateLinkUseCase(repo).execute({ interviewId: interview.id });

    expect(saveSpy).not.toHaveBeenCalled();
  });
});
