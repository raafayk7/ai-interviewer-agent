import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@repo/ui/lib/cn";

export const badgeVariants = cva(
  [
    "inline-flex items-center gap-1",
    "rounded-pill",
    "font-medium tracking-wide",
    "transition-colors duration-150 ease-out",
  ],
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        secondary: "bg-muted text-muted-foreground",
        outline: "border border-border text-foreground bg-transparent",
        positive: "bg-positive text-positive-foreground",
        "attention-warning": "bg-attention-warning text-attention-warning-foreground",
        negative: "bg-negative text-negative-foreground",
      },
      size: {
        default: "h-6 px-2.5 text-xs",
        sm: "h-5 px-2 text-[11px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && (
        <span
          className="block size-1.5 rounded-full bg-current shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
Badge.displayName = "Badge";
