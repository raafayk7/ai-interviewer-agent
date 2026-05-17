"use client";

import { VoicePresence, type OrbState, type OrbTone } from "@repo/ui/composites/voice-presence";
import { TranscriptFeed } from "@repo/ui/composites/transcript-feed";
import { MicLevelMeter } from "@repo/ui/composites/mic-level-meter";
import {
  ConnectionLossBanner,
  type ConnectionLossBannerState,
} from "@repo/ui/composites/connection-loss-banner";
import {
  useInterviewSessionStore,
  type ConnectionState,
  type SpeakerState,
} from "@/stores/useInterviewSessionStore";
import type { CandidateInterviewView } from "@/types";
import { useInterviewSession } from "./useInterviewSession";

function speakerToOrbState(speaker: SpeakerState): OrbState {
  if (speaker === "ai") return "speaking";
  if (speaker === "candidate") return "listening";
  return "thinking";
}

function deriveOrb(
  connectionState: ConnectionState,
  speaker: SpeakerState,
): { state: OrbState; tone: OrbTone } {
  if (connectionState === "completed" || connectionState === "interrupted") {
    return { state: "idle", tone: "default" };
  }
  if (connectionState === "reconnecting") {
    return { state: speakerToOrbState(speaker), tone: "warning" };
  }
  return { state: speakerToOrbState(speaker), tone: "default" };
}

function deriveBanner(
  connectionState: ConnectionState,
): ConnectionLossBannerState | null {
  if (connectionState === "reconnecting") return "reconnecting";
  if (connectionState === "interrupted") return "failed";
  return null;
}

export function InterviewSessionContainer({
  view,
  token,
}: {
  view: CandidateInterviewView;
  token: string;
}) {
  const connectionState = useInterviewSessionStore((s) => s.connectionState);
  const speaker = useInterviewSessionStore((s) => s.speaker);
  const transcript = useInterviewSessionStore((s) => s.transcript);
  const transcriptVisible = useInterviewSessionStore((s) => s.transcriptVisible);
  const audioLevel = useInterviewSessionStore((s) => s.audioLevel);
  useInterviewSession({ interviewId: view.interviewId, token });

  const bannerState = deriveBanner(connectionState);
  const { state: orbState, tone: orbTone } = deriveOrb(connectionState, speaker);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background">
      {bannerState && <ConnectionLossBanner state={bannerState} />}
      <VoicePresence state={orbState} tone={orbTone} audioLevel={audioLevel} />
      {transcriptVisible && transcript.length > 0 && (
        <div className="mt-12 w-full">
          <TranscriptFeed entries={transcript} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-2 px-6">
        <MicLevelMeter level={audioLevel} />
      </div>
    </main>
  );
}
