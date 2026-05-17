"use client";

import Link from "next/link";
import { Button } from "@repo/ui/primitives/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/primitives/card";
import { CandidatePageShell } from "@/components/CandidatePageShell";
import type { CandidateInterviewView } from "@/types";
import { useCandidateLanding } from "./useCandidateLanding";

export function CandidateLandingContainer({
  view,
  token,
}: {
  view: CandidateInterviewView;
  token: string;
}) {
  const vm = useCandidateLanding(view);
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{vm.greeting}</CardTitle>
          <p className="text-muted-foreground">{vm.jobLine}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>{vm.scheduledLine}</p>
          <p className="text-muted-foreground">{vm.durationLine}</p>
          {vm.blockedReason && (
            <p className="text-attention-warning">{vm.blockedReason}</p>
          )}
        </CardContent>
        <CardFooter>
          {vm.ctaEnabled ? (
            <Button asChild>
              <Link
                href={{
                  pathname: `/c/${view.interviewId}/check`,
                  query: { token },
                }}
              >
                {vm.ctaCopy}
              </Link>
            </Button>
          ) : (
            <Button disabled>{vm.ctaCopy}</Button>
          )}
        </CardFooter>
      </Card>
    </CandidatePageShell>
  );
}
