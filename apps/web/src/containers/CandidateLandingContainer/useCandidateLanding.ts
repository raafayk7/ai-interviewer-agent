"use client";

import { useMemo } from "react";
import type { CandidateInterviewView, InterviewStatus } from "@/types";

export interface CandidateLandingViewModel {
  greeting: string;
  jobLine: string;
  scheduledLine: string;
  durationLine: string;
  ctaEnabled: boolean;
  ctaCopy: string;
  blockedReason?: string;
}

const BLOCKED_COPY: Partial<Record<InterviewStatus, string>> = {
  COMPLETED: "This interview has already been completed.",
  EVALUATED: "This interview has already been completed.",
  IN_PROGRESS: "This interview is already in progress.",
  CANCELLED: "This interview was cancelled.",
  FAILED: "This interview didn't complete. Please reach out to the recruiter who invited you.",
};

export function useCandidateLanding(
  view: CandidateInterviewView,
): CandidateLandingViewModel {
  return useMemo(() => {
    const firstName = view.candidateName.split(/\s+/)[0] ?? "there";
    const ctaEnabled = view.status === "SCHEDULED";
    return {
      greeting: `Hi, ${firstName}.`,
      jobLine: `${view.jobTitle} · ${view.company}`,
      scheduledLine: `Scheduled for ${view.scheduledAt.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`,
      durationLine:
        view.targetDurationMinutes == null
          ? "Target length: not set"
          : `Target length: ${view.targetDurationMinutes} min`,
      ctaEnabled,
      ctaCopy: ctaEnabled ? "Begin device check" : "Interview not available",
      blockedReason: ctaEnabled
        ? undefined
        : BLOCKED_COPY[view.status] ?? "This interview isn't ready yet.",
    };
  }, [view]);
}
