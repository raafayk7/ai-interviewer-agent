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

export function RecommendationBadge({ recommendation }: { recommendation: RecommendationValue }) {
  return <Badge variant={VARIANT[recommendation]}>{LABEL[recommendation]}</Badge>;
}
