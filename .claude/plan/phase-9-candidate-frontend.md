# Phase 9 — Candidate Frontend Plan

> Generated: 2026-05-17
> Slug: `phase-9-candidate-frontend`
> Route group: `(candidate)` (new) — URL namespace `/c/[id]/…`

---

## 1. Phase summary

Phase 9 ships the candidate-side frontend for Sift: five new routes under `/c/[id]` (landing, pre-interview check, live interview session, post-interview thank-you, and error fallbacks), the orb-driven `VoicePresence` composite, a candidate-bound HTTP service that consumes the just-shipped `GET /interviews/:id/candidate-view?token=…` endpoint, two new Zustand stores for interview-session and mic-check UI state, and the full WebSocket voice pipeline (AudioWorklet-driven linear16 uplink, MP3 downlink, DESIGN.md §7 reconnect choreography). The candidate flow is desktop-only via the existing `SoftBlockScreen`, gated server-side by HMAC token verification in `(candidate)/layout.tsx`, and runs zero recruiter chrome.

---

## 2. Read-list (implementer reads these before starting)

Required, in this order:

1. `docs/ARCHITECTURE.md` — Phase 9 scope.
2. `docs/DESIGN.md` — §2 palette tokens, §5 candidate soft-block, §6 motion, §7 voice UI choreography.
3. `docs/progress/phase-9-backend-prep.md` — exact endpoint shape + `/c/<id>` URL rewrite.
4. `docs/design-refs/pre-interview-check.html` and `docs/design-refs/candidate-interview.html` — visual reference only.
5. `CLAUDE.md` — workflow rules.
6. `apps/web/src/lib/auth.ts:18-25` — the documented "fetch carve-out" pattern this plan reuses.
7. `apps/web/src/services/interview.service.ts` and `apps/web/src/services/errors.ts` — `request<T>()` helper to copy.
8. `apps/web/src/types/{interview-status.types,interview.types}.ts` — existing Zod patterns to mirror.
9. `apps/web/app/(recruiter)/layout.tsx` — server-side auth-gating pattern (this plan mirrors it for token gating).
10. `apps/backend/src/presentation/controllers/candidate-interview.controller.ts` — exact wire response shape.
11. `apps/backend/src/presentation/controllers/interview-session.controller.ts` — WS frame contract (binary in/out + final `session.completed` text frame).
12. `apps/backend/src/presentation/websocket/voice-websocket.ts` — confirms `isBinary` discriminator.
13. `apps/backend/src/presentation/routes/interview-session.ws.ts` — confirms WS path `/interviews/:id/session?token=…` and close codes (`POLICY_VIOLATION 1008`, `INTERNAL_ERROR 1011`, `SERVICE_RESTART 1012`, `NORMAL 1000`).
14. `apps/backend/src/infrastructure/services/deepgram/provider.ts` — confirms candidate audio uplink format: `linear16`, 16 kHz.
15. `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` — confirms agent audio downlink format: `mp3_44100_128` (44.1 kHz, 128 kbps MP3).
16. `packages/application/src/dtos/conduct-interview.dto.ts` — `ConductInterviewOutput.transcript[]` shape returned in the final `session.completed` payload.
17. `packages/ui/src/composites/{soft-block-screen,stepper-header}/*` — existing composites to reuse.
18. `packages/ui/src/primitives/card/card.tsx` — confirms `CardTitle` is polymorphic (the `as?: CardTitleTag` prop).
19. `apps/web/playwright.config.ts` — E2E project conventions.

---

## 3. Architecture diagram

```
                       ┌─────────────────────────────────────────────────────┐
                       │ Recruiter shares link → email lands at user inbox   │
                       │   url:  https://app/c/<id>?token=<base64url>        │
                       └─────────────────────────────────────────────────────┘
                                                │
                                                ▼
        ┌─────────────────────────────────────────────────────────────────────────────┐
        │ apps/web/app/(candidate)/layout.tsx   (Server Component)                    │
        │  - Reads `token` from `searchParams` prop (Next 16; see §8 fallback).       │
        │  - Documented fetch carve-out (mirrors lib/auth.ts:18-25):                  │
        │      fetch(`${API_URL}/interviews/${id}/candidate-view?token=${tok}`)       │
        │  - 200 → render <SoftBlockScreen audience="candidate" /> + children          │
        │  - 401/404/network → render <CandidateErrorScreen kind="invalid|expired|…"/>│
        └─────────────────────────────────────────────────────────────────────────────┘
                                                │  children
                                                ▼
   ┌─────────────────┬───────────────────┬─────────────────┬────────────────────┐
   │ /c/[id]         │ /c/[id]/check     │ /c/[id]/session │ /c/[id]/done       │
   │ page.tsx        │ page.tsx          │ page.tsx        │ page.tsx           │
   │ (Server Comp)   │ (Server Comp)     │ (Server Comp)   │ (Server Comp)      │
   │                 │                   │                 │                    │
   │  Re-fetches the candidate view (option b — see §8) and passes `view` to:   │
   │                                                                            │
   │ <CandidateLanding   <PreInterviewCheck <InterviewSession <PostInterview    │
   │   Container          Container          Container         Container        │
   │   view={view}/>      view={view}        view={view}       view={view}      │
   │                      token={token}/>    token={token}/>   token={token}/>  │
   └─────────────────┴───────────────────┴─────────────────┴────────────────────┘
            │                  │                    │                   │
            ▼                  ▼                    ▼                   ▼
   "use client" entry      "use client"        "use client"        "use client"
   ────────────────────────────────────────────────────────────────────────────
   useCandidateLanding   usePreInterviewCheck   useInterviewSession  usePostInterview
       │                       │                       │                   │
       │                       │                       │                   │
       │                  useMicCheckStore         useInterview         TanStack Query
       │                  (Zustand)                SessionStore          poll every 30s
       │                       │                  (Zustand)              max 5 polls
       │                       │                       │                       │
       ▼                       ▼                       ▼                       ▼
   Read-only view          getUserMedia + WS  ws://API/interviews/:id/session?token  candidate.service
   no service call         AudioContext       │  ▲                                 │
                            <audio>           │  │   binary: linear16 16kHz frames  │
                            (sift-sample.mp3) │  │   text  : session.completed JSON │
                                              │  │                                 │
                                              ▼  │                                 ▼
                                  AudioWorkletNode             apps/web/src/services/
                                    (PCM down-sample            candidate.service.ts
                                    + post Uint8Array)          getCandidateInterviewView
                                                                (Zod-validated, Result<T,SE>)
```

`fetch()` lives in exactly two places per the existing carve-out pattern: (a) `apps/web/src/services/candidate.service.ts` (client-callable, used by `PostInterviewContainer`), and (b) inside Server Components for token gating + page-level pre-fetch (`(candidate)/layout.tsx` + each `(candidate)/c/[id]/.../page.tsx`). The WS is the only other network egress and lives inside `InterviewSessionContainer/useInterviewSession.ts` per the voice-pipeline skill — not a service.

---

## 4. Files to create / modify

| Path | Purpose | Layer skill |
|---|---|---|
| `apps/web/src/types/candidate-interview-view.types.ts` (CREATE) | `CandidateInterviewViewSchema` + inferred type mirroring backend wire shape | service |
| `apps/web/src/types/index.ts` (MODIFY) | Re-export new type module | service |
| `apps/web/src/services/candidate.service.ts` (CREATE) | `getCandidateInterviewView({ interviewId, token })` returning `Result<CandidateInterviewView, ServiceError>` | service |
| `apps/web/src/lib/env.ts` (MODIFY) | Add `NEXT_PUBLIC_WS_URL` to the Zod schema | infra |
| `apps/web/src/lib/candidate-fetch.ts` (CREATE) | Server-only helper for layout + pages — wraps the carve-out `fetch` and returns a tagged union the layout/page can render off | infra |
| `apps/web/src/stores/useInterviewSessionStore.ts` (CREATE) | Zustand: connection state, current speaker, mic muted, transcript visible (init from localStorage), transcript buffer, reconnect-attempt count | container |
| `apps/web/src/stores/useMicCheckStore.ts` (CREATE) | Zustand: permission state, audio level (0–1), test outcome | container |
| `apps/web/src/stores/useInterviewSessionStore.test.ts` (CREATE) | Unit tests for state machine transitions | test |
| `apps/web/src/stores/useMicCheckStore.test.ts` (CREATE) | Unit tests | test |
| `packages/ui/src/composites/voice-presence/index.tsx` (CREATE) | Barrel re-export | composite |
| `packages/ui/src/composites/voice-presence/voice-presence.tsx` (CREATE) | The orb; states `idle / listening / thinking / speaking`; `audioLevel?` 0–1; respects `prefers-reduced-motion` | composite |
| `packages/ui/src/composites/voice-presence/voice-presence.test.tsx` (CREATE) | RTL render-state matrix | test |
| `packages/ui/src/composites/transcript-feed/index.tsx` (CREATE) | Barrel | composite |
| `packages/ui/src/composites/transcript-feed/transcript-feed.tsx` (CREATE) | Stacked transcript lines, two-tone (cool candidate / warm AI), `caption` speaker labels, hover-revealed timecodes | composite |
| `packages/ui/src/composites/transcript-feed/transcript-feed.test.tsx` (CREATE) | RTL — entries render, speaker labels rendered, default empty state | test |
| `packages/ui/src/composites/mic-level-meter/index.tsx` (CREATE) | Barrel | composite |
| `packages/ui/src/composites/mic-level-meter/mic-level-meter.tsx` (CREATE) | 3 px high bar, max-width 360 px, `--voice-active` 0.7 opacity, fills L→R per `level` (0–1) | composite |
| `packages/ui/src/composites/mic-level-meter/mic-level-meter.test.tsx` (CREATE) | RTL — width interpolates with `level` prop; idle silence pulses | test |
| `packages/ui/src/composites/connection-loss-banner/index.tsx` (CREATE) | Barrel | composite |
| `packages/ui/src/composites/connection-loss-banner/connection-loss-banner.tsx` (CREATE) | Slide-down banner per DESIGN.md §7; `--attention-warning`; states `reconnecting | reconnected-resuming | failed` | composite |
| `packages/ui/src/composites/connection-loss-banner/connection-loss-banner.test.tsx` (CREATE) | RTL — state copy + token classes | test |
| `packages/ui/src/index.ts` (MODIFY) | Add `export *` for the four new composites' barrels | composite |
| `packages/ui/package.json` (MODIFY) | Add `./composites/voice-presence`, `./composites/transcript-feed`, `./composites/mic-level-meter`, `./composites/connection-loss-banner` exports; **remove the stale `./composites/toaster` entry** (verified: directory does not exist) | composite |
| `apps/web/src/components/CandidatePageShell.tsx` (CREATE) | Full-screen centred minimal frame; no recruiter chrome | composite (app) |
| `apps/web/src/components/CandidateErrorScreen.tsx` (CREATE) | Server-renderable error display; `kind: "invalid-link" | "expired-link" | "interview-not-ready" | "mic-denied" | "session-interrupted"` | composite (app) |
| `apps/web/src/components/CandidateErrorScreen.test.tsx` (CREATE) | RTL — copy per kind | test |
| `apps/web/src/components/Toaster.tsx` (CREATE) | `"use client"` wrapper around `<Toaster />` from `sonner`; pinned to dark theme + semantic-token classes | composite (app) |
| `apps/web/app/layout.tsx` (MODIFY) | Mount the `Toaster` wrapper after `QueryProvider` | route |
| `apps/web/src/containers/CandidateLandingContainer/index.ts` (CREATE) | Barrel | container |
| `apps/web/src/containers/CandidateLandingContainer/CandidateLandingContainer.tsx` (CREATE) | Thin shell, accepts `view` prop, switches on hook view-model | container |
| `apps/web/src/containers/CandidateLandingContainer/useCandidateLanding.ts` (CREATE) | Status-gated CTA (`SCHEDULED` → enabled; else inert + copy); pure | container |
| `apps/web/src/containers/CandidateLandingContainer/useCandidateLanding.test.ts` (CREATE) | Unit | test |
| `apps/web/src/containers/PreInterviewCheckContainer/index.ts` (CREATE) | Barrel | container |
| `apps/web/src/containers/PreInterviewCheckContainer/PreInterviewCheckContainer.tsx` (CREATE) | Mounts `StepperHeader` + per-step view via hook | container |
| `apps/web/src/containers/PreInterviewCheckContainer/usePreInterviewCheck.ts` (CREATE) | 4-step state machine, `getUserMedia` + AudioContext analyser + RAF; MP3 playback for step 2; transcript-toggle localStorage write on step 4 | container |
| `apps/web/src/containers/PreInterviewCheckContainer/usePreInterviewCheck.test.ts` (CREATE) | Unit (`vi.spyOn(navigator.mediaDevices, ...)`) | test |
| `apps/web/src/containers/InterviewSessionContainer/index.ts` (CREATE) | Barrel | container/voice |
| `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx` (CREATE) | Thin shell; switches on `connectionState`; mounts orb + transcript + mic meter + loss banner | container/voice |
| `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts` (CREATE) | WS lifecycle, exponential reconnect (250 ms → 4 s cap, max ~10 attempts within 60 s), audio uplink via AudioWorklet, MP3 downlink playback queue (MediaSource), DESIGN.md §7 connection-loss choreography, terminal "interrupted" transition | container/voice |
| `apps/web/src/containers/InterviewSessionContainer/audio-worklet.processor.ts` (CREATE) | AudioWorkletProcessor module; downsamples to 16 kHz mono linear16 PCM, posts `ArrayBuffer` chunks back via `port.postMessage` | container/voice |
| `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.ts` (CREATE) | MediaSource-backed MP3 chunk queue → single `<audio>` element; resolves DESIGN.md §7 amplitude envelope via `<audio>.currentTime` callbacks; isolated module for unit testability | container/voice |
| `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.test.ts` (CREATE) | Unit — mock `WebSocket`, mock `getUserMedia`, assert state transitions per scenario | test |
| `apps/web/src/containers/InterviewSessionContainer/audio-playback-queue.test.ts` (CREATE) | Unit — buffering, end-of-stream | test |
| `apps/web/src/containers/PostInterviewContainer/index.ts` (CREATE) | Barrel | container |
| `apps/web/src/containers/PostInterviewContainer/PostInterviewContainer.tsx` (CREATE) | Thin shell; "Thanks, you're done." copy when status terminal | container |
| `apps/web/src/containers/PostInterviewContainer/usePostInterview.ts` (CREATE) | TanStack Query polling `getCandidateInterviewView` every 30 s, max 5 polls, stops on `COMPLETED|EVALUATED` | container |
| `apps/web/src/containers/PostInterviewContainer/usePostInterview.test.ts` (CREATE) | Unit | test |
| `apps/web/app/(candidate)/layout.tsx` (CREATE) | Server Component; token verification carve-out; renders `SoftBlockScreen` + children OR `CandidateErrorScreen` | route |
| `apps/web/app/(candidate)/c/[id]/page.tsx` (CREATE) | Server Component; re-fetch view; mount `CandidateLandingContainer` | route |
| `apps/web/app/(candidate)/c/[id]/check/page.tsx` (CREATE) | Server Component; re-fetch view; mount `PreInterviewCheckContainer` | route |
| `apps/web/app/(candidate)/c/[id]/session/page.tsx` (CREATE) | Server Component; re-fetch view; mount `InterviewSessionContainer` | route |
| `apps/web/app/(candidate)/c/[id]/done/page.tsx` (CREATE) | Server Component; re-fetch view; mount `PostInterviewContainer` | route |
| `apps/web/public/sift-sample.mp3` (CREATE — placeholder OK with TODO) | Pre-baked Sift voice sample for the audio-test step | infra |
| `apps/web/e2e/candidate-error.spec.ts` (CREATE) | E2E — `webServer.env` overrides `NEXT_PUBLIC_API_URL` to a dead port; asserts all error-screen kinds render correctly. No mock backend needed | test |

Total: **42 new files, 4 modified files**.

**Note on E2E scope (resolved decision, was risk #4):** Phase 9 ships **one** new Playwright spec — the error-state spec above. Happy-path candidate flow E2Es (`candidate-landing`, `candidate-pre-check`, `candidate-session`) are deferred to the tier-2 carried-forward Phase 8 follow-up that brings up the real backend with seeded fixtures. Rationale: the candidate flow's deep behaviour (state machines, error mapping, mic-check, post-interview polling, transcript toggle persistence) is comprehensively covered by Vitest + RTL container/hook tests at the right unit; manufactured E2E stubbing infrastructure (MSW-Node, mock-backend in `webServer`) introduces ongoing maintenance cost out of proportion to the marginal coverage gain. When tier-2 real-backend infra lands, the three deferred happy-path specs are written against it — they catch the same regression class that fixes #4/#5/#7 in Phase 8 already established.

---

## 5. Per-layer detailed sub-plans

### 5.1 Types

**`apps/web/src/types/candidate-interview-view.types.ts`** (CREATE)

```ts
import { z } from "zod";
import { InterviewStatusSchema } from "./interview-status.types";

export const CandidateInterviewViewSchema = z.object({
  interviewId: z.string().uuid(),
  candidateName: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  scheduledAt: z.coerce.date(),
  targetDurationMinutes: z.number().int().positive().nullable(),
  status: InterviewStatusSchema,
});
export type CandidateInterviewView = z.infer<typeof CandidateInterviewViewSchema>;
```

**`apps/web/src/types/index.ts`** (MODIFY) — append:

```ts
export * from "./candidate-interview-view.types";
```

### 5.2 Services

**`apps/web/src/services/candidate.service.ts`** (CREATE) — reuses the existing `request<T>` semantics but defined inline because `request` is a module-private helper in `interview.service.ts`. To avoid duplication we keep the function shape identical; the helper can be lifted into a shared `services/_request.ts` in a follow-up. For now, copy minimally:

```ts
import { Ok, Err, type Result } from "@/lib/result";
import { env } from "@/lib/env";
import type { ServiceError } from "./errors";
import {
  CandidateInterviewViewSchema,
  type CandidateInterviewView,
  HttpErrorBodySchema,
} from "@/types";

const BASE = env.NEXT_PUBLIC_API_URL;

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

export async function getCandidateInterviewView(input: {
  interviewId: string;
  token: string;
}): Promise<Result<CandidateInterviewView, ServiceError>> {
  const url = `${BASE}/interviews/${encodeURIComponent(input.interviewId)}/candidate-view?token=${encodeURIComponent(input.token)}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (cause) {
    return Err({ kind: "NETWORK", message: "Network request failed", cause });
  }
  if (res.status === 401) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "AUTH",
      status: 401,
      message: parsed.success ? parsed.data.error.message : "Invalid candidate token",
    });
  }
  if (res.status === 404) {
    return Err({ kind: "NOT_FOUND", message: "Interview not found" });
  }
  if (!res.ok) {
    const body = await safeJson(res);
    const parsed = HttpErrorBodySchema.safeParse(body);
    return Err({
      kind: "SERVER",
      status: res.status,
      code: parsed.success ? parsed.data.error.code : undefined,
      message: parsed.success ? parsed.data.error.message : "Server error",
    });
  }
  const body = await safeJson(res);
  const parsed = CandidateInterviewViewSchema.safeParse(body);
  if (!parsed.success) {
    return Err({
      kind: "RESPONSE_VALIDATION",
      message: "Response shape invalid",
      issues: parsed.error.issues,
    });
  }
  return Ok(parsed.data);
}
```

Note: no `credentials: "include"` — this endpoint is unauthenticated cookie-wise; the token in the URL is the only credential.

### 5.3 Server-only fetch helper

**`apps/web/src/lib/candidate-fetch.ts`** (CREATE) — used by layout + each candidate page. This is the **documented carve-out** location (NOT a service file). It is server-only (uses `next/headers` indirectly via being imported only from Server Components; no `"use client"`).

```ts
import { env } from "@/lib/env";
import {
  CandidateInterviewViewSchema,
  type CandidateInterviewView,
} from "@/types";

export type CandidateViewLoad =
  | { kind: "ok"; view: CandidateInterviewView }
  | { kind: "invalid-link" }            // 401, missing/bad token
  | { kind: "interview-not-found" }     // 404
  | { kind: "network"; message: string };

// Intentional carve-out from the "fetch only in services/" rule: this file is
// server-only (Server Components in (candidate)/* import it; never client code)
// and Server Components cannot import "use client" service files. The shape
// mirrors lib/auth.ts:18-25 exactly.
export async function loadCandidateView(
  interviewId: string,
  token: string | undefined,
): Promise<CandidateViewLoad> {
  if (!token) return { kind: "invalid-link" };
  let res: Response;
  try {
    res = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/interviews/${encodeURIComponent(interviewId)}/candidate-view?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
  } catch (e) {
    return { kind: "network", message: e instanceof Error ? e.message : "fetch failed" };
  }
  if (res.status === 401) return { kind: "invalid-link" };
  if (res.status === 404) return { kind: "interview-not-found" };
  if (!res.ok) return { kind: "network", message: `HTTP ${res.status}` };
  const body: unknown = await res.json().catch(() => null);
  const parsed = CandidateInterviewViewSchema.safeParse(body);
  if (!parsed.success) return { kind: "network", message: "invalid response shape" };
  return { kind: "ok", view: parsed.data };
}
```

### 5.4 Env

**`apps/web/src/lib/env.ts`** (MODIFY): add `NEXT_PUBLIC_WS_URL`.

```ts
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_WS_URL: z.string().regex(/^wss?:\/\//, "must start with ws:// or wss://"),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
});
// ...rest unchanged
```

### 5.5 Stores

**`apps/web/src/stores/useInterviewSessionStore.ts`** (CREATE)

```ts
import { create } from "zustand";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"   // 2–10s amber halo phase
  | "completed"
  | "interrupted"    // terminal — 60s without reconnect
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
  reconnectAttempts: number;
  setConnectionState: (s: ConnectionState) => void;
  setSpeaker: (s: SpeakerState) => void;
  setMicMuted: (b: boolean) => void;
  setTranscriptVisible: (b: boolean) => void;
  appendTranscript: (entries: ReadonlyArray<TranscriptEntry>) => void;
  incrementReconnect: () => void;
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
  reconnectAttempts: 0,
  setConnectionState: (connectionState) => set({ connectionState }),
  setSpeaker: (speaker) => set({ speaker }),
  setMicMuted: (micMuted) => set({ micMuted }),
  setTranscriptVisible: (transcriptVisible) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRANSCRIPT_LS_KEY, transcriptVisible ? "1" : "0");
    }
    set({ transcriptVisible });
  },
  appendTranscript: (entries) =>
    set((s) => ({ transcript: [...s.transcript, ...entries] })),
  incrementReconnect: () =>
    set((s) => ({ reconnectAttempts: s.reconnectAttempts + 1 })),
  reset: () =>
    set({
      connectionState: "idle",
      speaker: "silent",
      micMuted: false,
      transcript: [],
      reconnectAttempts: 0,
    }),
}));
```

Invariant: **only UI state**. No interview view data here — that's served by `loadCandidateView` (server) and TanStack Query (post-interview polling).

**`apps/web/src/stores/useMicCheckStore.ts`** (CREATE)

```ts
import { create } from "zustand";

export type PermissionState = "idle" | "requesting" | "granted" | "denied";
export type TestOutcome = "pending" | "passed";

interface MicCheckState {
  permission: PermissionState;
  level: number;          // 0..1, set from RAF by container
  outcome: TestOutcome;
  setPermission: (p: PermissionState) => void;
  setLevel: (n: number) => void;
  markPassed: () => void;
  reset: () => void;
}

export const useMicCheckStore = create<MicCheckState>((set) => ({
  permission: "idle",
  level: 0,
  outcome: "pending",
  setPermission: (permission) => set({ permission }),
  setLevel: (level) => set({ level: Math.max(0, Math.min(1, level)) }),
  markPassed: () => set({ outcome: "passed" }),
  reset: () => set({ permission: "idle", level: 0, outcome: "pending" }),
}));
```

### 5.6 Composites (`packages/ui/src/composites/`)

**`voice-presence/voice-presence.tsx`** (CREATE)

```tsx
"use client";
import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export interface VoicePresenceProps {
  state: OrbState;
  /** 0..1, used only when state === "speaking" to drive scale envelope. */
  audioLevel?: number;
  className?: string;
}

export const VoicePresence = React.forwardRef<HTMLDivElement, VoicePresenceProps>(
  ({ state, audioLevel = 0, className }, ref) => {
    // Map audioLevel (0..1) to a 0.96..1.06 scale; clamped.
    const scale =
      state === "speaking"
        ? 0.96 + Math.max(0, Math.min(1, audioLevel)) * 0.1
        : 1;

    const haloOpacity =
      state === "speaking"
        ? 0.35 + Math.max(0, Math.min(1, audioLevel)) * 0.3
        : state === "thinking"
          ? 0.5
          : 0.4;

    // Continuous breathing applies only when reduced-motion is off; CSS handles that.
    return (
      <div
        ref={ref}
        role="status"
        aria-label={
          state === "idle"
            ? "Sift is idle"
            : state === "listening"
              ? "Sift is listening"
              : state === "thinking"
                ? "Sift is thinking"
                : "Sift is speaking"
        }
        className={cn(
          "relative inline-flex items-center justify-center",
          className,
        )}
        style={{
          // motion lives in CSS keyframe orbHaloPulse + transform/transition.
          transform: `scale(${scale.toFixed(3)})`,
          transition: "transform 80ms cubic-bezier(0.22,0.61,0.36,1)",
          width: "clamp(140px, 16vw, 220px)",
          height: "clamp(140px, 16vw, 220px)",
        }}
        data-state={state}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-pill",
            "motion-safe:[animation:orbHaloPulse_3s_ease-in-out_infinite]",
            state === "thinking" &&
              "motion-safe:[animation-duration:1.2s]",
          )}
          style={{
            backgroundColor:
              state === "thinking" ? "var(--ai-thinking)" : "var(--orb-core)",
            boxShadow: `0 0 56px var(--orb-halo)`,
            opacity: haloOpacity,
          }}
        />
        <span
          aria-hidden
          className="relative size-1/2 rounded-pill"
          style={{ backgroundColor: "var(--orb-core)" }}
        />
      </div>
    );
  },
);
VoicePresence.displayName = "VoicePresence";
```

Invariant: only `--orb-core / --orb-halo / --ai-thinking` colors used. `motion-safe:` prefix collapses to nothing in `prefers-reduced-motion`. No `--accent` in non-orb composites.

**`transcript-feed/transcript-feed.tsx`** (CREATE)

```tsx
"use client";
import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export interface TranscriptFeedEntry {
  readonly speaker: "candidate" | "agent";
  readonly text: string;
  readonly timestamp: Date;
}

export interface TranscriptFeedProps {
  entries: ReadonlyArray<TranscriptFeedEntry>;
  className?: string;
}

function formatTimecode(t: Date, base: Date): string {
  const elapsed = Math.max(0, Math.floor((t.getTime() - base.getTime()) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `[${mm}:${ss}]`;
}

export function TranscriptFeed({ entries, className }: TranscriptFeedProps) {
  const base = entries[0]?.timestamp ?? new Date();
  return (
    <ol
      className={cn(
        "mx-auto flex w-full max-w-[640px] flex-col gap-3 text-base",
        className,
      )}
      aria-live="polite"
    >
      {entries.map((e, i) => {
        const isAi = e.speaker === "agent";
        return (
          <li key={i} className="group flex flex-col gap-1">
            <span
              className={cn(
                "text-xs uppercase tracking-[0.02em] font-medium",
                isAi ? "text-transcript-ai" : "text-transcript-candidate",
              )}
            >
              {isAi ? "Sift" : "Candidate"} ·
            </span>
            <p className="text-foreground">{e.text}</p>
            <span className="font-mono text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {formatTimecode(e.timestamp, base)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

**`mic-level-meter/mic-level-meter.tsx`** (CREATE)

```tsx
"use client";
import { cn } from "@repo/ui/lib/cn";

export interface MicLevelMeterProps {
  /** 0..1; while mic open but silent, container should pulse 0.04 → 0.05 over 4s. */
  level: number;
  className?: string;
}

export function MicLevelMeter({ level, className }: MicLevelMeterProps) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <div
      className={cn(
        "mx-auto h-[3px] w-full max-w-[360px] overflow-hidden rounded-pill bg-muted/40",
        className,
      )}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-label="Microphone input level"
    >
      <div
        className="h-full origin-left rounded-pill bg-voice-active opacity-70 transition-[width] duration-150 ease-out"
        style={{ width: `${(clamped * 100).toFixed(1)}%` }}
      />
    </div>
  );
}
```

**`connection-loss-banner/connection-loss-banner.tsx`** (CREATE)

```tsx
"use client";
import { cn } from "@repo/ui/lib/cn";

export type BannerState = "reconnecting" | "reconnected-resuming" | "failed";

const COPY: Record<BannerState, { title: string; sub: string }> = {
  reconnecting: {
    title: "Reconnecting…",
    sub: "Your interview is paused. Please stay on this page.",
  },
  "reconnected-resuming": {
    title: "Reconnected. Resuming…",
    sub: "Picking up where we left off.",
  },
  failed: {
    title: "We can't reach Sift right now.",
    sub: "Your progress is saved — try refreshing in a moment.",
  },
};

export interface ConnectionLossBannerProps {
  state: BannerState;
  className?: string;
}

export function ConnectionLossBanner({ state, className }: ConnectionLossBannerProps) {
  const copy = COPY[state];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-1 bg-attention-warning/90 px-6 py-3 text-attention-warning-foreground",
        "motion-safe:animate-in motion-safe:slide-in-from-top motion-safe:duration-200",
        className,
      )}
    >
      <p className="font-medium">{copy.title}</p>
      <p className="text-sm opacity-90">{copy.sub}</p>
      {state === "reconnecting" && (
        <span
          aria-hidden
          className="mt-1 h-[2px] w-32 overflow-hidden rounded-pill bg-attention-warning-foreground/30"
        >
          <span className="block h-full w-1/3 bg-attention-warning-foreground motion-safe:animate-[shimmer_1.5s_linear_infinite]" />
        </span>
      )}
    </div>
  );
}
```

**`packages/ui/src/index.ts`** (MODIFY) — append:

```ts
export * from "./composites/voice-presence/index";
export * from "./composites/transcript-feed/index";
export * from "./composites/mic-level-meter/index";
export * from "./composites/connection-loss-banner/index";
```

**`packages/ui/package.json`** (MODIFY) — exports map:

- ADD:
  - `"./composites/voice-presence": "./src/composites/voice-presence/index.tsx"`
  - `"./composites/transcript-feed": "./src/composites/transcript-feed/index.tsx"`
  - `"./composites/mic-level-meter": "./src/composites/mic-level-meter/index.tsx"`
  - `"./composites/connection-loss-banner": "./src/composites/connection-loss-banner/index.tsx"`
- REMOVE: `"./composites/toaster": "./src/composites/toaster/index.tsx"` — directory verified non-existent.

### 5.7 App-specific components (`apps/web/src/components/`)

**`CandidatePageShell.tsx`** (CREATE)

```tsx
import * as React from "react";

export function CandidatePageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[720px]">{children}</div>
    </main>
  );
}
```

(No `"use client"`. This is a pure layout component used inside Server Components too.)

**`CandidateErrorScreen.tsx`** (CREATE)

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/primitives/card";
import { CandidatePageShell } from "./CandidatePageShell";

export type CandidateErrorKind =
  | "invalid-link"
  | "expired-link"
  | "interview-not-ready"
  | "mic-denied"
  | "session-interrupted"
  | "network";

const COPY: Record<CandidateErrorKind, { title: string; body: string; hint?: string }> = {
  "invalid-link": {
    title: "This link doesn't look right.",
    body: "Check the link your recruiter sent — the token in the URL is missing or invalid.",
  },
  "expired-link": {
    title: "This link has expired.",
    body: "Candidate links are valid for 7 days. Please ask your recruiter for a fresh link.",
  },
  "interview-not-ready": {
    title: "This interview isn't ready yet.",
    body: "Your recruiter hasn't finished scheduling. They'll send a new link when it's ready.",
  },
  "mic-denied": {
    title: "We can't hear you.",
    body: "Sift needs microphone access for the interview.",
    hint: "Click the lock icon in your browser's address bar and allow microphone access, then refresh this page.",
  },
  "session-interrupted": {
    title: "Your session was interrupted.",
    body: "We couldn't reconnect after 60 seconds. Your progress is saved.",
    hint: "Refresh this page to try again, or contact your recruiter if the issue persists.",
  },
  network: {
    title: "We can't reach Sift right now.",
    body: "Check your connection and try again in a moment.",
  },
};

export function CandidateErrorScreen({ kind }: { kind: CandidateErrorKind }) {
  const c = COPY[kind];
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{c.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">{c.body}</p>
          {c.hint && <p className="text-sm text-muted-foreground">{c.hint}</p>}
        </CardContent>
      </Card>
    </CandidatePageShell>
  );
}
```

**`Toaster.tsx`** (CREATE) — Sonner kept inside `apps/web` (not `@repo/ui`) so the UI package stays free of `sonner`.

```tsx
"use client";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            "bg-card text-card-foreground border-border rounded-md",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
```

### 5.8 Containers

**`CandidateLandingContainer`** (three-file CREATE)

`useCandidateLanding.ts`:
```ts
"use client";
import { useMemo } from "react";
import type { CandidateInterviewView } from "@/types";

export interface CandidateLandingViewModel {
  greeting: string;          // "Hi, <firstName>"
  jobLine: string;           // "<jobTitle> · <company>"
  scheduledLine: string;     // "Scheduled for Wed, May 21 · 2:00 PM (your time)"
  durationLine: string;      // "Target length: 15 min" | "Target length: not set"
  ctaEnabled: boolean;       // status === "SCHEDULED"
  ctaCopy: string;
  blockedReason?: string;    // when ctaEnabled is false
}

export function useCandidateLanding(view: CandidateInterviewView): CandidateLandingViewModel {
  return useMemo(() => {
    const firstName = view.candidateName.split(/\s+/)[0] ?? "there";
    const ctaEnabled = view.status === "SCHEDULED";
    return {
      greeting: `Hi, ${firstName}.`,
      jobLine: `${view.jobTitle} · ${view.company}`,
      scheduledLine: `Scheduled for ${view.scheduledAt.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })}`,
      durationLine:
        view.targetDurationMinutes == null
          ? "Target length: not set"
          : `Target length: ${view.targetDurationMinutes} min`,
      ctaEnabled,
      ctaCopy: ctaEnabled ? "Begin device check" : "Interview not available",
      blockedReason: ctaEnabled
        ? undefined
        : view.status === "COMPLETED" || view.status === "EVALUATED"
          ? "This interview has already been completed."
          : view.status === "IN_PROGRESS"
            ? "This interview is already in progress."
            : view.status === "CANCELLED"
              ? "This interview was cancelled."
              : "This interview isn't ready yet.",
    };
  }, [view]);
}
```

`CandidateLandingContainer.tsx`:
```tsx
"use client";
import Link from "next/link";
import { Button } from "@repo/ui/primitives/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@repo/ui/primitives/card";
import { CandidatePageShell } from "@/components/CandidatePageShell";
import type { CandidateInterviewView } from "@/types";
import { useCandidateLanding } from "./useCandidateLanding";

export function CandidateLandingContainer({
  view, token,
}: { view: CandidateInterviewView; token: string }) {
  const vm = useCandidateLanding(view);
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{vm.greeting}</CardTitle>
          <p className="text-muted-foreground">{vm.jobLine}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>{vm.scheduledLine}</p>
          <p className="text-muted-foreground">{vm.durationLine}</p>
          {vm.blockedReason && (
            <p className="text-attention-warning">{vm.blockedReason}</p>
          )}
        </CardContent>
        <CardFooter>
          {vm.ctaEnabled ? (
            <Button asChild>
              <Link href={{ pathname: `/c/${view.interviewId}/check`, query: { token } }}>
                {vm.ctaCopy}
              </Link>
            </Button>
          ) : (
            <Button disabled>{vm.ctaCopy}</Button>
          )}
        </CardFooter>
      </Card>
    </CandidatePageShell>
  );
}
```

`index.ts`:
```ts
export { CandidateLandingContainer } from "./CandidateLandingContainer";
```

**`PreInterviewCheckContainer`** (three-file CREATE)

`usePreInterviewCheck.ts` — full state machine; pseudo-code abbreviated for brevity, exact shape:
```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMicCheckStore } from "@/stores/useMicCheckStore";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";

type Step = "mic" | "audio" | "quiet" | "ready";
const STEPS: ReadonlyArray<Step> = ["mic", "audio", "quiet", "ready"];

export function usePreInterviewCheck() {
  const [step, setStep] = useState<Step>("mic");
  const { permission, level, outcome, setPermission, setLevel, markPassed, reset } =
    useMicCheckStore();
  const { transcriptVisible, setTranscriptVisible } = useInterviewSessionStore();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestMic = useCallback(async () => {
    setPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      // Request 16 kHz; browsers may silently return 48 kHz — log + pass through (risk #1).
      const ctx = new AudioContext({ sampleRate: 16000 });
      if (ctx.sampleRate !== 16000) {
        // eslint-disable-next-line no-console
        console.warn(`[mic-check] AudioContext sampleRate=${ctx.sampleRate} (requested 16000)`);
      }
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        if (rms > 0.05) markPassed();
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setPermission("granted");
    } catch {
      setPermission("denied");
    }
  }, [setPermission, setLevel, markPassed]);

  // Step 2: play TODO sample MP3. The 3s timeout doubles as a browser-compat
  // probe: if the audio cannot play (Safari rejecting audio/mpeg in MediaSource
  // is the canonical failure), we transition the step into "browser-unsupported"
  // and surface "Try Chrome, Edge, or Firefox" copy. Resolves risk #6 without
  // requiring up-front UA detection.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [audioTestState, setAudioTestState] = useState<
    "idle" | "playing" | "played" | "browser-unsupported"
  >("idle");

  const playSample = useCallback(() => {
    if (!audioElRef.current) {
      const el = new Audio("/sift-sample.mp3");   // TODO: replace placeholder MP3
      el.addEventListener("ended", () => setAudioTestState("played"));
      el.addEventListener("error", () => setAudioTestState("browser-unsupported"));
      audioElRef.current = el;
    }
    setAudioTestState("playing");
    const timeoutId = window.setTimeout(() => {
      // If we're still in "playing" after 3s with no progress, assume the
      // browser cannot play the format (MediaSource audio/mpeg rejection on
      // Safari is the canonical case). currentTime stays at 0 in that scenario.
      setAudioTestState((s) =>
        s === "playing" && (audioElRef.current?.currentTime ?? 0) === 0
          ? "browser-unsupported"
          : s,
      );
    }, 3000);
    audioElRef.current.play().catch(() => {
      window.clearTimeout(timeoutId);
      setAudioTestState("browser-unsupported");
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    reset();
  }, [reset]);

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!);
  };
  const prev = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]!);
  };

  return {
    step, stepIndex: STEPS.indexOf(step), totalSteps: STEPS.length,
    permission, level, outcome,
    requestMic, playSample, audioElRef, audioTestState,
    transcriptVisible, setTranscriptVisible,
    next, prev,
  };
}
```

`PreInterviewCheckContainer.tsx` — thin shell, mounts `StepperHeader` and switches on `step`. Step 1 renders `MicLevelMeter` + "Try saying 'hello'". Step 2 renders a `<button onClick={playSample}>Play Sift sample</button>` plus `<audio ref={audioElRef} hidden />`, AND switches on `audioTestState`: when `"browser-unsupported"` the step renders a non-blocking inline message with copy *"Audio playback isn't working in your browser. Sift works best in Chrome, Edge, or Firefox. Please switch browsers and reopen your link."* and the Next button is disabled until either `"played"` or the user explicitly skips. Step 3 renders the quiet-space advisory copy. Step 4 renders the transcript toggle and an "Enter interview" Link to `/c/<id>/session?token=...`.

**`InterviewSessionContainer`** (three-file CREATE) — uses `/frontend-voice-pipeline` skill.

`useInterviewSession.ts` — orchestration outline (full implementation cited below by responsibility, not transcribed in full — the file will be ~250 LOC):

```ts
"use client";
import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { env } from "@/lib/env";
import {
  useInterviewSessionStore,
  type TranscriptEntry,
} from "@/stores/useInterviewSessionStore";
import { AudioPlaybackQueue } from "./audio-playback-queue";

const MAX_RECONNECTS = 10;
const MAX_RECONNECT_WINDOW_MS = 60_000;
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 4_000;

interface UseInterviewSessionArgs { interviewId: string; token: string; }

export function useInterviewSession({ interviewId, token }: UseInterviewSessionArgs) {
  const s = useInterviewSessionStore();
  const wsRef = useRef<WebSocket | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackRef = useRef<AudioPlaybackQueue | null>(null);
  const reconnectStartedAtRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioLevelRef = useRef(0);     // mirror of latest mic RMS for orb envelope

  const wsUrl = `${env.NEXT_PUBLIC_WS_URL}/interviews/${encodeURIComponent(interviewId)}/session?token=${encodeURIComponent(token)}`;

  const connect = useCallback(async () => {
    s.setConnectionState(reconnectAttemptRef.current === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      s.setConnectionState("connected");
      reconnectAttemptRef.current = 0;
      reconnectStartedAtRef.current = null;
    };

    ws.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        // text frame: only one known frame — session.completed
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.type === "session.completed") {
            const transcript: TranscriptEntry[] = (parsed.payload?.transcript ?? []).map(
              (t: { speaker: "candidate" | "agent"; text: string; timestamp: string }) => ({
                speaker: t.speaker, text: t.text, timestamp: new Date(t.timestamp),
              }),
            );
            s.appendTranscript(transcript);
            s.setConnectionState("completed");
          }
        } catch { /* swallow */ }
        return;
      }
      // binary: MP3 chunk from agent
      const chunk = new Uint8Array(ev.data as ArrayBuffer);
      playbackRef.current?.enqueue(chunk);
      s.setSpeaker("ai");
    };

    ws.onclose = (e) => {
      if (s.connectionState === "completed") return;
      // 1008 (POLICY_VIOLATION) = token rejected → terminal, do NOT reconnect
      if (e.code === 1008) {
        s.setConnectionState("interrupted");
        toast.error("Your session ended (invalid credentials).");
        return;
      }
      // attempt reconnect within 60s window
      const now = Date.now();
      if (reconnectStartedAtRef.current === null) reconnectStartedAtRef.current = now;
      const elapsed = now - reconnectStartedAtRef.current;
      if (elapsed > MAX_RECONNECT_WINDOW_MS || reconnectAttemptRef.current >= MAX_RECONNECTS) {
        s.setConnectionState("interrupted");
        return;
      }
      const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      s.incrementReconnect();
      s.setConnectionState("reconnecting");
      reconnectTimerRef.current = setTimeout(() => void connect(), delay);
    };

    ws.onerror = () => {
      // close handler will run with a non-1000 code
    };
  }, [wsUrl, s]);

  const startMicAndPipe = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;
    // Worklet processes at the AudioContext's native sample rate then downsamples to 16k.
    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    if (ctx.sampleRate !== 16000) {
      // eslint-disable-next-line no-console
      console.warn(`[session] AudioContext sampleRate=${ctx.sampleRate} (requested 16000)`);
    }
    await ctx.audioWorklet.addModule("/audio-worklet/pcm-downsampler.js");
    // NOTE: implementer must build a small public/audio-worklet/pcm-downsampler.js wrapper
    // that imports from audio-worklet.processor.ts (Next 16 will bundle the .ts via worklet plugin
    // or it can be a small hand-written JS shim if the toolchain doesn't support TS worklets).
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-downsampler");
    workletRef.current = node;
    node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      audioLevelRef.current = ev.data.rms;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(ev.data.pcm);
    };
    src.connect(node);
    // Do not connect node to destination — avoid loopback.
  }, []);

  useEffect(() => {
    playbackRef.current = new AudioPlaybackQueue();
    void (async () => {
      try {
        await startMicAndPipe();
        await connect();
      } catch (e) {
        s.setConnectionState("error");
        toast.error("We couldn't access your microphone.");
      }
    })();
    return () => {
      reconnectTimerRef.current && clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close(1000, "client unmount");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      playbackRef.current?.dispose();
      s.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { audioLevelRef };
}
```

`audio-playback-queue.ts` — MediaSource-backed MP3 streaming buffer:

```ts
export class AudioPlaybackQueue {
  private readonly audioEl: HTMLAudioElement;
  private readonly mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly pending: Uint8Array[] = [];

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    this.mediaSource = new MediaSource();
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", () => {
      this.sourceBuffer = this.mediaSource.addSourceBuffer("audio/mpeg");
      this.sourceBuffer.addEventListener("updateend", () => this.drain());
      this.drain();
    });
  }

  enqueue(chunk: Uint8Array): void {
    this.pending.push(chunk);
    this.drain();
  }

  private drain(): void {
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    const next = this.pending.shift();
    if (!next) return;
    this.sourceBuffer.appendBuffer(new Uint8Array(next));
  }

  dispose(): void {
    try { this.audioEl.pause(); this.audioEl.src = ""; } catch { /* ignore */ }
  }
}
```

`audio-worklet.processor.ts` — worklet module (registered with `registerProcessor`); contains a small linear-interpolation downsampler from native sample-rate to 16 kHz mono linear16 (Int16Array), packed into `ArrayBuffer` and posted to the main thread with RMS.

`InterviewSessionContainer.tsx`:
```tsx
"use client";
import { VoicePresence } from "@repo/ui/composites/voice-presence";
import { TranscriptFeed } from "@repo/ui/composites/transcript-feed";
import { MicLevelMeter } from "@repo/ui/composites/mic-level-meter";
import { ConnectionLossBanner } from "@repo/ui/composites/connection-loss-banner";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";
import type { CandidateInterviewView } from "@/types";
import { useInterviewSession } from "./useInterviewSession";

export function InterviewSessionContainer({
  view, token,
}: { view: CandidateInterviewView; token: string }) {
  const { connectionState, speaker, transcript, transcriptVisible } = useInterviewSessionStore();
  const { audioLevelRef } = useInterviewSession({ interviewId: view.interviewId, token });

  const bannerState =
    connectionState === "reconnecting" ? "reconnecting"
    : connectionState === "interrupted" ? "failed"
    : null;
  const orbState =
    connectionState === "completed" ? "idle"
    : speaker === "ai" ? "speaking"
    : speaker === "candidate" ? "listening"
    : "thinking";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background">
      {bannerState && <ConnectionLossBanner state={bannerState} />}
      <VoicePresence state={orbState} audioLevel={audioLevelRef.current} />
      {transcriptVisible && transcript.length > 0 && (
        <div className="mt-12"><TranscriptFeed entries={transcript} /></div>
      )}
      <div className="absolute inset-x-0 bottom-2 px-6">
        <MicLevelMeter level={audioLevelRef.current} />
      </div>
    </main>
  );
}
```

**`PostInterviewContainer`** (three-file CREATE)

`usePostInterview.ts`:
```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { getCandidateInterviewView } from "@/services/candidate.service";
import type { CandidateInterviewView } from "@/types";

const TERMINAL = ["COMPLETED", "EVALUATED"] as const;
type Terminal = (typeof TERMINAL)[number];

export function usePostInterview(args: { initial: CandidateInterviewView; token: string }) {
  const q = useQuery({
    queryKey: ["candidate-view", args.initial.interviewId],
    initialData: args.initial,
    queryFn: async () => {
      const r = await getCandidateInterviewView({
        interviewId: args.initial.interviewId,
        token: args.token,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    refetchInterval: (q) => {
      const data = q.state.data as CandidateInterviewView | undefined;
      if (data && (TERMINAL as readonly string[]).includes(data.status)) return false;
      const count = q.state.dataUpdateCount;
      return count >= 5 ? false : 30_000;
    },
  });
  const isTerminal = q.data ? (TERMINAL as readonly string[]).includes(q.data.status) : false;
  return { view: q.data, isTerminal };
}
```

`PostInterviewContainer.tsx`:
```tsx
"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@repo/ui/primitives/card";
import { CandidatePageShell } from "@/components/CandidatePageShell";
import type { CandidateInterviewView } from "@/types";
import { usePostInterview } from "./usePostInterview";

export function PostInterviewContainer({
  view, token,
}: { view: CandidateInterviewView; token: string }) {
  const { view: cur, isTerminal } = usePostInterview({ initial: view, token });
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">
            {isTerminal ? "Thanks, you're done." : "Wrapping up…"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {isTerminal
              ? "Your recruiter will be in touch. You can safely close this tab."
              : "We're saving your session — this only takes a moment."}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {cur?.jobTitle} · {cur?.company}
          </p>
        </CardContent>
      </Card>
    </CandidatePageShell>
  );
}
```

### 5.9 Routes

**`apps/web/app/(candidate)/layout.tsx`** (CREATE) — Server Component. **No `"use client"`. No client hooks.**

```tsx
import type { ReactNode } from "react";
import { SoftBlockScreen } from "@repo/ui/composites/soft-block-screen";
import { CandidateErrorScreen } from "@/components/CandidateErrorScreen";
import { loadCandidateView } from "@/lib/candidate-fetch";

// Next.js 16: layouts receive `params` always; `searchParams` ALSO yes on App Router
// but documented as "params and searchParams are Promises". See §8 for the fallback.
export default async function CandidateLayout({
  children,
  params,
  searchParams,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const load = await loadCandidateView(id, token);
  if (load.kind !== "ok") {
    const kind =
      load.kind === "invalid-link" ? "invalid-link"
      : load.kind === "interview-not-found" ? "invalid-link"   // 404 masquerades as invalid per ADR-019
      : "network";
    return <CandidateErrorScreen kind={kind} />;
  }
  return (
    <>
      <SoftBlockScreen audience="candidate" />
      {children}
    </>
  );
}
```

**`apps/web/app/(candidate)/c/[id]/page.tsx`** (CREATE)

```tsx
import { loadCandidateView } from "@/lib/candidate-fetch";
import { CandidateErrorScreen } from "@/components/CandidateErrorScreen";
import { CandidateLandingContainer } from "@/containers/CandidateLandingContainer";

export default async function CandidateLandingPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const load = await loadCandidateView(id, token);
  if (load.kind !== "ok") return <CandidateErrorScreen kind="invalid-link" />;
  return <CandidateLandingContainer view={load.view} token={token!} />;
}
```

The same pattern for `check/page.tsx`, `session/page.tsx`, `done/page.tsx` — only the container they mount changes. (Token assertion is safe inside the page because the layout already rejected missing tokens.)

### 5.10 Infrastructure

**`apps/web/app/layout.tsx`** (MODIFY) — wire `Toaster`:

```tsx
import { Toaster } from "@/components/Toaster";
// ...
<QueryProvider>{children}</QueryProvider>
<Toaster />
```

**`apps/web/public/sift-sample.mp3`** (CREATE — placeholder OK) — leave a TODO comment in `usePreInterviewCheck.ts` at the `new Audio("/sift-sample.mp3")` line: *"TODO: replace with the production ElevenLabs-generated sample (asset-generation tracked separately)."*

### 5.11 Tests

Per file, summary:

- **Composite tests** (`@repo/ui`): mounted with RTL; assert ARIA roles, class tokens, state-driven attribute changes. No mocks.
- **Store tests**: call hooks directly; reset between tests with `useStore.setState(initial, true)`.
- **Service test** (`candidate.service.test.ts`): `vi.stubGlobal("fetch", ...)`; URL/method assertion; happy path + 401 + 404 + 500 + network throw + Zod parse failure.
- **Container tests**: mock `@/services/candidate.service`; fresh `QueryClient` per test; for `useInterviewSession` mock `WebSocket`, `navigator.mediaDevices.getUserMedia`, and `AudioContext`/`AudioWorkletNode` via jsdom stubs.
- **E2E**: ONE new spec — `candidate-error.spec.ts`. Uses `webServer.env: { NEXT_PUBLIC_API_URL: "http://127.0.0.1:1" }` (a guaranteed-dead port) to force the layout's server-side fetch into a network failure. Asserts that the dead-port path renders `CandidateErrorScreen kind="network"`, and that a missing-token URL (`/c/<id>` with no `?token=`) renders `kind="invalid-link"`. No browser mocking, no backend dependency. Tier-2 happy-path specs (landing, pre-check, session, done) deferred to the real-backend Playwright infrastructure follow-up carried over from Phase 8.

---

## 6. State machines

### Connection state (InterviewSessionContainer)

```
idle ──(useEffect mount)──▶ connecting
connecting ──(ws.onopen)──▶ connected
connecting ──(ws.onclose 1008)──▶ interrupted  (terminal)
connected ──(ws.onclose normal w/ session.completed)──▶ completed (terminal)
connected ──(ws.onclose non-normal, within 60s window, attempts<10)──▶ reconnecting
reconnecting ──(timer expires)──▶ connecting
reconnecting ──(60s elapsed OR attempts==10)──▶ interrupted  (terminal)
any ──(unmount)──▶ idle (via reset)
```

DESIGN.md §7 mapping:
- **0–2s** = `connected → reconnecting` is delayed: container only sets `reconnecting` after the first failed reconnect attempt resolves OR 2s elapse. Implementation note: when `ws.onclose` fires with non-1008, schedule a 2 s timeout before flipping store state to `reconnecting`; if a fresh `connected` happens within 2s the timer is cleared.
- **2–10s** = `reconnecting` state drives `<ConnectionLossBanner state="reconnecting" />` and amber halo (orb-state mapping: when `connectionState === "reconnecting"` the orb halo CSS variable swaps to `--attention-warning` — handled in `InterviewSessionContainer.tsx` via a wrapping `<div data-conn="reconnecting">` and a small CSS rule that recolors `--orb-halo` within that scope; or via prop on `VoicePresence` if simpler — implementer's call).
- **Reconnect succeeds** = the banner shows `reconnected-resuming` for 2.5 s then unmounts.
- **>60s** = `interrupted`, banner stays static with `failed` copy, orb settles to static low-glow.

### Mic-check state (PreInterviewCheckContainer)

```
permission: idle ──requestMic──▶ requesting
requesting ──getUserMedia resolves──▶ granted
requesting ──getUserMedia rejects──▶ denied

outcome: pending ──RMS > 0.05──▶ passed  (one-way)

step: mic ──(outcome=passed AND user clicks Next)──▶ audio
audio ──(playSample finished OR user clicks Next)──▶ quiet
quiet ──(user clicks Next)──▶ ready
ready ──(user clicks "Enter interview")──▶ navigation to /c/<id>/session
```

### Pre-interview step machine

Already described above. The `StepperHeader` receives `currentIndex = STEPS.indexOf(step)`.

---

## 7. WebSocket wire protocol

Authoritative source: `apps/backend/src/presentation/controllers/interview-session.controller.ts` + `voice-websocket.ts`.

**URL**: `${NEXT_PUBLIC_WS_URL}/interviews/${interviewId}/session?token=${tokenBase64Url}`
**Subprotocols**: none.
**`binaryType`**: client must set to `"arraybuffer"`.

### Client → Server frames

| Direction | Type | Format | Payload | Notes |
|---|---|---|---|---|
| C→S | binary | linear16 PCM, **mono, 16 kHz, little-endian** | raw `Uint8Array` chunks ~20–40 ms | matches `DEFAULT_DEEPGRAM_ENCODING = "linear16"`, `DEFAULT_DEEPGRAM_SAMPLE_RATE = 16000`. Backend filters out text frames from candidate (`isBinary` discriminator in `wsBinaryToAsyncIterable`). |

The client must NOT send any text frame — the backend ignores text from the candidate.

### Server → Client frames

| Direction | Type | Format | Payload | Notes |
|---|---|---|---|---|
| S→C | binary | MP3 (`mp3_44100_128`) | raw `Uint8Array` chunks streamed from ElevenLabs | Per `apps/backend/src/infrastructure/services/elevenlabs/provider.ts` default. Client feeds these to a `MediaSource` of type `audio/mpeg`. |
| S→C | text  | JSON: `{ type: "session.completed", payload: ConductInterviewOutput }` | exactly one frame, just before WS close | Payload shape per `packages/application/src/dtos/conduct-interview.dto.ts`. `transcript[]` is an array of `{ speaker: "candidate"|"agent"; text: string; timestamp: string }`. |

### Close codes

| Code | Symbol | Meaning | Client response |
|---|---|---|---|
| 1000 | `NORMAL` | Session ended normally; `session.completed` already delivered | `connectionState = "completed"` — do NOT reconnect |
| 1008 | `POLICY_VIOLATION` | Token rejected / mismatch | `connectionState = "interrupted"` — render `CandidateErrorScreen kind="invalid-link"` (or `session-interrupted`) — do NOT reconnect |
| 1011 | `INTERNAL_ERROR` | Backend error mid-session | Attempt reconnect within 60 s window |
| 1012 | `SERVICE_RESTART` | STT/TTS/agent unavailable | Attempt reconnect within 60 s window |

### Transcript freshness (risk #3)

The backend emits transcript **only** at session end as the `session.completed` payload — there are no intermediate transcript deltas in the current WS protocol. Therefore the v1 transcript feature behaves as follows: during the call the transcript feed is empty (or invisible if `transcriptVisible === false`); on `session.completed` the full transcript is appended atomically. DESIGN.md §7 describes live word-by-word fade-in — that requires either a backend protocol extension (deferred to Phase 10) or local STT divergence (rejected for correctness). The plan documents this in §11 risk #3.

---

## 8. Layout-vs-page data flow

**Chosen approach: option (b).** The layout performs token verification by calling `loadCandidateView(id, token)`; on failure it renders `CandidateErrorScreen` directly (does NOT redirect — per locked-in decision). On success it renders `<SoftBlockScreen audience="candidate" />` + `{children}` and discards the loaded view.

Each child page (`/c/[id]/page.tsx`, `/check/page.tsx`, `/session/page.tsx`, `/done/page.tsx`) calls `loadCandidateView(id, token)` **again** as a server-side fetch, passes the result to its container as a prop, and falls back to `CandidateErrorScreen` on any second-pass failure (covers races where the interview state changed between layout-time and page-time).

**Why this is correct:**

1. **No React Context.** Containers stay testable in isolation; props are the contract.
2. **Cheap.** The backend endpoint is `O(1)` repository read; doing it twice per route is fine, and `cache: "no-store"` makes the page version fresher than the layout version — useful because the candidate may navigate from `/c/[id]` to `/c/[id]/session` minutes apart and the recruiter could have cancelled in between.
3. **Mirror of existing pattern.** Phase 8's `(recruiter)/layout.tsx` already loads `getServerSession()`, and individual server-page actions re-read the session — this is the established convention.

**`searchParams` on Next 16 layouts — verification point.** Next 16's App Router does pass `searchParams: Promise<...>` to layout `default` exports, but historically this was page-only and the docs have shifted across minor versions. **Verification step the implementer must run before writing the layout:** check the Next 16.2 release notes / `node_modules/next/dist/server/...` types, OR run a one-line `console.log` smoke test by adding `console.log({ searchParams })` to `apps/web/app/(recruiter)/layout.tsx` (recruiter layout has the same signature concern). **Fallback if `searchParams` is not passed to layouts in Next 16.2**: drop layout-level verification, move the verification into each page's server-side fetch (which always has `searchParams`), and have the layout only render `<SoftBlockScreen>`. Pages already do their own re-fetch, so the fallback is a one-import deletion — zero re-architecture.

---

## 9. Verification checklist

Run in this order after **all** code is written:

```bash
# 1. Type-check (must be clean)
pnpm turbo run check-types --filter=web --filter=@repo/ui

# 2. Lint (must be clean, --max-warnings 0)
pnpm turbo run lint --filter=web --filter=@repo/ui

# 3. Unit + integration tests
pnpm turbo run test --filter=@repo/ui     # voice-presence, transcript-feed, mic-level-meter, connection-loss-banner
pnpm turbo run test --filter=web          # services, stores, containers, CandidateErrorScreen

# 4. E2E (after `playwright install` once)
pnpm --filter web exec playwright test    # landing, login, signup (existing) + candidate-error (new)
```

Pass criteria:
- All three pre-existing `(recruiter)`/auth E2E specs still pass (landing, login, signup).
- The single new `candidate-error.spec.ts` passes against the dead-port + missing-token URLs (no mocking needed).
- Type-check + lint exit 0.
- No `console.error` calls in any spec output (the AudioContext sample-rate warning is a `console.warn` and is acceptable).

Per-layer `/frontend-arch-validator` runs (called by `/frontend-implement` after each layer):

- After **services** → no `useState`/`useQuery` outside containers.
- After **stores** → no service imports, no server-data fields.
- After **composites** → no service / store / TanStack imports; no raw Tailwind color scales.
- After **containers** → `"use client"` only at container root; no `fetch()` calls.
- After **routes** → no `"use client"`; no client hooks; only one container per page.

---

## 10. Out of scope

- WebSocket session resumption / server-side reconnect bookkeeping (Phase 10).
- Live transcript deltas during the call (current WS protocol does not emit them; Phase 10 or later).
- TTS sample endpoint — `/c/[id]/check` uses the pre-baked `public/sift-sample.mp3`.
- Email delivery of the candidate link (deferred per `project_email_resend_decision.md`).
- Mobile candidate flow — `SoftBlockScreen` blocks `(max-width:767px), (pointer:coarse)`.
- Online audio resampling — we request 16 kHz `AudioContext` and warn on mismatch; the AudioWorklet does the downsampling, so end-to-end audio is still linear16 16 kHz on the wire even when the AudioContext returns 48 kHz.
- Asset generation of `sift-sample.mp3` — separate one-time task.
- Server-rendered candidate `(candidate)` layouts for crawl indexing — these routes are noindex / not linked publicly.
- Transcript export to candidate (recruiter-only feature).
- Cross-tab transcript-toggle sync (localStorage suffices for one tab).

---

## 11. Risks + open questions

**Risk #1 — AudioContext sample-rate honouring.**
`new AudioContext({ sampleRate: 16000 })` is best-effort on Chromium / Firefox / Safari. Some hardware paths silently return 48 kHz. The plan handles this by routing all mic samples through the AudioWorklet which downsamples to 16 kHz linear16 regardless of the input rate; we log a warning and proceed. The risk is CPU cost on low-end laptops — measure during QA. **Mitigation if measured cost is intolerable**: degrade to native rate and update Deepgram input to match by parameterising sample rate in `useInterviewSession.ts` (Phase 10 follow-up; ADR worthy).

**Risk #2 — `searchParams` on Next 16 layouts.**
Documented as supported in Next 16.x but historically inconsistent. Plan includes a verification step in §8 and a one-import fallback if the layout signature doesn't receive `searchParams`. No re-architecture is needed for the fallback.

**Risk #3 — Transcript freshness vs server-side truth.**
The backend's current WS protocol only emits a transcript at session end (`session.completed` payload). DESIGN.md §7 describes live word-by-word transcript fade-in, but implementing that with the current backend would require either local STT (rejected — divergence from server-side truth) or a Phase 10 protocol extension. Plan ships transcript feed empty during the call and appends atomically at end. If product disagrees, smallest fix is a backend change to emit per-turn transcript deltas; not a frontend-only decision.

**Risk #4 — Playwright stubbing scope. (RESOLVED — see §4 note)**
The layout's server-side `fetch()` runs in Next.js's Node process. Playwright's `page.route()` intercepts the **browser's** network requests, NOT Node-side fetches. Three remediations were considered (MSW-Node, mock-backend in `webServer`, real-backend with fixtures); the chosen path is **defer happy-path candidate E2E to the tier-2 real-backend infrastructure follow-up carried over from Phase 8**, and ship only one self-hermetic spec in Phase 9 (`candidate-error.spec.ts` using `webServer.env` to override `NEXT_PUBLIC_API_URL` to a dead port). Rationale: container/hook tests via Vitest + RTL cover the deep behaviour at the right unit; manufactured stubbing infrastructure carries ongoing maintenance cost out of proportion to marginal coverage. `PostInterviewContainer` polling DOES go through the browser fetch and CAN be stubbed via `page.route()` if/when a poll-specific E2E is wanted — currently covered by the container hook test instead.

**Risk #5 — `audio-worklet.processor.ts` bundling.**
Next 16 doesn't have first-class AudioWorklet TypeScript bundling. The plan calls for a public-served JS shim at `public/audio-worklet/pcm-downsampler.js`. Implementer may need to hand-write this JS (≈40 LOC) rather than build it from the TS source. Document the duplication.

**Risk #6 — `<audio>` + `MediaSource` for streamed MP3. (RESOLVED — see §5.8 audio-test detection)**
Most evergreen browsers support `MediaSource.addSourceBuffer("audio/mpeg")`, but Safari historically required `audio/mp4`. Up-front User-Agent detection rejected as brittle (UA strings lie; risks blocking working Safari versions). Instead the **pre-interview check Step 2** doubles as a browser-compatibility probe: if the MP3 sample fails to play within 3 seconds (or `play()` rejects, or the `<audio>` element fires `error`), `audioTestState` transitions to `"browser-unsupported"` and the step renders the inline copy *"Audio playback isn't working in your browser. Sift works best in Chrome, Edge, or Firefox. Please switch browsers and reopen your link."* The candidate self-redirects before the real interview starts; no backend AAC migration needed unless real-world Safari friction emerges. The session-page MP3 downlink path inherits the same playback stack, so a Safari user who passes Step 2 will also work in the live interview — and one who fails Step 2 won't reach the session page at all.

**Risk #7 — Reconnect token freshness.**
HMAC candidate tokens have a 7-day TTL (per ADR-017). A reconnect that occurs near the TTL boundary may succeed on first try and fail on the second. The plan accepts this — 60 s reconnect window vs 7-day TTL means in practice this happens only if the candidate was already nine minutes from expiry when the interview started, which is recruiter-side mis-scheduling, not a runtime bug.

---

## Unresolved decisions (for implementer to confirm at start)

**Resolved before implementation start:**

- ~~Playwright stubbing strategy~~ — **resolved 2026-05-17**: Phase 9 ships ONE error-state spec via `webServer.env` dead-port override; happy-path candidate E2Es deferred to tier-2 real-backend follow-up. See §4 note + §11 risk #4.
- ~~Safari MP3 streaming compatibility~~ — **resolved 2026-05-17**: pre-interview check Step 2 doubles as a browser-compat probe; "Try Chrome/Edge/Firefox" inline message on detected playback failure. No upfront UA detection, no backend AAC migration. See §5.8 + §11 risk #6.
- ~~Final placement of `sift-sample.mp3`~~ — **deferred**: ships with TODO placeholder in Phase 9; production MP3 generation tracked as a one-time asset task separate from the implementation phase.

**Still open (implementer's call, low blast radius):**

- **Orb halo recolor for `reconnecting`** — new prop `tone?: "warm" | "warning"` on `VoicePresence` vs wrapping scoped CSS rule in `InterviewSessionContainer`. Both fine; pick at implementation time based on test cleanliness.
- **Worklet TS-vs-JS source-of-truth** — hand-write `public/audio-worklet/pcm-downsampler.js` and treat `audio-worklet.processor.ts` as documentation-only, or invest in a small build step.
- **`request<T>()` helper duplication** between `interview.service.ts` and `candidate.service.ts` — fix now (extract to `services/_request.ts`) or defer.
- **Token propagation layout→pages** — re-read from `searchParams` per page (current plan) vs pass via custom header.
- **Post-interview poll interval** — fixed 30 s, max 5 (current plan) vs configurable per environment (e.g., shorter in dev).
