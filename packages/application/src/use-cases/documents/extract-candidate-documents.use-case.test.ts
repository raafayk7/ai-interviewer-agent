import { Result } from "@carbonteq/fp";
import {
  CandidateInfo,
  JobDescription,
  type CandidateInfoProps,
  type JobDescriptionProps,
} from "@repo/domain";
import { describe, expect, it, vi } from "vitest";
import {
  DocumentExtractionParseFailedError,
  DocumentExtractionUnavailableError,
} from "../../ports/document-extraction/document-extraction-error.js";
import type { IDocumentExtractionService } from "../../ports/document-extraction/document-extraction.port.js";
import type { IFileStorageService } from "../../ports/storage/file-storage.port.js";
import { StorageNotFoundError } from "../../ports/storage/storage-error.js";
import {
  ExtractCandidateDocumentsUseCase,
  type DocumentExtractorFactory,
} from "./extract-candidate-documents.use-case.js";

const jdProps = (): JobDescriptionProps => ({
  title: "Senior Backend Engineer",
  company: "Acme Corp",
  responsibilities: ["Build APIs", "Own service reliability"],
  requirements: ["TypeScript", "PostgreSQL"],
  rawText: "Acme Corp is hiring a Senior Backend Engineer.",
});

const candidateProps = (): CandidateInfoProps => ({
  fullName: "Jane Doe",
  email: "jane.doe@example.com",
  headline: "Senior Backend Engineer",
  yearsOfExperience: 6,
  skills: ["TypeScript", "Node.js"],
  education: ["B.Sc. Computer Science"],
  rawText: "Jane Doe is a backend engineer.",
});

const makeJobDescription = (): JobDescription => {
  const result = JobDescription.create(jdProps());
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const makeCandidateInfo = (): CandidateInfo => {
  const result = CandidateInfo.create(candidateProps());
  expect(result.isOk()).toBe(true);
  return result.unwrap();
};

const validInput = () => ({
  recruiterId: "recruiter-001",
  jdFile: {
    key: "recruiters/recruiter-001/uploads/jd/jd.pdf",
    contentType: "application/pdf",
  },
  cvFile: {
    key: "recruiters/recruiter-001/uploads/cv/cv.pdf",
    contentType: "application/pdf",
  },
});

const makeStorage = (download = vi.fn()): IFileStorageService => ({
  upload: vi.fn(),
  download,
  delete: vi.fn(),
  getSignedUrl: vi.fn(),
});

describe("[Integration] ExtractCandidateDocumentsUseCase", () => {
  it("downloads both documents, extracts each with its own scoped extractor, and returns serialized output", async () => {
    const jdBuffer = Buffer.from("jd bytes");
    const cvBuffer = Buffer.from("cv bytes");
    const jd = makeJobDescription();
    const candidate = makeCandidateInfo();

    const storage = makeStorage(
      vi.fn()
        .mockResolvedValueOnce(Result.Ok(jdBuffer))
        .mockResolvedValueOnce(Result.Ok(cvBuffer)),
    );
    const jdExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn().mockResolvedValue(Result.Ok(jd)),
      extractCandidateInfo: vi.fn(),
    };
    const cvExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn(),
      extractCandidateInfo: vi.fn().mockResolvedValue(Result.Ok(candidate)),
    };
    const factory: DocumentExtractorFactory = vi.fn((context) =>
      context.documentKey.endsWith("/jd/jd.pdf") ? jdExtractor : cvExtractor,
    );

    const useCase = new ExtractCandidateDocumentsUseCase(storage, factory);
    const result = await useCase.execute(validInput());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      jobDescription: jdProps(),
      candidateInfo: candidateProps(),
    });
    expect(storage.download).toHaveBeenCalledWith(validInput().jdFile.key);
    expect(storage.download).toHaveBeenCalledWith(validInput().cvFile.key);
    expect(factory).toHaveBeenCalledWith({
      recruiterId: "recruiter-001",
      documentKey: validInput().jdFile.key,
    });
    expect(factory).toHaveBeenCalledWith({
      recruiterId: "recruiter-001",
      documentKey: validInput().cvFile.key,
    });
    expect(jdExtractor.extractJobDescription).toHaveBeenCalledWith(jdBuffer, "application/pdf");
    expect(cvExtractor.extractCandidateInfo).toHaveBeenCalledWith(cvBuffer, "application/pdf");
  });

  it("returns Err when JD download fails and does not create extractors", async () => {
    const storage = makeStorage(
      vi.fn().mockResolvedValueOnce(Result.Err(new StorageNotFoundError("missing-jd"))),
    );
    const factory = vi.fn() as DocumentExtractorFactory;

    const useCase = new ExtractCandidateDocumentsUseCase(storage, factory);
    const result = await useCase.execute(validInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(StorageNotFoundError);
    expect(storage.download).toHaveBeenCalledTimes(1);
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns Err when CV download fails and does not call extraction", async () => {
    const storage = makeStorage(
      vi.fn()
        .mockResolvedValueOnce(Result.Ok(Buffer.from("jd bytes")))
        .mockResolvedValueOnce(Result.Err(new StorageNotFoundError("missing-cv"))),
    );
    const factory = vi.fn() as DocumentExtractorFactory;

    const useCase = new ExtractCandidateDocumentsUseCase(storage, factory);
    const result = await useCase.execute(validInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(StorageNotFoundError);
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns Err when JD extraction fails and does not extract CV", async () => {
    const jdError = new DocumentExtractionParseFailedError("invalid JD", validInput().jdFile.key);
    const cvExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn(),
      extractCandidateInfo: vi.fn(),
    };
    const jdExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn().mockResolvedValue(Result.Err(jdError)),
      extractCandidateInfo: vi.fn(),
    };
    const storage = makeStorage(
      vi.fn()
        .mockResolvedValueOnce(Result.Ok(Buffer.from("jd bytes")))
        .mockResolvedValueOnce(Result.Ok(Buffer.from("cv bytes"))),
    );
    const factory: DocumentExtractorFactory = vi.fn((context) =>
      context.documentKey === validInput().jdFile.key ? jdExtractor : cvExtractor,
    );

    const useCase = new ExtractCandidateDocumentsUseCase(storage, factory);
    const result = await useCase.execute(validInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(jdError);
    expect(jdExtractor.extractJobDescription).toHaveBeenCalledTimes(1);
    expect(cvExtractor.extractCandidateInfo).not.toHaveBeenCalled();
  });

  it("returns Err when CV extraction fails", async () => {
    const cvError = new DocumentExtractionUnavailableError("Gemini unavailable");
    const jdExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn().mockResolvedValue(Result.Ok(makeJobDescription())),
      extractCandidateInfo: vi.fn(),
    };
    const cvExtractor: IDocumentExtractionService = {
      extractJobDescription: vi.fn(),
      extractCandidateInfo: vi.fn().mockResolvedValue(Result.Err(cvError)),
    };
    const storage = makeStorage(
      vi.fn()
        .mockResolvedValueOnce(Result.Ok(Buffer.from("jd bytes")))
        .mockResolvedValueOnce(Result.Ok(Buffer.from("cv bytes"))),
    );
    const factory: DocumentExtractorFactory = vi.fn((context) =>
      context.documentKey === validInput().jdFile.key ? jdExtractor : cvExtractor,
    );

    const useCase = new ExtractCandidateDocumentsUseCase(storage, factory);
    const result = await useCase.execute(validInput());

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe(cvError);
  });
});
