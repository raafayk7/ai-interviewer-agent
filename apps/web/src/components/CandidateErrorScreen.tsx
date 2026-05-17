import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/primitives/card";
import { CandidatePageShell } from "./CandidatePageShell";

export type CandidateErrorKind =
  | "invalid-link"
  | "expired-link"
  | "interview-not-ready"
  | "mic-denied"
  | "session-interrupted"
  | "network";

const COPY: Record<
  CandidateErrorKind,
  { title: string; body: string; hint?: string }
> = {
  "invalid-link": {
    title: "This link doesn't look right.",
    body: "Check the link your recruiter sent — the token in the URL is missing or invalid.",
  },
  "expired-link": {
    title: "This link has expired.",
    body: "Candidate links are valid for 7 days. Please ask your recruiter for a fresh link.",
  },
  "interview-not-ready": {
    title: "This interview isn't ready yet.",
    body: "Your recruiter hasn't finished scheduling. They'll send a new link when it's ready.",
  },
  "mic-denied": {
    title: "We can't hear you.",
    body: "Sift needs microphone access for the interview.",
    hint: "Click the lock icon in your browser's address bar and allow microphone access, then refresh this page.",
  },
  "session-interrupted": {
    title: "Your session was interrupted.",
    body: "We couldn't reconnect after 60 seconds. Your progress is saved.",
    hint: "Refresh this page to try again, or contact your recruiter if the issue persists.",
  },
  network: {
    title: "We can't reach Sift right now.",
    body: "Check your connection and try again in a moment.",
  },
};

export function CandidateErrorScreen({ kind }: { kind: CandidateErrorKind }) {
  const copy = COPY[kind];
  return (
    <CandidatePageShell>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">{copy.body}</p>
          {copy.hint && (
            <p className="text-sm text-muted-foreground">{copy.hint}</p>
          )}
        </CardContent>
      </Card>
    </CandidatePageShell>
  );
}
