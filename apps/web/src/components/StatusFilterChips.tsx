"use client";

import { Button } from "@repo/ui/primitives/button";
import type { InterviewStatusFilter } from "@/stores/useInterviewFilterStore";

const CHIPS: { value: InterviewStatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "EVALUATED", label: "Report ready" },
  { value: "COMPLETED", label: "Awaiting evaluation" },
];

interface Props {
  statusFilter: InterviewStatusFilter;
  onChange: (filter: InterviewStatusFilter) => void;
}

export function StatusFilterChips({ statusFilter, onChange }: Props) {
  return (
    <div role="tablist" aria-label="Filter interviews by status" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const active = statusFilter === chip.value;
        return (
          <Button
            key={chip.value}
            role="tab"
            aria-selected={active}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onChange(chip.value)}
          >
            {chip.label}
          </Button>
        );
      })}
    </div>
  );
}
