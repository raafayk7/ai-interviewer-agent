# FP & Error Handling — Application Layer

## Result in use cases

All use case `execute()` methods return `Promise<Result<T, ServiceError>>`. Never throw.

```typescript
// Good
async execute(request: CreateCampaignDto): Promise<Result<SerializedCampaign, ServiceError>> {
  const saveResult = await this.campaignRepository.save(campaign)
  if (saveResult.isErr()) return Result.Err(this.mapRepoError(saveResult.unwrapErr(), 'save'))
  return Result.Ok(saveResult.unwrap().serialize())
}

// Bad
async execute(request: CreateCampaignDto): Promise<SerializedCampaign> {
  try { ... } catch (e) { throw e }
}
```

## Pipeline pattern

Stay in the pipeline. Only extract (`isErr()` / `unwrap()`) when the next step needs the raw value.

```typescript
// Good — flat pipeline
return userRepository.findByEmail(email)
  .flatMap(opt => opt.toResult(new UserNotFoundError()))
  .flatMap(user => user.verify())
  .flatMap(user => userRepository.save(user))
  .map(user => user.serialize())
  .toPromise()

// Bad — manual extraction at each step
const r1 = await userRepository.findByEmail(email)
if (r1.isErr()) return r1
const opt = r1.unwrap()
if (opt.isNone()) return Result.Err(new UserNotFoundError())
```

## Parallel operations

```typescript
// All must succeed
const [r1, r2] = await Promise.all([repo1.find(), repo2.find()])
return Result.all(r1, r2).map(([v1, v2]) => ({ v1, v2 })).toPromise()
```

## Error mapping at boundary

```typescript
// Infrastructure error → ServiceInfraError (never leak raw RepositoryError)
private mapRepoError(error: Error, op: string): ServiceInfraError {
  if (error.message.includes('connection')) return new ServiceUnavailableError(op)
  return new ServiceUnknownError(error.message, op)
}

// Domain error → passes through unchanged
if (createResult.isErr()) return createResult  // DomainError passes through as ServiceError
```

## Error type table

| Source | Maps to | How |
|---|---|---|
| `DomainError` | `ServiceError` | Pass through — already `ServiceError` |
| `RepositoryError` | `ServiceInfraError` | `mapRepoError()` in use case |
| Raw `Error` | `ServiceUnknownError` | Wrap with `mapRepoError()` |

## Async chains

Always end async pipelines with `.toPromise()`.

```typescript
return Result.tryAsyncCatch(
  async () => await someThrowingOperation(),
  (e) => new ServiceUnknownError(String(e), 'operation')
).toPromise()
```
