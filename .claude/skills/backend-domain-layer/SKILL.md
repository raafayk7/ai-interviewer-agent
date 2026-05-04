---
name: backend-domain-layer
description: Write, review, or reason about domain layer code — entities, value objects, domain errors, domain events, domain services, and repository interfaces. Use this skill when the user asks to create or modify an entity, add a domain method, define a value object, write a domain error, design a repository interface, or check if something belongs in the domain. Trigger proactively whenever the user is touching packages/domain/.
user-invocable: true
version: 1.0.0
---

# Domain Layer (`@repo/domain`)

The domain layer is pure business logic. It has **zero dependencies** on infrastructure, frameworks, or HTTP. It defines what the business *is*, not how the system stores or transmits it.

**Package:** `packages/domain/` — published as `@repo/domain`
**Imports from:** nothing outside this package (only `@carbonteq/fp`, `@carbonteq/refined-type`)

**One question to ask at every decision point:** "Would this rule exist without a database or API?" If no, it does not belong here.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Entities | Aggregate roots with identity and business behaviour |
| Value Objects | Immutable types that are equal by value, not identity |
| Domain Errors | Typed business rule violations (no HTTP codes) |
| Domain Events | Immutable facts about what happened |
| Domain Services | Stateless logic that spans multiple aggregates |
| Repository Interfaces | Port definitions only — no implementation |

---

## Entity structure

Every entity follows this exact shape. Do not deviate.

```typescript
// 1. Interface
export interface ICampaign extends IEntity {
  readonly slug: string
  readonly status: CampaignStatus
  readonly name: Option<string>
}

// 2. Serialized type (plain objects for persistence)
export type SerializedCampaign = SimpleSerialized<
  Omit<ICampaign, 'id' | 'name'> & { id: string; name: string | null }
>

// 3. Entity class
export class Campaign extends BaseEntity implements ICampaign {
  readonly slug: string
  readonly status: CampaignStatus
  readonly name: Option<string>

  private constructor(data: ICampaign) {
    super()
    Object.assign(this, data)
  }

  // Factory — validates and creates new aggregate
  static create(data: CreateEntity<ICampaign>): Result<Campaign, DomainError> {
    if (!data.slug) return Result.Err(new CampaignSlugRequiredError())
    return Result.Ok(new Campaign({ ...data, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() }))
  }

  // Reconstitution — trusted, no validation
  static fromSerialized(data: SerializedCampaign): Campaign {
    return new Campaign({
      id: data.id,
      slug: data.slug,
      status: data.status,
      name: Option.fromNullable(data.name),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    })
  }

  // Serialization for persistence
  serialize(): SerializedCampaign {
    return {
      ...this._serialize(),
      slug: this.slug,
      status: this.status,
      name: this.name.unwrapOr(null),
    }
  }

  // Domain method — returns new instance (immutable)
  approve(): Result<Campaign, DomainError> {
    if (this.status !== CampaignStatus.DRAFT) {
      return Result.Err(new CannotApproveNonDraftCampaignError())
    }
    return Result.Ok(new Campaign({ ...this, status: CampaignStatus.APPROVED, updatedAt: new Date() }))
  }
}
```

**Immutability is mandatory.** All properties are `readonly`. Methods return new instances, never mutate `this`.

---

## Value objects

Use `@carbonteq/refined-type` for single-value branded types:

```typescript
export const EmailType = createRefinedType('Email', z.string().email())
export type Email = typeof EmailType.$infer

export const Email = {
  create(value: string): Email { return EmailType.create(value).unwrap() },
  fromTrusted(value: string): Email { return value as Email },
}
```

Use classes for multi-field value objects. Same pattern as entities: private constructor, `create()` returning `Result`, `fromSerialized()` trusted.

---

## Domain errors

Each error is a specific class. No generic `Error`. No HTTP status codes.

```typescript
export class CampaignSlugRequiredError extends ValidationError {
  readonly code = 'CAMPAIGN_SLUG_REQUIRED'
  constructor() { super('Campaign slug is required') }
}

export class CannotApproveNonDraftCampaignError extends BusinessRuleViolationError {
  readonly code = 'CANNOT_APPROVE_NON_DRAFT_CAMPAIGN'
  constructor() { super('Only draft campaigns can be approved') }
}
```

Error hierarchy: `DomainError → ValidationError | NotFoundError | ConflictError | BusinessRuleViolationError`

---

## Domain events

Events are pure data — no methods, no side effects.

```typescript
export class CampaignApprovedEvent extends DomainEvent {
  constructor(
    readonly campaignId: string,
    readonly approvedBy: string,
  ) {
    super(campaignId)
  }
}
```

Entities accumulate events via `addDomainEvent()`. Repositories publish them after save.

---

## Repository interfaces

Interfaces only. No implementation details, no ORM types, no transaction handles.

```typescript
export interface ICampaignRepository {
  findById(id: string): Promise<Result<Option<Campaign>, Error>>
  findBySlug(slug: string): Promise<Result<Option<Campaign>, Error>>
  save(campaign: Campaign): Promise<Result<Campaign, Error>>
  delete(id: string): Promise<Result<void, Error>>
}
```

Complex queries (joins, pagination, aggregations) do not belong here — they belong in Query Services in the application layer.

---

## Domain services

Use a domain service only when logic spans multiple aggregates and does not belong to either.

```typescript
export class CampaignApprovalService {
  canApprove(campaign: Campaign, user: User): Result<boolean, DomainError> {
    if (campaign.status !== CampaignStatus.DRAFT) {
      return Result.Err(new CannotApproveNonDraftCampaignError())
    }
    return Result.Ok(true)
  }
}
```

Domain services must not access repositories or external services.

---

## What is forbidden

- Importing from `@repo/application`, `apps/backend`, or any infrastructure/presentation code
- Importing `drizzle-orm`, `fastify`, `zod` (except for refined types via `@carbonteq/refined-type`)
- `throw` statements in entity or domain service methods — use `Result.Err`
- `T | null` or `T | undefined` — use `Option<T>`
- Mutable entity properties
- HTTP status codes anywhere in this layer
- Business logic in repository interfaces

---

## File layout

```
packages/domain/src/
├── entities/
│   └── campaign/
│       ├── campaign.entity.ts
│       ├── campaign.repository.ts     ← interface only
│       ├── errors/campaign.errors.ts
│       └── events/campaign-approved.event.ts
├── shared/
│   ├── base.entity.ts
│   ├── domain-error.ts
│   └── domain-event.ts
└── index.ts                           ← barrel export
```

---

## FP & error handling

See `references/fp-errors.md` for `Result`/`Option` operator reference and error mapping rules.
