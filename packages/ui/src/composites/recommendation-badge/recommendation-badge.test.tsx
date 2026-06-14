import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecommendationBadge, type RecommendationValue } from "./recommendation-badge.js";

// ---------------------------------------------------------------------------
// RecommendationBadge — label per recommendation
// ---------------------------------------------------------------------------

describe("RecommendationBadge — label rendering", () => {
  it("renders 'Advance' label for advance recommendation", () => {
    render(<RecommendationBadge recommendation="advance" />);
    expect(screen.getByText("Advance")).toBeInTheDocument();
  });

  it("renders 'Hold' label for hold recommendation", () => {
    render(<RecommendationBadge recommendation="hold" />);
    expect(screen.getByText("Hold")).toBeInTheDocument();
  });

  it("renders 'Reject' label for reject recommendation", () => {
    render(<RecommendationBadge recommendation="reject" />);
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RecommendationBadge — variant classes per recommendation
// ---------------------------------------------------------------------------

describe("RecommendationBadge — variant classes", () => {
  it("uses the positive variant for advance (bg-positive class)", () => {
    const { container } = render(<RecommendationBadge recommendation="advance" />);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-positive");
  });

  it("uses the attention-warning variant for hold (bg-attention-warning class)", () => {
    const { container } = render(<RecommendationBadge recommendation="hold" />);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-attention-warning");
  });

  it("uses the negative variant for reject (bg-negative class)", () => {
    const { container } = render(<RecommendationBadge recommendation="reject" />);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-negative");
  });
});

// ---------------------------------------------------------------------------
// RecommendationBadge — all values render without error
// ---------------------------------------------------------------------------

describe("RecommendationBadge — no render errors for any recommendation value", () => {
  const values: RecommendationValue[] = ["advance", "hold", "reject"];
  for (const recommendation of values) {
    it(`renders without error for recommendation: ${recommendation}`, () => {
      expect(() => render(<RecommendationBadge recommendation={recommendation} />)).not.toThrow();
    });
  }
});
