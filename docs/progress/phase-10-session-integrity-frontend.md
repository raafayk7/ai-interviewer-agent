# Phase 10 Session Integrity Frontend Progress

## Phase 10 Session Integrity Frontend Complete

This document records the Phase 10 Session Integrity Frontend changes for ai-interviewer-agent.

Phase 10 Session Integrity Frontend goal:

- Show a non-dismissable end-of-interview modal for clean completion and already-unavailable sessions
- Keep interrupted sessions aligned with `docs/DESIGN.md` connection-loss treatment: amber banner plus low-glow orb, not a blocking modal
- Autoscroll transcript output to the latest turn while keeping the orb visible
- Constrain scrolling to the transcript region instead of the full candidate stage
- Recognize backend Phase 10 session integrity states: 409 `SESSION_ALREADY_ACTIVE` and terminal `FAILED`

Plan source: `.claude/plan/phase-10-session-integrity-frontend.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-035](../adr/ADR-035-elevenlabs-session-integrity-idempotent-binding-best-transcript-wins-reconciliation-failed-state.md) - backend session integrity contract, 409 active-session guard, and `FAILED` terminal status
- [ADR-025](../adr/ADR-025-design-language-and-visual-system.md) - semantic token discipline and Quiet Signal visual constraints
- [ADR-026](../adr/ADR-026-voice-presence-pattern-the-orb.md) - orb behavior and warning tone boundaries

---

## Summary

Completed:

- **Candidate session state machine:** Added `"blocked"` to `ConnectionState`, added an `enabled` gate to `useInterviewSession`, mapped 409 server conflicts to blocked without a toast, and skipped `startCandidateSession` entirely for terminal interview views.
- **Candidate session UI:** Restructured `InterviewSessionContainer` into a fixed-height stage with a pinned orb section and transcript-only scroll region. Added modal derivation for `completed` and `blocked`, while preserving the DESIGN connection-loss banner for `interrupted`.
- **Session modal composite:** Added `SessionEndModal` in `apps/web/src/components/`, built from the existing Dialog primitive, with completed and blocked variants and no close action, Escape dismissal, or outside-click dismissal.
- **Transcript feed:** Added latest-entry autoscroll through a last-item ref and `entries.length` effect, plus tests for `scrollIntoView` and className passthrough.
- **FAILED wire/status support:** Added `FAILED` to the frontend Zod status schema and terminal set. Extended the shared `InterviewStatusBadge`, recruiter list timing, and recruiter detail copy so the new backend terminal status renders coherently.
- **Tests:** Added/updated container, hook, store, modal, transcript feed, and status badge tests covering the new state mapping and rendering behavior.

Explicitly **not** included in this work:

- Backend ADR-035 implementation; it was completed separately in `docs/progress/phase-10-session-integrity-backend.md`
- ~~Rewriting the canonical `ConnectionLossBanner` failed-copy even though the plan flags it as stale under ADR-035~~ — **done in the 2026-06-13 follow-up (see Post-review follow-ups below).**
- Redirecting terminal candidate sessions to `/done`; the session surface now renders the requested modal in place
- Mobile/tablet support or changes to the candidate soft-block behavior
- Live smoke testing against real ElevenLabs sessions

The implementation also updated recruiter-facing `FAILED` display surfaces because making the frontend wire schema truthful exposed the missing status badge contract during type-check.

---

## Implementation Notes

The hook remains effect-driven. No TanStack Query was introduced into `useInterviewSession`; services remain the only frontend fetch boundary.

`SessionEndModal` is app-specific copy, so it lives in `apps/web/src/components/` instead of `packages/ui`. The reusable Dialog primitive already provided the required semantic surface and motion foundation; non-dismissability is enforced by the consumer through controlled `open` plus prevented outside/Escape events.

The transcript feed owns the autoscroll behavior, while the session container owns the bounded scroll geometry. This keeps `TranscriptFeed` reusable and lets the candidate session maintain the orb as the stable visual anchor required by `docs/DESIGN.md`.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web
pnpm turbo run test --filter=@repo/ui
```

Results:

- web tests: **277 passed** across 19 files
- ui tests: **363 passed** across 20 files
- type-check passed for `web` and `@repo/ui`
- lint passed for `web` and `@repo/ui`

Focused checks also passed during implementation:

```bash
pnpm --filter web test -- src/containers/InterviewSessionContainer/useInterviewSession.test.ts src/containers/InterviewSessionContainer/InterviewSessionContainer.test.tsx src/components/SessionEndModal.test.tsx src/stores/useInterviewSessionStore.test.ts
pnpm --filter @repo/ui test -- transcript-feed interview-status-badge
```

Results:

- focused web tests: **50 passed** across 4 files
- focused ui tests: **34 passed** across 2 files

Architecture checks:

- `frontend-arch-validator` manual pass over touched files: **CLEAN**
- No `fetch()` calls outside services in touched files
- No TanStack Query hooks in touched app components or UI composites
- No `@repo/domain` or `@repo/application` imports in touched frontend files
- No raw Tailwind color-scale classes in touched files
- `InterviewSessionContainer` still satisfies the three-file container pattern
- No `"use client"`, `useState`, or `useEffect` drift in `apps/web/app/**/{page,layout}.tsx`

---

## Code Review

Implementation was split across two subagents plus local integration:

- Transcript feed worker owned `packages/ui/src/composites/transcript-feed/*` and reported focused UI tests, UI type-check, UI lint, and boundary scan passing.
- Session modal worker owned `apps/web/src/components/SessionEndModal.*` and reported focused modal tests plus scoped eslint passing.
- Local integration owned the status schema, store, session hook, session container, recruiter status display ripple, and cross-package verification.

Integration review found one required follow-up after the first type-check: `FAILED` had been added to the frontend wire status schema, but `InterviewStatusBadge` still accepted only the previous six statuses. Fixed by extending the badge value union, label map, variant map, badge tests, recruiter list timing, and recruiter detail copy.

Second-pass verification after that fix:
- web tests: **277 passed**
- ui tests: **363 passed**
- `web` + `@repo/ui` type-check: **passed**
- `web` + `@repo/ui` lint: **passed**
- frontend architecture boundary scan: **CLEAN**

**PASS**.

---

## Notes

Full package tests still emit existing non-failing warnings from older tests: a React `act(...)` warning in `PostInterviewContainer` polling coverage and Radix Dialog accessibility warnings in primitive tests that intentionally render bare `DialogContent`. They did not affect the Phase 10 frontend assertions.

The Phase 10 plan's DESIGN follow-up (the stale `ConnectionLossBanner` "try refreshing" copy) was resolved in the 2026-06-13 follow-up below. The remaining deferral is **resume-on-refresh** itself (next version): a page refresh cannot resume an in-progress ElevenLabs conversation — ADR-035 makes refresh safe (409) but not resumable, pending whether ElevenLabs supports rejoining a conversation by id.

---

## Post-review follow-ups (2026-06-13)

Work completed after the initial implementation above, driven by the formal `frontend-code-reviewer` gate (run with an explicit DESIGN.md audit) and a copy-reconciliation pass.

### `frontend-code-reviewer` gate — DESIGN audit catch
The mandated reviewer caught one blocking token-discipline violation the in-session review missed: the new `FAILED` status badge mapped to the `negative` variant, but DESIGN §2 reserves `--negative` for "reject" recommendation pills + validation — `FAILED` is an interview *state*, not an outcome. Fixed: `FAILED → "attention-warning"` (amber "needs attention," consistent with the candidate-side failure treatment) and the sibling `CANCELLED → "secondary"` (quiet muted state). `--negative` is now correctly unused in the interview-status pill set. Re-review: **PASS**.

### Terminal-honest connection-loss copy + DESIGN §7 amendment
`ConnectionLossBanner state="failed"` previously said "Your progress is saved — try refreshing in a moment." Under ADR-035 a refresh no longer resumes (it hits the 409 block; a new conversation is an amnesiac agent), so the copy was misleading. Changed to terminal-honest — title "Your interview connection ended." / sub "Your responses so far are saved — you can close this tab." `docs/DESIGN.md` §7 amended in lockstep (dated `(ADR-035 amendment, 2026-06-13)`) with the rationale and the resume-on-refresh deferral. Banner test updated (+ a "does not invite a refresh" assertion).

### Candidate `FAILED` copy on landing + done
- Landing (`useCandidateLanding`): `FAILED → "This interview didn't complete. Please reach out to the recruiter who invited you."` (was falling through to "isn't ready yet").
- Done (`PostInterviewContainer`): a `FAILED` interview shows "We couldn't complete your interview." instead of "Thanks, you're done." (the `/done` poller already stops on `FAILED`).
- Tests: landing `FAILED` case; new `PostInterviewContainer.test.tsx` (FAILED vs COMPLETED render).

### Verification (follow-ups)
`check-types` (web + @repo/ui) clean; `lint --max-warnings 0` clean; `@repo/ui` **364 passed**; web **281 passed**.

### Still deferred → next version
**Resume-on-refresh.** A page refresh ends the interview from the candidate's side (the SDK session lives in the page; we only `startSession` a new conversation; ADR-035 returns 409 on the bound session). Gated on an open question: does ElevenLabs' browser SDK support rejoining a conversation by id with agent context intact? Transient drops *without* a reload still resume (the SDK owns transport reconnect).
