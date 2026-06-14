"use client";

import { cn } from "@repo/ui/lib/cn";

export type ConnectionLossBannerState =
  | "reconnecting"
  | "reconnected-resuming"
  | "failed";

export interface ConnectionLossBannerProps {
  state: ConnectionLossBannerState;
  className?: string;
}

// DESIGN.md §7 connection-loss choreography:
//   reconnecting   → "Reconnecting…"            + 1.5s progress shimmer
//   reconnected    → "Reconnected. Resuming…"   (2.5s, then unmount)
//   failed         → static terminal end (ADR-035: a refresh no longer resumes,
//                     so no "try refreshing" hint); amber, no destructive tint
const COPY: Record<
  ConnectionLossBannerState,
  { title: string; sub: string }
> = {
  reconnecting: {
    title: "Reconnecting…",
    sub: "Your interview is paused. Please stay on this page.",
  },
  "reconnected-resuming": {
    title: "Reconnected. Resuming…",
    sub: "Picking up where we left off.",
  },
  failed: {
    title: "Your interview connection ended.",
    sub: "Your responses so far are saved — you can close this tab.",
  },
};

export function ConnectionLossBanner({
  state,
  className,
}: ConnectionLossBannerProps) {
  const copy = COPY[state];
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-1 bg-attention-warning/90 px-6 py-3 text-center text-attention-warning-foreground",
        "motion-safe:animate-in motion-safe:slide-in-from-top motion-safe:duration-200",
        className,
      )}
    >
      <p className="font-medium">{copy.title}</p>
      <p className="text-sm opacity-90">{copy.sub}</p>
      {state === "reconnecting" && (
        <span
          aria-hidden
          className="mt-1 h-[2px] w-32 overflow-hidden rounded-pill bg-attention-warning-foreground/30"
        >
          <span
            data-testid="connection-loss-progress-nub"
            className="block h-full w-1/3 bg-attention-warning-foreground motion-safe:animate-shimmer"
          />
        </span>
      )}
    </div>
  );
}
