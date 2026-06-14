import { Badge, type BadgeProps } from "@repo/ui/primitives/badge";

export type RecommendationValue = "advance" | "hold" | "reject";

const VARIANT: Record<RecommendationValue, BadgeProps["variant"]> = {
  advance: "positive",
  hold: "attention-warning",
  reject: "negative",
};

const LABEL: Record<RecommendationValue, string> = {
  advance: "Advance",
  hold: "Hold",
  reject: "Reject",
};

interface RecommendationBadgeProps {
  recommendation: RecommendationValue;
  size?: BadgeProps["size"];
}

export function RecommendationBadge({ recommendation, size }: RecommendationBadgeProps) {
  return (
    <Badge variant={VARIANT[recommendation]} size={size}>
      {LABEL[recommendation]}
    </Badge>
  );
}
