# ADR-027 Candidate Device Support: Desktop-Only for MVP, Soft-Block Mobile

## Status

Accepted, 2026-05-14.

## Context

Sift's candidate flow is a real-time, bidirectional voice session. The session runs over a long-lived WebSocket (ADR-011: `@fastify/websocket` v11) with `MediaRecorder` mic capture on the client side and Web Audio API TTS playback. Interviews target a ~15-minute duration with a hard ceiling enforced by the system (ADR-006).

Two mobile-specific failure modes make this technically hostile on smartphones and tablets running mobile browser engines.

**Audio capture instability.** Mobile Safari's `getUserMedia()` has documented intermittent failures during audio-capture initialization and stream ramp-up. More critically, iOS suspends `MediaRecorder` activity and AudioContext processing when the browser tab is backgrounded -- even briefly -- due to iOS memory-management policy. The MDN Page Lifecycle API documentation and WebKit issue tracker document this behaviour. A candidate who switches apps to check a message or whose screen locks during the session loses the audio stream silently; from Sift's side the session continues but receives silence.

**WebSocket lifetime under mobile OS control.** Mobile operating systems terminate WebSocket connections when the user switches apps, locks the screen, takes a phone call, or when the browser is evicted from memory. Any of these events destroying a 10-minute live interview is catastrophic: the candidate must restart, the recruiter loses signal, and the resulting evaluation is unreliable. This is a product-correctness issue, not a cosmetic one.

ADR-017 already commits substantial connection-resilience work (HMAC-signed candidate links, mid-call recovery) to Phase 10 for the desktop case alone. Multiplying that work by mobile lifecycle complexity is not on the MVP path.

Beyond the technical risks, the product's core promise depends on the candidate being in a focused environment. A candidate joining from a phone in a coffee shop will not give Sift a reliable signal regardless of how responsive the UI is (background noise, distractions, network variability). Enforcing desktop is in the candidate's interest as much as the product's.

The full responsive strategy and the canonical soft-block copy are captured in `docs/DESIGN.md` §5 (Responsive strategy and device gates). The soft-block screen uses the same design tokens and motion vocabulary as the rest of the candidate flow (ADR-025), and it reuses the `VoicePresence` composite in its static reduced-motion variant (ADR-026).

## Decision

The candidate interview flow is desktop-only at MVP. Mobile devices (detected by viewport width and pointer type) receive a soft-block screen -- not an error page, not a 4xx response, not a deny wall. Mobile candidate support is deferred to v2 and will be revisited when (a) WebSocket lifecycle resilience on mobile is solved and (b) telemetry shows a real funnel-drop signal attributable to the desktop-only gate.

The concrete bindings are:

**Detection rule.** The CSS media query `@media (max-width: 767px), (pointer: coarse)` is the sole detection mechanism. Viewport width and pointer type are the only reliable signals for this purpose. User-agent sniffing is explicitly forbidden: UA strings change with every browser update and produce silent regressions without any test coverage path.

**Soft-block screen.** On a positive detection match, a full-screen `SoftBlockScreen` composite replaces the interview UI. The screen uses `--background` fill, a small idle `VoicePresence` orb (ADR-026 reduced-motion variant), an `h2` heading reading "Sift works best on a laptop or desktop.", a `body-lg` paragraph explaining the concrete reasons (live voice conversation requires stable mic access; switching apps or locking your screen can drop the call), the candidate's signed interview link rendered in `mono` so they can copy it to another device, and a mandatory "Why?" explanation sub-paragraph. The copy is authored in `docs/DESIGN.md` §5 and must not be reworded ad-hoc per route.

**Tone.** The soft-block matches the connection-loss copy pattern from `docs/DESIGN.md` §7: calm, non-apologetic, no exclamation marks, no error iconography, no destructive coloring.

**Implementation surface.** The `SoftBlockScreen` composite ships in `packages/ui/src/composites/`. The candidate route-group layout (`apps/web/app/(candidate)/.../layout.tsx`) is solely responsible for delegating to `SoftBlockScreen` when the detection rule matches. No individual page or container duplicates this check.

**Recruiter dashboard.** The recruiter workspace is also desktop-only at MVP at the same breakpoint, with adjusted copy ("Sift's recruiter workspace is desktop-only for now -- open this link on a laptop."). The failure mode for recruiter mobile access is far less severe (the recruiter can open a laptop). A read-only mobile recruiter view is strictly out of scope for this ADR and requires a future ADR to address.

**Deferral, not rejection.** This ADR explicitly defers mobile support with named trigger conditions. It does not treat mobile as permanently out of scope. Removing the soft-block without a superseding ADR is a violation.

## Alternatives Considered

### Alternative A: Full responsive design including phones

The candidate interview UI would be designed and tested across all viewport sizes, including portrait phones.

Rejected. The engineering cost is high: mobile WebSocket lifecycle handling, iOS Safari `getUserMedia()` stream stability workarounds, screen-lock and backgrounding recovery, call-interruption recovery, separate `VoicePresence` orb composition for stacked portrait layouts, and touch-friendly transcript toggle interaction design. This work duplicates the desktop resilience work in ADR-017 Phase 10 while adding mobile-specific branches. More importantly, even when the technical path works, product quality drops on mobile: background noise, distractions, and signal variability mean the evaluation is less reliable. High engineering cost paired with degraded product output is a poor trade for MVP.

### Alternative B: Tablet and landscape phones (viewport >= 768px), block portrait phones only

Block portrait-mode phones (roughly < 768px wide) and allow tablets and landscape phones.

Rejected. Tablet usage in a focused interview context is rare in practice. iPad Safari runs on the same WebKit engine as iPhone Safari and is subject to the same `MediaRecorder` suspension and WebSocket termination behaviors under memory pressure. This approach adds a breakpoint of layout work and a separate orb composition for a low-coverage device class without resolving the core resilience issue. It also produces a fragile behavior: a candidate rotating an iPad from portrait to landscape would enter and exit the soft-block, which is confusing.

### Alternative C: Best-effort responsive with no block

Ship the desktop-first layout as-is and let mobile users attempt the interview. Display no warning.

Rejected. Candidates experiencing dropped sessions or silent mic failures will not understand the cause is their device -- they will attribute the failure to Sift. A silent failure mode that produces an incomplete evaluation is worse than a clear gate that tells the candidate to switch devices. A soft-block is more honest and more useful than an unexplained degraded experience.

### Alternative D: Hard error page on mobile

Display a conventional error page ("Unsupported Device") on mobile, with no further explanation.

Rejected. This fails the "Composed" brand adjective established in ADR-025, and it reads exactly like the corporate-HR tone the product is designed to avoid. The "Composed" standard means the product explains itself without panic. A hard error page uses error iconography and destructive visual language for a situation that is not an error -- it is a scoping boundary. The soft-block achieves the same gate without the panic-coded presentation.

### Alternative E: User-agent string detection for mobile

Use `navigator.userAgent` matching to classify devices rather than viewport and pointer media queries.

Rejected. UA strings change with every browser release without notice. Detection logic targeting specific UA substrings requires ongoing maintenance as browsers update, and failures are silent -- there is no test that can catch a newly-released browser UA format that the regex no longer matches. Viewport width and pointer type media queries are the canonical, browser-standard signals for this use case and are stable across updates. This is not a preference; it is the only defensible implementation. Any use of `navigator.userAgent` in candidate- or recruiter-flow files is forbidden by the Enforcement block below.

### Alternative F: Do nothing (no gate, no ADR)

Treat the desktop-only assumption as implicit and undocumented.

Rejected. Undocumented assumptions are the root cause this ADR addresses. Without an explicit record of the deferral and its trigger conditions, a future engineer will encounter the desktop-only soft-block, assume it is an oversight or an incomplete responsive implementation, and remove it as part of a "just make it responsive" cleanup. This ADR is the record that makes the deferral intentional and findable.

## Consequences

**Benefits**

- Single viewport class to design, build, and test for the candidate flow. One composition, one pointer assumption, one audio-capture surface.
- Mobile WebSocket lifecycle resilience is removed from MVP scope entirely, allowing Phase 10 to focus on desktop reconnect quality (ADR-017).
- The soft-block is itself an on-brand product moment: composed, self-explaining, treats the candidate with dignity and gives them the concrete action (copy the link to a laptop).
- User-agent-free detection survives browser updates without maintenance or silent regressions.
- Trigger conditions for revisiting mobile support are explicit and named. Future engineers do not need to guess whether mobile is off forever or merely deferred.

**Trade-offs**

- Excludes candidates who genuinely cannot access a desktop or laptop within their interview window. Accepted for MVP; revisit if telemetry shows a measurable funnel drop attributable to the gate.
- Recruiters cannot access their dashboard from a phone (e.g., between meetings). Accepted for MVP; a read-only mobile recruiter view is a future ADR. Strictly out of scope here.
- The `(pointer: coarse)` signal has a small false-positive surface: a touchscreen laptop (e.g., Surface Pro) with a discrete mouse connected reports `pointer: fine`, but one used with touch alone reports `pointer: coarse`. Acceptable; the rule errs toward correctness. A future iteration could add a secondary "this looks like a touch device -- open from a laptop?" advisory without requiring a full supersession.

**Risks and mitigations**

- *Risk*: A future PR removes the soft-block delegation from the candidate route-group layout, treating it as an incomplete responsive implementation or an oversight. *Mitigation*: the `require_pattern` Enforcement rule makes the soft-block delegation load-bearing at commit time. Removal requires a superseding ADR.
- *Risk*: A developer adds mobile-specific breakpoint styles to candidate-flow files without removing the soft-block, producing a half-supported mobile experience that fails unpredictably. *Mitigation*: `llm_judge: true` flags PRs that add mobile-targeted breakpoints to candidate-flow files without a superseding ADR.
- *Risk*: The soft-block copy gets reworded ad-hoc per route and drifts from the composed tone established in `docs/DESIGN.md` §5. *Mitigation*: the canonical copy lives in the `SoftBlockScreen` composite in `packages/ui/src/composites/`, not inlined per-route. Route-level layouts delegate, they do not rewrite.
- *Risk*: The user-agent detection prohibition is forgotten and a UA-based check is added during a fast patch. *Mitigation*: the `forbid_pattern` Enforcement rule blocks any line matching `navigator.userAgent` in candidate- and recruiter-flow files at commit time.

## Related Decisions

- **ADR-006 (Interview Duration: Soft Target with Hard Ceiling)**: comparable NFR-scoping ADR that makes a deferral explicit with named trigger conditions. This ADR follows the same pattern: state the constraint, document the trigger for revisiting, make the deferral findable.
- **ADR-011 (Adopt @fastify/websocket v11 for WebSocket Transport)**: the real-time channel whose mobile OS lifecycle behavior -- termination on app-switch, screen-lock, backgrounding -- is the dominant correctness concern driving the desktop-only gate.
- **ADR-017 (Candidate Access via HMAC-Signed Link)**: the candidate's entry path that the soft-block intercepts in the route-group layout. The layout verifies the signed link server-side (per ADR-017) and then conditionally renders `SoftBlockScreen` before handing off to the interview container.
- **ADR-025 (Design Language and Visual System)**: the soft-block screen is built from the same design tokens, type scale, and motion vocabulary defined in ADR-025. The "Composed" brand adjective is what makes the soft-block the right shape, and the "Corporate-HR" exclusion is why a hard error page is wrong.
- **ADR-026 (Voice Presence Pattern)**: the soft-block's small idle orb is the `VoicePresence` composite in its static reduced-motion variant. ADR-026 defines the orb states; this ADR uses the idle/static state as ambient presence on the soft-block screen.

## References

- `docs/DESIGN.md` §5 -- Responsive strategy and device gates; canonical soft-block copy.
- `docs/DESIGN.md` §7 -- Connection-loss copy tone; the soft-block matches this register.
- `docs/design-brief.md` §5 -- Voice UI specifics that inform the desktop-only assumption.
- MDN Web Docs: `getUserMedia()` browser compatibility table (iOS Safari noted limitations).
- MDN Web Docs: Page Lifecycle API -- "Frozen" and "Discarded" states under mobile memory pressure.
- MDN Web Docs: `@media (pointer: coarse)` and `@media (max-width: ...)` -- canonical device-class detection signals.
- WebKit issue tracker: `MediaRecorder` and `AudioContext` suspension on iOS Safari background.
- `packages/ui/src/composites/` -- target location for `SoftBlockScreen` composite.
- `apps/web/app/(candidate)/` -- candidate route-group layout; the sole delegation point for `SoftBlockScreen`.

## Enforcement

```json
{
  "forbid_pattern": [
    {
      "pattern": "navigator\\.userAgent|userAgent\\.match|userAgent\\.includes",
      "path_glob": "{apps/web/app/(candidate),apps/web/app/(recruiter),apps/web/src/containers,packages/ui/src/composites}/**/*.{ts,tsx}",
      "message": "User-agent sniffing for device detection is forbidden (ADR-027). Use viewport + pointer media queries: @media (max-width: 767px), (pointer: coarse)."
    }
  ],
  "require_pattern": [
    {
      "pattern": "SoftBlockScreen|soft-block-screen",
      "path_glob": "apps/web/app/(candidate)/**/layout.tsx",
      "message": "The candidate route-group layout must delegate to SoftBlockScreen on mobile (ADR-027). Removing this delegation requires a superseding ADR."
    }
  ],
  "forbid_import": [],
  "llm_judge": true
}
```

The `forbid_pattern` rule blocks user-agent sniffing in candidate-flow, recruiter-flow, container, and composite files at commit time. The `require_pattern` makes the candidate layout's soft-block delegation load-bearing: any commit that removes `SoftBlockScreen` from the candidate layout without a superseding ADR will fail the pre-commit check. The `llm_judge: true` flag covers nuanced violations the regexes cannot reach: addition of mobile-specific breakpoints to candidate-flow files without removing the soft-block, weakening of the soft-block to a non-blocking warning, ad-hoc copy rewording that drifts from the composed tone, or a recruiter-flow change that bypasses the desktop-only assumption.
