"use client";

import type { ExtractDocumentsResponse } from "@/types";

interface Props {
  extracted: ExtractDocumentsResponse | null;
  isExtracting: boolean;
  isLaunching: boolean;
}

export function Step4ReviewLaunch({ extracted, isExtracting, isLaunching }: Props) {
  if (isExtracting) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-muted-foreground">Analysing documents…</p>
      </div>
    );
  }

  if (!extracted) {
    return <p className="text-sm text-negative">Extraction failed. Go back and try again.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Review the details below. Click Launch to generate the interview plan and issue the candidate link.</p>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Role</span>
          <span className="font-medium">{extracted.jobDescription.title}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Company</span>
          <span className="font-medium">{extracted.jobDescription.company}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Candidate</span>
          <span className="font-medium">{extracted.candidateInfo.fullName}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Experience</span>
          <span className="font-medium">{extracted.candidateInfo.yearsOfExperience} yr{extracted.candidateInfo.yearsOfExperience !== 1 ? "s" : ""}</span>
        </div>
      </div>
      {isLaunching && <p className="text-sm text-muted-foreground">Generating interview plan…</p>}
    </div>
  );
}
