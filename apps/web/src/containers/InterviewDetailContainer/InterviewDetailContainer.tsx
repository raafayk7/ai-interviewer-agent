"use client";

import { Skeleton } from "@repo/ui/primitives/skeleton";
import { InterviewStatusBadge } from "@repo/ui/composites/interview-status-badge";
import { ShareLinkPanel } from "@/components/ShareLinkPanel";
import { EvaluateButton } from "@/components/EvaluateButton";
import { ReportViewer } from "@/components/ReportViewer";
import { useInterviewDetail } from "./useInterviewDetail";

interface Props {
  interviewId: string;
}

export function InterviewDetailContainer({ interviewId }: Props) {
  const {
    interviewQuery,
    reportQuery,
    candidateLinkQuery,
    reissueLinkMutation,
    evaluateMutation,
    status,
  } = useInterviewDetail(interviewId);

  if (interviewQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (interviewQuery.isError) {
    return (
      <p className="text-sm text-negative" role="alert">
        Couldn&apos;t load interview details. Try again.
      </p>
    );
  }

  const interview = interviewQuery.data?.interview;
  if (!interview) return null;

  const candidateLink = candidateLinkQuery.data;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl">{interview.candidateInfo.fullName}</h2>
          <p className="text-sm text-muted-foreground">
            {interview.jobDescription.title} · {interview.jobDescription.company}
          </p>
        </div>
        <InterviewStatusBadge status={status!} />
      </div>

      {/* Status-dependent content */}
      {status === "CREATED" && (
        <p className="text-sm text-muted-foreground">Interview plan not yet generated.</p>
      )}

      {(status === "SCHEDULED" || status === "IN_PROGRESS") && (
        <>
          {candidateLinkQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Preparing candidate link…</p>
          )}
          {candidateLinkQuery.isError && (
            <p className="text-sm text-muted-foreground">
              This interview can no longer be shared.
            </p>
          )}
          {candidateLink && (
            <ShareLinkPanel
              url={candidateLink.url}
              expiresInSeconds={candidateLink.expiresInSeconds}
              onReissue={() => reissueLinkMutation.mutate()}
              isReissuing={reissueLinkMutation.isPending}
            />
          )}
          {status === "IN_PROGRESS" && (
            <p className="text-sm text-muted-foreground">Interview is in progress.</p>
          )}
        </>
      )}

      {status === "COMPLETED" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The interview has finished. Run evaluation to generate the screening report.
          </p>
          <EvaluateButton
            onEvaluate={() => evaluateMutation.mutate()}
            isPending={evaluateMutation.isPending}
          />
          {evaluateMutation.isError && (
            <p className="text-sm text-negative" role="alert">
              Evaluation failed. Try again.
            </p>
          )}
        </div>
      )}

      {status === "EVALUATED" && (
        <>
          {reportQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading report…</p>
          )}
          {reportQuery.isError && (
            <p className="text-sm text-negative" role="alert">
              Couldn&apos;t load report. Try again.
            </p>
          )}
          {reportQuery.data?.report && <ReportViewer report={reportQuery.data.report} />}
        </>
      )}

      {status === "CANCELLED" && (
        <p className="text-sm text-muted-foreground">This interview was cancelled.</p>
      )}

      {status === "FAILED" && (
        <p className="text-sm text-muted-foreground">
          This interview did not complete. The candidate session is no longer
          available.
        </p>
      )}
    </div>
  );
}
