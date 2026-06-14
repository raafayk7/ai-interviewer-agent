# Plan: Phase 9.5 — backend revision (live-validation corrective pass)

> Generated: 2026-05-27
> Slug: phase-9-5-revision
> Spec source (load-bearing): `docs/spikes/phase-9-5-live-findings.md` (especially the `## Concrete file change list` section)
> Progress context: `docs/progress/phase-9-5.md` (1 PASS / 3 FAIL live-validation outcome and the six new findings)
> Prior plan (diverged from): `.claude/plan/phase-9-5-elevenlabs-backend.md`
> Governing ADRs: ADR-029 (still in effect) · ADR-030 (about to be superseded by ADR-033) · ADR-031 (about to be superseded by ADR-034) · ADR-032 (being amended)
> Mode: PLAN ONLY. Execute later via `/backend-implement`.

## Summary

The first-pass Phase 9.5 implementation type-checks, passes 312 backend tests, and fails the live-validation gate (1 PASS / 3 FAIL). The follow-up spike conclusively resolved the three failures by reading ElevenLabs's published docs and SDK source. This revision pivots the backend to the live-validated mechanisms:

1. **Per-session overrides move from a synchronous initiation webhook to `StartCandidateSession`.** `getSignedUrl({ includeConversationId: true })` returns *both* `signedUrl` and `conversationId`. The backend binds `interview.elevenLabsSessionId` at issuance, assembles the prompt + dynamic-variables override server-side, and returns the override payload to the browser. The browser forwards it inline through `Conversation.startSession({ signedUrl, overrides, dynamicVariables })` — a sealed-courier transport. Sensitive content still never leaves the server in a candidate-fabricatable form (the override is server-built; the candidate signed link from ADR-017 remains the only authentication channel).
2. **Tools are discriminated by URL, not by body field.** Three per-tool URLs (`/webhooks/elevenlabs/tools/next_question`, `/score_answer`, `/take_note`) each with a real `request_body_schema` and a `x-voice-secret` shared-secret header. `tool_name` body parsing is deleted.
3. **`end_call` does not dispatch a tool webhook.** It is `type: "system"` per the SDK and is observable only as `transcript[<final turn>].tool_results[]` with `result_type === "end_call_success"` in the post-call payload. `EndInterviewFromAgentUseCase` and its dispatch branch are deleted; `PersistCompletedTranscript` walks the transcript for the end-call entry and persists `reason`/`message` as an `AgentNote`.
4. **HMAC narrows to the post-call surface only.** Tool webhooks use a shared-secret header (`x-voice-secret`); session-start uses HMAC; post-call uses HMAC with a 30-minute tolerance (the SDK-documented value). The shared `ElevenLabsWebhookVerifier` stays; a new tool-secret verifier is added.
5. **The correlation-token mechanism is deleted entirely.** `conversation_id` is server-bound at issuance and is itself the trustworthy correlation key — there is no need to round-trip a separate HMAC token through the browser. The initiation webhook surface and `ELEVENLABS_SESSION_TOKEN_SECRET` env var are deleted.

`StartCandidateSession`'s return type extends from `{ signedUrl, sessionToken }` to `{ signedUrl, overrides, dynamicVariables }`. The candidate-session controller forwards the override payload unmodified. The frontend `InterviewSessionContainer` will pass it through to `Conversation.startSession({ overrides, dynamicVariables })` — **frontend work is out of scope here**; flagged as a follow-up.

## Layers touched

| Layer | Package / Location | Scope |
|---|---|---|
| Domain | `packages/domain/` | No changes. `bindElevenLabsSession` and `elevenLabsSessionId` already present from first pass; the new flow exercises them at a different surface but the entity itself is untouched. |
| Application | `packages/application/` | Delete two use cases (`AssembleConversationInitiationContext`, `EndInterviewFromAgent`) + tests. Delete `conversation-correlation-token/` port directory. Modify `StartCandidateSession` (bind session id; assemble override; new output shape) + `PersistCompletedTranscript` (walk transcript for `end_call_success`). Modify `IConversationalAgentService.issueSignedUrl` return type to include `conversationId`. Update barrels. |
| Infrastructure | `apps/backend/src/infrastructure/` | Delete `conversation-correlation-token.ts` + test. Update `elevenlabs-conversational.service.ts` `issueSignedUrl` return shape. Confirm `elevenlabs-webhook-verifier.ts` 30-minute tolerance. Add new tool-secret header verifier. Update `auth/index.ts` barrel. |
| Presentation | `apps/backend/src/presentation/` | Delete the initiation controller + route + test. Delete the `end_call` dispatch branch and the `tool_name` body parser. Split `handleTool` into three per-tool handlers. Update `candidate-session.controller.ts` to return the override payload. Update the webhooks route plugin to register three per-tool POSTs. Rewrite tool-section of the webhook controller test. |
| Composition | `apps/backend/src/composition/` | Delete `elevenlabs-initiation-webhook.composition.ts`. Update `candidate-session.composition.ts` to drop the correlation-token wiring. Update `elevenlabs-webhook.composition.ts` to swap the per-route verifier (HMAC for `/session-start` + `/post-call`; shared-secret for `/tools/*`) and remove the `EndInterviewFromAgentUseCase` wire. |
| App | `apps/backend/src/app.ts` | Drop `elevenLabsInitiationWebhook` from `BuildAppOptions`, `composeDefaults` gate, and the registration block. |
| Env | `apps/backend/.env.example` | Remove `ELEVENLABS_SESSION_TOKEN_SECRET`. Add `ELEVENLABS_TOOL_WEBHOOK_SECRET`. |
| Scripts | `apps/backend/scripts/live-validation/` | Rewire `provision-agent.mjs` (per-tool URLs, full schemas, x-voice-secret headers), `wire-webhooks.mjs` (per-tool URLs; drop initiation patch), `cleanup.mjs` (drop initiation baseline reset; keep idempotent), `harness.html` (pass `overrides` to `Conversation.startSession`). |

---

## Anti-patterns this revision must NOT commit

These have been observed in similar pivots and the plan calls them out explicitly:

- **Don't delete files without removing their references.** Composition files and `app.ts` import the very symbols being deleted; the type-check will fail mid-deletion. Always pull the imports out of the composition/app before deleting the source.
- **Don't leave `EndInterviewFromAgentUseCase` referenced after the controller dispatch branch is gone.** The composition imports it and the controller deps interface requires `endInterviewFromAgentUseCase`. Clean the deps interface + composition first, then delete the use case + its test.
- **Don't keep `ELEVENLABS_SESSION_TOKEN_SECRET` "just in case".** The mechanism is gone; the env var is dead. Delete its `.env.example` line, its `fromEnv` helper, and the env-var assertion test. The codebase's convention is to delete dead code immediately.
- **Don't keep the initiation route prefix dangling in `app.ts`.** Either every reference goes (`registerElevenLabsInitiationWebhookRoutes`, `RegisterElevenLabsInitiationWebhookRoutesOptions`, the `elevenLabsInitiationWebhook` field in `BuildAppOptions`, the `composeDefaults` `&&` clause, the registration block) or none. Half-deletion will type-check but yields a 404 on a route nobody documented anywhere.

---

## Phasing

The work is split into eight phases (A–H) executed in order. Each phase ends with a `pnpm turbo run check-types` so type errors are caught immediately at the boundary, not at the very end.

---

### Phase A — Deletions and port-level cleanup

Goal: remove every file and symbol that the new design retires. After Phase A, the codebase type-checks against a reduced surface (one fewer use case, one fewer controller, no correlation-token port, no initiation route).

**Order is critical:** delete top-of-graph (presentation/composition) first, then application, then ports. Each step preserves type-check cleanliness.

#### A.1 — Delete the initiation route + composition + controller wiring

Layer skill: `/backend-presentation-layer`.

Files (DELETE, all):
- `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts`
- `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.test.ts`
- `apps/backend/src/presentation/routes/webhooks/elevenlabs-initiation-webhook.routes.ts`
- `apps/backend/src/composition/elevenlabs-initiation-webhook.composition.ts`

File (MODIFY): `apps/backend/src/app.ts` — remove every initiation symbol:
- Lines 35–38: drop the `registerElevenLabsInitiationWebhookRoutes` import block.
- Line 59: drop `readonly elevenLabsInitiationWebhook?: …` from `BuildAppOptions`.
- Line 95: drop `&& !options.elevenLabsInitiationWebhook` from the `composeDefaults` chain.
- Lines 179–192: drop the entire `const elevenLabsInitiationWebhook = …` / `if (elevenLabsInitiationWebhook) await app.register(…)` block.

ADR references: ADR-034 §"Architectural pivot" supersedes ADR-031's initiation surface.

#### A.2 — Delete the correlation-token infrastructure + port + use case

Layer skill: `/backend-infrastructure-layer` for the infra deletions; `/backend-application-layer` for the use-case + port deletions.

Files (DELETE):
- `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts`
- `apps/backend/src/infrastructure/auth/conversation-correlation-token.test.ts`
- `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts`
- `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.test.ts`
- `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token-error.ts`
- `packages/application/src/ports/conversation-correlation-token/conversation-correlation-token.port.ts`
- `packages/application/src/ports/conversation-correlation-token/index.ts`

Files (MODIFY):

- `apps/backend/src/infrastructure/auth/index.ts` — drop lines 8–16 (the two correlation-token export blocks).
- `packages/application/src/ports/index.ts` — drop line 9 (`export * from "./conversation-correlation-token/index.js";`).
- `packages/application/src/use-cases/interview/index.ts` — drop the `AssembleConversationInitiationContextUseCase` export block (lines 41–45).

ADR reference: ADR-033 §"Why no correlation token" — `conversation_id` is the trustworthy key; the HMAC round-trip is gone.

#### A.3 — Delete `EndInterviewFromAgentUseCase` and clean its callers

Layer skill: `/backend-application-layer`, then `/backend-presentation-layer`, then composition.

**Order matters** — the use case is referenced by the controller deps interface and composition. The controller dispatch branch deletion happens in Phase D, but the deps-interface field and the composition wire come out first so the use-case file can be deleted cleanly.

Files (MODIFY first, before deleting):

- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` — drop the `endInterviewFromAgentUseCase` field from `ElevenLabsWebhookControllerDeps` (lines 61–66). Drop the `if (payload.toolName === "end_call") { … }` branch in `dispatchTool` (lines 284–294). Note: the `dispatchTool` method is about to be deleted entirely in Phase D; this surgical edit just makes Phase A type-check cleanly.
- `apps/backend/src/composition/elevenlabs-webhook.composition.ts` — drop the `EndInterviewFromAgentUseCase` import (line 4) and the `endInterviewFromAgentUseCase: new EndInterviewFromAgentUseCase(interviews),` line in the returned deps (line 59).

Files (DELETE):
- `packages/application/src/use-cases/interview/end-interview-from-agent.use-case.ts`
- `packages/application/src/use-cases/interview/end-interview-from-agent.use-case.test.ts`

File (MODIFY): `packages/application/src/use-cases/interview/index.ts` — drop the `EndInterviewFromAgentUseCase` export block (lines 59–62).

ADR reference: ADR-034 §"end_call is a system tool" supersedes ADR-031 §"three tool webhooks" — the end-reason now flows through the post-call transcript.

#### A.4 — Phase A type-check gate

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
```

If anything red: the remaining red likely points at controller test references (`elevenlabs-webhook.controller.test.ts` will still reference `endInterviewFromAgentUseCase`). Those tests will be rewritten in Phase F; you may temporarily comment the broken assertions to get green, OR proceed straight to Phase D where the test is rewritten in full.

---

### Phase B — Domain / application updates

Goal: extend `StartCandidateSession` to (a) accept the conversation_id from `issueSignedUrl`, (b) bind `interview.elevenLabsSessionId` at issuance via `bindElevenLabsSession`, (c) assemble the override payload server-side, (d) return `{ signedUrl, overrides, dynamicVariables }`. Extend `PersistCompletedTranscript` to extract the end-reason from `tool_results[]`. Update the conversational-agent port `issueSignedUrl` return shape.

Layer skill: `/backend-application-layer`.

#### B.1 — Update `IConversationalAgentService.issueSignedUrl` return shape

File (MODIFY): `packages/application/src/ports/conversational-agent/conversational-agent.port.ts`

Change `IssueSignedUrlOutput` to expose `conversationId`:

```typescript
export interface IssueSignedUrlOutput {
  readonly signedUrl: string;
  readonly conversationId: string;
}
```

Update the JSDoc on `issueSignedUrl` to reflect that `includeConversationId: true` MUST be passed and that the response now carries `{ signedUrl, conversationId }`.

ADR reference: ADR-033 §"Why bind at issuance" — `getSignedUrl({ includeConversationId: true })` returns both fields; the SDK has supported this since the original spike.

#### B.2 — Update `ElevenLabsConversationalService.issueSignedUrl`

Layer skill: `/backend-infrastructure-layer`.

File (MODIFY): `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts`

Replace the `issueSignedUrl` body to extract and forward `conversationId`. The SDK `ConversationSignedUrlResponseModel` exposes `conversationId` when `includeConversationId: true` is passed — verify this against `@elevenlabs/elevenlabs-js@2.49.1` types at execution time. If the SDK does not surface `conversationId` directly on the response, parse it out of `signedUrl` (it appears as a query parameter when `includeConversationId: true`).

```typescript
async issueSignedUrl(
  input: IssueSignedUrlInput,
): Promise<Result<IssueSignedUrlOutput, ConversationalSignedUrlFailedError>> {
  return Result.tryAsyncCatch(
    async (): Promise<IssueSignedUrlOutput> => {
      const response = await this.handle.client.conversationalAi.conversations.getSignedUrl({
        agentId: input.agentId,
        includeConversationId: true,
      });
      const conversationId = response.conversationId ?? extractConversationIdFromUrl(response.signedUrl);
      if (!conversationId) {
        throw new Error("getSignedUrl returned no conversationId despite includeConversationId: true");
      }
      return { signedUrl: response.signedUrl, conversationId };
    },
    (err) =>
      new ConversationalSignedUrlFailedError(
        err instanceof Error ? err.message : String(err),
        input.agentId,
      ),
  ).toPromise();
}
```

Add a small private helper `extractConversationIdFromUrl(url: string): string | null` that parses the `conversation_id` query parameter as a fallback (search both `conversation_id=` and `conversationId=`). This is defensive against SDK contract drift.

Update the adapter test (`elevenlabs-conversational.service.test.ts`) to assert the new return shape and to cover both response paths (SDK-returned `conversationId` and URL-fallback).

ADR reference: ADR-033 §"SDK return shape verification".

#### B.3 — Rewrite `StartCandidateSessionUseCase`

File (MODIFY): `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts`

The use case now:
1. Loads + asserts SCHEDULED + plan-present (unchanged).
2. Calls `agent.issueSignedUrl({ agentId })` to get `{ signedUrl, conversationId }`.
3. Calls `interview.bindElevenLabsSession(conversationId)` (idempotent re-bind allowed).
4. Saves the bound interview (only if changed).
5. Assembles the system prompt via `assembleInterviewSystemPrompt({ jobDescription, candidateInfo, clientInstructions, interviewPlan: plan })`.
6. Builds the dynamic-variables map (`candidate_name`, `job_title`, `target_duration_minutes`, `interview_id`).
7. Returns `{ signedUrl, overrides: { agent: { prompt: { prompt: systemPrompt } } }, dynamicVariables }`.

The `tokens` constructor parameter (and the `IConversationCorrelationTokenIssuer` import) are removed.

New output type:

```typescript
export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly overrides: {
    readonly agent: {
      readonly prompt: { readonly prompt: string };
      readonly firstMessage?: string;
    };
  };
  readonly dynamicVariables: Readonly<Record<string, string>>;
}
```

Method body skeleton:

```typescript
async execute(input: StartCandidateSessionInput): Promise<Result<StartCandidateSessionOutput, ServiceError>> {
  const found = await this.interviews.findById(input.interviewId);
  if (found.isErr()) return Result.Err(new ServiceUnknownError(found.unwrapErr().message, "InterviewRepository.findById"));
  const interviewOrError = found.unwrap().match({
    Some: (i) => Result.Ok(i),
    None: () => Result.Err(new InterviewNotFoundError(input.interviewId) as ServiceError),
  });
  if (interviewOrError.isErr()) return interviewOrError;
  const interview = interviewOrError.unwrap();
  if (interview.status !== INTERVIEW_STATUS.SCHEDULED) {
    return Result.Err(new InvalidInterviewInputError(`Interview ${interview.id} is not SCHEDULED`) as ServiceError);
  }
  const planOrError = interview.interviewPlan.match({
    Some: (p) => Result.Ok(p),
    None: () => Result.Err(new InvalidInterviewInputError("Interview has no plan") as ServiceError),
  });
  if (planOrError.isErr()) return planOrError;
  const plan = planOrError.unwrap();

  const issued = await this.agent.issueSignedUrl({ agentId: input.agentId });
  if (issued.isErr()) return Result.Err(issued.unwrapErr() as ServiceError);
  const { signedUrl, conversationId } = issued.unwrap();

  const bound = interview.bindElevenLabsSession(conversationId);
  if (bound.isErr()) return Result.Err(bound.unwrapErr() as ServiceError);
  const next = bound.unwrap();
  if (next !== interview) {
    const saved = await this.interviews.save(next);
    if (saved.isErr()) return Result.Err(new ServiceUnknownError(saved.unwrapErr().message, "InterviewRepository.save"));
  }

  const systemPrompt = assembleInterviewSystemPrompt({
    jobDescription: next.jobDescription,
    candidateInfo: next.candidateInfo,
    clientInstructions: next.clientInstructions,
    interviewPlan: plan,
  });
  return Result.Ok({
    signedUrl,
    overrides: { agent: { prompt: { prompt: systemPrompt } } },
    dynamicVariables: {
      candidate_name: next.candidateInfo.fullName,
      job_title: next.jobDescription.title,
      target_duration_minutes: String(plan.targetDurationMinutes),
      interview_id: next.id,
    },
  });
}
```

Constructor signature drops the `tokens` parameter — only `(interviews, agent)` remain.

Update the test file `start-candidate-session.use-case.test.ts` in Phase F.

ADR reference: ADR-033 §"Override assembly moves into StartCandidateSession".

#### B.4 — Update `PersistCompletedTranscriptUseCase` to extract end-reason

File (MODIFY): `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts`

The post-call webhook payload carries `data.transcript[]` with per-turn `tool_results[]`. When the final turn contains a `tool_results` entry whose `result_type === "end_call_success"`, extract its `reason` and `message` and persist them as an `AgentNote` BEFORE calling `interview.complete()`.

The signature changes from "call `agent.getTranscript()` and walk those rows" to "receive the post-call payload's transcript directly from the controller". The use case no longer needs `IConversationalAgentService.getTranscript` — the controller passes the transcript inline. This removes one network round-trip on the post-call path.

New input shape:

```typescript
export interface PersistCompletedTranscriptInput {
  readonly interviewId: string;
  readonly elevenLabsSessionId: string;
  readonly occurredAt: Date;
  readonly transcript: ReadonlyArray<PostCallTranscriptEntry>;
}

export interface PostCallTranscriptEntry {
  readonly role: "agent" | "user";
  readonly message: string | null;
  readonly timeInCallSecs: number;
  readonly toolResults: ReadonlyArray<PostCallToolResult> | null;
}

export interface PostCallToolResult {
  readonly resultType: string;
  readonly resultValue?: { readonly reason?: string; readonly message?: string };
}
```

(Naming uses the SDK's camelCase wire-shape — Drizzle's camelCase Mapping is not in play here.)

Body skeleton (additions only — existing transcript-to-VO loop stays, the end_call_success walk is new):

```typescript
// After loading interview + asserting not already COMPLETED/EVALUATED:

// 1) Walk the transcript for an end_call_success tool result.
const endCall = findEndCallSuccess(input.transcript);
let intermediate = interview;
if (endCall) {
  const reason = endCall.reason ?? "agent_requested_end_call";
  const noteResult = AgentNote.create({
    note: `[end_call] reason=${reason}${endCall.message ? ` — ${endCall.message}` : ""}`,
    recordedAtTurn: 0,
    recordedAt: input.occurredAt,
  });
  if (noteResult.isErr()) return Result.Err(noteResult.unwrapErr() as ServiceError);
  const appended = intermediate.appendNote(noteResult.unwrap());
  // appendNote can fail with InvalidInterviewStateTransitionError if not IN_PROGRESS;
  // treat that as idempotent — the note is informational, not load-bearing.
  if (appended.isOk()) intermediate = appended.unwrap();
}

// 2) Build TranscriptEntry VOs from the (existing) loop, but read from input.transcript
//    instead of calling agent.getTranscript:
const entryResults = input.transcript
  .filter((row) => (row.role === "agent" || row.role === "user") && (row.message ?? "").trim().length > 0)
  .map((row) => TranscriptEntry.create({
    speaker: row.role === "agent" ? SPEAKER.AGENT : SPEAKER.CANDIDATE,
    text: row.message ?? "",
    timestamp: new Date(input.occurredAt.getTime() + row.timeInCallSecs * 1000),
  }));
// ...remainder identical: Result.all, complete, save, return { applied, entryCount }
```

Add a private helper `findEndCallSuccess(transcript): { reason?: string; message?: string } | null`:

```typescript
function findEndCallSuccess(
  transcript: ReadonlyArray<PostCallTranscriptEntry>,
): { readonly reason?: string; readonly message?: string } | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const results = transcript[i]?.toolResults ?? null;
    if (!results) continue;
    const hit = results.find((r) => r.resultType === "end_call_success");
    if (hit) return { reason: hit.resultValue?.reason, message: hit.resultValue?.message };
  }
  return null;
}
```

The constructor now drops `agent: IConversationalAgentService` — the use case no longer fetches transcripts; the controller forwards them inline.

> NOTE: `IConversationalAgentService.getTranscript` is now unused by any use case. Leave it on the port surface — it's still useful for the deferred Phase 10 reconciliation sweep — but its adapter implementation stays. Composition no longer passes the agent into `PersistCompletedTranscriptUseCase`.

ADR reference: ADR-034 §"end_reason lives in transcript[].tool_results[]" (cites the `EndCallSuccess` SDK type and the elevenlabs-python #529 confirmation).

#### B.5 — Barrel updates

File (MODIFY): `packages/application/src/use-cases/interview/index.ts` — `StartCandidateSessionOutput` shape change ripples through the exported type. Export the new types if they were added (`StartCandidateSessionOutput` already exported; `PostCallTranscriptEntry` and `PostCallToolResult` need adding):

```typescript
export {
  PersistCompletedTranscriptUseCase,
  type PersistCompletedTranscriptInput,
  type PersistCompletedTranscriptOutput,
  type PostCallTranscriptEntry,
  type PostCallToolResult,
} from "./persist-completed-transcript.use-case.js";
```

#### B.6 — Phase B type-check gate

```bash
pnpm turbo run check-types --filter=@repo/application --filter=backend
```

Expected red: the candidate-session controller still references the deleted `sessionToken` and the deps interface still references `tokens`; the webhook controller still references the deleted `EndInterviewFromAgentUseCase`. These get fixed in Phase D.

---

### Phase C — Infrastructure

Goal: confirm the HMAC verifier is correct (30-minute tolerance) and add a new shared-secret-header verifier for the tool routes.

Layer skill: `/backend-infrastructure-layer`.

#### C.1 — Confirm `ElevenLabsWebhookVerifier` tolerance is 30 minutes

File (CHECK): `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts`

The current verifier does NOT enforce a tolerance — it only validates the signature equals `HMAC(secret, "${timestamp}.${rawBody}")`. The 30-minute tolerance check must be ADDED. The SDK source (`@elevenlabs/elevenlabs-js/wrapper/webhooks.ts` `constructEvent`) checks the timestamp against the current time and rejects if the delta exceeds 30 minutes.

Add the tolerance check after `parseSignatureHeader`:

```typescript
const timestampSecs = Number(parsed.timestamp);
if (!Number.isFinite(timestampSecs)) {
  return this.invalid("ElevenLabs webhook timestamp is malformed");
}
const ageSecs = Math.abs(Math.floor(Date.now() / 1000) - timestampSecs);
const TOLERANCE_SECS = 30 * 60;
if (ageSecs > TOLERANCE_SECS) {
  return this.invalid(`ElevenLabs webhook timestamp outside tolerance (${ageSecs}s > ${TOLERANCE_SECS}s)`);
}
```

Make the tolerance injectable via the constructor config so tests can fix a small window:

```typescript
export interface ElevenLabsWebhookVerifierConfig {
  readonly secret: string;
  readonly toleranceSecs?: number; // default 1800
  readonly nowMs?: () => number;   // testable clock
}
```

Update `elevenlabs-webhook-verifier.test.ts` (in Phase F) to add tolerance + clock-skew tests.

ADR reference: ADR-034 §"HMAC + 30-minute tolerance for post-call only".

#### C.2 — Add the tool-secret header verifier

File (CREATE): `apps/backend/src/infrastructure/auth/elevenlabs-tool-secret-verifier.ts`

```typescript
import { timingSafeEqual } from "node:crypto";
import { Result } from "@carbonteq/fp";
import { ServiceInfraError } from "@repo/application";

export class InvalidToolSecretError extends ServiceInfraError {
  readonly code = "INVALID_TOOL_SECRET";
}

export interface ToolSecretVerifierConfig {
  readonly secret: string;
}

export class ElevenLabsToolSecretVerifier {
  constructor(private readonly config: ToolSecretVerifierConfig) {}

  verify(headerValue: string | undefined): Result<void, InvalidToolSecretError> {
    if (!headerValue) {
      return Result.Err(new InvalidToolSecretError("Missing x-voice-secret header"));
    }
    const provided = Buffer.from(headerValue, "utf8");
    const expected = Buffer.from(this.config.secret, "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return Result.Err(new InvalidToolSecretError("x-voice-secret mismatch"));
    }
    return Result.Ok(undefined);
  }
}

export function elevenLabsToolSecretVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ElevenLabsToolSecretVerifier, Error> {
  const secret = env["ELEVENLABS_TOOL_WEBHOOK_SECRET"];
  if (!secret || secret.length < 32) {
    return Result.Err(new Error("ELEVENLABS_TOOL_WEBHOOK_SECRET must be set (>= 32 chars)"));
  }
  return Result.Ok(new ElevenLabsToolSecretVerifier({ secret }));
}
```

File (MODIFY): `apps/backend/src/infrastructure/auth/index.ts` — export the new verifier + factory:

```typescript
export {
  ElevenLabsToolSecretVerifier,
  InvalidToolSecretError,
  elevenLabsToolSecretVerifierFromEnv,
} from "./elevenlabs-tool-secret-verifier.js";
export type { ToolSecretVerifierConfig } from "./elevenlabs-tool-secret-verifier.js";
```

ADR reference: ADR-034 §"Per-tool shared-secret header" — the canonical pattern from the two community implementations cited in the spike.

#### C.3 — Phase C type-check gate

```bash
pnpm turbo run check-types --filter=backend
```

---

### Phase D — Presentation

Goal: split the tool handler into three per-tool handlers; drop `end_call`; drop `tool_name` parsing; rewire the candidate-session controller to return the override payload; update the routes plugin to register three per-tool POSTs; update composition to swap the verifier per-route.

Layer skill: `/backend-presentation-layer`.

#### D.1 — Update `candidate-session.controller.ts`

File (MODIFY): `apps/backend/src/presentation/controllers/candidate-session.controller.ts`

The response body changes from `{ signedUrl, sessionToken }` to `{ signedUrl, overrides, dynamicVariables }`. The `StartCandidateSessionOutput` type already changed in B.3; the controller code change is small.

Update `StartCandidateSessionOutput` (controller-local type alias on line 25–28) to match the use-case output shape exactly:

```typescript
export interface StartCandidateSessionOutput {
  readonly signedUrl: string;
  readonly overrides: {
    readonly agent: {
      readonly prompt: { readonly prompt: string };
      readonly firstMessage?: string;
    };
  };
  readonly dynamicVariables: Readonly<Record<string, string>>;
}
```

Line 98: `await reply.code(200).send(result.unwrap());` — no change needed, the use case already returns the full envelope.

Add a span attribute for confirmation:

```typescript
span.setAttribute("elevenLabs.agentId", this.deps.agentId);
span.setAttribute("interview.session.override_assembled", true); // ADR-033 D1 observability marker
```

Update `candidate-session.controller.test.ts` (Phase F) to assert the new envelope and the new span attribute.

ADR reference: ADR-033 §"Override delivery transport".

#### D.2 — Rewrite `elevenlabs-webhook.controller.ts`'s tool surface

File (MODIFY): `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts`

Three changes — make them in order:

**(a) Update `ElevenLabsWebhookControllerDeps`** to split the tool dispatch and inject the new verifier:

```typescript
export interface ElevenLabsWebhookControllerDeps {
  readonly hmacVerifier: WebhookVerifierLike;             // for /session-start + /post-call
  readonly toolSecretVerifier: ToolSecretVerifierLike;    // for /tools/*
  readonly startInterviewFromWebhookUseCase: WebhookUseCaseLike<…>;
  readonly recordAgentNoteUseCase: WebhookUseCaseLike<…>;
  readonly recordInternalScoreUseCase: WebhookUseCaseLike<…>;
  readonly persistCompletedTranscriptUseCase: WebhookUseCaseLike<…, TranscriptPersistOutput>;
  readonly interviewResolver: InterviewIdResolverLike;
}

export interface ToolSecretVerifierLike {
  verify(headerValue: string | undefined): Result<void, unknown>;
}
```

Drop the `endInterviewFromAgentUseCase` field (already done in A.3); drop the standalone `verifier` field and replace with `hmacVerifier` + `toolSecretVerifier`.

**(b) Split `handleTool` into three per-tool handlers.** Delete the old `handleTool` method (lines 125–151) and the `dispatchTool` private method (lines 254–297). Delete `parseToolPayload` (lines 348–365). The payload now arrives with the schema parameters at the top level of `req.body` (per the per-tool `request_body_schema` configured on the agent's tool); the discriminator is the URL path.

Add three new public handlers. Each follows the same pattern: span open → tool-secret verify → parse payload → dispatch to its use case → reply.

```typescript
async handleNextQuestion(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const span = tracer.startSpan("interview.webhook.tool");
  try {
    span.setAttribute("webhook.tool_name", "next_question");
    if (!(await this.verifyToolSecret(req, reply, span))) return;
    const correlation = parseToolCorrelation(req.body);
    if (!correlation) {
      await sendParseError(reply, span);
      return;
    }
    span.setAttribute("interview.id", correlation.interviewId);
    span.setAttribute("elevenLabs.sessionId", correlation.elevenLabsSessionId);
    span.setAttribute("webhook.result", "ok");
    await reply.code(200).send({ ok: true }); // next_question is a no-op ack
  } finally {
    span.end();
  }
}

async handleScoreAnswer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const span = tracer.startSpan("interview.webhook.tool");
  try {
    span.setAttribute("webhook.tool_name", "score_answer");
    if (!(await this.verifyToolSecret(req, reply, span))) return;
    const payload = parseScoreAnswerPayload(req.body);
    if (!payload) {
      await sendParseError(reply, span);
      return;
    }
    span.setAttribute("interview.id", payload.interviewId);
    span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
    const result = await this.deps.recordInternalScoreUseCase.execute({
      interviewId: payload.interviewId,
      topicName: payload.topicName,
      score: payload.score,
      justification: payload.justification,
      recordedAtTurn: payload.recordedAtTurn,
      recordedAt: payload.occurredAt,
    });
    await sendWebhookResult(reply, result, span);
  } finally {
    span.end();
  }
}

async handleTakeNote(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const span = tracer.startSpan("interview.webhook.tool");
  try {
    span.setAttribute("webhook.tool_name", "take_note");
    if (!(await this.verifyToolSecret(req, reply, span))) return;
    const payload = parseTakeNotePayload(req.body);
    if (!payload) {
      await sendParseError(reply, span);
      return;
    }
    span.setAttribute("interview.id", payload.interviewId);
    span.setAttribute("elevenLabs.sessionId", payload.elevenLabsSessionId);
    const result = await this.deps.recordAgentNoteUseCase.execute({
      interviewId: payload.interviewId,
      note: payload.note,
      recordedAtTurn: payload.recordedAtTurn,
      recordedAt: payload.occurredAt,
    });
    await sendWebhookResult(reply, result, span);
  } finally {
    span.end();
  }
}

private async verifyToolSecret(
  req: FastifyRequest,
  reply: FastifyReply,
  span: Span,
): Promise<boolean> {
  const headerValue = getHeader(req.headers["x-voice-secret"]);
  const verified = this.deps.toolSecretVerifier.verify(headerValue);
  if (verified.isErr()) {
    span.setAttribute("webhook.result", "signature_rejected");
    span.setAttribute("error", true);
    span.setAttribute("error.kind", "INVALID_TOOL_SECRET");
    await reply.code(401).send({ error: { code: "INVALID_TOOL_SECRET", message: "rejected" } });
    return false;
  }
  return true;
}
```

Add three pure parser helpers (`parseToolCorrelation`, `parseScoreAnswerPayload`, `parseTakeNotePayload`). Each pulls `interview_id` + `elevenLabsSessionId` from `dynamic_variables` (the per-tool `request_body_schema` does NOT include these; they come from the agent's `system__dynamic_variables` interpolation, which surfaces in the tool body when the agent provisions per-tool URLs with `requestBodySchema` referencing `{{interview_id}}`-style template tokens). The exact location of these correlation fields in the per-tool webhook payload needs to be confirmed at implementation time — if they're not in the request body, fall back to encoding `interview_id` into the per-tool URL as a path parameter. The spike findings note path-parameter discrimination as the canonical community pattern (see solmail-website / clinivox examples).

**Fallback pattern: URL path parameter.** If `dynamic_variables` don't propagate to per-tool webhook bodies, the agent's `apiSchema.url` is set to `<base>/webhooks/elevenlabs/tools/score_answer/:interview_id` and the controller reads `req.params.interview_id`. This is decided at implementation time after observing one real per-tool webhook payload. The plan defaults to body-correlation; falls back to path-parameter.

**(c) Rewrite `handlePostCall`** to read the documented post-call payload field names and forward the transcript inline. The current `handlePostCall` reads `conversation_id` from the body root; the documented field is `body.data.conversation_id`. Update the parser:

```typescript
function parsePostCallPayload(body: unknown): ParsedPostCallPayload | null {
  const source = asRecord(body);
  if (!source) return null;
  const data = asRecord(source.data);
  if (!data) return null;
  const conversationId = getString(data.conversation_id);
  if (!conversationId) return null;
  const metadata = asRecord(data.metadata) ?? {};
  const startTimeSecs = typeof metadata.start_time_unix_secs === "number" ? metadata.start_time_unix_secs : null;
  const durationSecs = typeof metadata.call_duration_secs === "number" ? metadata.call_duration_secs : 0;
  const occurredAt = startTimeSecs !== null
    ? new Date((startTimeSecs + durationSecs) * 1000)
    : new Date();
  const terminationReason = getString(metadata.termination_reason) ?? null;
  const transcript = parseTranscript(data.transcript);
  return { elevenLabsSessionId: conversationId, occurredAt, terminationReason, transcript };
}

function parseTranscript(raw: unknown): ReadonlyArray<PostCallTranscriptEntry> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = asRecord(row);
      if (!r) return null;
      const role = r.role === "agent" || r.role === "user" ? r.role : null;
      if (!role) return null;
      const message = typeof r.message === "string" ? r.message : null;
      const timeInCallSecs = typeof r.time_in_call_secs === "number" ? r.time_in_call_secs : 0;
      const toolResults = parseToolResults(r.tool_results);
      return { role, message, timeInCallSecs, toolResults };
    })
    .filter((entry): entry is PostCallTranscriptEntry => entry !== null);
}

function parseToolResults(raw: unknown): ReadonlyArray<PostCallToolResult> | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((row) => {
      const r = asRecord(row);
      if (!r) return null;
      const resultType = getString(r.result_type);
      if (!resultType) return null;
      const resultValue = asRecord(r.result_value) ?? undefined;
      return { resultType, resultValue: resultValue as { reason?: string; message?: string } | undefined };
    })
    .filter((entry): entry is PostCallToolResult => entry !== null);
}
```

Update `handlePostCall` to forward the transcript into the use case (drop the `agent.getTranscript` dependency — the payload IS the transcript):

```typescript
const interviewId = … ; // resolved via interviewResolver as before
span.setAttribute("interview.id", interviewId);
if (payload.terminationReason) span.setAttribute("elevenlabs.termination_reason", payload.terminationReason);
const result = await otelContext.with(spanContext, () =>
  this.persistTranscript({
    interviewId,
    elevenLabsSessionId: payload.elevenLabsSessionId,
    occurredAt: payload.occurredAt,
    transcript: payload.transcript,
  }),
);
```

`handleSessionStart` is unchanged (still HMAC-verified, still calls `StartInterviewFromWebhookUseCase`).

ADR references: ADR-034 §"Per-tool URLs" · §"end_reason in transcript[].tool_results[]" · §"Post-call payload field names".

#### D.3 — Update `elevenlabs-webhooks.routes.ts`

File (MODIFY): `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts`

Replace the single `POST /tools` registration with three per-tool POSTs:

```typescript
app.post<{ Body: unknown }>("/session-start", (req, reply) =>
  controller.handleSessionStart(req as RawBodyFastifyRequest, reply),
);
app.post<{ Body: unknown }>("/tools/next_question", (req, reply) =>
  controller.handleNextQuestion(req, reply),
);
app.post<{ Body: unknown }>("/tools/score_answer", (req, reply) =>
  controller.handleScoreAnswer(req, reply),
);
app.post<{ Body: unknown }>("/tools/take_note", (req, reply) =>
  controller.handleTakeNote(req, reply),
);
app.post<{ Body: unknown }>("/post-call", (req, reply) =>
  controller.handlePostCall(req as RawBodyFastifyRequest, reply),
);
```

The scoped `addContentTypeParser` capturing `req.rawBody` STAYS — `/session-start` and `/post-call` still need raw bytes for HMAC. The tool routes don't strictly need raw bytes (header verification only), but they share the parser harmlessly.

#### D.4 — Update `elevenlabs-webhook.composition.ts`

File (MODIFY): `apps/backend/src/composition/elevenlabs-webhook.composition.ts`

Drop the `EndInterviewFromAgentUseCase` import and wire (already done in A.3). Drop the `ElevenLabsConversationalService`/`conversationalClientFromEnv` import — `PersistCompletedTranscriptUseCase` no longer needs the agent. Add the two new verifier imports and wire them:

```typescript
import {
  elevenLabsWebhookVerifierFromEnv,
  elevenLabsToolSecretVerifierFromEnv,
} from "../infrastructure/auth/elevenlabs-webhook-verifier.js"; // adjust if split files
```

Composition body:

```typescript
const env = options.env ?? process.env;
const hmacVerifierResult = elevenLabsWebhookVerifierFromEnv(env);
if (hmacVerifierResult.isErr()) throw new Error(`Boot failed: ${hmacVerifierResult.unwrapErr().message}`);
const toolSecretVerifierResult = elevenLabsToolSecretVerifierFromEnv(env);
if (toolSecretVerifierResult.isErr()) throw new Error(`Boot failed: ${toolSecretVerifierResult.unwrapErr().message}`);

const db = options.db ?? defaultDb();
const interviews = new DrizzleInterviewRepository(db);

return {
  hmacVerifier: hmacVerifierResult.unwrap(),
  toolSecretVerifier: toolSecretVerifierResult.unwrap(),
  startInterviewFromWebhookUseCase: new StartInterviewFromWebhookUseCase(interviews),
  recordAgentNoteUseCase: new RecordAgentNoteUseCase(interviews),
  recordInternalScoreUseCase: new RecordInternalScoreUseCase(interviews),
  persistCompletedTranscriptUseCase: new PersistCompletedTranscriptUseCase(interviews),
  interviewResolver: { /* unchanged */ },
};
```

#### D.5 — Update `candidate-session.composition.ts`

File (MODIFY): `apps/backend/src/composition/candidate-session.composition.ts`

Drop the `conversationCorrelationTokenFromEnv` import and the `tokenIssuerResult` block. Drop the third argument to `StartCandidateSessionUseCase` (the constructor signature shrinks in B.3):

```typescript
return {
  startCandidateSessionUseCase: new StartCandidateSessionUseCase(
    new DrizzleInterviewRepository(db),
    new ElevenLabsConversationalService(handle),
  ),
  candidateLink: options.candidateLink,
  agentId: handle.agentId,
};
```

The `assertElevenLabsAgentConfig` call stays for now (Phase E.1 may remove the `enableConversationInitiationClientDataFromWebhook` flag from the assertion since the initiation webhook is gone).

#### D.6 — Phase D type-check gate

```bash
pnpm turbo run check-types --filter=backend
```

Expected green. If red: composition still references something that was deleted; the controller test file still references old types — those are addressed in Phase F.

---

### Phase E — Live-validation scripts

Goal: rewire the provisioning + wiring + harness scripts to match the new mechanism (per-tool URLs with schemas + headers; drop initiation; pass overrides through `startSession`).

These are `.mjs`/HTML files, not part of any TypeScript package — no layer skill applies. Treat them as ops scripts.

#### E.1 — `provision-agent.mjs`

File (MODIFY): `apps/backend/scripts/live-validation/provision-agent.mjs`

Per-tool URL placeholders + per-tool schemas + per-tool `requestHeaders` carrying `x-voice-secret`. Also drop the `platformSettings.overrides.enableConversationInitiationClientDataFromWebhook: true` flag — the initiation webhook is gone.

Replace the `createWebhookTool` body with:

```javascript
async function createWebhookTool(name, description, requestBodySchema) {
  const toolSecret = process.env.ELEVENLABS_TOOL_WEBHOOK_SECRET;
  if (!toolSecret) {
    console.error("ELEVENLABS_TOOL_WEBHOOK_SECRET not set");
    process.exit(2);
  }
  const res = await client.conversationalAi.tools.create({
    toolConfig: {
      type: "webhook",
      name,
      description,
      responseTimeoutSecs: 5,
      apiSchema: {
        url: `${PLACEHOLDER_BASE}/${name}`,
        method: "POST",
        requestBodySchema,
        requestHeaders: { "x-voice-secret": toolSecret },
      },
    },
  });
  console.log(`  tool created: ${name} -> ${res.id}`);
  return res.id;
}
```

(`PLACEHOLDER_BASE` is `https://placeholder.invalid/webhooks/elevenlabs/tools`; the live URL is patched in `wire-webhooks.mjs`.)

Replace the agent's `platformSettings.overrides` block:

```javascript
platformSettings: {
  overrides: {
    conversationConfigOverride: {
      agent: {
        firstMessage: true,
        language: true,
        prompt: { prompt: true },
      },
    },
  },
},
```

(`enableConversationInitiationClientDataFromWebhook` is removed; the inline-overrides path doesn't use it.)

The `score_answer` schema needs all three fields the controller reads:

```javascript
score_answer: await ensureTool(artifacts, "score_answer",
  "Internally record a score for the candidate's most recent answer.",
  {
    type: "object",
    required: ["topic_name", "score", "justification"],
    properties: {
      topic_name: { type: "string", description: "Planned topic this score applies to." },
      score: { type: "integer", description: "Integer 0..5." },
      justification: { type: "string", description: "One-sentence reason for the score." },
    },
  }),
```

(Already mostly correct in the existing file — confirm matches the use-case's expected fields.)

#### E.2 — `wire-webhooks.mjs`

File (MODIFY): `apps/backend/scripts/live-validation/wire-webhooks.mjs`

Drop step 4 (the agent's `workspaceOverrides.conversationInitiationClientDataWebhook` patch) entirely. Replace the tool URL patch with per-tool URLs:

```javascript
for (const [name, id] of Object.entries(artifacts.toolIds)) {
  await client.conversationalAi.tools.update(id, {
    toolConfig: {
      type: "webhook",
      name,
      description: `${name} (live-validation)`,
      responseTimeoutSecs: 5,
      apiSchema: {
        url: `${tunnel}/webhooks/elevenlabs/tools/${name}`,
        method: "POST",
        requestBodySchema: TOOL_SCHEMAS[name],
        requestHeaders: { "x-voice-secret": process.env.ELEVENLABS_TOOL_WEBHOOK_SECRET },
      },
    },
  });
  console.log(`  ${name} -> ${tunnel}/webhooks/elevenlabs/tools/${name}`);
}
```

Keep the workspace post-call webhook provisioning gated on `webhooks_write` scope (still currently skipped per the comment block).

Update the artifact map to drop `initiationUrl`:

```javascript
artifacts.tunnel = tunnel;
artifacts.toolsUrlBase = `${tunnel}/webhooks/elevenlabs/tools`;
artifacts.postCallUrl = `${tunnel}/webhooks/elevenlabs/post-call`;
```

#### E.3 — `cleanup.mjs`

File (MODIFY): `apps/backend/scripts/live-validation/cleanup.mjs`

Step [2/5] (clearing workspace baseline initiation webhook via `PATCH /v1/convai/settings`) can stay — it's idempotent and harmless. If the workspace baseline was never set in the new flow, the PATCH is a no-op. **Decision: keep it; clearly comment "legacy cleanup; no-op when initiation webhook was never provisioned"** so a future reader doesn't wonder.

Step [1/5] (`workspaceOverrides: { conversationInitiationClientDataWebhook: null }`) — keep for the same reason. Idempotent.

No deletions needed; just a doc-comment touch-up.

#### E.4 — `harness.html`

File (MODIFY): `apps/backend/scripts/live-validation/harness.html`

The browser SDK now needs `overrides` + `dynamicVariables` from the backend response. Update lines 60–99:

```javascript
$("start").onclick = async () => {
  $("start").disabled = true;
  const backend = $("backend").value.trim();
  const interviewId = $("interviewId").value.trim();
  const token = $("token").value.trim();
  if (!interviewId || !token) { log("interviewId and token required", "err"); $("start").disabled = false; return; }

  log(`POST ${backend}/interviews/${interviewId}/candidate-session?token=<…>`, "info");
  let signedUrl, overrides, dynamicVariables;
  try {
    const res = await fetch(
      `${backend}/interviews/${interviewId}/candidate-session?token=${encodeURIComponent(token)}`,
      { method: "POST", credentials: "omit" },
    );
    const body = await res.json();
    if (!res.ok) { log(`backend ${res.status}: ${JSON.stringify(body)}`, "err"); $("start").disabled = false; return; }
    ({ signedUrl, overrides, dynamicVariables } = body);
    log(`got signedUrl (${signedUrl.slice(0, 50)}…), overrides + dynamicVariables`, "info");
  } catch (e) { log(`backend POST failed: ${e?.message ?? e}`, "err"); $("start").disabled = false; return; }

  log("Requesting microphone…", "info");
  try { await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { log(`mic denied: ${e?.message ?? e}`, "err"); $("start").disabled = false; return; }

  log("Starting Conversation.startSession with server-built overrides + dynamicVariables…", "info");
  try {
    conversation = await Conversation.startSession({
      signedUrl,
      overrides,
      dynamicVariables,
      onConnect: ({ conversationId }) => log(`onConnect — conversationId=${conversationId}`, "info"),
      onDisconnect: () => log("onDisconnect", "warn"),
      onMessage: ({ message, source }) => log(`onMessage [${source}] ${message?.slice?.(0, 120) ?? JSON.stringify(message).slice(0, 120)}`, "info"),
      onError: (err) => log(`onError ${err?.message ?? err}`, "err"),
      onModeChange: ({ mode }) => log(`mode -> ${mode}`, "info"),
    });
    log("conversation started", "info");
    $("end").disabled = false;
  } catch (e) { log(`startSession failed: ${e?.message ?? e}`, "err"); $("start").disabled = false; }
};
```

#### E.5 — Decide whether to drop `assertElevenLabsAgentConfig` flag check

File (MODIFY): `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts`

Since the initiation webhook is gone, `platformSettings.overrides.enableConversationInitiationClientDataFromWebhook` no longer needs to be `true`. The allow-list bits (`agent.prompt.prompt`, `agent.firstMessage`) DO still need to be `true` because the overrides arrive via `Conversation.startSession({ overrides })` — same allow-list semantics, different transport.

Drop the `enableConversationInitiationClientDataFromWebhook` check (lines 36–40) entirely. Leave the prompt + firstMessage allow-list checks in place.

ADR reference: ADR-033 §"Allow-list bits still required" — the bits gate inline-override delivery the same way they gated webhook-delivered overrides.

#### E.6 — Phase E gate

No type-check; scripts are JS/HTML. The next test run is the integrated live-validation gate (Phase H).

---

### Phase F — Tests

Goal: rewrite/regenerate test files for every changed source file. Each file gets its own bullet; the file path is followed by the test re-cases to cover.

Use `/backend-test-suite` to scaffold; hand-edit to capture the specific cases below.

#### F.1 — Application use-case tests

- `packages/application/src/use-cases/interview/start-candidate-session.use-case.test.ts` (REWRITE):
  - Happy path: SCHEDULED + plan-present → use case returns `{ signedUrl, overrides: { agent: { prompt: { prompt } } }, dynamicVariables }`; `interview.elevenLabsSessionId` saved as the `conversationId` returned by `issueSignedUrl`.
  - `agent.issueSignedUrl` returns `{ signedUrl, conversationId }` (new shape) — assert the mock receives `{ agentId, ...? }` and returns both fields.
  - Repeated call with the same `conversationId` does not re-save (idempotent bind).
  - Non-SCHEDULED → `InvalidInterviewInputError`.
  - Missing plan → `InvalidInterviewInputError`.
  - Repo `findById` error → `ServiceUnknownError`.
  - Repo `save` error after bind → `ServiceUnknownError`.
  - Adapter `issueSignedUrl` error → propagated `ConversationalSignedUrlFailedError`.
  - DynamicVariables shape: `candidate_name`, `job_title`, `target_duration_minutes`, `interview_id`.

- `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.test.ts` (REWRITE):
  - Happy path with end_call_success in final turn → AgentNote `[end_call] reason=<reason> — <message>` appended; `interview.complete()` called with the transcript entries; `entryCount` matches.
  - End_call_success not present → no AgentNote appended; `interview.complete()` still called.
  - Already COMPLETED → idempotent `{ applied: false, entryCount: 0 }`.
  - Transcript with empty/whitespace messages filtered before `TranscriptEntry.create`.
  - Transcript with `tool_calls` rows (no `role: agent|user`) skipped.
  - Walk reads `tool_results[]` from any turn, but `findEndCallSuccess` should prefer the last matching turn.
  - `appendNote` fails (not IN_PROGRESS) — treat as idempotent; still proceed to `complete()`.
  - Repo `save` error → `ServiceUnknownError`.

- DELETED test files (already covered in Phase A — listed here for completeness):
  - `assemble-conversation-initiation-context.use-case.test.ts`
  - `end-interview-from-agent.use-case.test.ts`

#### F.2 — Infrastructure tests

- `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.test.ts` (EXTEND):
  - Add tolerance-rejection case: timestamp 31 minutes in the past → `InvalidWebhookSignatureError`.
  - Add tolerance-accept case: timestamp 29 minutes in the past → OK.
  - Add malformed-timestamp case (`t=not-a-number`) → reject.
  - Keep all existing signature-mismatch / missing-header / wrong-secret cases.

- `apps/backend/src/infrastructure/auth/elevenlabs-tool-secret-verifier.test.ts` (CREATE):
  - Missing header → `InvalidToolSecretError`.
  - Matching header → `Ok`.
  - Mismatched header → `InvalidToolSecretError`.
  - Header with extra whitespace → reject (timing-safe equality is byte-exact).
  - `fromEnv` happy path returns verifier; missing secret → `Err`; secret < 32 chars → `Err`.

- `apps/backend/src/infrastructure/auth/conversation-correlation-token.test.ts` (DELETE).

- `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.test.ts` (EXTEND):
  - `issueSignedUrl` happy path now returns `{ signedUrl, conversationId }`.
  - SDK returns response with `conversationId` field → use case sees it.
  - SDK returns response without `conversationId` but `signedUrl?conversation_id=…` → URL-fallback extracts it.
  - SDK returns neither → `ConversationalSignedUrlFailedError`.

- `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.test.ts` (MODIFY):
  - Drop the test that asserts on `enableConversationInitiationClientDataFromWebhook`.
  - Keep the two allow-list-bit tests.
  - Add a test that `enableConversationInitiationClientDataFromWebhook = false` does NOT fail boot (the check is gone).

#### F.3 — Presentation tests

- `apps/backend/src/presentation/controllers/candidate-session.controller.test.ts` (EXTEND):
  - Happy path: 200 with `{ signedUrl, overrides: { agent: { prompt: { prompt } } }, dynamicVariables }`.
  - Span attribute `interview.session.override_assembled` set on success.
  - Span attribute `elevenLabs.agentId` still set.
  - `elevenLabs.sessionId` is NOT stamped at D1 (correct — binding happens in the use case, span is opened before).
  - Existing token-validation / not-found / use-case-error cases retained.

- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.test.ts` (REWRITE the tool section; KEEP session-start + post-call sections, updating post-call to the new payload shape):
  - Drop all `tool_name` body fixtures.
  - Per-handler test groups:
    - `handleNextQuestion`: x-voice-secret missing/wrong → 401; valid header → 200 ack; span `webhook.tool_name = "next_question"`; no use case invoked.
    - `handleScoreAnswer`: x-voice-secret missing/wrong → 401; valid header + valid body → `RecordInternalScoreUseCase` invoked with `topicName`, `score`, `justification`; valid header + missing fields → 400 parse_error; idempotent no-op (use case returns `{ applied: false }`) → 200; use-case error → mapped status.
    - `handleTakeNote`: same shape as score_answer; valid → `RecordAgentNoteUseCase` invoked with `note`.
  - `handleSessionStart`: HMAC verifier missing/wrong → 401; happy path unchanged.
  - `handlePostCall`:
    - Payload shape uses `body.data.conversation_id`, `body.data.transcript`, `body.data.metadata.start_time_unix_secs`, etc.
    - Unmatched `conversation_id` (resolver returns `None`) → 200 ack with `webhook.result = use_case_error` + `error.kind = INTERVIEW_NOT_FOUND` (unchanged behavior).
    - Transcript with `end_call_success` → `PersistCompletedTranscriptUseCase` called with the transcript including the end-call tool result.
    - Transcript without `end_call_success` → use case still called; controller doesn't pre-walk for end_reason.
    - D3 span stamps `elevenlabs.termination_reason` when `metadata.termination_reason` is present.

- `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.test.ts` (DELETE — handled in A.1).

#### F.4 — Phase F gate

```bash
pnpm turbo run test --filter=@repo/domain --filter=@repo/application --filter=backend
```

Expected: all tests green (except the pre-existing Drizzle/E2E ECONNREFUSED noise and the pre-existing `create-interview.dto.test.ts` failure — both unrelated to Phase 9.5).

---

### Phase G — Env

Goal: swap the env var. `.env.example` reflects the new surface; the boot fail-fast covers the new var; the old var has nowhere left to read it.

#### G.1 — `apps/backend/.env.example`

File (MODIFY):

```diff
- ELEVENLABS_SESSION_TOKEN_SECRET=at-least-32-chars-random-bytes-base64
+ ELEVENLABS_TOOL_WEBHOOK_SECRET=at-least-32-chars-random-bytes-base64
```

Line 16. Keep the line ordering otherwise.

#### G.2 — Verify no remaining references to `ELEVENLABS_SESSION_TOKEN_SECRET`

```bash
rg "ELEVENLABS_SESSION_TOKEN_SECRET" apps/backend/ packages/
```

Expected output: empty. If anything remains, it's a leftover in a comment or doc — remove or update.

#### G.3 — Verify `ELEVENLABS_TOOL_WEBHOOK_SECRET` is fail-fast at boot

Already covered by `elevenLabsToolSecretVerifierFromEnv` (C.2) and the composition wiring (D.4) — composition `throw new Error("Boot failed: …")` on Err.

#### G.4 — Update `assertElevenLabsAgentConfig` if not yet done

Already covered in E.5.

---

### Phase H — Final verification

Goal: type-check, lint, test, then live-validate.

#### H.1 — Type-check, lint, test

```bash
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run lint --filter=backend
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

All four must be green (modulo the pre-existing ECONNREFUSED and `create-interview.dto` failures noted in `docs/progress/phase-9-5.md`).

#### H.2 — Architecture validation (per layer)

```bash
/backend-arch-validator domain          # no changes, sanity only
/backend-arch-validator application     # no port-correlation, no end-interview-from-agent, no assemble-context use case
/backend-arch-validator infrastructure  # no conversation-correlation-token; new tool-secret verifier; existing patterns preserved
/backend-arch-validator presentation    # three per-tool handlers, no end_call branch, no tool_name parsing, override returned from candidate-session
```

#### H.3 — Live-validation gate

After spinning up the throwaway agent + tunnel via the rewritten scripts, run the harness and observe:

1. **Signed URL is issued** — `POST /interviews/:id/candidate-session?token=…` returns 200 with `{ signedUrl, overrides, dynamicVariables }`. `interview.elevenLabsSessionId` is set in the DB row before the response returns.
2. **Browser passes overrides through `Conversation.startSession`** — the agent's first utterance reflects the assembled prompt (canary "PINEAPPLE" or the equivalent server-built JD+CV+plan summary). This proves the inline-overrides transport works.
3. **Three tool webhooks fire** with their per-tool URLs (visible in ngrok / backend logs) — `take_note`, `score_answer`, `next_question`. Each carries the `x-voice-secret` header.
4. **The controller dispatches correctly**: `take_note` invokes `RecordAgentNoteUseCase`; `score_answer` invokes `RecordInternalScoreUseCase`; `next_question` returns 200 with no DB write.
5. **Post-call webhook arrives** at `/webhooks/elevenlabs/post-call` with HMAC signature; verifier accepts (within 30-min tolerance).
6. **Post-call extracts end_reason**: the payload's `data.transcript[<final>].tool_results[]` includes `result_type: "end_call_success"`. `PersistCompletedTranscriptUseCase` walks the transcript, appends the AgentNote `[end_call] reason=<reason>`, calls `interview.complete()`, persists.

Until each of (1)–(6) passes, the phase is **not complete**.

---

## Pseudo-workflow (end-to-end)

1. Recruiter creates + schedules an interview with a plan (unchanged from Phase 7).
2. Candidate visits the signed link, the recruiter UI hits `POST /interviews/:id/candidate-session?token=<candidate-signed-link>`.
3. Controller → `CandidateSessionController.start()`:
   - D1 span opens.
   - Candidate token verified via the existing ADR-017 helper.
   - `StartCandidateSessionUseCase.execute({ interviewId, agentId })`.
4. Use case:
   - Loads + asserts SCHEDULED + plan present.
   - `agent.issueSignedUrl({ agentId })` → `{ signedUrl, conversationId }`.
   - `interview.bindElevenLabsSession(conversationId)` (idempotent re-bind).
   - Saves the bound interview.
   - Assembles `systemPrompt` (JD + CV summary + plan + clientInstructions).
   - Returns `{ signedUrl, overrides: { agent: { prompt: { prompt } } }, dynamicVariables }`.
5. Controller stamps span attribute `interview.session.override_assembled = true`, replies 200 with the envelope.
6. Browser receives `{ signedUrl, overrides, dynamicVariables }` and calls `Conversation.startSession({ signedUrl, overrides, dynamicVariables })`.
7. ElevenLabs LiveKit accepts the inline overrides (allow-list bits set on the agent), starts the session with the server-built prompt.
8. As the agent runs, server-tool invocations dispatch:
   - `take_note(note)` → `POST /webhooks/elevenlabs/tools/take_note` with `x-voice-secret` header → `RecordAgentNoteUseCase`.
   - `score_answer({ topic_name, score, justification })` → `POST /webhooks/elevenlabs/tools/score_answer` → `RecordInternalScoreUseCase`.
   - `next_question()` → `POST /webhooks/elevenlabs/tools/next_question` → 200 ack only.
   - `end_call(reason)` is a system tool — no webhook fires; the SDK closes the WebSocket.
9. ElevenLabs delivers the `post_call_transcription` event to the workspace post-call webhook → `POST /webhooks/elevenlabs/post-call`:
   - HMAC verifier checks signature + 30-min tolerance.
   - Controller resolves `conversation_id` → `interviewId` via `findByElevenLabsSessionId`.
   - D3 span opens; D4 child span wraps the use case.
   - `PersistCompletedTranscriptUseCase` walks `transcript[].tool_results[]` for `end_call_success`, appends an AgentNote with the reason, builds TranscriptEntry VOs from the inline transcript, calls `interview.complete()`, saves.
   - D3 stamps `transcript.entry_count` on success.

---

## Entry points (innermost first)

| # | File | Layer | Operation | Purpose |
|---|---|---|---|---|
| 1 | `packages/application/src/ports/conversational-agent/conversational-agent.port.ts` | @repo/application | MODIFY | `IssueSignedUrlOutput` gains `conversationId` |
| 2 | `packages/application/src/use-cases/interview/start-candidate-session.use-case.ts` | @repo/application | MODIFY | Bind session id; assemble override; new output shape |
| 3 | `packages/application/src/use-cases/interview/persist-completed-transcript.use-case.ts` | @repo/application | MODIFY | Receive transcript inline; walk for `end_call_success` |
| 4 | `packages/application/src/use-cases/interview/index.ts` | @repo/application | MODIFY | Drop `AssembleConversationInitiationContextUseCase` + `EndInterviewFromAgentUseCase` exports; add `PostCallTranscriptEntry` / `PostCallToolResult` |
| 5 | `packages/application/src/use-cases/interview/assemble-conversation-initiation-context.use-case.ts` + `.test.ts` | @repo/application | DELETE | Mechanism gone |
| 6 | `packages/application/src/use-cases/interview/end-interview-from-agent.use-case.ts` + `.test.ts` | @repo/application | DELETE | `end_call` is a system tool |
| 7 | `packages/application/src/ports/conversation-correlation-token/` (whole directory) | @repo/application | DELETE | No correlation token in new flow |
| 8 | `packages/application/src/ports/index.ts` | @repo/application | MODIFY | Drop correlation-token re-export |
| 9 | `apps/backend/src/infrastructure/services/elevenlabs/elevenlabs-conversational.service.ts` + `.test.ts` | infra | MODIFY | `issueSignedUrl` returns `{ signedUrl, conversationId }`; URL-fallback extractor |
| 10 | `apps/backend/src/infrastructure/services/elevenlabs/agent-config-assertion.ts` + `.test.ts` | infra | MODIFY | Drop `enableConversationInitiationClientDataFromWebhook` check |
| 11 | `apps/backend/src/infrastructure/auth/elevenlabs-webhook-verifier.ts` + `.test.ts` | infra | MODIFY | Add 30-min tolerance + clock-skew tests |
| 12 | `apps/backend/src/infrastructure/auth/elevenlabs-tool-secret-verifier.ts` + `.test.ts` | infra | CREATE | New shared-secret-header verifier |
| 13 | `apps/backend/src/infrastructure/auth/conversation-correlation-token.ts` + `.test.ts` | infra | DELETE | Mechanism gone |
| 14 | `apps/backend/src/infrastructure/auth/index.ts` | infra | MODIFY | Drop correlation-token re-exports; add tool-secret verifier exports |
| 15 | `apps/backend/src/presentation/controllers/candidate-session.controller.ts` + `.test.ts` | presentation | MODIFY | Return overrides + dynamicVariables; span attribute |
| 16 | `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts` + `.test.ts` | presentation | MODIFY | Three per-tool handlers; drop end_call branch + tool_name parser; rewrite post-call payload parser |
| 17 | `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts` + `.test.ts` | presentation | DELETE | Initiation surface gone |
| 18 | `apps/backend/src/presentation/routes/webhooks/elevenlabs-webhooks.routes.ts` | presentation | MODIFY | Three per-tool POSTs |
| 19 | `apps/backend/src/presentation/routes/webhooks/elevenlabs-initiation-webhook.routes.ts` | presentation | DELETE | Initiation route gone |
| 20 | `apps/backend/src/composition/candidate-session.composition.ts` | composition | MODIFY | Drop correlation-token wire; drop third constructor arg |
| 21 | `apps/backend/src/composition/elevenlabs-webhook.composition.ts` | composition | MODIFY | Two verifiers; drop EndInterview wire; drop agent (no longer needed by persist-transcript) |
| 22 | `apps/backend/src/composition/elevenlabs-initiation-webhook.composition.ts` | composition | DELETE | Composition for deleted route |
| 23 | `apps/backend/src/app.ts` | app | MODIFY | Drop every `elevenLabsInitiationWebhook` reference |
| 24 | `apps/backend/.env.example` | env | MODIFY | Swap `ELEVENLABS_SESSION_TOKEN_SECRET` → `ELEVENLABS_TOOL_WEBHOOK_SECRET` |
| 25 | `apps/backend/scripts/live-validation/provision-agent.mjs` | scripts | MODIFY | Per-tool URLs + headers; drop initiation flag |
| 26 | `apps/backend/scripts/live-validation/wire-webhooks.mjs` | scripts | MODIFY | Per-tool URL patches; drop initiation wiring |
| 27 | `apps/backend/scripts/live-validation/cleanup.mjs` | scripts | MODIFY | Idempotent legacy cleanup comment |
| 28 | `apps/backend/scripts/live-validation/harness.html` | scripts | MODIFY | Pass `overrides` + `dynamicVariables` to `startSession` |

---

## Verification commands (full)

```bash
# Type / lint
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend
pnpm turbo run lint --filter=backend

# Tests
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend

# Sanity sweeps — must return zero matches after the revision
rg "enableConversationInitiationClientDataFromWebhook" apps/backend/
rg "conversation-correlation-token" apps/backend/ packages/
rg "EndInterviewFromAgent" apps/backend/ packages/
rg "AssembleConversationInitiationContext" apps/backend/ packages/
rg "ELEVENLABS_SESSION_TOKEN_SECRET" apps/backend/ packages/
rg "registerElevenLabsInitiationWebhookRoutes|elevenLabsInitiationWebhook" apps/backend/src

# Live validation (after deploy + ngrok)
node apps/backend/scripts/live-validation/provision-agent.mjs
node apps/backend/scripts/live-validation/wire-webhooks.mjs https://<tunnel>
# Open harness.html in a browser; perform a real conversation; observe (1)–(6) under "Live-validation gate" above.
```

---

## Verification checklist (final, tickable)

- [ ] type-check clean across `@repo/domain`, `@repo/application`, `backend`
- [ ] lint clean for `backend`
- [ ] all existing tests pass; new/changed tests pass (modulo the pre-existing ECONNREFUSED + `create-interview.dto` failures unrelated to 9.5)
- [ ] `/backend-arch-validator` clean per layer
- [ ] Live validation gate passes:
  - [ ] (1) signed URL issued + `elevenLabsSessionId` bound at issuance
  - [ ] (2) override delivered through `Conversation.startSession` and agent's first utterance reflects the assembled prompt
  - [ ] (3) `take_note` webhook fires, dispatches `RecordAgentNoteUseCase`
  - [ ] (4) `score_answer` webhook fires, dispatches `RecordInternalScoreUseCase`
  - [ ] (5) `next_question` webhook fires, 200 ack only
  - [ ] (6) post-call payload extracts `end_reason` from `transcript[].tool_results[]`, appends AgentNote, persists transcript, calls `interview.complete()`
- [ ] no `enableConversationInitiationClientDataFromWebhook` references anywhere in `apps/backend/` (sanity sweep)
- [ ] no `conversation-correlation-token` references anywhere in `apps/backend/` or `packages/` (sanity sweep)
- [ ] no `EndInterviewFromAgentUseCase` references anywhere (sanity sweep)
- [ ] no `AssembleConversationInitiationContextUseCase` references anywhere (sanity sweep)
- [ ] no `ELEVENLABS_SESSION_TOKEN_SECRET` references anywhere (sanity sweep)
- [ ] `bin/adr-judge` (if installed) passes the new ADR-033 / ADR-034 enforcement rules

---

## Open questions / dependencies

1. **ADR-033 and ADR-034 are being authored in parallel** with this plan. The plan references them by number; if numbering shifts at acceptance time, update the `## Implementation steps` ADR-reference annotations. Both should land before the revision is committed so the pre-commit `bin/adr-judge` enforcement matches the new mechanism.

2. **ADR-013 amendment**: `end_interview` wording — the agent invokes `end_call` (system tool); the reason is observable only in the post-call transcript's `tool_results[]`. Not load-bearing for the implementation but should be amended for documentation hygiene.

3. **ADR-032 amendment**: drop D5 (`interview.webhook.initiation`) from the span list; tighten D4 (`interview.session.transcript-persist`) to stamp the extracted end-reason as a span attribute (e.g. `interview.end_reason = "<reason>"`).

4. **Frontend follow-up — out of scope for this plan.** `InterviewSessionContainer` (in `apps/web/src/containers/`) needs to:
   - Consume `{ signedUrl, overrides, dynamicVariables }` from the candidate-session response.
   - Pass them through to `Conversation.startSession({ signedUrl, overrides, dynamicVariables })`.
   - Drop any reference to `sessionToken`.
   This is a small frontend change but it is the only thing that closes the loop on the live-validation gate's check (2). A separate `/frontend-implement` session must pick this up.

5. **ElevenLabs Discord clarifying question (staged).** The user is asking ElevenLabs whether `conversation_initiation_client_data_webhook` can be made to fire for browser SDK sessions. If ElevenLabs confirms "Twilio-only", this plan stands as written. If ElevenLabs surfaces a configuration that does fire the webhook for browser sessions, ADRs 033/034 would need supersession to a hybrid design — but the deletion path in this plan is still a valid clean-slate; the user can choose to invest in the new mechanism in a later phase. **No code change here is contingent on the answer.**

6. **Per-tool body correlation vs URL path parameter (D.2 decision point).** Whether `dynamic_variables` propagate into per-tool webhook bodies needs to be confirmed at implementation time by observing one real per-tool webhook payload. If they do (likely path), the controller's `parseToolCorrelation` reads `interview_id` / `conversation_id` from the body. If they don't, the agent's `apiSchema.url` is set to `<base>/webhooks/elevenlabs/tools/:tool_name/:interview_id` and the controller reads `req.params`. The plan defaults to body-correlation; the fallback is annotated.

7. **`IConversationalAgentService.getTranscript` is now unused** by any use case. Leave it on the port — useful for the deferred Phase 10 reconciliation sweep — but consider whether to mark it `@deprecated` or document the future usage. Not blocking.

---

## Risk notes

- **Half-deletion fragility.** The deletion phase has high mechanical risk because every deleted symbol is referenced from at least two other files (composition + controller + use-case barrel + app.ts). The phasing above is the safe order, but the type-check gate at the end of each phase is non-negotiable. If a gate fails, do not proceed.

- **Per-tool URL discriminator must match agent provisioning.** The controller's three handlers and the agent's three custom tools' `apiSchema.url` values must agree on path layout. If the agent provisioning script sets `/tools/<name>` but the route plugin mounts `/tools/<name>` after a different prefix, the agent's webhook will 404. The composition + route mount + provisioning script must be reviewed together at execution time.

- **30-minute tolerance is documented but untested live.** The SDK source confirms 30 minutes; the current verifier had no tolerance check (zero tolerance, which the SDK does not enforce). A clock-skewed worker pod could have been rejecting valid webhooks before this revision; after, it is more permissive. Monitor signature-rejected span attribute volume after deploy to catch any regression.

- **Inline overrides allow-list silent-drop.** The `agent.prompt.prompt = true` and `agent.firstMessage = true` allow-list bits are still load-bearing — without them, ElevenLabs silently drops the inline override in `Conversation.startSession`. The `assertElevenLabsAgentConfig` boot check stays for these two bits. This is the highest-leverage defensive guard in the revised flow; do not drop it.

- **Post-call payload field-name pinning.** The use case + controller now hardcode SDK-documented snake_case field names (`conversation_id`, `time_in_call_secs`, `tool_results`, `result_type`, `start_time_unix_secs`, `call_duration_secs`, `termination_reason`). If ElevenLabs ships a non-breaking rename to camelCase, parsing falls silent and persists become no-ops. Bump the SDK version pin in `package.json` and re-verify field names against the live SDK types at every dependency update.

- **`end_call_success` payload field shape.** The SDK type is `ConversationHistoryTranscriptSystemToolResultCommonModelInput` with `EndCallSuccess` carrying `{ status, reason, message }`. The walk pulls `reason` + `message`. If the live payload field is `result_value` vs `result_value_json` (or similar), the parser silently misses. Add a single log-line warning in `findEndCallSuccess` when a `tool_results[]` row exists but `resultValue` is missing — diagnostic, not blocking.

- **Test rewrites are wide.** Two test files are fully rewritten, three are heavily edited, two are deleted. Risk of accidentally dropping a regression test. Cross-check by `git diff --stat` per commit; any test file with a net negative line count > 100 needs a re-read.

- **`getTranscript` adapter code stays but is dead.** Keep it documented + tested but not invoked. A reviewer may flag this as dead code; the response is "reserved for Phase 10 reconciliation sweep". Surface this in the code review session.

---

## Architectural debt carried over from the first pass

These items were surfaced by `bin/adr-judge` when the first-pass commit landed. They MUST be addressed during this revision pass.

### ADR-018 compliance — 13 violations in the new controllers

`bin/adr-judge` flagged 9 `forbid_pattern` hits + 4 `require_pattern` misses against ADR-018 (*"Controllers must use `mapServiceErrorToHttp` for error status codes, not hardcoded `reply.code()` calls"*). The first-pass commit was landed with `ADR_KIT_HOOK_DISABLE=1` per explicit user authorization on the understanding that the revision pass fixes this.

Violation sites:
- `apps/backend/src/presentation/controllers/candidate-session.controller.ts:98` — `reply.code(200).send(result.unwrap())`
- `apps/backend/src/presentation/controllers/elevenlabs-initiation-webhook.controller.ts:57, 77` — both being deleted in Phase A; violations evaporate
- `apps/backend/src/presentation/controllers/elevenlabs-webhook.controller.ts:142, 180, 189, 245, 316, 323` — six sites mixing success-acks (200), HMAC rejection (401), bad-body (400)
- Four `require_pattern` misses on the new controller test files: `candidate-session.controller.test.ts`, `elevenlabs-initiation-webhook.controller.test.ts` (file deleted in Phase A → moot), `elevenlabs-webhook.controller.test.ts`, `recruiter-interview.controller.test.ts`

Two distinct fix patterns are required:

1. **Genuine error paths** (HMAC 401, payload validation 400, unknown failure 500) should call `mapServiceErrorToHttp` with the corresponding `ServiceError` discriminant. The webhook verifier and parsing helpers need to return `Result<…, ServiceError>` rather than throwing or `reply.code(…)`-ing inline.

2. **200-ack-on-fire-and-forget paths** (the dual HTTP-200/span-truthful contract from ADR-034) don't have an error to map. The cleanest fix is to extend the controller test files to `mapServiceErrorToHttp` for the genuine-error branches; ADR-018's `require_pattern` is satisfied at the file level (just needs the import + usage in some branch), so adding the helper to the error branches naturally lights up the require-pattern check without forcing every 200 through the mapper.

A small Edit pass after Phase D (presentation rewrite) is the right window — the controllers are already being heavily edited then, so weaving in the mapper calls is cheap incremental cost. **Add this as a Phase D sub-step in the implementation.**

### ADR pre-commit LLM judge timeout

The LLM judge timed out at the default 120s with 25 `llm_judge: true` ADRs in the diff (the supersession adds another two). Bump `judge.llm_timeout_seconds` to 300 in `docs/adr/.adr-kit.json` (file may need to be created) so the next session's commits get a real LLM pass instead of silent-skip. Not blocking but worth doing while the env is hot.

### docs/adr/README.md needs the two new ADRs

The README currently lists ADR-029 through ADR-032. Once ADR-033 and ADR-034 land, the README must be updated to include them with their supersession metadata. Cross-references in the existing entries for ADR-030 and ADR-031 should annotate `(Superseded by ADR-033)` / `(Superseded by ADR-034)`.
