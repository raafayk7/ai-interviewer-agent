import { describe, expect, it } from "vitest";
import { UploadCandidateDocumentsInputDto } from "./upload-candidate-documents.dto.js";
import { DtoValidationError } from "../core/base-dto.js";

const validInput = () => ({
  recruiterId: "recruiter-001",
  jdFile: {
    buffer: Buffer.from("job description content"),
    contentType: "application/pdf",
    filename: "jd.pdf",
  },
  cvFile: {
    buffer: Buffer.from("cv content"),
    contentType: "application/pdf",
    filename: "cv.pdf",
  },
});

describe("UploadCandidateDocumentsInputDto", () => {
  describe("parse()", () => {
    it("returns Ok for valid input with two Buffers", () => {
      const result = UploadCandidateDocumentsInputDto.parse(validInput());
      expect(result.isOk()).toBe(true);
      const dto = result.unwrap();
      expect(dto.value.recruiterId).toBe("recruiter-001");
      expect(Buffer.isBuffer(dto.value.jdFile.buffer)).toBe(true);
      expect(Buffer.isBuffer(dto.value.cvFile.buffer)).toBe(true);
    });

    it("returns Err when jdFile.contentType is empty", () => {
      const input = validInput();
      input.jdFile.contentType = "";
      const result = UploadCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when cvFile.contentType is empty", () => {
      const input = validInput();
      input.cvFile.contentType = "";
      const result = UploadCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when recruiterId is empty", () => {
      const input = validInput();
      input.recruiterId = "";
      const result = UploadCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when jdFile.buffer is not a Buffer", () => {
      const input = { ...validInput(), jdFile: { ...validInput().jdFile, buffer: "not-a-buffer" } };
      const result = UploadCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err when jdFile.filename is empty", () => {
      const input = validInput();
      input.jdFile.filename = "";
      const result = UploadCandidateDocumentsInputDto.parse(input);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });

    it("returns Err for completely missing input", () => {
      const result = UploadCandidateDocumentsInputDto.parse(undefined);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(DtoValidationError);
    });
  });
});
