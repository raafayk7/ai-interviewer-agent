# AI Technical Interviewer Agent — Architecture & Design Document

## 1. Product Vision

An AI-powered technical screening interviewer that conducts 15-minute voice-based screening interviews on behalf of recruiters. The system takes a Job Description (JD), candidate CV, and client-specific instructions, then autonomously conducts a natural voice conversation with the candidate. After the interview concludes, the system evaluates the full transcript and generates a structured screening report.

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
│         15-Minute Voice Interview      │
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
│  - AI SDK + Gemini — interview agent & evaluation           │
│  - ElevenLabs SDK — text-to-speech                          │
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

### 4.3 API Keys Required

| Service | Key | Status |
|---|---|---|
| Google AI Studio (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | Available |
| Deepgram | `DEEPGRAM_API_KEY` | Need to sign up (deepgram.com) |
| ElevenLabs | `ELEVENLABS_API_KEY` | Need to sign up (elevenlabs.io) |

### 4.4 Why NOT PersonaPlex

NVIDIA PersonaPlex was evaluated and rejected for these reasons:

1. **Content injection doesn't work** — the `text_prompt` parameter only controls persona identity ("You are Sarah"), not behavior or content. You cannot feed it a JD or tell it what questions to ask. This is a fine-tuning limitation, not a configuration issue.
2. **163-second context window** — the model forgets everything beyond ~2.7 minutes. In a 15-minute interview it would repeat questions and lose track of answers.
3. **No tool calling** — cannot trigger interview flow control (next topic, end interview, score answer).
4. **7B parameter model** — insufficient reasoning depth for evaluating technical answers or generating meaningful follow-ups.
5. **1:1 GPU ratio** — each concurrent interview requires a dedicated GPU. Scaling nightmare.
6. **English only** — no multilingual support.

The sandwich architecture (STT → Gemini → TTS) provides full content control, unlimited context, tool calling, and scales on standard infrastructure.

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

### 5.2 Post-Interview Evaluation

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

### 5.3 Interview State Machine

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

### 5.4 Real-Time Communication

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
├── totalDurationMinutes: 15
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
- Define value objects: JobDescription, CandidateInfo, InterviewPlan, TopicScore
- Define repository interfaces
- Implement use cases: CreateInterview, GenerateInterviewPlan, EvaluateTranscript, GenerateReport

### Phase 2 — Infrastructure Layer
- Drizzle schema and migrations
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
