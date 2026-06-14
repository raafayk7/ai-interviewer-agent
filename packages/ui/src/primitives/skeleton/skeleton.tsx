import * as React from "react";
import { cn } from "@repo/ui/lib/cn";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn("animate-shimmer rounded-xs", className)} {...props} />;
}
Skeleton.displayName = "Skeleton";
