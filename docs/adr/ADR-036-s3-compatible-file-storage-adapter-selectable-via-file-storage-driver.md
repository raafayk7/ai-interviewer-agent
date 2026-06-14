# ADR-036 S3-Compatible File Storage Adapter Selectable via FILE_STORAGE_DRIVER

## Status

Proposed. Date: 2026-06-14.

## Context

ADR-005 (Accepted 2026-05-09) established `IFileStorageService` as an application-layer port and `LocalFileStorageService` as the initial adapter, explicitly flagging that "the S3 or R2 adapter swap is a gating item before any multi-instance deployment." That ADR anticipated the production adapter would be a "drop-in replacement" requiring only "one class in `apps/backend/src/infrastructure/` plus a wiring change in the composition root."

The forcing function has now arrived: **Render's free tier has no persistent disk.** The `LocalFileStorageService` writes to a directory on disk; uploaded CVs and Job Description PDFs would vanish on every restart or redeploy. Object storage is required before any deployed environment can function correctly.

The project's staging target is Supabase, which the codebase already leans on for Postgres and Auth. Supabase Storage exposes an S3-compatible API at a configurable endpoint (e.g., `https://<project-ref>.storage.supabase.co/storage/v1/s3`). MinIO, an S3-compatible object store, can be run locally under Docker (see the `dev` profile in the root `docker-compose.yml`: `http://localhost:9000`, bucket `interview-documents`, credentials `minioadmin/minioadmin`) to give local/dev parity with the staging store using an identical code path.

Both MinIO and Supabase Storage require `forcePathStyle: true`; virtual-host-style addressing (`bucket.host`) is not served by either. A generic S3 client with a configurable endpoint, region, and credentials is therefore the single abstraction that covers MinIO, Supabase Storage, AWS S3, and Cloudflare R2 without any per-provider branching.

ADR-005 also left the driver-selection mechanism unspecified ("a wiring change in the composition root"). This ADR specifies that mechanism: the `FILE_STORAGE_DRIVER` environment variable, defaulting to `"local"`, selects the adapter at boot time via a factory function at the composition root. This keeps existing local dev workflows and the local HMAC-signed URL route entirely unchanged.

Note: ADR-005 references the adapter directory as `apps/backend/src/infrastructure/storage/` but the actual codebase location is `apps/backend/src/infrastructure/services/` (where `LocalFileStorageService` already lives). This ADR cites the real path.

## Decision

Add a generic S3-compatible infrastructure adapter `S3FileStorageService` at `apps/backend/src/infrastructure/services/s3-file-storage.service.ts` that fully satisfies the `IFileStorageService` port. Introduce a driver-selection factory function `fileStorageFromEnv` at `apps/backend/src/infrastructure/services/file-storage.factory.ts` that returns `Result<IFileStorageService, Error>` keyed on the `FILE_STORAGE_DRIVER` environment variable (`"local"` or `"s3"`), defaulting to `"local"`. All three composition roots that construct a file storage service are updated to call `fileStorageFromEnv` instead of `LocalFileStorageService.fromEnv` directly.

The `S3FileStorageService` uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. It is constructed via a static `fromEnv(env)` method that mirrors the convention already established by `LocalFileStorageService.fromEnv`, returning `Result<S3FileStorageService, Error>` and failing fast with a named error message for each missing required variable. The client is configured with `forcePathStyle: true` (controlled by `S3_FORCE_PATH_STYLE`) so the single adapter serves MinIO, Supabase Storage, AWS S3, and Cloudflare R2 with no per-provider code branching. A provider switch is a pure environment variable change; no code changes are required.

All four port methods (`upload`, `download`, `delete`, `getSignedUrl`) are implemented via `Result.tryAsyncCatch` wrapping the SDK call, with a `mapS3Error` helper that translates SDK exceptions to the existing `StorageNotFoundError`, `StorageUnavailableError`, and `StorageUnknownError` variants defined in ADR-005. No new error types are introduced.

`getSignedUrl` returns a presigned GET URL via `@aws-sdk/s3-request-presigner`, honoring `expiresInSec`. This fulfills ADR-005's "opaque time-limited URL" contract without a backend HMAC route or middleware, offloading file serving from the Fastify process for all deployed environments.

One deliberate behavioral divergence from `LocalFileStorageService` is documented explicitly: S3 `DeleteObject` is idempotent (deleting a non-existent key succeeds with no 404), so `S3FileStorageService.delete` returns `Ok` for a missing key, whereas `LocalFileStorageService.delete` returns `StorageNotFoundError`. This is the correct cloud-native contract. Strict parity would require a `HeadObjectCommand` precheck, which adds a network round trip and introduces a race window. Because no caller in the application layer depends on delete-of-missing erroring, the divergence is accepted.

The scope of this ADR is confined to the infrastructure and composition layers. `packages/application` and `packages/domain` are unchanged. The `IFileStorageService` port, `StorageError` hierarchy, `FileRef` value object, and all use-case signatures remain exactly as specified in ADR-005.

## Alternatives Considered

### Alternative A: Cloudflare R2 as the staging object store

R2 offers zero egress fees and is S3-compatible. It was considered as the staging storage target alongside Supabase Storage.

Deferred, not rejected outright. R2's cost advantage (zero egress) is not a present concern at MVP and staging scale. The project already standardizes on Supabase for Postgres, Auth, and now Storage; adding R2 introduces a second storage vendor for no current benefit. Because `S3FileStorageService` accepts a fully configurable endpoint and credentials, switching to R2 later is a pure environment variable change (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). No code changes are required to support R2. The decision to use R2 can be revisited when egress costs are observed to be material.

### Alternative B: Supabase storage-js native client

Supabase publishes `@supabase/storage-js`, a dedicated SDK for Supabase Storage. It could have been wrapped to satisfy `IFileStorageService`.

Rejected for two reasons. First, coupling to the Supabase SDK would lock the storage layer to one vendor, breaking local MinIO parity: `storage-js` targets the Supabase Storage REST API, not the generic S3 API that MinIO serves. Two separate code paths (one for MinIO, one for Supabase) would be required, defeating the purpose of a single generic adapter. Second, `storage-js` uses an exception-based error model, which would require wrapping to produce the `Result<T, StorageError>` shape. The S3 API is the portable interface that MinIO, Supabase Storage, AWS S3, and R2 all speak natively; one S3 adapter serves all four without branching. This is the same reasoning ADR-005 Alternative D applied when rejecting third-party storage abstraction libraries.

### Alternative C: separate concrete adapter class per provider (MinIO, Supabase, AWS, R2)

A dedicated adapter class for each provider was considered, with composition root selection between them.

Rejected as needless duplication. Each provider speaks the S3 API; the only per-provider difference is the endpoint URL, region, credentials, and path-style flag, all of which are environment-configurable in a single `S3FileStorageService`. Four separate classes would share 95% of their code, creating four surfaces for bugs and divergence with no architectural benefit.

### Alternative D: keep LocalFileStorageService in all environments

The simplest change is no change: continue using local disk storage even in staging.

Rejected. Render's free tier has no persistent disk. Uploaded CVs and JDs would be lost on every restart or redeploy. The service would be non-functional in any deployed environment. This is the "do nothing" alternative and is not viable once any deployment target is introduced.

## Consequences

**Benefits**

- Unblocks staging deployment on Render free tier. Object storage replaces the unavailable persistent disk, making the upload and document-extraction workflows functional in any deployed environment.
- One generic S3 code path covers MinIO (local dev), Supabase Storage (staging), AWS S3, and Cloudflare R2. Switching providers is a pure environment variable change with no code changes required. ADR-005's "drop-in replacement" promise is realized with zero churn in `packages/application`.
- Local and staging environments share the same adapter and code path via MinIO. Behavioral divergence between local and deployed environments is limited to the documented `delete` idempotency difference, which no caller depends on.
- The default `FILE_STORAGE_DRIVER` value is `"local"`, so existing local development workflows, the local HMAC-signed URL route, and the local integration tests are entirely unaffected for developers who do not set the variable.
- `getSignedUrl` in the `s3` driver returns a true presigned object-storage URL, offloading file serving from the Fastify process directly to the object store for all non-local deployments. This is the benefit ADR-005 described: "the backend to issue signed URLs and redirect the client directly to the file, avoiding streaming binary data through the Fastify process on every download."
- Boot-time misconfiguration fails fast: `fileStorageFromEnv` returns `Result.Err` naming the missing variable; the composition root throws immediately rather than failing on the first storage operation.
- Integration tests for `S3FileStorageService` are gated on `S3_TEST_ENDPOINT` (clean skip when MinIO is absent), mirroring the `TEST_DATABASE_URL`-gated Drizzle integration test pattern already established in the project.

**Trade-offs**

- New runtime dependency on `@aws-sdk/client-s3` `^3.1068.0` and `@aws-sdk/s3-request-presigner` `^3.1068.0` in `apps/backend`. These are confined to `apps/backend/src/infrastructure/` per ADR-005's enforcement; they must not appear in `packages/application` or `packages/domain`.
- `delete` semantics diverge between drivers: the `s3` driver returns `Ok` when deleting a non-existent key (S3 `DeleteObject` is idempotent); the `local` driver returns `StorageNotFoundError`. The divergence is documented in the adapter source at `apps/backend/src/infrastructure/services/s3-file-storage.service.ts` lines 169-177 and is acceptable because no caller in the application layer depends on delete-of-missing erroring. If strict parity is later required, a `HeadObjectCommand` precheck must be added to `S3FileStorageService.delete` (one extra round trip per delete, plus a small race window between head and delete).
- Operators must provision an object-storage bucket and credentials for any non-local deployment. Six environment variables are required for the `s3` driver: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optionally `S3_FORCE_PATH_STYLE`. These are documented in `apps/backend/.env.example` lines 52-65.
- `forcePathStyle` must be set correctly per provider (`true` for MinIO and Supabase Storage; AWS S3 default is `false`). An incorrect value causes virtual-host-style addressing failures that surface as `StorageUnavailableError` at runtime.

**Risks and mitigations**

- *Risk*: a future composition root hardcodes `LocalFileStorageService.fromEnv` or `S3FileStorageService.fromEnv` directly, bypassing the driver-selection factory and making a driver switch a code change instead of a config change. *Mitigation*: `llm_judge: true` in the Enforcement block flags this pattern at commit time. Composition roots that inject the port type `IFileStorageService` (rather than a concrete class) are an additional deterrent.
- *Risk*: the AWS SDK is imported in `packages/application` or `packages/domain`, violating the layer boundary. *Mitigation*: declarative `forbid_import` rules in the Enforcement block (reaffirming ADR-005's existing rules now that the SDK is a real dependency) and the pre-commit hook catch this at commit time.
- *Risk*: credentials or the endpoint URL are misconfigured in a deployment, causing all storage operations to fail at runtime. *Mitigation*: `fromEnv` returns `Result.Err` for missing required variables, and the composition root throws on boot, making the misconfiguration visible at startup rather than on the first upload.
- *Risk*: `S3_FORCE_PATH_STYLE` is left `false` (default) when deploying to MinIO or Supabase Storage, causing silent addressing failures. *Mitigation*: the `apps/backend/.env.example` sets `S3_FORCE_PATH_STYLE=true` and includes a comment explaining which providers require it.

## Related Decisions

- **ADR-005 (Abstract File Storage via Port and Adapter)**: this ADR extends ADR-005 by providing the anticipated `S3FileStorageService` adapter and specifying the `FILE_STORAGE_DRIVER` selection mechanism that ADR-005 left as "a wiring change in the composition root." ADR-005 remains the authoritative decision for the port interface (`IFileStorageService`), the error hierarchy (`StorageError` and its subclasses), the storage key scheme (`{entity}/{id}/{filename}`), and the prohibition on cloud SDK imports in the application layer. This ADR does not supersede ADR-005.
- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: the adapter obeys the `Result<T, StorageError>` contract throughout, uses `Result.tryAsyncCatch` to wrap throwing SDK calls, and confines the AWS SDK to the infrastructure layer as mandated by ADR-001's layer boundary rules.

## References

- `docs/adr/ADR-005-abstract-file-storage-via-port-adapter.md`: the port, error hierarchy, storage key scheme, and the explicit anticipation of a production S3 adapter
- `packages/application/src/ports/storage/file-storage.port.ts`: `IFileStorageService` interface (4 methods: `upload`, `download`, `delete`, `getSignedUrl`)
- `packages/application/src/ports/storage/storage-error.ts`: `StorageError` abstract base and `StorageNotFoundError`, `StorageUnavailableError`, `StorageUnknownError` variants
- `apps/backend/src/infrastructure/services/local-file-storage.service.ts`: the existing local adapter and the `fromEnv` convention this ADR mirrors
- `apps/backend/src/infrastructure/services/s3-file-storage.service.ts`: the new adapter (lines 90-193 for the service class; lines 169-177 for the documented `delete` idempotency divergence)
- `apps/backend/src/infrastructure/services/file-storage.factory.ts`: the driver-selection factory (`fileStorageFromEnv`)
- `apps/backend/src/infrastructure/services/s3-file-storage.service.test.ts`: unit tests (lines 8-111, no MinIO required) and MinIO integration tests gated on `S3_TEST_ENDPOINT` (lines 117-189)
- `apps/backend/src/composition/recruiter-document.composition.ts`: composition root updated to call `fileStorageFromEnv`
- `apps/backend/src/composition/upload-candidate-documents.composition.ts`: composition root updated; `options.storage` widened to `IFileStorageService`
- `apps/backend/src/composition/extract-candidate-documents.composition.ts`: composition root updated; `options.storage` widened to `IFileStorageService`
- `apps/backend/.env.example` lines 40-65: `FILE_STORAGE_DRIVER` and the seven S3 env vars with inline comments for MinIO and Supabase Storage configurations
- `apps/backend/package.json`: `@aws-sdk/client-s3 ^3.1068.0`, `@aws-sdk/s3-request-presigner ^3.1068.0`
- `.claude/plan/s3-file-storage-adapter.md`: the implementation plan that preceded this work

## Enforcement

The AWS SDK must remain confined to `apps/backend/src/infrastructure/**`. The declarative rules below reaffirm ADR-005's existing import boundary now that the SDK is a real transitive dependency. The semantic rule for composition-root discipline (use `fileStorageFromEnv`, not a hardcoded concrete adapter class) requires LLM judgment because it cannot be expressed as a simple regex without producing false positives against the `fileStorageFromEnv` implementation itself.

```json
{
  "forbid_import": [
    {
      "pattern": "from\\s+['\"]@aws-sdk/client-s3['\"]",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must not import @aws-sdk/client-s3. Depend on IFileStorageService only (ADR-005 + ADR-036)."
    },
    {
      "pattern": "from\\s+['\"]@aws-sdk/s3-request-presigner['\"]",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must not import @aws-sdk/s3-request-presigner. Depend on IFileStorageService only (ADR-005 + ADR-036)."
    },
    {
      "pattern": "from\\s+['\"]@aws-sdk/client-s3['\"]",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain layer must not import @aws-sdk/client-s3 (ADR-001 + ADR-036)."
    },
    {
      "pattern": "from\\s+['\"]@aws-sdk/s3-request-presigner['\"]",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain layer must not import @aws-sdk/s3-request-presigner (ADR-001 + ADR-036)."
    }
  ],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```

The `llm_judge: true` flag covers the semantic rule: composition roots that construct a file storage service must call `fileStorageFromEnv` (or accept an injected `IFileStorageService` for test overrides), not instantiate `LocalFileStorageService` or `S3FileStorageService` directly when a driver selection is intended. This cannot be expressed as a regex without false-positives against the factory implementation itself.
