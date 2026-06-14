# Phase 2 Progress

## Phase 2 Complete

This document records all Phase 2 changes for the **AI interviewer** monorepo, scoped to persistence, repository plumbing, local file storage, observability bootstrap, and the full test suite.

Phase 2 goal:

- add Drizzle/Postgres schema for the `Interview` and `Report` aggregate roots
- generate the initial migration
- implement Drizzle repositories for the existing domain repository ports
- implement a local disk-backed file storage adapter for the existing application storage port
- wire a minimal Langfuse/OpenTelemetry bootstrap into backend startup
- stand up a disposable test Postgres and full integration test suite

Plan source: `.claude/plan/phase-2-persistence-and-storage.md`  
Architecture context: `docs/ARCHITECTURE.md`

---

## Summary

All batches completed:

- **Batch A:** Drizzle schema for `interviews` and `reports`
- **Batch B:** initial migration generated with `drizzle-kit`
- **Batch C:** repository error hierarchy, Postgres error translator, and Drizzle repository implementations
- **Batch D:** `LocalFileStorageService` with path traversal protection and HMAC signed URLs
- **Batch E:** OTel/Langfuse bootstrap, initialized before app import with graceful shutdown
- **Batch F:** disposable test Postgres (`docker-compose.test.yml`) and `test-db.ts` DB lifecycle helper
- **Batch G:** 29 integration and unit tests across all three infrastructure components (8 interview repo, 7 report repo, 14 local storage)
- **Batch H:** migration applied against test DB, full test suite green (182 tests total)

---

## Files Touched

### 1. `apps/backend/src/infrastructure/persistence/schema/interviews.ts`

- added the `interviews` table with scalar and JSONB columns mirroring `Interview.serialize()`
- used `timestamp(..., { mode: "date", withTimezone: true })` for Date round-tripping
- stored `interviewPlan`, `transcript`, `jdFileRef`, and `cvFileRef` as JSONB

### 2. `apps/backend/src/infrastructure/persistence/schema/reports.ts`

- added the `reports` table with JSONB arrays for topic scores, strengths, concerns, and follow-up questions
- added `reports.interview_id -> interviews.id` FK with `ON DELETE CASCADE`

### 3. `apps/backend/src/infrastructure/persistence/schema/index.ts`

- re-exported the new schema tables for Drizzle and the backend DB client

### 4. `apps/backend/drizzle/0000_tan_luminals.sql`

- generated the initial SQL migration for the two tables and FK
- Drizzle journal and snapshot generated under `apps/backend/drizzle/meta/`

### 5. `apps/backend/src/infrastructure/repositories/errors/repository-error.ts`

- added infrastructure-only repository errors: `RepositoryConnectionError`, `RepositoryConflictError`, `RepositoryNotFoundError`, `RepositoryUnknownError`

### 6. `apps/backend/src/infrastructure/repositories/errors/translate-pg-error.ts`

- added SQLSTATE translation for conflict and connection failures
- **bug fixed during Batch G:** Drizzle wraps raw postgres driver errors in `DrizzleQueryError`; the SQLSTATE code lives on `error.cause`, not the outer error. Added `extractPgError()` to unwrap one level before SQLSTATE dispatch so `23505`/`23503` violations correctly produce `RepositoryConflictError`

### 7. `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.ts`

- implemented `IInterviewRepository`
- upsert on `save` via `onConflictDoUpdate`
- returns `Option.None` for missing query results
- serializes through `Interview.serialize()` and hydrates through `Interview.fromSerialized()`

### 8. `apps/backend/src/infrastructure/repositories/drizzle-report.repository.ts`

- implemented `IReportRepository`
- supports save, find by report ID, and find by interview ID
- serializes/hydrates only through the `Report` aggregate API

### 9. `apps/backend/src/infrastructure/repositories/index.ts`

- repository layer barrel exports

### 10. `apps/backend/src/infrastructure/services/local-file-storage.service.ts`

- implemented `IFileStorageService`
- writes files under a configured local root with `mkdir -p` on upload
- prevents path traversal via `safeResolve`
- maps filesystem errors to `StorageError` subclasses
- generates HMAC-signed URLs; exposes `verify(...)` for the future Phase 7 file route
- `fromEnv()` static constructor returns `Result` for composition-root wiring

### 11. `apps/backend/src/infrastructure/services/index.ts`

- services barrel export

### 12. `apps/backend/src/infrastructure/observability/otel.ts`

- added `initOtel()`; skips setup when Langfuse env vars are missing
- starts `NodeSDK` with `LangfuseSpanProcessor` when vars are present
- exposes idempotent shutdown handle

### 13. `apps/backend/src/main.ts`

- initializes OTel before dynamically importing the Fastify app
- adds SIGTERM/SIGINT shutdown handling
- shuts down OTel on startup failure and graceful exit

### 14. `apps/backend/docker-compose.test.yml`

- disposable Postgres 16 on port `54329` with `tmpfs` data volume
- healthcheck wired so `up -d` only resolves when Postgres is ready

### 15. `apps/backend/src/infrastructure/persistence/__test-helpers__/test-db.ts`

- `getTestDb()` — connects, runs migrations, caches client
- `truncateAll(db)` — wipes both tables between tests using `sql.raw(...)`
- `closeTestDb()` — closes pool; called in `afterAll`

### 16. `apps/backend/src/infrastructure/repositories/drizzle-interview.repository.test.ts`

- 8 integration tests covering: save/upsert, findById None, listByRecruiter, delete, JSONB round-trip, unique-violation → `RepositoryConflictError`

### 17. `apps/backend/src/infrastructure/repositories/drizzle-report.repository.test.ts`

- 7 integration tests covering: save/upsert, findById None, findByInterviewId, JSONB round-trip, FK violation → `RepositoryConflictError`

### 18. `apps/backend/src/infrastructure/services/local-file-storage.service.test.ts`

- 14 unit/filesystem tests covering: upload, nested dirs, path traversal rejection, download, missing key, delete, signed URL generation, `verify` (valid/expired/tampered), `fromEnv` (missing vars, both present)

### 19. `apps/backend/vitest.config.ts`

- added `fileParallelism: false` — prevents `TRUNCATE TABLE` deadlocks when the two DB integration test files run concurrently against the shared Postgres instance

### 20. `apps/backend/.env`

- added `TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test`

### 21. `packages/application/src/use-cases/documents/upload-candidate-documents.use-case.test.ts`

- added assertions before indexing mock upload calls; used non-null assertions for TypeScript (minor Phase-1 typing issue blocking Phase-2 type-check)

---

## Verification

Commands run and passing:

```bash
# Schema generation
DATABASE_URL=postgres://placeholder pnpm --filter backend db:generate

# Type-check (all layers)
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Migration against test DB
DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm --filter backend db:migrate

# Tests
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test pnpm turbo run test --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
```

Results:

- full type-check passed for domain, application, and backend
- domain tests: **116 passed**
- application tests: **37 passed**
- backend tests: **29 passed** (3 files)
- **total: 182 tests, all green**

Architecture checks:

- touched infrastructure files have no presentation imports
- Drizzle imports stay inside infrastructure
- all repository and filesystem calls wrapped in `Result.tryAsyncCatch`
- no `try/catch` or direct throws in domain/application/infrastructure execution paths

---

## Code Review

Reviewed by `backend-code-reviewer` agent on 2026-05-09. **Result: PASS**

All checks passed with no violations:

- Layer boundaries clean — infra imports only `@repo/domain` + `@repo/application`; `RepositoryError` never leaks into application
- FP discipline — every async path uses `Result.tryAsyncCatch(...).map/.flatMap.toPromise()`; no throws, no try/catch, no `T | null` in production code
- Error hierarchy — SQLSTATE codes map correctly (23xxx → `ConflictError`, 08xxx → `ConnectionError`); `mapFsError` maps ENOENT/EACCES/EPERM correctly
- Entity (de)serialization — repos use `entity.serialize()` / `Entity.fromSerialized()`; identity helpers stay in-file
- Security — `safeResolve` traversal protection correct and tested; HMAC verify uses `timingSafeEqual`
- Tests — all `unwrap()` calls guarded by `isOk()`/`isSome()` assertions; integration tests hit real Postgres; storage tests use tmpdir

Non-blocking style notes (no action required before Phase 3):

1. `db as never` cast in repo tests — worth widening `Database` type so `TestDatabase` satisfies it structurally
2. Dynamic `await import(...)` inside test bodies — cleaner to import `Result` and `translatePgError` at the top of each test file
3. `as StorageError` widening cast in `local-file-storage.service.ts:124` — can declare the union type directly
4. `main().catch(...)` — if `otel.shutdown()` rejects, the rejection is unhandled; wrapping in `.catch(() => undefined)` would harden shutdown

---

## How to run tests

```bash
# Start test DB (keep running between sessions)
docker compose -f apps/backend/docker-compose.test.yml up -d

# Run backend integration + unit tests
TEST_DATABASE_URL=postgres://test:test@localhost:54329/ai_interviewer_test \
  pnpm turbo run test --filter=backend

# Tear down after done
docker compose -f apps/backend/docker-compose.test.yml down -v
```
