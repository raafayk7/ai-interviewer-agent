"use client";

import { useEffect, useRef } from "react";
import { Conversation } from "@elevenlabs/client";
import { toast } from "sonner";
import { startCandidateSession } from "@/services/candidate.service";
import {
  useInterviewSessionStore,
  type TranscriptEntry,
} from "@/stores/useInterviewSessionStore";

interface UseInterviewSessionArgs {
  interviewId: string;
  token: string;
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

export function useInterviewSession({
  interviewId,
  token,
}: UseInterviewSessionArgs): void {
  const setConnectionState = useInterviewSessionStore((s) => s.setConnectionState);
  const setSpeaker = useInterviewSessionStore((s) => s.setSpeaker);
  const appendTranscript = useInterviewSessionStore((s) => s.appendTranscript);
  const resetStore = useInterviewSessionStore((s) => s.reset);

  // The live SDK conversation handle. Typed off the SDK return type so cleanup
  // can call endSession() without re-declaring the instance shape.
  const conversationRef = useRef<Awaited<
    ReturnType<typeof Conversation.startSession>
  > | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    setConnectionState("connecting");

    void (async () => {
      // 1) Server-built per-session payload + single-use signed URL (ADR-033).
      const result = await startCandidateSession({ interviewId, token });
      if (unmountedRef.current) return;
      if (!result.ok) {
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
        conversationRef.current = await Conversation.startSession({
          ...result.value,
          connectionType: "websocket",
          onConnect: () => {
            if (unmountedRef.current) return;
            setConnectionState("connected");
          },
          onModeChange: ({ mode }) => {
            if (unmountedRef.current) return;
            setSpeaker(mode === "speaking" ? "ai" : "candidate");
          },
          onMessage: ({ message, role }) => {
            if (unmountedRef.current) return;
            const entry = toTranscriptEntry(message, role);
            if (entry) appendTranscript([entry]);
          },
          onError: (message) => {
            if (unmountedRef.current) return;
            setConnectionState("error");
            toast.error("The interview connection failed. Please try again.");
            console.error("[session] ElevenLabs onError", message);
          },
          onDisconnect: (details) => {
            if (unmountedRef.current) return;
            // A delivered onDisconnect is terminal: the signed URL is single-use
            // and the SDK manages transient transport drops itself. reason
            // "error" = unexpected drop; "agent"/"user" = clean end.
            setConnectionState(
              details.reason === "error" ? "interrupted" : "completed",
            );
          },
        });
      } catch (cause) {
        if (unmountedRef.current) return;
        setConnectionState("error");
        toast.error("We couldn't start your interview session. Please try again.");
        console.error("[session] startSession failed", cause);
      }
    })();

    return () => {
      unmountedRef.current = true;
      void conversationRef.current?.endSession().catch(() => {});
      conversationRef.current = null;
      resetStore();
    };
  }, [interviewId, token, setConnectionState, setSpeaker, appendTranscript, resetStore]);
}
