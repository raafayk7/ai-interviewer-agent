# ADR-028 Design Refresh v2: Warm-Neutral Palette, Instrument Serif Typography, Petrol Voice Tokens

## Status

Accepted. Date: 2026-05-15.

Supersedes the primary-color, surface-hue, heading-font, mono-font, focus-ring color, and voice-token-hue sub-decisions of ADR-025. ADR-025's token-discipline, semantic-token-only, and light-theme-parity requirements remain fully in force.

## Context

ADR-025 codified the v1 Sift design language ("Quiet Signal"): a steel-blue primary at oklch(0.680 0.150 250) for recruiter chrome, Switzer (Fontshare) as the distinctive sans heading font, JetBrains Mono for data surfaces, and `--accent` (warm amber) restricted exclusively to VoicePresence and AI-moment surfaces.

After shipping the recruiter dashboard (Phase 8), three problems surfaced during design review:

**Brand dilution.** The v1 steel-blue primary at hue 250 deg is the de-facto palette of every AI-product MVP in the current market (Gemini, Linear, Vercel). The Quiet Signal brand thesis describes "one warm point of light against composed neutrals" — a single amber orb as the product's identity. The v1 palette gave the recruiter chrome the same hue as the competition, then asked the tiny orb to carry all the distinctiveness alone. The result: Sift reads as another generic-AI-blue product rather than a warm, composed one.

**Fontshare CDN dependency.** Switzer is served from `fonts.fontshare.com`, a third-party CDN. This introduces an HTTP round-trip that blocks text rendering until the font response arrives or the browser falls back to the system stack. Instrument Serif is available via `next/font/google`, which inlines the font CSS, serves the font from the same origin, and bakes in `font-display: swap` with zero configuration. The result is faster FCP (First Contentful Paint) and no external dependency for heading text.

**Voice token ambiguity.** Candidate-voice display tokens were at hue 250 deg (the same primary hue), making the live voice state visually indistinguishable from a standard button focus ring. A candidate reading the transcript line for their own speech saw the same color as a focused form control. Petrol (hue approximately 210 deg) separates candidate-voice from both recruiter chrome and the amber AI-accent.

**TopicScoreRow contrast failure.** The score fill on the progress bar in TopicScoreRow used `bg-primary`. With the v1 cream value oklch(0.935 0.020 75) — or with any very-light primary — the contrast ratio against the muted track is approximately 1.3:1, making the bar visually invisible at low scores. The score fill communicates calibrated rubric data and is a functional failure, not a style preference.

These four problems share a common root: the v1 token values optimized for "distinctive warm accent" but left the rest of the chrome and typographic stack as off-the-shelf defaults. The refresh concentrates identity in the amber orb by making everything else genuinely warm-neutral rather than cool-neutral-adjacent.

## Decision

Replace the v1 design token set with warm-neutral values that concentrate all product identity in the amber orb. The following seven changes are concrete, binding commitments:

**1. Primary: warm cream.** Move `--primary` from steel-blue oklch(0.680 0.150 250) to warm cream oklch(0.935 0.020 75). Primary buttons, primary-colored surfaces, and any element that inherits `bg-primary` now read as warm-neutral, not generic-AI-blue. The recruiter chrome is no longer in the same hue family as Linear or Vercel.

**2. Surfaces: warm-neutral hue.** Shift `--background`, `--card`, `--popover`, `--border`, and `--input` from hue 250 deg to hue 60 deg (warm-neutral charcoal). The entire dark-mode surface stack reads warmer. No element in the surface layer retains a cool hue.

**3. Focus ring: warm low-chroma.** Replace the steel-blue focus ring with oklch(0.650 0.080 70). On-brand, clearly visible at 3:1 contrast, not generically tech-blue.

**4. Voice tokens: petrol hue.** Move candidate-voice tokens (`--voice-active`, `--voice-listening`, `--transcript-candidate`) from hue 250 deg to petrol 210 deg. Petrol sits between cool (recruiter chrome, hue 60 warm-neutral) and warm (AI accent, hue 65) on the perceptual wheel. Candidate voice is now on a dedicated hue: it cannot be confused with a focus ring or an AI-moment surface.

**5. Typography: Instrument Serif and Geist Mono.** Replace Switzer (Fontshare) with Instrument Serif (Google Fonts) loaded via `next/font/google`. Replace JetBrains Mono (Google Fonts) with Geist Mono (Google Fonts / Vercel), also via `next/font/google`. Instrument Serif italic is used at display, h1, and h2 sizes; it is the load-bearing carrier of Sift's editorial voice. Geist Mono replaces JetBrains Mono for data surfaces, timecodes, and code. Both fonts share the same loading path as Inter (body) and eliminate the Fontshare CDN dependency entirely. Italic discipline rules (when Instrument Serif italic applies vs. roman) are codified in `docs/DESIGN.md` section 3.

**6. TopicScoreRow score fill: accent exception.** The score progress bar in `TopicScoreRow` uses `bg-accent` (warm amber oklch(0.795 0.150 65)) instead of `bg-primary` (cream). This is the single permitted use of `--accent` in recruiter chrome; every other `--accent` usage rule from ADR-025 remains in force. This exception is documented in `docs/DESIGN.md` section 2 usage table with an enforcement comment. Removing this exception without updating the usage table is a violation.

**7. Accent chroma bump.** Increase `--accent` from oklch(0.775 0.130 65) to oklch(0.795 0.150 65) (+0.020 chroma). With the recruiter chrome now at warm-neutral cream, the orb needs a small chroma increase to maintain its visual authority as the single bold-color element in the product. The orb is now the only element with meaningful chroma in recruiter chrome views.

This ADR does not change: the dual warm/cool palette discipline, the `--accent`-for-AI-presence rule (with the single exception noted in item 6), the `--destructive` fencing rule, the three outcome-semantic tokens, the radius vocabulary, the motion philosophy, the density scale, the token-layer implementation mechanism (oklch CSS variables under `@theme inline`), or the ADR-023 component system substrate.

## Alternatives Considered

### Alternative A: Desaturate steel-blue primary to near-neutral

Keep hue 250 deg, reduce chroma to approximately 0.04. The chrome would be subtler but retain the cool family.

Rejected. Near-neutral cool still reads as a cool-blue product at a distance and does not escape the "looks like Linear" problem. More critically, the candidate-voice tokens still share the chrome hue family, maintaining the ambiguity between voice state and focus ring. The only way to cleanly separate candidate voice from chrome is to move one of them to a different hue; reducing chroma does not accomplish this. Desaturation is a surface treatment; the brand problem is structural.

### Alternative B: Switch primary to deep teal at hue approximately 190 deg

Teal is more distinctive than hue 250 deg (less common among AI-product peers) and still reads as a "precision instrument" product.

Rejected. Teal is still cool-cast chrome, which conflicts with the brand logic in ADR-025: cool hues are the candidate-voice register, warm hues are the AI-presence register. Placing the recruiter chrome at a cool teal hue and the candidate voice at petrol 210 deg puts two cool-family hues in the same product context. It also does not solve the Fontshare CDN dependency or the TopicScoreRow contrast failure. The warm-neutral direction solves all four problems simultaneously.

### Alternative C: Go full Geist Sans heading, drop serif entirely

Replace Switzer with Geist Sans for headings. Geist Sans is already available via `next/font/google`, zero editorial risk, immediately coherent with the Geist Mono mono stack.

Rejected. Geist Sans is ubiquitous in AI product UIs (it is Vercel's own design-system typeface and appears in numerous v0-generated products). Adopting it would make Sift typographically identical to a large swath of the current AI-product market. Instrument Serif italic is uncommon in this category, costs nothing to acquire, and gives the product a voice that the body Inter and mono Geist stacks cannot. The editorial distinctiveness is the reason to take the serif-sans mixing decision; it is not a risk to be avoided.

### Alternative D: Keep Switzer, self-host the font file

Remove the Fontshare CDN dependency by bundling the Switzer WOFF2 files in the repository and serving them from the Next.js static asset path.

Rejected on two counts. First, it adds build-step complexity: font files must be versioned, the `@font-face` declarations must be hand-maintained, and `font-display: swap` must be explicitly configured. `next/font/google` handles all of this automatically for Instrument Serif. Second, Instrument Serif produces a better brand outcome than Switzer for the reasons in Alternative C. Self-hosting Switzer solves only the CDN dependency; the refresh solves the CDN dependency and achieves a better typographic result.

### Alternative E: Keep bg-primary on TopicScoreRow score fill

Retain the v1 cream primary on the progress bar and accept that low scores produce a low-contrast bar.

Rejected. A contrast ratio of approximately 1.3:1 between the cream fill and the muted track is functionally invisible. TopicScoreRow communicates calibrated rubric scores from ADR-015; a score of 15% that renders as an invisible sliver is a data-display failure. This is not a style preference. Using `bg-accent` (the warm amber at the new oklch(0.795 0.150 65)) produces adequate contrast and aligns with the accent's semantic meaning: it is the AI-sourced moment in recruiter chrome. Rubric scores are AI-generated and this exception is coherent with the intent of the accent token.

## Consequences

**Benefits**

- The recruiter dashboard is visually distinct from every AI-product peer that uses cool-blue primary. The product identity is now carried by the orb, not diluted across the entire chrome.
- Candidate-voice tokens (petrol, hue 210 deg) and recruiter chrome (warm neutral, hue 60 deg) are on separate hues. Composite hover and focus states no longer share a hue family with candidate transcript lines.
- Instrument Serif italic at display and h1/h2 sizes gives Sift a distinctive editorial identity unavailable in the Inter/Geist/sans-only segment of AI products.
- The Fontshare CDN dependency is eliminated. All font loading goes through `next/font/google`, which inlines CSS, serves fonts from the Next.js origin, and handles `font-display: swap` automatically. FCP (First Contentful Paint) no longer waits on a third-party font response.
- Token discipline from ADR-025 (semantic tokens only, no raw hex, no raw Tailwind color-scale classes) means zero component code changes for the primary flip. Only `apps/web/app/globals.css` changes for items 1-4 and 7. Component JSX is untouched.
- TopicScoreRow score fill is legible at all rubric values above approximately 5%.
- The orb's chroma bump (+0.020) maintains its visual authority as the sole bold-color element now that the chrome is warm-neutral rather than steel-blue.

**Trade-offs**

- Existing screenshots, design-reference HTML mockups (`docs/design-refs/`), and any recorded demos show v1 steel-blue. These need to be regenerated against the new token values.
- Instrument Serif italic at h1/h2 introduces an ongoing serif-sans mixing decision. Contributors must follow the italic discipline rules in `docs/DESIGN.md` section 3 consistently. Incorrect use (body text in Instrument Serif, headings in roman where italic was intended) degrades the editorial effect.
- The TopicScoreRow accent exception requires an enforcement comment in the component file to survive future cleanup that might strip it as a "wrong token." The comment and the `docs/DESIGN.md` section 2 usage-table entry are the guards.
- Light-theme testing is more complex for the new primary. Cream (oklch 0.935) inverts to near-black (oklch approximately 0.250) for the dark-to-light inversion. Testers must verify both surface states explicitly. The ADR-025 requirement that all token pairs pass WCAG AA in both themes remains in force.

**Risks and mitigations**

- *Risk*: A future engineer notices the TopicScoreRow exception and "fixes" it to `bg-primary` during a cleanup pass, restoring the invisible score bar. *Mitigation*: an enforcement comment in `TopicScoreRow` referencing this ADR and the `docs/DESIGN.md` usage table, plus the `llm_judge: true` Enforcement block below, which flags removal of the exception.
- *Risk*: Instrument Serif italic leaks into body text, UI labels, or button copy, making the product feel inconsistent. *Mitigation*: italic discipline is codified in `docs/DESIGN.md` section 3 with explicit allowed surfaces (display, h1, h2) and forbidden surfaces (body, UI text, data, buttons). The `llm_judge: true` flag covers this.
- *Risk*: A future contributor re-introduces a cool-cast hue (hue 200-270) into the recruiter surface layer, re-diluting the orb's warmth monopoly. *Mitigation*: the `llm_judge: true` Enforcement block below covers palette drift that regex patterns cannot express reliably (oklch values in CSS variables).
- *Risk*: The petrol voice tokens (hue 210) drift back toward hue 250 in a future patch, restoring the ambiguity with focus rings. *Mitigation*: same `llm_judge` gate; the voice token hue range is named explicitly in the LLM judge prompt context.
- *Risk*: Light-mode contrast failures go undetected on the cream primary inversion. *Mitigation*: the ADR-025 requirement for WCAG AA parity in light mode is unchanged; any PR touching `globals.css` token values must include light-mode contrast verification.

## Related Decisions

- **ADR-025 (Design Language and Visual System — "Quiet Signal")**: this ADR supersedes the primary-color, surface-hue, heading-font, mono-font, focus-ring color, and voice-token-hue sub-decisions. All other ADR-025 bindings remain in force: token-discipline (no raw hex, no raw Tailwind color-scale classes), semantic-token-only components, light-theme WCAG AA parity, the `--destructive` fencing rule, the three outcome-semantic tokens, the radius vocabulary, the motion philosophy, and the density scale.
- **ADR-026 (Voice Presence Pattern: The Orb)**: the accent chroma bump (item 7) directly affects `--orb-core` and `--orb-halo`. ADR-026's state-machine, amplitude-coupling spec, and reduced-motion collapse behavior are unchanged. The orb's visual authority is the reason for item 7.
- **ADR-027 (Candidate Device Support)**: the motion-safe guard on `orbHaloPulse` animation required by ADR-027 section 6 motion principles remains in force. This ADR adds no new motion elements.
- **ADR-015 (Phase 6 Evaluation: Span Schema, Explicit Invocation, Hardcoded Rubric)**: the three outcome-semantic tokens (`--positive`, `--attention-warning`, `--negative`) are bound to `Report.overallRecommendation: "advance" | "hold" | "reject"` from ADR-015. This ADR does not change those tokens or that binding.
- **ADR-023 (Adopt shadcn/ui + Radix + Tailwind v4 for Frontend Component System)**: the token mechanism (oklch CSS variables under `@theme inline` in `apps/web/app/globals.css`) is unchanged. This ADR updates only the values occupying that mechanism.

## References

- `apps/web/app/globals.css`: the file that changes. Items 1-4 and 7 are CSS variable value changes under `@theme inline`; item 6 is a `bg-accent` class change in a single component; item 5 is a `next/font/google` import change.
- `apps/web/src/containers/TopicScoreRow/` (or equivalent component path): the single permitted `bg-accent` exception in recruiter chrome; requires an enforcement comment referencing ADR-028.
- `docs/DESIGN.md` section 2: usage table for `--accent`; must be updated to reflect the TopicScoreRow exception.
- `docs/DESIGN.md` section 3: typography scale and italic discipline rules for Instrument Serif vs. Inter.
- `docs/design-refs/recruiter-dashboard.html`, `docs/design-refs/candidate-interview.html`, `docs/design-refs/pre-interview-check.html`: design-reference mockups that require regeneration against v2 token values.
- Google Fonts — Instrument Serif: https://fonts.google.com/specimen/Instrument+Serif
- Google Fonts — Geist Mono: https://fonts.google.com/specimen/Geist+Mono
- Next.js `next/font/google` documentation: https://nextjs.org/docs/app/building-your-application/optimizing/fonts — `font-display: swap` and origin-serving behavior.
- WCAG 2.1 Success Criterion 1.4.3 (Contrast Minimum, Level AA): the standard that the approximately 1.3:1 contrast ratio of cream-on-muted-track fails; minimum for non-text decorative elements is 3:1 under SC 1.4.11 (Non-text Contrast).
- ADR-025 (full text): `docs/adr/ADR-025-design-language-and-visual-system.md`
- ADR-026 (full text): `docs/adr/ADR-026-voice-presence-pattern-the-orb.md`
- ADR-027 (full text): `docs/adr/ADR-027-candidate-device-support.md`

## Enforcement

The palette, font, and token-assignment changes in this ADR cannot be reliably expressed as regex patterns. The critical violations are semantic — a cool hue appearing in a surface variable, a voice token reverting to hue 250, Instrument Serif italic applied to body text, or the TopicScoreRow exception being removed — and they manifest as oklch coordinate values or CSS class names that are indistinguishable by regex from valid use in other contexts. `llm_judge: true` is the appropriate gate.

```json
{
  "forbid_pattern": [],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

The `llm_judge: true` gate instructs the pre-commit judge to evaluate any staged diff in `apps/web/app/globals.css`, `apps/web/src/`, and `packages/ui/src/` against the following rules drawn from this ADR's Decision section:

1. `--primary` must remain in the warm family (hue approximately 60-90 deg in oklch). Any reintroduction of a cool-hue primary (hue 200-270) is a violation.
2. Surface variables (`--background`, `--card`, `--popover`, `--border`, `--input`) must remain in the warm-neutral hue family (hue 40-100 deg). Cool-cast surface values (hue 200-270) are a violation.
3. Voice tokens (`--voice-active`, `--voice-listening`, `--transcript-candidate`) must remain in the petrol family (hue approximately 200-220 deg). Reversion to hue 250 is a violation.
4. Instrument Serif (or the `instrumentSerif` next/font variable) must not appear in body text, UI label, button, or data-surface className attributes. It is permitted only at display, h1, and h2 heading sizes.
5. `bg-accent` in recruiter-chrome files (outside `TopicScoreRow` and `VoicePresence`/orb composites) is a violation unless accompanied by a comment citing ADR-028.
6. Removal of the `bg-accent` class from `TopicScoreRow` score-fill without a superseding ADR is a violation.
7. Any reintroduction of `fonts.fontshare.com` as a font source (import URL or `@font-face` `src`) is a violation.
