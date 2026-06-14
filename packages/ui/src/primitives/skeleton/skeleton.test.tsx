import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Skeleton } from "./skeleton.js";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Skeleton — rendering", () => {
  it("renders without crashing", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders a div element", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild?.nodeName.toLowerCase()).toBe("div");
  });

  it("can render with a data-testid", () => {
    render(<Skeleton data-testid="skeleton-line" />);
    expect(screen.getByTestId("skeleton-line")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Token classes
// ---------------------------------------------------------------------------

describe("Skeleton — token classes", () => {
  it("has animate-shimmer class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("animate-shimmer");
  });

  it("has rounded-xs class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("rounded-xs");
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Skeleton — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<Skeleton className="h-4 w-full" />);
    expect(container.firstChild).toHaveClass("h-4");
    expect(container.firstChild).toHaveClass("w-full");
    expect(container.firstChild).toHaveClass("animate-shimmer");
  });

  it("custom className does not remove animate-shimmer", () => {
    const { container } = render(<Skeleton className="my-skeleton" />);
    expect(container.firstChild).toHaveClass("animate-shimmer");
    expect(container.firstChild).toHaveClass("my-skeleton");
  });

  it("custom className does not remove rounded-xs", () => {
    const { container } = render(<Skeleton className="another-class" />);
    expect(container.firstChild).toHaveClass("rounded-xs");
    expect(container.firstChild).toHaveClass("another-class");
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Skeleton — displayName", () => {
  it('displayName is "Skeleton"', () => {
    expect(Skeleton.displayName).toBe("Skeleton");
  });
});

// ---------------------------------------------------------------------------
// Width / height via style prop
// ---------------------------------------------------------------------------

describe("Skeleton — style prop passthrough", () => {
  it("accepts and applies a style prop for explicit dimensions", () => {
    render(
      <Skeleton
        data-testid="sized-skeleton"
        style={{ width: 200, height: 20 }}
      />
    );
    const el = screen.getByTestId("sized-skeleton");
    expect(el).toHaveStyle({ width: "200px", height: "20px" });
  });
});

// ---------------------------------------------------------------------------
// Accessible role — presentational
// ---------------------------------------------------------------------------

describe("Skeleton — accessibility", () => {
  it("does NOT have an accessible role by default (presentational)", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("role")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple skeletons
// ---------------------------------------------------------------------------

describe("Skeleton — multiple instances", () => {
  it("can render several skeletons without conflict", () => {
    render(
      <>
        <Skeleton data-testid="sk-1" />
        <Skeleton data-testid="sk-2" />
        <Skeleton data-testid="sk-3" />
      </>
    );
    expect(screen.getByTestId("sk-1")).toBeInTheDocument();
    expect(screen.getByTestId("sk-2")).toBeInTheDocument();
    expect(screen.getByTestId("sk-3")).toBeInTheDocument();
  });

  it("each skeleton independently carries animate-shimmer and rounded-xs", () => {
    render(
      <>
        <Skeleton data-testid="a" />
        <Skeleton data-testid="b" />
      </>
    );
    for (const id of ["a", "b"]) {
      const el = screen.getByTestId(id);
      expect(el).toHaveClass("animate-shimmer");
      expect(el).toHaveClass("rounded-xs");
    }
  });
});
