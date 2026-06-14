import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { StorageNotFoundError, StorageUnavailableError, StorageUnknownError } from "@repo/application";
import { S3FileStorageService, __testables } from "./s3-file-storage.service.js";

// ─── unit: fromEnv validation (no MinIO needed) ─────────────────────────────────

describe("S3FileStorageService.fromEnv", () => {
  const base = {
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "interview-documents",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
    S3_FORCE_PATH_STYLE: "true",
  } satisfies NodeJS.ProcessEnv;

  it("returns Ok when all required vars are present", () => {
    const result = S3FileStorageService.fromEnv(base);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(S3FileStorageService);
  });

  it.each([
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])("returns Err naming the missing var when %s is absent", (missing) => {
    const env = { ...base } as Record<string, string>;
    delete env[missing];
    const result = S3FileStorageService.fromEnv(env);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toContain(missing);
  });

  it("does not require S3_FORCE_PATH_STYLE (defaults via parser)", () => {
    const env = { ...base } as Record<string, string>;
    delete env["S3_FORCE_PATH_STYLE"];
    expect(S3FileStorageService.fromEnv(env).isOk()).toBe(true);
  });
});

// ─── unit: error mapping + path-style parsing (no MinIO needed) ──────────────────

describe("mapS3Error", () => {
  const { mapS3Error } = __testables;

  it("maps NoSuchKey to StorageNotFoundError carrying the key", () => {
    const err = mapS3Error("download", "docs/x.pdf")(Object.assign(new Error("nope"), { name: "NoSuchKey" }));
    expect(err).toBeInstanceOf(StorageNotFoundError);
    expect((err as StorageNotFoundError).key).toBe("docs/x.pdf");
  });

  it("maps a 404 $metadata status to StorageNotFoundError", () => {
    const err = mapS3Error("download", "k")({ $metadata: { httpStatusCode: 404 } });
    expect(err).toBeInstanceOf(StorageNotFoundError);
  });

  it("maps credential errors to StorageUnavailableError", () => {
    const err = mapS3Error("upload", "k")(Object.assign(new Error("bad creds"), { name: "InvalidAccessKeyId" }));
    expect(err).toBeInstanceOf(StorageUnavailableError);
  });

  it("maps network errors (ECONNREFUSED) to StorageUnavailableError", () => {
    const err = mapS3Error("upload", "k")(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
    expect(err).toBeInstanceOf(StorageUnavailableError);
  });

  it("maps unrecognized errors to StorageUnknownError carrying the operation", () => {
    const err = mapS3Error("delete", "k")(new Error("weird"));
    expect(err).toBeInstanceOf(StorageUnknownError);
    expect((err as StorageUnknownError).operation).toBe("delete");
  });
});

describe("parseForcePathStyle", () => {
  const { parseForcePathStyle } = __testables;

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("parses %s -> %s", (raw, expected) => {
    expect(parseForcePathStyle(raw as string | undefined)).toBe(expected);
  });
});

describe("S3FileStorageService.getSignedUrl input guard", () => {
  // No network: a non-positive expiry short-circuits before any SDK call.
  const service = new S3FileStorageService({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: "interview-documents",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive/non-finite expiry %s with StorageUnknownError",
    async (expiry) => {
      const result = await service.getSignedUrl("docs/x.pdf", expiry);
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr()).toBeInstanceOf(StorageUnknownError);
    },
  );
});

// ─── integration: MinIO round-trips (gated on S3_TEST_ENDPOINT) ──────────────────

const S3_TEST_ENDPOINT = process.env["S3_TEST_ENDPOINT"];

describe.skipIf(!S3_TEST_ENDPOINT)("S3FileStorageService integration (MinIO)", () => {
  const service = new S3FileStorageService({
    endpoint: S3_TEST_ENDPOINT!,
    region: process.env["S3_TEST_REGION"] ?? "us-east-1",
    bucket: process.env["S3_TEST_BUCKET"] ?? "interview-documents",
    accessKeyId: process.env["S3_TEST_ACCESS_KEY_ID"] ?? "minioadmin",
    secretAccessKey: process.env["S3_TEST_SECRET_ACCESS_KEY"] ?? "minioadmin",
    forcePathStyle: (process.env["S3_TEST_FORCE_PATH_STYLE"] ?? "true") === "true",
  });
  // Unique prefix per run avoids collisions across reruns and parallel files.
  const prefix = `s3-it/${Date.now()}-${randomUUID().slice(0, 8)}`;
  const writtenKeys: string[] = [];

  afterAll(async () => {
    await Promise.all(writtenKeys.map((k) => service.delete(k)));
  });

  it("upload returns a FileRef with matching fields", async () => {
    const key = `${prefix}/cv.pdf`;
    writtenKeys.push(key);
    const body = Buffer.from("hello s3");
    const result = await service.upload(body, key, "application/pdf");
    expect(result.isOk()).toBe(true);
    const ref = result.unwrap();
    expect(ref.key).toBe(key);
    expect(ref.contentType).toBe("application/pdf");
    expect(ref.sizeBytes).toBe(body.byteLength);
    expect(ref.originalFilename).toBe("cv.pdf");
  });

  it("download returns the uploaded bytes (roundtrip)", async () => {
    const key = `${prefix}/round.txt`;
    writtenKeys.push(key);
    const body = Buffer.from("round trip payload");
    await service.upload(body, key, "text/plain");
    const result = await service.download(key);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().equals(body)).toBe(true);
  });

  it("download of a missing key yields StorageNotFoundError carrying the key", async () => {
    const key = `${prefix}/missing-${randomUUID()}.bin`;
    const result = await service.download(key);
    expect(result.isErr()).toBe(true);
    const err = result.unwrapErr();
    expect(err).toBeInstanceOf(StorageNotFoundError);
    expect((err as StorageNotFoundError).key).toBe(key);
  });

  it("delete removes the object and is idempotent on re-delete", async () => {
    const key = `${prefix}/to-delete.txt`;
    await service.upload(Buffer.from("x"), key, "text/plain");
    expect((await service.delete(key)).isOk()).toBe(true);
    // download now 404s
    expect((await service.download(key)).isErr()).toBe(true);
    // re-delete succeeds (documented idempotent semantics)
    expect((await service.delete(key)).isOk()).toBe(true);
  });

  it("getSignedUrl returns a fetchable presigned GET URL", async () => {
    const key = `${prefix}/signed.txt`;
    writtenKeys.push(key);
    const body = Buffer.from("signed content");
    await service.upload(body, key, "text/plain");
    const result = await service.getSignedUrl(key, 60);
    expect(result.isOk()).toBe(true);
    const url = result.unwrap();
    expect(url).toContain("X-Amz-Signature");
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(body)).toBe(true);
  });
});
