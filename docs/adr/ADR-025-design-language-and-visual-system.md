# ADR-025 Design Language and Visual System ("Quiet Signal")

## Status

Accepted, 2026-05-14.

## Context

ADR-023 committed the frontend to shadcn/ui + Tailwind v4 + Radix + CVA. That decision settles *how* tokens, variants, and components are assembled. It leaves open *what* visual identity occupies the token layer — the hues, radius values, type families, motion durations, density rhythms, and semantic color rules that make Sift look and feel like Sift rather than a generic dashboard kit.

Two user surfaces coexist in `apps/web/` with fundamentally different emotional registers:

- **Recruiter.** Desktop, multi-tab, scanning fast under technical-screening fatigue. Every redundant pixel costs time. The UI must be clear and unobtrusive.
- **Candidate.** Focused, mid-anxiety, possibly encountering an AI interviewer for the first time. A fussy or clinical interface amplifies discomfort; a calm, spacious one signals control.

`docs/design-brief.md` captures the product-positioning decisions that force explicit choices here: personality, color temperature, density, radius vocabulary, type voice, motion philosophy, and dark-mode priority. The completed brief locks in the brand adjective triad **Lucid, Composed, Discerning** and three explicit exclusions — **Corporate-HR, Gimmicky, Anxious** — that are doing at least as much discriminating work as the inclusions. Corporate-HR rules out the Workday/Greenhouse/HireVue aesthetic and generic SaaS neutral palettes. Gimmicky rules out anthropomorphic AI tricks, confetti, and named-persona overlays. Anxious rules out red as ambient status color and jittery or purely decorative animation.

The brief drives a named concept, **Quiet Signal**: a dark-canonical product identity built on a cool steel-blue primary for trust and chrome, a warm amber accent reserved exclusively for AI-voice presence, a three-value outcome palette bound to the rubric in ADR-015, and a reassuring motion philosophy that is functional on the recruiter side and gentle on the candidate side.

The full token tables, type scale, spacing and radius tiers, motion constants, voice-UI element specs, and two moodboard descriptions are captured in `docs/DESIGN.md` (sections 1-9). Illustrative mockups in `docs/design-refs/candidate-interview.html`, `docs/design-refs/recruiter-dashboard.html`, and `docs/design-refs/pre-interview-check.html` exercise only the semantic tokens and radius values this ADR endorses.

Without this ADR, each future frontend component would independently resolve questions like: "Can I use `--accent` for a chart highlight?" "Should this warning pill be `--destructive` or `--attention-warning`?" "How do I animate a state transition on the candidate screen?" The resulting inconsistency would silently erode the product's visual identity.

## Decision

Adopt **Quiet Signal** as Sift's canonical design language. The one-sentence constraint for reviewers: **Warmth is reserved for the one element that has earned it: Sift's voice.**

The following are concrete, binding commitments for all code in `apps/web/src/` and `packages/ui/src/`:

**Dual color palette.** Cool steel-blue primary at hue approximately 250 degrees (oklch space) for trust, recruiter chrome, focus rings, and the candidate's own voice display. Warm amber accent at hue approximately 65 degrees reserved exclusively for Sift's AI presence: the voice orb (ADR-026), AI-sourced transcript lines, and AI-speaking states. The two palettes never share a UI region; a warm token in recruiter chrome, or a cool token in an AI-presence element, is a violation.

**Dark mode is canonical.** Light mode is shipped at full contrast parity for accessibility but the product's identity — all moodboards, all mockups, all design decisions — is authored in dark. If a component looks right only in light, the dark state is missing, not the other way round.

**Three outcome-semantic tokens.** `--positive` (advance), `--attention-warning` (hold, connection-loss, flagged transcripts), `--negative` (reject). These are bound 1-to-1 to `Report.overallRecommendation: "advance" | "hold" | "reject"` from ADR-015. Adding a fourth recommendation value requires a new ADR; it cannot be absorbed by reusing an existing outcome token.

**`--destructive` is fenced.** It exists at saturated red for true irreversible-action confirmations only: "Delete interview", "Revoke candidate link". It is explicitly forbidden in: status lists, recommendation pills, banners, charts, chart axes, hover states, focus rings, borders, inline validation errors, connection-loss warnings, and rejection outcome pills. Those surfaces use `--negative` or `--attention-warning`. An `--destructive` token outside a confirm-irreversible-action context is a violation.

**Distinctive sans typography, free families only.** Switzer (Fontshare) for headings (H1-H4), Inter (Google Fonts) for all body and UI text, JetBrains Mono (Google Fonts) for data, timecodes, and code. No licensed or paid type. Substituting a system-default sans ("just for now") forfeits the visual distinctiveness the brief names as a goal.

**Pill-versus-rounded-rect radius split.** `9999px` (pill) for interactive elements: buttons, badges, chips, segmented controls, and status pills. `12px` for containers: cards, modals, popovers, and panel borders. `8px` for form inputs and text areas. `4px` only for inline tags in dense recruiter tables. No element uses a border-radius value outside this set.

**Reassuring motion philosophy.** Recruiter-side animations are functional (state changes, loading skeletons, focus transitions). Candidate-side animations are gentle (entrance, exit, transcript fade). One expressive moment is permitted: the voice orb's amplitude-coupled pulse during AI speech; its spec belongs to ADR-026. Canonical durations: micro 120 ms, standard enter 220 ms and exit 160 ms, page-level 320 ms. Canonical easing: `cubic-bezier(0.22, 0.61, 0.36, 1)` on enter, `cubic-bezier(0.55, 0.06, 0.68, 0.19)` on exit. Exits run at approximately 70% of enter duration by convention. `prefers-reduced-motion` collapses all durations to 0 ms.

**Density is composition, not a separate token scale.** Both surfaces share the same four-step base scale (`4px / 8px / 12px / 16px`). The recruiter side builds rhythm from the lower steps; the candidate side gravitates toward an extended scale (`16 / 24 / 32 / 48 / 80`). Same tokens, different composition rhythm. A separate "compact" or "spacious" spacing scale is not created.

## Alternatives Considered

### Alternative A: The "AI buddy" direction

Peach-cream backgrounds, soft rounded illustrations, a named persona ("Hi, I'm Sam, I'll be your interviewer today"), encouragement microcopy throughout, a smiling avatar where the voice orb sits, and a bright optimistic palette in the Calendly/Typeform/Notion tradition.

Rejected because it fails each brand adjective in turn. *Composed* collapses the moment a mascot smiles at a nervous candidate: the product signals it is performing friendliness rather than conducting an interview. *Discerning* collapses when the UI spends color budget and layout space on reassurance rather than clarity. *Lucid* collapses under decorative illustration and verbose microcopy. Candidates need an instrument that respects their time and their nerves, not a chatbot wrapper trying to be their friend. The brand exclusion "Anxious" is also violated here in an unexpected direction: over-friendly AI UIs create unease precisely because they signal that the product is hiding something behind the performance.

### Alternative B: The "enterprise interview platform" direction

Clinical, neutral, Workday/Greenhouse/HireVue-adjacent: gray on white, functional typography (Inter or system-ui throughout), a single primary accent for interactive states, dense list views, no expressive moments. Safe by definition.

Rejected as the lazy default for the category. This is exactly the Corporate-HR aesthetic the brief names as the first exclusion, and it would make Sift indistinguishable from incumbent platforms that a recruiter already has tabs open to. The brief's "live-near" references (Linear, Retool, Arc browser) share a cool precision aesthetic; the "avoid" references (Workday, Greenhouse, HireVue) are generic neutral. Choosing the generic neutral aesthetic forfeits the only category-defining asset a new entrant can control quickly: how it looks.

### Alternative C: Single neutral palette with system typography (Inter throughout)

Keep Inter for all text, use a single neutral cool palette without the warm AI accent, and avoid the Switzer/JetBrains Mono additions. Simpler dependency surface, no font-loading overhead beyond Inter.

Rejected because it removes the two features doing the most design work. First, the dual-palette discipline is what makes the warm-AI / cool-chrome semantic split enforceable; without `--accent` reserved for AI presence, the voice orb (ADR-026) is an ungrounded graphic rather than a presence with its own thermal signature. Second, distinctive typography is the lowest-cost visual differentiator available to a product without a custom illustration or icon set; Inter-only returns to a surface indistinguishable from the Alternative B aesthetic. Switzer and JetBrains Mono are zero-cost (free licenses), so the objection is integration complexity, which is one-time and bounded.

## Consequences

**Benefits**

- Every future frontend component has a design-authority source: `docs/DESIGN.md` for the what, this ADR for the why. There is no remaining ambiguity about which token to reach for.
- The token fence is enforceable at commit time. The declarative patterns in the Enforcement block block raw hex literals and Tailwind color-scale classes across `apps/web/src/` and `packages/ui/src/`. The `llm_judge: true` gate handles nuanced violations the regexes cannot reach.
- Two-surface coherence without two design systems. One token set, one primitive library, two composition rhythms. Recruiter and candidate screens look related, not identical.
- The one-sentence legibility check ("Warmth is reserved for Sift's voice") gives code reviewers a fast, concrete test for any new AI-adjacent component.

**Trade-offs**

- Switzer is the heading typeface for the foreseeable future. Switching families later is a global visual recosting, not a one-line token change. The tradeoff is accepted: distinctive typography is a commitment, not a preference.
- Dark-canonical doubles the contrast verification work. Every token pair (`--foreground` / `--background`, `--primary` / `--primary-foreground`, etc.) must pass WCAG AA independently in both dark and light. Light-mode parity is real ongoing work, not a theme toggle.
- The dual-palette discipline adds a recurring per-component question: is this element AI-related? Getting it wrong in either direction (warm leaking into recruiter chrome, or cool used for AI presence) degrades the orb's meaning over time. The `llm_judge` gate exists to catch this drift.

**Risks and mitigations**

- *Risk*: A future component reaches for `--accent` as a general highlight color (chart callout, feature badge, tooltip indicator), diluting the orb's monopoly on warmth. *Mitigation*: `llm_judge: true` in the Enforcement block, plus the explicit token-usage rules table in `docs/DESIGN.md` section 2, which constrains `--accent` to an explicit enumerated list of AI-presence elements.
- *Risk*: A future feature adds a fourth recommendation outcome (for example "strong advance") without going through a new ADR, and the engineer reuses `--positive` at a different opacity to distinguish it, implicitly extending the token. *Mitigation*: this ADR binds the three outcome tokens to the three-value enum in ADR-015. Adding a fourth value to that enum requires superseding ADR-015; at that point, the visual system must also be updated via a new or amended ADR.
- *Risk*: `--destructive` bleeds outside confirm-irreversible-action dialogs, most likely via copy-pasted "error state" code from a tutorial or from a different product's component. *Mitigation*: the `llm_judge` prompt includes the `--destructive` fencing rule explicitly; the token-usage table in DESIGN.md section 2 lists every forbidden context.

## Related Decisions

- **ADR-023 (shadcn/ui + Radix + Tailwind v4 component system)**: provides the implementation substrate this ADR fills. ADR-023 decides the token mechanism (oklch CSS variables under `@theme inline`); ADR-025 decides the token values and the rules governing their use.
- **ADR-026 (Voice Presence Pattern)**: the voice orb is the single most identity-defining element the Quiet Signal concept hosts. Its amplitude-coupled pulse, color behavior during AI-listening versus AI-speaking states, and accessibility handling are carved out into ADR-026 because they cross into the audio pipeline and ARIA live-region design.
- **ADR-027 (Candidate Device Support)**: the Quiet Signal canvas assumes a desktop viewport. ADR-027 establishes the soft-block policy for mobile for MVP. A mobile-adapted visual system (different density rhythm, thumb-zone-aware layout) would require its own design pass and a follow-on ADR.
- **ADR-015 (Phase 6 Evaluation: Span Schema, Explicit Invocation, Hardcoded Rubric)**: `Report.overallRecommendation: "advance" | "hold" | "reject"` is the exact three-value enum the `--positive / --attention-warning / --negative` tokens are bound to. The outcome-token vocabulary cannot be extended without first extending this enum.
- **ADR-024 (RHF + Zod 4 for frontend forms)**: form error presentation defined here (inline validation errors use `--negative`, not `--destructive`; confirm-irreversible dialogs use `--destructive`) inherits into the form primitive layer built on ADR-023.
- **ADR-021 (Zustand for frontend client state)** and **ADR-022 (TanStack Query for frontend server state)**: this ADR follows the same pattern of "single-library, fenced-usage" commitment established by ADR-021 and ADR-022, applied to the design layer.

## References

- `docs/design-brief.md`: product positioning, brand adjective triad, live-near and avoid aesthetic references, locked decisions on dark-mode priority, dual palette, radius vocabulary, and type voice.
- `docs/DESIGN.md`: full token tables (sections 1-2), type scale (section 3), spacing and radius tiers (section 4), motion principles and canonical duration/easing values (section 5), voice UI element specs (section 6), two moodboard descriptions (sections 7-8), rejected-alternative paragraph (section 9).
- `docs/design-refs/candidate-interview.html`: illustrative mockup of the AI-speaking state with transcript-on variant; exercises warm AI-presence tokens and spacious candidate-side composition.
- `docs/design-refs/recruiter-dashboard.html`: illustrative mockup of comfortable-density list view with status and recommendation pills; exercises outcome-semantic tokens and pill radius.
- `docs/design-refs/pre-interview-check.html`: illustrative mockup of the spacious calm composition for the audio-check step; exercises the candidate-side density rhythm.
- `docs/adr/ADR-015-phase-6-evaluation-span-schema-explicit-invocation-and-hardcoded-rubric.md`: source of the `overallRecommendation` enum this ADR binds the outcome tokens to.
- `docs/adr/ADR-023-adopt-shadcn-ui-radix-tailwind-v4-component-system.md`: establishes the token mechanism (oklch CSS variables, `@theme inline`) that this ADR populates.
- Fontshare — Switzer: https://www.fontshare.com/fonts/switzer
- Google Fonts — Inter: https://fonts.google.com/specimen/Inter
- Google Fonts — JetBrains Mono: https://fonts.google.com/specimen/JetBrains+Mono

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "#[0-9a-fA-F]{3,8}\\b",
      "path_glob": "{apps/web/src,packages/ui/src}/**/*.{ts,tsx,css}",
      "message": "Raw hex color literals are forbidden (ADR-025). Use semantic tokens declared in apps/web/app/globals.css."
    },
    {
      "pattern": "\\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\\b",
      "path_glob": "{apps/web/src,packages/ui/src}/**/*.{tsx,ts}",
      "message": "Raw Tailwind color-scale classes are forbidden (ADR-025). Use semantic tokens: bg-primary, text-muted-foreground, etc."
    }
  ],
  "forbid_import": [],
  "require_pattern": [],
  "llm_judge": true
}
```

The `llm_judge: true` gate covers violations the declarative regexes cannot reach: warm tokens (`--accent`, `--orb-*`, `--ai-thinking`, `--transcript-ai`) appearing in recruiter chrome; cool tokens used inside AI-presence elements; `--destructive` applied outside an irreversible-action confirmation dialog; a fourth recommendation outcome introduced without superseding ADR-015; and any motion duration or easing value that does not match the canonical set defined in `docs/DESIGN.md` section 5.
