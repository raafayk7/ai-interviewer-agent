---
name: backend-presentation-layer
description: Write, review, or reason about presentation layer code — controllers, routes, error mapping, response formatting, authentication/authorization checks, and DTO validation at the HTTP boundary. Use this skill when the user asks to create a controller, add a route, map service errors to HTTP responses, format API responses, or check authorization. Trigger proactively whenever the user is touching apps/backend/src/presentation/.
user-invocable: true
version: 1.0.0
---

# Presentation Layer (`apps/backend`)

The presentation layer **translates** between HTTP and the application layer. It validates incoming requests, calls use cases, maps errors to HTTP responses, and formats output. It never implements business logic.

**Location:** `apps/backend/src/presentation/`
**Imports from:** `@repo/domain` (error types for mapping), `@repo/application` (use cases, DTOs, service errors), `fastify`
**Never imports from:** `apps/backend/src/infrastructure/`

**One question to ask at every decision point:** "Is this HTTP-specific or business logic?" If business logic, it belongs in domain or application.

---

## What belongs here

| Artifact | Purpose |
|---|---|
| Controllers | Validate input, call use cases, map errors, format response |
| Routes | Register HTTP method + path, resolve controller, delegate |
| Error mapper | `ServiceError → HttpError` |
| Response utils | Consistent success/error response shape |

---

## Controller structure

Every controller follows this shape.

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify'
import { CreateCampaignDto } from '@repo/application'
import { ValidationError, NotFoundError, ConflictError } from '@repo/domain'
import type { ServiceError } from '@repo/application'
import { ServiceUnavailableError } from '@repo/application'

export class CampaignController {
  constructor(
    private readonly createCampaignUseCase: CreateCampaignUseCase,
    private readonly getCampaignUseCase: GetCampaignUseCase,
  ) {}

  async createCampaign(
    request: FastifyRequest<{ Body: CreateCampaignDto }>,
    reply: FastifyReply,
  ): Promise<void> {
    // 1. Validate DTO
    const dtoResult = CreateCampaignDto.validate(request.body)
    if (dtoResult.isErr()) throw this.mapDtoError(dtoResult.unwrapErr())

    // 2. Check authentication
    const userId = this.requireAuth(request)

    // 3. Execute use case
    const result = await this.createCampaignUseCase.execute({ ...dtoResult.unwrap(), userId })

    // 4. Map error or send success
    if (result.isErr()) throw this.mapServiceError(result.unwrapErr())
    reply.status(201).send({ success: true, data: result.unwrap() })
  }

  async getCampaign(
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const result = await this.getCampaignUseCase.execute({ slug: request.params.slug })
    if (result.isErr()) throw this.mapServiceError(result.unwrapErr())
    reply.status(200).send({ success: true, data: result.unwrap() })
  }

  private mapServiceError(error: ServiceError): HttpError {
    if (error instanceof ValidationError) return new BadRequestError(error.message, error.code)
    if (error instanceof NotFoundError) return new NotFoundHttpError(error.message)
    if (error instanceof ConflictError) return new ConflictHttpError(error.message)
    if (error instanceof ServiceUnavailableError) return new UnavailableError('Service temporarily unavailable')
    return new UnavailableError('An error occurred')
  }

  private mapDtoError(error: DtoValidationError): BadRequestError {
    const errors = error.zodError.issues.map(i => ({ field: i.path.join('.') || 'unknown', message: i.message }))
    return new BadRequestError('Validation failed', { errors })
  }

  private requireAuth(request: FastifyRequest): string {
    const userId = (request as AuthenticatedRequest).userId
    if (!userId) throw new UnauthorizedError('Authentication required')
    return userId
  }
}
```

### Controller responsibilities (in order)

1. Validate DTO (zod schema → throw `BadRequestError` on failure)
2. Check authentication/authorization
3. Execute use case
4. Map error to `HttpError` and `throw` it (error handler middleware formats response)
5. Send success response

---

## Route registration

Routes resolve the controller and delegate. No logic here.

```typescript
import type { FastifyInstance } from 'fastify'

export async function campaignRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new CampaignController(/* inject deps */)

  fastify.post('/campaigns', async (req, reply) => controller.createCampaign(req, reply))
  fastify.get('/campaigns/:slug', async (req, reply) => controller.getCampaign(req, reply))
}
```

Routes must not contain: business logic, use case execution, error handling.

---

## HTTP error types

```typescript
BadRequestError    → 400   // DTO validation, malformed input
UnauthorizedError  → 401   // Missing authentication
ForbiddenError     → 403   // Authenticated but not permitted
NotFoundHttpError  → 404   // Resource does not exist
ConflictHttpError  → 409   // Duplicate, already exists
UnavailableError   → 503   // Downstream service failure
```

The error handler middleware catches these and formats the response consistently.

---

## Error handler middleware

```typescript
import type { FastifyInstance } from 'fastify'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
        timestamp: new Date().toISOString(),
      })
    }

    // Unhandled — log and return 500
    request.log.error(error)
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      timestamp: new Date().toISOString(),
    })
  })
}
```

---

## Error mapping: the full chain

```
DomainValidationError     → BadRequestError   (400)
DomainNotFoundError       → NotFoundHttpError  (404)
DomainConflictError       → ConflictHttpError  (409)
BusinessRuleViolationError → BadRequestError   (400)
ServiceUnavailableError   → UnavailableError  (503)
DtoValidationError        → BadRequestError   (400)
(anything else)           → UnavailableError  (503)
```

Map exhaustively. Do not forward unmapped `ServiceError` to the middleware — the middleware only handles `HttpError`.

---

## What is forbidden

- Business logic in controllers (`if (request.body.slug.includes('admin'))`)
- Direct repository or database access — use use cases only
- Complex orchestration (calling multiple use cases) — use an application service
- Importing from `apps/backend/src/infrastructure/`
- Inconsistent response format — use the error handler + standard shapes
- Exposing stack traces or raw error messages in responses

---

## File layout

```
apps/backend/src/presentation/
├── controllers/
│   ├── campaign.controller.ts
│   └── dashboard.controller.ts
├── routes/
│   ├── index.ts                       ← registers all route groups
│   ├── campaign.routes.ts
│   └── dashboard.routes.ts
├── middleware/
│   ├── error-handler.ts
│   └── auth.ts
└── errors/
    └── http-error.ts                  ← BadRequestError, NotFoundHttpError, etc.
```

---

## FP & error handling

See `references/fp-errors.md` for how `Result` is consumed at the HTTP boundary and how `ServiceError` is mapped to `HttpError`.
