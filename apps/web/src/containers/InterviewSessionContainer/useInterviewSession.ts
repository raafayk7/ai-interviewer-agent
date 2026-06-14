"use client";

import { useEffect } from "react";
import { Conversation } from "@elevenlabs/client";
import { toast } from "sonner";
import type { ServiceError } from "@/services/errors";
import { startCandidateSession } from "@/services/candidate.service";
import {
  useInterviewSessionStore,
  type TranscriptEntry,
} from "@/stores/useInterviewSessionStore";

interface UseInterviewSessionArgs {
  interviewId: string;
  token: string;
  enabled: boolean;
}

// Map an SDK message turn onto a transcript entry. `role` is the
// non-deprecated discriminator on the SDK message payload ("user" | "agent");
// the agent's turns become "agent", the candidate's become "candidate".
function toTranscriptEntry(
  message: string,
  role: "user" | "agent",
): TranscriptEntry | null {
  if (message.length === 0) return null;
  return {
    speaker: role === "agent" ? "agent" : "candidate",
    text: message,
    timestamp: new Date(),
  };
}

function friendlyServiceError(kind: string): string {
  switch (kind) {
    case "NETWORK":
      return "We couldn't reach the interview service. Check your connection and try again.";
    case "AUTH":
      return "Your interview link is no longer valid.";
    case "NOT_FOUND":
      return "This interview could not be found.";
    default:
      return "We couldn't start your interview session. Please try again.";
  }
}

function isAlreadyActiveConflict(error: ServiceError): boolean {
  return error.kind === "SERVER" && error.status === 409;
}

export function useInterviewSession({
  interviewId,
  token,
  enabled,
}: UseInterviewSessionArgs): void {
  const setConnectionState = useInterviewSessionStore((s) => s.setConnectionState);
  const setSpeaker = useInterviewSessionStore((s) => s.setSpeaker);
  const appendTranscript = useInterviewSessionStore((s) => s.appendTranscript);
  const resetStore = useInterviewSessionStore((s) => s.reset);

  useEffect(() => {
    if (!enabled) return;

    // Cancellation is tracked by a closure-local flag — NOT a useRef — and the
    // live conversation handle is a closure local too. This is the critical
    // StrictMode-safety guarantee: in dev, React double-invokes effects
    // (mount → cleanup → mount). A shared useRef would be reset to "not
    // cancelled" by the second mount, so the FIRST invocation's in-flight
    // startCandidateSession would resume past its guard and open a SECOND
    // ElevenLabs conversation — two signed URLs, two audio streams talking over
    // each other. A fresh `cancelled` per effect invocation cancels invocation
    // #1 for good, so exactly one conversation is ever started.
    let cancelled = false;
    let conversation: Awaited<
      ReturnType<typeof Conversation.startSession>
    > | null = null;

    setConnectionState("connecting");

    void (async () => {
      // 1) Server-built per-session payload + single-use signed URL (ADR-033).
      const result = await startCandidateSession({ interviewId, token });
      if (cancelled) return;
      if (!result.ok) {
        if (isAlreadyActiveConflict(result.error)) {
          setConnectionState("blocked");
          return;
        }
        setConnectionState("error");
        toast.error(friendlyServiceError(result.error.kind));
        return;
      }

      // 2) Forward the validated server payload VERBATIM to the SDK. We spread
      //    `result.value` so this file never names the personalization field
      //    (ADR-033 forbids constructing override fields in browser code). The
      //    SDK reads signedUrl + overrides + the personalization block off the
      //    spread. connectionType:"websocket" is REQUIRED — the signedUrl is a
      //    WebSocket credential; the default WebRTC transport hits a LiveKit
      //    /rtc/v1 handshake bug and never connects (runbook 2026-05-29).
      try {
        const conv = await Conversation.startSession({
          ...result.value,
          connectionType: "websocket",
          onConnect: () => {
            if (cancelled) return;
            setConnectionState("connected");
          },
          onModeChange: ({ mode }) => {
            if (cancelled) return;
            setSpeaker(mode === "speaking" ? "ai" : "candidate");
          },
          onMessage: ({ message, role }) => {
            if (cancelled) return;
            const entry = toTranscriptEntry(message, role);
            if (entry) appendTranscript([entry]);
          },
          onError: (message) => {
            if (cancelled) return;
            setConnectionState("error");
            toast.error("The interview connection failed. Please try again.");
            console.error("[session] ElevenLabs onError", message);
          },
          onDisconnect: (details) => {
            if (cancelled) return;
            // A delivered onDisconnect is terminal: the signed URL is single-use
            // and the SDK manages transient transport drops itself. reason
            // "error" = unexpected drop; "agent"/"user" = clean end.
            setConnectionState(
              details.reason === "error" ? "interrupted" : "completed",
            );
          },
        });

        // The effect may have been torn down WHILE startSession was resolving
        // (StrictMode remount, or the candidate navigated away). End the
        // freshly-created conversation immediately so it does not keep talking.
        if (cancelled) {
          void conv.endSession().catch(() => {});
          return;
        }
        conversation = conv;
      } catch (cause) {
        if (cancelled) return;
        setConnectionState("error");
        toast.error("We couldn't start your interview session. Please try again.");
        console.error("[session] startSession failed", cause);
      }
    })();

    return () => {
      cancelled = true;
      void conversation?.endSession().catch(() => {});
      resetStore();
    };
  }, [
    interviewId,
    token,
    enabled,
    setConnectionState,
    setSpeaker,
    appendTranscript,
    resetStore,
  ]);
}
