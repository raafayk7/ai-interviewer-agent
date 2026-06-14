"use client";

import { VoicePresence, type OrbState, type OrbTone } from "@repo/ui/composites/voice-presence";
import { TranscriptFeed } from "@repo/ui/composites/transcript-feed";
import {
  ConnectionLossBanner,
  type ConnectionLossBannerState,
} from "@repo/ui/composites/connection-loss-banner";
import {
  SessionEndModal,
  type SessionEndVariant,
} from "@/components/SessionEndModal";
import {
  useInterviewSessionStore,
  type ConnectionState,
  type SpeakerState,
} from "@/stores/useInterviewSessionStore";
import { isTerminalStatus, type CandidateInterviewView } from "@/types";
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
  if (connectionState === "interrupted") {
    return { state: "idle", tone: "warning" };
  }
  if (connectionState === "completed" || connectionState === "blocked") {
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

function deriveEndModal(
  terminal: boolean,
  connectionState: ConnectionState,
): SessionEndVariant | null {
  if (terminal || connectionState === "blocked") return "blocked";
  if (connectionState === "completed") return "completed";
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
  const terminal = isTerminalStatus(view.status);

  useInterviewSession({ interviewId: view.interviewId, token, enabled: !terminal });

  const bannerState = deriveBanner(connectionState);
  const { state: orbState, tone: orbTone } = deriveOrb(connectionState, speaker);
  const endVariant = deriveEndModal(terminal, connectionState);

  return (
    <main className="relative flex h-dvh flex-col bg-background">
      {bannerState && <ConnectionLossBanner state={bannerState} />}

      <section className="flex shrink-0 items-center justify-center px-4 pt-16 pb-8">
        <VoicePresence state={orbState} tone={orbTone} />
      </section>

      {transcriptVisible && transcript.length > 0 && (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 pb-12">
          <TranscriptFeed entries={transcript} />
        </section>
      )}

      {endVariant && <SessionEndModal variant={endVariant} />}
    </main>
  );
}
