"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@repo/ui/primitives/avatar";
import { InterviewStatusBadge } from "@repo/ui/composites/interview-status-badge";
import type { Interview } from "@/types";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function smartTime(interview: Interview): string {
  const { status, scheduledAt, startedAt, updatedAt } = interview;
  const now = Date.now();
  const ago = (d: Date) => {
    const mins = Math.round((now - d.getTime()) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
  if (status === "IN_PROGRESS" && startedAt) {
    const mins = Math.floor((now - startedAt.getTime()) / 60_000);
    const secs = Math.floor(((now - startedAt.getTime()) % 60_000) / 1000);
    return `${mins}:${String(secs).padStart(2, "0")} elapsed`;
  }
  if (
    status === "EVALUATED" ||
    status === "COMPLETED" ||
    status === "CANCELLED"
  )
    return ago(updatedAt);
  if (status === "SCHEDULED" || status === "CREATED") {
    return scheduledAt.toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "";
}

export function InterviewListRow({ interview: i }: { interview: Interview }) {
  const idPrefix = `INT_${i.id.slice(0, 6)}`;
  const planSummary = i.interviewPlan
    ? `${i.interviewPlan.topics.length} topics, ${i.interviewPlan.targetDurationMinutes} min`
    : "Plan pending";

  return (
    <Link
      href={`/interviews/${i.id}`}
      className="grid grid-cols-[2fr_2fr_140px_130px_110px] items-center gap-4 rounded-md border border-border bg-card px-5 py-3.5 transition-colors hover:bg-popover hover:border-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="size-8">
          <AvatarFallback>{initials(i.candidateInfo.fullName)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-heading text-base truncate leading-tight">
            {i.candidateInfo.fullName}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {i.candidateInfo.headline} · {i.candidateInfo.yearsOfExperience} yrs
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm truncate">{i.jobDescription.title}</span>
        <span className="text-xs text-muted-foreground truncate">
          {i.jobDescription.company} · {planSummary}
        </span>
      </div>
      <InterviewStatusBadge status={i.status} />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {smartTime(i)}
      </span>
      <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
        {idPrefix}
      </span>
    </Link>
  );
}
