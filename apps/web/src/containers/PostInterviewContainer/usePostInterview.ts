"use client";

import { useQuery } from "@tanstack/react-query";
import { getCandidateInterviewView } from "@/services/candidate.service";
import { isTerminalStatus, type CandidateInterviewView } from "@/types";

const MAX_POLLS = 5;
const POLL_INTERVAL_MS = 30_000;

export interface UsePostInterviewResult {
  view: CandidateInterviewView | undefined;
  isTerminal: boolean;
}

export function usePostInterview(args: {
  initial: CandidateInterviewView;
  token: string;
}): UsePostInterviewResult {
  const q = useQuery({
    queryKey: ["candidate-view", args.initial.interviewId],
    initialData: args.initial,
    queryFn: async () => {
      const result = await getCandidateInterviewView({
        interviewId: args.initial.interviewId,
        token: args.token,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && isTerminalStatus(data.status)) return false;
      if (query.state.dataUpdateCount >= MAX_POLLS) return false;
      return POLL_INTERVAL_MS;
    },
  });

  return {
    view: q.data,
    isTerminal: q.data ? isTerminalStatus(q.data.status) : false,
  };
}
