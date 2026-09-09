# Sift — AI Technical Interviewer

**An AI-powered technical screening platform that conducts adaptive voice interviews on behalf of recruiters and produces structured candidate assessments.**

Sift takes a job description, candidate CV, and recruiter-specific instructions, builds a tailored interview plan, conducts a short voice-based technical screening interview, and evaluates the completed conversation against the role.

It is designed as an initial screening tool rather than a replacement for a human technical interview: the goal is to help recruiters identify candidates worth advancing while preserving a structured, consistent interview process.

> **Status:** Active development. The end-to-end recruiter and candidate workflows are implemented, with ongoing work around deployment and operational hardening.

---

## What Sift Does

### For recruiters

A recruiter can:

- Create an account and sign in.
- Create and manage candidate interviews from a recruiter dashboard.
- Upload a candidate CV and job description.
- Add role- or company-specific interview instructions.
- Extract structured information from uploaded documents using AI.
- Generate a role-specific interview plan.
- Create a signed candidate interview link.
- Track interview status through its lifecycle.
- Review the completed interview transcript.
- Generate and view a structured AI assessment report.

The resulting report includes:

- An overall recommendation.
- Per-topic assessment and justification.
- Communication assessment.
- Candidate strengths.
- Areas of concern.
- Suggested follow-up questions for a human interview.

### For candidates

Candidates do not create accounts.

They receive a signed interview link and move through a dedicated candidate flow:

1. Interview landing page.
2. Microphone and audio compatibility checks.
3. Live voice interview.
4. Interview completion / interruption handling.
5. Post-interview confirmation.

The candidate interface is intentionally minimal, with the interview centred around a single responsive voice presence rather than a traditional chat UI.

---

## How an Interview Works

```text
Recruiter
   │
   │  uploads CV + JD + instructions
   ▼
Document Extraction
   │
   │  structured with Gemini
   ▼
Interview Plan
   │
   │  topics, questions, priorities, timing
   ▼
Signed Candidate Link
   │
   ▼
Candidate Pre-Interview Check
   │
   ▼
ElevenLabs Conversational AI Session
   │
   ├── server-generated interview context
   ├── role / CV / interview-plan context
   ├── dynamic variables
   ├── next-question tool
   ├── scoring tool
   └── note-taking tool
   │
   ▼
Post-Call Webhook
   │
   │  authenticated transcript + session result
   ▼
Transcript Persistence
   │
   ▼
Gemini Evaluation
   │
   ▼
Structured Recruiter Report
```

The live conversation is handled through **ElevenLabs Conversational AI**. The backend remains authoritative for interview state and supplies the session with server-generated interview context rather than exposing sensitive prompt construction to the client.

After the call, the completed transcript is persisted and evaluated separately. Keeping interviewing and final evaluation as distinct stages allows the final assessment to consider the entire conversation rather than relying only on per-turn judgments made during the call.

---

## Engineering Highlights

### Adaptive AI interview planning

Sift does not use one fixed interview script.

The system uses the uploaded job description, candidate CV, and recruiter instructions to generate an interview plan containing:

- Topics to cover.
- Topic priorities.
- Question sets.
- Must-ask questions.
- Time allocation.
- Target interview duration.

The live interviewer receives this context and can adapt its follow-up questions based on the candidate's responses.

### AI document ingestion

Candidate CVs and job descriptions can be uploaded as documents and converted into typed structured data.

The extraction layer uses Gemini through the AI SDK with schema-validated structured output, allowing the same pipeline to work with both ordinary PDFs and image/scanned documents.

Raw files and extracted representations are persisted separately.

### Voice-first interview experience

The candidate-facing experience is designed around a live conversation rather than a text chatbot.

The current voice path uses ElevenLabs Conversational AI, with:

- Private signed conversation sessions.
- Server-side prompt overrides.
- Dynamic interview variables.
- Backend tool endpoints for interview control.
- Post-call transcript ingestion.
- End-of-call state reconciliation.

The UI visualises interview state through a responsive voice orb and provides explicit handling for loading, active conversation, reconnection, interruption, completion, and unavailable-session states.

### Session integrity

A voice interview is a stateful process, so duplicate or partially completed sessions cannot safely be treated like ordinary stateless API requests.

Sift includes safeguards for:

- Preventing a page reload from starting a second active interview session.
- Binding a single provider conversation to an interview.
- Handling duplicate post-call events.
- Replacing an existing transcript only when a strictly better transcript arrives.
- Invalidating a stale report when a better transcript replaces the evaluated transcript.
- Reconciling interviews left in `IN_PROGRESS`.
- Representing unrecoverable sessions with an explicit `FAILED` terminal state.

Report invalidation and transcript replacement are performed transactionally where consistency requires it.

### Signed candidate access

Recruiters authenticate with email/password sessions through Better Auth.

Candidates intentionally do **not** have application accounts. Instead, access is granted through HMAC-signed interview links with an expiry time.

This keeps the candidate flow lightweight while preventing interview IDs alone from granting access.

### Clean Architecture + Domain-Driven Design

The backend follows an inward dependency model:

```text
Presentation → Application → Domain ← Infrastructure
```

The domain layer contains the core business model and has no dependency on Fastify, Drizzle, external AI providers, or persistence infrastructure.

The application layer coordinates use cases through ports.

Infrastructure implements those ports for:

- PostgreSQL persistence.
- AI services.
- Voice services.
- Authentication.
- File storage.
- Observability.

The presentation layer maps HTTP and webhook traffic onto application use cases.

Expected failures are represented explicitly with `Result<T, E>` / `Option<T>` rather than using exceptions as application control flow.

### Provider abstractions

External systems are kept behind application interfaces where possible.

For example, file storage uses a port/adapter design supporting:

- Local filesystem storage for simple development.
- S3-compatible object storage.
- MinIO locally.
- Supabase Storage / S3-compatible services in hosted environments.

This allows infrastructure to change without changing domain or application logic.

### Observability

AI operations are instrumented with OpenTelemetry and Langfuse.

Tracing is intended to make it possible to inspect:

- AI calls.
- Prompt inputs and outputs.
- Tool activity.
- Session identifiers.
- Latency.
- Token consumption.
- Evaluation behaviour.
- Per-interview execution history.

This is particularly useful for debugging an agent whose behaviour cannot be understood from HTTP logs alone.

---

## Architecture

Sift is a TypeScript monorepo managed with pnpm and Turborepo.

```text
ai-interviewer-agent/
│
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── infrastructure/
│   │   │   ├── presentation/
│   │   │   └── composition/
│   │   ├── drizzle/
│   │   └── scripts/
│   │
│   └── web/
│       ├── app/
│       ├── src/
│       │   ├── components/
│       │   ├── containers/
│       │   ├── services/
│       │   ├── stores/
│       │   ├── types/
│       │   └── lib/
│       └── e2e/
│
├── packages/
│   ├── domain/
│   ├── application/
│   ├── ui/
│   ├── eslint-config/
│   └── typescript-config/
│
├── docs/
│   ├── adr/
│   ├── progress/
│   ├── runbooks/
│   ├── spikes/
│   ├── ARCHITECTURE.md
│   └── DESIGN.md
│
├── .agents/
├── .claude/
├── .codex/
├── AGENTS.md
├── CLAUDE.md
└── docker-compose.yml
```

### Backend layers

| Layer | Location | Responsibility |
|---|---|---|
| Domain | `packages/domain` | Entities, value objects, domain rules, repository ports |
| Application | `packages/application` | Use cases, DTOs, orchestration and service ports |
| Infrastructure | `apps/backend/src/infrastructure` | PostgreSQL, AI, voice, storage, auth and external adapters |
| Presentation | `apps/backend/src/presentation` | Fastify routes, controllers, webhooks and error mapping |

### Frontend layers

The frontend uses its own explicit dependency flow:

```text
Routes
  ↓
Containers
  ├── Services
  ├── Stores
  └── Composites
         ↓
     Primitives
```

Server data is handled through TanStack Query, local interface state through Zustand, validation through Zod, and forms through React Hook Form.

Routes remain Server Components where possible, with containers acting as the first client-side orchestration boundary.

---

## Tech Stack

### Core

| Technology | Purpose |
|---|---|
| TypeScript | Primary application language |
| Node.js | Backend runtime |
| pnpm | Package management |
| Turborepo | Monorepo build and task orchestration |

### Frontend

| Technology | Purpose |
|---|---|
| Next.js 16 | Web application framework |
| React 19 | UI |
| Tailwind CSS 4 | Styling |
| TanStack Query | Server-state management |
| Zustand | Client UI state |
| React Hook Form | Form orchestration |
| Zod | Runtime validation |
| Radix UI | Accessible UI primitives |
| Vitest | Unit/component testing |
| Playwright | End-to-end testing |

### Backend

| Technology | Purpose |
|---|---|
| Fastify 5 | HTTP API |
| PostgreSQL | Primary database |
| Drizzle ORM | Persistence and migrations |
| Better Auth | Recruiter authentication |
| `@carbonteq/fp` | `Result` / `Option` functional primitives |
| Zod | DTO and boundary validation |

### AI and voice

| Technology | Purpose |
|---|---|
| Google Gemini | Document extraction, planning and post-interview evaluation |
| Vercel AI SDK | Structured AI interaction |
| ElevenLabs Conversational AI | Live voice interviews |
| Langfuse | AI observability |
| OpenTelemetry | Tracing |

### Storage / infrastructure

| Technology | Purpose |
|---|---|
| S3-compatible storage | CV and JD persistence |
| MinIO | Local S3-compatible development |
| AWS SDK | S3 adapter |
| Docker Compose | Local infrastructure |

---

## Interview State Machine

The interview aggregate owns the lifecycle of an interview.

```text
CREATED
   │
   ▼
SCHEDULED
   │
   ▼
IN_PROGRESS
   │
   ├──────────────► FAILED
   │
   ▼
COMPLETED
   │
   ▼
EVALUATED
```

Terminal and recovery behaviour is enforced in the domain rather than inferred by individual UI components or external-provider responses.

---

## Design

Sift's visual system is called **Quiet Signal**.

The core idea is to treat an AI interview as a serious assessment environment rather than a conversational novelty.

The recruiter experience is designed as a restrained operations interface with high information density and limited decorative colour.

The candidate experience strips the interface down further. A single warm voice orb acts as the centre of the conversation while transcript and connection information remain secondary.

The orb is stateful:

```text
idle → listening → thinking → speaking
```

Connection failure introduces a warning treatment without replacing the interview surface with alarming error UI unless the session has genuinely become terminal.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the complete visual system.

---

## Development With Coding Agents

This repository is also structured deliberately for AI-assisted software development.

Rather than relying on a single repository prompt, the project contains explicit instructions, skills, architectural validation, plans, and specialised agents for different layers of the system.

```text
.agents/
.claude/
.codex/agents/
AGENTS.md
CLAUDE.md
```

The agent workflow includes:

- Backend domain/application/infrastructure/presentation skills.
- Frontend route/container/service/composite/primitive skills.
- Architecture validators.
- Architecture Decision Record generation and review.
- Structured implementation plans.
- Progress-document generation.
- Scoped code-review agents.
- Layer-specific verification commands.

Architecturally significant changes are documented through ADRs, while completed development phases are recorded under `docs/progress/`.

The goal is to make coding agents operate inside the same architectural constraints that would apply to human contributors, rather than allowing generated code to bypass project boundaries.

---

## Getting Started

### Prerequisites

Recommended:

- Node.js 22
- pnpm 9
- PostgreSQL
- Docker, if using MinIO or the integration-test database
- A Gemini API key
- An ElevenLabs account and configured Conversational AI agent

### Install dependencies

```bash
pnpm install
```

### Configure the backend

Copy:

```bash
cp apps/backend/.env.example apps/backend/.env
```

At minimum, configure:

```env
DATABASE_URL=

BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3002
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000

CANDIDATE_LINK_SECRET=
CANDIDATE_PUBLIC_BASE_URL=http://localhost:3000

GOOGLE_GENERATIVE_AI_API_KEY=

ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_WEBHOOK_SECRET=
ELEVENLABS_TOOL_WEBHOOK_SECRET=

LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
```

See `apps/backend/.env.example` for the complete environment surface.

### Configure the frontend

```bash
cp apps/web/.env.example apps/web/.env.local
```

Local development:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
```

### Optional local object storage

Sift supports S3-compatible storage.

A MinIO development environment is provided through Docker Compose:

```bash
docker compose --profile dev up -d
```

Then configure:

```env
FILE_STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=interview-documents
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

Alternatively, use the local filesystem adapter during development.

### Run database migrations

```bash
pnpm --filter backend db:migrate
```

### Start development

From the repository root:

```bash
pnpm dev
```

By default:

```text
Web:     http://localhost:3000
Backend: http://localhost:3002
```

---

## Common Commands

```bash
# Development
pnpm dev

# Build the monorepo
pnpm build

# Type checking
pnpm check-types

# Lint
pnpm lint

# Tests
pnpm test

# Format
pnpm format
```

Backend-specific database commands:

```bash
pnpm --filter backend db:generate
pnpm --filter backend db:migrate
pnpm --filter backend db:studio
```

Frontend E2E tests:

```bash
pnpm --filter web test:e2e
```

---

## Testing

The project uses tests across each architectural layer rather than relying only on end-to-end coverage.

Coverage includes:

- Domain invariants and state transitions.
- Application use cases.
- Repository integration behaviour.
- HTTP controllers and error mapping.
- Authentication and candidate-link verification.
- ElevenLabs webhook handling.
- Session-integrity and reconciliation behaviour.
- Frontend services and Zod response validation.
- Zustand stores.
- UI primitives and composites.
- Candidate session state transitions.
- Recruiter and candidate container behaviour.
- Selected Playwright route-level flows.

Backend integration tests can use the dedicated PostgreSQL test container:

```bash
docker compose --profile test up -d
```

---

## Documentation

Detailed engineering documentation lives under `docs/`.

Useful entry points:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — original architecture and domain design.
- [`docs/DESIGN.md`](docs/DESIGN.md) — Quiet Signal visual system.
- [`docs/adr/`](docs/adr/) — Architecture Decision Records.
- [`docs/progress/`](docs/progress/) — implementation history by development phase.
- [`AGENTS.md`](AGENTS.md) — coding-agent repository guidance.
- [`CLAUDE.md`](CLAUDE.md) — Claude Code development guidance.

Some original architecture documentation records earlier design iterations and should therefore be read alongside the newer ADR and progress documents when investigating the current voice implementation.

---

## Current Development Notes

Sift is an engineering project under active development rather than a production-certified hiring product.

The main recruiter, candidate, interview, evaluation, reporting, authentication and session-integrity workflows are implemented.

Remaining work includes further provider-level smoke testing, deployment hardening, operational monitoring, and removal of legacy components from the original voice-pipeline implementation.

The candidate and recruiter applications are currently designed primarily for laptop and desktop use.

---

## Motivation

Technical screening is expensive in human time, but fully automated screening becomes unhelpful if it is reduced to a static question list or opaque score.

Sift explores a different approach: let an AI conduct the repetitive first conversation, give it enough structured context to ask useful follow-ups, preserve the full interview as evidence, and perform a separate evaluation pass that a recruiter can actually inspect.

The project is as much an exploration of **reliable agentic software architecture** as it is an AI interview product.
