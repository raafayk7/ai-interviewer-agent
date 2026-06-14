"use client";

import { cn } from "@repo/ui/lib/cn";

export interface MicLevelMeterProps {
  /**
   * 0..1; while the mic is open but silent, container drives a 0.04..0.05
   * breathing pulse over 4s per DESIGN.md §7.
   */
  level: number;
  className?: string;
}

// DESIGN.md §7: 3px tall, max-width 360px, --voice-active at 0.7 opacity.
export function MicLevelMeter({ level, className }: MicLevelMeterProps) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <div
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      className={cn(
        "mx-auto h-[3px] w-full max-w-[360px] overflow-hidden rounded-pill bg-muted/40",
        className,
      )}
    >
      <div
        data-testid="mic-level-fill"
        className="h-full origin-left rounded-pill bg-voice-active opacity-70 transition-[width] duration-150 ease-out"
        style={{ width: `${(clamped * 100).toFixed(1)}%` }}
      />
    </div>
  );
}
