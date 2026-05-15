"use client";

import { Button } from "@repo/ui/primitives/button";
import { Skeleton } from "@repo/ui/primitives/skeleton";
import Link from "next/link";
import { useInterviewList } from "./useInterviewList";
import { StatusFilterChips } from "@/components/StatusFilterChips";
import { InterviewListRow } from "@/components/InterviewListRow";
import { EmptyDashboardState } from "@/components/EmptyDashboardState";

export function InterviewListContainer() {
  const { isLoading, isError, error, interviews, total, canLoadMore, loadMore, statusFilter, setFilter } =
    useInterviewList();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <StatusFilterChips statusFilter={statusFilter} onChange={setFilter} />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isError) {
    const message =
      (error as { kind?: string } | null)?.kind === "NETWORK"
        ? "Connection lost. Try again."
        : "Couldn't load interviews. Try again.";
    return (
      <p className="text-sm text-negative" role="alert">
        {message}
      </p>
    );
  }

  if (total === 0) {
    return (
      <EmptyDashboardState
        action={
          <Button asChild variant="primary">
            <Link href="/interviews/new">New interview</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StatusFilterChips statusFilter={statusFilter} onChange={setFilter} />
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[2fr_2fr_140px_130px_110px] gap-4 px-5 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Candidate</span>
          <span>Role</span>
          <span>Status</span>
          <span>When</span>
          <span>ID</span>
        </div>
        {interviews.map((i) => (
          <InterviewListRow key={i.id} interview={i} />
        ))}
      </div>
      {canLoadMore && (
        <Button variant="ghost" onClick={loadMore} className="self-center">
          Load more
        </Button>
      )}
    </div>
  );
}
