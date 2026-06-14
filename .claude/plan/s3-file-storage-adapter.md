# Plan: S3-Compatible File Storage Adapter (driver-selectable behind IFileStorageService)

> Generated: 2026-06-14
> Slug: s3-file-storage-adapter

## Summary

Add an `S3FileStorageService` infrastructure adapter that satisfies the existing
`IFileStorageService` port using `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, so the
backend can persist uploaded documents in S3-compatible object storage (MinIO locally, S3/R2 in
staging where Render free has no persistent disk). The adapter is selected at the composition root
via a new `fileStorageFromEnv(env): Result<IFileStorageService, Error>` factory keyed on
`FILE_STORAGE_DRIVER` (`local` | `s3`), with `local` remaining the default. All three existing
composition sites are switched to the factory and their `options.storage` override types are widened
from `LocalFileStorageService` to `IFileStorageService`. This realizes ADR-005's anticipated
drop-in S3 satisfier and stays within its enforcement boundary (SDK only under
`apps/backend/src/infrastructure/**`).

## Layers touched

| Layer          | Package / Location                  | Scope                                                                 |
| -------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Domain         | `packages/domain/`                  | none                                                                  |
| Application    | `packages/application/`             | none (reuses existing port + StorageError hierarchy, already exported) |
| Infrastructure | `apps/backend/src/infrastructure/`  | new `S3FileStorageService`, `fileStorageFromEnv` factory, barrel export, deps |
| Presentation   | `apps/backend/src/presentation/`    | none                                                                  |
| Composition    | `apps/backend/src/composition/`     | three sites switched to factory; `options.storage` widened to `IFileStorageService` |

No domain or application source changes. The port (`IFileStorageService`), `StorageError`,
`StorageUnavailableError`, `StorageNotFoundError`, `StorageUnknownError`, and `FileRef` are all
already exported from `@repo/application` / `@repo/domain` and are confirmed present.

---

## Implementation steps

### Step 1 — package.json: add AWS SDK deps

**File:** `apps/backend/package.json` (MODIFY)

**What:** Add the two AWS SDK packages the adapter needs. Backend is ESM (`"type": "module"`); both
packages are ESM-compatible. No version pin beyond caret.

**Code (intent — add to `dependencies`):**
```jsonc
{
  "dependencies": {
    // ...existing...
    "@aws-sdk/client-s3": "^3.901.0",
    "@aws-sdk/s3-request-presigner": "^3.901.0"
  }
}
```

Install with (pin the latest resolved 3.x at implementation time):
```bash
pnpm --filter backend add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**Invariant check:** SDK imported ONLY from `apps/backend/src/infrastructure/**` (ADR-005
enforcement: `@aws-sdk/client-s3` forbidden in `packages/application` and `packages/domain`).

---

### Step 2 — Infrastructure: create the S3 adapter

**File:** `apps/backend/src/infrastructure/services/s3-file-storage.service.ts` (CREATE)

**What:** `S3FileStorageService implements IFileStorageService`. Validated config produced by
`fromEnv` (returns `Result<_, Error>` mirroring `LocalFileStorageService.fromEnv`); constructor
takes the already-validated `S3FileStorageConfig` and builds a single `S3Client`. Every method uses
`Result.tryAsyncCatch(..., mapS3Error(op, key))` and ends with `.toPromise()`.

**Delete semantics decision (RECOMMENDED):** S3 `DeleteObject` is idempotent and does NOT 404 on a
missing key, whereas `LocalFileStorageService.delete` returns `StorageNotFoundError` for a missing
key. Matching local parity would require a `HeadObjectCommand` precheck on every delete (extra round
trip + race window). **Recommendation: accept S3's idempotent-success semantics for `delete`** — it
is the correct cloud-native contract and no current caller depends on delete-of-missing being an
error. Document this divergence in a code comment. (A `HeadObject` precheck is described below as the
alternative if strict parity is later mandated.)

**Code (full skeleton — compilable intent):**
```typescript
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
  const status = e.$metadata?.httpStatusCode;
  return status === 404;
};

const isUnavailable = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: string; code?: string };
  const name = e.name ?? "";
  const code = e.code ?? "";
  // Credentials / auth
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

// ─── service ──────────────────────────────────────────────────────────────────

export class S3FileStorageService implements IFileStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3FileStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle, // required for MinIO / path-style endpoints
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
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) {
        // Treat an empty body as not-found for caller parity.
        throw Object.assign(new Error("empty body"), { name: "NoSuchKey" });
      }
      // SDK v3 node stream → bytes. transformToByteArray is on the SdkStream mixin.
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    }, mapS3Error("download", key)).toPromise();
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    // NOTE: S3 DeleteObject is idempotent — deleting a non-existent key succeeds (no 404).
    // We deliberately accept idempotent success here, diverging from LocalFileStorageService
    // which returns StorageNotFoundError. See plan "Delete semantics decision". To enforce
    // strict parity, prepend a HeadObjectCommand precheck that throws NoSuchKey when absent.
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
```

**Invariant checks:**
- No `throw`/`try/catch` in the public surface except inside the `Result.tryAsyncCatch` callback
  (the documented FP escape hatch for wrapping throwing libs). The `throw` inside the `download`
  callback is intentional — it is captured by `tryAsyncCatch` and mapped via `mapS3Error`.
- Return types match the port exactly: `upload → Promise<Result<FileRef, StorageError>>`,
  `download → Promise<Result<Buffer, StorageError>>`, `delete → Promise<Result<void, StorageError>>`,
  `getSignedUrl → Promise<Result<string, StorageError>>`.
- All async chains end with `.toPromise()`.
- RepositoryError-equivalent (`StorageError`) never escapes — it IS the port's declared error type
  (a `ServiceInfraError` subtype), so it is consumable by the use case as part of `ServiceError`.
- ADR-005: SDK import confined to infrastructure.

---

### Step 3 — Infrastructure: create the driver-selectable factory

**File:** `apps/backend/src/infrastructure/services/file-storage.factory.ts` (CREATE)

**What:** `fileStorageFromEnv(env): Result<IFileStorageService, Error>` reads
`env["FILE_STORAGE_DRIVER"]` (default `"local"`) and delegates to the correct `fromEnv`. Returns the
port type so all composition sites depend on the abstraction, not the concrete class. Placed in
`services/` (alongside the adapters it wires) rather than `composition/`, because it is reusable
infra wiring and keeps composition files thin.

**Code:**
```typescript
import type { Result } from "@carbonteq/fp";
import type { IFileStorageService } from "@repo/application";
import { LocalFileStorageService } from "./local-file-storage.service.js";
import { S3FileStorageService } from "./s3-file-storage.service.js";

export type FileStorageDriver = "local" | "s3";

/**
 * Selects the file-storage adapter at the composition root based on
 * FILE_STORAGE_DRIVER (default "local"). Both branches already return
 * Result<_, Error>; the union widens to the IFileStorageService port.
 */
export function fileStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<IFileStorageService, Error> {
  const driver = (env["FILE_STORAGE_DRIVER"] ?? "local") as FileStorageDriver;

  switch (driver) {
    case "s3":
      return S3FileStorageService.fromEnv(env);
    case "local":
      return LocalFileStorageService.fromEnv(env);
    default:
      // Unknown driver is a boot misconfiguration — surface explicitly.
      return LocalFileStorageService.fromEnv(env).flatMap(() =>
        // eslint-disable-next-line no-unreachable -- defensive: narrowed above
        LocalFileStorageService.fromEnv(env),
      );
  }
}
```

Note on the `default` branch: the cleaner form is to return an explicit error for an unknown driver.
Prefer this exact body instead of the placeholder above:
```typescript
import { Result } from "@carbonteq/fp"; // value import (not type-only) for Result.Err

// inside switch:
    default:
      return Result.Err(
        new Error(`Unknown FILE_STORAGE_DRIVER: "${driver}" (expected "local" or "s3")`),
      );
```
> Implementation note: change the `import type { Result }` to a value import `import { Result }` so
> `Result.Err` is callable in the default branch. The two recognized drivers (`local`, `s3`) both
> return `Result<IFileStorageService, Error>` already, so the union type is correct.

**Invariant check:** factory return type is the PORT (`IFileStorageService`), preserving dependency
inversion at the composition boundary. Imports stay within infrastructure.

---

### Step 4 — Infrastructure barrel export

**File:** `apps/backend/src/infrastructure/services/index.ts` (MODIFY)

**What:** Re-export the new adapter, its config type, and the factory.

**Code (diff intent):**
```typescript
export { LocalFileStorageService, type LocalFileStorageConfig } from "./local-file-storage.service.js";
export { S3FileStorageService, type S3FileStorageConfig } from "./s3-file-storage.service.js";
export { fileStorageFromEnv, type FileStorageDriver } from "./file-storage.factory.js";
export * from "./gemini/index.js";
export * from "./deepgram/index.js";
export * from "./elevenlabs/index.js";
```

**Invariant check:** barrel keeps the single import surface used by composition (`../infrastructure/services/index.js`).

---

### Step 5 — Composition: recruiter-document

**File:** `apps/backend/src/composition/recruiter-document.composition.ts` (MODIFY)

**What:** Switch `LocalFileStorageService.fromEnv(env)` → `fileStorageFromEnv(env)`. No
`options.storage` override here (this file has none), so only the import + call change.

**Code (diff intent):**
```typescript
import {
  GeminiDocumentExtractionService,
  geminiProviderFromEnv,
  fileStorageFromEnv, // was: LocalFileStorageService
} from "../infrastructure/services/index.js";

// ...
  const env = options.env ?? process.env;
  const storage = fileStorageFromEnv(env); // was: LocalFileStorageService.fromEnv(env)
  if (storage.isErr()) {
    throw new Error(`Boot failed: ${storage.unwrapErr().message}`);
  }
  // storageService: IFileStorageService — consumed by both use cases unchanged
  const storageService = storage.unwrap();
```

**Invariant check:** `UploadCandidateDocumentsUseCase` / `ExtractCandidateDocumentsUseCase` accept
the port; passing an `IFileStorageService` is type-compatible.

---

### Step 6 — Composition: upload-candidate-documents

**File:** `apps/backend/src/composition/upload-candidate-documents.composition.ts` (MODIFY)

**What:** Widen `options.storage` from `LocalFileStorageService` to `IFileStorageService`; switch
factory call. Override escape-hatch logic is unchanged.

**Code (diff intent):**
```typescript
import { UploadCandidateDocumentsUseCase, type IFileStorageService } from "@repo/application";
import { fileStorageFromEnv } from "../infrastructure/services/index.js";

export interface UploadCandidateDocumentsCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly storage?: IFileStorageService; // widened from LocalFileStorageService
}

// inside buildUploadCandidateDocumentsDeps:
  const storageResult =
    options.storage === undefined
      ? fileStorageFromEnv(options.env ?? process.env) // was LocalFileStorageService.fromEnv
      : undefined;
  // ...rest unchanged; error message text may stay or be generalized to "file storage"
```

**Invariant check:** `IFileStorageService` is exported from `@repo/application` (confirmed in
`local-file-storage.service.ts` import). Override now accepts any port implementation (real adapter
or test double).

---

### Step 7 — Composition: extract-candidate-documents

**File:** `apps/backend/src/composition/extract-candidate-documents.composition.ts` (MODIFY)

**What:** Same widening + factory switch as Step 6.

**Code (diff intent):**
```typescript
import {
  ExtractCandidateDocumentsUseCase,
  type DocumentExtractorFactory,
  type IFileStorageService,
} from "@repo/application";
import {
  geminiProviderFromEnv,
  GeminiDocumentExtractionService,
} from "../infrastructure/services/gemini/index.js";
import { fileStorageFromEnv } from "../infrastructure/services/index.js";

export interface ExtractCandidateDocumentsCompositionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly storage?: IFileStorageService; // widened
}

// inside builder:
  const storageResult =
    options.storage === undefined
      ? fileStorageFromEnv(env) // was LocalFileStorageService.fromEnv(env)
      : undefined;
```

**Invariant check:** same as Step 6.

---

### Step 8 — Tests: S3 adapter

**File:** `apps/backend/src/infrastructure/services/s3-file-storage.service.test.ts` (CREATE)

**What:** Unit tests (no MinIO needed) for `fromEnv` validation + error-mapping; gated integration
tests (`describe.skipIf`) for real round-trips against MinIO.

**Gating env names (PROPOSED — exact):**
- `S3_TEST_ENDPOINT` — primary gate. When unset, all integration tests skip.
- `S3_TEST_REGION` (default `us-east-1`), `S3_TEST_BUCKET` (default `interview-documents`),
  `S3_TEST_ACCESS_KEY_ID` (default `minioadmin`), `S3_TEST_SECRET_ACCESS_KEY` (default `minioadmin`),
  `S3_TEST_FORCE_PATH_STYLE` (default `true`). All `S3_TEST_*` fall back to the documented MinIO
  defaults so a developer only needs to export `S3_TEST_ENDPOINT=http://localhost:9000` to opt in.
- Use a unique key prefix per run: `s3-it/${Date.now()}-${randomUUID().slice(0, 8)}/...` to avoid
  collisions across reruns and parallel files.

**Bucket setup:** Per task, the MinIO bucket `interview-documents` already exists. The integration
test will NOT attempt to create the bucket; it uploads, downloads, deletes within the unique prefix.
(If a future CI needs auto-provisioning, add a `CreateBucketCommand` best-effort in `beforeAll`
swallowing `BucketAlreadyOwnedByYou`/`BucketAlreadyExists`.)

**Code (skeleton):**
```typescript
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { StorageNotFoundError } from "@repo/application";
import { S3FileStorageService } from "./s3-file-storage.service.js";

// ─── unit: fromEnv validation (no MinIO) ────────────────────────────────────────
describe("S3FileStorageService.fromEnv", () => {
  const base = {
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "interview-documents",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
    S3_FORCE_PATH_STYLE: "true",
  } satisfies NodeJS.ProcessEnv;

  it("returns Ok when all required vars present", () => {
    expect(S3FileStorageService.fromEnv(base).isOk()).toBe(true);
  });

  it.each([
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])("returns Err when %s missing", (missing) => {
    const env = { ...base } as Record<string, string>;
    delete env[missing];
    const result = S3FileStorageService.fromEnv(env);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toContain(missing);
  });
});

// ─── integration: MinIO round-trips (gated) ─────────────────────────────────────
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
  const prefix = `s3-it/${Date.now()}-${randomUUID().slice(0, 8)}`;
  const writtenKeys: string[] = [];

  afterAll(async () => {
    await Promise.all(writtenKeys.map((k) => service.delete(k)));
  });

  it("upload → returns FileRef with matching fields", async () => {
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

  it("download → returns the uploaded bytes", async () => {
    const key = `${prefix}/round.txt`;
    writtenKeys.push(key);
    const body = Buffer.from("round trip payload");
    await service.upload(body, key, "text/plain");
    const result = await service.download(key);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().equals(body)).toBe(true);
  });

  it("download missing key → StorageNotFoundError with .key", async () => {
    const key = `${prefix}/missing-${randomUUID()}.bin`;
    const result = await service.download(key);
    expect(result.isErr()).toBe(true);
    const err = result.unwrapErr();
    expect(err).toBeInstanceOf(StorageNotFoundError);
    expect((err as StorageNotFoundError).key).toBe(key);
  });

  it("delete → removes the object (idempotent on re-delete)", async () => {
    const key = `${prefix}/to-delete.txt`;
    await service.upload(Buffer.from("x"), key, "text/plain");
    expect((await service.delete(key)).isOk()).toBe(true);
    // download now 404s
    expect((await service.download(key)).isErr()).toBe(true);
    // re-delete succeeds (documented idempotent semantics)
    expect((await service.delete(key)).isOk()).toBe(true);
  });

  it("getSignedUrl → returns a fetchable presigned GET URL", async () => {
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

  it("getSignedUrl with non-positive expiry → StorageUnknownError", async () => {
    const result = await service.getSignedUrl(`${prefix}/x`, 0);
    expect(result.isErr()).toBe(true);
  });
});
```

> Optional: extract `mapS3Error`/`isNotFound`/`isUnavailable` for direct unit testing by exporting
> them from the module (e.g. `export const __testables = { mapS3Error, isNotFound, isUnavailable }`),
> or test mapping indirectly via the integration not-found case. Direct export gives ungated coverage
> of the Unavailable/Unknown branches without MinIO — RECOMMENDED for branch coverage targets.

**Invariant check:** unit tests need no external service; integration tests gated by
`S3_TEST_ENDPOINT`; unique prefix + `afterAll` cleanup prevents cross-run collisions.

---

## Pseudo-workflow (driver selection at boot — no HTTP path changed)

1. Backend boot calls a composition builder (e.g. `buildRecruiterDocumentDeps(options)`).
2. Builder resolves `env = options.env ?? process.env`.
3. Builder calls `fileStorageFromEnv(env)` → reads `env.FILE_STORAGE_DRIVER` (default `"local"`).
4. Factory delegates: `"s3"` → `S3FileStorageService.fromEnv(env)`; `"local"` →
   `LocalFileStorageService.fromEnv(env)`; unknown → `Result.Err`.
5. Each `fromEnv` validates required vars → `Result<IFileStorageService, Error>`.
6. Builder: `if (storage.isErr()) throw new Error("Boot failed: ...")`; else `storage.unwrap()`.
7. The unwrapped `IFileStorageService` is injected into the use case(s) — identical wiring as today.
8. At request time the use case calls `storage.upload/download/getSignedUrl(...)` →
   `Promise<Result<FileRef|Buffer|string, StorageError>>`; `StorageError` flows into the use case's
   `ServiceError` union and is mapped to HTTP at the controller boundary (unchanged).

## Entry points (dependency order, innermost first)

| #   | File                                                                          | Layer          | Operation | Purpose                                            |
| --- | ----------------------------------------------------------------------------- | -------------- | --------- | -------------------------------------------------- |
| 1   | `apps/backend/package.json`                                                   | infra deps     | MODIFY    | Add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| 2   | `apps/backend/src/infrastructure/services/s3-file-storage.service.ts`         | infrastructure | CREATE    | S3 adapter satisfying `IFileStorageService`        |
| 3   | `apps/backend/src/infrastructure/services/file-storage.factory.ts`            | infrastructure | CREATE    | `fileStorageFromEnv` driver selector → port type   |
| 4   | `apps/backend/src/infrastructure/services/index.ts`                           | infrastructure | MODIFY    | Barrel: export adapter + factory                   |
| 5   | `apps/backend/src/composition/recruiter-document.composition.ts`              | composition    | MODIFY    | Use factory                                        |
| 6   | `apps/backend/src/composition/upload-candidate-documents.composition.ts`      | composition    | MODIFY    | Use factory + widen `options.storage` to port      |
| 7   | `apps/backend/src/composition/extract-candidate-documents.composition.ts`     | composition    | MODIFY    | Use factory + widen `options.storage` to port      |
| 8   | `apps/backend/src/infrastructure/services/s3-file-storage.service.test.ts`    | infrastructure | CREATE    | Unit (fromEnv/mapping) + gated MinIO integration   |

## Verification commands

```bash
# 1. Type-check (factory return type + composition widening must be clean)
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# 2. Backend tests — unit S3 tests run ungated; MinIO integration runs only if S3_TEST_ENDPOINT set.
#    DB env is required because the backend test project includes Drizzle integration tests.
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm turbo run test --filter=backend

# 3. Full MinIO integration pass (start MinIO at :9000 with bucket interview-documents first):
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
S3_TEST_ENDPOINT=http://localhost:9000 \
  pnpm turbo run test --filter=backend

# 4. Architecture validation (boundaries + FP correctness for the new infra files)
/backend-arch-validator infrastructure

# 5. Final gate
#    Invoke backend-code-reviewer agent on all created/modified files, passing this plan path:
#    .claude/plan/s3-file-storage-adapter.md
```

## ADR note

ADR-005 (Accepted 2026-05-09, `docs/adr/ADR-005-abstract-file-storage-via-port-adapter.md`) already
anticipates `S3FileStorageService` as a drop-in port satisfier and its `getSignedUrl` presigned-GET
contract. A **new ADR realizing/extending ADR-005** (driver selection via `FILE_STORAGE_DRIVER`, the
idempotent-delete divergence decision, MinIO-for-local) should be authored **separately via the
`adr-generator` subagent** — do NOT write it as part of this implementation. The adapter MUST stay
within ADR-005's enforcement boundary: `@aws-sdk/client-s3` and `fs` imports remain forbidden in
`packages/application` and `packages/domain`; the SDK appears ONLY under
`apps/backend/src/infrastructure/**`. The pre-commit `adr-judge` hook will enforce this.

## Risk notes

- **Coordination — DO NOT TOUCH `apps/backend/src/app.ts`.** A parallel session is editing it for
  rate-limiting. This plan does not require any `app.ts` change; driver selection is entirely inside
  the composition builders. Keep edits confined to the eight files listed.
- **DO NOT modify the root `docker-compose.yml`** (untracked, owned elsewhere) or the
  `apps/backend/.env.example` storage block (already finalized, read-only per task).
- **`Result` import in the factory:** must be a value import (not `import type`) so `Result.Err` is
  callable in the unknown-driver default branch. Easy to get wrong.
- **`forcePathStyle` is mandatory for MinIO** — without it the SDK uses virtual-host-style addressing
  (`bucket.localhost`) which MinIO does not serve by default. `S3_FORCE_PATH_STYLE=true` is in the
  finalized `.env.example`; parse with `=== "true"` (or `"1"`), defaulting to `false` only when the
  driver is real S3/R2 with virtual-host addressing.
- **Stream-to-Buffer in `download`:** SDK v3 returns `response.Body` as an `SdkStream` with the
  `transformToByteArray()` mixin in Node. This is the supported API; avoid manual stream piping.
- **Error-mapping coverage:** `isUnavailable` enumerates known credential/network error names/codes.
  The catch-all returns `StorageUnknownError`, which is safe (never throws). Misclassifying a
  transient network error as Unknown vs Unavailable only affects diagnostics, not correctness.
- **Delete parity divergence** is deliberate and documented in code; if a future requirement mandates
  strict parity with `LocalFileStorageService.delete` (NotFound on missing), add a `HeadObjectCommand`
  precheck — but this costs an extra round trip per delete.
- **`@aws-sdk/*` are ESM-compatible**; backend is `"type": "module"`. No CJS interop shims needed.
```
