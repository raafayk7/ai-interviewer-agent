import { Result } from "@carbonteq/fp";
import { describe, expect, it, vi } from "vitest";
import { UploadCandidateDocumentsUseCase } from "./upload-candidate-documents.use-case.js";
import { FileRef } from "@repo/domain";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";
import { StorageUnavailableError, StorageUnknownError } from "../../ports/storage/storage-error.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeFileRef = (key: string): FileRef => {
  const r = FileRef.create({
    key,
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "file.pdf",
    uploadedAt: new Date("2025-01-01T00:00:00Z"),
  });
  expect(r.isOk()).toBe(true);
  return r.unwrap();
};

const validInput = () => ({
  recruiterId: "recruiter-001",
  jdFile: {
    buffer: Buffer.from("jd content"),
    contentType: "application/pdf",
    filename: "jd.pdf",
  },
  cvFile: {
    buffer: Buffer.from("cv content"),
    contentType: "application/pdf",
    filename: "cv.pdf",
  },
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("[Integration] UploadCandidateDocumentsUseCase", () => {
  describe("execute() — success path", () => {
    it("returns Ok with both FileRefs on successful uploads", async () => {
      const jdRef = makeFileRef("recruiters/recruiter-001/uploads/jd/ts-jd.pdf");
      const cvRef = makeFileRef("recruiters/recruiter-001/uploads/cv/ts-cv.pdf");

      const storage: IFileStorageService = {
        upload: vi.fn()
          .mockResolvedValueOnce(Result.Ok(jdRef))
          .mockResolvedValueOnce(Result.Ok(cvRef)),
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      const result = await useCase.execute(validInput());

      expect(result.isOk()).toBe(true);
      const output = result.unwrap();
      expect(output.jdRef.key).toBe(jdRef.key);
      expect(output.cvRef.key).toBe(cvRef.key);
    });

    it("calls upload twice — once for JD and once for CV", async () => {
      const jdRef = makeFileRef("recruiters/recruiter-001/uploads/jd/ts-jd.pdf");
      const cvRef = makeFileRef("recruiters/recruiter-001/uploads/cv/ts-cv.pdf");
      const uploadFn = vi.fn()
        .mockResolvedValueOnce(Result.Ok(jdRef))
        .mockResolvedValueOnce(Result.Ok(cvRef));

      const storage: IFileStorageService = {
        upload: uploadFn,
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      await useCase.execute(validInput());

      expect(uploadFn).toHaveBeenCalledTimes(2);
    });

    it("calls upload with correctly-formed JD key pattern recruiters/{rid}/uploads/jd/{ts}-{filename}", async () => {
      const jdRef = makeFileRef("recruiters/recruiter-001/uploads/jd/ts-jd.pdf");
      const cvRef = makeFileRef("recruiters/recruiter-001/uploads/cv/ts-cv.pdf");
      const uploadFn = vi.fn()
        .mockResolvedValueOnce(Result.Ok(jdRef))
        .mockResolvedValueOnce(Result.Ok(cvRef));

      const storage: IFileStorageService = {
        upload: uploadFn,
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      await useCase.execute(validInput());

      const firstCallKey: string = uploadFn.mock.calls[0][1];
      expect(firstCallKey).toMatch(/^recruiters\/recruiter-001\/uploads\/jd\/\d+-jd\.pdf$/);
    });

    it("calls upload with correctly-formed CV key pattern recruiters/{rid}/uploads/cv/{ts}-{filename}", async () => {
      const jdRef = makeFileRef("recruiters/recruiter-001/uploads/jd/ts-jd.pdf");
      const cvRef = makeFileRef("recruiters/recruiter-001/uploads/cv/ts-cv.pdf");
      const uploadFn = vi.fn()
        .mockResolvedValueOnce(Result.Ok(jdRef))
        .mockResolvedValueOnce(Result.Ok(cvRef));

      const storage: IFileStorageService = {
        upload: uploadFn,
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      await useCase.execute(validInput());

      const secondCallKey: string = uploadFn.mock.calls[1][1];
      expect(secondCallKey).toMatch(/^recruiters\/recruiter-001\/uploads\/cv\/\d+-cv\.pdf$/);
    });
  });

  describe("execute() — error paths", () => {
    it("returns Err when JD upload fails with StorageUnavailableError", async () => {
      const cvRef = makeFileRef("recruiters/recruiter-001/uploads/cv/ts-cv.pdf");
      const jdError = new StorageUnavailableError("S3 is down");

      const storage: IFileStorageService = {
        upload: vi.fn()
          .mockResolvedValueOnce(Result.Err(jdError))
          .mockResolvedValueOnce(Result.Ok(cvRef)),
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      const result = await useCase.execute(validInput());

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(StorageUnavailableError);
    });

    it("returns Err when CV upload fails with StorageUnknownError", async () => {
      const jdRef = makeFileRef("recruiters/recruiter-001/uploads/jd/ts-jd.pdf");
      const cvError = new StorageUnknownError("Unknown write error", "upload");

      const storage: IFileStorageService = {
        upload: vi.fn()
          .mockResolvedValueOnce(Result.Ok(jdRef))
          .mockResolvedValueOnce(Result.Err(cvError)),
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);
      const result = await useCase.execute(validInput());

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(StorageUnknownError);
    });

    it("does not throw — only returns Result", async () => {
      const storage: IFileStorageService = {
        upload: vi.fn().mockResolvedValue(Result.Err(new StorageUnavailableError("down"))),
        download: vi.fn(),
        delete: vi.fn(),
        getSignedUrl: vi.fn(),
      };

      const useCase = new UploadCandidateDocumentsUseCase(storage);

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
  });
});
