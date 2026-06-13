import { describe, expect, it } from "vitest";
import { CreateInterviewInputDto } from "./create-interview.dto.js";
import { DtoValidationError } from "../core/base-dto.js";

const validFileRef = () => ({
  key: "interviews/abc/jd.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024,
  originalFilename: "jd.pdf",
  uploadedAt: new Date("2025-01-01T00:00:00Z"),
});

const validInput = () => ({
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

describe("CreateInterviewInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for valid full payload", () => {
      const result = CreateInterviewInputDto.parse(validInput());
      expect(result.isOk()).toBe(true);
      const dto = result.unwrap();
      expect(dto.value.candidateInfo.email).toBe("jane.doe@example.com");
    });

    it("coerces scheduledAt from an ISO date string", () => {
      const input = { ...validInput(), scheduledAt: "2025-06-01" };
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().value.scheduledAt).toEqual(new Date("2025-06-01T00:00:00.000Z"));
    });

    it("returns Err when candidateInfo.email is invalid", () => {
      const input = validInput();
      input.candidateInfo.email = "not-an-email";
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when jdFileRef.sizeBytes is negative", () => {
      const input = validInput();
      input.jdFileRef.sizeBytes = -1;
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("does not expose recruiterId as public DTO input", () => {
      const input = { ...validInput(), recruiterId: "" };
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isOk()).toBe(true);
      expect("recruiterId" in result.unwrap().value).toBe(false);
    });

    it("returns Err when jobDescription.title is empty", () => {
      const input = validInput();
      input.jobDescription.title = "";
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("coerces jdFileRef.uploadedAt from an ISO date string", () => {
      // uploadedAt is z.coerce.date() (like scheduledAt) — dates arrive over the
      // wire as JSON strings, so a valid ISO string is coerced, not rejected.
      const input = validInput();
      (input.jdFileRef as { uploadedAt: unknown }).uploadedAt = "2025-01-01";
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().value.jdFileRef.uploadedAt).toEqual(
        new Date("2025-01-01T00:00:00.000Z"),
      );
    });

    it("returns Err when jdFileRef.uploadedAt is not a valid date", () => {
      const input = validInput();
      (input.jdFileRef as { uploadedAt: unknown }).uploadedAt = "not-a-real-date";
      const result = CreateInterviewInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
