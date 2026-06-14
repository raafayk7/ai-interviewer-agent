import { describe, expect, it } from "vitest";
import { ExtractCandidateDocumentsInputDto } from "./extract-candidate-documents.dto.js";
import { DtoValidationError } from "../core/base-dto.js";

const validFileRef = () => ({
  key: "interviews/recruiter-001/documents/jd.pdf",
  contentType: "application/pdf",
});

const validInput = () => ({
  recruiterId: "recruiter-001",
  jdFile: validFileRef(),
  cvFile: {
    key: "interviews/recruiter-001/documents/cv.pdf",
    contentType: "application/pdf",
  },
});

describe("ExtractCandidateDocumentsInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for valid uploaded document refs", () => {
      const result = ExtractCandidateDocumentsInputDto.parse(validInput());
      expect(result.isOk()).toBe(true);
      const dto = result.unwrap();
      expect(dto.value.recruiterId).toBe("recruiter-001");
      expect(dto.value.jdFile.key).toBe("interviews/recruiter-001/documents/jd.pdf");
      expect(dto.value.cvFile.contentType).toBe("application/pdf");
    });

    it("returns Err when recruiterId is empty", () => {
      const input = { ...validInput(), recruiterId: "" };
      const result = ExtractCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when jdFile.key is empty", () => {
      const input = validInput();
      input.jdFile.key = "";
      const result = ExtractCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when cvFile.contentType is empty", () => {
      const input = validInput();
      input.cvFile.contentType = "";
      const result = ExtractCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err for completely missing input", () => {
      const result = ExtractCandidateDocumentsInputDto.parse(undefined);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
