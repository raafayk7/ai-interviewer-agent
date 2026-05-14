import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Badge, badgeVariants } from "./badge.js";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Badge — rendering", () => {
  it("renders a <span> element", () => {
    const { container } = render(<Badge>Active</Badge>);
    expect(container.querySelector("span")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<Badge>In Progress</Badge>);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("forwards extra HTML attributes", () => {
    render(<Badge data-testid="status-badge" id="badge-1">Done</Badge>);
    const badge = screen.getByTestId("status-badge");
    expect(badge).toHaveAttribute("id", "badge-1");
  });
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

describe("Badge — variants", () => {
  it("applies default variant classes", () => {
    const { container } = render(<Badge variant="default">Default</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-secondary");
    expect(badge).toHaveClass("text-secondary-foreground");
  });

  it("applies secondary variant classes", () => {
    const { container } = render(<Badge variant="secondary">Secondary</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-muted");
    expect(badge).toHaveClass("text-muted-foreground");
  });

  it("applies outline variant classes", () => {
    const { container } = render(<Badge variant="outline">Outline</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("border");
    expect(badge).toHaveClass("border-border");
    expect(badge).toHaveClass("text-foreground");
    expect(badge).toHaveClass("bg-transparent");
  });

  it("applies positive variant classes", () => {
    const { container } = render(<Badge variant="positive">Passed</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-positive");
    expect(badge).toHaveClass("text-positive-foreground");
  });

  it("applies attention-warning variant classes", () => {
    const { container } = render(<Badge variant="attention-warning">Warning</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-attention-warning");
    expect(badge).toHaveClass("text-attention-warning-foreground");
  });

  it("applies negative variant classes", () => {
    const { container } = render(<Badge variant="negative">Failed</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("bg-negative");
    expect(badge).toHaveClass("text-negative-foreground");
  });
});

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

describe("Badge — sizes", () => {
  it("applies default size classes", () => {
    const { container } = render(<Badge size="default">Default</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("h-6");
    expect(badge).toHaveClass("px-2.5");
    expect(badge).toHaveClass("text-xs");
  });

  it("applies sm size classes", () => {
    const { container } = render(<Badge size="sm">Small</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("h-5");
    expect(badge).toHaveClass("px-2");
    expect(badge).toHaveClass("text-[11px]");
  });
});

// ---------------------------------------------------------------------------
// Pill radius (ADR-025 brand token)
// ---------------------------------------------------------------------------

describe("Badge — brand token", () => {
  it("always applies rounded-pill for default variant", () => {
    const { container } = render(<Badge variant="default">Default</Badge>);
    expect(container.querySelector("span")).toHaveClass("rounded-pill");
  });

  it("always applies rounded-pill for positive variant", () => {
    const { container } = render(<Badge variant="positive">Positive</Badge>);
    expect(container.querySelector("span")).toHaveClass("rounded-pill");
  });

  it("always applies rounded-pill for outline variant", () => {
    const { container } = render(<Badge variant="outline">Outline</Badge>);
    expect(container.querySelector("span")).toHaveClass("rounded-pill");
  });
});

// ---------------------------------------------------------------------------
// Dot prop
// ---------------------------------------------------------------------------

describe("Badge — dot prop", () => {
  it("renders the dot span when dot={true}", () => {
    const { container } = render(<Badge dot>Live</Badge>);
    const dot = container.querySelector("span > span");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass("size-1.5");
    expect(dot).toHaveClass("rounded-full");
    expect(dot).toHaveClass("bg-current");
    expect(dot).toHaveClass("shrink-0");
  });

  it("does not render the dot span when dot={false}", () => {
    const { container } = render(<Badge dot={false}>No dot</Badge>);
    expect(container.querySelector("span > span")).not.toBeInTheDocument();
  });

  it("does not render the dot span when dot is omitted", () => {
    const { container } = render(<Badge>No dot</Badge>);
    expect(container.querySelector("span > span")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dot aria-hidden
// ---------------------------------------------------------------------------

describe("Badge — dot aria-hidden", () => {
  it("dot span has aria-hidden=true for screen reader exclusion", () => {
    const { container } = render(<Badge dot>Live</Badge>);
    const dot = container.querySelector("span > span");
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Badge — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<Badge className="my-custom-badge">Status</Badge>);
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("my-custom-badge");
    expect(badge).toHaveClass("inline-flex");
    expect(badge).toHaveClass("items-center");
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Badge — displayName", () => {
  it("has the correct displayName", () => {
    expect(Badge.displayName).toBe("Badge");
  });
});

// ---------------------------------------------------------------------------
// badgeVariants export
// ---------------------------------------------------------------------------

describe("badgeVariants export", () => {
  it("is a function that returns a class string", () => {
    const result = badgeVariants({ variant: "default", size: "default" });
    expect(typeof result).toBe("string");
    expect(result).toContain("bg-secondary");
    expect(result).toContain("rounded-pill");
  });

  it("accepts all documented variants without throwing", () => {
    const variants = ["default", "secondary", "outline", "positive", "attention-warning", "negative"] as const;
    for (const variant of variants) {
      expect(() => badgeVariants({ variant })).not.toThrow();
    }
  });

  it("accepts all documented sizes without throwing", () => {
    const sizes = ["default", "sm"] as const;
    for (const size of sizes) {
      expect(() => badgeVariants({ size })).not.toThrow();
    }
  });
});
