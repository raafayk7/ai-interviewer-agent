# ADR-005 Abstract File Storage via Port and Adapter

## Status

Accepted. Date: 2026-05-09.

## Context

The system stores recruiter-uploaded CVs and Job Descriptions (JDs) as PDF or image files. A later phase (Phase 10) will also store interview audio recordings for quality assurance and dispute resolution. During development the service must run without cloud credentials, yet the production deployment must be able to switch to S3 or Cloudflare R2 without rewriting any use case.

The Clean Architecture and FP discipline formalised in ADR-001 already mandates port/adapter separation and the `Result<T, E>` error shape throughout the backend. This ADR specifies what the storage port looks like, names the initial development adapter, and records why the alternatives were not chosen.

The port shape and adapter strategy are documented in `docs/ARCHITECTURE.md` §4.7 ("File Storage Abstraction", lines 244-267). The port interface and its error hierarchy were scaffolded in Phase 1 and already exist at `packages/application/src/ports/storage/file-storage.port.ts` (lines 1-10) and `packages/application/src/ports/storage/storage-error.ts` (lines 1-21); see also `docs/progress/phase-1.md` lines 369-384.

## Decision

Define a single application-layer port `IFileStorageService` at `packages/application/src/ports/storage/file-storage.port.ts` with four operations:

```typescript
interface IFileStorageService {
  upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>>;
  download(key: string): Promise<Result<Buffer, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
  getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>>;
}
```

The error hierarchy under `ServiceInfraError` is: `StorageError` (abstract base) extended by `StorageUnavailableError`, `StorageNotFoundError`, and `StorageUnknownError`. These are defined at `packages/application/src/ports/storage/storage-error.ts`.

The initial concrete adapter (Phase 2) is `LocalFileStorageService` in `apps/backend/src/infrastructure/storage/`. It writes to a configured directory on disk and serves via HMAC-signed URLs minted by the backend itself. Future production adapters (`S3FileStorageService`, `R2FileStorageService`) are drop-in replacements that satisfy the same port with no use-case changes.

Storage keys follow the pattern `{entity}/{id}/{filename}` (e.g., `interviews/abc-123/cv.pdf`).

`FileRef`, defined at `packages/domain/src/shared/value-objects/file-ref.ts`, is the single value object that crosses layer boundaries: the domain owns it, the application returns it from `upload`, and infrastructure constructs it.

Use cases (`UploadCandidateDocumentsUseCase` and future audio-storage use cases) depend on the port only. Imports of concrete adapters or cloud SDKs from `packages/application/` are prohibited.

## Alternatives Considered

### Alternative A: inject the AWS SDK client directly into use cases

Use cases could import `@aws-sdk/client-s3` directly and call `PutObjectCommand` / `GetObjectCommand` without a port abstraction.

Rejected because it leaks vendor concerns into the application layer, violating the boundary rule from ADR-001. Every test would need to either contact a real S3 bucket or stub the SDK at the SDK boundary, which is a moving target across SDK versions. With the port, tests inject an in-memory stub `IFileStorageService` and remain deterministic and fast.

### Alternative B: store files in PostgreSQL as bytea blobs

Files could be stored as binary large objects in the primary database.

Rejected for three reasons: (a) it bloats the primary database, increasing backup and restore time proportionally to accumulated file data; (b) interview audio recordings planned for Phase 10 will be tens of megabytes per session, making this approach untenable at scale; (c) object storage allows the backend to issue signed URLs and redirect the client directly to the file, avoiding streaming binary data through the Fastify process on every download. Storing small configuration blobs in Postgres remains acceptable but is not what this ADR covers.

### Alternative C: use the local filesystem directly from use cases and add a port later

Use cases could call Node's `fs/promises` directly now, with a plan to introduce the port before the first production deployment.

Rejected because "add the port later" means rewriting every callsite at migration time. Introducing the port on day one costs approximately 30 lines of code and converts the Phase-N adapter swap into a one-class change in `apps/backend/src/infrastructure/storage/` plus a wiring change in the composition root. No use-case code changes.

### Alternative D: adopt a third-party storage abstraction library (e.g., flydrive, file-storage.js)

An existing npm abstraction layer could provide adapters for local disk and S3 without writing them ourselves.

Rejected because: (a) the required operation set is four methods, which does not justify a third-party dependency; (b) adding dependencies for thin abstractions is net-negative given the maintenance surface; (c) existing libraries use exception-based error models and would require wrapping to produce the `Result<T, StorageError>` shape and our specific error subclasses.

### Alternative E: do nothing

Defer any storage decision until the first upload feature is ready.

Rejected because the port shape drives the use-case contract for `UploadCandidateDocumentsUseCase`, which was implemented in Phase 1. The port was required to exist before that use case was written.

## Consequences

**Benefits**

- Use cases are testable with an in-memory `IFileStorageService` stub. No filesystem or network access is required in unit tests.
- The production adapter swap (Local to S3 or R2) is a one-class change in `apps/backend/src/infrastructure/storage/` plus one wiring change in the composition root. Zero churn in `packages/application/`.
- The signed-URL contract is part of the port, so the same use-case shape works whether the development adapter mints HMAC-signed URLs from a local backend route or a production adapter returns a pre-signed S3 URL.
- `FileRef` is the single cross-layer reference shape. Domain owns it, infrastructure constructs it, application returns it. No separate mapper files.

**Trade-offs**

- The `getSignedUrl` operation has provider-specific semantics. `LocalFileStorageService` mints HMAC-signed tokens against a local backend route; S3 and R2 produce pre-signed object-storage URLs. The contract is identical (an opaque, time-limited URL string), but the local implementation requires a dedicated signing route and token validation middleware.
- Local storage on a single backend instance does not support horizontal scaling without sticky routing or a shared volume. This is acceptable for development and single-instance production; the S3 or R2 adapter swap is a gating item before any multi-instance deployment.

**Risks and mitigations**

- *Risk*: the HMAC-signed URL implementation in `LocalFileStorageService` could have a weak signing scheme that leaks access to arbitrary storage keys. *Mitigation*: the local adapter is restricted to the development environment via runtime configuration; production always requires a proper adapter. A note in the adapter's source file will enforce this.
- *Risk*: future contributors add a third operation (e.g., `copy`, `move`, `presignedPost`) to one adapter without adding it to the port, causing compilation errors or runtime divergence. *Mitigation*: TypeScript interface enforcement catches missing methods at compile time. The `backend-arch-validator` run after each layer addition will surface boundary violations.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: mandates the port/adapter pattern, the `Result<T, E>` return shape, the `ServiceInfraError` hierarchy that `StorageError` extends, and the prohibition on infrastructure imports in the application layer. This ADR is a direct application of those rules to the storage concern.

## References

- `docs/ARCHITECTURE.md` §4.7, lines 244-267: port shape, dev/prod adapter strategy, storage key pattern
- `packages/application/src/ports/storage/file-storage.port.ts`: port interface (4 methods, already implemented)
- `packages/application/src/ports/storage/storage-error.ts`: `StorageError` hierarchy under `ServiceInfraError`
- `packages/domain/src/shared/value-objects/file-ref.ts`: `FileRef` value object, the cross-layer reference shape
- `docs/progress/phase-1.md` lines 369-384: Phase 1 scaffolding of the port and error hierarchy
- `packages/application/src/ports/storage/index.ts`: public re-exports for the storage port

## Enforcement

The rule "application-layer files must not import AWS SDK or Node.js filesystem APIs directly" maps to a declarative import-pattern check, plus an LLM-judgeable check for the broader semantic rule that use cases may only call `IFileStorageService` methods (no concrete adapter references smuggled through dynamic `require` or barrel re-exports).

```json
{
  "forbid_import": [
    {
      "pattern": "from\\s+['\"](@aws-sdk/client-s3|aws-sdk|node:fs|node:fs/promises|fs|fs/promises)['\"]",
      "path_glob": "packages/application/src/**/*.ts",
      "message": "Application layer must depend on IFileStorageService, not on AWS SDK or fs (ADR-005)."
    },
    {
      "pattern": "from\\s+['\"](@aws-sdk/client-s3|aws-sdk)['\"]",
      "path_glob": "packages/domain/src/**/*.ts",
      "message": "Domain layer must not import AWS SDK (ADR-001 + ADR-005)."
    }
  ],
  "forbid_pattern": [],
  "require_pattern": [],
  "llm_judge": true
}
```
