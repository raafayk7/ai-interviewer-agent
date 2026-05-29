# Plan: Phase 9.5 — ElevenLabs Conversational AI backend (parallel path, webhook-driven)

> Regenerated: 2026-05-25
> Slug: phase-9-5-elevenlabs-backend
> Governing ADRs: ADR-029 (adopt conversational), ADR-030 (static agent + initiation-webhook overrides), ADR-031 (four webhook categories drive lifecycle), ADR-032 (OTel spans D1–D5)
> Spike: `docs/spikes/phase-9-5-elevenlabs-spike-findings.md` (7 contract surprises)
> Mode: PLAN ONLY. Backend-only. Execute later via `/backend-implement`.

## Summary

Add a parallel ElevenLabs Conversational AI voice path alongside the retained sandwich (Deepgram → Gemini → ElevenLabs TTS). The candidate's browser connects directly to ElevenLabs over LiveKit; the backend is never on the per-turn audio path. The path is driven by **four webhook categories**:

1. A **synchronous conversation-initiation webhook** at conversation start. ElevenLabs blocks waiting for our HTTP response carrying per-session overrides (`ConversationInitiationClientDataRequestOutput`: JD/CV/plan/clientInstructions as `conversationConfigOverride.agent.prompt.prompt`, plus dynamic variables). Sensitive interview content **never leaves the server** — it is delivered server-to-server only via this webhook (ADR-030). The handler fail-closes on any error (non-2xx aborts the conversation). It also **binds `elevenLabsSessionId`** from the `conversation_id` present in the initiation payload, when present.
2. A **fire-and-forget session-start (`conversation_started`) webhook** which flips `SCHEDULED → IN_PROGRESS` and, as a fallback, binds `elevenLabsSessionId` if the initiation webhook did not.
3. **Fire-and-forget tool-call webhooks** (`take_note`, `score_answer`, plus the built-in `end_call` system tool surfaced as `EndInterviewFromAgent`). The built-in `end_call` system tool **does not complete the aggregate** — it records the end reason as an `AgentNote`. The aggregate is completed only by the session-end / post-call webhook.
4. A **workspace-scoped fire-and-forget post-call webhook** (one shared HMAC endpoint; correlate by `conversation_id`) which pulls the full transcript via the ElevenLabs REST API and calls `interview.complete(at, transcript)`.

`StartCandidateSession` is a narrow URL-issuance use case: it calls `getSignedUrl({ agentId, includeConversationId: true })` (SDK-verified shape: no overrides on this call; URL is single-use; fresh URL per connect attempt) and returns `{ signedUrl, sessionToken }`. The `sessionToken` is a short-lived opaque HMAC bound to `interviewId` (ADR-017 idiom, `node:crypto` HMAC-SHA256, `timingSafeEqual`, dedicated env secret `ELEVENLABS_SESSION_TOKEN_SECRET`). The browser passes the token as a dynamic variable (`correlation_token`) when initiating the conversation; the backend extracts and verifies it inside the **synchronous initiation webhook**. The browser never carries JD/CV/plan/clientInstructions.

The domain layer is additive only: an `elevenLabsSessionId: Option<string>` correlation field plus an idempotent `bindElevenLabsSession()` mutator. State machine, value objects, repository interface unchanged. Five new backend-controlled OTel spans (ADR-032 D1, D2, D3, D4, D5) instrument every surface. Every sandwich file stays untouched.

## Layers touched

| Layer | Package / Location | Scope |
|---|---|---|
| Domain | `packages/domain/` | Additive only: `elevenLabsSessionId: Option<string>` on `Interview` + idempotent `bindElevenLabsSession()` mutator (allows re-bind in SCHEDULED or IN_PROGRESS). State machine, VOs, repo interface unchanged. |
| Application | `packages/application/` | New `IConversationalAgentService` port (`issueSignedUrl`, `getTranscript` only — no overrides) + error type. New `ConversationCorrelationTokenIssuer` port (issue + verify). 7 new use cases (`StartCandidateSession`, `AssembleConversationInitiationContext`, `StartInterviewFromWebhook`, `RecordAgentNote`, `RecordInternalScore`, `EndInterviewFromAgent`, `PersistCompletedTranscript`). Barrel exports. |
| Infrastructure | `apps/backend/src/infrastructure/` | `ElevenLabsConversationalService` adapter (`@elevenlabs/elevenlabs-js` v2.49.1; calls `getSignedUrl` with `includeConversationId: true` and `get-conversation` for transcript). `ConversationCorrelationToken` HMAC helper (ADR-017 idiom, `ELEVENLABS_SESSION_TOKEN_SECRET`). `ElevenLabsWebhookVerifier` (HMAC against `ELEVENLABS_WEBHOOK_SECRET`). `ElevenLabsAgentConfigAssertion` startup adapter calling `agents.get(agentId)` once to verify allow-list flags. Conversational provider handle. Drizzle column `eleven_labs_session_id`. |
| Presentation | `apps/backend/src/presentation/` | `candidate-session.controller.ts` (D1 span, token-gated). `elevenlabs-initiation-webhook.controller.ts` (D5 span, synchronous, fail-closed, returns `ConversationInitiationClientDataRequestOutput`). `elevenlabs-webhook.controller.ts` (D2/D3/D4 spans, fire-and-forget). Route registrars at `/initiation`, `/session-start`, `/tools`, `/post-call`. Scoped raw-body content-type parser for ALL webhook routes. Webhook routes do NOT inherit better-auth. |
| Composition | `apps/backend/src/composition/` | `candidate-session.composition.ts`, `elevenlabs-webhook.composition.ts`, `elevenlabs-initiation-webhook.composition.ts`; additive `app.ts` registration following `composeDefaults`. Sandwich WS block left intact. |

---

## DO NOT TOUCH (sandwich path stays runnable, non-default fallback — verbatim from prior plan)

These files MUST NOT be modified, deleted, or rewired by this plan's execution:

- `packages/application/src/use-cases/interview/conduct-interview.use-case.ts`
- `packages/application/src/use-cases/interview/candidate-audio-turn-gate.ts`
- `apps/backend/src/infrastructure/services/deepgram/**` (Deepgram STT adapter + provider)
- `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-tts.service.ts` (keeps deprecated `elevenlabs` pkg)
- `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` (sandwich TTS handle; **read/reuse the pattern, do not edit**)
- `apps/backend/src/presentation/controllers/interview-session.controller.ts`
- `apps/backend/src/presentation/routes/interview-session.ws.ts`
- `apps/backend/src/presentation/websocket/voice-websocket.ts` and `async-queue.ts`
- `apps/backend/src/composition/interview-session.composition.ts` (the `buildUseCase` factory seam)
- The `IInterviewAgentService`, `ISpeechToTextService`, `ITextToSpeechService` ports and their barrels.
- `app.ts` interview-session WS registration block — leave it intact; only ADD new route registrations.

> Reminder: commits are deferred until all backend work is done. ADR-029's `llm_judge: true` pre-commit pass will advisory-flag any voice-path diff; resolve in-session via `/adr-kit:judge` at commit time. ADR-030 declaratively forbids `.agents.create(` / `.agents.delete(` anywhere under `apps/backend/src/**` — the conversational adapter must never call them. ADR-031 declaratively forbids reading `ELEVENLABS_WEBHOOK_SECRET` in route handlers — only the shared verifier reads it.

---

## Implementation steps (build order: domain → application → infrastructure → presentation → composition)

### Step 1 — Domain: add `elevenLabsSessionId` correlation field to `Interview` (carried forward verbatim from stale plan)

**File:** `packages/domain/src/entities/interview/interview.entity.ts` (MODIFY)

**What:** Add an optional `elevenLabsSessionId: Option<string>` to the aggregate so webhook receivers and transcript persistence can correlate, plus a `bindElevenLabsSession()` mutator. Purely additive; the state machine is unchanged. The mutator allows **idempotent re-bind** within SCHEDULED or IN_PROGRESS (initiation may bind, session-start may re-bind to the same id — both must succeed without error).

**Code:**
```typescript
// constructor: add positional param after reportId
readonly elevenLabsSessionId: Option<string>,

// InterviewSerialized: add field
readonly elevenLabsSessionId: string | null;

// new mutator — SCHEDULED or IN_PROGRESS only; idempotent re-bind allowed
bindElevenLabsSession(sessionId: string): Result<Interview, InvalidInterviewStateTransitionError> {
  if (
    this.status !== INTERVIEW_STATUS.SCHEDULED &&
    this.status !== INTERVIEW_STATUS.IN_PROGRESS
  ) {
    return Result.Err(
      new InvalidInterviewStateTransitionError(this.status, this.status),
    );
  }
  // Idempotent re-bind: if same session id is already bound, return self unchanged.
  const alreadyBound = this.elevenLabsSessionId.match({
    Some: (s) => s === sessionId,
    None: () => false,
  });
  if (alreadyBound) return Result.Ok(this);
  return Result.Ok(this.withChanges({ elevenLabsSessionId: Option.Some(sessionId) }));
}

// serialize(): elevenLabsSessionId: this.elevenLabsSessionId.match({ Some: (s) => s, None: () => null }),
// fromSerialized(): data.elevenLabsSessionId === null ? Option.None : Option.Some(data.elevenLabsSessionId),
// create(): pass Option.None for the new slot
// withChanges() patch type + ctor call: thread elevenLabsSessionId through
```

**Invariant check:** Entity immutability — `withChanges()` returns a new instance; all props `readonly`; mutator returns `Result<Interview, DomainError>` never `void`. State machine untouched (ADR-031 keeps SCHEDULED/IN_PROGRESS/COMPLETED transitions). The Drizzle schema MUST gain a nullable `eleven_labs_session_id` column — see Step 11.

### Step 2 — Domain: barrel re-export check

**File:** `packages/domain/src/entities/interview/index.ts` (VERIFY/MODIFY)

**What:** Ensure `InterviewSerialized` (with the new field) and `Interview` remain exported. No new public type beyond the changed interface.

**Invariant check:** Barrel exports — downstream `@repo/application` consumes `InterviewSerialized` via `@repo/domain`.

---

### Step 3 — Application: new port `IConversationalAgentService` + error type (shape simplified vs. stale plan)

**File:** `packages/application/src/ports/conversational-agent/conversational-agent-error.ts` (CREATE)

**What:** Port-local error hierarchy extending `ServiceInfraError`. No SDK types leak.

**Code:**
```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export abstract class ConversationalAgentError extends ServiceInfraError {}

export class ConversationalAgentUnavailableError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_AGENT_UNAVAILABLE";
}

export class ConversationalSignedUrlFailedError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_SIGNED_URL_FAILED";
  constructor(message: string, readonly interviewId: string) { super(message); }
}

export class ConversationalTranscriptFetchFailedError extends ConversationalAgentError {
  readonly code = "CONVERSATIONAL_TRANSCRIPT_FETCH_FAILED";
  constructor(message: string, readonly elevenLabsSessionId: string) { super(message); }
}
```

**File:** `packages/application/src/ports/conversational-agent/conversational-agent.port.ts` (CREATE)

**Code:**
```typescript
import type { Result } from "@carbonteq/fp";
import type { Speaker } from "@repo/domain";
import type {
  ConversationalAgentError,
  ConversationalSignedUrlFailedError,
  ConversationalTranscriptFetchFailedError,
} from "./conversational-agent-error.js";

export interface IssueSignedUrlInput {
  readonly agentId: string;
}

export interface IssueSignedUrlOutput {
  readonly signedUrl: string;
}

/** TranscriptEntry-shaped wire rows — domain VO is built in PersistCompletedTranscript. */
export interface ConversationalTranscriptRow {
  readonly speaker: Speaker;
  readonly text: string;
  readonly timestamp: Date;
}

export interface IConversationalAgentService {
  /**
   * SDK-verified shape (ADR-030, ADR-031, @elevenlabs/elevenlabs-js@2.49.1):
   * accepts only { agentId }, returns only { signedUrl }. NO overrides at issuance.
   * The adapter MUST pass includeConversationId: true so the URL is single-use
   * (spike surprise #7), even though the SDK does not surface conversationId in
   * the response. Fresh URL is minted per connect attempt.
   */
  issueSignedUrl(
    input: IssueSignedUrlInput,
  ): Promise<Result<IssueSignedUrlOutput, ConversationalSignedUrlFailedError | ConversationalAgentError>>;

  getTranscript(
    elevenLabsSessionId: string,
  ): Promise<Result<ReadonlyArray<ConversationalTranscriptRow>, ConversationalTranscriptFetchFailedError | ConversationalAgentError>>;
}
```

**File:** `packages/application/src/ports/conversational-agent/index.ts` (CREATE) — re-export both files.
**File:** `packages/application/src/ports/index.ts` (MODIFY) — add `export * from "./conversational-agent/index.js";`

**Invariant check:** Port returns `Promise<Result<…, ConversationalAgentError>>`. No `@elevenlabs/*` import in `@repo/application`. `ConversationalAgentError extends ServiceInfraError` so it is a valid `ServiceError`. Overrides are **NOT** a port input (ADR-030/031 — overrides flow only through the synchronous initiation webhook response, assembled in `AssembleConversationInitiationContext`). `Speaker` is already a domain export.

### Step 4 — Application: new port `IConversationCorrelationTokenIssuer` (token issue + verify)

**File:** `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token-error.ts` (CREATE)

**What:** Port-local error for token verification failure.

**Code:**
```typescript
import { ServiceInfraError } from "../../core/service-error.js";

export class InvalidConversationCorrelationTokenError extends ServiceInfraError {
  readonly code = "INVALID_CONVERSATION_CORRELATION_TOKEN";
  constructor(message: string) { super(message); }
}
```

**File:** `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token.port.ts` (CREATE)

**Code:**
```typescript
import type { Result } from "@carbonteq/fp";
import type { InvalidConversationCorrelationTokenError } from "./conversation-correlation-token-error.js";

export interface ConversationCorrelationTokenPayload {
  readonly interviewId: string;
  /** Issue timestamp (ms since epoch). Verifier enforces TTL. */
  readonly issuedAtMs: number;
}

export interface IConversationCorrelationTokenIssuer {
  /** Issue an opaque, short-lived HMAC-signed token bound to interviewId. */
  issue(interviewId: string): string;

  /** Verify, decode payload, enforce TTL. Returns InvalidConversationCorrelationTokenError on any failure. */
  verify(token: string): Result<ConversationCorrelationTokenPayload, InvalidConversationCorrelationTokenError>;
}
```

**File:** `packages/application/src/ports/conversation-correlation-token/index.ts` (CREATE) — barrel.
**File:** `packages/application/src/ports/index.ts` (MODIFY) — re-export.

**Invariant check:** Port is a pure synchronous interface (no I/O). Implementation lives in infrastructure (`ConversationCorrelationToken`, `node:crypto` HMAC-SHA256, `timingSafeEqual`, dedicated secret `ELEVENLABS_SESSION_TOKEN_SECRET` — ADR-017 idiom). No new npm dependency.

### Step 5 — Application: `StartCandidateSessionUseCase`

**File:** `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` (CREATE)

**What:** Load interview, assert `SCHEDULED`, assert plan present (the plan is content for the initiation webhook, not for this call — but absence of plan is still an upstream bug worth surfacing), call `agent.issueSignedUrl({ agentId })`, issue a `sessionToken` via the correlation issuer, return `{ signedUrl, sessionToken }`. **Does NOT call `interview.start()`** (ADR-031: status flip deferred to the session-start webhook). **Does NOT bind `elevenLabsSessionId`** — that happens in `AssembleConversationInitiationContext` once the `conversation_id` is observed in a webhook payload (ADR-031: SDK's `ConversationSignedUrlResponseModel` returns only `{ signedUrl }`, no `conversation_id` at issuance).

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError, INTERVIEW_STATUS, InvalidInterviewInputError,
  type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { IConversationalAgentService } from "../../ports/conversational-agent/index.js";
import type { IConversationCorrelationTokenIssuer } from "../../ports/conversation-correlation-token/index.js";

export interface StartCandidateSessionInput {
  readonly interviewId: string;
  readonly agentId: string;
}

export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly sessionToken: string;
}

export class StartCandidateSessionUseCase extends UseCase<
  StartCandidateSessionInput, StartCandidateSessionOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly agent: IConversationalAgentService,
    private readonly tokens: IConversationCorrelationTokenIssuer,
  ) { super(); }

  async execute(
    input: StartCandidateSessionInput,
  ): Promise<Result<StartCandidateSessionOutput, ServiceError>> {
    const found = await this.interviews.findById(input.interviewId);
    if (found.isErr()) {
      return Result.Err(new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"));
    }
    return found.unwrap().match({
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
      Some: async (interview) => {
        if (interview.status !== INTERVIEW_STATUS.SCHEDULED) {
          return Result.Err(new InvalidInterviewInputError(`Interview ${interview.id} is not SCHEDULED`) as ServiceError);
        }
        const planAbsent = interview.interviewPlan.match({ None: () => true, Some: () => false });
        if (planAbsent) {
          return Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError);
        }
        const issued = await this.agent.issueSignedUrl({ agentId: input.agentId });
        if (issued.isErr()) return Result.Err(issued.unwrapErr() as ServiceError);
        const sessionToken = this.tokens.issue(interview.id);
        return Result.Ok({ signedUrl: issued.unwrap().signedUrl, sessionToken });
      },
    });
  }
}
```

**Invariant check:** No `agents.create` (ADR-030 — port only exposes `issueSignedUrl`/`getTranscript`). `interview.start()` NOT called (ADR-031). `bindElevenLabsSession` NOT called here (ADR-031 — binding happens in the initiation/session-start webhook handler). No JD/CV/plan/clientInstructions in the output (browser never carries content; ADR-030). Repo error → `ServiceUnknownError` at boundary. URL is single-use — controller is responsible for calling this use case once per connect attempt (spike surprise #7).

### Step 6 — Application: `AssembleConversationInitiationContextUseCase` (synchronous initiation webhook)

**File:** `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts` (CREATE)

**What:** Synchronous handler for the initiation webhook. Verify the correlation token (from `dynamic_variables.correlation_token` in the request body), load the interview, assemble the system-prompt override + dynamic variables, optionally bind `elevenLabsSessionId` when `conversation_id` is present in the payload, return a `ConversationInitiationContext` payload matching `ConversationInitiationClientDataRequestOutput` (controller serializes it to wire format). **Fail-closed**: any error returns an `Err` so the controller can return non-2xx and abort the conversation (ADR-031).

> Output type stays application-layer agnostic of SDK types (the controller maps to ElevenLabs' exact JSON shape via `conversationConfigOverride.agent.prompt.prompt` and `dynamicVariables`).

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError, INTERVIEW_STATUS, InvalidInterviewInputError,
  type IInterviewRepository, type Option,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";
import type { IConversationCorrelationTokenIssuer } from "../../ports/conversation-correlation-token/index.js";
import { assembleInterviewSystemPrompt } from "./system-prompt-assembler.js";

export interface AssembleInitiationInput {
  readonly correlationToken: string;
  /** Present when ElevenLabs includes it in the initiation payload; binds elevenLabsSessionId. */
  readonly conversationId: Option<string>;
}

export interface AssembleInitiationOutput {
  /** Becomes conversationConfigOverride.agent.prompt.prompt in the wire payload. */
  readonly systemPrompt: string;
  /** Optional first-message override (allow-list bit must be set on the agent — spike surprise #2). */
  readonly firstMessage?: string;
  /** Becomes dynamicVariables on the wire payload. */
  readonly dynamicVariables: Readonly<Record<string, string>>;
}

export class AssembleConversationInitiationContextUseCase extends UseCase<
  AssembleInitiationInput, AssembleInitiationOutput
> {
  constructor(
    private readonly interviews: IInterviewRepository,
    private readonly tokens: IConversationCorrelationTokenIssuer,
  ) { super(); }

  async execute(input: AssembleInitiationInput): Promise<Result<AssembleInitiationOutput, ServiceError>> {
    // 1) Verify token (HMAC + TTL). Fail-closed.
    const verified = this.tokens.verify(input.correlationToken);
    if (verified.isErr()) return Result.Err(verified.unwrapErr() as ServiceError);
    const { interviewId } = verified.unwrap();

    // 2) Load aggregate.
    const found = await this.interviews.findById(interviewId);
    if (found.isErr()) {
      return Result.Err(new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"));
    }
    return found.unwrap().match({
      None: () => Result.Err(new InterviewNotFoundError(interviewId) as ServiceError),
      Some: async (interview) => {
        if (
          interview.status !== INTERVIEW_STATUS.SCHEDULED &&
          interview.status !== INTERVIEW_STATUS.IN_PROGRESS
        ) {
          return Result.Err(new InvalidInterviewInputError(
            `Interview ${interview.id} cannot initiate from status ${interview.status}`,
          ) as ServiceError);
        }
        const planResult = interview.interviewPlan.match({
          None: () => Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError),
          Some: (p) => Result.Ok(p),
        });
        if (planResult.isErr()) return planResult;
        const plan = planResult.unwrap();

        // 3) Bind elevenLabsSessionId WHEN conversation_id is present in the initiation payload.
        const maybeBound = input.conversationId.match({
          None: () => Result.Ok(interview),
          Some: (cid) => interview.bindElevenLabsSession(cid),
        });
        if (maybeBound.isErr()) return Result.Err(maybeBound.unwrapErr() as ServiceError);
        const next = maybeBound.unwrap();

        // 4) Persist binding (no-op if interview === next due to idempotent re-bind).
        if (next !== interview) {
          const saved = await this.interviews.save(next);
          if (saved.isErr()) {
            return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
          }
        }

        // 5) Assemble overrides — sensitive content stays server-side (ADR-030 security clause).
        const systemPrompt = assembleInterviewSystemPrompt({
          jobDescription: next.jobDescription,
          candidateInfo: next.candidateInfo,
          clientInstructions: next.clientInstructions,
          interviewPlan: plan,
        });
        return Result.Ok({
          systemPrompt,
          firstMessage: undefined, // optional override; allow-list bit (agent.firstMessage) must be set on agent
          dynamicVariables: {
            candidate_name: next.candidateInfo.fullName,
            job_title: next.jobDescription.title,
            target_duration_minutes: String(plan.targetDurationMinutes),
            interview_id: next.id,
          },
        });
      },
    });
  }
}
```

**Invariant check:** Fail-closed on token verify, repo error, missing aggregate, missing plan, illegal status, or save failure (controller maps every `Err` to non-2xx — see Step 13). Single repo read + (optional) save + prompt assembly — no LLM/external-API calls in the critical path (ADR-031 latency constraint). `bindElevenLabsSession` is idempotent re-bind in SCHEDULED **or** IN_PROGRESS (ADR-031 — session-start fallback may have already bound). No `@elevenlabs/*` import.

### Step 7 — Application: webhook-receiver use cases (all idempotent)

All receivers share a shape: load the interview by id, apply the domain mutation, treat `InvalidInterviewStateTransitionError` as an idempotent no-op (`Ok({ applied: false })`), save on success. IN_PROGRESS-gated guards (`appendNote`/`appendInternalScore`) and SCHEDULED-gated `start()` provide natural at-least-once idempotency (ADR-031).

#### Step 7a — `StartInterviewFromWebhookUseCase` (session-start webhook, a.k.a. `conversation_started`)

**File:** `packages/application/src/use-cases/interview/start-interview-from-webhook.use-case.ts` (CREATE)

**What:** SCHEDULED → IN_PROGRESS via `interview.start(occurredAt)`. **Also a fallback binder**: if `elevenLabsSessionId` is not yet bound, bind it from `conversation_id` in the payload. Both operations are idempotent (re-bind allowed; duplicate `start()` returns no-op).

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import {
  InterviewNotFoundError, INTERVIEW_STATUS, type IInterviewRepository,
} from "@repo/domain";
import { ServiceUnknownError, type ServiceError } from "../../core/service-error.js";
import { UseCase } from "../../core/use-case.js";

export interface StartFromWebhookInput {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
}
export interface WebhookReceiverOutput { readonly applied: boolean; }

export class StartInterviewFromWebhookUseCase extends UseCase<StartFromWebhookInput, WebhookReceiverOutput> {
  constructor(private readonly interviews: IInterviewRepository) { super(); }
  async execute(input: StartFromWebhookInput): Promise<Result<WebhookReceiverOutput, ServiceError>> {
    const found = await this.interviews.findById(input.interviewId);
    if (found.isErr()) return Result.Err(new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"));
    return found.unwrap().match({
      None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
      Some: async (interview) => {
        // 1) Fallback bind (idempotent — initiation may have already bound the same id).
        const bound = interview.bindElevenLabsSession(input.elevenLabsSessionId);
        if (bound.isErr()) return Result.Ok({ applied: false }); // illegal state = treat as no-op
        const afterBind = bound.unwrap();
        // 2) Start (SCHEDULED → IN_PROGRESS). Duplicate or illegal state = idempotent no-op.
        if (afterBind.status !== INTERVIEW_STATUS.SCHEDULED) {
          // Persist any binding change even when start is a no-op.
          if (afterBind !== interview) {
            const saveOnly = await this.interviews.save(afterBind);
            if (saveOnly.isErr()) return Result.Err(new ServiceUnknownError(saveOnly.unwrapErr().message, "InterviewRepository.save"));
          }
          return Result.Ok({ applied: false });
        }
        const started = afterBind.start(input.occurredAt);
        if (started.isErr()) return Result.Ok({ applied: false });
        const saved = await this.interviews.save(started.unwrap());
        if (saved.isErr()) return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
        return Result.Ok({ applied: true });
      },
    });
  }
}
```

#### Step 7b — `RecordAgentNoteUseCase`, `RecordInternalScoreUseCase`, `EndInterviewFromAgentUseCase`

**Files:**
- `record-agent-note.use-case.ts` (CREATE) — load interview, `AgentNote.create({ note, recordedAtTurn, recordedAt })`, `interview.appendNote(note)`. `appendNote` `InvalidInterviewStateTransitionError` (not IN_PROGRESS) → `Ok({ applied: false })`. Empty note → real `InvalidInterviewInputError`. Save on success. `recordedAtTurn` from payload (default `0` if absent).
- `record-internal-score.use-case.ts` (CREATE) — same shape, `AgentInternalScore.create({ topicName, score, justification, recordedAtTurn, recordedAt })`, `interview.appendInternalScore(score)`. Score outside `[0,5]` → real `InvalidInterviewInputError` (genuine bad payload). Not IN_PROGRESS → idempotent no-op.
- `end-interview-from-agent.use-case.ts` (CREATE) — Trigger: ElevenLabs dispatches a tool-call webhook when the agent invokes the **built-in `end_call` system tool** (spike surprise #5 — NOT a custom tool). Records `endReason` as an `AgentNote` (e.g. `"[end_call] reason=<reason>"`) via `appendNote`. **Does NOT complete the aggregate** (ADR-031 — completion is the post-call webhook's job). Idempotent: not IN_PROGRESS → `Ok({ applied: false })`.

> Capturing `endReason` as a note avoids a new domain field. If a future reviewer prefers a first-class `endReason`, that is a larger domain change deferred to a follow-up; default = note capture.

#### Step 7c — `PersistCompletedTranscriptUseCase` (workspace-scoped post-call webhook receiver)

**File:** `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` (CREATE)

**What:** Triggered by the workspace-scoped fire-and-forget post-call webhook (spike surprise #6). The controller correlates `conversation_id` from the payload to an `Interview` via the stored `elevenLabsSessionId` column. The use case calls `agent.getTranscript(elevenLabsSessionId)`, filters empty-text rows, builds `TranscriptEntry` VOs via `Result.all`, calls `interview.complete(at, transcript)`, saves. Already-COMPLETED/EVALUATED → idempotent no-op.

**Code (key shape):**
```typescript
// load by id; already COMPLETED/EVALUATED → Result.Ok({ applied: false, entryCount: 0 })
const rowsResult = await this.agent.getTranscript(input.elevenLabsSessionId);
if (rowsResult.isErr()) return Result.Err(rowsResult.unwrapErr() as ServiceError);
const entries = Result.all(
  ...rowsResult.unwrap()
    .filter((r) => r.text.trim().length > 0) // TranscriptEntry non-empty invariant (ADR-031)
    .map((r) => TranscriptEntry.create({ speaker: r.speaker, text: r.text, timestamp: r.timestamp })),
);
if (entries.isErr()) return Result.Err(entries.unwrapErr() as ServiceError);
const completed = interview.complete(input.occurredAt, entries.unwrap());
if (completed.isErr()) return Result.Ok({ applied: false, entryCount: 0 }); // already completed = no-op
const saved = await this.interviews.save(completed.unwrap());
// map saved error → ServiceUnknownError; else Result.Ok({ applied: true, entryCount: entries.unwrap().length })
```

Output `{ applied: boolean; entryCount: number }` so the controller stamps ADR-032 D4 `transcript.entry_count`.

**File:** `packages/application/src/use-cases/interview/index.ts` (MODIFY) — export all 7 new use cases + input/output types.

**Invariant check:** No `throw`/`try`/`null`. Use cases return `Promise<Result<…, ServiceError>>`. Idempotency = treat illegal-transition domain errors as `Ok({ applied: false })` (ADR-031 Enforcement). Empty-text filter before `TranscriptEntry.create` (ADR-031). `Result.all` aggregates VO construction.

---

### Step 8 — Infrastructure: conversational provider handle

**File:** `apps/backend/src/infrastructure/services/elevenlabs/conversational-provider.ts` (CREATE)

**What:** NEW handle constructing the `@elevenlabs/elevenlabs-js` client + reading `ELEVENLABS_AGENT_ID`. Kept separate from the sandwich `provider.ts` (deprecated `elevenlabs` pkg) — the two clients live in SEPARATE files and never share a handle (spike-aligned). Fail-fast `Result`.

**Code:**
```typescript
import { Result } from "@carbonteq/fp";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ServiceUnavailableError } from "@repo/application";

export interface ConversationalClientHandle {
  readonly client: ElevenLabsClient;
  readonly agentId: string;
}

export const conversationalClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Result<ConversationalClientHandle, ServiceUnavailableError> => {
  const apiKey = env["ELEVENLABS_API_KEY"];
  const agentId = env["ELEVENLABS_AGENT_ID"];
  if (!apiKey) return Result.Err(new ServiceUnavailableError("ELEVENLABS_API_KEY is required"));
  if (!agentId) return Result.Err(new ServiceUnavailableError("ELEVENLABS_AGENT_ID is required (ADR-030 static agent)"));
  return Result.Ok({ client: new ElevenLabsClient({ apiKey }), agentId });
};
```

**Invariant check:** Fail-fast env parse returns `Result`, mirroring existing `fromEnv` helpers. New SDK package `@elevenlabs/elevenlabs-js` (sandwich keeps `elevenlabs`).

### Step 9 — Infrastructure: `ElevenLabsConversationalService`

**File:** `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts` (CREATE)

**What:** Implements `IConversationalAgentService`.
- `issueSignedUrl({ agentId })` calls `client.conversationalAi.conversations.getSignedUrl({ agentId, includeConversationId: true })` (SDK-verified shape — only `agentId` accepted; `includeConversationId: true` makes the URL single-use per spike surprise #7). Returns `{ signedUrl }`.
- `getTranscript(elevenLabsSessionId)` calls `client.conversationalAi.conversations.get(elevenLabsSessionId)` and maps the returned message list to `ConversationalTranscriptRow[]` with `agent`/`candidate` speaker mapping.
- Throwing SDK calls wrapped in `Result.tryAsyncCatch`; SDK errors translated to port error types at the boundary.
- NEVER calls `.agents.create()`/`.agents.delete()` (ADR-030 declarative forbid).

**Code (shape):**
```typescript
import { Result } from "@carbonteq/fp";
import type {
  IConversationalAgentService, IssueSignedUrlInput, IssueSignedUrlOutput,
  ConversationalTranscriptRow,
} from "@repo/application";
import {
  ConversationalSignedUrlFailedError, ConversationalTranscriptFetchFailedError,
} from "@repo/application";
import { SPEAKER } from "@repo/domain";
import type { ConversationalClientHandle } from "./conversational-provider.js";

export class ElevenLabsConversationalService implements IConversationalAgentService {
  constructor(private readonly handle: ConversationalClientHandle) {}

  async issueSignedUrl(input: IssueSignedUrlInput) {
    return Result.tryAsyncCatch(
      async (): Promise<IssueSignedUrlOutput> => {
        const res = await this.handle.client.conversationalAi.conversations.getSignedUrl({
          agentId: input.agentId,
          includeConversationId: true, // single-use signed URL (spike surprise #7)
        });
        return { signedUrl: res.signedUrl };
      },
      (e) => new ConversationalSignedUrlFailedError(
        e instanceof Error ? e.message : String(e),
        /* interviewId unknown at adapter — pass agentId for context */ input.agentId,
      ),
    );
  }

  async getTranscript(elevenLabsSessionId: string) {
    return Result.tryAsyncCatch(
      async (): Promise<ReadonlyArray<ConversationalTranscriptRow>> => {
        const res = await this.handle.client.conversationalAi.conversations.get(elevenLabsSessionId);
        const messages = res.transcript ?? [];
        return messages.map((m) => ({
          speaker: m.role === "agent" ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
          text: String(m.message ?? ""),
          timestamp: new Date(), // exact timestamp source verified against GetConversationResponseModel at execution time
        }));
      },
      (e) => new ConversationalTranscriptFetchFailedError(
        e instanceof Error ? e.message : String(e), elevenLabsSessionId,
      ),
    );
  }
}
```

**File:** `apps/backend/src/infrastructure/services/elevenlabs/index.ts` (MODIFY) — export new service + provider (keep existing TTS exports).

**Invariant check:** `Result.tryAsyncCatch` wraps the throwing SDK. Infra → port error translation at the boundary. No `.agents.create`/`.agents.delete` (ADR-030 forbid_pattern). `includeConversationId: true` (spike surprise #7). No interview content placed in `getSignedUrl` payload (ADR-030 — `getSignedUrl` accepts only `agentId`).

### Step 10 — Infrastructure: `ConversationCorrelationToken` HMAC helper (port impl)

**File:** `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts` (CREATE)

**What:** Implements `IConversationCorrelationTokenIssuer` using the ADR-017 idiom (`node:crypto` HMAC-SHA256, `timingSafeEqual`, base64url, no external deps). Token shape: `base64url(JSON({ interviewId, issuedAtMs })).<hmac>`. TTL configurable (default 5 minutes — covers conversation-start latency). Dedicated secret `ELEVENLABS_SESSION_TOKEN_SECRET` (separate from `CANDIDATE_LINK_SECRET` and `ELEVENLABS_WEBHOOK_SECRET`).

**Code (shape):**
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import {
  type IConversationCorrelationTokenIssuer,
  type ConversationCorrelationTokenPayload,
  InvalidConversationCorrelationTokenError,
} from "@repo/application";

export interface ConversationCorrelationTokenConfig {
  readonly secret: string;
  readonly ttlMs: number; // suggest 5 * 60_000
}

export class ConversationCorrelationToken implements IConversationCorrelationTokenIssuer {
  constructor(private readonly config: ConversationCorrelationTokenConfig) {}

  issue(interviewId: string): string {
    const payload: ConversationCorrelationTokenPayload = { interviewId, issuedAtMs: Date.now() };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.config.secret).update(payloadB64).digest("base64url");
    return `${payloadB64}.${sig}`;
  }

  verify(token: string): Result<ConversationCorrelationTokenPayload, InvalidConversationCorrelationTokenError> {
    const parts = token.split(".");
    if (parts.length !== 2) return Result.Err(new InvalidConversationCorrelationTokenError("Malformed token"));
    const [payloadB64, providedSig] = parts;
    const expected = createHmac("sha256", this.config.secret).update(payloadB64).digest();
    const provided = Buffer.from(providedSig, "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return Result.Err(new InvalidConversationCorrelationTokenError("Signature mismatch"));
    }
    let payload: ConversationCorrelationTokenPayload;
    try { payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); }
    catch { return Result.Err(new InvalidConversationCorrelationTokenError("Malformed payload")); }
    if (Date.now() - payload.issuedAtMs > this.config.ttlMs) {
      return Result.Err(new InvalidConversationCorrelationTokenError("Token expired"));
    }
    return Result.Ok(payload);
  }
}

export function conversationCorrelationTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ConversationCorrelationToken, Error> {
  const secret = env["ELEVENLABS_SESSION_TOKEN_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(new Error("ELEVENLABS_SESSION_TOKEN_SECRET must be set (>= 32 chars)"));
  }
  return Result.Ok(new ConversationCorrelationToken({ secret, ttlMs: 5 * 60_000 }));
}
```

**File:** `apps/backend/src/infrastructure/auth/index.ts` (MODIFY) — export the token issuer + `fromEnv`.

**Invariant check:** No new npm dep. `timingSafeEqual` only. Length-check before compare. TTL enforced. Dedicated secret (separate failure surface from `ELEVENLABS_WEBHOOK_SECRET` / `CANDIDATE_LINK_SECRET`).

### Step 11 — Infrastructure: HMAC webhook verifier (carried forward from stale plan)

**File:** `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` (CREATE)

**What:** Mirror `candidate-signed-link.ts`: `node:crypto` HMAC-SHA256 + `timingSafeEqual`, secret from `ELEVENLABS_WEBHOOK_SECRET`. ElevenLabs sends an `ElevenLabs-Signature` header `t=<ts>,v0=<hex>`; verify `HMAC(secret, "<t>.<rawBody>") === v0`. Takes the raw body string + signature header → `Result<void, InvalidWebhookSignatureError>`.

Used by ALL fire-and-forget webhook routes (`/session-start`, `/tools`, `/post-call`). The **synchronous initiation webhook** (`/initiation`) is NOT verified by this helper — its authenticity comes from the correlation token (`ConversationCorrelationToken.verify`) rather than the workspace-level webhook HMAC.

**Code:** identical to the stale plan's Step 8 code block (`ElevenLabsWebhookVerifier` class + `elevenLabsWebhookVerifierFromEnv` factory).

**File:** `apps/backend/src/infrastructure/auth/index.ts` (MODIFY) — export verifier + factory.

**Invariant check:** `timingSafeEqual`, stdlib only, no new dependency (ADR-031). Exact header format/algorithm confirmed against ElevenLabs webhook docs at execution time. Route handlers MUST read RAW body via scoped content-type parser. ADR-031 forbid_pattern: route handlers must NOT read `ELEVENLABS_WEBHOOK_SECRET` directly; only this verifier reads it.

### Step 12 — Infrastructure: startup agent-config assertion adapter

**File:** `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts` (CREATE)

**What:** A startup adapter that calls `client.conversationalAi.agents.get(agentId)` once at boot and **fails fast** if the static agent is not configured per spike surprises #1 and #2:

- `platformSettings.overrides.enableConversationInitiationClientDataFromWebhook === true` (surprise #1)
- `platformSettings.overrides.conversationConfigOverride.agent.prompt.prompt === true` (surprise #2, allow-list bit for system-prompt override)
- `platformSettings.overrides.conversationConfigOverride.agent.firstMessage === true` (surprise #2, allow-list bit for first-message override — set defensively even though Step 6 currently passes `firstMessage: undefined`; reviewer-flagged drift guard)

Without these flags, the per-session prompt override is **silently dropped** by ElevenLabs, breaking every interview. The assertion fails the boot with a precise message naming which flag is missing.

**Code (shape):**
```typescript
import { Result } from "@carbonteq/fp";
import type { ConversationalClientHandle } from "./conversational-provider.js";

export class AgentConfigDriftError extends Error {
  readonly code = "AGENT_CONFIG_DRIFT";
}

export async function assertElevenLabsAgentConfig(
  handle: ConversationalClientHandle,
): Promise<Result<void, AgentConfigDriftError>> {
  return Result.tryAsyncCatch(
    async () => {
      const agent = await handle.client.conversationalAi.agents.get(handle.agentId);
      const overrides = agent.platformSettings?.overrides;
      const flag = overrides?.enableConversationInitiationClientDataFromWebhook;
      const promptAllow = overrides?.conversationConfigOverride?.agent?.prompt?.prompt;
      const firstMsgAllow = overrides?.conversationConfigOverride?.agent?.firstMessage;
      const problems: string[] = [];
      if (flag !== true) problems.push("platformSettings.overrides.enableConversationInitiationClientDataFromWebhook must be true");
      if (promptAllow !== true) problems.push("platformSettings.overrides.conversationConfigOverride.agent.prompt.prompt must be true");
      if (firstMsgAllow !== true) problems.push("platformSettings.overrides.conversationConfigOverride.agent.firstMessage must be true");
      if (problems.length > 0) {
        throw new AgentConfigDriftError(
          `ElevenLabs agent ${handle.agentId} config drift (spike surprises #1, #2):\n- ${problems.join("\n- ")}`,
        );
      }
      return undefined;
    },
    (e) => e instanceof AgentConfigDriftError
      ? e
      : new AgentConfigDriftError(`Failed to fetch agent ${handle.agentId}: ${e instanceof Error ? e.message : String(e)}`),
  );
}
```

**Invariation:** Boot-time call, single network round-trip. Composition awaits this and throws on `Err` so the process never starts with a misconfigured agent. No interview is left to silently break in production.

### Step 13 — Infrastructure: Drizzle schema + repo mapping for `elevenLabsSessionId`

**File:** `apps/backend/src/infrastructure/persistence/schema/interviews.ts` (MODIFY)

**What:** Add nullable `elevenLabsSessionId: text("eleven_labs_session_id")` column to the interviews table; thread it through `DrizzleInterviewRepository.save()` and row→`InterviewSerialized` mapping. Generate a migration via `pnpm --filter backend db:generate`.

**Invariant check:** Whole-aggregate upsert via `save()` unchanged in shape; only one nullable column added. `RepositoryError` must not leak (existing repo returns `Result<…, Error>`; use cases translate to `ServiceUnknownError`). Migration is a deploy-time step.

---

### Step 14 — Presentation: candidate-session controller (OTel span D1)

**File:** `apps/backend/src/presentation/controllers/candidate-session.controller.ts` (CREATE)

**What:** `POST /interviews/:id/candidate-session?token=…`. Verify the **candidate signed-link** token (ADR-017 — reuses the existing `CandidateLinkVerifier`) and bind `interviewId === params.id`. NOT recruiter-auth-gated. Open D1 span `interview.session.conversational` BEFORE the use case; set `interview.id` at open; set `elevenLabs.agentId` on success (no `elevenLabs.sessionId` yet — that is bound later in the initiation/session-start webhook). `error`/`error.kind` on error path; close in `finally`. Map errors via `mapServiceErrorToHttp`. Return `{ signedUrl, sessionToken }`.

**Code (shape):**
```typescript
import { trace } from "@opentelemetry/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InvalidCandidateTokenError, type ServiceError } from "@repo/application";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.session");

export class CandidateSessionController {
  constructor(private readonly deps: CandidateSessionControllerDeps) {}
  async start(req: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>, reply: FastifyReply): Promise<void> {
    const interviewId = req.params.id;
    const span = tracer.startSpan("interview.session.conversational", { attributes: { "interview.id": interviewId } });
    try {
      const token = req.query.token;
      if (!token) return sendError(reply, new InvalidCandidateTokenError("Candidate token is required"));
      const verified = this.deps.candidateLink.verify(token);
      if (verified.isErr()) return sendError(reply, verified.unwrapErr());
      if (verified.unwrap().interviewId !== interviewId) {
        return sendError(reply, new InvalidCandidateTokenError("Token does not match interview"));
      }
      const result = await this.deps.startCandidateSessionUseCase.execute({
        interviewId,
        agentId: this.deps.agentId,
      });
      if (result.isErr()) {
        const e = result.unwrapErr();
        span.setAttribute("error", true);
        span.setAttribute("error.kind", e.code);
        return sendError(reply, e);
      }
      const out = result.unwrap();
      span.setAttribute("elevenLabs.agentId", this.deps.agentId);
      await reply.code(200).send({ signedUrl: out.signedUrl, sessionToken: out.sessionToken });
    } finally { span.end(); }
  }
}
function sendError(reply: FastifyReply, error: ServiceError): void {
  const { status, body } = mapServiceErrorToHttp(error);
  reply.code(status).send(body);
}
```

**Invariant check (ADR-032):** Span name uses `interview.` prefix (forbid_pattern guard). Opened before first `await`, closed in `finally`. No span opened in the use case. Presentation imports `@repo/application` + injected verifier interface only. Spike surprise #7: URL is single-use — frontend is responsible for calling this endpoint once per connect attempt (a fresh `sessionToken` is also issued per call).

**File:** `apps/backend/src/presentation/routes/candidate-session.routes.ts` (CREATE) — `FastifyPluginAsync` registering `POST /interviews/:id/candidate-session` against `CandidateSessionController.start`.

### Step 15 — Presentation: ElevenLabs **synchronous initiation** webhook controller (OTel span D5)

**File:** `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts` (CREATE)

**What:** `POST /webhooks/elevenlabs/initiation`. **SYNCHRONOUS request/response** — ElevenLabs blocks waiting for our response carrying `ConversationInitiationClientDataRequestOutput` (ADR-031). Open D5 span `interview.webhook.initiation` as the FIRST statement (before any `await`, before any header read). Extract `correlation_token` from `body.dynamic_variables` (type-confirmed; live-unverified per spike surprise #3). Extract `conversation_id` from the body when present (Option). Call `AssembleConversationInitiationContextUseCase.execute({ correlationToken, conversationId })`. On `Ok`, return 200 with the wire-shape JSON. On `Err`, **fail-closed** — return non-2xx (401 for token errors, 5xx for repo/internal). Stamp `interview.id` from the verified token, `elevenlabs.conversation_id` when present, `interview.initiation.override_assembled: true` on success, `error`/`error.kind` on error. Close span in `finally`.

This endpoint is **NOT verified by `ElevenLabsWebhookVerifier`** — its authenticity comes from the correlation-token HMAC verification done inside `AssembleConversationInitiationContextUseCase` (via `IConversationCorrelationTokenIssuer.verify`).

**Code (shape):**
```typescript
import { trace } from "@opentelemetry/api";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Option } from "@carbonteq/fp";
import { mapServiceErrorToHttp } from "../errors/http-error-mapper.js";

const tracer = trace.getTracer("ai-interviewer.webhook");

interface InitiationRequestBody {
  readonly conversation_id?: string;
  readonly dynamic_variables?: Record<string, string>;
}

export class ElevenLabsInitiationWebhookController {
  constructor(private readonly deps: InitiationWebhookControllerDeps) {}
  async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const span = tracer.startSpan("interview.webhook.initiation"); // FIRST statement
    try {
      const body = (req.body ?? {}) as InitiationRequestBody;
      const correlationToken = body.dynamic_variables?.["correlation_token"];
      const conversationIdOpt = body.conversation_id ? Option.Some(body.conversation_id) : Option.None;
      if (body.conversation_id) span.setAttribute("elevenlabs.conversation_id", body.conversation_id);
      if (!correlationToken) {
        span.setAttribute("error", true);
        span.setAttribute("error.kind", "MISSING_CORRELATION_TOKEN");
        return reply.code(401).send({ error: { code: "MISSING_CORRELATION_TOKEN", message: "rejected" } });
      }
      const result = await this.deps.assembleContextUseCase.execute({
        correlationToken,
        conversationId: conversationIdOpt,
      });
      if (result.isErr()) {
        const e = result.unwrapErr();
        span.setAttribute("error", true);
        span.setAttribute("error.kind", e.code);
        const { status, body: errBody } = mapServiceErrorToHttp(e);
        // Initiation is fail-closed: any non-2xx aborts the conversation (ADR-031).
        return reply.code(status).send(errBody);
      }
      const ctx = result.unwrap();
      span.setAttribute("interview.initiation.override_assembled", true);
      // Wire shape: ConversationInitiationClientDataRequestOutput.
      return reply.code(200).send({
        conversation_config_override: {
          agent: {
            prompt: { prompt: ctx.systemPrompt },
            ...(ctx.firstMessage ? { first_message: ctx.firstMessage } : {}),
          },
        },
        dynamic_variables: ctx.dynamicVariables,
      });
    } finally { span.end(); }
  }
}
```

**File:** `apps/backend/src/presentation/routes/webhooks/elevenlabs-initiation-webhook.routes.ts` (CREATE) — `FastifyPluginAsync` registering `POST /` (mounted at prefix `/webhooks/elevenlabs/initiation`). Register a scoped raw-body content-type parser so the controller still reads `req.body` as parsed JSON (initiation does not use the workspace HMAC, so no raw-body verification is needed here — but keep parser scoping consistent with the fire-and-forget routes for predictability). Does NOT inherit better-auth.

**Invariant check (ADR-031 fail-closed + ADR-032 D5):** Span opened before first `await`. Any error path returns non-2xx (ADR-031 Enforcement). Latency-bounded: single repo read + (optional) single save + prompt assembly (no LLM/external API). `interview.id` is stamped after token verify inside the use case — controller does not see the interviewId until the use case returns; stamp it from the use case output if needed (or accept that the trace carries `error.kind` instead of `interview.id` on token-rejection traces).

### Step 16 — Presentation: ElevenLabs **fire-and-forget** webhook controller (OTel spans D2, D3, D4) + routes

**File:** `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` (CREATE)

**Three endpoints**, all fire-and-forget, all HMAC-verified against `ELEVENLABS_WEBHOOK_SECRET`:
- `POST /webhooks/elevenlabs/session-start` — session-started (a.k.a. `conversation_started`) event. Spans `interview.webhook.session-start` (root, D2-family — same lifecycle pattern as D2 but named per ADR-032 namespace rule). Dispatches to `StartInterviewFromWebhookUseCase`.
- `POST /webhooks/elevenlabs/tools` — tool-call events. Span `interview.webhook.tool` (D2). Dispatches by `tool_name`:
  - `take_note` → `RecordAgentNote`
  - `score_answer` → `RecordInternalScore`
  - **`end_call`** (BUILT-IN SYSTEM TOOL, spike surprise #5) → `EndInterviewFromAgent`. Custom tool list on the agent is `next_question`, `score_answer`, `take_note` (three customs); `end_call` is the system tool whose invocation surfaces here as a tool-call webhook with an end-reason payload.
  - `next_question` → no mutation; 200 ack.
- `POST /webhooks/elevenlabs/post-call` — **workspace-scoped** post-call webhook (spike surprise #6). One shared HMAC endpoint across the workspace. Correlate by `conversation_id` in the payload → load interview where `eleven_labs_session_id = conversation_id` (a new repo query method may be needed, OR a query service — see Risk note below). Spans D3 `interview.webhook.session-end` (root) + nested D4 `interview.session.transcript-persist` wrapping `PersistCompletedTranscriptUseCase`.

For every handler: open the span as the FIRST statement (before signature verification, before any `await`) → verify HMAC on the raw body → on rejection set `webhook.result = "signature_rejected"`, reply 401, return → else parse payload, stamp `interview.id`/`elevenLabs.sessionId` (+ `webhook.tool_name` for tools) → dispatch to the use case → set `webhook.result = "ok" | "use_case_error"` → reply 200 on `Ok` (even idempotent no-ops, to suppress redelivery) or `mapServiceErrorToHttp` on a genuine error → close span in `finally`.

**Code (tool handler shape — carried forward from stale plan, refined):**
```typescript
const span = tracer.startSpan("interview.webhook.tool"); // FIRST statement, before any await (ADR-032)
try {
  const sig = req.headers["elevenlabs-signature"] as string | undefined;
  const verified = this.deps.verifier.verify(req.rawBody ?? "", sig);
  if (verified.isErr()) {
    span.setAttribute("webhook.result", "signature_rejected");
    return reply.code(401).send({ error: { code: "INVALID_WEBHOOK_SIGNATURE", message: "rejected" } });
  }
  const payload = parseToolPayload(req.body); // extract interview_id (from dynamic_variables), conversation_id, tool_name, args
  span.setAttribute("interview.id", payload.interviewId);
  span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
  span.setAttribute("webhook.tool_name", payload.toolName);
  const result = await this.dispatchTool(payload);
  if (result.isErr()) {
    span.setAttribute("webhook.result", "use_case_error");
    const { status, body } = mapServiceErrorToHttp(result.unwrapErr());
    return reply.code(status).send(body);
  }
  span.setAttribute("webhook.result", "ok");
  return reply.code(200).send({ ok: true });
} finally { span.end(); }
```

**Post-call handler specifics:** payload carries `conversation_id` (= our `elevenLabsSessionId`). Controller resolves `interviewId` via `interviews.findByElevenLabsSessionId(conversation_id)` (NEW repo method — see Step 13b/risk) before invoking `PersistCompletedTranscriptUseCase({ interviewId, elevenLabsSessionId, occurredAt })`. The D4 child span wraps the use-case call; controller stamps `transcript.entry_count` on success.

**File:** `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts` (CREATE) — `FastifyPluginAsync` registering `POST /session-start`, `POST /tools`, `POST /post-call`; mounted at prefix `/webhooks/elevenlabs`. Register a scoped `addContentTypeParser("application/json", …)` capturing `req.rawBody` so HMAC verifies the signed bytes. Does NOT inherit the better-auth pre-handler (ADR-031: public, HMAC-only).

**Invariant check (ADR-031 + ADR-032):** Signature verified BEFORE dispatch; verifier injected (route never reads `ELEVENLABS_WEBHOOK_SECRET` directly — forbid_pattern). Idempotent no-ops return 200. Spans opened first statement, `interview.` prefix, closed in `finally`. Presentation imports `@repo/application` + the injected verifier interface only.

---

### Step 17 — Composition: candidate-session deps

**File:** `apps/backend/src/composition/candidate-session.composition.ts` (CREATE)

**What:** Build `CandidateSessionControllerDeps`: `StartCandidateSessionUseCase(new DrizzleInterviewRepository(db), new ElevenLabsConversationalService(handle), new ConversationCorrelationToken(...))`, the injected `candidateLink` verifier, and `agentId` from the handle. Fail-fast on `conversationalClientFromEnv` error, fail-fast on `conversationCorrelationTokenFromEnv` error, fail-fast on `assertElevenLabsAgentConfig` error (boot throw, like `auth.composition.ts`).

```typescript
export async function buildCandidateSessionDeps(
  options: CandidateSessionCompositionOptions,
): Promise<CandidateSessionControllerDeps> {
  const handle = conversationalClientFromEnv(options.env ?? process.env);
  if (handle.isErr()) throw new Error(`Boot failed: ${handle.unwrapErr().message}`);
  const h = handle.unwrap();
  const tokens = conversationCorrelationTokenFromEnv(options.env ?? process.env);
  if (tokens.isErr()) throw new Error(`Boot failed: ${tokens.unwrapErr().message}`);
  const assertion = await assertElevenLabsAgentConfig(h);
  if (assertion.isErr()) throw assertion.unwrapErr(); // AgentConfigDriftError, fail boot
  const db: Database = options.db ?? require("../infrastructure/persistence/db.js").db;
  return {
    startCandidateSessionUseCase: new StartCandidateSessionUseCase(
      new DrizzleInterviewRepository(db),
      new ElevenLabsConversationalService(h),
      tokens.unwrap(),
    ),
    candidateLink: options.candidateLink,
    agentId: h.agentId,
  };
}
```

### Step 18 — Composition: initiation-webhook deps

**File:** `apps/backend/src/composition/elevenlabs-initiation-webhook.composition.ts` (CREATE)

**What:** Build the initiation-webhook controller deps: `AssembleConversationInitiationContextUseCase(new DrizzleInterviewRepository(db), token-issuer)`. Reuses the same `ConversationCorrelationToken` instance built via `conversationCorrelationTokenFromEnv`. Fail-fast on env errors. NO `ElevenLabsWebhookVerifier` injected here — initiation auth is the correlation token.

### Step 19 — Composition: fire-and-forget webhook deps

**File:** `apps/backend/src/composition/elevenlabs-webhook.composition.ts` (CREATE)

**What:** Build the fire-and-forget webhook controller deps: the verifier (`elevenLabsWebhookVerifierFromEnv(env)`, fail-fast), a `DrizzleInterviewRepository`, the `ElevenLabsConversationalService` (for transcript fetch), and the five receiver use cases (`StartInterviewFromWebhook`, `RecordAgentNote`, `RecordInternalScore`, `EndInterviewFromAgent`, `PersistCompletedTranscript`).

### Step 20 — Composition: register routes in `app.ts`

**File:** `apps/backend/src/app.ts` (MODIFY)

**What:** Add `candidateSession`, `elevenLabsInitiationWebhook`, and `elevenLabsWebhooks` to `BuildAppOptions`. Build under existing `composeDefaults` gating. Register:
- candidate-session at prefix `""` (final `/interviews/:id/candidate-session`)
- initiation-webhook at prefix `/webhooks/elevenlabs/initiation`
- fire-and-forget webhooks at prefix `/webhooks/elevenlabs`

Extend `composeDefaults` to include `&& !options.candidateSession && !options.elevenLabsInitiationWebhook && !options.elevenLabsWebhooks`. Sandwich WS block left intact.

```typescript
const candidateSession =
  options.candidateSession ??
  (composeDefaults && authDeps?.candidateLink
    ? { deps: await (await import("./composition/candidate-session.composition.js"))
        .buildCandidateSessionDeps({ candidateLink: authDeps.candidateLink }) }
    : undefined);
if (candidateSession) await app.register(registerCandidateSessionRoutes, { prefix: "", ...candidateSession });

const elevenLabsInitiationWebhook =
  options.elevenLabsInitiationWebhook ??
  (composeDefaults
    ? { deps: (await import("./composition/elevenlabs-initiation-webhook.composition.js"))
        .buildElevenLabsInitiationWebhookDeps() }
    : undefined);
if (elevenLabsInitiationWebhook) {
  await app.register(registerElevenLabsInitiationWebhookRoutes, {
    prefix: "/webhooks/elevenlabs/initiation", ...elevenLabsInitiationWebhook,
  });
}

const elevenLabsWebhooks =
  options.elevenLabsWebhooks ??
  (composeDefaults
    ? { deps: (await import("./composition/elevenlabs-webhook.composition.js")).buildElevenLabsWebhookDeps() }
    : undefined);
if (elevenLabsWebhooks) {
  await app.register(registerElevenLabsWebhookRoutes, {
    prefix: "/webhooks/elevenlabs", ...elevenLabsWebhooks,
  });
}
```

**Invariant check:** Webhook routes registered WITHOUT the better-auth pre-handler. Confirm whether `installAuthPlugin` is global or recruiter-scoped at execution time; if global, register each webhook plugin in an encapsulated child context that omits it. Candidate-session is token-gated, not recruiter-gated. Sandwich WS block untouched.

### Step 21 — Env + dependency wiring

**File:** `apps/backend/package.json` (MODIFY) — add `"@elevenlabs/elevenlabs-js": "^2.49.1"`. Keep `"elevenlabs": "^1.59.0"` (sandwich TTS). Run `pnpm install`.

**File:** `apps/backend/.env.example` (MODIFY) — add:
```
# ElevenLabs Conversational AI (Phase 9.5, ADR-029/030/031)
ELEVENLABS_AGENT_ID=your-static-agent-id-here
ELEVENLABS_WEBHOOK_SECRET=your-workspace-webhook-hmac-secret-here
ELEVENLABS_SESSION_TOKEN_SECRET=at-least-32-chars-random-bytes-base64
```

**Setup step (ops, ADR-030, CLI-as-code, spike-aligned):** The static agent is provisioned out-of-band:

1. Provision a `convai_write`-scoped ElevenLabs API key (spike HARD BLOCKER resolved per the spike doc).
2. Create the **3 custom tools** standalone (`next_question`, `score_answer`, `take_note`) and reference them via `toolIds` (spike surprise #4 — inline `tools` deprecated).
3. Configure the **built-in `end_call` system tool** (spike surprise #5) — NOT a custom tool.
4. Create the static agent with `conversationConfig.tts.voiceId = "EXAVITQu4vr4xnSDxMaL"`, the three custom tool ids + `end_call` system tool, guardrails, and CRITICALLY:
   - `platformSettings.overrides.enableConversationInitiationClientDataFromWebhook = true` (spike surprise #1)
   - `platformSettings.overrides.conversationConfigOverride.agent.prompt.prompt = true` (spike surprise #2)
   - `platformSettings.overrides.conversationConfigOverride.agent.firstMessage = true` (spike surprise #2, defensive)
   - Initiation webhook URL points at `<base>/webhooks/elevenlabs/initiation`.
   - Session-start webhook URL points at `<base>/webhooks/elevenlabs/session-start` (if separate from tools — confirm event-name vs URL routing at execution time).
   - Tool-call webhook URL points at `<base>/webhooks/elevenlabs/tools`.
5. Configure the **workspace-scoped post-call webhook** (spike surprise #6): one `WebhookHmacSettings` entry with URL `<base>/webhooks/elevenlabs/post-call`, `events: ["transcript","call_initiation_failure"]`. Persist the HMAC secret returned by the create response into `ELEVENLABS_WEBHOOK_SECRET`.
6. The resulting agent id goes into `ELEVENLABS_AGENT_ID`.
7. Generate a fresh 32-byte random secret for `ELEVENLABS_SESSION_TOKEN_SECRET`.

Document the agent id + config version. Manual/CLI step — NOT code in this plan.

**Invariant check:** All three new secrets are fail-fast boot env (`fromEnv` helpers return `Err`, composition throws `Boot failed: …`), matching `CANDIDATE_LINK_SECRET`:
- `ELEVENLABS_AGENT_ID` (Step 8)
- `ELEVENLABS_WEBHOOK_SECRET` (Step 11)
- `ELEVENLABS_SESSION_TOKEN_SECRET` (Step 10)

The agent-config assertion (Step 12) further fails boot when the static agent is misconfigured (spike surprises #1/#2 drift guard).

---

## Pseudo-workflows

### (a) POST `/interviews/:id/candidate-session?token=…`
1. Request → `CandidateSessionController.start()`. **D1 span `interview.session.conversational` opens (first statement, attr `interview.id`).**
2. Verify `token` present → `candidateLink.verify(token)` → `Result<{interviewId}, ServiceError>`; assert `interviewId === params.id`.
3. `StartCandidateSessionUseCase.execute({ interviewId, agentId })`.
4. `interviews.findById(id)` → `Promise<Result<Option<Interview>, Error>>`; repo error → `ServiceUnknownError`; `None` → `InterviewNotFoundError`.
5. Assert `status === SCHEDULED` + plan present.
6. `agent.issueSignedUrl({ agentId })` → `Result<{ signedUrl }, ConversationalAgentError>`. Adapter passes `includeConversationId: true` (single-use URL — spike surprise #7).
7. `tokens.issue(interviewId)` → `sessionToken` (HMAC-signed, 5-min TTL).
8. Use case returns `Ok({ signedUrl, sessionToken })`. **Controller stamps D1 `elevenLabs.agentId`.**
9. `reply.code(200).send({ signedUrl, sessionToken })`; on error `mapServiceErrorToHttp` + D1 `error`/`error.kind`. **D1 closes in `finally`.** Status stays SCHEDULED (ADR-031). `bindElevenLabsSession` NOT called here.

### (b) Browser starts ElevenLabs conversation (no backend touchpoint)
1. Frontend container takes `{ signedUrl, sessionToken }` and calls `Conversation.startSession({ signedUrl, dynamicVariables: { correlation_token: sessionToken } })` (spike recipe).
2. ElevenLabs assigns `conversation_id`.

### (c) Synchronous initiation webhook → `POST /webhooks/elevenlabs/initiation`
1. ElevenLabs calls our backend with `{ conversation_id?, dynamic_variables: { correlation_token, … } }`.
2. **D5 span `interview.webhook.initiation` opens (first statement).**
3. Extract `correlation_token` from body; if missing → 401, fail-closed.
4. Stamp `elevenlabs.conversation_id` when present in body.
5. `AssembleConversationInitiationContextUseCase.execute({ correlationToken, conversationId: Option })`.
6. `tokens.verify(correlationToken)` → on error, fail-closed → non-2xx → ElevenLabs aborts the conversation (ADR-031).
7. `findById(interviewId)` → load aggregate; assert SCHEDULED or IN_PROGRESS; plan present.
8. If `conversation_id` present, `interview.bindElevenLabsSession(conversation_id)` (idempotent re-bind) → save if changed.
9. Assemble `systemPrompt` via `assembleInterviewSystemPrompt(...)` (JD + CV summary + plan + clientInstructions).
10. Return `Ok({ systemPrompt, firstMessage?, dynamicVariables })`.
11. Controller serializes to wire shape: `{ conversation_config_override: { agent: { prompt: { prompt }, first_message? } }, dynamic_variables }`. Stamp `interview.initiation.override_assembled = true`. Reply 200.
12. **D5 closes in `finally`.** ElevenLabs unblocks; conversation begins specialized.

### (d) Session-start webhook → `POST /webhooks/elevenlabs/session-start`
1. ElevenLabs delivers fire-and-forget event with `conversation_id` + interview correlation (from dynamic_variables or webhook payload). **D2-family span `interview.webhook.session-start` opens (first statement).**
2. `verifier.verify(rawBody, signatureHeader)` → `Err` → `webhook.result = signature_rejected`, reply 401, return.
3. Parse → `interviewId`, `elevenLabsSessionId` (= `conversation_id`), `occurredAt`. Stamp span attrs.
4. `StartInterviewFromWebhookUseCase.execute({ interviewId, elevenLabsSessionId, occurredAt })`.
5. `findById` → `bindElevenLabsSession(elevenLabsSessionId)` (idempotent — initiation may have already bound) → `interview.start(at)` (SCHEDULED→IN_PROGRESS). Already IN_PROGRESS / illegal transition → `Ok({ applied: false })` (idempotent).
6. `save` on success. `webhook.result = ok`, reply 200 (even no-op, to suppress redelivery). Span closes in `finally`.

### (e) Tool webhook → `POST /webhooks/elevenlabs/tools`
1. **D2 span `interview.webhook.tool` opens (first statement).**
2. `verifier.verify(...)` → reject → 401, `webhook.result = signature_rejected`.
3. Parse → `interview_id` (from dynamic_variables), `elevenLabsSessionId` (= `conversation_id`), `tool_name`, args. Stamp `webhook.tool_name`.
4. Dispatch by `tool_name`:
   - `take_note` → `RecordAgentNote`
   - `score_answer` → `RecordInternalScore`
   - **`end_call`** (built-in system tool — spike surprise #5) → `EndInterviewFromAgent` (records reason as note; does NOT complete)
   - `next_question` → ack 200, no mutation
5. Receiver `findById` → build VO → `appendNote`/`appendInternalScore`. Not IN_PROGRESS (e.g. duplicate after COMPLETED) → `Ok({ applied: false })`. Invalid score range / empty note → real `InvalidInterviewInputError` (400). `save` on success.
6. `webhook.result = ok | use_case_error`; reply 200 (`Ok`) / mapped status (error). Span closes in `finally`.

### (f) Post-call webhook → `POST /webhooks/elevenlabs/post-call` (workspace-scoped)
1. **D3 span `interview.webhook.session-end` opens (first statement, attrs `elevenLabs.sessionId` from `conversation_id`).**
2. `verifier.verify(...)` → reject → 401, `webhook.result = signature_rejected`.
3. Resolve `interviewId` from `conversation_id` via `interviews.findByElevenLabsSessionId(conversation_id)` (NEW repo method — see risk note). If no match → 200 ack with `webhook.result = use_case_error` and `error.kind = INTERVIEW_NOT_FOUND` (workspace-shared endpoint may receive events for sessions outside our domain; do not 5xx — see Risk (d)).
4. Stamp `interview.id`. **Child span D4 `interview.session.transcript-persist` opens.**
5. `PersistCompletedTranscriptUseCase.execute({ interviewId, elevenLabsSessionId, occurredAt })`.
6. `findById` → already COMPLETED/EVALUATED → `Ok({ applied: false, entryCount: 0 })` (idempotent). Else `agent.getTranscript(elevenLabsSessionId)` → filter empty-text rows → `TranscriptEntry.create` via `Result.all` → `interview.complete(at, entries)` → `save`.
7. Controller stamps D4 `transcript.entry_count` (success) or `error`/`error.kind`. D4 closes; D3 `webhook.result = ok|use_case_error`, reply 200/mapped. D3 closes in `finally`.

---

## Entry points (innermost first)

| # | File | Layer | Op | Purpose |
|---|---|---|---|---|
| 1 | `packages/domain/src/entities/interview/interview.entity.ts` | @repo/domain | MODIFY | Add `elevenLabsSessionId` + idempotent `bindElevenLabsSession()`; serialize/fromSerialized |
| 2 | `packages/domain/src/entities/interview/index.ts` | @repo/domain | VERIFY | Ensure `Interview`/`InterviewSerialized` exported |
| 3 | `packages/application/src/ports/conversational-agent/conversational-agent-error.ts` | @repo/application | CREATE | Port error type |
| 4 | `packages/application/src/ports/conversational-agent/conversational-agent.port.ts` | @repo/application | CREATE | `IConversationalAgentService` (issue + transcript only, no overrides) |
| 5 | `packages/application/src/ports/conversational-agent/index.ts` | @repo/application | CREATE | Port barrel |
| 6 | `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token-error.ts` | @repo/application | CREATE | Token verify error |
| 7 | `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token.port.ts` | @repo/application | CREATE | `IConversationCorrelationTokenIssuer` |
| 8 | `packages/application/src/ports/conversation-correlation-token/index.ts` | @repo/application | CREATE | Port barrel |
| 9 | `packages/application/src/ports/index.ts` | @repo/application | MODIFY | Re-export new ports |
| 10 | `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` | @repo/application | CREATE | Issue signed URL + sessionToken |
| 11 | `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts` | @repo/application | CREATE | Synchronous initiation: verify token, assemble overrides, bind session id |
| 12 | `packages/application/src/use-cases/interview/start-interview-from-webhook.use-case.ts` | @repo/application | CREATE | session-started: SCHEDULED → IN_PROGRESS + fallback bind |
| 13 | `packages/application/src/use-cases/interview/record-agent-note.use-case.ts` | @repo/application | CREATE | take_note tool |
| 14 | `packages/application/src/use-cases/interview/record-internal-score.use-case.ts` | @repo/application | CREATE | score_answer tool |
| 15 | `packages/application/src/use-cases/interview/end-interview-from-agent.use-case.ts` | @repo/application | CREATE | end_call system tool — records reason as note |
| 16 | `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` | @repo/application | CREATE | post-call webhook → complete |
| 17 | `packages/application/src/use-cases/interview/index.ts` | @repo/application | MODIFY | Barrel exports |
| 18 | `apps/backend/src/infrastructure/services/elevenlabs/conversational-provider.ts` | infra | CREATE | Client handle + `ELEVENLABS_AGENT_ID` |
| 19 | `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts` | infra | CREATE | `IConversationalAgentService` impl (issueSignedUrl + getTranscript) |
| 20 | `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts` | infra | CREATE | Boot-time `agents.get` allow-list assertion (spike #1/#2) |
| 21 | `apps/backend/src/infrastructure/services/elevenlabs/index.ts` | infra | MODIFY | Export new service/provider/assertion |
| 22 | `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts` | infra | CREATE | Port impl (HMAC-SHA256, `ELEVENLABS_SESSION_TOKEN_SECRET`) |
| 23 | `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` | infra | CREATE | HMAC verifier + fromEnv (workspace secret) |
| 24 | `apps/backend/src/infrastructure/auth/index.ts` | infra | MODIFY | Export verifier + token issuer |
| 25 | `apps/backend/src/infrastructure/persistence/schema/interviews.ts` | infra | MODIFY | Add `eleven_labs_session_id` column |
| 26 | `apps/backend/src/infrastructure/repositories/<interview repo>.ts` | infra | MODIFY | Map new column ↔ serialized; add `findByElevenLabsSessionId(sid)` (Option<Interview>) |
| 27 | `apps/backend/src/presentation/controllers/candidate-session.controller.ts` | presentation | CREATE | D1 span + token gate + use case |
| 28 | `apps/backend/src/presentation/routes/candidate-session.routes.ts` | presentation | CREATE | `POST /interviews/:id/candidate-session` |
| 29 | `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts` | presentation | CREATE | D5 span + synchronous + fail-closed |
| 30 | `apps/backend/src/presentation/routes/webhooks/elevenlabs-initiation-webhook.routes.ts` | presentation | CREATE | `POST /webhooks/elevenlabs/initiation` |
| 31 | `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` | presentation | CREATE | D2/D3/D4 spans + HMAC + dispatch (session-start, tools, post-call) |
| 32 | `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts` | presentation | CREATE | `/session-start`, `/tools`, `/post-call` + scoped raw-body parser |
| 33 | `apps/backend/src/composition/candidate-session.composition.ts` | composition | CREATE | Wire start-session deps + boot-time agent-config assertion |
| 34 | `apps/backend/src/composition/elevenlabs-initiation-webhook.composition.ts` | composition | CREATE | Wire initiation deps (token issuer + repo) |
| 35 | `apps/backend/src/composition/elevenlabs-webhook.composition.ts` | composition | CREATE | Wire fire-and-forget webhook deps (verifier + 5 receivers) |
| 36 | `apps/backend/src/app.ts` | composition | MODIFY | Register three new route groups (additive) |
| 37 | `apps/backend/package.json` | infra | MODIFY | Add `@elevenlabs/elevenlabs-js@^2.49.1` |
| 38 | `apps/backend/.env.example` | infra | MODIFY | Document `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_SESSION_TOKEN_SECRET` |

---

## Per-layer `/backend-arch-validator` checkpoints

1. After domain (Steps 1–2): `/backend-arch-validator domain` — immutability, `Result` returns, no outward imports, new field threaded through serialize/fromSerialized, `bindElevenLabsSession` idempotent re-bind allowed in SCHEDULED/IN_PROGRESS.
2. After application (Steps 3–17): `/backend-arch-validator application` — no `@elevenlabs/*`/`@opentelemetry/api` import, no `throw`/`try`/`null`, idempotent no-op handling, port error → `ServiceError`, `AssembleConversationInitiationContext` fail-closes on every error path, barrel exports.
3. After infrastructure (Steps 18–26): `/backend-arch-validator infrastructure` — `Result.tryAsyncCatch` around SDK, infra→port error translation, no `.agents.create/.delete`, no presentation import, fail-fast env, `includeConversationId: true` on `getSignedUrl`, startup assertion fails boot on allow-list drift.
4. After presentation (Steps 27–32): `/backend-arch-validator presentation` — no infrastructure import (verifier/use cases injected), `interview.` span prefix, span opened before first `await` + closed in `finally`, **initiation webhook fail-closes** (non-2xx on any error), fire-and-forget signature verified before dispatch, no direct `ELEVENLABS_WEBHOOK_SECRET` read in handlers, idempotent no-ops → 200, post-call returns 200 ack on unknown `conversation_id`.
5. After composition (Steps 33–36): `/backend-arch-validator presentation` again — webhook routes skip better-auth, sandwich WS block untouched, three new env vars are all fail-fast at boot, agent-config assertion runs before any session can be issued.

---

## Test plan

Unit (domain, no mocks — extends `interview.entity.test.ts`):
- `bindElevenLabsSession` succeeds on SCHEDULED + IN_PROGRESS; **idempotent re-bind to same id returns self unchanged**; on COMPLETED/EVALUATED → `InvalidInterviewStateTransitionError`; serialize/fromSerialized round-trips the new field (null + present).

Unit/integration (application, mock repo + `IConversationalAgentService` + `IConversationCorrelationTokenIssuer` only):
- `start-candidate-session.use-case.test.ts`: SCHEDULED happy path returns `{ signedUrl, sessionToken }`; agentId is forwarded to the port; never calls `interview.start()`; never calls `bindElevenLabsSession`; non-SCHEDULED → `InvalidInterviewInputError`; missing plan → error; not found → `InterviewNotFoundError`; port `issueSignedUrl` error → propagated.
- `assemble-conversation-initiation-context.use-case.test.ts`: token verify happy path assembles full override (systemPrompt + dynamicVariables); **fail-closed on missing/invalid token → InvalidConversationCorrelationTokenError**; not found → InterviewNotFoundError; missing plan → InvalidInterviewInputError; status not SCHEDULED/IN_PROGRESS → fail-closed; **binding ONLY when `conversationId.isSome()`**; idempotent re-bind to same id → no save; save error → ServiceUnknownError.
- `start-interview-from-webhook.use-case.test.ts`: SCHEDULED + bind succeeds → IN_PROGRESS applied + saved; **duplicate (already IN_PROGRESS) → `Ok({ applied: false })` but still persists fallback binding if not previously bound**; not found → error; idempotent re-bind to same id is no-op.
- `record-agent-note.use-case.test.ts` + `record-internal-score.use-case.test.ts`: IN_PROGRESS appends + saves; not IN_PROGRESS → idempotent no-op; invalid score range → real `InvalidInterviewInputError`; empty note → real error.
- `end-interview-from-agent.use-case.test.ts`: records reason note when IN_PROGRESS; idempotent no-op otherwise; **does NOT complete the aggregate** (status stays IN_PROGRESS); reason text formatted as `[end_call] reason=<reason>`.
- `persist-completed-transcript.use-case.test.ts`: filters empty/whitespace rows before `TranscriptEntry.create`; completes + saves with correct `entryCount`; already-COMPLETED → idempotent no-op; `getTranscript` error → propagated.

Unit (infrastructure):
- `conversation-correlation-token.test.ts`: **round-trip issue→verify succeeds**; tampered token → `InvalidConversationCorrelationTokenError`; malformed token → error; expired token (mocked clock) → error; wrong-secret instance → error; `fromEnv` fail-fast on missing/short secret.
- `elevenlabs-webhook-verifier.test.ts`: valid signature → `Ok`; tampered body → `Err`; missing/malformed header → `Err`; wrong-length buffer → `Err` (no `timingSafeEqual` throw); `fromEnv` fail-fast on missing/short secret.
- `conversational-provider.test.ts`: `fromEnv` returns `Err` when `ELEVENLABS_API_KEY` or `ELEVENLABS_AGENT_ID` missing; `Ok` handle otherwise.
- `elevenlabs-conversational.service.test.ts`: mock SDK client; `issueSignedUrl` passes `agentId` + `includeConversationId: true`; SDK throw → `ConversationalSignedUrlFailedError`; `getTranscript` maps rows → `ConversationalTranscriptRow[]` with `agent`/`candidate` speaker mapping; SDK throw → `ConversationalTranscriptFetchFailedError`.
- `agent-config-assertion.test.ts`: mock SDK `agents.get`; missing `enableConversationInitiationClientDataFromWebhook` → `AgentConfigDriftError`; missing `agent.prompt.prompt` allow-list bit → `AgentConfigDriftError`; missing `agent.firstMessage` allow-list bit → `AgentConfigDriftError`; all three present → `Ok`.

Integration (presentation, mock injected deps):
- `candidate-session.controller.test.ts`: missing token → 401; token/id mismatch → 401; use-case error → mapped status; happy → 200 `{ signedUrl, sessionToken }`; D1 span opened before first `await`.
- `elevenlabs-initiation-webhook.controller.test.ts`: **missing correlation_token in dynamic_variables → 401 fail-closed**; use-case Err → non-2xx (fail-closed); happy → 200 with wire-shape `{ conversation_config_override: { agent: { prompt: { prompt: ... } } }, dynamic_variables: {...} }`; D5 span opened before first `await`; `elevenlabs.conversation_id` stamped when present.
- `elevenlabs-webhook.controller.test.ts`: signature rejection → 401 + use case never invoked; valid `take_note` dispatches `RecordAgentNote`; valid `score_answer` dispatches `RecordInternalScore`; **valid `end_call` (built-in) dispatches `EndInterviewFromAgent`**; valid `next_question` → 200 ack with no dispatch; idempotent no-op → 200; post-call resolves `interview_id` from `conversation_id`; unknown `conversation_id` → 200 ack (workspace-shared); session-start invokes `StartInterviewFromWebhook`; post-call invokes `PersistCompletedTranscript`; signature-verified-before-dispatch ordering.

Mock boundaries: mock `IInterviewRepository`, `IConversationalAgentService`, `IConversationCorrelationTokenIssuer` in application tests; mock the `@elevenlabs/elevenlabs-js` client in adapter tests; inject stub verifier + stub use cases in controller tests. No DB in these suites (entity round-trip is pure). Idempotency asserted explicitly in every receiver test. Fail-closed asserted on every initiation-webhook test path.

---

## Verification commands

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

After the schema change, also run `pnpm --filter backend db:generate` (and `db:migrate` against the dev DB) before backend integration tests that touch the repo.

---

## Live-validation gate (Phase 9.5 not declared done without this)

Before declaring Phase 9.5 ready for promotion, the live spike recipe in `docs/spikes/phase-9-5-elevenlabs-spike-findings.md` MUST be re-run with the `convai_write`-scoped key against the static agent (now updated with TTS access + ElevenAgents write per the spike doc's update note). The recipe pass criteria:

(a) **Initiation webhook fires** — the public echo webhook (or our staging backend's `/webhooks/elevenlabs/initiation` if connectable) prints a request log when a conversation starts.
(b) **Prompt override is honored live** — the agent's first utterance reflects the assembled `systemPrompt` (the recipe's "PINEAPPLE" canary, or the equivalent staging canary).
(c) **`correlation_token` surfaces in `dynamic_variables`** in the initiation request body (resolves spike surprise #3, the only type-confirmed-but-live-unverified link).
(d) **`end_call` system-tool dispatch surfaces as a tool-call webhook** with extractable end reason (resolves spike surprise #5 end-to-end). If `end_call` dispatch arrives via a different event shape than `take_note`/`score_answer` (e.g. payload at `event.type === "system_tool_invoked"` instead of `event.type === "tool_call"`), update the controller's dispatch table accordingly before flipping the path on.

Until (a)-(d) pass, the implementation may be type-correct and tested against mocked clients but is **operationally unverified**. Treat the path as staging-only.

---

## Risk notes

- **At-least-once webhook idempotency.** Fire-and-forget delivery is at-least-once and unordered. Every receiver treats illegal-transition domain errors as `Ok({ applied: false })` and replies 200 so ElevenLabs stops redelivering. The IN_PROGRESS/SCHEDULED/COMPLETED domain guards are the dedup mechanism — no separate dedup store. A genuinely malformed payload (bad score range, empty note) is a real 4xx, distinct from a duplicate.

- **Initiation webhook latency on conversation-start critical path.** The synchronous initiation handler blocks ElevenLabs until our response arrives. `AssembleConversationInitiationContextUseCase` MUST stay to a single repo read + (optional) single save + in-memory prompt assembly — no LLM calls, no external API calls, no slow operations. Monitor D5 p99 in Langfuse. A slow handler does not just degrade UX; it actively prevents the conversation from starting.

- **Silent-drop if allow-list flag missing on the agent (spike surprises #1/#2).** Without `platformSettings.overrides.enableConversationInitiationClientDataFromWebhook=true` AND `platformSettings.overrides.conversationConfigOverride.agent.prompt.prompt=true`, ElevenLabs silently drops the prompt override and the agent runs against its generic base prompt — no JD, no CV, no plan. The Step 12 startup assertion (`assertElevenLabsAgentConfig`) is the production drift guard; it MUST fail boot when these flags are missing. Without it, a misconfigured agent silently breaks every interview without an obvious failure mode.

- **Correlation-token surfacing is type-correct but live-unverified (spike surprise #3).** `ConversationInitiationClientDataRequestInput.dynamicVariables` exists in SDK types and we extract `correlation_token` from it, but the SDK types cannot prove browser-passed dynamic variables are forwarded into the initiation webhook body (vs only used internally for prompt interpolation). The Live-validation gate's check (c) is the only proof; until it passes, the entire correlation path is operationally untested.

- **Workspace-scoped post-call webhook collisions (spike surprise #6).** The post-call webhook is shared across the whole ElevenLabs workspace. If another project or sandbox in the same workspace also fires sessions, our `/webhooks/elevenlabs/post-call` endpoint will receive `conversation_id`s that don't map to any of our interviews. The controller MUST return 200 ack on unresolved `conversation_id` (NOT 4xx — we don't want ElevenLabs to retry-spam an event we will never persist). The D3 span carries `webhook.result=use_case_error` + `error.kind=INTERVIEW_NOT_FOUND` so Langfuse still surfaces volume.

- **`session.ended` never arrives.** Interview stays IN_PROGRESS; transcript not persisted; the Phase 6 evaluator must not run on non-COMPLETED interviews. Transcript is re-pullable via the stored `elevenLabsSessionId`. The reconciliation/timeout sweep is **Phase 10, out of scope** (ADR-031).

- **SCHEDULED-with-URL-issued window.** `StartCandidateSession` issues a single-use URL but leaves status SCHEDULED (ADR-031 Alternative D rejected). If the candidate never connects, the interview correctly remains SCHEDULED — not stuck IN_PROGRESS. `bindElevenLabsSession` is NOT called by `StartCandidateSession`; it is called from the initiation webhook (when `conversation_id` arrives) or as a fallback from session-start.

- **Single-use signed URL (spike surprise #7).** `includeConversationId: true` makes each signed URL single-use. Every connect attempt requires a fresh call to `/interviews/:id/candidate-session`. The frontend container in Phase 9.5 must call this endpoint exactly once per connection attempt — including on reconnect.

- **Deprecated vs new ElevenLabs package coexistence.** Sandwich TTS keeps `elevenlabs@^1.59.0` (`provider.ts` + `elevenlabs-tts.service.ts`). Conversational path uses `@elevenlabs/elevenlabs-js@^2.49.1` in a SEPARATE file (`conversational-provider.ts`); the two clients NEVER share a handle. Confirm no type-name collisions at import sites.

- **Three new required boot env vars.** `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_SESSION_TOKEN_SECRET` are all fail-fast (composition throws `Boot failed: …`). Deployments missing any of them fail at boot for the conversational path, matching `CANDIDATE_LINK_SECRET`/`BETTER_AUTH_SECRET`.

- **Raw-body HMAC for fire-and-forget routes.** Fastify parses JSON by default; HMAC must verify the RAW signed bytes, not the re-serialized object. Register a scoped `addContentTypeParser` capturing `req.rawBody` on the webhook plugin only. A mismatch here silently 401s every webhook. Initiation webhook (`/initiation`) does NOT use this HMAC — its auth is the correlation token.

- **Better-auth scoping.** All `/webhooks/elevenlabs/*` routes (initiation, session-start, tools, post-call) and the candidate-session route must NOT inherit the better-auth pre-handler (ADR-031). Confirm whether `installAuthPlugin` is global or recruiter-scoped at execution time; if global, register the webhook plugins in encapsulated child contexts that omit it.

- **`findByElevenLabsSessionId` repo method.** The post-call webhook controller needs to resolve `conversation_id` → `interviewId`. This is a NEW repo query method on `IInterviewRepository`: `findByElevenLabsSessionId(sid: string): Promise<Result<Option<Interview>, Error>>`. Add the method to the domain port interface + the Drizzle implementation in Step 13/Step 26. If the reviewer prefers a query service over a port-method, the alternative is a `PostCallInterviewLocator` query service — defer that decision to execution time; default = port method (cheap, single nullable column lookup).

- **SDK method names verification.** Adapter calls `client.conversationalAi.conversations.getSignedUrl(...)` and `client.conversationalAi.conversations.get(...)`. These are verified against `@elevenlabs/elevenlabs-js@2.49.1` per the spike doc; pin the SDK version in `package.json` and re-confirm before merging.

- **ADR-030 enforcement.** `.agents.create(` / `.agents.delete(` are declaratively forbidden under `apps/backend/src/**`. The conversational adapter must only issue per-session signed URLs against the static `ELEVENLABS_AGENT_ID`. The browser-side rule `conversationConfigOverride|dynamicVariables` forbid_pattern under `apps/web/src/**/*.ts` will bite frontend diffs in Phase 9.5 — backend is unaffected, but the recruiter-side reviewer must verify the frontend container passes ONLY `dynamicVariables: { correlation_token }` and never JD/CV content.

- **ADR-031 declarative rule.** Route handlers must NOT read `ELEVENLABS_WEBHOOK_SECRET` directly under `apps/backend/src/presentation/routes/webhooks/**/*.ts`. Only `ElevenLabsWebhookVerifier` reads it; controllers receive the verifier instance via injection.

- **ADR-029 llm_judge.** The pre-commit hook advisory-flags voice-path diffs (`llm_judge: true`). ADR-030 also carries `llm_judge: true`. Resolve in-session via `/adr-kit:judge` at commit time. Commits stay deferred until ALL backend work is done.
