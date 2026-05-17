"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { env } from "@/lib/env";
import {
  useInterviewSessionStore,
  type TranscriptEntry,
} from "@/stores/useInterviewSessionStore";
import { AudioPlaybackQueue } from "./audio-playback-queue";

const MAX_RECONNECTS = 10;
const MAX_RECONNECT_WINDOW_MS = 60_000;
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 4_000;
// DESIGN.md §7: the orb is only ever allowed to indicate "reconnecting"
// after the dropout has persisted for 2 s. Below that, micro-drops resolve
// silently.
const RECONNECT_UI_DELAY_MS = 2_000;
// Throttle mic-level pushes to the store at ~15 Hz. The worklet ticks at
// ~50 Hz; finer granularity than this won't move the orb perceptibly and
// would only churn React renders.
const AUDIO_LEVEL_INTERVAL_MS = 67;
// Half-duplex turn-taking: while binary chunks are flowing from the
// server, the AI is speaking. We treat the AI as "still speaking" for
// this many ms after the last chunk, then flip back to the candidate.
// The buffer accounts for audio still playing out of the MediaSource
// queue after the server stops sending. Sized to (~real-time MP3
// chunk cadence) + (typical playback head-room) + safety margin.
const AI_TURN_SILENCE_MS = 800;

const POLICY_VIOLATION = 1008;

interface UseInterviewSessionArgs {
  interviewId: string;
  token: string;
}

function parseSessionCompleted(payload: unknown): TranscriptEntry[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("transcript" in payload)
  ) {
    return [];
  }
  const raw = (payload as { transcript?: unknown }).transcript;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t): TranscriptEntry[] => {
    if (typeof t !== "object" || t === null) return [];
    const obj = t as { speaker?: unknown; text?: unknown; timestamp?: unknown };
    if (
      (obj.speaker !== "candidate" && obj.speaker !== "agent") ||
      typeof obj.text !== "string" ||
      typeof obj.timestamp !== "string"
    ) {
      return [];
    }
    return [
      {
        speaker: obj.speaker,
        text: obj.text,
        timestamp: new Date(obj.timestamp),
      },
    ];
  });
}

export function useInterviewSession({
  interviewId,
  token,
}: UseInterviewSessionArgs): void {
  const setConnectionState = useInterviewSessionStore(
    (s) => s.setConnectionState,
  );
  const setSpeaker = useInterviewSessionStore((s) => s.setSpeaker);
  const appendTranscript = useInterviewSessionStore((s) => s.appendTranscript);
  const incrementReconnect = useInterviewSessionStore(
    (s) => s.incrementReconnect,
  );
  const setAudioLevel = useInterviewSessionStore((s) => s.setAudioLevel);
  const resetStore = useInterviewSessionStore((s) => s.reset);

  const wsRef = useRef<WebSocket | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackRef = useRef<AudioPlaybackQueue | null>(null);
  const reconnectStartedAtRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const completedRef = useRef(false);
  const unmountedRef = useRef(false);
  const lastAudioLevelSetAtRef = useRef(0);
  // Half-duplex turn state — owned as a ref so the worklet onmessage
  // callback can read it without subscribing to store updates.
  const aiSpeakingRef = useRef(false);
  const aiTurnEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsUrl = `${env.NEXT_PUBLIC_WS_URL}/interviews/${encodeURIComponent(interviewId)}/session?token=${encodeURIComponent(token)}`;

  // Stops any in-flight TTS playback. Called on terminal close branches
  // so the AI's already-buffered audio doesn't keep playing through the
  // candidate's speakers after the session ended.
  const stopPlayback = useCallback(() => {
    playbackRef.current?.dispose();
    playbackRef.current = null;
  }, []);

  const connect = useCallback((): void => {
    if (unmountedRef.current) return;
    setConnectionState(
      reconnectAttemptRef.current === 0 ? "connecting" : "reconnecting",
    );
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      if (reconnectingUiTimerRef.current) {
        clearTimeout(reconnectingUiTimerRef.current);
        reconnectingUiTimerRef.current = null;
      }
      setConnectionState("connected");
      reconnectAttemptRef.current = 0;
      reconnectStartedAtRef.current = null;
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const parsed: unknown = JSON.parse(ev.data);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            (parsed as { type?: unknown }).type === "session.completed"
          ) {
            const transcript = parseSessionCompleted(
              (parsed as { payload?: unknown }).payload,
            );
            if (transcript.length > 0) appendTranscript(transcript);
            completedRef.current = true;
            setConnectionState("completed");
          }
        } catch {
          // not JSON — ignore
        }
        return;
      }
      // Binary frame: streamed MP3 chunk from agent.
      const chunk = new Uint8Array(ev.data as ArrayBuffer);
      playbackRef.current?.enqueue(chunk);
      aiSpeakingRef.current = true;
      setSpeaker("ai");
      // Schedule the turn-end: if no further chunk arrives within the
      // silence window, the AI has stopped speaking and the mic
      // un-mutes. Each new chunk resets the timer.
      if (aiTurnEndTimerRef.current) clearTimeout(aiTurnEndTimerRef.current);
      aiTurnEndTimerRef.current = setTimeout(() => {
        aiSpeakingRef.current = false;
        aiTurnEndTimerRef.current = null;
        if (!unmountedRef.current && !completedRef.current) {
          setSpeaker("candidate");
          setAudioLevel(0);
        }
      }, AI_TURN_SILENCE_MS);
    };

    ws.onclose = (e) => {
      console.info(
        `[session] WS closed code=${e.code} reason=${JSON.stringify(e.reason)} wasClean=${e.wasClean}`,
      );
      if (unmountedRef.current) return;
      if (completedRef.current) return;

      // 1008 (POLICY_VIOLATION) = backend rejected the session; terminal,
      // never reconnect. Reasons include token mismatch, invalid interview
      // id, INTERVIEW_NOT_FOUND, or INVALID_INTERVIEW_INPUT from the use
      // case. Use the reason string from the close frame to surface the
      // actual cause instead of always saying "invalid credentials".
      if (e.code === POLICY_VIOLATION) {
        stopPlayback();
        aiSpeakingRef.current = false;
        if (aiTurnEndTimerRef.current) {
          clearTimeout(aiTurnEndTimerRef.current);
          aiTurnEndTimerRef.current = null;
        }
        setConnectionState("interrupted");
        toast.error(
          e.reason
            ? `Your session ended: ${e.reason}`
            : "Your session ended unexpectedly.",
        );
        return;
      }

      const now = Date.now();
      if (reconnectStartedAtRef.current === null) {
        reconnectStartedAtRef.current = now;
      }
      const elapsed = now - reconnectStartedAtRef.current;
      if (
        elapsed > MAX_RECONNECT_WINDOW_MS ||
        reconnectAttemptRef.current >= MAX_RECONNECTS
      ) {
        stopPlayback();
        setConnectionState("interrupted");
        return;
      }

      // Delay flipping the UI state to "reconnecting" until the dropout has
      // persisted for 2 s (DESIGN.md §7 — micro-drops should not pulse a
      // banner).
      if (!reconnectingUiTimerRef.current) {
        reconnectingUiTimerRef.current = setTimeout(() => {
          if (!unmountedRef.current && !completedRef.current) {
            setConnectionState("reconnecting");
          }
          reconnectingUiTimerRef.current = null;
        }, RECONNECT_UI_DELAY_MS);
      }

      const delay = Math.min(
        BACKOFF_CAP_MS,
        BACKOFF_BASE_MS * 2 ** reconnectAttemptRef.current,
      );
      reconnectAttemptRef.current += 1;
      incrementReconnect();
      reconnectTimerRef.current = setTimeout(() => {
        if (!unmountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // ws.onclose follows with a non-1000 code; rely on that branch.
    };
  }, [
    wsUrl,
    appendTranscript,
    incrementReconnect,
    setAudioLevel,
    setConnectionState,
    stopPlayback,
    setSpeaker,
  ]);

  const startMicAndPipe = useCallback(async (): Promise<void> => {
    // Echo cancellation + noise suppression + AGC are essential when the
    // candidate is on laptop speakers — without them the mic captures the
    // AI's own TTS output and feeds it back through Deepgram, causing
    // the AI to respond to itself.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    if (ctx.sampleRate !== 16000) {
      console.warn(
        `[session] AudioContext sampleRate=${ctx.sampleRate} (requested 16000); worklet will downsample.`,
      );
    }
    await ctx.audioWorklet.addModule("/audio-worklet/pcm-downsampler.js");

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-downsampler");
    workletRef.current = node;
    node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      // Half-duplex: drop mic frames while the AI is speaking. This is
      // the primary defence against the speaker → mic → Deepgram echo
      // loop; echo cancellation in getUserMedia is the secondary one.
      if (aiSpeakingRef.current) return;

      const now = Date.now();
      if (now - lastAudioLevelSetAtRef.current >= AUDIO_LEVEL_INTERVAL_MS) {
        lastAudioLevelSetAtRef.current = now;
        setAudioLevel(ev.data.rms);
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(ev.data.pcm);
    };
    src.connect(node);
    // Intentionally do NOT connect node to ctx.destination — no loopback.
  }, [setAudioLevel]);

  useEffect(() => {
    unmountedRef.current = false;
    completedRef.current = false;
    reconnectAttemptRef.current = 0;
    reconnectStartedAtRef.current = null;
    playbackRef.current = new AudioPlaybackQueue();

    void (async () => {
      try {
        await startMicAndPipe();
        connect();
      } catch {
        if (!unmountedRef.current) {
          setConnectionState("error");
          toast.error("We couldn't access your microphone.");
        }
      }
    })();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (reconnectingUiTimerRef.current)
        clearTimeout(reconnectingUiTimerRef.current);
      if (aiTurnEndTimerRef.current) clearTimeout(aiTurnEndTimerRef.current);
      try {
        wsRef.current?.close(1000, "client unmount");
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      playbackRef.current?.dispose();
      resetStore();
    };
  }, [connect, startMicAndPipe, resetStore, setConnectionState]);
}
