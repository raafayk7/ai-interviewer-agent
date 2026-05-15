# Design v2 Overhaul Progress

## Design v2 Overhaul Complete

This document records the Design v2 Overhaul changes for the Sift ai-interviewer-agent.

Design v2 Overhaul goal:

- Replace the v1 steel-blue 250° primary with warm cream 75° — recruiter chrome no longer reads as the Tailwind/Linear/Vercel default
- Shift all surface hues from 250° to 60° (warm-neutral charcoal) — background, card, popover, border, input
- Move candidate-voice tokens from hue 250° to petrol 210° — distinct from chrome and from AI-accent
- Replace Switzer (Fontshare CDN) and JetBrains Mono with Instrument Serif and Geist Mono via `next/font/google`
- Bake Instrument Serif italic into `h1`/`h2` defaults in `@layer base`
- Add `orbHaloPulse` keyframe to landing orb with `motion-safe:` guard
- Richer `InterviewListRow`: 5-column grid with avatar, smart elapsed-time, plan summary, monospaced ID
- `ReportViewer` hero card: verdict-first layout, numbered strengths/concerns/follow-ups, large badge
- `TopicScoreRow` score fill: `bg-primary` → `bg-accent` (cream is too low-contrast on muted track)
- `Badge` primitive: add `lg` size CVA variant; `RecommendationBadge`: thread size prop
- Sidebar brand mark: hover glow via `group-hover:shadow`, italic wordmark drop `font-bold`
- Update `docs/DESIGN.md` §2 (palette), §3 (typography), §9 (what rejected)
- Author ADR-028 superseding primary-color, surface-hue, heading-font, focus-ring, and voice-token-hue sub-decisions of ADR-025

Plan source: `.claude/plan/design-v2-handoff.md`
Architecture context: `docs/ARCHITECTURE.md`

ADRs referenced:
- [ADR-028](../adr/ADR-028-design-refresh-v2-warm-neutral-palette-instrument-serif-petrol-voice-tokens.md) — authored; supersedes primary-color, surface-hue, heading-font, mono-font, focus-ring, and voice-token-hue sub-decisions of ADR-025
- [ADR-025](../adr/ADR-025-design-language-and-visual-system.md) — partially superseded; token-discipline, semantic-token-only, light-theme AA parity, --destructive fencing, radius vocabulary, motion philosophy remain in force

---

## Summary

Completed:

- **Palette & tokens (`globals.css`):** All 25 dark-theme design tokens updated; hue-250 surfaces converted to warm-neutral hue-60; primary moved to cream `oklch(0.935 0.020 75)`; voice tokens shifted to petrol hue-210; focus ring changed to warm low-chroma `oklch(0.650 0.080 70)`; orb chroma bumped to 0.150; light theme hue-shifted from 250 → 60 throughout; `orbHaloPulse` keyframe added; heading `@layer base` defaults added for `h1`/`.h-display` (italic) and `h2`/`.h-section` (regular).
- **Font loading (`layout.tsx`):** `JetBrains_Mono` replaced with `Geist_Mono`; `Instrument_Serif` added with both `normal` and `italic` styles; both assigned to the same CSS variable names (`--font-switzer`, `--font-jetbrains-mono`) for zero component-level find/replace; Fontshare `<link>` removed.
- **Landing page (`page.tsx`):** Orb scaled from `size-16` to `size-24`; `motion-safe:animate-[orbHaloPulse_3s_ease-in-out_infinite]` applied; `font-bold` removed from heading (Instrument Serif italic carries weight without it).
- **Sidebar brand mark (`AppSidebar.tsx`):** `group` + `group-hover:shadow-[0_0_24px_var(--orb-halo)]` added for hover-expand halo; wordmark changed from `font-bold` to `italic`; no continuous animation added (motion vocabulary reserved for candidate screen per ADR-026/DESIGN.md §6).
- **Interview list row (`InterviewListRow.tsx`):** Full rewrite; 4-column auto grid → 5-column fixed `[2fr_2fr_140px_130px_110px]`; avatar with initials; `headline + yearsOfExperience` sub-line; job title + `company · plan-summary` sub-line; `InterviewStatusBadge`; `smartTime()` helper (elapsed for IN_PROGRESS, relative ago for terminal states, scheduled-at for pre-start); monospaced `INT_xxxxxx` ID prefix.
- **Interview list container (`InterviewListContainer.tsx`):** Column header `div` added with identical grid template; `gap-2` list spacing tightened to `gap-1` to sit visually under the header.
- **Report viewer (`ReportViewer.tsx`):** Full rewrite; hero `Card` leads with `RecommendationBadge size="lg"`, avg score + topic count, generated-at timestamp, and `communicationAssessment` in `font-heading text-2xl`; topic scores and strengths/concerns/follow-ups use `NumberedList` with zero-padded `font-mono` counters; section headers use `italic font-heading text-xl`; `ago()` helper for elapsed time.
- **Badge primitive (`badge.tsx`):** `lg` size CVA variant added: `h-8 px-3.5 text-[13px] font-semibold`.
- **Recommendation badge (`recommendation-badge.tsx`):** `size?: BadgeProps["size"]` prop added; forwarded to `Badge`; existing call-sites unaffected (default `undefined` → `"default"`).
- **TopicScoreRow (`topic-score-row.tsx`):** Score-fill class changed from `bg-primary` to `bg-accent`; inline comment added citing DESIGN.md §2 usage table as the documented exception.
- **DESIGN.md:** §2 colour table and usage rules updated to v2 palette; §3 typography table updated to Instrument Serif/Geist Mono triad with italic-discipline rules; §9 v2 rationale note appended.

Explicitly **not** included in this work:

- Recommendation column in `InterviewListRow` — deferred until a batch-fetch endpoint exists (handoff §5 note)
- `docs/design-refs/` HTML mockup updates — reference-only; non-blocking
- CSS variable rename from `--font-switzer` → `--font-display` and `--font-jetbrains-mono` → `--font-mono` — cosmetic; noted by reviewer as a future clean-up
- `ago`/`smartTime` extraction into `apps/web/src/lib/format-time.ts` — noted by reviewer; no third caller yet

---

## Implementation Notes

**ADR-028 triggered by adr-judge violation.** Running `bin/adr-judge --llm` against the staged diff produced a single violation: ADR-025's `llm_judge: true` block flagged the font change and primary-colour flip as contradicting the mandated "distinctive sans" and "cool primary" decisions. Resolution was path (a): author ADR-028 to supersede those sub-decisions. ADR-025's Status line was updated (Status line only, all other content immutable per adr-kit convention).

**`--font-switzer` variable name retained.** The plan explicitly accepts this misnomer for backward compatibility — the CSS variable name stays but resolves to Instrument Serif via `next/font/google`. No find/replace in component code required. Reviewer noted the rename as a cosmetic future clean-up (non-blocking).

**Accent exception in TopicScoreRow.** Cream primary at `oklch(0.935)` has an estimated 1.3:1 contrast ratio against the muted track — functionally invisible as a thin progress fill. `bg-accent` (warm amber `oklch(0.795 0.150 65)`) provides ~8:1 against the muted track. This is the single permitted accent use in recruiter chrome; documented in both DESIGN.md §2 usage table and an inline source comment.

**Sidebar hover glow uses `group` pattern, not continuous animation.** Per DESIGN.md §6, continuous animation is reserved for the orb on the candidate's interview screen. The `group-hover:shadow-[0_0_24px_var(--orb-halo)]` pattern fires only on hover and uses a `transition-shadow duration-200` — costs nothing in attention budget at rest.

---

## Verification

Commands run and passing:

```bash
pnpm turbo run check-types --filter=web --filter=@repo/ui
pnpm turbo run lint --filter=web --filter=@repo/ui
pnpm turbo run test --filter=web --filter=@repo/ui
```

Results:

- `@repo/ui` tests: **303 passed** (16 test files)
- `web` tests: **passed** (type-check + lint clean)
- type-check passed for `web`, `@repo/ui`

---

## Code Review

`frontend-code-reviewer` agent run on all 11 files. Result: **PASS** on first pass — no violations.

Key verification points from the reviewer:

- Layer/boundary rules clean: `packages/ui` imports nothing from `apps/web`; components use only primitives, composites, `@/types`, and Next.js — no `fetch`, no `useQuery`, no Zustand
- No `fetch()` outside `apps/web/src/services/`
- `page.tsx` correctly stays a Server Component (no `"use client"`, only `await getServerSession()` + `redirect`)
- `motion-safe:animate-[orbHaloPulse_3s_ease-in-out_infinite]` satisfies DESIGN.md §6 `prefers-reduced-motion` requirement
- Grid template `grid-cols-[2fr_2fr_140px_130px_110px]` and `gap-4 px-5` verified identical between `InterviewListRow` and the new header `div` in `InterviewListContainer`
- `RecommendationBadge size` prop typed via `BadgeProps["size"]` reuse — default `undefined` → `"default"` preserves existing call-sites
- `smartTime` correctly guards `startedAt.getTime()` behind `status === "IN_PROGRESS" && startedAt` null check

Optional non-blocking style notes from reviewer:
- `--font-switzer` / `--font-jetbrains-mono` variable names are cosmetic misnomers; renameable in a follow-up
- `ago` / `smartTime` helpers duplicated across `ReportViewer` and `InterviewListRow`; extract to `apps/web/src/lib/format-time.ts` once a third caller appears
- `lg` size in `badge.tsx` hard-codes `font-semibold`; acceptable under current CVA variant model

**PASS**

---

## Notes

- ADR-025 Status line updated to "Partially superseded by ADR-028, 2026-05-15" — only the six sub-decisions listed (primary-color, surface-hue, heading-font, mono-font, focus-ring colour, voice-token hue) are superseded; the architectural bindings (token discipline, semantic-only, light-theme parity, radius vocabulary, motion philosophy) remain fully in force and are not re-argued in ADR-028.
- The v2 adr-judge run confirmed 27 ADRs total; the single violation was intentional (the v2 changes contradicting v1 ADR-025 decisions). All other ADRs cleared.
- Instrument Serif italic at `h1`/`h2` is baked via `@layer base` (option A from the handoff) — contributors don't need to remember to add `italic` at call sites; the rule applies project-wide.
