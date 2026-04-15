# AI Technical Interviewer Agent — Architecture & Design Document

## 1. Product Vision

An AI-powered technical screening interviewer that conducts short voice-based screening interviews (typically ~15 minutes) on behalf of recruiters. The system takes a Job Description (JD), candidate CV, and client-specific instructions, then autonomously conducts a natural voice conversation with the candidate. After the interview concludes, the system evaluates the full transcript and generates a structured screening report.

**This is a screening tool, not a replacement for line manager interviews.** It handles the initial filter — assessing communication, basic technical fit, and role alignment — so human recruiters spend their time only on candidates worth advancing.

## 2. Core User Flow

```
Recruiter uploads JD + CV + instructions
            │
            ▼
   System generates interview plan
   (questions, topics, time allocation)
            │
            ▼
   Candidate joins via web link
            │
            ▼
┌───────────────────────────────────────┐
│        Voice Interview (~15 min)       │
│                                        │
│  Candidate speaks                      │
│       ↓                                │
│  Deepgram STT (real-time streaming)    │
│       ↓                                │
│  Gemini Agent (AI SDK)                 │
│  - Has JD, CV, rubric, full history    │
│  - Decides next question / follow-up   │
│  - Manages time & topic coverage       │
│       ↓                                │
│  ElevenLabs TTS (streaming)            │
│       ↓                                │
│  Candidate hears response              │
└───────────────────────────────────────┘
            │
            ▼
   Full transcript saved to database
            │
            ▼
   Evaluation pass (Gemini)
   - Scores against rubric
   - Assesses communication & fit
   - Flags strengths and concerns
            │
            ▼
   Structured report delivered to recruiter
```

## 3. Architecture Overview

### 3.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend — apps/web (Next.js 16, React 19)                 │
│  - Recruiter dashboard (upload JD/CV, view reports)         │
│  - Candidate interview page (audio capture/playback)        │
│  - Real-time interview status & transcript view             │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket / HTTP
┌──────────────────────────▼──────────────────────────────────┐
│  Backend — apps/backend (Fastify 5)                         │
│                                                              │
│  Presentation Layer                                          │
│  - REST endpoints (interviews, reports, candidates)         │
│  - WebSocket server (real-time audio streaming)             │
│                                                              │
│  Application Layer — @repo/application                       │
│  - CreateInterview, ConductInterview, EvaluateInterview     │
│  - GenerateReport, SubmitAnswer use cases                   │
│                                                              │
│  Domain Layer — @repo/domain                                 │
│  - Interview, Question, Candidate, Report entities          │
│  - Scoring value objects, interview state machine           │
│                                                              │
│  Infrastructure Layer                                        │
│  - Drizzle ORM (PostgreSQL) — persistence                   │
│  - Deepgram SDK — speech-to-text                            │
│  - AI SDK + Gemini — interview agent, evaluation, doc OCR   │
│  - ElevenLabs SDK — text-to-speech                          │
│  - File Storage adapter (Local → S3/R2 later)               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Clean Architecture Mapping

```
Presentation → Application → Domain ← Infrastructure
```

| Layer | Package / Location | Responsibility |
|---|---|---|
| **Domain** | `packages/domain/` | Interview, Question, Candidate, Report entities. Scoring value objects. Interview state machine. Zero external dependencies. |
| **Application** | `packages/application/` | Use cases: CreateInterview, ConductInterview, EvaluateTranscript, GenerateReport. DTOs for all inputs/outputs. Orchestrates domain logic. |
| **Infrastructure** | `apps/backend/src/infrastructure/` | Drizzle repositories, Deepgram integration, AI SDK/Gemini agent, ElevenLabs TTS client. All external service adapters live here. |
| **Presentation** | `apps/backend/src/presentation/` | Fastify routes, WebSocket handlers, controllers, HTTP error mapping. |

### 3.3 Voice Pipeline Detail

The interview voice pipeline uses a **sandwich architecture** (STT → LLM → TTS):

```
                    ┌─────────────┐
  Browser mic ────► │  Deepgram   │ ────► text ────┐
  (WebSocket)       │  STT        │                 │
                    └─────────────┘                 │
                                                    ▼
                                          ┌──────────────────┐
                                          │  Gemini Agent     │
                                          │  (via AI SDK)     │
                                          │                    │
                                          │  System prompt:    │
                                          │  - JD context      │
                                          │  - CV summary      │
                                          │  - Interview plan  │
                                          │  - Conversation    │
                                          │    history         │
                                          │                    │
                                          │  Tools:            │
                                          │  - next_question   │
                                          │  - score_answer    │
                                          │  - end_interview   │
                                          │  - take_note       │
                                          └────────┬───────────┘
                                                   │
                    ┌─────────────┐                 │
  Browser audio ◄── │ ElevenLabs  │ ◄──── text ◄───┘
  (WebSocket)       │ TTS         │
                    └─────────────┘
```

**Latency budget:** ~500ms-1s end-to-end (STT ~200ms + LLM ~300-500ms + TTS ~200ms). Acceptable for a screening interview with natural conversational pauses.

## 4. Tech Stack

### 4.1 Existing (Already in Repo)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 22 | Runtime |
| TypeScript | 5.9 | Language |
| pnpm | 9 | Package manager |
| Turborepo | 2.9 | Monorepo build system |
| Fastify | 5 | HTTP framework |
| Drizzle ORM | 0.44 | Database ORM |
| PostgreSQL | — | Primary database |
| Zod | 3.25 | Validation / DTOs |
| @carbonteq/fp | 0.9.1 | Result/Option FP primitives |
| Vitest | 3.2 | Testing |
| Next.js | 16 | Frontend framework |
| React | 19 | UI library |

### 4.2 To Be Added
Note: These have now been installed in apps/backend
| Technology | Purpose | Package |
|---|---|---|
| **AI SDK** | Agent framework, streaming, tool calling, structured output | `ai` |
| **AI SDK Google Provider** | Gemini integration for AI SDK | `@ai-sdk/google` |
| **Deepgram SDK** | Real-time speech-to-text (WebSocket streaming) | `@deepgram/sdk` |
| **ElevenLabs SDK** | Text-to-speech (streaming audio generation) | `elevenlabs` |
| **Langfuse** | LLM observability (tracing, cost, prompt versioning) | `langfuse` + `@langfuse/otel` |

### 4.3 API Keys Required

| Service | Key | Status |
|---|---|---|
| Google AI Studio (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | Available |
| Deepgram | `DEEPGRAM_API_KEY` | Need to sign up (deepgram.com) |
| ElevenLabs | `ELEVENLABS_API_KEY` | Need to sign up (elevenlabs.io) |
| Langfuse | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Need to sign up (langfuse.com, free tier) |

### 4.4 Why NOT PersonaPlex

NVIDIA PersonaPlex was evaluated and rejected for these reasons:

1. **Content injection doesn't work** — the `text_prompt` parameter only controls persona identity ("You are Sarah"), not behavior or content. You cannot feed it a JD or tell it what questions to ask. This is a fine-tuning limitation, not a configuration issue.
2. **163-second context window** — the model forgets everything beyond ~2.7 minutes. In a 15-minute interview it would repeat questions and lose track of answers.
3. **No tool calling** — cannot trigger interview flow control (next topic, end interview, score answer).
4. **7B parameter model** — insufficient reasoning depth for evaluating technical answers or generating meaningful follow-ups.
5. **1:1 GPU ratio** — each concurrent interview requires a dedicated GPU. Scaling nightmare.
6. **English only** — no multilingual support.

The sandwich architecture (STT → Gemini → TTS) provides full content control, unlimited context, tool calling, and scales on standard infrastructure.

### 4.5 Document Ingestion (OCR / Extraction)

Uploaded CVs and JDs are parsed using **Gemini's native multimodal capabilities via AI SDK**, not a separate OCR service.

- Gemini 2.5 Pro accepts PDF and image input directly
- A single `generateObject` call with a Zod schema produces typed, structured extraction
- Handles both text PDFs and scanned/image-based documents in one pass
- No Tesseract, Textract, or separate OCR pipeline needed

Extraction happens once at upload time and the structured result is persisted alongside the raw file.

### 4.6 Observability (Langfuse)

Every AI interaction is traced for debugging, cost tracking, and quality monitoring. Langfuse is the chosen observability platform — free tier is generous, self-hostable if needed later.

**What gets traced:**
- Every LLM call (interview agent turns, evaluation passes, document extraction)
- Full input/output including system prompts, tool calls, and tool results
- Latency, token counts, and cost per call
- Deepgram STT and ElevenLabs TTS calls (as custom spans within the same trace)
- Per-interview session grouping (all turns in one trace)
- Custom metadata (interview ID, candidate ID, JD ID) for filtering

**Trace structure per interview:**
```
Trace: Interview session {interviewId}
├── Span: Agent turn 1
│   ├── Span: Deepgram STT        (duration, audio_seconds, cost)
│   ├── Generation: Gemini agent  (native — prompts, tokens, tool calls)
│   └── Span: ElevenLabs TTS      (character_count, audio_duration, cost)
├── Span: Agent turn 2
│   └── ...
└── Generation: Evaluation pass   (native — transcript in, report out)
```

**Non-LLM spans (Deepgram, ElevenLabs):**
Langfuse is optimized for LLM traces but supports arbitrary OpenTelemetry spans. Deepgram and ElevenLabs are instrumented as custom spans — you get latency, cost, and failure visibility in the unified trace view, but not the rich LLM-specific UI (token diffs, prompt versioning). This is acceptable for our needs; if we outgrow it for infra-level metrics, we add a separate Grafana/Prometheus stack later without changing the LLM observability.

**Why it matters here:**
- Debugging agent behavior post-hoc (why did it ask that question? why did it end early?)
- Tracking cost per interview to validate unit economics
- Iterating on system prompts with versioning and comparison
- Adding evaluation scores (e.g. "did the agent cover all must-ask questions?") over time

**Integration:**
- AI SDK has native OpenTelemetry support
- Langfuse provides an OTel exporter — `@langfuse/otel` package
- One-time setup in the backend bootstrap; all AI SDK calls are traced automatically

**Env vars required:**
```
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com  # or self-hosted URL
```

### 4.7 File Storage Abstraction

File storage is abstracted via a port/adapter pattern so we can swap backends without touching use cases.

**Port** (in application layer):
```typescript
interface IFileStorageService {
  upload(file: Buffer, key: string, contentType: string): Promise<Result<FileRef, StorageError>>;
  download(key: string): Promise<Result<Buffer, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
  getSignedUrl(key: string, expiresInSec: number): Promise<Result<string, StorageError>>;
}
```

**Adapters** (in infrastructure layer):
- **Dev / current:** `LocalFileStorageService` — writes to a configured directory on disk, serves via signed URLs from the backend
- **Future production:** `S3FileStorageService` / `R2FileStorageService` — swap with zero use-case changes

**Files stored:**
- Uploaded CVs (PDF/image)
- Uploaded JDs (PDF/text)
- Interview audio recordings (future — for QA and dispute resolution)

Storage keys follow a predictable pattern: `{entity}/{id}/{filename}` (e.g. `interviews/abc-123/cv.pdf`).

## 5. Key Design Decisions

### 5.1 Interview Agent (Gemini via AI SDK)

The interviewer is an **AI SDK agent** with a rich system prompt and tool definitions:

**System prompt contains:**
- The full JD (role, requirements, responsibilities)
- Summarized CV (key experience, skills, education)
- Client instructions (what to focus on, what to avoid, company culture notes)
- Interview plan (generated pre-interview: topics, time allocation, must-ask questions)
- Behavioral guidelines (professional tone, time management, how to handle tangents)

**Agent tools:**
- `next_question` — advance to the next planned topic
- `score_answer` — internally log a score for the current answer (not shown to candidate)
- `take_note` — log an observation for the final report
- `end_interview` — wrap up when time is up or all topics covered

### 5.2 Interview Duration (Soft Target, Not Hard Cap)

Screening interviews **typically** run ~15 minutes, but this is a target, not a rule. The agent uses judgment:

- **Target duration** (`targetDurationMinutes`, default 15) — what the agent aims for
- **Hard ceiling** (`maxDurationMinutes`, default 25) — enforced by the system, agent must wrap up

The agent may end earlier if:
- All must-ask questions are covered and signal is clear
- Candidate is clearly not a fit (save everyone's time)
- Candidate requests to end

The agent may run longer (up to the hard ceiling) if:
- Candidate is on a strong topic worth exploring
- Critical must-ask questions remain uncovered

The hard ceiling exists purely as a safety net (runaway conversations, stuck agents). The normal signal is the target, communicated to the agent via system prompt plus periodic time-remaining updates injected into context.

### 5.3 Post-Interview Evaluation

A separate Gemini call (not the same agent) receives:
- The full transcript
- The original JD and CV
- A scoring rubric

And produces a **structured report** (via AI SDK `generateObject`):
- Overall recommendation (advance / hold / reject)
- Per-topic scores with justification
- Communication assessment
- Key strengths and concerns
- Suggested follow-up questions for the line manager interview

### 5.4 Interview State Machine

```
CREATED → SCHEDULED → IN_PROGRESS → COMPLETED → EVALUATED
                          │
                          └──→ CANCELLED
```

- **CREATED** — JD and CV uploaded, interview plan not yet generated
- **SCHEDULED** — plan generated, candidate link created, waiting for candidate
- **IN_PROGRESS** — voice session active
- **COMPLETED** — session ended, transcript saved
- **EVALUATED** — report generated and available

### 5.5 Real-Time Communication

- **Browser ↔ Backend:** WebSocket for bidirectional audio streaming
- **Backend → Deepgram:** WebSocket for real-time STT
- **Backend → ElevenLabs:** HTTP streaming for TTS audio chunks
- **Backend → Gemini:** AI SDK streaming for agent responses

## 6. Domain Model (Initial)

```
Interview
├── id: InterviewId
├── status: InterviewStatus (state machine)
├── jobDescription: JobDescription (value object)
├── candidateInfo: CandidateInfo (value object)
├── clientInstructions: string
├── interviewPlan: InterviewPlan (value object)
├── transcript: TranscriptEntry[]
├── scheduledAt: Date
├── startedAt: Date | null
├── completedAt: Date | null
└── report: Report | null

Report
├── id: ReportId
├── interviewId: InterviewId
├── overallRecommendation: "advance" | "hold" | "reject"
├── topicScores: TopicScore[]
├── communicationAssessment: string
├── strengths: string[]
├── concerns: string[]
├── followUpQuestions: string[]
└── generatedAt: Date

InterviewPlan
├── topics: PlannedTopic[]
├── targetDurationMinutes: number   // soft target, default 15
├── maxDurationMinutes: number      // hard ceiling, default 25
└── mustAskQuestions: string[]

PlannedTopic
├── name: string
├── questions: string[]
├── timeAllocationMinutes: number
└── priority: "must_cover" | "if_time_permits"
```

## 7. Implementation Phases

### Phase 1 — Domain & Application Layer
- Define entities: Interview, Report
- Define value objects: JobDescription, CandidateInfo, InterviewPlan, TopicScore, FileRef
- Define repository interfaces
- Define service ports: `IFileStorageService`, `IDocumentExtractionService`
- Implement use cases: UploadCandidateDocuments, CreateInterview, GenerateInterviewPlan, EvaluateTranscript, GenerateReport

### Phase 2 — Infrastructure Layer
- Drizzle schema and migrations
- `LocalFileStorageService` adapter (disk-based, configurable root path)
- `GeminiDocumentExtractionService` adapter (AI SDK multimodal extraction)
- Langfuse OTel setup in backend bootstrap — all AI SDK calls traced automatically
- Repository implementations
- AI SDK agent setup (Gemini provider, interview system prompt, tools)
- Evaluation service (structured output for reports)

### Phase 3 — Voice Pipeline
- Deepgram STT integration (WebSocket streaming)
- ElevenLabs TTS integration (streaming audio)
- WebSocket server for browser ↔ backend audio
- ConductInterview use case (orchestrates STT → Agent → TTS loop)

### Phase 4 — Presentation Layer
- REST endpoints (CRUD for interviews, reports)
- WebSocket handlers for interview sessions
- Error mapping and authentication

### Phase 5 — Frontend
- Recruiter dashboard (create interview, upload JD/CV, view reports)
- Candidate interview page (audio UI, connection status)
- Report viewer

### Phase 6 — Polish
- Interview time management (warnings, graceful wrap-up)
- Retry/reconnection handling for voice pipeline
- Rate limiting and concurrent interview management
- Monitoring and logging
