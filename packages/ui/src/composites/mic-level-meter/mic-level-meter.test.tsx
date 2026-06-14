import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MicLevelMeter } from "./mic-level-meter.js";

// ---------------------------------------------------------------------------
// MicLevelMeter — ARIA meter attributes
// ---------------------------------------------------------------------------

describe("MicLevelMeter — ARIA meter role and attributes", () => {
  it("renders with role=meter", () => {
    render(<MicLevelMeter level={0.5} />);
    expect(screen.getByRole("meter")).toBeInTheDocument();
  });

  it("sets aria-valuemin=0", () => {
    render(<MicLevelMeter level={0.5} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuemin", "0");
  });

  it("sets aria-valuemax=1", () => {
    render(<MicLevelMeter level={0.5} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuemax", "1");
  });

  it("sets aria-valuenow to the clamped level", () => {
    render(<MicLevelMeter level={0.75} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0.75");
  });
});

// ---------------------------------------------------------------------------
// MicLevelMeter — fill element width
// ---------------------------------------------------------------------------

// Note: jsdom normalizes integer-valued percentages — "0.0%" becomes "0%",
// "50.0%" becomes "50%", "100.0%" becomes "100%". Non-integer decimals like
// "33.3%" are preserved as-is. Tests assert the values jsdom actually produces.
describe("MicLevelMeter — fill element width", () => {
  it("sets fill width to 0% when level=0 (jsdom normalises 0.0% → 0%)", () => {
    render(<MicLevelMeter level={0} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("0%");
  });

  it("sets fill width to 50% when level=0.5 (jsdom normalises 50.0% → 50%)", () => {
    render(<MicLevelMeter level={0.5} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  it("sets fill width to 100% when level=1 (jsdom normalises 100.0% → 100%)", () => {
    render(<MicLevelMeter level={1} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("preserves decimal precision for non-integer levels: 33.3% when level=0.333", () => {
    render(<MicLevelMeter level={0.333} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    // (0.333 * 100).toFixed(1) === "33.3"
    expect(fill.style.width).toBe("33.3%");
  });
});

// ---------------------------------------------------------------------------
// MicLevelMeter — clamping below 0
// ---------------------------------------------------------------------------

describe("MicLevelMeter — level clamping below 0", () => {
  it("clamps level < 0 to 0 for aria-valuenow", () => {
    render(<MicLevelMeter level={-0.5} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps level < 0 to 0% fill width", () => {
    render(<MicLevelMeter level={-0.5} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});

// ---------------------------------------------------------------------------
// MicLevelMeter — clamping above 1
// ---------------------------------------------------------------------------

describe("MicLevelMeter — level clamping above 1", () => {
  it("clamps level > 1 to 1 for aria-valuenow", () => {
    render(<MicLevelMeter level={1.5} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1");
  });

  it("clamps level > 1 to 100% fill width", () => {
    render(<MicLevelMeter level={1.5} />);
    const fill = document.querySelector('[data-testid="mic-level-fill"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});
