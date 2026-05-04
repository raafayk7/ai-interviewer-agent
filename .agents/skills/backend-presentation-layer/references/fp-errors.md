# FP & Error Handling — Presentation Layer

## Result is consumed here, not propagated

The presentation layer is a boundary. `Result` from use cases is unwrapped here — not passed further.

```typescript
// Good — extract at boundary
const result = await this.createCampaignUseCase.execute(dto)
if (result.isErr()) throw this.mapServiceError(result.unwrapErr())
reply.status(201).send({ success: true, data: result.unwrap() })

// Bad — propagate Result or stay in pipeline
return this.createCampaignUseCase.execute(dto)
  .map(data => reply.send(data))  // Don't do this
```

## DTO validation error → BadRequestError

```typescript
const dtoResult = CreateCampaignDto.validate(request.body)
if (dtoResult.isErr()) throw this.mapDtoError(dtoResult.unwrapErr())

private mapDtoError(error: ValidationError): BadRequestError {
  const errors = error.zodError.issues.map(i => ({
    field: i.path.join('.') || 'unknown',
    message: i.message,
  }))
  return new BadRequestError('Validation failed', { errors })
}
```

## ServiceError → HttpError mapping

```typescript
private mapServiceError(error: ServiceError): HttpError {
  if (error instanceof ValidationError) return new BadRequestError(error.message)
  if (error instanceof NotFoundError)   return new NotFoundHttpError(error.message)
  if (error instanceof ConflictError)   return new ConflictHttpError(error.message)
  if (error instanceof ServiceUnavailableError) return new UnavailableError('Service unavailable')
  return new UnavailableError('An error occurred')  // safe default — never expose internals
}
```

Always map exhaustively. A missing case silently returns a 503 with no context — better to be explicit.

## Error type table

| ServiceError | HttpError | Status |
|---|---|---|
| `ValidationError` (domain) | `BadRequestError` | 400 |
| `NotFoundError` (domain) | `NotFoundHttpError` | 404 |
| `ConflictError` (domain) | `ConflictHttpError` | 409 |
| `BusinessRuleViolationError` | `BadRequestError` | 400 |
| `ServiceUnavailableError` | `UnavailableError` | 503 |
| `DtoValidationError` | `BadRequestError` | 400 |
| Any unmapped | `UnavailableError` | 503 |

## Throw, don't return

Controllers throw `HttpError`. The error handler middleware catches and formats. Never `reply.status(x).send(error)` manually for errors.

```typescript
// Good
throw new BadRequestError('Validation failed', { errors })

// Bad
reply.status(400).send({ error: 'Validation failed' })
```
