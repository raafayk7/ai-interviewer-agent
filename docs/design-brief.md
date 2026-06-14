# Design Brief — Sift (working name)

> **Purpose.** This document is the input to your first `/ui-ux-pro-max` session. Fill in the blanks (`__`) and pick options where listed. Once complete, paste the whole thing into the skill with the prompt at the bottom. The skill's output becomes the basis for `docs/DESIGN.md` and the next ADR.
>
> **Rule.** Force a decision on every question, even if it feels arbitrary. "Both" or "depends" produces a design system that says nothing.

---

## 1. Product one-liner

Sift is an AI-powered voice screening interviewer. Recruiters upload a JD + candidate CV; Sift conducts a ~15 minute voice interview on their behalf and produces a structured screening report. It is the **filter** before the human interview — not a replacement for line-manager evaluation.

(Edit if framing has shifted.)

---

## 2. Audience snapshots

Two surfaces, two emotional states, one shared system.

### Recruiter surface — `(recruiter)` route group
- **Who:** in-house TA / agency recruiter, technical-screening fatigue, balancing volume with quality.
- **Where they live:** desktop, multi-tab, scanning fast.
- **What they feel:** trust me, save me time, don't make me read a wall of text.
- **What they need:** clear interview status, scannable reports, frictionless upload, fast comparison across candidates.

### Candidate surface — `(candidate)` route group
- **Who:** developer, mid-anxiety, may have never been interviewed by an AI before.
- **Where they live:** desktop or laptop, single tab, full focus.
- **What they feel:** is this serious? Am I being recorded? What if my mic fails? Will the AI be unfair?
- **What they need:** calm, legibility, confidence-building signals before the interview, dignity during.

---

## 3. Hard positioning decisions

Pick one option per row. These cascade into every visual choice.

| Question | Options | Pick |
|---|---|---|
| Personality center of gravity | (a) Clinical & precise · (b) Calm & humane · (c) Confident & modern · (d) Energetic & playful | **(c) Confident & modern** |
| Recruiter vs candidate visual relationship | (a) Identical system, only content differs · (b) Shared tokens, different density/composition · (c) Two distinct moods sharing only the primitive layer | **(b) Shared tokens; recruiter side comfortable + information-dense, candidate side leans spacious through composition** |
| AI personality on screen | (a) Faceless tool · (b) Named persona ("Hi, I'm Sam") · (c) Branded but unnamed presence | **(c) Branded but unnamed — Sift is the named entity, the interviewer is just Sift. Transcripts read "Sift:" / "Candidate:"** |
| Color temperature | (a) Cool (blues/greens) · (b) Warm (ambers/terracottas) · (c) Neutral (high-contrast achromatic) · (d) Dual (cool primary + warm AI-voice accent) | **(d) Dual — cool primary for trust/recruiter surfaces, warm AI-voice accent dedicated to voice-active / AI-speaking states** |
| Density | (a) Spacious (Linear/Vercel) · (b) Comfortable (default shadcn) · (c) Dense (Notion/Airtable) | **(b) Comfortable baseline; candidate side leans spacious through composition (fewer elements, more whitespace)** |
| Edges | (a) Sharp / 0–2px radius · (b) Moderate / 6–8px · (c) Soft / 12px+ · (d) Pill-leaning for interactive elements | **(d) Pill for interactive elements (buttons, badges, chips, status pills) + moderate 8–12px radius for containers (cards, modals, inputs, panels)** |
| Type voice | (a) System / utilitarian (Inter, Geist) · (b) Editorial (a serif for headings) · (c) Distinctive sans (Söhne, ABC Diatype-ish) | **(c) Distinctive sans — but using FREE alternatives (Switzer / Satoshi / Geist / Hanken Grotesk / Manrope) for headings, Inter for body. No licensed type.** |
| Motion philosophy | (a) Functional only (state changes) · (b) Reassuring (gentle breathing for the candidate side, functional for recruiter) · (c) Expressive (notable transitions everywhere) | **(b) Reassuring — functional on recruiter side, gentle breathing/pulsing on candidate side, one expressive moment (the AI-speaking orb)** |
| Dark mode priority | (a) Light is canonical, dark is a switch · (b) Dark is canonical, light is a switch · (c) System-respecting from day one with equal polish | **(b) Dark is canonical, light is a switch — dark-first polish, but always ship both for accessibility** |

---

## 4. Brand adjectives

Pick exactly **three** adjectives Sift should embody, and **three** it should never feel like. Forcing the exclusions is more useful than the inclusions.

- **Is:** Lucid, Composed, Discerning
- **Is not:** Corporate-HR, Gimmicky, Anxious

Notes on usage:
- *Lucid* governs the visual surface — clear hierarchy, transparent state, no decorative filler.
- *Composed* governs the feel — collected, never panicky or excited. Loaders don't flap, error states don't shout.
- *Discerning* captures the product's actual function — Sift makes judgments. The UI should feel like it has taste; favor curated, weighted presentation over information dumps.
- *Corporate-HR* is the biggest exclusion — kills the Workday/Greenhouse/Lever aesthetic and the stock-photo-of-diverse-team-laughing direction.
- *Gimmicky* rules out anthropomorphic AI tricks, mascot illustrations, sparkle icons, and confetti.
- *Anxious* rules out jittery micro-animations, flickering skeletons, aggressive notification badges. The candidate is already anxious; the UI cannot add to it.

---

## 5. Voice UI specifics

These don't exist in most design systems. Each decision below is explicit.

### Central thesis — the orb

Sift has a **persistent visual presence** on the candidate's screen: a soft glowing circle ("the orb") in the warm AI accent, positioned center stage. Not a face. Not initials. Not a logo. Just a presence — reference points: ChatGPT voice mode's orb but warmer, HAL 9000's dot but friendlier. Always on screen during the interview.

**The orb's motion communicates state.** One element, four behaviors. No new elements pop in for different states — the orb itself modulates.

| State | Orb behavior |
|---|---|
| Idle / listening (waiting for candidate) | Slow breathing pulse, ~3s cycle, low intensity |
| Candidate speaking | Slightly dimmer (deferential), maintains slow breathing |
| AI thinking (>800ms after candidate stops) | Faster breathing, ~1.2s cycle, slightly brighter |
| AI speaking (TTS playing) | Pulse amplitude tied to live TTS audio envelope — orb visibly "speaks" |
| Connection warning | Halo shifts to `--connection-warning` muted amber |

The orb is the single most identity-defining element in the product. It should ship as a `VoicePresence` composite in `packages/ui/src/composites/`.

### Audio level visualization (candidate is speaking)

- **Where:** Bottom center of the candidate's screen, candidate-attached (not orb-attached).
- **Metaphor:** Thin horizontal waveform line, 3–4px tall, low contrast. Modern and restrained — *not* chunky frequency-spectrum bars (too clinical) and *not* a featured ripple animation (draws too much attention to candidate's own voice and increases self-consciousness).
- **Color when active:** `--voice-active` token, cool primary side. This is the candidate's voice — cool. Warm is reserved exclusively for Sift. The two voices are differentiated by color temperature alone, which is the elegant payoff of the dual palette in section 3.
- **Role:** Silent reassurance ("you are being heard"), not a featured element. Composed.

### AI thinking state (between candidate stopping and TTS starting)

- **Threshold-gated:** Below 800ms, show *nothing* — that latency reads as a natural conversational pause. Above 800ms, the orb modulates as described above.
- **No three-dot typing animation.** That's chat-app coded and reads anxious. The orb breathing faster *is* the thinking state.
- **No "Sift is thinking…" copy.** The visual is sufficient. Copy at this level would be condescending.

### AI speaking state (TTS playing)

- Persistent orb pulses in time with TTS audio envelope; transcript (if toggled on) streams beneath the orb.
- The orb's pulse is the primary signal. The transcript is secondary.
- The orb's pulse amplitude follows audio energy — it visibly "speaks." This is the moment Sift feels alive without needing a face.

### Live transcript display

- **Visibility:** Optional toggle, **default off.** Off-by-default forces listening, reduces multi-modal cognitive load, and keeps the orb as the focal point. Accessibility-conscious candidates flip the toggle once.
- **Toggle placement:** Prominent in the pre-interview check (step 2 or 3), persist the candidate's choice across sessions.
- **Speaker attribution:** Both color-coded AND labeled. Labels: `**Sift** ·` (warm) and `**Candidate** ·` (cool). Color does visual scanning; labels do disambiguation and accessibility (color blindness, exports, screenshots).

### Connection loss / mid-call recovery (per ADR-017)

This is where "Composed" earns its keep. Bad design here panics the candidate; good design says "we've got this, hang tight."

- **First 2 seconds of dropout:** No visible change. Many micro-drops auto-resolve. Orb stays in its current motion state. No banner, no toast.
- **After ~10 seconds:**
  - Orb gains a `--connection-warning` halo (muted amber, never destructive red — red violates "Anxious").
  - Top banner appears: **"Reconnecting…"** with a subtle progress indicator.
  - Candidate's audio level indicator dims out — don't pretend audio is flowing when it isn't.
  - Banner sub-copy: *"Your interview is paused. Please stay on this page."* Calm, instructive, no apology theater.
- **After reconnect succeeds:**
  - Banner changes to **"Reconnected. Resuming…"** for 2–3 seconds, then fades.
  - Orb returns to normal breathing state.
  - **No celebratory checkmark, no confetti, no "✓ You're back!"** — the recovery is deliberately undramatic because drama makes nervous candidates more nervous.

The copy on these states is part of the design — it should be canonical, not reinvented at build time. Captured in DESIGN.md as official copy patterns.

### Pre-interview check

- **Tone:** Reassuring & step-by-step. Four steps, each on its own card with a clear step indicator:
  1. **Mic test** — live level meter, "say something to test your microphone."
  2. **Audio test** — play a short sample of Sift's voice. *Letting the candidate hear Sift before the interview starts is psychologically huge — first contact is on a low-stakes screen, not mid-question.*
  3. **Quiet-space advisory** — non-blocking, just guidance.
  4. **Ready-to-begin confirmation** — clear primary action.
- **Visual model:** Zoom/Meet *grammar* (live preview, big primary action, step progression) applied through Sift's visual language (composed, lucid, dark-first, orb visible in the corner as a small static presence — "Sift is here, ready when you are"). Do not clone Zoom — too utilitarian for the distinctive type voice and orb-centric identity.
- **Rule out:** "Quick & cheerful" tone (violates Composed and Gimmicky exclusions). Medical/intake form aesthetic (drifts toward Bureaucratic / Corporate-HR).

---

## 6. References

Each reference below is paired with the specific decision it backs up — so the skill knows *why* the reference is here, not just that we like it.

### Live-near (six)

| Reference | What it backs up |
|---|---|
| **Linear** | Dark canonical mode, comfortable density, lucid hierarchy, reassuring (not expressive) motion. Gold standard for "Confident & Modern" applied to a serious tool. |
| **Granola** | AI-as-presence-without-persona, distinctive type voice, dual palette execution. Closest existing product to Sift's feel — an AI product that presents confidently without being gimmicky. |
| **Cursor** | Dark-first canonical, AI-product gravity, composed treatment of AI states. Premium-modern AI tool. |
| **Raycast** | Comfortable-leaning-dense recruiter dashboard direction, distinctive sans, editorial discipline ("every element earned its place"). |
| **Arc Browser** | Dual color temperature decision, motion philosophy, identity confidence. Reference for *how to execute* a dual palette without it feeling like two glued products. |
| **ChatGPT Voice Mode** | The orb. Canonical reference for "AI as a visual presence." Sift's orb should be warmer, smaller-feeling-but-central, with more restrained motion. |

### Avoid (three)

| Reference | What it rules out ("is not") |
|---|---|
| **HireVue** (or any AI video-interview platform) | Corporate-HR. Most important exclusion — it's the lazy default for "AI interview product." Clinical, cold, generic. |
| **Calendly / Typeform** | Gimmicky + Saccharine. Optimistic-SaaS, pastel gradients, mascot illustrations, confetti-on-submit. Rules out the "let's make this friendly!" trap. |
| **Character.ai / Replika** | Gimmicky. Anthropomorphic AI products with avatars and named personas. Anti-reference to section 3 question 3 (Sift is named, the AI inside is not). |

---

## 7. Constraints we already locked in

(For the skill's awareness — don't re-decide these.)

- Stack: Tailwind v4 + shadcn/ui primitives + Radix + CVA (ADR-023).
- Tokens are semantic only — `bg-primary`, `text-muted-foreground`, etc. Raw color scales are forbidden by `frontend-arch-validator`.
- Tokens live in `apps/web/app/globals.css` under `@theme inline`.
- Two route groups: `(recruiter)` and `(candidate)`.
- React Hook Form + Zod 4 for all forms (ADR-024).
- Forms, dashboards, file uploads, real-time WebSocket voice UI, and report viewer are all in scope.

---

## 8. What we want out of the session

This is the prompt to give `/ui-ux-pro-max` after filling in the brief above.

> I'm starting the design system for a product called Sift — an AI voice screening interviewer for recruiters and candidates. Above is the full design brief with positioning decisions filled in. Using these inputs, produce:
>
> 1. **A named visual concept** in one paragraph — the central design idea, expressed as if explaining it to a teammate.
> 2. **Color palette** as semantic tokens (matching shadcn's structure: `background`, `foreground`, `primary`, `primary-foreground`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`). Use `oklch()` values for both light and dark modes. Add any extra semantic tokens this product needs — at minimum cover `voice-active`, `voice-listening`, `ai-thinking`, `transcript-candidate`, `transcript-ai`, `connection-warning`. Justify the choice of primary hue in one sentence.
> 3. **Typography pairing** — heading family + body family + monospace. State weights used and the type scale (sizes for `h1`–`h6`, body, small, caption).
> 4. **Spacing and radius scales** — confirm or extend the defaults, with a rationale.
> 5. **Motion principles** — 3–5 sentences. Durations (in ms) for micro / standard / page-level transitions. Easing curve choice.
> 6. **Voice UI element decisions** — concrete visual treatment for the audio level indicator, the AI thinking state, the AI speaking state, the live transcript, and connection-loss states. One short paragraph per element.
> 7. **Two "moodboard descriptions"** — one for the recruiter dashboard, one for the candidate interview screen. Plain prose, no code, describing what someone walking past the screen should notice in the first half-second.
> 8. **One paragraph on what this design system intentionally rejects** — the alternative we considered and walked away from, and why.
> 9. **Three illustrative HTML mockups** — *visual references only, not shippable code*. Use only the semantic tokens you defined in step 2 (no raw Tailwind color classes, no hex literals). Each mockup is a single self-contained HTML file. Required mockups:
>     - (a) **Candidate interview screen** — orb center-stage in AI-speaking state, optional transcript streaming beneath, candidate audio level indicator bottom-center, dark canonical.
>     - (b) **Recruiter dashboard** — list of interviews with statuses, top-level navigation, comfortable density, empty/loading state acknowledged.
>     - (c) **Pre-interview check (step 2 — audio test)** — small orb in corner, step indicator, primary action button, calm spacious composition.
>
> Format the response so I can paste sections 1–8 directly into `docs/DESIGN.md` and save the three HTML files as `docs/design-refs/candidate-interview.html`, `docs/design-refs/recruiter-dashboard.html`, `docs/design-refs/pre-interview-check.html`. Don't generate logos, illustrations, marketing copy, or production component code — visual identity decisions and the three illustrative HTMLs only.

---

## 9. After the session

1. Save the skill's output into `docs/DESIGN.md`.
2. Write a new ADR (ADR-025 — Design Language & Visual System) capturing the *decisions* and *rejected alternatives*.
3. Translate the palette and tokens into `apps/web/app/globals.css`.
4. Start building primitives with `/frontend-primitive-layer`, one at a time, against the new tokens.
5. Logos, illustrations, marketing site — defer until after primitives ship.
