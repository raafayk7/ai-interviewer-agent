import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionLossBanner } from "./connection-loss-banner.js";

// ---------------------------------------------------------------------------
// ConnectionLossBanner — ARIA attributes
// ---------------------------------------------------------------------------

describe("ConnectionLossBanner — ARIA attributes", () => {
  it("renders with role=status", () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-live=polite", () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

// ---------------------------------------------------------------------------
// ConnectionLossBanner — data-state attribute per state
// ---------------------------------------------------------------------------

describe("ConnectionLossBanner — data-state attribute", () => {
  it('sets data-state="reconnecting" when state is reconnecting', () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "reconnecting");
  });

  it('sets data-state="reconnected-resuming" when state is reconnected-resuming', () => {
    render(<ConnectionLossBanner state="reconnected-resuming" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "reconnected-resuming");
  });

  it('sets data-state="failed" when state is failed', () => {
    render(<ConnectionLossBanner state="failed" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "failed");
  });
});

// ---------------------------------------------------------------------------
// ConnectionLossBanner — copy per state
// ---------------------------------------------------------------------------

describe("ConnectionLossBanner — copy for reconnecting state", () => {
  it('renders "Reconnecting…" as the title when state is reconnecting', () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });
});

describe("ConnectionLossBanner — copy for reconnected-resuming state", () => {
  it('renders "Reconnected. Resuming…" as the title when state is reconnected-resuming', () => {
    render(<ConnectionLossBanner state="reconnected-resuming" />);
    expect(screen.getByText("Reconnected. Resuming…")).toBeInTheDocument();
  });
});

describe("ConnectionLossBanner — copy for failed state", () => {
  it('renders "We can\'t reach Sift right now." as the title when state is failed', () => {
    render(<ConnectionLossBanner state="failed" />);
    expect(screen.getByText("We can't reach Sift right now.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ConnectionLossBanner — progress nub visibility
// ---------------------------------------------------------------------------

describe("ConnectionLossBanner — progress nub", () => {
  it("renders the progress nub only when state is reconnecting", () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(
      document.querySelector('[data-testid="connection-loss-progress-nub"]'),
    ).not.toBeNull();
  });

  it("does not render the progress nub when state is reconnected-resuming", () => {
    render(<ConnectionLossBanner state="reconnected-resuming" />);
    expect(
      document.querySelector('[data-testid="connection-loss-progress-nub"]'),
    ).toBeNull();
  });

  it("does not render the progress nub when state is failed", () => {
    render(<ConnectionLossBanner state="failed" />);
    expect(
      document.querySelector('[data-testid="connection-loss-progress-nub"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ConnectionLossBanner — token class on root
// ---------------------------------------------------------------------------

describe("ConnectionLossBanner — attention-warning token class", () => {
  it("has bg-attention-warning/90 class on the root element", () => {
    render(<ConnectionLossBanner state="reconnecting" />);
    expect(screen.getByRole("status")).toHaveClass("bg-attention-warning/90");
  });
});
