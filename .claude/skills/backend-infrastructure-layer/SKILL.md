---
name: backend-infrastructure-layer
description: Write, review, or reason about infrastructure layer code — repository implementations, DAOs, Drizzle schema/adapters, infrastructure services (email, storage, external APIs), event handlers, and error translation. Use this skill when the user asks to implement a repository, write a DAO query, add an infrastructure service, handle a domain event, or wire up persistence. Trigger proactively whenever the user is touching apps/backend/src/infrastructure/.
user-invocable: true
version: 1.0.0
---

# Infrastructure Layer (`apps/backend`)

The infrastructure layer **adapts** external concerns (database, file system, external APIs) to domain interfaces. It implements what the domain defines but never decides business outcomes.

**Location:** `apps/backend/src/infrastructure/`
**Imports from:** `@repo/domain`, `@repo/application`, `drizzle-orm`, `postgres`
**Never imports from:** `apps/backend/src/presentation/`

**One question to ask at every decision point:** "Is this a technical concern or a business concern?" If business, it belongs in domain or application.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Repository implementations | Implement `IXxxRepository` interfaces from `@repo/domain` |
| DAOs | Complex queries: joins, raw SQL, aggregations |
| Drizzle schema | Table definitions, relations |
| Infrastructure services | External APIs, file storage, cache, email |
| Event handlers | Side effects triggered by domain events |
| Error translators | Drizzle/pg errors → typed `RepositoryError` |

---

## Drizzle schema

Define tables in `src/infrastructure/persistence/schema/`. Each aggregate gets its own file.

```typescript
import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core'

export const campaignStatusEnum = pgEnum('campaign_status', ['DRAFT', 'APPROVED', 'REJECTED'])

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  status: campaignStatusEnum('status').notNull().default('DRAFT'),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CampaignRow = typeof campaigns.$inferSelect
export type NewCampaignRow = typeof campaigns.$inferInsert
```

---

## Repository implementation

Repositories bridge `@repo/domain` interfaces to Drizzle queries.

```typescript
import { eq } from 'drizzle-orm'
import { Result, Option } from '@carbonteq/fp'
import type { ICampaignRepository } from '@repo/domain'
import { Campaign } from '@repo/domain'
import type { Database } from '../persistence/db.js'
import { campaigns } from '../persistence/schema/index.js'

export class CampaignRepository implements ICampaignRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Result<Option<Campaign>, Error>> {
    return Result.tryAsyncCatch(
      async () => {
        const row = await this.db.query.campaigns.findFirst({
          where: eq(campaigns.id, id),
        })
        return row ? Option.Some(this.toDomain(row)) : Option.None()
      },
      (e) => this.mapDbError(e, 'findById'),
    ).toPromise()
  }

  async findBySlug(slug: string): Promise<Result<Option<Campaign>, Error>> {
    return Result.tryAsyncCatch(
      async () => {
        const row = await this.db.query.campaigns.findFirst({
          where: eq(campaigns.slug, slug),
        })
        return row ? Option.Some(this.toDomain(row)) : Option.None()
      },
      (e) => this.mapDbError(e, 'findBySlug'),
    ).toPromise()
  }

  async save(campaign: Campaign): Promise<Result<Campaign, Error>> {
    return Result.tryAsyncCatch(
      async () => {
        const data = campaign.serialize()
        const [row] = await this.db
          .insert(campaigns)
          .values({
            id: data.id,
            slug: data.slug,
            status: data.status,
            name: data.name,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          })
          .onConflictDoUpdate({
            target: campaigns.id,
            set: {
              slug: data.slug,
              status: data.status,
              name: data.name,
              updatedAt: data.updatedAt,
            },
          })
          .returning()
        return this.toDomain(row!)
      },
      (e) => this.mapDbError(e, 'save'),
    ).toPromise()
  }

  async delete(id: string): Promise<Result<void, Error>> {
    return Result.tryAsyncCatch(
      async () => {
        await this.db.delete(campaigns).where(eq(campaigns.id, id))
      },
      (e) => this.mapDbError(e, 'delete'),
    ).toPromise()
  }

  private toDomain(row: typeof campaigns.$inferSelect): Campaign {
    return Campaign.fromSerialized({
      id: row.id,
      slug: row.slug,
      status: row.status,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

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
}
```

### Repository responsibilities

1. Load aggregates via `Entity.fromSerialized()`
2. Persist via `entity.serialize()`
3. Publish domain events after save (if event bus is wired)
4. Translate Drizzle/pg errors to typed `RepositoryError`

### What repositories must not do

- Business logic (`if entity.status === 'APPROVED'`)
- Complex multi-table queries — use a DAO instead
- DTO conversion — return domain entities, not DTOs
- Cross-aggregate operations

---

## DAO pattern

Use DAOs for complex queries that would bloat a repository.

```typescript
import { sql } from 'drizzle-orm'

export class CampaignDAO implements ICampaignDAO {
  constructor(private readonly db: Database) {}

  async findCampaignsWithPendingEntities(
    criteria: GetPendingCampaignsDto
  ): Promise<Result<{ campaigns: Campaign[]; total: number }, Error>> {
    return Result.tryAsyncCatch(
      async () => {
        const rows = await this.db
          .select()
          .from(campaigns)
          .where(eq(campaigns.status, 'PENDING'))
          .limit(criteria.pageSize)
          .offset((criteria.page - 1) * criteria.pageSize)

        const [countResult] = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(campaigns)
          .where(eq(campaigns.status, 'PENDING'))

        return {
          campaigns: rows.map(row => Campaign.fromSerialized(row)),
          total: countResult!.count,
        }
      },
      (e) => this.mapDbError(e, 'findCampaignsWithPendingEntities'),
    ).toPromise()
  }
}
```

DAOs must not contain: business rules, authorization logic, DTO conversion.

---

## Infrastructure service pattern

```typescript
export interface IEmailService {
  sendEmail(to: string, subject: string, body: string): Promise<Result<void, Error>>
}

export class EmailService implements IEmailService {
  async sendEmail(to: string, subject: string, body: string): Promise<Result<void, Error>> {
    return Result.tryAsyncCatch(
      async () => { await this.client.send({ to, subject, body }) },
      (e) => new EmailServiceError(String(e), 'sendEmail'),
    ).toPromise()
  }
}
```

---

## Event handler pattern

Event handlers are infrastructure side effects. Errors are best-effort — log and continue, do not throw.

```typescript
export class DashboardItemSubmittedHandler
  implements IDomainEventHandler<DashboardItemSubmittedForReviewEvent>
{
  constructor(
    private readonly emailService: IEmailService,
    private readonly logger: ILogger,
  ) {}

  async handle(event: DashboardItemSubmittedForReviewEvent): Promise<void> {
    const result = await this.emailService.sendEmail(
      event.adminEmail,
      'New submission',
      `Entity ${event.entityId} needs review`,
    )

    if (result.isErr()) {
      this.logger.error('Email failed — continuing', result.unwrapErr())
      // Do not throw — side effects are best-effort
    }
  }
}
```

---

## Error translation

Drizzle/pg errors must be translated to typed `RepositoryError` before leaving the infrastructure layer.

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

Error types: `DbConnectionError`, `DbTimeoutError`, `DbConstraintViolationError`, `DbUnknownError`

---

## What is forbidden

- Importing from `apps/backend/src/presentation/`
- Business logic in repositories or DAOs
- `try/catch` blocks — use `Result.tryAsyncCatch()`
- Returning raw Drizzle/pg errors — always map to `RepositoryError`
- Throwing exceptions — use `Result.Err`
- DTO conversion in repositories (return domain entities)
- Cross-aggregate operations in a single repository

---

## File layout

```
apps/backend/src/infrastructure/
├── persistence/
│   ├── db.ts                          ← Drizzle client
│   ├── schema/
│   │   ├── index.ts                   ← barrel export for all tables
│   │   └── campaigns.ts
│   └── daos/
│       └── campaign/
│           ├── campaign.dao.interface.ts
│           └── campaign.dao.ts
├── repositories/
│   └── campaign.repository.ts
├── services/
│   ├── email/email.service.ts
│   └── storage/storage.service.ts
├── events/
│   └── dashboard-item-submitted.handler.ts
└── errors/
    └── repository-error.ts
```

---

## FP & error handling

See `references/fp-errors.md` for `Result.tryAsyncCatch`, error translation patterns, and best-effort side effect handling.
