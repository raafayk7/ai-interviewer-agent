import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export interface StepperHeaderProps {
  steps: ReadonlyArray<string>;
  currentIndex: number;
}

export function StepperHeader({ steps, currentIndex }: StepperHeaderProps) {
  return (
    // pb-7 reserves vertical space for the absolutely-positioned labels below
    <ol className="relative flex w-full items-start px-12 pb-7" aria-label="Progress">
      {steps.map((label, i) => {
        const completed = i < currentIndex;
        const active = i === currentIndex;
        return (
          <React.Fragment key={label}>
            <li className="relative flex shrink-0 flex-col items-center">
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-pill text-xs font-medium tabular-nums",
                  completed && "bg-primary text-primary-foreground",
                  active && "bg-secondary text-secondary-foreground ring-1 ring-ring",
                  !completed && !active && "bg-muted text-muted-foreground",
                )}
                aria-current={active ? "step" : undefined}
              >
                {i + 1}
              </div>
              {/* Label is absolutely positioned — does not contribute to column width */}
              <span
                className={cn(
                  "absolute left-1/2 top-full mt-2 -translate-x-1/2",
                  "text-xs whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
            {i < steps.length - 1 && (
              <span aria-hidden className="mx-2 mt-3.5 h-px flex-1 bg-border" />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}