"use client";

import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export interface TranscriptFeedEntry {
  readonly speaker: "candidate" | "agent";
  readonly text: string;
  readonly timestamp: Date;
}

export interface TranscriptFeedProps {
  entries: ReadonlyArray<TranscriptFeedEntry>;
  className?: string;
}

function formatTimecode(t: Date, base: Date): string {
  const elapsed = Math.max(0, Math.floor((t.getTime() - base.getTime()) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `[${mm}:${ss}]`;
}

// DESIGN.md §7: speaker attribution color-coded AND labeled. Sift = warm
// (--transcript-ai), Candidate = cool (--transcript-candidate). Labels in
// caption style (12px / 0.02em / uppercase / 500). Body in body size,
// --foreground color. Timecodes mono + muted, hover-revealed only.
export function TranscriptFeed({ entries, className }: TranscriptFeedProps) {
  const base = entries[0]?.timestamp ?? new Date();
  return (
    <ol
      aria-live="polite"
      className={cn(
        "mx-auto flex w-full max-w-[640px] flex-col gap-3 text-base",
        className,
      )}
    >
      {entries.map((entry, i) => {
        const isAi = entry.speaker === "agent";
        return (
          <li key={i} className="group flex flex-col gap-1">
            <span
              className={cn(
                "text-xs font-medium uppercase tracking-[0.02em]",
                isAi ? "text-transcript-ai" : "text-transcript-candidate",
              )}
            >
              {isAi ? "Sift" : "Candidate"} ·
            </span>
            <p className="text-foreground">{entry.text}</p>
            <span className="font-mono text-xs text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {formatTimecode(entry.timestamp, base)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
