"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useMicCheckStore,
  type PermissionState,
  type TestOutcome,
} from "@/stores/useMicCheckStore";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";

export type Step = "mic" | "audio" | "quiet" | "ready";
export const STEPS: ReadonlyArray<Step> = ["mic", "audio", "quiet", "ready"];
export const STEP_LABELS: ReadonlyArray<string> = [
  "Mic check",
  "Audio test",
  "Quiet space",
  "Ready",
];

export type AudioTestState =
  | "idle"
  | "playing"
  | "played"
  | "browser-unsupported";

export interface UsePreInterviewCheckResult {
  step: Step;
  stepIndex: number;
  totalSteps: number;
  permission: PermissionState;
  level: number;
  outcome: TestOutcome;
  requestMic: () => Promise<void>;
  audioTestState: AudioTestState;
  playSample: () => void;
  transcriptVisible: boolean;
  setTranscriptVisible: (b: boolean) => void;
  next: () => void;
  prev: () => void;
}

export function usePreInterviewCheck(): UsePreInterviewCheckResult {
  const [step, setStep] = useState<Step>("mic");
  const { permission, level, outcome, setPermission, setLevel, markPassed, reset } =
    useMicCheckStore();
  const { transcriptVisible, setTranscriptVisible } = useInterviewSessionStore();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestMic = useCallback(async () => {
    setPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;
      // Best-effort 16kHz; some browsers silently return 48kHz. The
      // AudioWorklet in InterviewSessionContainer handles downsampling,
      // but for the mic-check we just want a level — sample rate is fine
      // either way.
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      if (ctx.sampleRate !== 16000) {
        console.warn(
          `[mic-check] AudioContext sampleRate=${ctx.sampleRate} (requested 16000)`,
        );
      }
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = ((buf[i] ?? 128) - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        if (rms > 0.05) markPassed();
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setPermission("granted");
    } catch {
      setPermission("denied");
    }
  }, [setPermission, setLevel, markPassed]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [audioTestState, setAudioTestState] = useState<AudioTestState>("idle");

  // Step 2 doubles as a browser-compat probe (DESIGN.md / risk #6):
  // if the MP3 cannot play within 3s — Safari rejecting audio/mpeg in
  // MediaSource is the canonical case — surface "Try Chrome/Edge/Firefox".
  const playSample = useCallback(() => {
    if (!audioElRef.current) {
      const el = new Audio("/sift-sample.mp3");
      el.addEventListener("ended", () => setAudioTestState("played"));
      el.addEventListener("error", () =>
        setAudioTestState("browser-unsupported"),
      );
      audioElRef.current = el;
    }
    setAudioTestState("playing");
    const timeoutId = window.setTimeout(() => {
      setAudioTestState((s) =>
        s === "playing" && (audioElRef.current?.currentTime ?? 0) === 0
          ? "browser-unsupported"
          : s,
      );
    }, 3000);
    audioElRef.current.play().catch(() => {
      window.clearTimeout(timeoutId);
      setAudioTestState("browser-unsupported");
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      reset();
    },
    [reset],
  );

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!);
  };
  const prev = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]!);
  };

  return {
    step,
    stepIndex: STEPS.indexOf(step),
    totalSteps: STEPS.length,
    permission,
    level,
    outcome,
    requestMic,
    audioTestState,
    playSample,
    transcriptVisible,
    setTranscriptVisible,
    next,
    prev,
  };
}
