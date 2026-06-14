# Plan: Phase 10 Tranche A1 — Candidate Session Integrity Frontend

> Generated: 2026-06-13
> Slug: phase-10-session-integrity-frontend

## Summary

Hardens the candidate voice-interview UX as the frontend counterpart to backend ADR-035. Four changes, all inside the candidate session surface: (1) a non-dismissable end-of-interview modal shown when the session is `completed` (with `interrupted` keeping DESIGN §7's connection-loss banner + low-glow orb, not a modal); (2) transcript autoscroll-to-latest; (3) a bounded, transcript-only scroll region that keeps the orb in view; (4) a reload-guard that recognises the backend's 409 `SESSION_ALREADY_ACTIVE` and terminal interview statuses, surfacing an "already in progress / finished" state instead of the generic error toast + stalled orb. The session pipeline stays effect-driven (no TanStack Query is introduced into `useInterviewSession`). UI fidelity follows `docs/DESIGN.md` ("Quiet Signal"): dark charcoal stage, a single warm orb, semantic tokens only, and calm composed copy (no exclamation marks, error iconography, or mascot).

## Route group

(candidate)

## Resolved decisions

- **Modal mechanism — reuse `Dialog`, no new primitive.** The existing Radix `Dialog` primitive (`packages/ui/src/primitives/dialog/`) is made non-dismissable by the *consumer*: `<Dialog open>` (controlled, never closed), `<DialogContent>` with `onInteractOutside={(e) => e.preventDefault()}`, `onEscapeKeyDown={(e) => e.preventDefault()}`, and no `DialogClose`. We do NOT add an `AlertDialog` primitive — the lighter option is sufficient and the repo has no AlertDialog convention. The reusable, prop-driven wrapper lives as a **web-app composite** at `apps/web/src/components/SessionEndModal.tsx` (it is candidate-app-specific copy, so `apps/web/src/components/`, not `packages/ui/`).
- **Unify changes 1 + 4 into ONE modal composite.** `SessionEndModal` is purely presentational (driven by a `variant` prop: `"completed" | "blocked"`), rendering different title/description copy. The container decides which variant (if any) to show. This avoids two near-duplicate modals.
- **`interrupted` follows DESIGN §7, NOT the modal (design alignment).** A failed/interrupted connection is not a blocking modal. Per `docs/DESIGN.md` §7 ("Connection-loss states") it keeps the existing `ConnectionLossBanner state="failed"` (muted-amber `--attention-warning`, never `--destructive`/`--negative`) plus the orb in a static low-glow (`{ state: "idle", tone: "warning" }`). This removes the double-treatment (banner + modal) and the contradicting "close this tab" copy; recovery framing stays deliberately undramatic (§9). **Caveat:** DESIGN §7's failed-state copy ("…try refreshing in a moment") predates ADR-035 — a refresh now hits the 409 block instead of resuming, so that canonical copy is partly stale. This plan does NOT rewrite it; flagged as a DESIGN follow-up (see Risk notes).
- **409 state — new `ConnectionState` value `"blocked"`.** `useInterviewSession` sets `connectionState: "blocked"` when `result.error.kind === "SERVER" && result.error.status === 409` (optionally also matching `code === "SESSION_ALREADY_ACTIVE"`). No 409 toast fires in that branch. The hook stays effect-driven; no `useQuery` added.
- **Terminal-status gating at the container, before the hook attempts a session.** When `view.status` is terminal (COMPLETED / EVALUATED / FAILED), the container short-circuits to the blocked/finished modal and the hook does NOT call `startCandidateSession`. This is achieved by passing an `enabled` flag to `useInterviewSession` (skip the effect when the view is already terminal).
- **FAILED handling — add `FAILED` to the wire enum.** The backend can now emit `FAILED`; add it to `InterviewStatusSchema` and include it in `TERMINAL_STATUSES` so `isTerminalStatus` covers it. This keeps the terminal gate truthful rather than relying solely on the 409 guard.
- **Layout restructure — explicit flex sections (no `min-h-screen justify-center`).** Replace the page-flow `<main className="min-h-screen ... justify-center">` with a fixed-height column: a non-shrinking orb section (`shrink-0`) on top and a bounded transcript section (`flex-1 min-h-0 overflow-y-auto`) below. The orb never leaves the viewport; only the transcript scrolls. Semantic tokens only (ADR-025).

## Layers touched

| Layer            | Path                                                                 | Scope                                                            |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Routes           | `apps/web/app/(candidate)/c/[id]/session/page.tsx`                   | none (already passes `view` + `token`; gate lives in container) |
| Containers       | `apps/web/src/containers/InterviewSessionContainer/`                 | layout restructure, modal wiring, terminal gate, `enabled` flag, `interrupted` → amber low-glow orb (`deriveOrb`) |
| Components        | `apps/web/src/components/SessionEndModal.tsx`                        | CREATE — non-dismissable modal composite (2 variants: completed, blocked) |
| Services         | `apps/web/src/services/`                                             | none (`_request` already maps 409 → `SERVER{status,code}`)      |
| Stores           | `apps/web/src/stores/useInterviewSessionStore.ts`                    | add `"blocked"` to `ConnectionState`                            |
| Types            | `apps/web/src/types/interview-status.types.ts`                      | add `FAILED`; include in terminal set                           |
| UI primitives    | `packages/ui/src/primitives/`                                        | none (reuse `Dialog`)                                           |
| UI composites    | `packages/ui/src/composites/transcript-feed/transcript-feed.tsx`    | autoscroll + bounded-scroll support                            |

## Implementation steps

### Step 1 — Types: add `FAILED` terminal status

**File:** `apps/web/src/types/interview-status.types.ts` (MODIFY)

**Render type:** Module

**What:** Add `FAILED` to the wire enum and the terminal set so the container's terminal gate covers a backend-emitted `FAILED`.

**Code:**
```typescript
import { z } from "zod";

export const InterviewStatusSchema = z.enum([
  "CREATED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "CANCELLED",
  "FAILED",
]);
export type InterviewStatus = z.infer<typeof InterviewStatusSchema>;

export const ALL_INTERVIEW_STATUSES = InterviewStatusSchema.options;

const TERMINAL_STATUSES: ReadonlySet<InterviewStatus> = new Set([
  "COMPLETED",
  "EVALUATED",
  "FAILED",
]);

export function isTerminalStatus(status: InterviewStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
```

**Invariant check:** Wire contract lives in `apps/web/src/types/` as a Zod schema mirroring the backend — no `@repo/*` import. Adding a value the backend can emit keeps the schema a faithful mirror.

---

### Step 2 — Store: add `"blocked"` connection state

**File:** `apps/web/src/stores/useInterviewSessionStore.ts` (MODIFY)

**Render type:** Module (Zustand)

**What:** Extend the `ConnectionState` union with `"blocked"` (set on 409 / terminal gate). No other store change — `reset()` already returns to `"idle"`.

**Code:**
```typescript
export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "completed"
  | "interrupted"
  | "error"
  | "blocked";
```

**Invariant check:** Store holds UI state only — `"blocked"` is a UI flag, not server data. The store does not import services.

---

### Step 3 — UI composite: TranscriptFeed autoscroll + bounded scroll

**File:** `packages/ui/src/composites/transcript-feed/transcript-feed.tsx` (MODIFY)

**Render type:** Client Component

**What:** Make the `<ol>` itself a scroll container (the bounded region is applied by the container via `className`, but the feed owns the autoscroll), and scroll to the latest entry whenever `entries.length` changes. Keep semantic tokens.

**Code:**
```typescript
"use client";

import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

// ...TranscriptFeedEntry / TranscriptFeedProps unchanged...

export function TranscriptFeed({ entries, className }: TranscriptFeedProps) {
  const base = entries[0]?.timestamp ?? new Date();
  const endRef = React.useRef<HTMLLIElement>(null);

  React.useEffect(() => {
    // Autoscroll to the newest turn as it arrives. `block: "end"` keeps the
    // latest entry pinned to the bottom of the bounded scroll region.
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length]);

  return (
    <ol
      aria-live="polite"
      className={cn(
        "mx-auto flex w-full max-w-[640px] flex-col gap-3 text-base",
        className,
      )}
    >
      {entries.map((entry, i) => {
        const isAi = entry.speaker === "agent";
        const isLast = i === entries.length - 1;
        return (
          <li
            key={i}
            ref={isLast ? endRef : undefined}
            className="group flex flex-col gap-1"
          >
            {/* …existing label / text / timecode unchanged… */}
          </li>
        );
      })}
    </ol>
  );
}
```

**Invariant check:** Composite depends only on `cn` + React — no services, stores, or TanStack Query. `behavior: "smooth"` + jsdom: tests must stub `scrollIntoView` (`Element.prototype.scrollIntoView = vi.fn()`), since jsdom does not implement it. The bounded `max-height`/`overflow` is supplied by the container's wrapper, keeping the composite layout-agnostic and reusable.

---

### Step 4 — Component: SessionEndModal (non-dismissable, 2 variants)

**File:** `apps/web/src/components/SessionEndModal.tsx` (CREATE)

**Render type:** Client Component

**What:** A prop-driven, non-dismissable modal built on the existing `Dialog` primitive. One `variant` selects copy for completed / blocked (`interrupted` is NOT a modal — it keeps DESIGN §7's connection-loss banner + amber low-glow orb). No action button (none required); not closable by Esc, overlay-click, or a close button.

**Code:**
```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@repo/ui/primitives/dialog";

export type SessionEndVariant = "completed" | "blocked";

const COPY: Record<SessionEndVariant, { title: string; description: string }> = {
  completed: {
    title: "Interview complete",
    description:
      "Thank you — your interview has finished. You can close this tab; there is nothing more to do.",
  },
  blocked: {
    title: "This interview is no longer available",
    description:
      "This interview is already in progress in another session, or has already finished. You can close this tab.",
  },
};

export function SessionEndModal({ variant }: { variant: SessionEndVariant }) {
  const copy = COPY[variant];
  return (
    <Dialog open>
      <DialogContent
        // Non-dismissable: suppress every close affordance. No DialogClose
        // is rendered, and Radix's auto-focus-to-close is moot without one.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        // Radix logs an a11y warning if Content has no describedby; Description
        // below satisfies it. Title is required for the same reason.
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
```

**Invariant check:** Web-app-specific copy → lives in `apps/web/src/components/` (not `packages/ui`). Imports only a UI primitive via the package path map (`@repo/ui/primitives/dialog`). No services / stores / TanStack Query. Semantic tokens come from the primitive (`bg-popover`, `text-popover-foreground`, `text-muted-foreground`). Presentational only — the container owns the decision of which variant (if any) to render.

**Design fidelity (docs/DESIGN.md):** neutral `--popover` tokens are correct for BOTH variants — a clean completion and an informational block are not failure states, so no amber/`--destructive`/`--negative`. Copy is calm and composed: no exclamation marks, no error iconography, no mascot (§9). Confirm the `Dialog` primitive styles `DialogTitle` in **Instrument Serif** (§3 heading font) and uses `--radius-md` (§4) with 220ms-enter / 160ms-exit motion that honours `prefers-reduced-motion` (§6); if the primitive's defaults differ, raise it at the primitive layer, not here.

---

### Step 5 — Hook: 409 → blocked + `enabled` gate

**File:** `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts` (MODIFY)

**Render type:** Client hook

**What:** (a) Accept an `enabled` flag; when `false` (terminal view status), skip the entire effect so no competing `startCandidateSession` fires. (b) On `!result.ok`, branch: a 409 (`SERVER` + status 409) sets `connectionState: "blocked"` with NO toast; every other error keeps the existing `"error"` + toast path. Keep the effect-driven model — no TanStack Query.

**Code:**
```typescript
interface UseInterviewSessionArgs {
  interviewId: string;
  token: string;
  enabled: boolean;
}

function isAlreadyActiveConflict(error: ServiceError): boolean {
  return error.kind === "SERVER" && error.status === 409;
  // Optionally tighten with: && error.code === "SESSION_ALREADY_ACTIVE"
}

export function useInterviewSession({
  interviewId,
  token,
  enabled,
}: UseInterviewSessionArgs): void {
  // ...existing store selectors...

  useEffect(() => {
    if (!enabled) return; // terminal view → never attempt a session

    let cancelled = false;
    let conversation: Awaited<
      ReturnType<typeof Conversation.startSession>
    > | null = null;

    setConnectionState("connecting");

    void (async () => {
      const result = await startCandidateSession({ interviewId, token });
      if (cancelled) return;
      if (!result.ok) {
        if (isAlreadyActiveConflict(result.error)) {
          // ADR-035: interview already bound + IN_PROGRESS. Do NOT start a
          // competing session and do NOT fire the generic error toast.
          setConnectionState("blocked");
          return;
        }
        setConnectionState("error");
        toast.error(friendlyServiceError(result.error.kind));
        return;
      }

      // ...unchanged Conversation.startSession(...) block...
    })();

    return () => {
      cancelled = true;
      void conversation?.endSession().catch(() => {});
      resetStore();
    };
  }, [interviewId, token, enabled, setConnectionState, setSpeaker, appendTranscript, resetStore]);
}
```

Add `import type { ServiceError } from "@/services/errors";` at the top.

**Invariant check:** The hook is the orchestration unit; it still does not use `useQuery`/`useMutation` (the voice pipeline is intentionally effect-driven — preserved). Services remain the only `fetch()` boundary. The StrictMode `cancelled` closure guard is untouched. `enabled` is added to the dependency array.

---

### Step 6 — Container: layout restructure + modal + terminal gate

**File:** `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx` (MODIFY)

**Render type:** Client Component

**What:** (a) Compute a terminal gate from `view.status` via `isTerminalStatus`; pass `enabled={!terminal}` to the hook. (b) Restructure `<main>` from `min-h-screen justify-center` page-flow into a fixed-height flex column: a `shrink-0` orb section and a `flex-1 min-h-0 overflow-y-auto` bounded transcript section. (c) Derive a `SessionEndVariant | null` (`completed` / `blocked` only) from terminal status + `connectionState` and render `<SessionEndModal>`; `interrupted` renders NO modal — it keeps `ConnectionLossBanner state="failed"` + an amber low-glow orb (DESIGN §7). (d) Update `deriveOrb` so `interrupted` returns `{ state: "idle", tone: "warning" }` (amber low-glow), distinct from `completed`/`blocked` which stay `{ idle, default }`.

**Code:**
```typescript
"use client";

import { isTerminalStatus } from "@/types";
import { SessionEndModal, type SessionEndVariant } from "@/components/SessionEndModal";
// ...existing imports...

function deriveEndModal(
  terminal: boolean,
  connectionState: ConnectionState,
): SessionEndVariant | null {
  if (terminal || connectionState === "blocked") return "blocked";
  if (connectionState === "completed") return "completed";
  // interrupted is NOT a modal — it uses the connection-loss banner + amber
  // low-glow orb (DESIGN §7). Return null so no modal renders.
  return null;
}

// DESIGN §7: a failed/interrupted connection settles the orb into a static
// amber low-glow (--attention-warning), never neutral. completed/blocked are
// clean-terminal and stay neutral. speakerToOrbState is unchanged.
function deriveOrb(
  connectionState: ConnectionState,
  speaker: SpeakerState,
): { state: OrbState; tone: OrbTone } {
  if (connectionState === "interrupted") return { state: "idle", tone: "warning" };
  if (connectionState === "completed" || connectionState === "blocked") {
    return { state: "idle", tone: "default" };
  }
  if (connectionState === "reconnecting") {
    return { state: speakerToOrbState(speaker), tone: "warning" };
  }
  return { state: speakerToOrbState(speaker), tone: "default" };
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

  const terminal = isTerminalStatus(view.status);
  useInterviewSession({ interviewId: view.interviewId, token, enabled: !terminal });

  const bannerState = deriveBanner(connectionState);
  const { state: orbState, tone: orbTone } = deriveOrb(connectionState, speaker);
  const endVariant = deriveEndModal(terminal, connectionState);

  return (
    <main className="relative flex h-dvh flex-col bg-background">
      {bannerState && <ConnectionLossBanner state={bannerState} />}

      {/* Orb stays pinned and visible; never scrolls out of view. */}
      <section className="flex shrink-0 items-center justify-center pt-16 pb-8">
        <VoicePresence state={orbState} tone={orbTone} />
      </section>

      {/* Transcript owns the only scroll region; bounded by flex-1 + min-h-0. */}
      {transcriptVisible && transcript.length > 0 && (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-12">
          <TranscriptFeed entries={transcript} />
        </section>
      )}

      {endVariant && <SessionEndModal variant={endVariant} />}
    </main>
  );
}
```

**Invariant check:** Container is the first `"use client"` and the orchestration point — it owns the terminal/blocked → modal mapping (no business logic in the modal). `h-dvh` + `min-h-0` + `overflow-y-auto` confine scrolling to the transcript while the orb section is `shrink-0`. Semantic tokens only (`bg-background`). No raw color scales. Page (`page.tsx`) stays a Server Component — no change needed there since the gate is cheap and view-status-based; the container already receives `view`.

---

## Pseudo-workflow

### A. Normal completion (change 1)
1. Candidate finishes; ElevenLabs `onDisconnect({ reason: "agent" | "user" })` fires in `useInterviewSession`.
2. Hook sets `connectionState: "completed"`.
3. Container `deriveEndModal` → `"completed"`; orb goes idle (`deriveOrb`).
4. `<SessionEndModal variant="completed">` renders — non-dismissable, no action button.

### B. Interrupted — DESIGN §7 connection-loss treatment (NOT a modal)
1. `onDisconnect({ reason: "error" })` → `connectionState: "interrupted"`.
2. `deriveBanner` → `"failed"` banner (muted-amber `--attention-warning`); `deriveOrb` → `{ idle, warning }` (amber low-glow); `deriveEndModal` → `null`.
3. The `ConnectionLossBanner state="failed"` + low-glow orb render — no modal, no "close this tab". Recovery framing stays undramatic (DESIGN §7/§9).

### C. Reload / already-active 409 (change 4)
1. Candidate reloads the session tab while the interview is bound + IN_PROGRESS.
2. Hook effect runs → `startCandidateSession` → backend returns **409** `SESSION_ALREADY_ACTIVE`.
3. `_request` maps it to `Err(SERVER{status:409, code:"SESSION_ALREADY_ACTIVE"})`.
4. Hook `isAlreadyActiveConflict` → `connectionState: "blocked"`, NO toast.
5. `deriveEndModal` → `"blocked"`; `<SessionEndModal variant="blocked">` renders.

### D. Already-terminal view (change 4, pre-emptive gate)
1. Page loads; `view.status` is COMPLETED / EVALUATED / FAILED.
2. Container `terminal = isTerminalStatus(view.status)` is `true` → `enabled={false}`.
3. Hook effect early-returns; `startCandidateSession` is NEVER called (no competing session).
4. `deriveEndModal(terminal=true, …)` → `"blocked"`; modal renders immediately.

### E. Transcript growth (changes 2 + 3)
1. `onMessage` → `appendTranscript` grows `transcript`.
2. `TranscriptFeed` `useEffect([entries.length])` → `scrollIntoView` on the last `<li>`.
3. Only the `flex-1 min-h-0 overflow-y-auto` transcript section scrolls; the orb section (`shrink-0`) stays fixed.

## Entry points

| #   | File                                                                          | Layer       | Operation | Purpose                                            |
| --- | ----------------------------------------------------------------------------- | ----------- | --------- | -------------------------------------------------- |
| 1   | `apps/web/src/types/interview-status.types.ts`                                | Types       | MODIFY    | Add `FAILED`; include in terminal set              |
| 2   | `apps/web/src/stores/useInterviewSessionStore.ts`                             | Stores      | MODIFY    | Add `"blocked"` to `ConnectionState`               |
| 3   | `packages/ui/src/composites/transcript-feed/transcript-feed.tsx`              | Composites  | MODIFY    | Autoscroll-to-latest; bounded-scroll friendly      |
| 4   | `apps/web/src/components/SessionEndModal.tsx`                                  | Components  | CREATE    | Non-dismissable modal, 2 variants (completed, blocked) |
| 5   | `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.ts`    | Containers  | MODIFY    | 409→blocked; `enabled` gate                        |
| 6   | `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.tsx` | Containers | MODIFY  | Layout restructure; terminal gate; modal wiring    |

## Tests (Rule 6)

| Test file | Type | Assertions |
| --- | --- | --- |
| `apps/web/src/containers/InterviewSessionContainer/useInterviewSession.test.ts` (MODIFY) | container hook | NEW: `vi.mock('@/services/candidate.service')` returns `Err(SERVER{status:409, code:"SESSION_ALREADY_ACTIVE"})` → store `connectionState === "blocked"` and `toast.error` NOT called. NEW: `enabled:false` → `startCandidateSession` never invoked. Keep existing happy-path tests. |
| `apps/web/src/components/SessionEndModal.test.tsx` (CREATE) | component | Renders for each `variant` (`completed`, `blocked`); correct title/description copy present; Esc keydown does NOT remove the dialog (preventDefault); no close button in the tree (`queryByRole("button", { name: /close/i })` is null). |
| `apps/web/src/containers/InterviewSessionContainer/InterviewSessionContainer.test.tsx` (CREATE) | container render | `connectionState="interrupted"` → renders `ConnectionLossBanner` (failed), orb `tone="warning"`, and NO `SessionEndModal`. `connectionState="completed"` → `SessionEndModal` (completed), no banner. Terminal `view.status="FAILED"` → blocked modal renders AND `useInterviewSession` is gated (mock the hook / service: `startCandidateSession` never called). |
| `packages/ui/src/composites/transcript-feed/transcript-feed.test.tsx` (MODIFY) | composite | Stub `Element.prototype.scrollIntoView = vi.fn()`. Appending an entry (rerender with +1 entry) calls `scrollIntoView`. Last `<li>` carries the ref. Bounded-scroll: when given a `className` with overflow, the class lands on the `<ol>` (className passthrough). |
| `apps/web/src/stores/useInterviewSessionStore.test.ts` (MODIFY if present, else covered by hook test) | store | `setConnectionState("blocked")` updates state; `reset()` returns to `"idle"`. |

Co-located `.test.{ts,tsx}`; fresh state per test (`useInterviewSessionStore.setState(initial, true)` in `beforeEach`); `vi.mock('@/services/...')` for the hook; `vi.mock('sonner')` to assert toast (non-)calls.

## Verification commands

Run after all edits, in order:

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui   # eslint --max-warnings 0
pnpm turbo run test --filter=web
pnpm turbo run test --filter=@repo/ui
# Manual UI sanity: pnpm --filter web dev → open a candidate session link,
#   reload mid-interview (expect blocked modal, no toast), let it complete
#   (expect completed modal), watch transcript autoscroll with orb pinned.
```

## Risk notes

- **jsdom `scrollIntoView` is unimplemented** — the TranscriptFeed test MUST stub `Element.prototype.scrollIntoView` or it throws. `behavior: "smooth"` is fine in jsdom once stubbed.
- **`h-dvh` vs mobile browser chrome** — `h-dvh` (dynamic viewport) is intended; if a `dvh` regression appears on older targets, fall back to `h-screen`. Do not reintroduce `min-h-screen` (it reinstates page-flow scrolling and the orb leaves the viewport).
- **Radix Dialog a11y warnings** — `DialogContent` without a `DialogTitle`/`DialogDescription` logs a console warning that can fail strict test setups; the modal includes both, so keep them.
- **409 detection coupling** — matching on `status === 409` alone is robust; also matching `code === "SESSION_ALREADY_ACTIVE"` is stricter but couples the UI to the backend code string. Plan matches status; tighten only if other 409s become possible on this endpoint.
- **`reset()` on unmount clears `connectionState` to `"idle"`** — the blocked/completed modal is driven from live store state, so it correctly disappears on navigation away; ensure no test asserts the modal persists after unmount.
- **Terminal gate vs the existing `/done` flow** — this plan does NOT redirect to `/done` (per the explicit modal requirement). `PostInterviewContainer` on `/done` still polls independently; the two surfaces are not coupled. No double-start risk because `enabled={false}` blocks the session effect on terminal status.
- **Env drift** — no new `NEXT_PUBLIC_*` introduced; `_request` already reads `env.NEXT_PUBLIC_API_URL`. Nothing to add.
- **StrictMode double-mount** — unchanged; the `cancelled` closure guard still holds. Adding `enabled` to the dep array is safe because it is a stable boolean derived from `view.status`.

### DESIGN.md alignment (docs/DESIGN.md "Quiet Signal")

- **`interrupted` is a banner, not a modal.** Reconciled per §7 ("Connection-loss states"): failed connections use `ConnectionLossBanner state="failed"` (muted-amber `--attention-warning`) + an orb low-glow (`deriveOrb` → `{ idle, warning }`), never a blocking modal and never `--destructive`/`--negative`. The modal is reserved for clean-terminal states (`completed`, `blocked`). This removes the previous double-treatment (banner + modal) and the contradicting "close this tab" copy on a failure.
- **DESIGN §7 failed-copy is partly stale under ADR-035 — flagged, not silently rewritten.** The canonical banner copy ("your progress is saved — try refreshing in a moment") assumed a refresh could resume the session; under ADR-035 a refresh now hits the 409 `blocked` state instead. This plan does NOT rewrite the canonical `ConnectionLossBanner` copy. **Follow-up (DESIGN amendment):** decide between a terminal framing ("the connection ended; your responses so far are saved") and keeping a refresh hint that now lands on the blocked modal. Treat as a DESIGN/ADR-025 change, not a build-time edit.
- **Modal type/motion fidelity.** Verify the `Dialog` primitive renders `DialogTitle` in Instrument Serif (§3), uses `--radius-md` (§4), and animates 220ms-enter / 160ms-exit honouring `prefers-reduced-motion` (§6). If defaults differ, fix at the primitive layer (`packages/ui/src/primitives/dialog/`), not in this composite.
- **`FAILED` on the landing & done screens (out of A1 scope — follow-up).** This plan gates only the *session* screen for `FAILED`. The candidate landing (`/c/[id]`) and post-interview (`/c/[id]/done`) screens also read interview status. Adding `FAILED` to the wire enum + terminal set means the `/done` poller (`PostInterviewContainer`) will correctly STOP on `FAILED` instead of polling forever — but neither screen has calm `FAILED` copy yet. **Follow-up:** give both a composed "this interview didn't complete" message so a `FAILED` interview is not blank/confusing there. Tone matches §9 (no error theater).
