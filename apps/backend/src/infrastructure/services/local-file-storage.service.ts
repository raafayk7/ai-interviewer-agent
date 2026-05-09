import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { Result } from "@carbonteq/fp";
import {
  type IFileStorageService,
  StorageNotFoundError,
  StorageUnavailableError,
  StorageUnknownError,
  type StorageError,
} from "@repo/application";
import { FileRef } from "@repo/domain";

export interface LocalFileStorageConfig {
  readonly rootPath: string;
  readonly signingSecret: string;
  readonly signedUrlPrefix?: string;
}

interface ResolvedLocalFileStorageConfig {
  readonly rootPath: string;
  readonly signingSecret: string;
  readonly signedUrlPrefix: string;
}

const DEFAULT_SIGNED_URL_PREFIX = "/files";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error;

const mapFsError =
  (operation: string, key: string) =>
  (error: unknown): StorageError => {
    if (isNodeError(error)) {
      if (error.code === "ENOENT") {
        return new StorageNotFoundError(key);
      }

      if (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOSPC") {
        return new StorageUnavailableError(`${operation} failed: ${error.message}`);
      }
    }

    return new StorageUnknownError(error instanceof Error ? error.message : String(error), operation);
  };

const invalidKeyError = (key: string, operation: string): StorageError =>
  new StorageUnknownError(`Invalid storage key: ${key}`, operation);

const safeResolve = (rootPath: string, key: string, operation: string): Result<string, StorageError> => {
  const root = resolve(rootPath);
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  const candidate = resolve(root, normalize(key));

  if (candidate === root || candidate.startsWith(rootWithSeparator)) {
    return Result.Ok(candidate);
  }

  return Result.Err(invalidKeyError(key, operation));
};

const filenameFromKey = (key: string): string => {
  const normalized = normalize(key).replace(/\\/g, "/");
  return normalized.split("/").pop() ?? key;
};

export class LocalFileStorageService implements IFileStorageService {
  private readonly config: Result<ResolvedLocalFileStorageConfig, StorageError>;

  constructor(config: LocalFileStorageConfig) {
    if (!config.rootPath.trim()) {
      this.config = Result.Err(new StorageUnavailableError("LocalFileStorageService: rootPath is required"));
      return;
    }

    if (!config.signingSecret.trim()) {
      this.config = Result.Err(new StorageUnavailableError("LocalFileStorageService: signingSecret is required"));
      return;
    }

    this.config = Result.Ok({
      rootPath: resolve(config.rootPath),
      signingSecret: config.signingSecret,
      signedUrlPrefix: config.signedUrlPrefix ?? DEFAULT_SIGNED_URL_PREFIX,
    });
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Result<LocalFileStorageService, Error> {
    const rootPath = env["FILE_STORAGE_ROOT"];
    const signingSecret = env["FILE_STORAGE_SIGNING_SECRET"];

    if (!rootPath) {
      return Result.Err(new Error("FILE_STORAGE_ROOT is not set"));
    }

    if (!signingSecret) {
      return Result.Err(new Error("FILE_STORAGE_SIGNING_SECRET is not set"));
    }

    return Result.Ok(new LocalFileStorageService({ rootPath, signingSecret }));
  }

  async upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>> {
    return this.config.match({
      Err: async (error) => Result.Err(error),
      Ok: (config) =>
        safeResolve(config.rootPath, key, "upload").match({
          Err: async (error) => Result.Err(error),
          Ok: (absolutePath) =>
            Result.tryAsyncCatch(
              async () => {
                await fs.mkdir(dirname(absolutePath), { recursive: true });
                await fs.writeFile(absolutePath, file);
              },
              mapFsError("upload", key),
            )
              .flatMap(() =>
                FileRef.create({
                  key,
                  contentType,
                  sizeBytes: file.byteLength,
                  originalFilename: filenameFromKey(key),
                  uploadedAt: new Date(),
                }).mapErr((error) => new StorageUnknownError(error.message, "upload") as StorageError),
              )
              .toPromise(),
        }),
    });
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    return this.config.match({
      Err: async (error) => Result.Err(error),
      Ok: (config) =>
        safeResolve(config.rootPath, key, "download").match({
          Err: async () => Result.Err(new StorageNotFoundError(key)),
          Ok: (absolutePath) =>
            Result.tryAsyncCatch(() => fs.readFile(absolutePath), mapFsError("download", key)).toPromise(),
        }),
    });
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    return this.config.match({
      Err: async (error) => Result.Err(error),
      Ok: (config) =>
        safeResolve(config.rootPath, key, "delete").match({
          Err: async () => Result.Err(new StorageNotFoundError(key)),
          Ok: (absolutePath) =>
            Result.tryAsyncCatch(async () => {
              await fs.unlink(absolutePath);
            }, mapFsError("delete", key)).toPromise(),
        }),
    });
  }

  async getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>> {
    return this.config.match({
      Err: async (error) => Result.Err(error),
      Ok: async (config) =>
        safeResolve(config.rootPath, key, "getSignedUrl").match({
          Err: (error) => Result.Err(error),
          Ok: () => {
            if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
              return Result.Err(
                new StorageUnknownError("expiresInSec must be a positive finite number", "getSignedUrl"),
              );
            }

            const expires = Math.floor(Date.now() / 1000) + Math.floor(expiresInSec);
            const token = this.sign(config.signingSecret, key, expires);
            const path = join(config.signedUrlPrefix, encodeURIComponent(key)).replace(/\\/g, "/");

            return Result.Ok(`${path}?token=${token}&expires=${expires}`);
          },
        }),
    });
  }

  verify(key: string, expires: number, token: string): boolean {
    return this.config.match({
      Err: () => false,
      Ok: (config) =>
        safeResolve(config.rootPath, key, "verify").match({
          Err: () => false,
          Ok: () => {
            if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
              return false;
            }

            const expected = this.sign(config.signingSecret, key, expires);
            const expectedBuffer = Buffer.from(expected, "base64url");
            const tokenBuffer = Buffer.from(token, "base64url");

            if (expectedBuffer.length !== tokenBuffer.length) {
              return false;
            }

            return timingSafeEqual(expectedBuffer, tokenBuffer);
          },
        }),
    });
  }

  private sign(signingSecret: string, key: string, expires: number): string {
    return createHmac("sha256", signingSecret).update(`${key}.${expires}`).digest("base64url");
  }
}
