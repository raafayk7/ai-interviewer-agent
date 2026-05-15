"use client";

import { Button } from "@repo/ui/primitives/button";

interface Props {
  onEvaluate: () => void;
  isPending: boolean;
}

export function EvaluateButton({ onEvaluate, isPending }: Props) {
  return (
    <Button onClick={onEvaluate} disabled={isPending} variant="primary">
      {isPending ? "Evaluating…" : "Run evaluation"}
    </Button>
  );
}
