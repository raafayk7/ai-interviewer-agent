"use client";

import Link from "next/link";
import { InterviewStatusBadge } from "@repo/ui/composites/interview-status-badge";
import type { Interview } from "@/types";

export function InterviewListRow({ interview }: { interview: Interview }) {
  return (
    <Link
      href={`/interviews/${interview.id}`}
      className="grid grid-cols-[2fr_3fr_auto_auto] items-center gap-6 rounded-md border border-border bg-card px-5 py-4 transition-colors hover:bg-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-1">
        <span className="font-heading text-sm font-semibold">
          {interview.candidateInfo.fullName}
        </span>
        <span className="text-xs text-muted-foreground">{interview.candidateInfo.email}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm">{interview.jobDescription.title}</span>
        <span className="text-xs text-muted-foreground">{interview.jobDescription.company}</span>
      </div>
      <InterviewStatusBadge status={interview.status} />
      <span className="text-xs tabular-nums text-muted-foreground">
        {new Date(interview.scheduledAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
