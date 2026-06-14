"use client";

import type { NewInterviewForm } from "../useNewInterview";
import { Label } from "@repo/ui/primitives/label";
import { Textarea } from "@repo/ui/primitives/textarea";
import { Input } from "@repo/ui/primitives/input";

interface Props {
  form: NewInterviewForm;
}

export function Step3Instructions({ form }: Props) {
  const { register, formState: { errors } } = form;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="clientInstructions">Special instructions (optional)</Label>
        <Textarea
          id="clientInstructions"
          placeholder="Focus areas, things to avoid, candidate context…"
          {...register("clientInstructions")}
        />
        {errors.clientInstructions && <p className="text-sm text-negative">{errors.clientInstructions.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="targetDurationMinutes">Target duration (min)</Label>
          <Input
            id="targetDurationMinutes"
            type="number"
            min={5}
            max={60}
            {...register("targetDurationMinutes")}
            aria-invalid={!!errors.targetDurationMinutes}
          />
          {errors.targetDurationMinutes && <p className="text-sm text-negative">{errors.targetDurationMinutes.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="maxDurationMinutes">Max duration (min)</Label>
          <Input
            id="maxDurationMinutes"
            type="number"
            min={10}
            max={120}
            {...register("maxDurationMinutes")}
            aria-invalid={!!errors.maxDurationMinutes}
          />
          {errors.maxDurationMinutes && <p className="text-sm text-negative">{errors.maxDurationMinutes.message}</p>}
        </div>
      </div>
    </div>
  );
}
