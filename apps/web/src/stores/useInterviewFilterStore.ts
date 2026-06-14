import { create } from "zustand";
import type { InterviewStatus } from "@/types";

export type InterviewStatusFilter = InterviewStatus | "ALL";

interface InterviewFilterState {
  statusFilter: InterviewStatusFilter;
  setFilter: (filter: InterviewStatusFilter) => void;
  reset: () => void;
}

export const useInterviewFilterStore = create<InterviewFilterState>((set) => ({
  statusFilter: "ALL",
  setFilter: (statusFilter) => set({ statusFilter }),
  reset: () => set({ statusFilter: "ALL" }),
}));
