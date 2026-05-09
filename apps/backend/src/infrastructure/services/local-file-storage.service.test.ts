import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageNotFoundError, StorageUnknownError } from "@repo/application";
import { LocalFileStorageService } from "./local-file-storage.service.js";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let tmpDir: string;
let service: LocalFileStorageService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aii-storage-test-"));
  service = new LocalFileStorageService({
    rootPath: tmpDir,
    signingSecret: "test-signing-secret-for-tests-only",
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── upload ────────────────────────────────────────────────────────────────────

describe("upload", () => {
  it("writes file under root and returns FileRef with matching key, contentType, and sizeBytes", async () => {
    const content = Buffer.from("hello world");
    const key = "documents/myfile.pdf";

    const result = await service.upload(content, key, "application/pdf");

    expect(result.isOk()).toBe(true);
    const fileRef = result.unwrap();

    expect(fileRef.key).toBe(key);
    expect(fileRef.contentType).toBe("application/pdf");
    expect(fileRef.sizeBytes).toBe(content.byteLength);
    expect(fileRef.originalFilename).toBe("myfile.pdf");

    // Verify the file actually exists on disk
    const absolutePath = path.join(tmpDir, key);
    const stat = await fs.stat(absolutePath);
    expect(stat.isFile()).toBe(true);
  });

  it("creates nested directories when key contains path separators", async () => {
    const content = Buffer.from("nested file content");
    const key = "interviews/abc123/cv.pdf";

    const result = await service.upload(content, key, "application/pdf");

    expect(result.isOk()).toBe(true);

    const absolutePath = path.join(tmpDir, key);
    const stat = await fs.stat(absolutePath);
    expect(stat.isFile()).toBe(true);
  });

  it("rejects path traversal key and returns Err with StorageUnknownError — no file written", async () => {
    const traversalKey = "../etc/passwd";
    const content = Buffer.from("malicious content");

    const result = await service.upload(content, traversalKey, "text/plain");

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(StorageUnknownError);

    // Verify no file was written at the attempted traversal location
    const escapedPath = path.resolve(tmpDir, "..", "etc", "passwd");
    let fileExists = false;
    try {
      await fs.access(escapedPath);
      fileExists = true;
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });
});

// ─── download ─────────────────────────────────────────────────────────────────

describe("download", () => {
  it("returns Buffer containing the exact content that was uploaded", async () => {
    const content = Buffer.from("download me please");
    const key = "downloads/doc.pdf";

    await service.upload(content, key, "application/pdf");

    const result = await service.download(key);

    expect(result.isOk()).toBe(true);
    const downloaded = result.unwrap();
    expect(downloaded).toEqual(content);
  });

  it("returns Err with StorageNotFoundError for a missing key", async () => {
    const key = "nonexistent/file.pdf";

    const result = await service.download(key);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(StorageNotFoundError);
    expect((result.unwrapErr() as StorageNotFoundError).key).toBe(key);
  });
});

// ─── delete ───────────────────────────────────────────────────────────────────

describe("delete", () => {
  it("removes the file from disk — fs.access throws ENOENT after deletion", async () => {
    const content = Buffer.from("file to delete");
    const key = "to-delete/file.txt";

    await service.upload(content, key, "text/plain");

    const deleteResult = await service.delete(key);
    expect(deleteResult.isOk()).toBe(true);

    const absolutePath = path.join(tmpDir, key);
    let threw = false;
    try {
      await fs.access(absolutePath);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("returns Err with StorageNotFoundError when attempting to delete a non-existent key", async () => {
    const key = "ghost/file.txt";

    const result = await service.delete(key);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(StorageNotFoundError);
  });
});

// ─── getSignedUrl ─────────────────────────────────────────────────────────────

describe("getSignedUrl", () => {
  it("returns a URL containing a base64url token and a unix timestamp expires greater than now", async () => {
    const key = "interviews/abc/jd.pdf";
    const nowSec = Math.floor(Date.now() / 1000);

    const result = await service.getSignedUrl(key, 600);

    expect(result.isOk()).toBe(true);
    const url = result.unwrap();

    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token");
    const expires = Number(urlObj.searchParams.get("expires"));

    expect(token).not.toBeNull();
    // base64url characters: A-Z, a-z, 0-9, -, _
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(expires).toBeGreaterThan(nowSec);
    expect(expires).toBeLessThanOrEqual(nowSec + 600 + 2); // small clock tolerance
  });
});

// ─── verify ───────────────────────────────────────────────────────────────────

describe("verify", () => {
  it("accepts a valid token produced by getSignedUrl for the same key", async () => {
    const key = "interviews/abc/jd.pdf";

    const urlResult = await service.getSignedUrl(key, 600);
    expect(urlResult.isOk()).toBe(true);

    const url = urlResult.unwrap();
    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token")!;
    const expires = Number(urlObj.searchParams.get("expires"));

    expect(service.verify(key, expires, token)).toBe(true);
  });

  it("rejects a token whose expires timestamp is in the past", async () => {
    const key = "interviews/abc/jd.pdf";
    const pastExpires = Math.floor(Date.now() / 1000) - 1;

    // Create a service with knowledge of the signing algorithm to produce a valid-but-expired token
    // We use getSignedUrl and then manipulate the expires in the assertion
    const urlResult = await service.getSignedUrl(key, 600);
    expect(urlResult.isOk()).toBe(true);
    const url = urlResult.unwrap();
    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token")!;

    expect(service.verify(key, pastExpires, token)).toBe(false);
  });

  it("rejects a tampered token — mutating one character returns false", async () => {
    const key = "interviews/abc/jd.pdf";

    const urlResult = await service.getSignedUrl(key, 600);
    expect(urlResult.isOk()).toBe(true);

    const url = urlResult.unwrap();
    const urlObj = new URL(url, "http://localhost");
    const token = urlObj.searchParams.get("token")!;
    const expires = Number(urlObj.searchParams.get("expires"));

    // Flip the first character to tamper with the token
    const tamperedChar = token[0] === "A" ? "B" : "A";
    const tamperedToken = tamperedChar + token.slice(1);

    expect(service.verify(key, expires, tamperedToken)).toBe(false);
  });
});

// ─── fromEnv ──────────────────────────────────────────────────────────────────

describe("fromEnv", () => {
  it("returns Err when FILE_STORAGE_ROOT is missing", () => {
    const result = LocalFileStorageService.fromEnv({
      FILE_STORAGE_SIGNING_SECRET: "some-secret",
    });

    expect(result.isErr()).toBe(true);
  });

  it("returns Err when FILE_STORAGE_SIGNING_SECRET is missing", () => {
    const result = LocalFileStorageService.fromEnv({
      FILE_STORAGE_ROOT: tmpDir,
    });

    expect(result.isErr()).toBe(true);
  });

  it("returns Ok containing a LocalFileStorageService when both env vars are present", () => {
    const result = LocalFileStorageService.fromEnv({
      FILE_STORAGE_ROOT: tmpDir,
      FILE_STORAGE_SIGNING_SECRET: "my-secret",
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeInstanceOf(LocalFileStorageService);
  });
});
