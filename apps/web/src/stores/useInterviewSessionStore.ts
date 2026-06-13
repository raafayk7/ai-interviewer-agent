import { create } from "zustand";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "completed"
  | "interrupted"
  | "error"
  | "blocked";

export type SpeakerState = "candidate" | "ai" | "silent";

export interface TranscriptEntry {
  readonly speaker: "candidate" | "agent";
  readonly text: string;
  readonly timestamp: Date;
}

interface InterviewSessionState {
  connectionState: ConnectionState;
  speaker: SpeakerState;
  micMuted: boolean;
  transcriptVisible: boolean;
  transcript: ReadonlyArray<TranscriptEntry>;
  setConnectionState: (s: ConnectionState) => void;
  setSpeaker: (s: SpeakerState) => void;
  setMicMuted: (b: boolean) => void;
  setTranscriptVisible: (b: boolean) => void;
  appendTranscript: (entries: ReadonlyArray<TranscriptEntry>) => void;
  reset: () => void;
}

const TRANSCRIPT_LS_KEY = "sift.transcriptVisible";

function loadInitialTranscriptVisible(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TRANSCRIPT_LS_KEY) === "1";
}

export const useInterviewSessionStore = create<InterviewSessionState>((set) => ({
  connectionState: "idle",
  speaker: "silent",
  micMuted: false,
  transcriptVisible: loadInitialTranscriptVisible(),
  transcript: [],
  setConnectionState: (connectionState) =>
    set((cur) => (cur.connectionState === connectionState ? cur : { connectionState })),
  setSpeaker: (speaker) =>
    set((cur) => (cur.speaker === speaker ? cur : { speaker })),
  setMicMuted: (micMuted) =>
    set((cur) => (cur.micMuted === micMuted ? cur : { micMuted })),
  setTranscriptVisible: (transcriptVisible) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TRANSCRIPT_LS_KEY, transcriptVisible ? "1" : "0");
    }
    set((cur) => (cur.transcriptVisible === transcriptVisible ? cur : { transcriptVisible }));
  },
  appendTranscript: (entries) =>
    set((s) => (entries.length === 0 ? s : { transcript: [...s.transcript, ...entries] })),
  reset: () =>
    set({
      connectionState: "idle",
      speaker: "silent",
      micMuted: false,
      transcript: [],
    }),
}));
