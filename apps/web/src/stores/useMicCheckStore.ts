import { create } from "zustand";

export type PermissionState = "idle" | "requesting" | "granted" | "denied";
export type TestOutcome = "pending" | "passed";

export interface MicCheckState {
  permission: PermissionState;
  level: number;
  outcome: TestOutcome;
  setPermission: (p: PermissionState) => void;
  setLevel: (n: number) => void;
  markPassed: () => void;
  reset: () => void;
}

// Audio-level granularity. The RAF tick runs at ~60Hz; updating the
// store only on perceptible changes prevents subscribers (MicLevelMeter,
// the visualizer UI) from re-rendering every frame.
const LEVEL_EPSILON = 0.01;

export const useMicCheckStore = create<MicCheckState>((set) => ({
  permission: "idle",
  level: 0,
  outcome: "pending",
  setPermission: (permission) =>
    set((cur) => (cur.permission === permission ? cur : { permission })),
  setLevel: (level) => {
    const clamped = Math.max(0, Math.min(1, level));
    set((cur) =>
      Math.abs(cur.level - clamped) < LEVEL_EPSILON ? cur : { level: clamped },
    );
  },
  markPassed: () =>
    set((cur) => (cur.outcome === "passed" ? cur : { outcome: "passed" })),
  reset: () => set({ permission: "idle", level: 0, outcome: "pending" }),
}));
