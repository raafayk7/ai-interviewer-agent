# FP & Error Handling — Domain Layer

## Result in domain methods

Every fallible method returns `Result<T, DomainError>`. Never throw.

```typescript
// Good
approve(): Result<Campaign, DomainError> {
  if (this.status !== 'DRAFT') return Result.Err(new CannotApproveError())
  return Result.Ok(new Campaign({ ...this, status: 'APPROVED' }))
}

// Bad — never throw in domain
approve(): Campaign {
  if (this.status !== 'DRAFT') throw new Error('Cannot approve')
  return new Campaign({ ...this, status: 'APPROVED' })
}
```

## Option for nullable fields

```typescript
// Good
readonly name: Option<string>
serialize() { return { name: this.name.unwrapOr(null) } }
static fromSerialized(data) { return new Campaign({ name: Option.fromNullable(data.name) }) }

// Bad
readonly name: string | null
```

## Chaining in domain

Stay in the pipeline. Only extract at the boundary where the caller needs the value.

```typescript
// Good — pipeline
return validateSlug(data.slug)
  .flatMap(slug => checkSlugFormat(slug))
  .map(slug => new Campaign({ ...data, slug }))

// Bad — early extraction
const slugResult = validateSlug(data.slug)
if (slugResult.isErr()) return slugResult
const slug = slugResult.unwrap()
```

## Error types

| Layer | Error base | Examples |
|---|---|---|
| Domain | `DomainError` | `ValidationError`, `NotFoundError`, `ConflictError`, `BusinessRuleViolationError` |

- One class per error condition
- Descriptive `code` string (e.g., `CAMPAIGN_SLUG_REQUIRED`)
- No HTTP status codes
- User-friendly messages (no stack traces, no ORM jargon)
