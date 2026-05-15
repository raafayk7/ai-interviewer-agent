# Sift — Design Language & Visual System

> Generated from `docs/design-brief.md` via the `/ui-ux-pro-max` session.
> Sections 1–9 are the design system. The three illustrative HTML mockups live in `docs/design-refs/`.

---

## 1. Named visual concept — **"Quiet Signal"**

Sift's visual identity is **Quiet Signal**: a dark, composed instrument that listens more than it speaks, and when it does speak, it speaks with one warm point of light. The recruiter side is a calm operations console — comfortable density, semantic color used sparingly, every element earning its place — built so a recruiter can scan twelve candidates in two minutes without their eyes burning. The candidate side is the same system rearranged into a quiet stage: most of the surface fades to charcoal so a single warm orb — the only warm thing in the entire product — can hold the room. Cool is the product; warm is Sift's voice. The two never share a region. That single-color discipline is what lets the orb feel like a presence instead of a graphic, and it's what keeps the recruiter dashboard from ever feeling like an HR portal. The product looks like Linear had a long conversation with Granola about voice, in a dimly-lit room.

---

## 2. Color palette — semantic tokens

All values in `oklch()`. **v2 refresh (ADR-028):** primary moves from steel-blue 250° to warm cream 75°. Surfaces shift to warm-neutral charcoal at hue 60°. Cool blue is now restricted to candidate-voice tokens only. The accent (orb) remains at 65° but with a slight chroma bump — now the single boldest colour in the product.

### Dark (canonical)

```css
:root {
  /* Surfaces — warm-neutral charcoal (hue 60°, was 250°) */
  --background:                   oklch(0.155 0.005 60);
  --foreground:                   oklch(0.965 0.004 60);
  --card:                         oklch(0.195 0.005 60);
  --card-foreground:              oklch(0.965 0.004 60);
  --popover:                      oklch(0.215 0.005 60);
  --popover-foreground:           oklch(0.965 0.004 60);

  /* Primary — warm cream (was steel blue 250°) */
  --primary:                      oklch(0.935 0.020 75);
  --primary-foreground:           oklch(0.180 0.008 60);

  /* Secondary */
  --secondary:                    oklch(0.285 0.008 60);
  --secondary-foreground:         oklch(0.940 0.005 60);

  /* Muted */
  --muted:                        oklch(0.265 0.005 60);
  --muted-foreground:             oklch(0.700 0.008 60);

  /* Accent — the orb; slight chroma bump in v2 */
  --accent:                       oklch(0.795 0.150 65);
  --accent-foreground:            oklch(0.180 0.020 65);

  /* Recommendation / outcome semantics — tied to ADR-015 rubric */
  --positive:                     oklch(0.730 0.080 155);   /* "advance" */
  --positive-foreground:          oklch(0.180 0.020 155);
  --attention-warning:            oklch(0.770 0.095 70);    /* "hold", connection-loss */
  --attention-warning-foreground: oklch(0.180 0.020 70);
  --negative:                     oklch(0.620 0.110 25);    /* "reject" — NOT destructive saturation */
  --negative-foreground:          oklch(0.985 0.005 25);

  /* Destructive — irreversible actions only (ADR-025 fenced usage) */
  --destructive:                  oklch(0.605 0.220 25);
  --destructive-foreground:       oklch(0.985 0.005 25);

  /* Borders / inputs / focus ring — focus ring now warm (was 250°) */
  --border:                       oklch(0.285 0.005 60);
  --input:                        oklch(0.225 0.005 60);
  --ring:                         oklch(0.650 0.080 70);

  /* Voice / AI semantic tokens — candidate voice shifts to petrol 210° */
  --voice-active:                 oklch(0.700 0.110 210);   /* candidate speaking — petrol */
  --voice-listening:              oklch(0.540 0.070 210);
  --ai-thinking:                  oklch(0.720 0.110 65);
  --transcript-candidate:         oklch(0.770 0.080 210);
  --transcript-ai:                oklch(0.830 0.110 65);

  /* Orb halo — used only inside the VoicePresence composite (ADR-026) */
  --orb-core:                     oklch(0.880 0.150 65);
  --orb-halo:                     oklch(0.700 0.190 65 / 0.50);
}
```

### Light (always shipped)

```css
:root[data-theme="light"] {
  --background:                   oklch(0.992 0.003 60);
  --foreground:                   oklch(0.220 0.008 60);
  --card:                         oklch(1 0 0);
  --card-foreground:              oklch(0.220 0.008 60);
  --popover:                      oklch(1 0 0);
  --popover-foreground:           oklch(0.220 0.008 60);

  --primary:                      oklch(0.250 0.010 60);
  --primary-foreground:           oklch(0.985 0.005 60);

  --secondary:                    oklch(0.945 0.005 60);
  --secondary-foreground:         oklch(0.260 0.008 60);

  --muted:                        oklch(0.960 0.003 60);
  --muted-foreground:             oklch(0.470 0.008 60);

  --accent:                       oklch(0.685 0.140 65);
  --accent-foreground:            oklch(0.985 0.005 65);

  --positive:                     oklch(0.560 0.135 165);
  --positive-foreground:          oklch(0.985 0.005 165);
  --attention-warning:            oklch(0.650 0.100 75);
  --attention-warning-foreground: oklch(0.985 0.005 75);
  --negative:                     oklch(0.520 0.155 25);
  --negative-foreground:          oklch(0.985 0.005 25);

  --destructive:                  oklch(0.555 0.225 25);
  --destructive-foreground:       oklch(0.985 0.005 25);

  --border:                       oklch(0.915 0.003 60);
  --input:                        oklch(0.945 0.003 60);
  --ring:                         oklch(0.500 0.080 70);

  --voice-active:                 oklch(0.510 0.155 210);
  --voice-listening:              oklch(0.620 0.080 210);
  --ai-thinking:                  oklch(0.610 0.120 65);
  --transcript-candidate:         oklch(0.380 0.090 210);
  --transcript-ai:                oklch(0.450 0.140 65);

  --orb-core:                     oklch(0.770 0.150 65);
  --orb-halo:                     oklch(0.685 0.190 65 / 0.45);
}
```

### Usage rules — non-negotiable

| Token | Allowed in | Forbidden in |
|---|---|---|
| `--accent`, `--orb-*`, `--ai-thinking`, `--transcript-ai` | `VoicePresence`, AI transcript bubbles, AI-speaking states, **TopicScoreRow score-fill** (documented exception) | Recruiter chrome elsewhere, success states, decorative gradients |
| `--voice-active`, `--transcript-candidate` | Candidate audio waveform, candidate transcript bubbles | Anywhere AI-related, recruiter chrome |
| `--primary` (cream) | Recruiter primary CTAs, focus rings (low-chroma cousin), key affordance backgrounds | Status indicators (use `--positive`/`--accent`), decorative fills, progress bars (contrast too low) |
| `--positive` | Report `overallRecommendation === "advance"` pills/chips, success confirmations | General "active" status (use IN_PROGRESS via `--accent`) |
| `--attention-warning` | Connection-loss banner & halo, `"hold"` pills, transcript-flagged markers | Form validation errors (use `--negative`), info banners |
| `--negative` | `"reject"` pills, form validation errors | Irreversible actions (use `--destructive`) |
| `--destructive` | Confirmation modals & their final destructive button only | Pills, validation, banners, charts, hover/focus, borders |

**On the existence of `--destructive`.** The brief explicitly excludes "Anxious" as a brand adjective, which rules out red as ambient or warning color. But the system still needs *one* color for confirming irreversible actions, and that color must be unmistakably stop-sign — anything softer fails the user when they're about to delete something they can't get back. `--destructive` therefore exists at saturated red and is permitted **only inside confirmation modals and the final destructive button itself**. It must never appear in lists, status pills, banners, charts, hover states, focus rings, or borders. The `--negative` token covers everything that semantically reads as "bad outcome" without being irreversible — that's where rejection pills, validation errors, and similar belong. Primitive authors should treat `--destructive` as a fenced-off emergency token; if you reach for it and you're not inside a `Confirm-irreversible-action` flow, you want `--negative` instead.

**Contrast verified at AA**: `--foreground` on `--background` = 15.1:1; `--primary-foreground` on `--primary` = 14.2:1 (cream button readability); `--accent` on `--card` = 8.2:1; `--positive` / `--attention-warning` / `--negative` all ≥ 4.5:1 against `--card`.

---

## 3. Typography pairing

**v2 refresh (ADR-028):** Switzer/JetBrains Mono replaced by Instrument Serif/Geist Mono.

| Role | Family | Source | Weights used |
|---|---|---|---|
| Display / heading | **Instrument Serif** | Google Fonts (free) | 400 regular + 400 italic |
| Body | **Inter** | Google Fonts (free) | 400, 500, 600 |
| Mono / data / transcript timecodes | **Geist Mono** | Google Fonts (free) | 400, 500 |

**Why this pairing.** Instrument Serif is what carries Sift's editorial voice — italic at display sizes ("the kind of document that explains itself, calmly") and regular at section sizes. It is uncommon enough not to read as a stock SaaS choice (it isn't Fraunces, isn't IBM Plex, isn't yet another grotesque) and pairs cleanly with Inter's neutral body type. Geist Mono replaces JetBrains Mono — same metric family, slightly more distinctive numerals, and pairs intentionally with the dark-product aesthetic the brand otherwise evokes. The serif/sans/mono triad gives Sift three distinct *voices* (editorial / utility / data) without any of them shouting.

**Type scale (16px root):**

| Token | Size | Line-height | Tracking | Weight | Family | Style |
|---|---|---|---|---|---|---|
| `display` | 72px / 4.5rem | 0.95 | -0.03em | 400 | Instrument Serif | italic |
| `h1` | 36px / 2.25rem | 1 | -0.02em | 400 | Instrument Serif | italic |
| `h2` | 28px / 1.75rem | 1.1 | -0.015em | 400 | Instrument Serif | italic |
| `h3` | 22px / 1.375rem | 1.2 | -0.01em | 400 | Instrument Serif | regular |
| `h4` | 18px / 1.125rem | 1.35 | -0.005em | 400 | Instrument Serif | regular |
| `h5` | 16px / 1rem | 1.4 | 0 | 600 | Inter | regular |
| `h6` | 14px / 0.875rem | 1.4 | 0.005em | 600 | Inter | regular |
| `body` | 16px / 1rem | 1.55 | 0 | 400 | Inter | regular |
| `body-lg` (hero lede) | 24px / 1.5rem | 1.4 | -0.005em | 400 | Instrument Serif | regular |
| `small` | 14px / 0.875rem | 1.5 | 0 | 400 | Inter | regular |
| `caption` (status pills, meta) | 12px / 0.75rem | 1.4 | 0.02em uppercase | 500 | Inter | regular |
| `mono` (timecodes, IDs, numerals) | 12–13px | 1.5 | 0.02em | 400/500 | Geist Mono | regular |

Tabular numerals (`font-variant-numeric: tabular-nums`) remain mandatory in counts, durations, and scores.

**Italic discipline.** Italic Instrument Serif is reserved for `display`, `h1`, and `h2`. Below that, the regular cut takes over — italic at small sizes reads ornamental, not editorial. The hero lede inside `ReportViewer` uses `body-lg` (large regular serif) — not italic — so the candidate's verdict reads as authored prose rather than a quote.

---

## 4. Spacing and radius scales

**Spacing — extended 4pt scale:** `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`. shadcn's defaults plus `2` (for hairline padding inside pill chips) and `20` / `40` / `80` (for the candidate-side spacious composition tier). Recruiter-side density uses `4 / 8 / 12 / 16` increments; candidate-side uses `16 / 24 / 32 / 48 / 80` — same scale, different rhythm, which is exactly what "shared tokens, different density" from section 3 of the brief means.

**Radius — three tiers, hard rule:**

| Token | Value | Used on |
|---|---|---|
| `--radius-pill` | `9999px` | Buttons, badges, status chips, segmented controls, the orb's clipping mask |
| `--radius-md` | `12px` | Cards, modals, panels, popovers, dropdowns |
| `--radius-sm` | `8px` | Inputs, textareas, code blocks, table cells with bg |
| `--radius-xs` | `4px` | Inline tags inside dense recruiter tables only |

No element gets a radius outside this set. The pill-vs-rounded-rect split is the single strongest visual signal of "this is interactive" vs "this is a surface" in the entire system — it has to stay clean.

---

## 5. Responsive strategy & device gates

**Decision: candidate flow is desktop-only at MVP. Recruiter dashboard is desktop-only by default.**

The candidate's interview is a real-time bidirectional voice session running on top of a long-lived WebSocket. iOS Safari's `getUserMedia()` has documented quirks that break audio capture in unpredictable ways; mobile WebSockets get killed when the user switches apps, locks the screen, takes a call, or when the browser backgrounds the tab under memory pressure. Any one of those events destroying a 10-minute interview is catastrophic for the product's core promise. ADR-017 and Phase 10 already carry meaningful resilience work on desktop alone — multiplying that by mobile lifecycle complexity is not on the MVP path. Beyond engineering, the *Composed* and *Discerning* adjectives want the candidate at a desk: a candidate joining from a phone in a coffee shop won't give Sift a fair signal regardless of whether the UI fits, so blocking phones is doing the candidate a favor, not gating them out.

### Candidate soft-block

Detection — viewport + pointer, never user-agent sniffing:

```css
@media (max-width: 767px), (pointer: coarse) {
  /* Render the SoftBlockScreen, not the interview UI */
}
```

The block is a full-screen card on `--background` with a small idle orb in the top-left, the heading **"Sift works best on a laptop or desktop."** in `h2`, body copy in `body-lg`, and the link recopied in `mono` so candidates can text it to themselves:

> **Sift works best on a laptop or desktop.**
> Open this link from a computer to begin your interview. We'll keep your scheduled session ready — nothing expires when you switch devices.
>
> *Why?* The interview is a live voice conversation, and laptops give the most reliable mic and connection. Phones can drop the call when you switch apps or the screen locks.

The "Why?" line is mandatory — composed products explain themselves, they don't just block. Tone matches the connection-loss copy (calm, no apology theater, no exclamation marks, no error iconography). This copy is canonical — captured here, not reinvented at build time. Lives as a `SoftBlockScreen` composite in `packages/ui/src/composites/`.

### Recruiter dashboard

Desktop-only at MVP — the dashboard is a wide table with a left rail, and squashing it into a phone viewport makes it unusable rather than degraded. Render the same `SoftBlockScreen` with adjusted copy ("Sift's recruiter workspace is desktop-only for now — open this link from a laptop"). Failure mode is far less catastrophic than the candidate side (recruiter can just open their laptop), so a future ADR can revisit a read-only mobile dashboard without blocking on it now.

### Breakpoints we *do* honor

The candidate interview screen scales fluidly between `1024px` and `1920px` — orb size (`140px → 220px`), transcript max-width (`560px → 720px`), and audio-level bar width (`280px → 360px`) interpolate. Below `1024px` (small laptops, tablets in landscape) the layout stays compositionally identical but tightens the spacing tier from candidate-side (`24 / 32 / 48 / 80`) toward recruiter-side (`16 / 24 / 32`). The recruiter dashboard targets `1280px+` as the design width; below `1280px` it stays usable but doesn't optimize.

---

## 6. Motion principles

**Five-sentence rule.** Motion in Sift exists to express cause and effect, never to entertain. Easing is `cubic-bezier(0.22, 0.61, 0.36, 1)` (a calm ease-out) for everything entering, and `cubic-bezier(0.55, 0.06, 0.68, 0.19)` (ease-in) for everything leaving — exits run at ~70% of enter duration so dismissals feel responsive. Durations: **micro** (focus, hover, color shift) `120ms`, **standard** (modal, dropdown, toast, accordion) `220ms` enter / `160ms` exit, **page-level** (route change, panel reveal, report load) `320ms`. The orb is the only element allowed to animate continuously: idle breathing is a `3s` sine on `transform: scale()` and `opacity`, thinking shifts to `1.2s`, and AI-speaking is amplitude-driven by the live TTS audio envelope (no synthetic loop). Everything respects `prefers-reduced-motion`: continuous animations collapse to a static low-glow state, and transitions become instant — the orb stays warm and present, just not moving.

---

## 7. Voice UI element decisions

### Audio level indicator (candidate is speaking)
A single horizontal bar, **3px tall**, **max-width 360px**, **8px from the bottom safe area**, centered. Color is `--voice-active` (cool primary) at `0.7` opacity; the active portion fills left-to-right based on a 50ms RMS window of the mic stream, with a `120ms` ease-out smoothing so it never twitches per-sample. When the mic is open but silent, it sits at 4% width and breathes between 0.3 and 0.5 opacity over 4s — alive but unintrusive. When connection drops, the indicator fades to 0 opacity over 400ms — we never pretend audio is flowing when it isn't.

### AI thinking state
**Threshold-gated at 800ms**, exactly per the brief. Below 800ms, no element changes — that latency reads as a normal conversational beat. At 800ms, the orb's breathing cycle accelerates from `3s` to `1.2s` and its core color shifts from `--orb-core` to `--ai-thinking` (slightly less saturated, signaling "processing, not yet speaking"). No three-dot indicator. No "Sift is thinking…" caption. No spinner. The orb modulating *is* the state; adding any other affordance breaks the "one element, four behaviors" thesis.

### AI speaking state
The orb's `transform: scale()` is driven by the **live TTS audio envelope** — RMS amplitude over a 30ms window mapped to a `0.96 → 1.06` scale range with `80ms` ease-out smoothing. Halo opacity follows the same envelope on a `0.35 → 0.65` range. Color returns to `--orb-core` (warmest of the warm). If the live transcript toggle is on, transcript lines stream beneath the orb at `body-lg` size, max-width `640px`, with each new word fading in over `120ms` — never typewriter-revealed (that reads chat-app coded), just word-by-word fade.

### Live transcript display
**Default off.** The `candidate-interview.html` reference renders the *transcript-on* variant for visual completeness — do not infer the default from the mockup. Toggle lives in the pre-interview check (step 4) and in a top-right gear menu during the interview; the candidate's choice persists across sessions. When on: lines are stacked, max-width `640px`, centered. Speaker attribution is **both color-coded and labeled**: `Sift ·` in `--transcript-ai` (warm), `Candidate ·` in `--transcript-candidate` (cool), labels rendered in `caption` style (`12px / 0.02em / uppercase / 500`). Body of the line is `body` size, `--foreground` color. Timecodes (`[02:14]`) appear in `mono` style, `--muted-foreground`, only on hover of a line — kept out of the resting visual but available for anyone trying to reference a moment.

### Connection-loss states
**Three-stage choreography, exactly per the brief:**
1. **0–2s of dropout:** zero visual change. The orb keeps its current motion. Most micro-drops auto-resolve.
2. **2–10s:** the orb's halo color crossfades to `--attention-warning` (muted amber, `400ms`). A top banner slides down `220ms` reading **"Reconnecting…"** in `body` weight 500, with a 2px progress nub that travels left-to-right on a 1.5s loop. Sub-copy in `small` `--muted-foreground`: *"Your interview is paused. Please stay on this page."* The candidate audio indicator fades to 0 over `400ms`.
3. **Reconnect succeeds:** banner copy crossfades to **"Reconnected. Resuming…"** for 2.5s, then the banner slides back up `160ms`. Orb halo crossfades back to `--orb-core` over `600ms`. **No checkmark, no toast, no "✓ You're back!"** — recovery is deliberately undramatic.

If reconnect fails after 60s, the banner becomes static, copy changes to *"We can't reach Sift right now. Your progress is saved — try refreshing in a moment."*, and the orb settles into a static low-glow until the page is refreshed. Even at the failure case, `--attention-warning` — never `--destructive`, never `--negative`.

---

## 8. Two moodboard descriptions

### Recruiter dashboard
What you notice in the first half-second is **calm horizontal rhythm**. A near-black canvas with a slim left rail, a wide central table, and one or two cool-blue chips livening the data without coloring the page. The eye lands on candidate names in Switzer 600, scan-friendly but not loud, with status pills (*Scheduled · In progress · Report ready*) sitting in pill-shaped containers tinted with low-chroma cool tones. A row's recommendation column carries a single-word verdict in a quietly-tinted pill — *Advance* in restful green, *Hold* in muted amber, *Reject* in muted red — never saturated, never shouting. Nothing pulses, nothing breathes, nothing slides in unprompted. It feels like a Linear board that knows what it's for. If a recruiter walked past the screen of someone using it, their first thought would be *"that's the kind of dashboard I trust."*

### Candidate interview screen
What you notice in the first half-second is **a single warm point of light in the middle of a dark room**. The screen is almost entirely charcoal, edge-to-edge, with a soft warm-amber orb centered in the upper third — slowly pulsing with a quality that reads as breathing rather than ticking. Below the orb, *if the candidate has opted into the transcript* (default off), a single line of text in two colors (cool for the candidate's last sentence, warm for Sift's reply). Across the bottom, a hairline-thin horizontal bar — barely there, just enough to confirm the mic is alive. There are no nav bars, no logos, no chrome competing for attention. If someone walked past the screen, their first thought would be *"someone's having a serious conversation,"* not *"someone's being interviewed by a bot."* That is the entire point of the design.

---

## 9. What this design system intentionally rejects

The most tempting alternative we considered and walked away from was **the warm, friendly "AI buddy" direction** — a peach-cream background, soft illustrations, a named persona ("Hi, I'm Sam — I'll be your interviewer today!"), encouragement microcopy, a smiling avatar where the orb sits, and a bright optimistic palette in the Calendly / Typeform tradition. It's the easy default for anything called "AI interview" because it tries to defuse the candidate's anxiety with cheerfulness. We rejected it because it fails on every brand adjective we set. *Composed* dies the moment a mascot smiles at a nervous candidate; *Discerning* dies when the UI is busy reassuring instead of judging; and *Lucid* dies under decorative illustration. More practically: candidates don't need a friend, they need a serious instrument that treats them with dignity — exactly the way a good human interviewer does. The dark canvas, the unnamed orb, and the muted-amber recovery state are not stylistic preferences; they are the visual proof that Sift takes the interview seriously, which is what makes the candidate feel taken seriously in return. Warmth is reserved for the one element that has earned it: Sift's voice.

**Note added in v2 refresh.** The v1 palette used steel-blue 250° as primary across the recruiter chrome — buttons, links, focus rings, "scheduled" pills, the sidebar mark. After shipping, this read as the de-facto Tailwind/Linear/Vercel default and made Sift look like every other AI-product MVP. The v2 refresh moves primary to warm cream (`oklch(0.935 0.020 75)`), restricts the cool blue to the candidate-side voice tokens (`--voice-active`, `--transcript-candidate`), and concentrates *all* product warmth into the orb's accent. The net effect: the recruiter dashboard now reads as bespoke neutrals + one warm point of light, which is what the original "Quiet Signal" thesis described but the v1 palette accidentally undermined. Primary-as-blue is no longer permitted — it is on the list of decisions explicitly rejected.
