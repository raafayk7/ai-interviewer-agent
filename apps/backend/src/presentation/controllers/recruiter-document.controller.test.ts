import { Result } from "@carbonteq/fp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ServiceUnknownError } from "@repo/application";
import { buildApp, type BuildAppOptions } from "../../app.js";
import type { RecruiterDocumentControllerDeps } from "./recruiter-document.controller.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const RECRUITER_ID = "recruiter-001";

function makeAuthDeps(recruiterId: string | null = RECRUITER_ID) {
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue(
          recruiterId
            ? { user: { id: recruiterId, email: "recruiter@company.com" } }
            : null,
        ),
      },
      handler: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    },
  };
}

const validUploadOutput = {
  jdRef: {
    key: "uploads/jd.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    originalFilename: "jd.pdf",
    uploadedAt: new Date("2025-01-01"),
  },
  cvRef: {
    key: "uploads/cv.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    originalFilename: "cv.pdf",
    uploadedAt: new Date("2025-01-01"),
  },
};

const validExtractOutput = {
  jobDescription: {
    title: "Engineer",
    company: "Acme",
    responsibilities: [],
    requirements: [],
    rawText: "text",
  },
  candidateInfo: {
    fullName: "Jane Doe",
    email: "jane@example.com",
    headline: "Engineer",
    yearsOfExperience: 3,
    skills: [],
    education: [],
    rawText: "text",
  },
};

function makeDeps(overrides: Partial<RecruiterDocumentControllerDeps> = {}): RecruiterDocumentControllerDeps {
  return {
    uploadDocumentsUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok(validUploadOutput)),
    },
    extractDocumentsUseCase: {
      execute: vi.fn().mockResolvedValue(Result.Ok(validExtractOutput)),
    },
    ...overrides,
  };
}

async function buildTestApp(
  deps: RecruiterDocumentControllerDeps,
  authDeps = makeAuthDeps(),
): Promise<FastifyInstance> {
  return buildApp({
    authDeps: authDeps as BuildAppOptions["authDeps"],
    recruiterDocuments: { deps },
    interviewSession: {
      deps: { buildUseCase: () => ({ execute: vi.fn() }) },
    },
  });
}

// ── multipart body builder ────────────────────────────────────────────────────
// We need to build a multipart/form-data body manually for Fastify inject.
function buildMultipartBody(
  fields: Array<{ name: string; content: Buffer; filename: string; contentType: string }>,
): { body: Buffer; contentType: string } {
  const boundary = "----TestBoundary1234567890";
  const parts: Buffer[] = [];

  for (const field of fields) {
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\nContent-Type: ${field.contentType}\r\n\r\n`;
    parts.push(Buffer.from(header, "utf-8"));
    parts.push(field.content);
    parts.push(Buffer.from("\r\n", "utf-8"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── POST /documents/upload ────────────────────────────────────────────────────

describe("[Integration] RecruiterDocumentController — POST /documents/upload", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 201 with jdRef and cvRef on happy path with both files", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const { body, contentType } = buildMultipartBody([
      {
        name: "jdFile",
        content: Buffer.from("jd content"),
        filename: "jd.pdf",
        contentType: "application/pdf",
      },
      {
        name: "cvFile",
        content: Buffer.from("cv content"),
        filename: "cv.pdf",
        contentType: "application/pdf",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    const result = response.json<typeof validUploadOutput>();
    expect(result.jdRef).toBeDefined();
    expect(result.cvRef).toBeDefined();
  });

  it("returns 400 when jdFile is missing", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    // Only cvFile, no jdFile
    const { body, contentType } = buildMultipartBody([
      {
        name: "cvFile",
        content: Buffer.from("cv content"),
        filename: "cv.pdf",
        contentType: "application/pdf",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const result = response.json<{ error: { code: string } }>();
    expect(result.error.code).toBe("DTO_VALIDATION_FAILED");
  });

  it("returns 400 when cvFile is missing", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    // Only jdFile, no cvFile
    const { body, contentType } = buildMultipartBody([
      {
        name: "jdFile",
        content: Buffer.from("jd content"),
        filename: "jd.pdf",
        contentType: "application/pdf",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    const result = response.json<{ error: { code: string } }>();
    expect(result.error.code).toBe("DTO_VALIDATION_FAILED");
  });

  it("returns 400 when no files are sent at all", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const { body, contentType } = buildMultipartBody([]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const { body, contentType } = buildMultipartBody([
      {
        name: "jdFile",
        content: Buffer.from("jd"),
        filename: "jd.pdf",
        contentType: "application/pdf",
      },
      {
        name: "cvFile",
        content: Buffer.from("cv"),
        filename: "cv.pdf",
        contentType: "application/pdf",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 500 when use case returns ServiceUnknownError", async () => {
    const deps = makeDeps({
      uploadDocumentsUseCase: {
        execute: vi.fn().mockResolvedValue(
          Result.Err(new ServiceUnknownError("storage down", "LocalFileStorageService.upload")),
        ),
      },
    });
    app = await buildTestApp(deps);

    const { body, contentType } = buildMultipartBody([
      {
        name: "jdFile",
        content: Buffer.from("jd content"),
        filename: "jd.pdf",
        contentType: "application/pdf",
      },
      {
        name: "cvFile",
        content: Buffer.from("cv content"),
        filename: "cv.pdf",
        contentType: "application/pdf",
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(500);
  });
});

// ── POST /documents/extract ───────────────────────────────────────────────────

describe("[Integration] RecruiterDocumentController — POST /documents/extract", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  const validExtractBody = () => ({
    jdFile: { key: "uploads/jd.pdf", contentType: "application/pdf" },
    cvFile: { key: "uploads/cv.pdf", contentType: "application/pdf" },
  });

  it("returns 200 with extracted jobDescription and candidateInfo on happy path", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: validExtractBody(),
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<typeof validExtractOutput>();
    expect(result.jobDescription).toBeDefined();
    expect(result.candidateInfo).toBeDefined();
  });

  it("returns 400 with issues when DTO validation fails (missing jdFile.key)", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: {
        jdFile: { contentType: "application/pdf" }, // missing key
        cvFile: { key: "uploads/cv.pdf", contentType: "application/pdf" },
      },
    });

    expect(response.statusCode).toBe(400);
    const result = response.json<{ error: { code: string; issues?: unknown[] } }>();
    expect(result.error.code).toBe("DTO_VALIDATION_FAILED");
    expect(result.error.issues).toBeDefined();
  });

  it("returns 400 when body is completely invalid", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 when request is unauthenticated", async () => {
    const deps = makeDeps();
    app = await buildTestApp(deps, makeAuthDeps(null));

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: validExtractBody(),
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 503 when extraction service is unavailable", async () => {
    const unavailableErr = Object.assign(new Error("service down"), {
      code: "EXTRACTION_UNAVAILABLE",
    });
    const deps = makeDeps({
      extractDocumentsUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(unavailableErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: validExtractBody(),
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 422 when extraction parse fails", async () => {
    const parseErr = Object.assign(new Error("parse failed"), {
      code: "EXTRACTION_PARSE_FAILED",
    });
    const deps = makeDeps({
      extractDocumentsUseCase: {
        execute: vi.fn().mockResolvedValue(Result.Err(parseErr)),
      },
    });
    app = await buildTestApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/documents/extract",
      payload: validExtractBody(),
    });

    expect(response.statusCode).toBe(422);
  });
});
