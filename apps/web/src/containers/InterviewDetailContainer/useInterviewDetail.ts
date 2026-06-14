"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInterview,
  getReport,
  evaluateInterview,
  issueCandidateLink,
} from "@/services/interview.service";

const LINK_SHAREABLE_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;
type LinkShareableStatus = (typeof LINK_SHAREABLE_STATUSES)[number];

function isLinkShareable(s: string | undefined): s is LinkShareableStatus {
  return LINK_SHAREABLE_STATUSES.includes(s as LinkShareableStatus);
}

export function useInterviewDetail(interviewId: string) {
  const qc = useQueryClient();

  const interviewQuery = useQuery({
    queryKey: ["interview", interviewId],
    queryFn: async () => {
      const r = await getInterview(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
  });

  const status = interviewQuery.data?.interview.status;

  const candidateLinkQuery = useQuery({
    queryKey: ["candidate-link", interviewId],
    queryFn: async () => {
      const r = await issueCandidateLink(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: isLinkShareable(status),
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      const e = error as { kind?: string; code?: string };
      if (e?.kind === "SERVER" && e.code === "INVALID_INTERVIEW_STATE_TRANSITION") return false;
      return failureCount < 2;
    },
  });

  const reissueLinkMutation = useMutation({
    mutationFn: async () => {
      const r = await issueCandidateLink(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (data) => {
      qc.setQueryData(["candidate-link", interviewId], data);
    },
  });

  const reportQuery = useQuery({
    queryKey: ["report", interviewId],
    queryFn: async () => {
      const r = await getReport(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: status === "EVALUATED",
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const r = await evaluateInterview(interviewId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interview", interviewId] });
      qc.invalidateQueries({ queryKey: ["report", interviewId] });
    },
  });

  return {
    interviewQuery,
    reportQuery,
    candidateLinkQuery,
    reissueLinkMutation,
    evaluateMutation,
    status,
  };
}
