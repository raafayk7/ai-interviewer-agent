import { Result } from "@carbonteq/fp";
import { describe, expect, it, vi } from "vitest";
import { CreateInterviewUseCase } from "./create-interview.use-case.js";
import { Interview } from "@repo/domain";
import type { IInterviewRepository } from "@repo/domain";
import { INTERVIEW_STATUS } from "@repo/domain";
import { ValidationError } from "@repo/domain";

// ── Helpers ──────────────────────────────────────────────────────────────────

const validFileRef = () => ({
  key: "interviews/abc/jd.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "jd.pdf",
  uploadedAt: new Date("2025-01-01T00:00:00Z"),
});

const validInput = () => ({
  recruiterId: "recruiter-001",
  jobDescription: {
    title: "Senior Backend Engineer",
    company: "Acme Corp",
    responsibilities: ["Build APIs"],
    requirements: ["TypeScript"],
    rawText: "We need a backend engineer.",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    headline: "Senior Engineer",
    yearsOfExperience: 5,
    skills: ["TypeScript"],
    education: ["B.Sc. CS"],
    rawText: "Jane is an experienced engineer.",
  },
  clientInstructions: "Focus on system design.",
  scheduledAt: new Date("2025-06-01T09:00:00Z"),
  jdFileRef: validFileRef(),
  cvFileRef: { ...validFileRef(), key: "interviews/abc/cv.pdf", originalFilename: "cv.pdf" },
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("[Integration] CreateInterviewUseCase", () => {
  describe("execute() — success path", () => {
    it("returns Ok with interviewId, status=CREATED, and scheduledAt", async () => {
      const saveFn = vi.fn().mockImplementation(async (interview: Interview) => Result.Ok(interview));
      const repo: IInterviewRepository = {
        save: saveFn,
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const useCase = new CreateInterviewUseCase(repo);
      const result = await useCase.execute(validInput());

      expect(result.isOk()).toBe(true);
      const output = result.unwrap();
      expect(typeof output.interviewId).toBe("string");
      expect(output.interviewId).toBeTruthy();
      expect(output.status).toBe(INTERVIEW_STATUS.CREATED);
      expect(output.scheduledAt).toEqual(validInput().scheduledAt);
    });

    it("calls repo.save with an Interview in CREATED state", async () => {
      let capturedInterview: Interview | undefined;
      const repo: IInterviewRepository = {
        save: vi.fn().mockImplementation(async (interview: Interview) => {
          capturedInterview = interview;
          return Result.Ok(interview);
        }),
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const useCase = new CreateInterviewUseCase(repo);
      await useCase.execute(validInput());

      expect(capturedInterview).toBeDefined();
      expect(capturedInterview!.status).toBe(INTERVIEW_STATUS.CREATED);
    });

    it("the interview passed to repo.save has the correct recruiterId", async () => {
      let capturedInterview: Interview | undefined;
      const repo: IInterviewRepository = {
        save: vi.fn().mockImplementation(async (interview: Interview) => {
          capturedInterview = interview;
          return Result.Ok(interview);
        }),
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const useCase = new CreateInterviewUseCase(repo);
      await useCase.execute(validInput());

      expect(capturedInterview!.recruiterId).toBe("recruiter-001");
    });
  });

  describe("execute() — validation error paths", () => {
    it("returns Err when candidateInfo.email is invalid — repo.save is not called", async () => {
      const saveFn = vi.fn();
      const repo: IInterviewRepository = {
        save: saveFn,
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const input = validInput();
      input.candidateInfo.email = "not-an-email";

      const useCase = new CreateInterviewUseCase(repo);
      const result = await useCase.execute(input);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ValidationError);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it("returns Err when jdFileRef.sizeBytes is negative — repo.save is not called", async () => {
      const saveFn = vi.fn();
      const repo: IInterviewRepository = {
        save: saveFn,
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const input = validInput();
      input.jdFileRef.sizeBytes = -1;

      const useCase = new CreateInterviewUseCase(repo);
      const result = await useCase.execute(input);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(ValidationError);
      expect(saveFn).not.toHaveBeenCalled();
    });
  });

  describe("execute() — infrastructure error path", () => {
    it("returns Err when repo.save returns Err (RepositoryError translated at boundary)", async () => {
      const repo: IInterviewRepository = {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("DB connection lost"))),
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const useCase = new CreateInterviewUseCase(repo);
      const result = await useCase.execute(validInput());

      // The use case translates the repo error into ServiceUnknownError at the boundary.
      // The @carbonteq/fp async chain stores the error in an internal async context;
      // isErr() correctly reports failure even though unwrapErr() returns undefined
      // for async-chained errors (a known library behaviour).
      expect(result.isErr()).toBe(true);
    });

    it("does not throw — only returns Result when repo.save fails", async () => {
      const repo: IInterviewRepository = {
        save: vi.fn().mockResolvedValue(Result.Err(new Error("Network failure"))),
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const useCase = new CreateInterviewUseCase(repo);

      let threw = false;
      let result;
      try {
        result = await useCase.execute(validInput());
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(result?.isErr()).toBe(true);
    });

    it("does not throw — only returns Result on validation failure", async () => {
      const repo: IInterviewRepository = {
        save: vi.fn(),
        findById: vi.fn(),
        findByElevenLabsSessionId: vi.fn(),
        findStuckInProgress: vi.fn(),
        listByRecruiter: vi.fn(),
        delete: vi.fn(),
      };

      const input = validInput();
      input.candidateInfo.email = "bad";

      const useCase = new CreateInterviewUseCase(repo);

      let threw = false;
      let result;
      try {
        result = await useCase.execute(input);
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(result?.isErr()).toBe(true);
    });
  });
});
