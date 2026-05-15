import { cn } from "@repo/ui/lib/cn";

export interface StepperHeaderProps {
  steps: ReadonlyArray<string>;
  currentIndex: number;
}

export function StepperHeader({ steps, currentIndex }: StepperHeaderProps) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((label, i) => {
        const completed = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={label} className="flex items-center gap-3">
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
            <span className={cn("text-xs", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
