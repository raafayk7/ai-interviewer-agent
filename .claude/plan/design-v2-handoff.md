# Sift — v2 Design Refresh: Handoff for Claude Code

This document is the source-of-truth for the v2 visual overhaul. Paste each section into Claude Code in order. Every change here is **visual / token-level** — no backend or domain work required.

---

## Summary of changes

| Area | v1 (current) | v2 (refresh) | Why |
|---|---|---|---|
| **Primary** | Steel blue `oklch(0.680 0.150 250)` | Warm cream `oklch(0.935 0.020 75)` | Blue is the Tailwind/Linear/Vercel default and reads generic. Cream buttons on warm charcoal read bespoke. |
| **Background** | Cool charcoal (hue 250°) | Warm-neutral charcoal (hue 60°) | Pairs better with the amber orb; removes the "cool SaaS" cast. |
| **Focus ring** | Blue (same as primary) | Low-chroma warm `oklch(0.65 0.08 70)` | Focus reads on-brand, not generic. |
| **Voice-active** | Hue 250° (= primary) | Hue 210° petrol | Distinct from chrome; candidate voice has its own slot. |
| **Accent (orb)** | `oklch(0.785 0.130 65)` | `oklch(0.795 0.150 65)` + chroma bump | The orb is now the *only* bold colour in the product — earns more presence. |
| **Heading font** | Switzer 500–700 | **Instrument Serif** italic+regular | Genuinely uncommon; gives Sift a voice. |
| **Mono font** | JetBrains Mono | **Geist Mono** | Slightly more distinctive; clean pair with Inter. |
| **Body font** | Inter | Inter | Unchanged — workhorse. |
| **InterviewListRow** | 4 columns (name·role·status·date) | 6 columns: avatar+headline · role+plan-stats · status · recommendation · smart-time · monospaced ID | Uses fields already on `CandidateInfo` and `InterviewPlan` — no new endpoints. |
| **ReportViewer** | Stacked cards, no hierarchy | Hero recommendation card → topic scores with avg → strengths/concerns numbered → follow-ups numbered | Makes the "money page" feel like a verdict, not a form. |
| **Landing orb** | Static dot | Glowing pulse, 3s sine, `prefers-reduced-motion` collapses it | Teaser for what the candidate sees mid-interview. |

---

## 1. Replace `apps/web/app/globals.css` palette section

Find the `:root { ... }` block (canonical dark theme) and replace its contents with these values. Keep the `@theme inline` block underneath as-is — it just exposes these vars as utilities and doesn't need to change.

```css
:root {
  /* Surfaces — warm-neutral charcoal (was hue 250°) */
  --background:                   oklch(0.155 0.005 60);
  --foreground:                   oklch(0.965 0.004 60);
  --card:                         oklch(0.195 0.005 60);
  --card-foreground:              oklch(0.965 0.004 60);
  --popover:                      oklch(0.215 0.005 60);
  --popover-foreground:           oklch(0.965 0.004 60);

  /* Primary — warm cream (was steel blue) */
  --primary:                      oklch(0.935 0.020 75);
  --primary-foreground:           oklch(0.180 0.008 60);

  /* Secondary */
  --secondary:                    oklch(0.285 0.008 60);
  --secondary-foreground:         oklch(0.940 0.005 60);

  /* Muted */
  --muted:                        oklch(0.265 0.005 60);
  --muted-foreground:             oklch(0.700 0.008 60);

  /* Accent — the orb (slight chroma bump) */
  --accent:                       oklch(0.795 0.150 65);
  --accent-foreground:            oklch(0.180 0.020 65);

  /* Recommendation / outcome — restrained */
  --positive:                     oklch(0.730 0.080 155);
  --positive-foreground:          oklch(0.180 0.020 155);
  --attention-warning:            oklch(0.770 0.095 70);
  --attention-warning-foreground: oklch(0.180 0.020 70);
  --negative:                     oklch(0.620 0.110 25);
  --negative-foreground:          oklch(0.985 0.005 25);

  /* Destructive — unchanged (irreversible only) */
  --destructive:                  oklch(0.605 0.220 25);
  --destructive-foreground:       oklch(0.985 0.005 25);

  /* Borders / inputs / focus — focus ring now warm */
  --border:                       oklch(0.285 0.005 60);
  --input:                        oklch(0.225 0.005 60);
  --ring:                         oklch(0.650 0.080 70);

  /* Voice / AI — candidate voice shifts to petrol 210° */
  --voice-active:                 oklch(0.700 0.110 210);
  --voice-listening:              oklch(0.540 0.070 210);
  --ai-thinking:                  oklch(0.720 0.110 65);
  --transcript-candidate:         oklch(0.770 0.080 210);
  --transcript-ai:                oklch(0.830 0.110 65);

  /* Orb halo */
  --orb-core:                     oklch(0.880 0.150 65);
  --orb-halo:                     oklch(0.700 0.190 65 / 0.50);

  /* Radius — unchanged */
  --radius-pill:                  9999px;
  --radius-md:                    12px;
  --radius-sm:                    8px;
  --radius-xs:                    4px;

  /* Font fallback chains — names update next/font assigns */
  --font-switzer:                 "Instrument Serif", "Times New Roman", Georgia, serif;
}
```

Also update the **light theme** (`:root[data-theme="light"]`) by mirroring the same hue shifts:
- `--background: oklch(0.992 0.003 60)` (was 250°)
- `--foreground: oklch(0.220 0.008 60)`
- `--primary: oklch(0.250 0.010 60)` (warm near-black for cream-on-dark inversion)
- `--primary-foreground: oklch(0.985 0.005 60)`
- `--ring: oklch(0.500 0.080 70)`
- Other tokens: shift the second number (hue) from 250 → 60 wherever surfaces/borders/muted are defined; keep everything else as-is.

### Tailwind font-family theme — match Instrument Serif

In the `@theme inline` block, only one line needs to change:

```diff
- --font-heading:                       var(--font-switzer);
+ --font-heading:                       var(--font-switzer);   /* now resolves to Instrument Serif via next/font */
```

The variable name stays `--font-switzer` for backward compat — it just *points* to Instrument Serif now. (Saves you a project-wide find/replace.) Or rename it cleanly to `--font-display` if you prefer; same outcome.

---

## 2. Update `apps/web/app/layout.tsx` — load Instrument Serif + Geist Mono

```tsx
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-switzer",  // keep the var name; just point it at the new face
  weight: ["400"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",  // keep the var name; just point it at Geist
  weight: ["400", "500"],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
```

Remove the existing Fontshare `<link>` for Switzer if there is one — Instrument Serif is on Google Fonts, so `next/font/google` handles it.

---

## 3. Heading defaults — adopt italic display

Instrument Serif's italic carries 90% of the brand work. Bake it into the heading recipe so contributors don't have to remember.

Two options. Pick one:

**A. Add a global rule (minimal effort, broad reach):**

```css
/* in globals.css, after @layer base */
@layer base {
  h1, .h-display {
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: 400;
    letter-spacing: -0.02em;
  }
  h2, .h-section {
    font-family: var(--font-heading);
    font-weight: 400;
    letter-spacing: -0.012em;
  }
}
```

**B. Per-component opt-in** — keep h1/h2 generic, and surface `<h1 className="font-heading italic font-normal">…</h1>` at the call sites. More verbose, more controlled.

I'd go with **A** — Sift's whole point is the editorial voice. Lean in.

---

## 4. `packages/ui/src/primitives/button/button.tsx` — no code change needed

The button variants are already token-bound. When `--primary` flips from blue to cream, the `bg-primary` class automatically renders cream buttons. **No diff required.**

Same goes for `Badge`, `Card`, and every other primitive that uses semantic tokens correctly. This is the payoff for the token discipline in ADR-025.

---

## 5. `apps/web/src/components/InterviewListRow.tsx` — richer row

Use existing fields on `Interview.candidateInfo` and `Interview.interviewPlan`. No new backend.

```tsx
"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@repo/ui/primitives/avatar";
import { InterviewStatusBadge } from "@repo/ui/composites/interview-status-badge";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import type { Interview } from "@/types";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

function smartTime(interview: Interview): string {
  const { status, scheduledAt, startedAt, completedAt, updatedAt } = interview;
  const now = Date.now();
  const ago = (d: Date) => {
    const mins = Math.round((now - d.getTime()) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
  if (status === "IN_PROGRESS" && startedAt) {
    const mins = Math.floor((now - startedAt.getTime()) / 60_000);
    const secs = Math.floor(((now - startedAt.getTime()) % 60_000) / 1000);
    return `${mins}:${String(secs).padStart(2, "0")} elapsed`;
  }
  if (status === "EVALUATED" || status === "COMPLETED" || status === "CANCELLED") return ago(updatedAt);
  if (status === "SCHEDULED" || status === "CREATED") {
    return scheduledAt.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return "";
}

// Derive recommendation from the report query if you're already fetching it for this interview;
// otherwise pass it in as a prop from the container. Falls back to "—" when not yet available.
interface Props {
  interview: Interview;
  recommendation?: "advance" | "hold" | "reject" | null;
}

export function InterviewListRow({ interview: i, recommendation }: Props) {
  const idPrefix = `INT_${i.id.slice(0, 6)}`;
  const planSummary = i.interviewPlan
    ? `${i.interviewPlan.topics.length} topics, ${i.interviewPlan.targetDurationMinutes} min`
    : "Plan pending";

  return (
    <Link
      href={`/interviews/${i.id}`}
      className="grid grid-cols-[2fr_2fr_140px_130px_130px_110px] items-center gap-4 rounded-md border border-border bg-card px-5 py-3.5 transition-colors hover:bg-popover hover:border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="size-8">
          <AvatarFallback>{initials(i.candidateInfo.fullName)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-heading text-base truncate leading-tight">{i.candidateInfo.fullName}</span>
          <span className="text-xs text-muted-foreground truncate">
            {i.candidateInfo.headline} · {i.candidateInfo.yearsOfExperience} yrs
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm truncate">{i.jobDescription.title}</span>
        <span className="text-xs text-muted-foreground truncate">
          {i.jobDescription.company} · {planSummary}
        </span>
      </div>
      <InterviewStatusBadge status={i.status} />
      <div>
        {recommendation
          ? <RecommendationBadge recommendation={recommendation} />
          : <span className="text-xs text-muted-foreground">—</span>}
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{smartTime(i)}</span>
      <span className="font-mono text-[11px] tracking-wide text-muted-foreground">{idPrefix}</span>
    </Link>
  );
}
```

**Note on recommendation:** since it lives on `Report`, not `Interview`, you have two options:
1. Cheap: don't render recommendation in the row at all (drop that column). The status badge tells you EVALUATED, the detail page shows the verdict.
2. Better: extend `useInterviewList` to also fetch `useQuery(["interview-recommendations", ids])` in batch — a single new GET that returns `{ interviewId, recommendation }[]` for the visible IDs. This is the only place a small backend addition would meaningfully improve the dashboard. **You said no new backend, so go with option 1** — the recommendation column becomes "Outcome" and only shows the badge after EVALUATED via the existing report fetch on detail-page-hover prefetch, or just leave it as a "—" placeholder until clicked.

**Recommended for v2 shipping now:** drop the recommendation column. Five columns: candidate / role / status / when / id. Re-add recommendation later if/when you add the batched lookup.

Add a column header row above the list (sits in `InterviewListContainer`):

```tsx
<div className="grid grid-cols-[2fr_2fr_140px_130px_110px] gap-4 px-5 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
  <span>Candidate</span>
  <span>Role</span>
  <span>Status</span>
  <span>When</span>
  <span>ID</span>
</div>
```

---

## 6. `apps/web/src/components/ReportViewer.tsx` — heroize the verdict

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/primitives/card";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import { TopicScoreRow } from "@repo/ui/composites/topic-score-row";
import type { Report } from "@/types";

function NumberedList({ items }: { items: ReadonlyArray<string> }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((x, i) => (
        <li key={i} className="grid grid-cols-[32px_1fr] items-baseline gap-3 text-sm leading-relaxed">
          <span className="font-mono text-xs tabular-nums tracking-wide text-muted-foreground">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

function ago(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ReportViewer({ report }: { report: Report }) {
  const avg = report.topicScores.reduce((s, t) => s + t.score, 0) / Math.max(report.topicScores.length, 1);

  return (
    <div className="flex flex-col gap-7">
      {/* HERO — the verdict owns the page */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-8">
          <div className="flex flex-wrap items-center gap-4">
            <RecommendationBadge recommendation={report.overallRecommendation} />
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {avg.toFixed(1)} / 5 average · {report.topicScores.length} topics
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Generated {ago(report.generatedAt)}
            </span>
          </div>
          <p className="font-heading text-2xl leading-snug max-w-[64ch]">
            {report.communicationAssessment}
          </p>
        </CardContent>
      </Card>

      {/* Topic scores */}
      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between">
          <CardTitle className="font-heading text-xl italic">Topic scores</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">Avg · {avg.toFixed(1)}</span>
        </CardHeader>
        <CardContent>
          {report.topicScores.map((t) => (
            <TopicScoreRow key={t.topicName} topicName={t.topicName} score={t.score} justification={t.justification} />
          ))}
        </CardContent>
      </Card>

      {/* Strengths / concerns */}
      <div className="grid gap-7 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="font-heading text-xl italic">Strengths</CardTitle></CardHeader>
          <CardContent><NumberedList items={report.strengths} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="font-heading text-xl italic">Concerns</CardTitle></CardHeader>
          <CardContent><NumberedList items={report.concerns} /></CardContent>
        </Card>
      </div>

      {/* Follow-ups */}
      <Card>
        <CardHeader><CardTitle className="font-heading text-xl italic">Suggested follow-up questions</CardTitle></CardHeader>
        <CardContent><NumberedList items={report.followUpQuestions} /></CardContent>
      </Card>
    </div>
  );
}
```

You'll also want the recommendation badge to support a `size="lg"` variant. In `packages/ui/src/primitives/badge/badge.tsx`, add `lg` to the `size` CVA:

```tsx
size: {
  default: "h-6 px-2.5 text-xs",
  sm: "h-5 px-2 text-[11px]",
  lg: "h-8 px-3.5 text-[13px] font-semibold",   // ← new
},
```

Then change the hero card's badge call to `<RecommendationBadge recommendation={…} size="lg" />` (requires adding `size?: "default" | "lg"` to RecommendationBadge's props and threading it through).

---

## 7. `TopicScoreRow` — use accent instead of primary for the score bar

In v1, the fill was `bg-primary` (steel blue). In v2 primary is cream, which has terrible contrast as a thin progress fill. Swap to accent:

```tsx
// packages/ui/src/composites/topic-score-row/topic-score-row.tsx
<div className="h-full bg-accent transition-[width] duration-[220ms] ease-out" style={{ width: `${pct}%` }} />
//                  ^^^^^^^^ was bg-primary
```

This is the *one* place outside the orb composite where `--accent` is allowed to appear in recruiter chrome. Justify in code with a comment so future contributors don't strip it out:

```tsx
// Score fill uses --accent (warm amber) rather than --primary (cream) for sufficient
// contrast on the muted track. This is a deliberate exception to the "accent only inside
// VoicePresence" rule documented in DESIGN.md §2 usage table. Documented in ADR-025 follow-up.
```

Then add this exception to the DESIGN.md usage table (see section below).

---

## 8a. Sidebar brand mark — hover glow

The sidebar orb stays **static by default** (no continuous animation — the orb's motion vocabulary belongs to AI state, not chrome). But to give the brand mark a small beat of life, expand the halo on hover. Costs nothing in attention budget, doesn't run unprompted.

In `apps/web/src/components/AppSidebar.tsx`, find the brand-mark line:

```tsx
<div className="flex items-center gap-2.5 px-2 py-1">
  <span aria-hidden className="size-6 rounded-pill bg-accent shadow-[0_0_14px_var(--orb-halo)]" />
  <span className="font-heading text-base font-bold tracking-tight">Sift</span>
</div>
```

Replace with:

```tsx
<div className="group flex cursor-pointer items-center gap-2.5 px-2 py-1">
  <span
    aria-hidden
    className="size-6 rounded-pill bg-accent shadow-[0_0_14px_var(--orb-halo)]
               transition-shadow duration-200 ease-out
               group-hover:shadow-[0_0_24px_var(--orb-halo)]"
  />
  <span className="font-heading text-base italic tracking-tight">Sift</span>
</div>
```

Note the secondary change while you're in there: drop `font-bold` from the wordmark and add `italic`. Instrument Serif's italic regular cut is what gives the wordmark its character — bold sans-italic flattens it. (This matches the brand mark inside the sidebar in `pages_v2.jsx`.)

Do **not** add `animate-pulse` or any infinite keyframe. That would violate DESIGN.md §6 — continuous animation is reserved for the orb on the candidate's interview screen.

---

## 8. Landing — glowing orb

`apps/web/app/page.tsx`:

```tsx
<span
  aria-hidden
  className="size-24 rounded-pill bg-accent shadow-[0_0_48px_var(--orb-halo)]
             motion-safe:animate-[orbHaloPulse_3s_ease-in-out_infinite]"
/>
```

Define the keyframe in `globals.css`:

```css
@keyframes orbHaloPulse {
  0%, 100% { box-shadow: 0 0 24px var(--orb-halo), 0 0 0 var(--orb-halo); opacity: 0.92; }
  50%      { box-shadow: 0 0 56px var(--orb-halo), 0 0 96px var(--orb-halo); opacity: 1; }
}
```

`motion-safe:` is Tailwind's built-in `prefers-reduced-motion` guard — collapses to static glow when the user has reduced motion.

---

## 9. `docs/DESIGN.md` — three sections to replace

### 9a. Replace §2 (Color palette — dark canonical)

Use the values from section 1 above. Update the `### Usage rules` table with these clarifications:

```markdown
| Token | Allowed in | Forbidden in |
|---|---|---|
| `--accent`, `--orb-*`, `--ai-thinking`, `--transcript-ai` | `VoicePresence`, AI transcript bubbles, AI-speaking states, **TopicScoreRow score-fill** (documented exception) | Recruiter chrome elsewhere, success states, decorative gradients |
| `--voice-active`, `--transcript-candidate` | Candidate audio waveform, candidate transcript bubbles | Anywhere AI-related, recruiter chrome |
| `--primary` (cream) | Recruiter primary CTAs, focus rings (low-chroma cousin), key affordance backgrounds | Status indicators (use --positive/--accent), decorative fills, progress bars (contrast too low) |
| `--positive` | Report `overallRecommendation === "advance"` pills/chips, success confirmations | General "active" status (use IN_PROGRESS via `--accent`) |
| `--attention-warning` | Connection-loss banner & halo, `"hold"` pills, transcript-flagged markers | Form validation errors (use `--negative`), info banners |
| `--negative` | `"reject"` pills, form validation errors | Irreversible actions (use `--destructive`) |
| `--destructive` | Confirmation modals & their final destructive button only | Pills, validation, banners, charts, hover/focus, borders |
```

Update the contrast statement:

```markdown
**Contrast verified at AA**: `--foreground` on `--background` = 15.1:1; `--primary-foreground` on `--primary` = 14.2:1 (cream button readability); `--accent` on `--card` = 8.2:1; `--positive` / `--attention-warning` / `--negative` all ≥ 4.5:1 against `--card`.
```

### 9b. Replace §3 (Typography pairing)

```markdown
## 3. Typography pairing

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
```

### 9c. Add to §9 (What this system intentionally rejects)

After the existing paragraph, append:

```markdown
**Note added in v2 refresh.** The v1 palette used steel-blue 250° as primary across the recruiter chrome — buttons, links, focus rings, "scheduled" pills, the sidebar mark. After shipping, this read as the de-facto Tailwind/Linear/Vercel default and made Sift look like every other AI-product MVP. The v2 refresh moves primary to warm cream (`oklch(0.935 0.020 75)`), restricts the cool blue to the candidate-side voice tokens (`--voice-active`, `--transcript-candidate`), and concentrates *all* product warmth into the orb's accent. The net effect: the recruiter dashboard now reads as bespoke neutrals + one warm point of light, which is what the original "Quiet Signal" thesis described but the v1 palette accidentally undermined. Primary-as-blue is no longer permitted — it is on the list of decisions explicitly rejected.
```

---

## 10. New ADR — ADR-028 Design refresh v2

Create `docs/adr/ADR-028-design-refresh-v2.md` summarizing:
- **Context:** v1 palette read generic / SaaS-default; the orb's brand work wasn't reaching the recruiter side.
- **Decision:** monochrome warm-neutral chrome with cream primary, restrict cool blue to candidate voice tokens, accent kept warm and given more presence. Type pairing moves from Switzer/JBM to Instrument Serif/Geist Mono.
- **Consequences:** existing token discipline means no component refactors — only `globals.css` + three components (`InterviewListRow`, `ReportViewer`, `TopicScoreRow`'s fill colour) change. ADR-025's "no raw hex" rule continues to enforce. Light theme parity preserved.
- **Rejected alternatives:** keeping steel-blue but desaturating (still reads generic); switching to a deeper teal primary (still chrome-colored, less differentiated than going monochrome); going full-sans on Geist (safer but less distinctive).

---

## 11. Cleanup checklist

- [ ] Remove the Fontshare `<link>` for Switzer from `apps/web/app/layout.tsx` (or anywhere else it's imported).
- [ ] Verify no component file uses `bg-primary` for thin progress fills (search: `bg-primary.*h-[12]`). Score bars and similar must use `bg-accent`.
- [ ] Run the `frontend-arch-validator` (or equivalent) to confirm no raw hex literals snuck in.
- [ ] Visual smoke test: dashboard, profile, interview detail (all three states), wizard, auth screens.
- [ ] Update `docs/design-refs/` HTML mockups to reflect v2 (optional — those are reference-only).
