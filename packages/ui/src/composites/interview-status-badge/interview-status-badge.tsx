import { Badge, type BadgeProps } from "@repo/ui/primitives/badge";
import { cn } from "@repo/ui/lib/cn";

export type InterviewStatusValue =
  | "CREATED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EVALUATED"
  | "CANCELLED";

const VARIANT: Record<InterviewStatusValue, BadgeProps["variant"]> = {
  CREATED: "secondary",
  SCHEDULED: "default",
  IN_PROGRESS: "positive",
  COMPLETED: "outline",
  EVALUATED: "positive",
  CANCELLED: "negative",
};

const LABEL: Record<InterviewStatusValue, string> = {
  CREATED: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  EVALUATED: "Report ready",
  CANCELLED: "Cancelled",
};

export interface InterviewStatusBadgeProps {
  status: InterviewStatusValue;
  className?: string;
}

export function InterviewStatusBadge({ status, className }: InterviewStatusBadgeProps) {
  return (
    <Badge
      variant={VARIANT[status]}
      dot={status === "IN_PROGRESS"}
      className={cn(className)}
    >
      {LABEL[status]}
    </Badge>
  );
}
