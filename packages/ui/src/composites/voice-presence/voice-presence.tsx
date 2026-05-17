"use client";

import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type OrbTone = "default" | "warning";

export interface VoicePresenceProps {
  state: OrbState;
  /** 0..1 — used only when state === "speaking" to drive the scale envelope. */
  audioLevel?: number;
  /** When "warning", the halo recolors to --attention-warning per DESIGN.md §7. */
  tone?: OrbTone;
  className?: string;
}

const ARIA_LABEL: Record<OrbState, string> = {
  idle: "Sift is idle",
  listening: "Sift is listening",
  thinking: "Sift is thinking",
  speaking: "Sift is speaking",
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export const VoicePresence = React.forwardRef<HTMLDivElement, VoicePresenceProps>(
  function VoicePresence(
    { state, audioLevel = 0, tone = "default", className },
    ref,
  ) {
    const level = clamp01(audioLevel);

    // DESIGN.md §7: AI speaking maps RMS to 0.96..1.06 scale with 80ms ease-out.
    const scale = state === "speaking" ? 0.96 + level * 0.1 : 1;
    // DESIGN.md §7: halo opacity follows envelope on 0.35..0.65 when speaking.
    const haloOpacity =
      state === "speaking"
        ? 0.35 + level * 0.3
        : state === "thinking"
          ? 0.5
          : 0.4;

    // Halo color: warning swaps to --attention-warning; thinking swaps to --ai-thinking.
    const haloColor =
      tone === "warning"
        ? "var(--attention-warning)"
        : state === "thinking"
          ? "var(--ai-thinking)"
          : "var(--orb-core)";

    return (
      <div
        ref={ref}
        role="status"
        aria-label={ARIA_LABEL[state]}
        data-state={state}
        data-tone={tone}
        className={cn(
          "relative inline-flex items-center justify-center",
          className,
        )}
        style={{
          transform: `scale(${scale.toFixed(3)})`,
          transition: "transform 80ms cubic-bezier(0.22,0.61,0.36,1)",
          width: "clamp(140px, 16vw, 220px)",
          height: "clamp(140px, 16vw, 220px)",
        }}
      >
        <span
          aria-hidden
          data-testid="voice-presence-halo"
          className={cn(
            "absolute inset-0 rounded-pill",
            "motion-safe:[animation:orbHaloPulse_3s_ease-in-out_infinite]",
            state === "thinking" && "motion-safe:[animation-duration:1.2s]",
          )}
          style={{
            backgroundColor: haloColor,
            boxShadow: "0 0 56px var(--orb-halo)",
            opacity: haloOpacity,
          }}
        />
        <span
          aria-hidden
          className="relative size-1/2 rounded-pill"
          style={{ backgroundColor: "var(--orb-core)" }}
        />
      </div>
    );
  },
);
