"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { listInterviews } from "@/services/interview.service";
import { useInterviewFilterStore } from "@/stores/useInterviewFilterStore";
import type { Interview } from "@/types";

const PAGE_SIZE = 20;

export function useInterviewList() {
  const { statusFilter, setFilter } = useInterviewFilterStore();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const query = useQuery({
    queryKey: ["interviews"],
    queryFn: async () => {
      const result = await listInterviews();
      if (!result.ok) throw result.error;
      return result.value;
    },
  });

  const all = useMemo(
    () => query.data?.interviews ?? [],
    [query.data?.interviews],
  );

  const availableStatuses = useMemo(
    () => new Set(all.map((i) => i.status)),
    [all],
  );

  const filtered = useMemo<Interview[]>(() => {
    if (statusFilter === "ALL") return all;
    return all.filter((i) => i.status === statusFilter);
  }, [all, statusFilter]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as { kind?: string } | null,
    interviews: visible,
    total: filtered.length,
    canLoadMore: filtered.length > visibleCount,
    loadMore: () => setVisibleCount((c) => c + PAGE_SIZE),
    refetch: query.refetch,
    statusFilter,
    setFilter,
    availableStatuses,
  };
}
