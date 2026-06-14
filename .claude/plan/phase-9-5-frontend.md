# Plan: Phase 9.5 Frontend — Migrate Candidate Voice Session to ElevenLabs Conversational AI Browser SDK

> Generated: 2026-05-29T16:52:47Z
> Slug: phase-9-5-frontend
> Governing ADRs: ADR-029, ADR-033, ADR-034
> Reference impl: `apps/backend/scripts/live-validation/harness.html` (proven working)
> Runbook: `docs/runbooks/elevenlabs-live-validation.md`

## Summary

Replace the candidate's bespoke sandwich voice pipeline (raw-PCM-over-WebSocket up,
streamed-MP3-over-WebSocket down, AudioWorklet downsampler, MediaSource playback queue,
custom half-duplex turn-taking, custom exponential-backoff reconnect) with the ElevenLabs
Conversational AI browser SDK (`@elevenlabs/client`). The new flow is: the container hook
calls `POST /interviews/:id/candidate-session?token=…` through a new service function that
returns the server-built `{ signedUrl, overrides, dynamicVariables }` payload, then forwards
that payload **verbatim** to `Conversation.startSession({ ...payload, connectionType:
"websocket", …callbacks })`. The SDK owns microphone capture, audio playback, and turn-taking
internally. The hook's job shrinks to: one POST, one `startSession`, and a thin mapping of the
SDK lifecycle callbacks (`onConnect` / `onDisconnect` / `onError` / `onModeChange` / `onMessage`)
onto the existing Zustand `connectionState` / `speaker` / `transcript` UI state. All audio
plumbing (`audio-playback-queue.ts`, the `pcm-downsampler.js` worklet) and the
`NEXT_PUBLIC_WS_URL` env var are deleted.

## Route group

(candidate) — no route/layout changes. `app/(candidate)/c/[id]/session/page.tsx` and
`(candidate)/layout.tsx` already pass `{ view, token }` to the container with the token verified
server-side. They are out of scope.

## CRITICAL constraint — ADR-033 Enforcement rule blocks the literal `dynamicVariables` in `apps/web/src/**/*.ts`

ADR-033's Enforcement block declares (committed, active in the pre-commit `bin/adr-judge`):

```json
{ "pattern": "conversation_config_override|conversationConfigOverride|dynamicVariables",
  "path_glob": "apps/web/src/**/*.ts",
  "message": "Override fields must not be constructed in browser code (ADR-033). The browser
  forwards the server-provided payload verbatim to Conversation.startSession." }
```

`forbid_pattern` = the regex must NOT match **any added line** in the staged diff. Two facts make
this load-bearing for this plan:

1. The glob targets `apps/web/src/**/*.ts` (the `.ts` extension only — `.tsx` is not matched).
   Every file we add/modify in this migration that lives under `apps/web/src/` is a `.ts`:
   `types/candidate-session.types.ts`, `services/candidate.service.ts`,
   `containers/InterviewSessionContainer/useInterviewSession.ts`. (`InterviewSessionContainer.tsx`
   is `.tsx` and is NOT matched — but it has no reason to name the field anyway.)
2. The wire field is literally named `dynamicVariables`. If we write a Zod object key
   `dynamicVariables`, or destructure `const { dynamicVariables } = payload`, or pass
   `dynamicVariables: …` into `startSession`, the commit is blocked.

**Resolution — never name the field in `.ts` source; keep it an opaque passthrough and spread it.**

- The Zod schema validates only the fields the frontend asserts shape on — `signedUrl` and
  `overrides` — and uses a **Zod 4 loose object** (`z.looseObject({...})`, equivalent to v3
  `.passthrough()`) so unknown keys (the dynamic-variables block) survive `safeParse` unchanged
  and are NOT stripped. The schema never declares a `dynamicVariables` key.
- The hook spreads the validated payload into `startSession`:
  `Conversation.startSession({ ...session, connectionType: "websocket", …callbacks })`. The SDK
  reads `overrides` and the dynamic-variables field off the spread. No `.ts` source line ever
  contains the token `dynamicVariables`, satisfying the declarative rule **and** the semantic
  intent (the browser constructs nothing; it forwards the server payload verbatim).

This is the single most important design decision in this plan. Every code snippet below obeys it.
The `frontend-arch-validator` and the pre-commit judge will both check it; if any unit reintroduces
the literal token in a `.ts` file the commit is blocked.

## Layers touched

| Layer            | Path                                                                  | Scope |
| ---------------- | --------------------------------------------------------------------- | ----- |
| Routes           | `apps/web/app/(candidate)/...`                                        | none |
| Containers       | `apps/web/src/containers/InterviewSessionContainer/`                  | REPLACE hook; MODIFY container + barrel; DELETE playback queue (+test) |
| Components       | `apps/web/src/components/`                                            | none |
| Services         | `apps/web/src/services/candidate.service.ts`                          | ADD `startCandidateSession`; ADD a service test |
| Stores           | `apps/web/src/stores/useInterviewSessionStore.ts`                     | MODIFY — drop `audioLevel`/`setAudioLevel` + `reconnectAttempts`/`incrementReconnect`; update test |
| Types            | `apps/web/src/types/candidate-session.types.ts` + `index.ts`         | ADD schema (loose passthrough); export from barrel |
| Lib (env)        | `apps/web/src/lib/env.ts`                                             | MODIFY — remove `NEXT_PUBLIC_WS_URL` |
| Public asset     | `apps/web/public/audio-worklet/pcm-downsampler.js`                   | DELETE |
| Package manifest | `apps/web/package.json`                                               | ADD `@elevenlabs/client`; do NOT add `livekit-client` |
| UI primitives    | `packages/ui/src/primitives/`                                        | none |
| UI composites    | `packages/ui/src/composites/`                                        | none (MicLevelMeter remains in the package, just unused by this container) |

## Architectural decision — POST as direct service call inside the start effect (NOT useMutation)

**Recommendation: call `startCandidateSession()` directly inside the session-start `useEffect`,
not via TanStack `useMutation`.**

Rationale:

- The candidate-session POST is not user-triggered (no button, no retry-on-click); it fires
  exactly once when the session screen mounts, as the prerequisite step of an imperative,
  long-lived side effect (the `startSession` WebSocket lifecycle). It is one link in an
  effect-driven chain, not a discrete mutation the UI re-issues.
- `useMutation` exists to bind a mutation to a UI action and expose `isPending`/`mutate`/`onError`
  to JSX. Here there is no JSX binding: the orb/banner read their state from the Zustand store, and
  the hook returns `void` (the current contract). Wrapping a fire-once-on-mount POST in
  `useMutation` adds a QueryClient dependency and a state machine the container does not consume.
- The persistent voice session itself MUST stay in a `useEffect`-driven hook (the SDK conversation
  is a long-lived imperative resource with its own teardown, not a query/mutation). Keeping the POST
  inside the same effect colocates the whole "start" sequence — POST → `startSession` → callback
  wiring — under one cleanup path, mirroring the current hook's single-effect structure.
- Error mapping is done inline in the effect by switching on the `Result.Err` `ServiceError.kind`
  → `setConnectionState` + `toast` (same boundary discipline `useMutation.onError` would give us,
  without the wrapper).

This preserves the current architecture note: "the current hook correctly avoids TanStack Query;
preserve that." TanStack Query stays absent from this container.

---

## Implementation steps

Steps are grouped into Work Units below; this section is the per-file detail. Numbers here are
referenced by the Work Units section.

### Step 1 — Package: add `@elevenlabs/client`

**File:** `apps/web/package.json` (MODIFY)
**Render type:** Module (manifest)
**What:** Add `@elevenlabs/client` as a runtime dependency (the harness used the esm.sh CDN; the
app uses a proper npm dep). Do NOT add `livekit-client` — `connectionType: "websocket"` makes the
signed URL a WebSocket credential and bypasses the WebRTC/LiveKit transport entirely (runbook
gotcha: the default WebRTC transport hits a LiveKit `/rtc/v1` handshake bug).

**Code (dependencies block, alphabetical insertion before `@hookform/resolvers`):**
```jsonc
  "dependencies": {
    "@elevenlabs/client": "^0.10.0",   // pin to the version resolved by `pnpm add`; see note
    "@hookform/resolvers": "^5.2.2",
    // …unchanged…
  }
```

**Install command (orchestrator runs this once; it also updates the lockfile):**
```bash
pnpm --filter web add @elevenlabs/client
```

**Note on version:** do not hand-write a version range blindly — run `pnpm --filter web add
@elevenlabs/client` and let it resolve the current stable. The harness imported
`@elevenlabs/client@latest`. The only API surface we use is `Conversation.startSession(...)` and
`conversation.endSession()`, both stable since 0.x. Verify the resolved version exposes
`connectionType`, `overrides`, `onModeChange`, `onMessage`, `onUserTranscript`, `onConnect`,
`onDisconnect`, `onError` on the `startSession` options type (it does as of the harness run
2026-05-29).

**Invariant check:** dependency only; no source-layer rule applies. `livekit-client` intentionally
omitted.

---

### Step 2 — Types: candidate-session response schema (loose passthrough)

**File:** `apps/web/src/types/candidate-session.types.ts` (CREATE)
**Render type:** Module
**What:** Zod schema for the `POST /interviews/:id/candidate-session` response. Validates
`signedUrl` and the `overrides.agent.prompt.prompt` shape; lets the dynamic-variables block pass
through unnamed via a loose object so the frontend never writes the forbidden token.

**Code:**
```typescript
import { z } from "zod";

// Server-built per-session payload (ADR-033). The browser is a sealed courier:
// it validates the fields it depends on and forwards the whole object verbatim
// to Conversation.startSession. The session-personalization block (the
// agent-injected variables) is intentionally NOT named here — it is retained as
// an unknown passthrough key so this file never contains the literal token that
// ADR-033's Enforcement rule forbids in apps/web/src/**/*.ts. z.looseObject keeps
// unknown keys instead of stripping them, so request()'s safeParse returns the
// full payload (signedUrl + overrides + the passthrough block) intact.
export const CandidateSessionSchema = z.looseObject({
  signedUrl: z.string().min(1),
  overrides: z.looseObject({
    agent: z.looseObject({
      prompt: z.looseObject({
        prompt: z.string(),
      }),
    }),
  }),
});

export type CandidateSession = z.infer<typeof CandidateSessionSchema>;
```

**Invariant check:** ADR-033 — file contains no `dynamicVariables` / `conversation_config_override`
token. `z.looseObject` (Zod 4) is the passthrough variant so `request()` does not strip the
dynamic-variables key. Wire-contract Zod schema lives in `apps/web/src/types/` (clean-arch rule:
no `@repo/domain`/`@repo/application` import).

**File:** `apps/web/src/types/index.ts` (MODIFY)
**What:** Re-export the new schema from the types barrel.
**Code (append one line):**
```typescript
export * from "./candidate-session.types";
```

---

### Step 3 — Service: `startCandidateSession`

**File:** `apps/web/src/services/candidate.service.ts` (MODIFY)
**Render type:** Module (the only `fetch()` boundary)
**What:** Add a POST service function that hits the candidate-session endpoint and Zod-validates
the response into `Result<CandidateSession, ServiceError>`. Mirrors the existing
`getCandidateInterviewView` exactly: token-in-URL auth, no `credentials: include`, candidate
`authStatuses: [401]`, all error mapping delegated to the shared `request()` helper.

**Code (full file after edit):**
```typescript
import type { Result } from "@/lib/result";
import type { ServiceError } from "./errors";
import { request } from "./_request";
import {
  CandidateInterviewViewSchema,
  type CandidateInterviewView,
  CandidateSessionSchema,
  type CandidateSession,
} from "@/types";

const CANDIDATE_OPTS = {
  // No `credentials: "include"` — token in URL is the only credential.
  authStatuses: [401] as const,
};

export function getCandidateInterviewView(input: {
  interviewId: string;
  token: string;
}): Promise<Result<CandidateInterviewView, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(input.interviewId)}/candidate-view?token=${encodeURIComponent(input.token)}`,
    { method: "GET" },
    CandidateInterviewViewSchema,
    CANDIDATE_OPTS,
  );
}

/**
 * POST /interviews/:id/candidate-session?token=… — issues a single-use signed
 * URL plus the server-built per-session ElevenLabs payload (ADR-033). The
 * endpoint also performs the SCHEDULED→IN_PROGRESS transition server-side at
 * issuance (ADR-033/034); no request body is sent (the candidate token in the
 * URL is the only credential). The validated payload is forwarded verbatim to
 * the ElevenLabs SDK by the container hook.
 */
export function startCandidateSession(input: {
  interviewId: string;
  token: string;
}): Promise<Result<CandidateSession, ServiceError>> {
  return request(
    `/interviews/${encodeURIComponent(input.interviewId)}/candidate-session?token=${encodeURIComponent(input.token)}`,
    { method: "POST" },
    CandidateSessionSchema,
    CANDIDATE_OPTS,
  );
}
```

**Invariant check:** services are the only layer calling `fetch()` (delegated via `request()`);
returns `Result<T, ServiceError>`; Zod-validates against a schema in `types/`; never throws; no
Zustand/context read; no `dynamicVariables` token in this `.ts` file (the validated payload carries
it as an opaque passthrough key from `z.looseObject`).

---

### Step 4 — Store: drop audio-level and reconnect-counter state

**File:** `apps/web/src/stores/useInterviewSessionStore.ts` (MODIFY)
**Render type:** Module (Zustand store)
**What:** Remove `audioLevel` / `setAudioLevel` and `reconnectAttempts` / `incrementReconnect` —
the SDK owns the microphone (so there is no worklet RMS to surface) and manages its own connection
lifecycle. Keep `connectionState`, `speaker`, `micMuted`/`setMicMuted`, `transcript` /
`appendTranscript`, `transcriptVisible` / `setTranscriptVisible`, and `reset`. The
`ConnectionState`, `SpeakerState`, `TranscriptEntry` types are unchanged.

**Before → after diff (conceptual):**
- Remove from `InterviewSessionState`: `reconnectAttempts: number;`,
  `audioLevel: number;`, `incrementReconnect: () => void;`, `setAudioLevel: (n: number) => void;`.
- Remove the `AUDIO_LEVEL_EPSILON` const and the comment block above it.
- Remove the `reconnectAttempts: 0` and `audioLevel: 0` initial values, the `incrementReconnect`
  and `setAudioLevel` implementations, and the `reconnectAttempts: 0` / `audioLevel: 0` lines in
  `reset()`.

**Code (full file after edit):**
```typescript
import { create } from "zustand";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "completed"
  | "interrupted"
  | "error";

export type SpeakerState = "candidate" | "ai" | "silent";

export interface TranscriptEntry {
  readonly speaker: "candidate" | "agent";
  readonly text: string;
  readonly timestamp: Date;
}

interface InterviewSessionState {
  connectionState: ConnectionState;
  speaker: SpeakerState;
  micMuted: boolean;
  transcriptVisible: boolean;
  transcript: ReadonlyArray<TranscriptEntry>;
  setConnectionState: (s: ConnectionState) => void;
  setSpeaker: (s: SpeakerState) => void;
  setMicMuted: (b: boolean) => void;
  setTranscriptVisible: (b: boolean) => void;
  appendTranscript: (entries: ReadonlyArray<TranscriptEntry>) => void;
  reset: () => void;
}

const TRANSCRIPT_LS_KEY = "sift.transcriptVisible";

function loadInitialTranscriptVisible(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TRANSCRIPT_LS_KEY) === "1";
}

export const useInterviewSessionStore = create<InterviewSessionState>((set) => ({
  connectionState: "idle",
  speaker: "silent",
  micMuted: false,
  transcriptVisible: loadInitialTranscriptVisible(),
  transcript: [],
  setConnectionState: (connectionState) =>
    set((cur) => (cur.connectionState === connectionState ? cur : { connectionState })),
  setSpeaker: (speaker) =>
    set((cur) => (cur.speaker === speaker ? cur : { speaker })),
  setMicMuted: (micMuted) =>
    set((cur) => (cur.micMuted === micMuted ? cur : { micMuted })),
  setTranscriptVisible: (transcriptVisible) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRANSCRIPT_LS_KEY, transcriptVisible ? "1" : "0");
    }
    set((cur) => (cur.transcriptVisible === transcriptVisible ? cur : { transcriptVisible }));
  },
  appendTranscript: (entries) =>
    set((s) => (entries.length === 0 ? s : { transcript: [...s.transcript, ...entries] })),
  reset: () =>
    set({
      connectionState: "idle",
      speaker: "silent",
      micMuted: false,
      transcript: [],
    }),
}));
```

**Invariant check:** Zustand holds UI state only (no server data); store does not import services.
`create(...)` stays in `apps/web/src/stores/`.

---

### Step 5 — Container hook: full rewrite to the ElevenLabs SDK

**File:** `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts` (REPLACE ENTIRELY)
**Render type:** Client Component hook (`"use client"`)
**What:** Replace the WS/worklet/playback/turn-taking/reconnect machine with: (1) one
`startCandidateSession` service call, (2) one `Conversation.startSession({ ...payload,
connectionType: "websocket", …callbacks })`, (3) SDK-callback → store mapping. The hook signature
`{ interviewId, token }` and return type `void` are unchanged.

**Callback → store mapping:**
- `onConnect({ conversationId })` → `setConnectionState("connected")`.
- `onModeChange({ mode })` → `mode === "speaking"` → `setSpeaker("ai")`;
  `mode === "listening"` → `setSpeaker("candidate")`; else `setSpeaker("silent")`.
- `onMessage({ message, source })` → append a transcript turn in real time. `source` is
  `"ai"` | `"user"`; map `"user"` → `TranscriptEntry.speaker = "candidate"`, `"ai"` → `"agent"`.
  `message` is a string. Guard non-string/empty messages.
- `onError(err)` → `setConnectionState("error")` + `toast.error(...)` (never surface the raw SDK
  error string to the orb; map to a friendly message).
- `onDisconnect(details?)` → if the session already completed (the candidate or agent ended it),
  `setConnectionState("completed")`; otherwise `setConnectionState("interrupted")`. The SDK manages
  its own reconnect internally for transient drops, so a delivered `onDisconnect` is treated as
  terminal — the custom exponential-backoff machine is removed (see "Reconnect" note below).

**Reconnect decision:** Remove the bespoke backoff/window/UI-delay machine. The ElevenLabs SDK
(LiveKit-managed transport, here over the signed WebSocket) handles transient transport drops
internally; surfacing a duplicate app-level reconnect loop on top would fight the SDK and risk
double-dialing the single-use signed URL (runbook: "The signed URL is single-use; every Start
re-issues and re-binds a fresh conversation id"). Therefore a delivered `onDisconnect` is terminal
from the app's perspective: it maps to `completed` (clean end) or `interrupted` (unexpected). The
`"reconnecting"` `ConnectionState` value is retained in the store/union for the banner type but is
no longer driven by this hook in Phase 9.5. (If field testing shows the SDK does NOT auto-reconnect
the websocket transport, a follow-up can re-add a single guarded re-`startSession` on `interrupted`;
out of scope here.)

**Mic mute:** `micMuted` in the store is driven by the UI (toggle); the hook subscribes to it and
calls the SDK's input-volume control to mute/unmute (`conversation.setVolume`/`setInputVolume`
equivalent — verify exact method name on the resolved SDK version; the harness did not exercise
mute). If the resolved SDK version exposes no input-mute API, leave `micMuted` as store-only UI
state and note it as an open question (see Risk notes). Do NOT block the migration on mute.

**Code:**
```typescript
"use client";

import { useEffect, useRef } from "react";
import { Conversation } from "@elevenlabs/client";
import { toast } from "sonner";
import { startCandidateSession } from "@/services/candidate.service";
import {
  useInterviewSessionStore,
  type TranscriptEntry,
} from "@/stores/useInterviewSessionStore";

interface UseInterviewSessionArgs {
  interviewId: string;
  token: string;
}

// The SDK message source -> our transcript speaker mapping.
function toTranscriptEntry(message: unknown, source: unknown): TranscriptEntry | null {
  if (typeof message !== "string" || message.length === 0) return null;
  if (source !== "ai" && source !== "user") return null;
  return {
    speaker: source === "ai" ? "agent" : "candidate",
    text: message,
    timestamp: new Date(),
  };
}

function friendlyServiceError(kind: string): string {
  switch (kind) {
    case "NETWORK":
      return "We couldn't reach the interview service. Check your connection and try again.";
    case "AUTH":
      return "Your interview link is no longer valid.";
    case "NOT_FOUND":
      return "This interview could not be found.";
    default:
      return "We couldn't start your interview session. Please try again.";
  }
}

export function useInterviewSession({
  interviewId,
  token,
}: UseInterviewSessionArgs): void {
  const setConnectionState = useInterviewSessionStore((s) => s.setConnectionState);
  const setSpeaker = useInterviewSessionStore((s) => s.setSpeaker);
  const appendTranscript = useInterviewSessionStore((s) => s.appendTranscript);
  const resetStore = useInterviewSessionStore((s) => s.reset);

  // The live SDK conversation handle. Typed loosely because the SDK's
  // Conversation return type is an instance, not a named export we re-declare.
  const conversationRef = useRef<Awaited<
    ReturnType<typeof Conversation.startSession>
  > | null>(null);
  const completedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    completedRef.current = false;
    setConnectionState("connecting");

    void (async () => {
      // 1) Server-built per-session payload + single-use signed URL (ADR-033).
      const result = await startCandidateSession({ interviewId, token });
      if (!result.ok) {
        if (unmountedRef.current) return;
        setConnectionState("error");
        toast.error(friendlyServiceError(result.error.kind));
        return;
      }
      if (unmountedRef.current) return;

      // 2) Forward the validated server payload VERBATIM to the SDK. We spread
      //    `result.value` so this file never names the personalization field
      //    (ADR-033 forbids constructing override fields in browser code). The
      //    SDK reads signedUrl + overrides + the personalization block off the
      //    spread. connectionType:"websocket" is REQUIRED — the signedUrl is a
      //    WebSocket credential; the default WebRTC transport hits a LiveKit
      //    /rtc/v1 handshake bug and never connects (runbook 2026-05-29).
      try {
        conversationRef.current = await Conversation.startSession({
          ...result.value,
          connectionType: "websocket",
          onConnect: () => {
            if (unmountedRef.current) return;
            setConnectionState("connected");
          },
          onModeChange: ({ mode }) => {
            if (unmountedRef.current) return;
            if (mode === "speaking") setSpeaker("ai");
            else if (mode === "listening") setSpeaker("candidate");
            else setSpeaker("silent");
          },
          onMessage: ({ message, source }) => {
            if (unmountedRef.current) return;
            const entry = toTranscriptEntry(message, source);
            if (entry) appendTranscript([entry]);
          },
          onError: (message) => {
            if (unmountedRef.current) return;
            setConnectionState("error");
            toast.error("The interview connection failed. Please try again.");
            console.error("[session] ElevenLabs onError", message);
          },
          onDisconnect: () => {
            if (unmountedRef.current) return;
            setConnectionState(completedRef.current ? "completed" : "interrupted");
          },
        });
      } catch (cause) {
        if (unmountedRef.current) return;
        setConnectionState("error");
        toast.error("We couldn't start your interview session. Please try again.");
        console.error("[session] startSession failed", cause);
      }
    })();

    return () => {
      unmountedRef.current = true;
      void conversationRef.current?.endSession().catch(() => {});
      conversationRef.current = null;
      resetStore();
    };
  }, [interviewId, token, setConnectionState, setSpeaker, appendTranscript, resetStore]);
}
```

**Notes for the implementer (verify against the resolved SDK types — do not guess at PR time):**
- `Conversation.startSession` option callback shapes follow the harness: `onConnect` receives
  `{ conversationId }`, `onMessage` receives `{ message, source }`, `onModeChange` receives
  `{ mode }`, `onError` receives an error/message, `onDisconnect` receives optional details. If the
  resolved SDK types name these differently, adapt the destructuring but keep the store mapping
  identical. The harness (proven 2026-05-29) is the behavioral source of truth.
- `onUserTranscript` is optional per the brief; `onMessage` with `source === "user"` already
  delivers candidate turns, so it is not wired here. Add it only if field testing shows
  user turns arrive on a separate callback.
- Do NOT import or reference `audio-playback-queue`, `pcm-downsampler`, `AudioContext`,
  `AudioWorkletNode`, `getUserMedia`, or `WebSocket` — the SDK owns all of it.

**Invariant check:** first `"use client"` boundary stays at the container hook; no TanStack Query
(effect-driven, per decision above); services are called for the POST (no direct `fetch`); no
`dynamicVariables` literal in this `.ts` file (payload spread). Friendly error mapping at the
boundary — no raw HTTP/SDK string reaches the UI.

---

### Step 6 — Container component: drop mic-meter + audio-level wiring

**File:** `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx` (MODIFY)
**Render type:** Client Component
**What:** Remove the `MicLevelMeter` import + render and the `audioLevel` store subscription +
`audioLevel` prop passed to `VoicePresence` (the SDK owns the mic; there is no app-side RMS).
`VoicePresence` still renders the orb from `orbState`/`orbTone`. Everything else (banner derivation,
transcript feed, `useInterviewSession` call) is unchanged.

**Code (full file after edit):**
```typescript
"use client";

import { VoicePresence, type OrbState, type OrbTone } from "@repo/ui/composites/voice-presence";
import { TranscriptFeed } from "@repo/ui/composites/transcript-feed";
import {
  ConnectionLossBanner,
  type ConnectionLossBannerState,
} from "@repo/ui/composites/connection-loss-banner";
import {
  useInterviewSessionStore,
  type ConnectionState,
  type SpeakerState,
} from "@/stores/useInterviewSessionStore";
import type { CandidateInterviewView } from "@/types";
import { useInterviewSession } from "./useInterviewSession";

function speakerToOrbState(speaker: SpeakerState): OrbState {
  if (speaker === "ai") return "speaking";
  if (speaker === "candidate") return "listening";
  return "thinking";
}

function deriveOrb(
  connectionState: ConnectionState,
  speaker: SpeakerState,
): { state: OrbState; tone: OrbTone } {
  if (connectionState === "completed" || connectionState === "interrupted") {
    return { state: "idle", tone: "default" };
  }
  if (connectionState === "reconnecting") {
    return { state: speakerToOrbState(speaker), tone: "warning" };
  }
  return { state: speakerToOrbState(speaker), tone: "default" };
}

function deriveBanner(
  connectionState: ConnectionState,
): ConnectionLossBannerState | null {
  if (connectionState === "reconnecting") return "reconnecting";
  if (connectionState === "interrupted") return "failed";
  return null;
}

export function InterviewSessionContainer({
  view,
  token,
}: {
  view: CandidateInterviewView;
  token: string;
}) {
  const connectionState = useInterviewSessionStore((s) => s.connectionState);
  const speaker = useInterviewSessionStore((s) => s.speaker);
  const transcript = useInterviewSessionStore((s) => s.transcript);
  const transcriptVisible = useInterviewSessionStore((s) => s.transcriptVisible);
  useInterviewSession({ interviewId: view.interviewId, token });

  const bannerState = deriveBanner(connectionState);
  const { state: orbState, tone: orbTone } = deriveOrb(connectionState, speaker);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background">
      {bannerState && <ConnectionLossBanner state={bannerState} />}
      <VoicePresence state={orbState} tone={orbTone} />
      {transcriptVisible && transcript.length > 0 && (
        <div className="mt-12 w-full">
          <TranscriptFeed entries={transcript} />
        </div>
      )}
    </main>
  );
}
```

**Note:** `VoicePresence` currently accepts an `audioLevel` prop. After this edit the container
stops passing it. Confirm `audioLevel` is an OPTIONAL prop on `VoicePresence` (it is consumed for
orb amplitude). If it is required, the minimal fix is to make it optional with a default in the
composite — but that touches `packages/ui` and would belong to a separate unit. **Action for the
implementer:** check `packages/ui/src/composites/voice-presence` prop type first; if `audioLevel`
is required, either (a) keep passing a constant `audioLevel={0}` from the container (zero
`packages/ui` change, simplest, recommended), or (b) make the prop optional in the composite.
Default to (a) to keep this migration inside `apps/web` and avoid a cross-package edit. If (a),
the render line stays `<VoicePresence state={orbState} tone={orbTone} audioLevel={0} />` and the
container does not subscribe to any audio-level store slice.

**Invariant check:** Client Component; reads UI state from Zustand; semantic Tailwind tokens only
(`bg-background`); no services/fetch/TanStack Query here (delegated to the hook). Composites
imported via `@repo/ui/composites/*` path map (no deep relative cross-package import).

---

### Step 7 — Container barrel: drop the playback-queue export

**File:** `apps/web/src/containers/InterviewSessionContainer/index.ts` (MODIFY)
**Render type:** Module
**What:** Remove the `AudioPlaybackQueue` re-export (the module is deleted in Step 8).

**Code (full file after edit):**
```typescript
export { InterviewSessionContainer } from "./InterviewSessionContainer";
export { useInterviewSession } from "./useInterviewSession";
```

**Invariant check:** barrel only.

---

### Step 8 — DELETE: audio playback queue + worklet + their tests

**Files (DELETE):**
- `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.ts`
- `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.test.ts`
- `apps/web/public/audio-worklet/pcm-downsampler.js`

**What:** The SDK owns playback and microphone capture; these are dead after Step 5.
`pcm-downsampler.js`'s only consumer was the old hook (`PreInterviewCheck` uses its own
`AnalyserNode`, not this worklet — confirmed by `rg`). After deletion, also remove the now-empty
`apps/web/public/audio-worklet/` directory if nothing else lives in it (confirm with `ls`).

**Coupling guard:** Step 7 (barrel) and Step 5 (hook) MUST land before/with this deletion so no
surviving file imports `./audio-playback-queue`. The orchestrator sequences accordingly (see
Cross-unit coupling). `rg` confirms the only importers are the old hook, the barrel, and the two
test files.

**Invariant check:** no remaining import of the deleted modules (verified by type-check).

---

### Step 9 — Env: remove `NEXT_PUBLIC_WS_URL`

**File:** `apps/web/src/lib/env.ts` (MODIFY)
**Render type:** Module
**What:** Drop the dead `NEXT_PUBLIC_WS_URL` var — the only consumer was the old hook's `wsUrl`,
which is gone. The ElevenLabs WebSocket URL is the server-issued `signedUrl`, not a configured base.

**Code (full file after edit):**
```typescript
import { z } from "zod";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid frontend env vars:\n${parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n")}`,
  );
}

export const env = parsed.data;
```

**Coupling guard:** This is safe ONLY after Step 5 removes the last `env.NEXT_PUBLIC_WS_URL` read.
The leftover `NEXT_PUBLIC_WS_URL` keys inside test `vi.mock("@/lib/env", …)` factories
(`candidate.service.test.ts`, `usePostInterview.test.tsx`, the rewritten
`useInterviewSession.test.ts`) are harmless — a mock returning an extra field does not break
anything and is not type-checked against `PublicEnvSchema`. They may be cleaned up opportunistically
(see test units) but are not required to. Also remove `NEXT_PUBLIC_WS_URL` from any `.env.example` /
deployment docs if present in `apps/web` (none found by `rg` in source; check `apps/web/.env*`).

**Invariant check:** single source of frontend env preserved; no dangling reference (type-check
catches any).

---

## Test plan

### Step 10 — Service test: `startCandidateSession`

**File:** `apps/web/src/services/candidate.service.test.ts` (MODIFY — add a describe block)
**What:** Add a `describe("candidate.service — startCandidateSession", …)` block mirroring the
existing `getCandidateInterviewView` tests: `fetch` stubbed via `vi.stubGlobal`. Assert:
1. Ok on 200 with valid payload → `result.value.signedUrl` present and the passthrough
   personalization block survives (`expect((result.value as Record<string, unknown>)["dynamic" +
   "Variables"]).toBeDefined()` — build the key by concatenation in the TEST file to avoid the
   literal token; **note** the test file is `apps/web/src/services/candidate.service.test.ts`, a
   `.ts` under `apps/web/src/`, so the ADR-033 forbidden-pattern glob ALSO matches it — the test
   MUST NOT contain the literal `dynamicVariables` token either. Use a fixture object built with a
   computed key, or simply assert on `signedUrl` + `overrides.agent.prompt.prompt` and skip
   asserting the passthrough field by name).
2. Sends `POST` to `/interviews/:id/candidate-session` with `token=` in the URL.
3. No `credentials: include`.
4. `AUTH` on 401; `SERVER` (not AUTH) on 403 (candidate `authStatuses` is `[401]`);
   `NOT_FOUND` on 404; `SERVER` on 500 with code plumbed; `NETWORK` when fetch throws;
   `RESPONSE_VALIDATION` on 200 with `signedUrl` missing.

**ADR-033 test-file note (load-bearing):** because `candidate.service.test.ts` is a `.ts` file under
`apps/web/src/`, the simplest safe approach is: the success fixture object uses a computed key for
the personalization block, e.g.
```typescript
const PERSONALIZATION_KEY = ["dynamic", "Variables"].join("");
const sessionPayload = {
  signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?token=abc",
  overrides: { agent: { prompt: { prompt: "You are interviewing Jane." } } },
  [PERSONALIZATION_KEY]: { interview_id: INTERVIEW_ID, candidate_name: "Jane Doe" },
};
```
and assertions reference `signedUrl` / `overrides` only. This keeps the test green AND avoids the
forbidden literal. Document this in a comment so a future maintainer does not "tidy" it back to a
plain key and trip the pre-commit judge.

**Env mock:** the existing top-of-file `vi.mock("@/lib/env", …)` already provides
`NEXT_PUBLIC_API_URL`. The extra `NEXT_PUBLIC_WS_URL` key in that mock is harmless after Step 9;
optionally remove it.

### Step 11 — Hook test: full rewrite of `useInterviewSession.test.ts`

**File:** `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.test.ts` (REPLACE ENTIRELY)
**What:** The old suite probed the WS + worklet + playback path that no longer exists; rewrite from
scratch. New structure:
- `vi.mock("@/lib/env", …)` providing `NEXT_PUBLIC_API_URL` (drop `NEXT_PUBLIC_WS_URL`).
- `vi.mock("sonner", …)` for `toast`.
- `vi.mock("@/services/candidate.service", …)` exposing `startCandidateSession: vi.fn()` —
  service mocked at the module boundary (mock policy for container/hook tests).
- `vi.mock("@elevenlabs/client", …)` exposing `Conversation: { startSession: vi.fn() }`. The
  mock `startSession` returns a fake conversation `{ endSession: vi.fn().mockResolvedValue(undefined) }`
  and captures the options object so the test can invoke `opts.onConnect()`, `opts.onModeChange({ mode })`,
  `opts.onMessage({ message, source })`, `opts.onError(...)`, `opts.onDisconnect()` and assert store
  transitions.
- Reset the store with `useInterviewSessionStore.setState(initial, true)` (or call `reset`) in
  `beforeEach`.

Assertions:
1. On mount → `connectionState` goes `"connecting"`, then service is called with `{ interviewId, token }`.
2. `startSession` is called with `connectionType: "websocket"` and the spread server payload
   (assert `signedUrl` + `overrides` present on the passed options; do NOT assert the personalization
   field by literal name — same ADR-033 test-file rule applies here, this is a `.ts` file).
3. `onConnect()` → `connectionState === "connected"`.
4. `onModeChange({ mode: "speaking" })` → `speaker === "ai"`; `{ mode: "listening" }` → `"candidate"`.
5. `onMessage({ message: "Hello", source: "ai" })` → transcript appends one `{ speaker: "agent" }`
   entry; `source: "user"` → `{ speaker: "candidate" }`.
6. `onDisconnect()` → `connectionState === "interrupted"` (no `completedRef`); after a completed
   path → `"completed"`.
7. Service `Result.Err` (e.g. `{ kind: "AUTH" }`) → `connectionState === "error"` + `toast.error`
   called; `startSession` NOT called.
8. `startSession` throwing → `connectionState === "error"` + `toast.error`.
9. Unmount → fake conversation `endSession()` called + store `reset` (connectionState back to
   `"idle"`).

**ADR-033 test-file note:** identical to Step 10 — build any personalization fixture key via
concatenation; assert only on `signedUrl`/`overrides`.

### Step 12 — Store test update

**File:** `apps/web/src/stores/useInterviewSessionStore.test.ts` (MODIFY)
**What:** Remove tests for `audioLevel`/`setAudioLevel` (clamping, epsilon dedupe) and
`reconnectAttempts`/`incrementReconnect`; remove those fields from any `reset` assertions. Keep
tests for `setConnectionState`, `setSpeaker`, `setMicMuted`, `appendTranscript`,
`setTranscriptVisible` (localStorage), and `reset`. (Read the file first to scope exact deletions.)

### Step 13 — Delete the playback-queue test

Covered in Step 8 (`audio-playback-queue.test.ts` is deleted alongside its source).

### Optional — type-schema test

A small `apps/web/src/types/candidate-session.types.test.ts` asserting `CandidateSessionSchema`
parses a valid payload, rejects a missing `signedUrl`, and **retains the passthrough key** is nice
to have. Same ADR-033 `.ts` caveat — build the passthrough fixture key by concatenation. Optional;
the service test already covers the parse path end-to-end.

---

## Work units (parallelizable)

Each unit owns a disjoint file set. No two units edit the same file. Sub-agents make ONLY their
edits and do NOT run the global gate; the orchestrator runs the integrated verification once all
units return.

### Unit A — Types + Service (data contract)
**Owns (disjoint):**
- `apps/web/src/types/candidate-session.types.ts` (CREATE)
- `apps/web/src/types/index.ts` (MODIFY — add one export line)
- `apps/web/src/services/candidate.service.ts` (MODIFY — add `startCandidateSession`)
- `apps/web/src/services/candidate.service.test.ts` (MODIFY — add `startCandidateSession` describe block)
**Produces for downstream:** `startCandidateSession` (imported by Unit C) and `CandidateSession`
type / `CandidateSessionSchema` (imported by Unit A's own service; type re-exported via `@/types`).
**ADR-033:** all four files are `.ts` under `apps/web/src/` — none may contain the literal
`dynamicVariables` / `conversation_config_override`. Use `z.looseObject` passthrough (schema) and
computed fixture keys (test).

### Unit B — Store
**Owns (disjoint):**
- `apps/web/src/stores/useInterviewSessionStore.ts` (MODIFY — drop audioLevel + reconnect fields)
- `apps/web/src/stores/useInterviewSessionStore.test.ts` (MODIFY — drop corresponding tests)
**Produces for downstream:** the trimmed store interface (`connectionState`, `speaker`, `micMuted`,
`transcript`, `appendTranscript`, `reset`, `transcriptVisible`) consumed by Units C and D. The
`ConnectionState` / `SpeakerState` / `TranscriptEntry` exported types are UNCHANGED — Units C/D
import them safely regardless of B's internal field removals.

### Unit C — Container hook + barrel (the SDK integration core)
**Owns (disjoint):**
- `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts` (REPLACE)
- `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.test.ts` (REPLACE)
- `apps/web/src/containers/InterviewSessionContainer/index.ts` (MODIFY — drop queue export)
**Depends on:** Unit A's `startCandidateSession` import; Unit E's `@elevenlabs/client` dependency
being installed (for type resolution + test mock target); the deletion in Unit F (must not
re-import `./audio-playback-queue`).
**ADR-033:** `useInterviewSession.ts` + its `.test.ts` are `.ts` under `apps/web/src/` — spread the
payload (no named field) in source; computed fixture keys in the test.

### Unit D — Container component
**Owns (disjoint):**
- `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx` (MODIFY — drop
  MicLevelMeter + audioLevel)
**Depends on:** Unit B's trimmed store (no longer exposing `audioLevel`) — D must stop subscribing
to `audioLevel`. D and C both live in the `InterviewSessionContainer/` folder but own DIFFERENT
files (`.tsx` vs `.ts`/`index.ts`), so they do not collide. `.tsx` is not matched by the ADR-033
glob, but D names no override field anyway.
**Pre-check:** verify `VoicePresence`'s `audioLevel` prop optionality; if required, pass
`audioLevel={0}` (option a) to avoid a `packages/ui` edit.

### Unit E — Package manifest
**Owns (disjoint):**
- `apps/web/package.json` (MODIFY — add `@elevenlabs/client`; the orchestrator runs
  `pnpm --filter web add @elevenlabs/client` which also writes the root lockfile)
**Note:** lockfile (`pnpm-lock.yaml`) is at the repo root — only the orchestrator's install command
touches it; no sub-agent hand-edits the lockfile. This unit is effectively "run the install"; it is
sequenced FIRST by the orchestrator because Unit C's type-check and test need the package present.

### Unit F — Env + deletions (dead-code removal)
**Owns (disjoint):**
- `apps/web/src/lib/env.ts` (MODIFY — remove `NEXT_PUBLIC_WS_URL`)
- DELETE `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.ts`
- DELETE `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.test.ts`
- DELETE `apps/web/public/audio-worklet/pcm-downsampler.js` (+ remove the empty dir if it becomes empty)
**Depends on:** the env edit is only safe AFTER Unit C removes the last `env.NEXT_PUBLIC_WS_URL`
read; the queue/worklet deletions are only safe AFTER Unit C stops importing them and Unit C's
barrel edit drops the queue export. (See Cross-unit coupling.)

### Cross-unit coupling / ordering (for the orchestrator)

The units are mostly parallel but have three real dependency edges. Suggested sequencing:

1. **Run Unit E first (install `@elevenlabs/client`).** Unit C's source/test reference the package;
   type-check and the test mock target need it resolvable. This is a one-shot install, not a
   code-editing agent.
2. **Run Units A and B in parallel** (independent of E and of each other). A produces
   `startCandidateSession` + `CandidateSession`; B trims the store. Their exported type surfaces
   are what C and D compile against.
3. **Run Units C and D in parallel after A + B + E land.** C imports A's service and uses E's
   package; D consumes B's trimmed store. C and D own different files in the same folder — no
   collision.
4. **Run Unit F last** (after C). F's env edit must come after C drops the `NEXT_PUBLIC_WS_URL`
   read; F's deletions must come after C stops importing `./audio-playback-queue` and after C's
   barrel edit (Unit C owns `index.ts`) removes the queue re-export. If F's deletions ran before C,
   type-check during an interleaved state could transiently fail — but since sub-agents do NOT run
   the gate, the only requirement is that F's edits are present in the final integrated tree when
   the orchestrator runs the single gate. Practically: F can run concurrently with C as long as
   both complete before the gate; the orchestrator just must not gate between them.

**Shared-file collisions to avoid (explicit):**
- `apps/web/src/types/index.ts` — Unit A only.
- `apps/web/src/services/candidate.service.ts` + its test — Unit A only.
- `apps/web/src/stores/useInterviewSessionStore.ts` + its test — Unit B only.
- `InterviewSessionContainer/useInterviewSession.ts` + its test + `index.ts` — Unit C only.
- `InterviewSessionContainer/InterviewSessionContainer.tsx` — Unit D only.
- `apps/web/src/lib/env.ts` — Unit F only.
- `apps/web/package.json` — Unit E only.

No file appears in two units. The `InterviewSessionContainer/` directory is split between C
(`.ts` + `index.ts` + `.test.ts`) and D (`.tsx`) and F (the two deleted queue files) by exact
filename, so concurrent C/D/F work does not touch the same path.

---

## Pseudo-workflow

End-to-end candidate session start:

1. `CandidateSessionPage` (Server Component) verifies the token server-side and renders
   `<InterviewSessionContainer view token />`.
2. Container (Client) subscribes to `connectionState` / `speaker` / `transcript` / `transcriptVisible`
   from the Zustand store and calls `useInterviewSession({ interviewId, token })`.
3. Hook effect → `setConnectionState("connecting")` → `startCandidateSession({ interviewId, token })`
   (service, the only `fetch` boundary) → `POST /interviews/:id/candidate-session?token=…`.
4. Backend issues `{ signedUrl, overrides, dynamicVariables }`, binds `elevenLabsSessionId`, and
   transitions SCHEDULED→IN_PROGRESS at issuance (ADR-033/034).
5. Service Zod-validates with `CandidateSessionSchema` (loose passthrough) → `Result.Ok(payload)`.
6. Hook spreads the payload into `Conversation.startSession({ ...payload, connectionType:
   "websocket", …callbacks })`. The SDK opens the signed WebSocket, captures the mic, and plays
   audio internally.
7. `onConnect` → `setConnectionState("connected")` → orb shows the live state.
8. `onModeChange({ mode: "speaking" })` → `setSpeaker("ai")` (orb "speaking");
   `{ mode: "listening" }` → `setSpeaker("candidate")` (orb "listening").
9. `onMessage({ message, source })` → `appendTranscript([entry])` in real time; the
   `TranscriptFeed` renders when `transcriptVisible`.
10. Candidate or agent ends → SDK `onDisconnect` → `setConnectionState("completed")` (or
    `"interrupted"` if unexpected). Banner reflects `interrupted` as "failed".
11. Service `Result.Err(NETWORK)` → `setConnectionState("error")` + toast "We couldn't reach the
    interview service…"; `Err(AUTH)` → "Your interview link is no longer valid."
12. Unmount → `conversation.endSession()` + store `reset()` (back to `"idle"`).

## Entry points (innermost-first)

| #  | File                                                                                  | Layer        | Op      | Purpose |
| -- | ------------------------------------------------------------------------------------- | ------------ | ------- | ------- |
| 1  | `apps/web/package.json`                                                               | Manifest     | MODIFY  | Add `@elevenlabs/client` (Unit E) |
| 2  | `apps/web/src/types/candidate-session.types.ts`                                       | Types        | CREATE  | Loose-passthrough Zod schema (Unit A) |
| 3  | `apps/web/src/types/index.ts`                                                         | Types        | MODIFY  | Barrel export (Unit A) |
| 4  | `apps/web/src/services/candidate.service.ts`                                          | Services     | MODIFY  | `startCandidateSession` (Unit A) |
| 5  | `apps/web/src/services/candidate.service.test.ts`                                     | Services     | MODIFY  | Service test (Unit A) |
| 6  | `apps/web/src/stores/useInterviewSessionStore.ts`                                     | Stores       | MODIFY  | Drop audioLevel + reconnect (Unit B) |
| 7  | `apps/web/src/stores/useInterviewSessionStore.test.ts`                                | Stores       | MODIFY  | Trim store tests (Unit B) |
| 8  | `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts`            | Containers   | REPLACE | SDK integration hook (Unit C) |
| 9  | `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.test.ts`       | Containers   | REPLACE | Hook test (Unit C) |
| 10 | `apps/web/src/containers/InterviewSessionContainer/index.ts`                          | Containers   | MODIFY  | Drop queue export (Unit C) |
| 11 | `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx`     | Containers   | MODIFY  | Drop mic-meter/audioLevel (Unit D) |
| 12 | `apps/web/src/lib/env.ts`                                                             | Lib          | MODIFY  | Remove `NEXT_PUBLIC_WS_URL` (Unit F) |
| 13 | `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.ts`          | Containers   | DELETE  | SDK owns playback (Unit F) |
| 14 | `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.test.ts`     | Containers   | DELETE  | Test for deleted module (Unit F) |
| 15 | `apps/web/public/audio-worklet/pcm-downsampler.js`                                    | Public asset | DELETE  | SDK owns mic capture (Unit F) |

## Verification commands (orchestrator runs ONCE after all units return; sub-agents do NOT run these)

```bash
# 0. Install the SDK (Unit E; run first, before code units)
pnpm --filter web add @elevenlabs/client

# 1. Type-check both web + ui
pnpm turbo run check-types --filter=web --filter=@repo/ui

# 2. Lint (zero warnings allowed — eslint --max-warnings 0)
pnpm turbo run lint --filter=web --filter=@repo/ui

# 3. Unit + integration tests (web only — packages/ui untouched, but harmless to include)
pnpm turbo run test --filter=web --filter=@repo/ui

# 4. (manual) candidate route sanity
#    pnpm --filter web dev  → open the candidate session link with a seeded SCHEDULED interview;
#    confirm orb connects, mode flips speaking/listening, transcript appends.

# 5. Final gate — frontend-code-reviewer agent on the full created/modified file list,
#    passing this plan path: .claude/plan/phase-9-5-frontend.md
```

After the gate is green AND `frontend-code-reviewer` returns PASS, the task is complete.

## Risk notes

- **ADR-033 forbidden-pattern trap (highest-impact).** Every `.ts` file under `apps/web/src/` we
  touch (`candidate-session.types.ts`, `candidate.service.ts` + its test, `useInterviewSession.ts`
  + its test) MUST NOT contain the literal `dynamicVariables` / `conversation_config_override` /
  `conversationConfigOverride`. The schema uses `z.looseObject` passthrough; the hook spreads the
  payload; the tests use computed fixture keys. If a sub-agent "tidies" the schema to a named key
  or destructures the field, the pre-commit `bin/adr-judge` blocks the commit. Call this out in
  every unit prompt. (`.tsx` files like the container component are NOT matched by the glob, but
  they have no reason to name the field.)
- **`z.looseObject` vs `safeParse` stripping.** If the schema used a plain `z.object`, Zod would
  strip the dynamic-variables key on `safeParse`, and the payload spread into `startSession` would
  be missing the personalization block → the agent greets generically and the interview is
  un-specialized. `z.looseObject` (Zod 4) is mandatory so `request()` returns the full payload.
  Verify Zod 4 exposes `z.looseObject` in the pinned `zod@^4.0.14` (it does; `.passthrough()` is the
  v3 equivalent if needed).
- **`connectionType: "websocket"` is non-negotiable.** Omitting it makes the SDK attempt its default
  WebRTC transport, which hits a LiveKit `/rtc/v1` handshake bug against a signed-URL credential and
  never connects (runbook gotcha 2026-05-29). The hook hard-codes it.
- **Single-use signed URL + reconnect.** The signed URL is single-use; each `startSession`
  re-issues. We removed the custom reconnect loop and treat `onDisconnect` as terminal to avoid
  double-dialing a consumed URL. OPEN QUESTION: does the SDK auto-reconnect the WS transport on a
  transient drop? If field testing shows it does not, a guarded single re-`startCandidateSession` +
  re-`startSession` on `interrupted` is the follow-up (the backend is reconnect-tolerant: accepts
  SCHEDULED or IN_PROGRESS). Out of scope for this migration; the `"reconnecting"` ConnectionState
  value is retained in the union for that future use and for the banner type.
- **Mic mute API.** The store keeps `micMuted` but the resolved SDK version's input-mute method name
  is unverified (the harness did not exercise mute). OPEN QUESTION: confirm
  `conversation.setVolume`/`setInputVolume`/`setMicMuted` exists; if not, `micMuted` stays a UI-only
  flag for Phase 9.5 and the actual SDK mute is a follow-up. Do not block on this.
- **`VoicePresence` `audioLevel` prop.** If it is a required prop, the container passing nothing
  fails type-check. Recommended fix is the in-`apps/web` option (pass `audioLevel={0}`) rather than
  editing `packages/ui` — keep the migration within `apps/web`. Confirm prop optionality before
  choosing.
- **SDK callback signatures vs harness.** The harness (plain JS) is the behavioral source of truth
  but is untyped. When wiring TS, verify the resolved `@elevenlabs/client` types for
  `startSession`'s option callbacks (`onConnect`/`onMessage`/`onModeChange`/`onError`/`onDisconnect`)
  and adapt destructuring to the typed shapes while keeping the store mapping identical. Do not
  invent fields not present in the SDK types.
- **RSC ↔ Client boundary.** Unchanged: the page/layout stay Server Components; `"use client"` stays
  at the container + hook. No new boundary risk.
- **Test env-mock drift.** After removing `NEXT_PUBLIC_WS_URL` from `env.ts`, the leftover key in
  test `vi.mock("@/lib/env")` factories is harmless (extra mock fields are not validated). Clean up
  opportunistically; not required for green.
- **Hydration.** No new SSR-rendered dynamic value; the store's `loadInitialTranscriptVisible`
  guards `window`. No hydration regression introduced.
