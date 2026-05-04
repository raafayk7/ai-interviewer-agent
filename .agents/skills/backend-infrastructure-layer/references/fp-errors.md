# FP & Error Handling — Infrastructure Layer

## Wrapping throwing code

Never use `try/catch` in infrastructure code. Use `Result.tryAsyncCatch` instead.

```typescript
// Good
async findById(id: string): Promise<Result<Option<User>, Error>> {
  return Result.tryAsyncCatch(
    async () => {
      const row = await this.db.query.users.findFirst({
        where: eq(users.id, id),
      })
      return row ? Option.Some(User.fromSerialized(row)) : Option.None()
    },
    (e) => this.mapDbError(e, 'findById'),
  ).toPromise()
}

// Bad
async findById(id: string): Promise<Result<Option<User>, Error>> {
  try {
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    })
    return Result.Ok(row ? Option.Some(User.fromSerialized(row)) : Option.None())
  } catch (e) {
    return Result.Err(e)  // never return raw DB error
  }
}
```

## Error translation (mandatory)

Drizzle/pg errors must never escape the infrastructure layer as raw database errors.

```typescript
private mapDbError(error: unknown, operation: string): RepositoryError {
  if (!(error instanceof Error)) return new DbUnknownError('Unknown', operation, error)
  const msg = error.message
  if (msg.includes('connect')) return new DbConnectionError(msg, operation)
  if (msg.includes('unique') || msg.includes('duplicate')) {
    return new DbConstraintViolationError(msg, 'UNIQUE', operation)
  }
  if (msg.includes('timeout')) return new DbTimeoutError(msg, operation)
  return new DbUnknownError(msg, operation, error)
}
```

## Event handler errors are best-effort

```typescript
const result = await this.emailService.sendEmail(...)
if (result.isErr()) {
  this.logger.error('Side effect failed', result.unwrapErr())
  // Do not throw, do not re-throw, do not return Err — continue
}
```

## Error type table

| Source | Translates to |
|---|---|
| pg connection error | `DbConnectionError` |
| unique/duplicate constraint | `DbConstraintViolationError` |
| timeout error | `DbTimeoutError` |
| Any other DB error | `DbUnknownError` |

The application layer then maps `RepositoryError → ServiceInfraError`. Infrastructure layer never uses `ServiceError`.
