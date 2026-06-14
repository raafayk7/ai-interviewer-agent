import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VoicePresence } from "./voice-presence.js";

// ---------------------------------------------------------------------------
// VoicePresence — data-state attribute per state
// ---------------------------------------------------------------------------

describe("VoicePresence — data-state attribute", () => {
  it('sets data-state="idle" when state is idle', () => {
    render(<VoicePresence state="idle" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "idle");
  });

  it('sets data-state="listening" when state is listening', () => {
    render(<VoicePresence state="listening" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "listening");
  });

  it('sets data-state="thinking" when state is thinking', () => {
    render(<VoicePresence state="thinking" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "thinking");
  });

  it('sets data-state="speaking" when state is speaking', () => {
    render(<VoicePresence state="speaking" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "speaking");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — aria-label per state
// ---------------------------------------------------------------------------

describe("VoicePresence — aria-label per state", () => {
  it("has aria-label 'Sift is idle' when state is idle", () => {
    render(<VoicePresence state="idle" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Sift is idle");
  });

  it("has aria-label 'Sift is listening' when state is listening", () => {
    render(<VoicePresence state="listening" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Sift is listening");
  });

  it("has aria-label 'Sift is thinking' when state is thinking", () => {
    render(<VoicePresence state="thinking" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Sift is thinking");
  });

  it("has aria-label 'Sift is speaking' when state is speaking", () => {
    render(<VoicePresence state="speaking" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Sift is speaking");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — halo color with tone="warning"
// ---------------------------------------------------------------------------

describe("VoicePresence — halo tone warning", () => {
  it('sets halo backgroundColor to var(--attention-warning) when tone="warning"', () => {
    render(<VoicePresence state="idle" tone="warning" />);
    const halo = document.querySelector('[data-testid="voice-presence-halo"]') as HTMLElement;
    expect(halo).not.toBeNull();
    expect(halo.style.backgroundColor).toBe("var(--attention-warning)");
  });

  it('sets halo backgroundColor to var(--attention-warning) even when speaking with tone="warning"', () => {
    render(<VoicePresence state="speaking" tone="warning" audioLevel={0.5} />);
    const halo = document.querySelector('[data-testid="voice-presence-halo"]') as HTMLElement;
    expect(halo.style.backgroundColor).toBe("var(--attention-warning)");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — halo color defaults
// ---------------------------------------------------------------------------

describe("VoicePresence — halo color defaults", () => {
  it('uses var(--ai-thinking) for halo when state="thinking" and tone is default', () => {
    render(<VoicePresence state="thinking" />);
    const halo = document.querySelector('[data-testid="voice-presence-halo"]') as HTMLElement;
    expect(halo.style.backgroundColor).toBe("var(--ai-thinking)");
  });

  it('uses var(--orb-core) for halo when state="idle" and tone is default', () => {
    render(<VoicePresence state="idle" />);
    const halo = document.querySelector('[data-testid="voice-presence-halo"]') as HTMLElement;
    expect(halo.style.backgroundColor).toBe("var(--orb-core)");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — scale envelope when speaking
// ---------------------------------------------------------------------------

describe("VoicePresence — scale when speaking", () => {
  it("applies scale(0.960) when state=speaking and audioLevel=0", () => {
    render(<VoicePresence state="speaking" audioLevel={0} />);
    const wrapper = screen.getByRole("status") as HTMLElement;
    // 0.96 + 0 * 0.1 = 0.960 → toFixed(3) = "0.960"
    expect(wrapper.style.transform).toBe("scale(0.960)");
  });

  it("applies scale(1.060) when state=speaking and audioLevel=1", () => {
    render(<VoicePresence state="speaking" audioLevel={1} />);
    const wrapper = screen.getByRole("status") as HTMLElement;
    // 0.96 + 1 * 0.1 = 1.060 → toFixed(3) = "1.060"
    expect(wrapper.style.transform).toBe("scale(1.060)");
  });

  it("applies scale(1.000) when state=idle (not speaking)", () => {
    render(<VoicePresence state="idle" />);
    const wrapper = screen.getByRole("status") as HTMLElement;
    expect(wrapper.style.transform).toBe("scale(1.000)");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — audioLevel clamping
// ---------------------------------------------------------------------------

describe("VoicePresence — audioLevel clamping", () => {
  it("clamps audioLevel -0.5 to 0 so scale stays at 0.960", () => {
    render(<VoicePresence state="speaking" audioLevel={-0.5} />);
    const wrapper = screen.getByRole("status") as HTMLElement;
    expect(wrapper.style.transform).toBe("scale(0.960)");
  });

  it("clamps audioLevel 1.5 to 1 so scale stays at 1.060", () => {
    render(<VoicePresence state="speaking" audioLevel={1.5} />);
    const wrapper = screen.getByRole("status") as HTMLElement;
    expect(wrapper.style.transform).toBe("scale(1.060)");
  });
});

// ---------------------------------------------------------------------------
// VoicePresence — forwardRef
// ---------------------------------------------------------------------------

describe("VoicePresence — forwardRef", () => {
  it("attaches the forwarded ref to an HTMLElement after render", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<VoicePresence state="idle" ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });
});
