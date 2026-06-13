# S3-Compatible File Storage Adapter Progress

## S3-Compatible File Storage Adapter Complete

This document records the S3-compatible file storage adapter changes for ai-interviewer-agent.

S3-Compatible File Storage Adapter goal:

- Add a generic S3-compatible adapter satisfying the existing `IFileStorageService` port, so uploaded documents can persist in object storage instead of local disk.
- Select the adapter at the composition root via `FILE_STORAGE_DRIVER` (`local` | `s3`), keeping `LocalFileStorageService` the default.
- Use one configurable-endpoint, path-style S3 code path that serves MinIO (local dev), Supabase Storage (staging), AWS S3, and Cloudflare R2.
- Unblock staging deployment on Render free tier, which has no persistent disk.

Plan source: `.claude/plan/s3-file-storage-adapter.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-036](../adr/ADR-036-s3-compatible-file-storage-adapter-selectable-via-file-storage-driver.md) — add `S3FileStorageService`, selectable via `FILE_STORAGE_DRIVER`, realizing ADR-005's anticipated drop-in S3 adapter (Status: Proposed).
- [ADR-005](../adr/ADR-005-abstract-file-storage-via-port-adapter.md) — the `IFileStorageService` port, `StorageError` hierarchy, and `{entity}/{id}/{filename}` key scheme this adapter conforms to.

---

## Summary

Added `S3FileStorageService` (infrastructure layer) implementing all four `IFileStorageService` methods against `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, mirroring `LocalFileStorageService` for the `StorageError` shapes, the `fromEnv` Result-returning constructor convention, and the `Result.tryAsyncCatch(...).flatMap(...).toPromise()` chain. A new `fileStorageFromEnv` factory selects the driver from `FILE_STORAGE_DRIVER` and returns the `IFileStorageService` port; the three document-storage composition roots were switched to it, with `options.storage` widened from the concrete class to the port. No domain or application source changed — the port, error hierarchy, and `FileRef` already existed. `turbo.json` `globalEnv` was extended with the storage env vars so the test-only `S3_TEST_*` reads pass the `turbo/no-undeclared-env-vars` lint rule and turbo caches correctly on driver/runtime config.

Explicitly **not** included in this work:

- No changes to `apps/backend/src/app.ts` and no rate-limiting (owned by a parallel session).
- No edits to the root `docker-compose.yml` or the `apps/backend/.env.example` storage block (both finalized upstream).
- No R2 adapter and no Supabase-specific client — the generic S3 path covers them via env config; R2 is a deferred future env-flip.
- ADR-036 left at Status: Proposed (not self-accepted).

## Implementation Notes

- **Idempotent delete divergence.** S3 `DeleteObject` does not 404 on a missing key, so `S3FileStorageService.delete` returns `Ok` for a missing key, whereas `LocalFileStorageService.delete` returns `StorageNotFoundError`. This is deliberate and documented in the adapter source; strict parity would require a `HeadObjectCommand` precheck (extra round trip + race) and no caller depends on the difference.
- **`getSignedUrl` is a true presigned URL.** Unlike the local adapter (HMAC token against a backend route), the S3 driver returns a presigned GET URL via `@aws-sdk/s3-request-presigner` honoring `expiresInSec` — matching ADR-005's "opaque, time-limited URL string" contract.
- **`forcePathStyle: true`** is required for MinIO and Supabase (virtual-host addressing is not served); parsed from `S3_FORCE_PATH_STYLE` via `=== "true" || === "1"`.
- **`__testables` export** exposes `mapS3Error` / `isNotFound` / `isUnavailable` / `parseForcePathStyle` so the error-mapping branches get ungated unit coverage without a live S3 endpoint.

---

## Files Touched

### 1. `apps/backend/src/infrastructure/services/s3-file-storage.service.ts`

What changed:
- New `S3FileStorageService implements IFileStorageService` with `S3FileStorageConfig` (endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle) and a single `S3Client` built in the constructor.
- `static fromEnv(env): Result<S3FileStorageService, Error>` validates `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (each missing var → `Result.Err` naming it) and parses `S3_FORCE_PATH_STYLE`.
- `upload` (`PutObjectCommand` → `FileRef.create`), `download` (`GetObjectCommand` → `transformToByteArray` → `Buffer`), `delete` (`DeleteObjectCommand`, idempotent), `getSignedUrl` (`GetObjectCommand` + presigner, positive-finite expiry guard).
- `mapS3Error` translates SDK errors to the existing `StorageNotFoundError` (`NoSuchKey`/`NotFound`/404), `StorageUnavailableError` (credential + network codes), and `StorageUnknownError` (catch-all).

Why:
- Realizes ADR-005's anticipated drop-in S3 adapter against the unchanged port, so use cases need no modification and the SDK stays confined to the infrastructure layer.

Impact:
- Provides object-storage persistence for recruiter/candidate document upload + extract use cases; one code path serves MinIO/Supabase/AWS/R2.

### 2. `apps/backend/src/infrastructure/services/file-storage.factory.ts`

What changed:
- New `fileStorageFromEnv(env): Result<IFileStorageService, Error>` keyed on `FILE_STORAGE_DRIVER` (default `"local"`); `s3` → `S3FileStorageService.fromEnv`, `local` → `LocalFileStorageService.fromEnv`, unknown driver → `Result.Err`.
- `FileStorageDriver` type exported.

Why:
- Centralizes driver selection behind the `IFileStorageService` port so composition roots depend on the abstraction, not a concrete adapter (dependency inversion at the composition boundary).

Impact:
- Single switch point for all storage wiring; adding a driver later is a one-case change here.

### 3. `apps/backend/src/infrastructure/services/index.ts`

What changed:
- Barrel now re-exports `S3FileStorageService` + `S3FileStorageConfig` and `fileStorageFromEnv` + `FileStorageDriver`.

Why:
- Keeps the single import surface (`../infrastructure/services/index.js`) used by composition.

Impact:
- Composition files import the factory from one place; existing `LocalFileStorageService` export untouched.

### 4. `apps/backend/src/composition/recruiter-document.composition.ts`

What changed:
- Swapped `LocalFileStorageService.fromEnv(env)` → `fileStorageFromEnv(env)` and the import accordingly.

Why:
- Routes recruiter document upload/extract through the driver-selectable port while preserving the existing boot-failure guard.

Impact:
- `FILE_STORAGE_DRIVER=s3` now switches this controller's storage with no other change.

### 5. `apps/backend/src/composition/upload-candidate-documents.composition.ts`

What changed:
- Swapped to `fileStorageFromEnv`; widened `options.storage?: LocalFileStorageService` → `IFileStorageService`; generalized the boot-failure message.

Why:
- The override escape hatch and the env path must both accept any port implementation (real adapter or test double).

Impact:
- Callers/tests can inject any `IFileStorageService`; env-driven boot picks the driver.

### 6. `apps/backend/src/composition/extract-candidate-documents.composition.ts`

What changed:
- Same as #5 — `fileStorageFromEnv`, `options.storage` widened to `IFileStorageService`, message generalized.

Why:
- Consistent port-based wiring for the extract use case.

Impact:
- Driver selection applies uniformly across all three document-storage compositions.

### 7. `apps/backend/package.json`

What changed:
- Added dependencies `@aws-sdk/client-s3` `^3.1068.0` and `@aws-sdk/s3-request-presigner` `^3.1068.0`.

Why:
- The S3 adapter and presigned-URL generation require them; both are ESM-compatible with the backend's `"type": "module"`.

Impact:
- New runtime dependency, confined to infrastructure per ADR-005's enforcement (forbidden in application/domain).

### 8. `turbo.json`

What changed:
- Added `FILE_STORAGE_DRIVER`, `FILE_STORAGE_ROOT`, `FILE_STORAGE_SIGNING_SECRET`, the six `S3_*` runtime vars, and the six `S3_TEST_*` vars to `globalEnv`.

Why:
- The test file reads `S3_TEST_*` from `process.env`, which trips `turbo/no-undeclared-env-vars` under `--max-warnings 0`; declaring them also makes turbo's cache key correctly account for storage driver/runtime config.

Impact:
- Lint passes on the new files; turbo caching stays correct across driver changes.

### 9. `apps/backend/src/infrastructure/services/s3-file-storage.service.test.ts`

What changed:
- Ungated unit tests: `fromEnv` Ok + per-missing-var (`it.each`), `mapS3Error` branches (NotFound/404/credential/network/unknown), `parseForcePathStyle` table, `getSignedUrl` non-positive/non-finite guard.
- MinIO integration tests gated behind `describe.skipIf(!S3_TEST_ENDPOINT)`: upload→FileRef, download roundtrip, missing-key→`StorageNotFoundError`, idempotent delete, fetchable presigned URL. Unique `s3-it/<ts>-<uuid>` key prefix per run with `afterAll` cleanup.

Why:
- Covers every error path without external infra (unit), and verifies real S3 semantics against MinIO when available — skipping cleanly in CI where MinIO is absent (mirrors the `TEST_DATABASE_URL`-gated Drizzle tests).

Impact:
- Adapter behavior is regression-guarded; integration suite opts in with a single `S3_TEST_ENDPOINT=http://localhost:9000`.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Full backend suite incl. MinIO integration (infra up: MinIO :9000, test Postgres :54329)
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
S3_TEST_ENDPOINT=http://localhost:9000 \
  pnpm --filter backend exec vitest run src/infrastructure/services/s3-file-storage.service.test.ts

TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
S3_TEST_ENDPOINT=http://localhost:9000 \
  pnpm turbo run test --filter=backend

pnpm --filter backend exec eslint <created/modified files>
```

Results:

- backend tests (full suite): **341 passed, 5 skipped** (the 5 skipped are the MinIO integration cases under `turbo run`, which strips undeclared per-task env; they run green via direct `vitest`)
- S3 adapter test file: **26 passed** (21 ungated unit + 5 MinIO integration, verified executing against live MinIO)
- type-check passed for `@repo/domain`, `@repo/application`, `backend`
- eslint: **0 warnings/errors** on all created/modified files

Architecture checks (`/backend-arch-validator infrastructure`):
- AWS SDK imported only under `apps/backend/src/infrastructure/**`; composition depends on `IFileStorageService`, never the concrete adapter; no infrastructure→presentation imports.
- No `try/catch`; all four async chains end with `.toPromise()`; the single `throw` in `download` is contained inside the `Result.tryAsyncCatch` callback and mapped via `mapS3Error`.

---

## Code Review

`backend-code-reviewer` returned **PASS** on first pass over all created/modified files (adapter, factory, barrel, three compositions, test file).

Findings confirmed clean: package/layer boundaries (SDK confined to infrastructure; port-based composition), `@carbonteq/fp` correctness (`.toPromise()` terminators, contained escape-hatch `throw`, `Result.Err` short-circuit in `getSignedUrl` guard), error hierarchy (`StorageNotFoundError`/`StorageUnavailableError`/`StorageUnknownError` used correctly; `FileRef.create` error wrapped to `StorageUnknownError`), port conformance (all four signatures + `fromEnv` shape match the local adapter), composition correctness (`options.storage` widening to the port is safe; unknown-driver branch returns `Result.Err` with `Result` as a value import), and test completeness (every error path covered; integration cleanly gated; `unwrap`/`unwrapErr` each guarded by a matching `isOk`/`isErr` assertion in the same test).

Two optional, non-blocking style notes were raised (a `forcePathStyle` comment wording nuance; the idempotent-delete integration test bundling remove + re-delete assertions as facets of one documented contract) — neither required a change.

**PASS** — backend suite 341 passed / 5 skipped; S3 test file 26 passed.

---

## Notes

- ADR-036 is Status: **Proposed** — flip to Accepted only after human approval. Its Enforcement block reaffirms ADR-005's `forbid_import` of the AWS SDK in `packages/application`/`packages/domain` (now that the SDK is a real dependency) and adds an `llm_judge` rule for composition-root storage-selection discipline.
- Staging readiness: set `FILE_STORAGE_DRIVER=s3` plus the six `S3_*` vars (Supabase Storage S3 endpoint + credentials, `S3_FORCE_PATH_STYLE=true`). Switching to Cloudflare R2 later is an env change only — no code change.
- The `pnpm-lock.yaml` change is from adding the two AWS SDK packages.
