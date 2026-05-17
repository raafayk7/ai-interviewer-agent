"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/primitives/card";
import { CandidatePageShell } from "@/components/CandidatePageShell";
import type { CandidateInterviewView } from "@/types";
import { usePostInterview } from "./usePostInterview";

export function PostInterviewContainer({
  view,
  token,
}: {
  view: CandidateInterviewView;
  token: string;
}) {
  const { view: cur, isTerminal } = usePostInterview({ initial: view, token });
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">
            {isTerminal ? "Thanks, you're done." : "Wrapping up…"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {isTerminal
              ? "Your recruiter will be in touch. You can safely close this tab."
              : "We're saving your session — this only takes a moment."}
          </p>
          {cur && (
            <p className="mt-3 text-sm text-muted-foreground">
              {cur.jobTitle} · {cur.company}
            </p>
          )}
        </CardContent>
      </Card>
    </CandidatePageShell>
  );
}
