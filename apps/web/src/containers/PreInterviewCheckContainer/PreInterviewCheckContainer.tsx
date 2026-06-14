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
import { StepperHeader } from "@repo/ui/composites/stepper-header";
import { MicLevelMeter } from "@repo/ui/composites/mic-level-meter";
import { CandidatePageShell } from "@/components/CandidatePageShell";
import type { CandidateInterviewView } from "@/types";
import {
  STEP_LABELS,
  usePreInterviewCheck,
  type UsePreInterviewCheckResult,
} from "./usePreInterviewCheck";

export function PreInterviewCheckContainer({
  view,
  token,
}: {
  view: CandidateInterviewView;
  token: string;
}) {
  const c = usePreInterviewCheck();

  return (
    <CandidatePageShell>
      <div className="space-y-10">
        <StepperHeader steps={STEP_LABELS} currentIndex={c.stepIndex} />
        <Card>
          {c.step === "mic" && <MicStep c={c} />}
          {c.step === "audio" && <AudioStep c={c} />}
          {c.step === "quiet" && <QuietStep />}
          {c.step === "ready" && <ReadyStep c={c} view={view} token={token} />}
          <StepFooter c={c} />
        </Card>
      </div>
    </CandidatePageShell>
  );
}

function MicStep({ c }: { c: UsePreInterviewCheckResult }) {
  return (
    <>
      <CardHeader>
        <CardTitle as="h2">Mic check</CardTitle>
        <p className="text-muted-foreground">
          Try saying &ldquo;hello&rdquo; — we&rsquo;ll show your level below.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {c.permission === "idle" && (
          <Button onClick={() => void c.requestMic()}>Enable microphone</Button>
        )}
        {c.permission === "requesting" && (
          <p className="text-muted-foreground">Waiting for permission…</p>
        )}
        {c.permission === "denied" && (
          <p className="text-attention-warning">
            We can&rsquo;t hear you. Allow microphone access in your browser
            and refresh this page.
          </p>
        )}
        {c.permission === "granted" && (
          <>
            <MicLevelMeter level={c.level} />
            <p className="text-sm text-muted-foreground">
              {c.outcome === "passed"
                ? "Got it — you’re coming through clearly."
                : "Speak now to confirm your mic is working."}
            </p>
          </>
        )}
      </CardContent>
    </>
  );
}

function AudioStep({ c }: { c: UsePreInterviewCheckResult }) {
  return (
    <>
      <CardHeader>
        <CardTitle as="h2">Audio test</CardTitle>
        <p className="text-muted-foreground">
          Play a short sample of Sift&rsquo;s voice to check your speakers.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={c.playSample} disabled={c.audioTestState === "playing"}>
          {c.audioTestState === "playing" ? "Playing…" : "Play Sift sample"}
        </Button>
        {c.audioTestState === "browser-unsupported" && (
          <p className="text-attention-warning">
            Audio playback isn&rsquo;t working in your browser. Sift works best
            in Chrome, Edge, or Firefox. Please switch browsers and reopen
            your link.
          </p>
        )}
        {c.audioTestState === "played" && (
          <p className="text-sm text-muted-foreground">
            You should have heard a short greeting.
          </p>
        )}
      </CardContent>
    </>
  );
}

function QuietStep() {
  return (
    <>
      <CardHeader>
        <CardTitle as="h2">Find a quiet space</CardTitle>
        <p className="text-muted-foreground">
          Close noisy tabs, silence notifications, and let anyone nearby know
          you&rsquo;ll need fifteen quiet minutes.
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          The interview is a real-time voice conversation. Background noise
          and interruptions can make it harder for Sift to understand you.
        </p>
      </CardContent>
    </>
  );
}

function ReadyStep({
  c,
  view,
  token,
}: {
  c: UsePreInterviewCheckResult;
  view: CandidateInterviewView;
  token: string;
}) {
  return (
    <>
      <CardHeader>
        <CardTitle as="h2">You&rsquo;re ready.</CardTitle>
        <p className="text-muted-foreground">
          One last thing — choose whether you want to see a live transcript
          during the interview.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded-xs border-input bg-input"
            checked={c.transcriptVisible}
            onChange={(e) => c.setTranscriptVisible(e.target.checked)}
          />
          <span>Show live transcript during the interview</span>
        </label>
        <p className="text-xs text-muted-foreground">
          You can change this later from the gear menu during the interview.
        </p>
        <div className="pt-4">
          <Button asChild>
            <Link
              href={{
                pathname: `/c/${view.interviewId}/session`,
                query: { token },
              }}
            >
              Enter interview
            </Link>
          </Button>
        </div>
      </CardContent>
    </>
  );
}

function StepFooter({ c }: { c: UsePreInterviewCheckResult }) {
  const nextDisabled = isNextDisabled(c);
  if (c.step === "ready") return null;
  return (
    <CardFooter className="justify-between">
      <Button variant="ghost" onClick={c.prev} disabled={c.stepIndex === 0}>
        Back
      </Button>
      <Button onClick={c.next} disabled={nextDisabled}>
        Next
      </Button>
    </CardFooter>
  );
}

function isNextDisabled(c: UsePreInterviewCheckResult): boolean {
  if (c.step === "mic") return c.outcome !== "passed";
  if (c.step === "audio")
    return (
      c.audioTestState !== "played" &&
      c.audioTestState !== "browser-unsupported"
    );
  return false;
}
