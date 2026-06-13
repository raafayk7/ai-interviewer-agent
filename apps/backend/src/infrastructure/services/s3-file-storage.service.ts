import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Result } from "@carbonteq/fp";
import {
  type IFileStorageService,
  StorageNotFoundError,
  StorageUnavailableError,
  StorageUnknownError,
  type StorageError,
} from "@repo/application";
import { FileRef } from "@repo/domain";

export interface S3FileStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const filenameFromKey = (key: string): string => {
  const normalized = key.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? key;
};

const isNotFound = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const e = error as Partial<S3ServiceException> & { name?: string };
  if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
  return e.$metadata?.httpStatusCode === 404;
};

const isUnavailable = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; code?: string };
  const name = e.name ?? "";
  const code = e.code ?? "";
  // Credentials / authorization
  if (
    name === "CredentialsProviderError" ||
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch" ||
    name === "AccessDenied"
  ) {
    return true;
  }
  // Network / endpoint (node + undici codes surfaced by the SDK)
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    name === "TimeoutError"
  ) {
    return true;
  }
  return false;
};

const mapS3Error =
  (operation: string, key: string) =>
  (error: unknown): StorageError => {
    if (isNotFound(error)) {
      return new StorageNotFoundError(key);
    }
    if (isUnavailable(error)) {
      return new StorageUnavailableError(
        `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new StorageUnknownError(error instanceof Error ? error.message : String(error), operation);
  };

const parseForcePathStyle = (raw: string | undefined): boolean => raw === "true" || raw === "1";

// Exported for direct unit testing of the error-mapping branches without a live S3 endpoint.
export const __testables = { mapS3Error, isNotFound, isUnavailable, parseForcePathStyle };

// ─── service ──────────────────────────────────────────────────────────────────

export class S3FileStorageService implements IFileStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3FileStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle, // required for MinIO / Supabase path-style endpoints
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Result<S3FileStorageService, Error> {
    const endpoint = env["S3_ENDPOINT"];
    const region = env["S3_REGION"];
    const bucket = env["S3_BUCKET"];
    const accessKeyId = env["S3_ACCESS_KEY_ID"];
    const secretAccessKey = env["S3_SECRET_ACCESS_KEY"];

    if (!endpoint) return Result.Err(new Error("S3_ENDPOINT is not set"));
    if (!region) return Result.Err(new Error("S3_REGION is not set"));
    if (!bucket) return Result.Err(new Error("S3_BUCKET is not set"));
    if (!accessKeyId) return Result.Err(new Error("S3_ACCESS_KEY_ID is not set"));
    if (!secretAccessKey) return Result.Err(new Error("S3_SECRET_ACCESS_KEY is not set"));

    return Result.Ok(
      new S3FileStorageService({
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: parseForcePathStyle(env["S3_FORCE_PATH_STYLE"]),
      }),
    );
  }

  async upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>> {
    return Result.tryAsyncCatch(async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
        }),
      );
    }, mapS3Error("upload", key))
      .flatMap(() =>
        FileRef.create({
          key,
          contentType,
          sizeBytes: file.byteLength,
          originalFilename: filenameFromKey(key),
          uploadedAt: new Date(),
        }).mapErr((error) => new StorageUnknownError(error.message, "upload") as StorageError),
      )
      .toPromise();
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    return Result.tryAsyncCatch(async () => {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) {
        // Treat an empty body as not-found for caller parity with LocalFileStorageService.
        throw Object.assign(new Error("empty response body"), { name: "NoSuchKey" });
      }
      // SDK v3 returns Body as an SdkStream; transformToByteArray is the supported Node mixin.
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    }, mapS3Error("download", key)).toPromise();
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    // NOTE: S3 DeleteObject is idempotent — deleting a non-existent key succeeds (no 404),
    // diverging deliberately from LocalFileStorageService.delete which returns StorageNotFoundError.
    // This is the correct cloud-native contract and no caller depends on delete-of-missing erroring.
    // To enforce strict parity, prepend a HeadObjectCommand precheck that throws NoSuchKey when absent
    // (costs an extra round trip + introduces a race window).
    return Result.tryAsyncCatch(async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }, mapS3Error("delete", key)).toPromise();
  }

  async getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>> {
    if (!Number.isFinite(expiresInSec) || expiresInSec <= 0) {
      return Result.Err(
        new StorageUnknownError("expiresInSec must be a positive finite number", "getSignedUrl"),
      );
    }
    return Result.tryAsyncCatch(
      () =>
        getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
          expiresIn: Math.floor(expiresInSec),
        }),
      mapS3Error("getSignedUrl", key),
    ).toPromise();
  }
}
