import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Textarea } from "./textarea.js";

// ---------------------------------------------------------------------------
// Textarea — rendering
// ---------------------------------------------------------------------------

describe("Textarea — rendering", () => {
  it("renders a <textarea> element", () => {
    const { container } = render(<Textarea />);
    expect(container.querySelector("textarea")).toBeInTheDocument();
  });

  it("renders with a placeholder", () => {
    render(<Textarea placeholder="Enter description" />);
    expect(screen.getByPlaceholderText("Enter description")).toBeInTheDocument();
  });

  it("renders with a default value", () => {
    render(<Textarea defaultValue="Some text" />);
    expect(screen.getByDisplayValue("Some text")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Textarea — className merging
// ---------------------------------------------------------------------------

describe("Textarea — className", () => {
  it("merges a custom className with base classes", () => {
    const { container } = render(<Textarea className="my-textarea" />);
    const el = container.querySelector("textarea");
    expect(el).toHaveClass("my-textarea");
    expect(el).toHaveClass("flex");
    expect(el).toHaveClass("w-full");
  });
});

// ---------------------------------------------------------------------------
// Textarea — disabled state
// ---------------------------------------------------------------------------

describe("Textarea — disabled state", () => {
  it("is disabled when the disabled prop is set", () => {
    const { container } = render(<Textarea disabled />);
    expect(container.querySelector("textarea")).toBeDisabled();
  });

  it("applies disabled styling classes", () => {
    const { container } = render(<Textarea disabled />);
    const el = container.querySelector("textarea");
    expect(el).toHaveClass("disabled:cursor-not-allowed");
    expect(el).toHaveClass("disabled:opacity-50");
  });
});

// ---------------------------------------------------------------------------
// Textarea — forwardRef
// ---------------------------------------------------------------------------

describe("Textarea — forwardRef", () => {
  it("forwards ref to the underlying <textarea> element", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("ref points at the correct DOM node", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    const { container } = render(<Textarea ref={ref} />);
    expect(ref.current).toBe(container.querySelector("textarea"));
  });
});

// ---------------------------------------------------------------------------
// Textarea — extra HTML attribute forwarding
// ---------------------------------------------------------------------------

describe("Textarea — attribute forwarding", () => {
  it("forwards name and rows attributes", () => {
    const { container } = render(<Textarea name="description" rows={5} />);
    const el = container.querySelector("textarea");
    expect(el).toHaveAttribute("name", "description");
    expect(el).toHaveAttribute("rows", "5");
  });
});

// ---------------------------------------------------------------------------
// Textarea — displayName
// ---------------------------------------------------------------------------

describe("Textarea — displayName", () => {
  it("has the correct displayName", () => {
    expect(Textarea.displayName).toBe("Textarea");
  });
});
