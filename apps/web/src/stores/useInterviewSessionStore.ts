import { create } from "zustand";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "completed"
  | "interrupted"
  | "error";

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
  reconnectAttempts: number;
  /** RMS audio level 0..1, throttled writes from the worklet so subscribers don't re-render per chunk. */
  audioLevel: number;
  setConnectionState: (s: ConnectionState) => void;
  setSpeaker: (s: SpeakerState) => void;
  setMicMuted: (b: boolean) => void;
  setTranscriptVisible: (b: boolean) => void;
  appendTranscript: (entries: ReadonlyArray<TranscriptEntry>) => void;
  incrementReconnect: () => void;
  setAudioLevel: (n: number) => void;
  reset: () => void;
}

const TRANSCRIPT_LS_KEY = "sift.transcriptVisible";

function loadInitialTranscriptVisible(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TRANSCRIPT_LS_KEY) === "1";
}

// Audio-level granularity. Smaller deltas don't move the UI perceptibly
// and would otherwise re-render the orb + mic-meter at the worklet's
// ~50Hz cadence.
const AUDIO_LEVEL_EPSILON = 0.01;

export const useInterviewSessionStore = create<InterviewSessionState>((set) => ({
  connectionState: "idle",
  speaker: "silent",
  micMuted: false,
  transcriptVisible: loadInitialTranscriptVisible(),
  transcript: [],
  reconnectAttempts: 0,
  audioLevel: 0,
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
  incrementReconnect: () =>
    set((s) => ({ reconnectAttempts: s.reconnectAttempts + 1 })),
  setAudioLevel: (n) => {
    const clamped = Math.max(0, Math.min(1, n));
    set((cur) =>
      Math.abs(cur.audioLevel - clamped) < AUDIO_LEVEL_EPSILON ? cur : { audioLevel: clamped },
    );
  },
  reset: () =>
    set({
      connectionState: "idle",
      speaker: "silent",
      micMuted: false,
      transcript: [],
      reconnectAttempts: 0,
      audioLevel: 0,
    }),
}));
