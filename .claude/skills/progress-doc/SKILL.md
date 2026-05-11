---
name: progress-doc
description: Write a structured progress document for a completed milestone, feature, or development phase. Use this skill whenever the user says "write the progress doc", "document what we just did", "write up this milestone", "capture this phase", or finishes implementing a feature and wants it recorded. Produces a Markdown document following the project's established format, automatically calibrating detail level to the number of files touched (≤10 files → per-file breakdown; >10 files → layer/component-level summary). Trigger proactively whenever the user finishes a multi-step implementation and mentions documenting or recording the work.
user-invocable: true
argument-hint: "<milestone title> [--base <branch-or-commit>] [--plan <plan-file>] [--out <output-path>]"
metadata:
  version: 1.0.0
---

# progress-doc

Writes a structured Markdown progress document for a completed milestone. Detail level is calibrated automatically by file count: ≤10 files produces a per-file breakdown with What / Why / Impact; >10 files produces a layer/component-level summary.

---

## Step 1 — Establish context

Collect these items before writing anything. Prefer inferring from arguments and repo state; ask the user only when something genuinely can't be derived.

| Item | How to get it |
|------|---------------|
| **Title** | From arguments; if absent, ask: "What should this document be titled?" |
| **Base ref** | From `--base` argument; default `main`; ask if the branch topology is ambiguous |
| **Plan file** | From `--plan` argument; otherwise check `.claude/plan/` and pick the most recently modified `.md`; may be absent |
| **Output path** | From `--out` argument; default `docs/progress/<title-in-kebab-case>.md` |

---

## Step 2 — Gather facts from the repo

Run these commands and capture all output — it drives the document.

```bash
# Changed files (determines format)
git diff <base>...HEAD --name-only

# Commit log
git log <base>...HEAD --oneline

# Type-check
pnpm turbo run check-types --filter=@repo/domain --filter=@repo/application --filter=backend

# Tests — run whichever packages were touched
pnpm turbo run test --filter=@repo/domain
pnpm turbo run test --filter=@repo/application
pnpm turbo run test --filter=backend
```

If the plan file exists, read it now for: goal list, ADR references, batch names, explicit scope exclusions.

For the **Why** and **Impact** fields (detailed format): derive from commit messages, plan content, and session context. If a file's rationale still can't be inferred, ask the user rather than guessing.

---

## Step 3 — Choose format

Count the output lines of `git diff <base>...HEAD --name-only`.

| File count | Format |
|-----------|--------|
| **≤ 10** | **Detailed** — per-file entries with What changed / Why / Impact |
| **> 10** | **Summary** — layer/batch/component-level bullets |

---

## Step 4 — Write the document

Use the matching template. Fill every included section with real content. If a section has nothing real to say (no ADRs authored, no live smoke run, nothing notable for notes), **omit it entirely** — never write "N/A" or leave a template placeholder.

---

### Detailed template (≤ 10 files)

```
# <Title> Progress

## <Title> Complete

This document records the <Title> changes for <repo-name>.

<Title> goal:

- <goal bullets — from plan if available, otherwise derived from commits>

Plan source: `.claude/plan/<plan-file>.md`
Architecture context: `docs/ARCHITECTURE.md`

[ADRs referenced:
- [ADR-NNN](../adr/ADR-NNN-title.md) — one-line decision summary
Omit this block if no ADRs were referenced or authored.]

---

## Summary

<2–4 sentences: what was done, which layers were touched, any notable deviations from the plan.>

Explicitly **not** included in this work:

- <scope boundary items — from plan or agreed exclusions>

[## Implementation Notes

<Non-obvious decisions, library version constraints that changed the approach, workarounds, or anything that deviates from the plan and would surprise a future reader. Omit if nothing notable.>]

---

## Files Touched

### 1. `<path/to/file.ts>`

What changed:
- <concrete description — function names, fields added, enum values, config keys>

Why:
- <architectural reason for the change — domain invariant enforced, port contract satisfied, etc.>

Impact:
- <what downstream code now relies on this, or what it unblocks>

[Repeat ### N. block for each changed file in a logical order — domain first, then application, infrastructure, presentation.]

---

## Verification

Commands run and passing:

\`\`\`bash
<exact commands>
\`\`\`

Results:

- domain tests: **N passed**
- application tests: **N passed**
- backend tests: **N passed**
- type-check passed for <packages>

[Architecture checks:
- <any manual boundary checks performed, e.g. "no presentation imports in infrastructure files">]

[## Live Smoke

<Only if real provider API calls were made with configured keys. Include: setup steps, what was exercised, observed metrics (latency, trace IDs, turn counts, close codes), and any provider-specific discoveries. Omit entirely if no smoke was run.>]

---

## Code Review

<backend-code-reviewer result. If REVISION REQUIRED: name each violation (file:line — description) and the fix applied. Close with the second-pass result and final test counts. End with **PASS**.>

---

[## Notes

<Post-hoc observations: surprises, residual risks, follow-up items, known gaps. Omit if nothing worth preserving.>]
```

---

### Summary template (> 10 files)

```
# <Title> Progress

## <Title> Complete

This document records the <Title> changes for <repo-name>.

<Title> goal:

- <goal bullets>

Plan source: `.claude/plan/<plan-file>.md`
Architecture context: `docs/ARCHITECTURE.md`

[ADRs referenced:
- [ADR-NNN](../adr/ADR-NNN-title.md) — one-line decision summary
Omit if no ADRs.]

---

## Summary

Completed:

- **<Layer or Component>:** <what was done — name key files or concepts, not just the layer name>
- **<Layer or Component>:** <what was done>
[One bullet per logical group. Group by layer, batch, or feature area — whichever maps best to how the work was structured.]

Explicitly **not** included in this work:

- <scope boundary items>

[<One sentence for any integration or cross-cutting fix that doesn't fit the bullets above.>]

---

[## Implementation Notes

<Non-obvious decisions, SDK constraints, deviations from the plan. Omit if nothing notable.>]

---

## Verification

Commands run and passing:

\`\`\`bash
<exact commands>
\`\`\`

Results:

- domain tests: **N passed**
- application tests: **N passed**
- backend tests: **N passed**
- type-check passed for <packages>

[Cleanup checks — include if any code was deleted and you want to confirm no dead references remain:
\`\`\`bash
<rg/grep command>
\`\`\`
Result: <what was found>]

[## Live Smoke

Setup:
- <environment prep steps>

<What was exercised and with which provider keys.>

Successful run:
- <metric: value>
- <metric: value>

Smoke-discovered fixes:
- <description of what broke and how it was fixed — include these even if minor>

<Langfuse trace ID and root span name if available.>]

---

## Code Review

<Pass/revision cycle. Name each violation if REVISION REQUIRED. End with **PASS** and final test counts.>

---

[## Notes

<Observations, follow-up items, things to watch. Omit if nothing to add.>]
```

---

## Writing guidelines

**Specificity over vagueness.** "Added `AgentNote` value object with `text` and `createdAt` fields" beats "added a value object." Mention function names, column names, error types, config keys — the concrete nouns that a future reader would grep for.

**Tone.** Past tense, declarative, third-person neutral. "Added X" not "We added X." No hedging.

**Why vs What.** "What changed" restates the code. "Why" explains the *architectural reason* — which invariant is being enforced, which contract is being satisfied, what failure mode is being prevented. If Why just restates What, dig deeper.

**Ordering files.** In the detailed format, order files to tell a coherent story: domain entities first, then value objects, errors, repository ports, application layer, infrastructure, presentation. A reader should be able to follow the dependency chain.

**Omission over placeholder.** Drop any section that has nothing real to say. A shorter, accurate document beats a longer one with filler.

**Code review violations.** Name them precisely: `filename.ts:line — description`. A future reader should understand exactly what was wrong and what changed, without needing to read the diff.

**Live smoke.** Only include if actual network calls were made to real provider APIs. "Tests passing" is not a smoke test. If smoke was run, include Langfuse trace IDs and any provider-specific surprises — these are the most valuable content in the section because they can't be derived from code alone.
