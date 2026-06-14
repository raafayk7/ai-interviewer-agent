# ADR-026 Voice Presence Pattern: The Orb as the Canonical AI Presence Element

## Status

Accepted, 2026-05-14.

## Context

Sift conducts a live, bidirectional voice interview with the candidate. The voice pipeline uses a sandwich architecture (ADR-002), async-iterable STT/TTS stream contracts (ADR-010), and Fastify WebSocket transport (ADR-011). Throughout the interview, the candidate must understand at a glance — and continuously — whether the AI is listening, thinking, or speaking. The entire candidate-side audio path runs through the Web Audio API; the AI-speaking state is the moment when Sift "feels alive" and benefits from real-time amplitude coupling. The STT VAD (voice activity detection) signal, delivered over the WebSocket transport, provides a "candidate stopped speaking" event that can gate a thinking-state transition.

The product's brand-adjective triad is Lucid, Composed, Discerning, with explicit exclusions: Corporate-HR, Gimmicky, Anxious. The design brief (`docs/design-brief.md` §3 motion-philosophy row) commits to a "Reassuring" motion philosophy on the candidate side. The brief's §3 entity-naming row commits to "branded but unnamed" — Sift is the named entity, and the AI interviewer carries no separate persona, avatar name, or portrait. The full color palette and token discipline are defined in `docs/DESIGN.md` §3.

Common patterns from the AI-product space were evaluated against these constraints:

- Animated avatar with a face (Replika, Character.ai direction): violates "branded but unnamed," inherits uncanny-valley risk, cited as an anti-reference in `docs/design-brief.md` §5.
- Named persona with portrait: same problem, plus requires an artwork pipeline the team does not have.
- Chat-style three-dot typing indicator: design brief (`docs/DESIGN.md` §7 AI thinking state) explicitly notes "that's chat-app coded and reads anxious."
- Frequency-spectrum bars: brief notes "too clinical."
- Status text ("Sift is thinking…", "Sift is speaking…"): brief notes this "reads condescending at this level."
- Generic spinners: imply loading rather than presence; no state differentiation.

The candidate accesses the interview over an HMAC-signed link (ADR-017) and is routed through the `(candidate)` route group. The interview session screen is the primary venue for this decision. The pre-interview audio check screen is a secondary venue where the orb appears as a small static presence.

Accessibility: WCAG 2.1 SC 2.3.3 (Animation from Interactions) requires that users who have set `prefers-reduced-motion: reduce` can disable non-essential animation. The orb's continuous animations fall into this category, but removing the orb entirely would eliminate the only AI-presence signal — an outcome that reads as the product being broken or hung.

The full state-by-state visual specification is captured in `docs/DESIGN.md` §7 (Voice UI element decisions). The four-state behavior table is captured in `docs/design-brief.md` §5 (Central thesis — the orb). The illustrative mockup at `docs/design-refs/candidate-interview.html` renders the AI-speaking variant.

## Decision

The candidate UI revolves around a single persistent visual element — the orb — that modulates through four states. No additional visual elements may be introduced to communicate AI states. This single-element discipline is the load-bearing rule of the candidate experience.

The orb ships as a `VoicePresence` composite at `packages/ui/src/composites/voice-presence/`. Its API receives an `AnalyserNode` (or equivalent amplitude source) from the audio playback layer and a discriminated state union (`idle | candidateSpeaking | thinking | aiSpeaking | connectionWarning`). It returns a self-contained visual element. Consumers do not read amplitude directly; they pass a source in.

**Position.** Center stage on the candidate interview screen during the active session. A small static low-glow instance appears in the top-left corner of the pre-interview audio check screen, reinforcing "Sift is here, ready when you are." No other placement is defined for MVP.

**Idle / listening (waiting for candidate).** Slow breathing pulse on `transform: scale()` and `opacity`, approximately 3s sine cycle, low intensity. Continuous.

**Candidate speaking.** Slightly dimmer (deferential), maintains the slow breathing. The orb defers to the candidate's voice.

**AI thinking — threshold-gated at 800ms.** Below 800ms after the candidate stops speaking, no element changes — that latency reads as a normal conversational pause. At or above 800ms, the orb's breathing cycle accelerates from 3s to approximately 1.2s and its core color shifts from `--orb-core` to `--ai-thinking`. No three-dot indicator. No "Sift is thinking…" caption. No spinner. The orb modulating is the state.

**AI speaking (TTS playing).** The orb's `transform: scale()` is driven by the live TTS audio envelope — RMS amplitude over a 30ms window mapped to a 0.96 to 1.06 scale range with 80ms ease-out smoothing. Halo opacity follows the same envelope on a 0.35 to 0.65 range. Color returns to `--orb-core` (warmest of the warm). The orb visibly "speaks." This is the single most identity-defining interaction in the product.

**Connection warning.** The orb's halo crossfades to `--attention-warning` over approximately 400ms. Recovery crossfades back to `--orb-core` over approximately 600ms. Never `--destructive`, never `--negative` — even at full failure. The accompanying `"Reconnecting…"` / `"Reconnected. Resuming…"` top banner must be rendered inside an `aria-live="polite"` region so screen-reader users are notified of the state change; the orb's continuous animation itself is **not** announced (the live audio conversation is the primary state signal and announcing every breathing-rate change would be hostile to screen-reader users).

**`prefers-reduced-motion: reduce` collapse behavior.** Continuous animations stop. The orb persists as a static low-glow at `--orb-core` with no scale or opacity changes. State changes become instantaneous color and opacity swaps with no CSS transition. The orb stays warm and present — it does not move. Removing the orb entirely on reduced-motion is forbidden: the candidate would lose the only AI-presence signal.

## Alternatives Considered

### Alternative A: Animated avatar, face, or named persona portrait

An avatar or named persona (examples: a friendly "Sam" persona in Replika style, or an illustrated face speaking via lip-sync) anthropomorphizes the AI and violates the "branded but unnamed" constraint established in `docs/design-brief.md` §3. It inherits the uncanny-valley problem that animated avatars for voice-paced AI have exhibited in products like Character.ai: when the lip-sync or expression lags behind the voice, the result is disturbing rather than reassuring. Avatars also require an ongoing artwork pipeline — character states, expressions, animation rigs — that the team does not have and the brand does not want (Composed, Discerning explicitly cut against mascot energy). The brief lists this as an anti-reference. Rejected.

### Alternative B: Three-dot typing indicator, frequency-spectrum bars, and status text captions

The chat-app idiom (three dots while thinking, a spectrum bar while speaking, "Sift is thinking…" caption) was the default-safe fallback. It is rejected on three counts. First, it triples the visual surface: three separate elements compete for attention where one element is sufficient. Second, each element carries wrong connotations: dots encode asynchronous waiting, not a listening presence; spectrum bars are clinical audio-tool UX; status captions condescend by narrating what the orb already shows. Third, the design brief (`docs/DESIGN.md` §7) individually names and rejects each of these: "chat-app coded and reads anxious" (dots), "too clinical" (bars), "reads condescending at this level" (captions). Rejected.

### Alternative C: Multiple specialized indicators per state

A "listening badge," a separate "thinking" widget, and a separate "speaking wave" — each designed to be maximally legible for its single state — would maximize per-state clarity but destroy single-element discipline. The moment two visual elements compete for the candidate's attention, neither feels like a presence and the screen becomes a status dashboard. The brand thesis (one warm point of light in a dark room, per `docs/design-brief.md` §5 final paragraph) depends on a single focal point. This alternative also multiplies the accessibility surface: every element requires its own reduced-motion fallback. Rejected.

### Alternative D: No persistent visual element — rely on transcript and audio alone

A purely audio-plus-transcript interface (the candidate hears the AI speak, and reads the transcript if toggled on) removes the visual-identity concern entirely. Rejected because: (a) the transcript is default-off (`docs/DESIGN.md` §7 transcript subsection: "default off"), so many candidates will have no secondary signal; (b) hard-of-hearing candidates who cannot infer AI state from audio alone need a visual signal; (c) the absence of any visual focal point during silences makes the AI feel hollow rather than calm — the design brief explicitly describes this risk in §5 ("the moment Sift feels alive without needing a face"). Rejected.

## Consequences

**Benefits**

- One element to design, build, test, accessibility-audit, and maintain across all AI states. A single-element animated component is simpler to reason about than a state-machine driving multiple UI widgets.
- The amplitude-coupling moment (orb scale driven by live TTS RMS at 30ms windows, 0.96 to 1.06 range, 80ms ease-out) is the single most identity-defining interaction in the product — earned from the audio data, not decorated.
- Reduced-motion fallback is bounded: one element collapses to static, one element's state transitions become instant swaps. No cascading fallback work across multiple widgets.
- Brand adjectives (Composed, Lucid, Discerning) can all be sanity-checked against the single element. Any proposed change to the orb can be evaluated with one question: "does this still feel composed?"
- Composability: the `VoicePresence` composite with its discriminated state union can be reused in the pre-interview check, the active interview screen, and any future Sift-speaks moment with different state inputs and sizes.
- The `AnalyserNode` injection pattern (consumers pass the node in, not read amplitude themselves) keeps amplitude-coupling logic in one place and prevents re-implementation drift.

**Trade-offs**

- Couples the visual layer to the audio pipeline. `VoicePresence` needs a live `AnalyserNode` tap from the TTS playback stream. This is a small but real coordination contract between the audio playback code (in `InterviewSessionContainer`) and the composite.
- The threshold-gated thinking state (800ms) requires accurate detection of "candidate stopped speaking" from the STT VAD signal exposed by the WebSocket transport. VAD accuracy directly affects how well the thinking state reads.
- Single-element discipline means every future AI state must be expressed by orb modulation alone. New product states (e.g., "Sift is evaluating your answer," "follow-up queued") will be tempted to add new visual elements; that temptation must be actively resisted.
- The scale range (0.96 to 1.06) and smoothing window (80ms ease-out) were chosen for typical TTS streams; noisy or low-bitrate streams may produce different visual behavior until the knobs are tuned.

**Risks and mitigations**

- *Risk*: A future PR introduces a spinner, dots, or "Sift is thinking…" caption to make the thinking state "more obvious." *Mitigation*: The Enforcement block below uses a regex forbid_pattern on the canonical anti-pattern identifiers in candidate-route and container files, plus `llm_judge: true` for nuanced additions that evade the regex.
- *Risk*: The amplitude-coupling produces visual jitter on noisy or low-bitrate TTS audio. *Mitigation*: The 80ms ease-out smoothing and clamped scale range (0.96 to 1.06) absorb most spikes. If jitter persists in production, the smoothing window is the tunable knob — the core decision (single orb, amplitude-driven scale) is not the source of jitter and does not need to change.
- *Risk*: A future component author re-implements amplitude coupling outside `VoicePresence` (e.g., a custom hook in a new container). *Mitigation*: The Enforcement block forbids `AnalyserNode` usage outside the composite. Consumers must pass an `AnalyserNode` into `VoicePresence`, not instantiate their own amplitude reader.
- *Risk*: Users with `prefers-reduced-motion` see a fully static orb and assume the product is hung. *Mitigation*: The static state uses `--orb-core` (the warm amber at `oklch(0.860 0.140 65)`) — visibly "on" and warm. The connection-warning color swap (`--attention-warning`) remains active even with motion off, so state changes are still communicated.
- *Risk*: The single-element rule is forgotten as the product scales. *Mitigation*: This ADR is the findable record. The Enforcement block's `llm_judge: true` surfaces it at commit time for any change in the candidate flow.

## Related Decisions

- **ADR-025** (Design Language and Visual System): defines the warm/cool palette discipline — `--orb-core`, `--orb-halo`, `--ai-thinking`, `--attention-warning` — that gives the orb its semantic color meaning. The orb is the single element that ADR-025's "warmth is reserved" rule exists to protect.
- **ADR-027** (Candidate Device Support: Desktop-Only for MVP, Soft-Block Mobile): the orb is designed for a desktop viewport (140px to 220px fluid across 1024px to 1920px); mobile layout would require a separate composition pass and is out of scope for MVP per ADR-027.
- **ADR-010** (Use AsyncIterable Stream Contracts for STT and TTS Application Ports): the TTS stream that the orb's amplitude-coupling reads from.
- **ADR-002** (Use Sandwich Architecture for Voice Interviews): the audio pipeline this orb visualizes.
- **ADR-011** (Adopt Fastify WebSocket Transport): the transport that delivers the STT VAD signal feeding the threshold-gated thinking state.
- **ADR-017** (Candidate Access via HMAC-Signed Link): the orb appears on the candidate-token-gated route guarded by ADR-017.

## References

- `docs/DESIGN.md` §7 — Voice UI element decisions: AI thinking state (threshold-gated 800ms, no dots/caption/spinner), AI speaking state (RMS amplitude 30ms window, 0.96 to 1.06 scale, 80ms ease-out, 0.35 to 0.65 halo opacity), connection-loss recovery sequence, transcript default-off policy.
- `docs/design-brief.md` §5 — "Central thesis — the orb": the canonical four-state behavior table and rejection of the "warm, friendly AI buddy" alternative.
- `docs/DESIGN.md` §3 — Color palette: `--orb-core: oklch(0.860 0.140 65)`, `--orb-halo: oklch(0.680 0.180 65 / 0.45)`, `--ai-thinking: oklch(0.700 0.110 65)`, `--attention-warning` (muted amber). These are the exact token values the orb consumes.
- `docs/DESIGN.md` §6 — Motion philosophy: "Five-sentence rule," idle breathing is a 3s sine on `transform: scale()` and `opacity`, thinking shifts to 1.2s, AI-speaking is amplitude-driven; everything respects `prefers-reduced-motion`.
- `docs/design-refs/candidate-interview.html` — Illustrative mockup of the AI-speaking state with transcript-on variant.
- MDN Web Docs — Web Audio API `AnalyserNode.getFloatTimeDomainData()`: the method used to compute the RMS amplitude window.
- WCAG 2.1 SC 2.3.3 (Animation from Interactions): rationale for the reduced-motion collapse rule; the orb's continuous animations qualify as non-essential motion that must stop on `prefers-reduced-motion: reduce`.

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "(?i)(?:typing|loading)[-_]?(?:indicator|dots)|three[-_]?dot|spinner|frequency[-_]?(?:spectrum|bar)",
      "path_glob": "{apps/web/app/(candidate),apps/web/src/containers/InterviewSessionContainer,packages/ui/src/composites/voice-presence}/**/*.{ts,tsx,css}",
      "message": "Additional AI-presence indicators are forbidden in the candidate flow (ADR-026). The orb is the single AI-presence element; modulate its state instead of adding another visual."
    },
    {
      "pattern": "(?i)Sift is (?:thinking|speaking|listening|processing)",
      "path_glob": "{apps/web/app/(candidate),apps/web/src/containers/InterviewSessionContainer}/**/*.{ts,tsx}",
      "message": "Status text narrating the orb's state is forbidden (ADR-026). The orb's modulation communicates state; copy at this level reads as condescending (see docs/DESIGN.md §7)."
    },
    {
      "pattern": "\\bAnalyserNode\\b",
      "path_glob": "{apps/web/src,packages/ui/src}/**/*.{ts,tsx}",
      "message": "AnalyserNode usage outside VoicePresence is forbidden (ADR-026). Consumers must pass an AnalyserNode into the VoicePresence composite rather than reading amplitude independently."
    }
  ],
  "require_pattern": [],
  "forbid_import": [],
  "llm_judge": true
}
```

The first two `forbid_pattern` rules use the Python inline flag `(?i)` to match case-insensitively. This is required because `bin/adr-judge` compiles rule patterns with `re.compile(pattern)` and **does not pass `re.IGNORECASE`** (verified in `bin/adr-judge` line ~290) — without the inline flag, kebab-cased identifiers like `typing-indicator` would match but PascalCase React component names like `TypingIndicator` or `LoadingDots` would not, defeating the rule. The `AnalyserNode` pattern is intentionally case-sensitive because it targets a fixed Web Audio API identifier whose casing is invariant.

The `AnalyserNode` pattern scopes broadly across `apps/web/src` and `packages/ui/src`. The only permitted match is inside `packages/ui/src/composites/voice-presence/`. The `llm_judge: true` pass covers softer violations that evade the regex: a new AI-state visual element under a name not in the pattern list, a re-implementation of amplitude coupling behind a different identifier, removal of the reduced-motion collapse fallback that leaves the orb invisible, or a second persistent visual element introduced alongside the orb.
