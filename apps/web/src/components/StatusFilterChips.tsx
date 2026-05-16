"use client";

import { Button } from "@repo/ui/primitives/button";
import type { InterviewStatus } from "@/types";
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
  availableStatuses: Set<InterviewStatus>;
}

export function StatusFilterChips({ statusFilter, onChange, availableStatuses }: Props) {
  const visible = CHIPS.filter(
    (chip) => chip.value === "ALL" || availableStatuses.has(chip.value as InterviewStatus),
  );

  return (
    <div role="tablist" aria-label="Filter interviews by status" className="flex flex-wrap gap-2">
      {visible.map((chip) => {
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
