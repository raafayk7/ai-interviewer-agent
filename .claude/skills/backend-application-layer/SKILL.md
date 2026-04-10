---
name: backend-application-layer
description: Write, review, or reason about application layer code — use cases, DTOs, query services, and application services. Use this skill when the user asks to create a use case, add a DTO, write a query service, coordinate repositories, handle transactions, or check if orchestration logic is correct. Trigger proactively whenever the user is touching packages/application/.
version: 1.0.0
---

# Application Layer (`@repo/application`)

The application layer **orchestrates** — it coordinates domain logic and infrastructure services. It does not implement business rules and does not access infrastructure directly.

**Package:** `packages/application/` — published as `@repo/application`
**Imports from:** `@repo/domain`, `@carbonteq/fp`, `zod`
**Never imports from:** `apps/backend` (infrastructure or presentation)

**One question to ask at every decision point:** "Is this business logic or coordination?" If business logic, it belongs in the domain.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Use Cases | Orchestrate one business operation end-to-end |
| DTOs | Validate and type HTTP input/output |
| Query Services | Complex read operations that span multiple aggregates |
| Application Services | Cross-use-case coordination, transactions |

---

## Use case structure

Every use case follows this shape. Do not deviate.

```typescript
export class CreateCampaignUseCase extends UseCase<CreateCampaignDto, SerializedCampaign> {
  constructor(
    private readonly campaignRepository: ICampaignRepository,
    private readonly issuerRepository: IIssuerRepository,
    private readonly logger: ILogger,
  ) { super() }

  async execute(request: CreateCampaignDto): Promise<Result<SerializedCampaign, ServiceError>> {
    // 1. Validate input
    const slugResult = CampaignSlug.create(request.slug)
    if (slugResult.isErr()) return Result.Err(new CampaignSlugInvalidError())

    // 2. Load aggregates
    const issuerResult = await this.issuerRepository.findById(request.issuerId)
    if (issuerResult.isErr()) return Result.Err(this.mapRepoError(issuerResult.unwrapErr(), 'findById'))
    if (issuerResult.unwrap().isNone()) return Result.Err(new IssuerNotFoundError(request.issuerId))

    // 3. Call domain method
    const createResult = Campaign.create({ slug: slugResult.unwrap(), ... })
    if (createResult.isErr()) return createResult

    // 4. Persist
    const saveResult = await this.campaignRepository.save(createResult.unwrap())
    if (saveResult.isErr()) return Result.Err(this.mapRepoError(saveResult.unwrapErr(), 'save'))

    // 5. Return serialized result
    return Result.Ok(saveResult.unwrap().serialize())
  }

  private mapRepoError(error: Error, op: string): ServiceInfraError {
    return new ServiceUnknownError(error.message, op)
  }
}
```

### Use case responsibilities (in order)

1. Validate input (DTO → domain value objects)
2. Load aggregates (via repositories)
3. Check preconditions (entity existence, conflicts)
4. Call domain methods (entity behaviour, domain services)
5. Persist (save via repositories)
6. Return `Result<SerializedOutput, ServiceError>`

---

## DTO structure

DTOs live in the application layer. They validate format, not business rules.

```typescript
const CreateCampaignSchema = z.object({
  slug: z.string().min(1),
  name: z.string().optional(),
  issuerId: z.string().uuid(),
})

export class CreateCampaignDto extends BaseDto<z.infer<typeof CreateCampaignSchema>> {
  protected schema = CreateCampaignSchema

  static validate(input: unknown): Result<CreateCampaignDto, ValidationError> {
    return BaseDto.validate(CreateCampaignSchema, input)
      .map(data => Object.assign(new CreateCampaignDto(), data))
  }
}
```

DTOs must not contain: domain entity references, business logic, HTTP concerns.

---

## Query service structure

Use query services for reads that require joins, aggregations, or pagination. They use DAOs, not repositories.

```typescript
export class CampaignQueryService {
  constructor(
    private readonly campaignDAO: ICampaignDAO,
  ) {}

  async findPendingCampaigns(
    criteria: GetPendingCampaignsDto
  ): Promise<Result<PaginatedResult<CampaignDto>, ServiceError>> {
    const result = await this.campaignDAO.findCampaignsWithDashboardEntities(criteria)
    if (result.isErr()) return Result.Err(this.mapRepoError(result.unwrapErr(), 'findCampaigns'))

    const { campaigns, total } = result.unwrap()
    return Result.Ok({ items: campaigns.map(c => c.serialize()), total, page: criteria.page })
  }
}
```

---

## Application service structure

Use application services for workflows that span multiple use cases or require transaction management.

```typescript
export class DashboardApprovalMigrationService {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly campaignRepository: ICampaignRepository,
    private readonly logger: ILogger,
  ) {}

  async migrateApprovedEntity(entity: DashboardEntity): Promise<Result<void, ServiceError>> {
    return this.unitOfWork.transaction(async () => {
      const result = await this.performMigration(entity)
      if (result.isErr()) return result
      return Result.Ok(undefined)
    })
  }
}
```

---

## Error handling

### Error types

```
ServiceError = DomainError | ServiceInfraError

ServiceInfraError:
  ServiceUnavailableError
  ServiceTimeoutError
  ServiceUnknownError
```

### Mapping rules

- Domain errors pass through as-is
- Repository errors must be mapped to `ServiceInfraError` before returning
- Never return a raw infrastructure error from a use case

```typescript
// Good — map at boundary
const saveResult = await this.campaignRepository.save(campaign)
if (saveResult.isErr()) return Result.Err(this.mapRepoError(saveResult.unwrapErr(), 'save'))

// Bad — leaked infra error
return await this.campaignRepository.save(campaign)
```

---

## What is forbidden

- Business logic in use cases (e.g., `if (slug.includes('admin'))`) — belongs in domain
- Importing `drizzle-orm`, `fastify`, or any infrastructure concrete class
- Importing from `apps/backend` (presentation or infrastructure)
- Direct database access — use repositories or DAOs
- HTTP status codes
- `try/catch` blocks — use `Result.tryAsyncCatch()`
- `T | null` or `T | undefined` — use `Option<T>`

---

## File layout

```
packages/application/src/
├── core/
│   ├── use-case.ts
│   ├── unit-of-work.interface.ts
│   └── service-error.ts
├── dtos/
│   └── campaign/create-campaign.dto.ts
├── query-services/
│   └── campaign-query.service.ts
├── services/
│   └── dashboard-approval-migration.service.ts
├── use-cases/
│   └── campaign/
│       └── create-campaign.use-case.ts
└── index.ts
```

---

## FP & error handling

See `references/fp-errors.md` for `Result`/`Option` operator reference, pipeline patterns, and error mapping rules.
