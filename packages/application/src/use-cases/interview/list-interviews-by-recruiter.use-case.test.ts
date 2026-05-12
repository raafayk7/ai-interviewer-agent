import { Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  FileRef,
  Interview,
  JobDescription,
  type IInterviewRepository,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import { ServiceUnknownError } from "../../core/service-error.js";
import { ListInterviewsByRecruiterUseCase } from "./list-interviews-by-recruiter.use-case.js";

const makeInterview = (recruiterId: string): Interview => {
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
  const fileRef = FileRef.create({
    key: "interviews/abc/doc.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "doc.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  }).unwrap();

  return Interview.create({
    recruiterId,
    jobDescription,
    candidateInfo,
    clientInstructions: "Focus on system design.",
    scheduledAt: new Date("2025-06-01T09:00:00Z"),
    jdFileRef: fileRef,
    cvFileRef: fileRef,
  });
};

const makeRepo = (overrides: Partial<IInterviewRepository>): IInterviewRepository => ({
  save: vi.fn(),
  findById: vi.fn(),
  listByRecruiter: vi.fn(),
  delete: vi.fn(),
  ...overrides,
});

describe("ListInterviewsByRecruiterUseCase", () => {
  it("returns serialized interviews for the recruiter", async () => {
    const interview = makeInterview("recruiter-001");
    const repo = makeRepo({
      listByRecruiter: vi.fn().mockResolvedValue(Result.Ok([interview])),
    });

    const result = await new ListInterviewsByRecruiterUseCase(repo).execute({
      recruiterId: "recruiter-001",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().interviews).toHaveLength(1);
    expect(result.unwrap().interviews[0]!.recruiterId).toBe("recruiter-001");
  });

  it("maps repository errors at the boundary", async () => {
    const repo = makeRepo({
      listByRecruiter: vi.fn().mockResolvedValue(Result.Err(new Error("database unavailable"))),
    });

    const result = await new ListInterviewsByRecruiterUseCase(repo).execute({
      recruiterId: "recruiter-001",
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ServiceUnknownError);
    expect((result.unwrapErr() as ServiceUnknownError).operation).toBe(
      "InterviewRepository.listByRecruiter",
    );
  });
});
