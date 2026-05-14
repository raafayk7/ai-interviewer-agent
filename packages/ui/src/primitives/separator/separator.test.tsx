import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Separator } from "./separator.js";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Separator — rendering", () => {
  it("renders an element in the document", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("has bg-border class", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toHaveClass("bg-border");
  });

  it("has shrink-0 class", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toHaveClass("shrink-0");
  });
});

// ---------------------------------------------------------------------------
// Horizontal orientation (default)
// ---------------------------------------------------------------------------

describe("Separator — horizontal (default)", () => {
  it("has h-px class by default", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toHaveClass("h-px");
  });

  it("has w-full class by default", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toHaveClass("w-full");
  });

  it("has h-px when orientation is explicitly set to horizontal", () => {
    const { container } = render(<Separator orientation="horizontal" />);
    expect(container.firstChild).toHaveClass("h-px");
  });

  it("does NOT have h-full when orientation is horizontal", () => {
    const { container } = render(<Separator orientation="horizontal" />);
    expect(container.firstChild).not.toHaveClass("h-full");
  });
});

// ---------------------------------------------------------------------------
// Vertical orientation
// ---------------------------------------------------------------------------

describe("Separator — vertical", () => {
  it("has h-full class when orientation is vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).toHaveClass("h-full");
  });

  it("has w-px class when orientation is vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).toHaveClass("w-px");
  });

  it("does NOT have h-px when orientation is vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).not.toHaveClass("h-px");
  });

  it("does NOT have w-full when orientation is vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.firstChild).not.toHaveClass("w-full");
  });
});

// ---------------------------------------------------------------------------
// Decorative / ARIA role
// ---------------------------------------------------------------------------

describe("Separator — decorative", () => {
  it("has role=none by default (decorative=true)", () => {
    render(<Separator />);
    const el = document.querySelector("[role='none']");
    expect(el).toBeInTheDocument();
  });

  it("has role=separator when decorative is false", () => {
    render(<Separator decorative={false} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("does NOT have role=separator when decorative is true", () => {
    render(<Separator decorative={true} />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Separator — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<Separator className="my-separator" />);
    expect(container.firstChild).toHaveClass("my-separator");
    expect(container.firstChild).toHaveClass("shrink-0");
    expect(container.firstChild).toHaveClass("bg-border");
  });

  it("custom class does not remove orientation classes", () => {
    const { container } = render(<Separator className="extra" />);
    expect(container.firstChild).toHaveClass("h-px");
    expect(container.firstChild).toHaveClass("w-full");
    expect(container.firstChild).toHaveClass("extra");
  });
});

// ---------------------------------------------------------------------------
// forwardRef
// ---------------------------------------------------------------------------

describe("Separator — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Separator ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current points at the rendered element", () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<Separator ref={ref} />);
    expect(ref.current).toBe(container.firstChild);
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Separator — displayName", () => {
  it('displayName is "Separator"', () => {
    expect(Separator.displayName).toBe("Separator");
  });
});
