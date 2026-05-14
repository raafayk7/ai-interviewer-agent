import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Label } from "./label.js";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Label — rendering", () => {
  it("renders a label element in the document", () => {
    render(<Label>Email address</Label>);
    expect(screen.getByText("Email address")).toBeInTheDocument();
  });

  it("renders children as label text", () => {
    render(<Label>First name</Label>);
    expect(screen.getByText("First name")).toBeInTheDocument();
  });

  it("renders as a <label> HTML element", () => {
    render(<Label>Password</Label>);
    const el = screen.getByText("Password");
    expect(el.tagName.toLowerCase()).toBe("label");
  });

  it("forwards extra HTML attributes to the label element", () => {
    render(<Label data-testid="my-label">Test</Label>);
    expect(screen.getByTestId("my-label")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Token classes
// ---------------------------------------------------------------------------

describe("Label — token classes", () => {
  it("has text-sm class", () => {
    render(<Label>Size check</Label>);
    expect(screen.getByText("Size check")).toHaveClass("text-sm");
  });

  it("has font-medium class", () => {
    render(<Label>Weight check</Label>);
    expect(screen.getByText("Weight check")).toHaveClass("font-medium");
  });

  it("has leading-none class", () => {
    render(<Label>Leading check</Label>);
    expect(screen.getByText("Leading check")).toHaveClass("leading-none");
  });

  it("has text-foreground class for semantic color", () => {
    render(<Label>Color check</Label>);
    expect(screen.getByText("Color check")).toHaveClass("text-foreground");
  });

  it("has peer-disabled:cursor-not-allowed class", () => {
    render(<Label>Disabled peer check</Label>);
    expect(screen.getByText("Disabled peer check")).toHaveClass(
      "peer-disabled:cursor-not-allowed"
    );
  });

  it("has peer-disabled:opacity-50 class", () => {
    render(<Label>Opacity peer check</Label>);
    expect(screen.getByText("Opacity peer check")).toHaveClass(
      "peer-disabled:opacity-50"
    );
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Label — className merging", () => {
  it("merges custom className with base classes", () => {
    render(<Label className="my-custom-label">Merge test</Label>);
    const el = screen.getByText("Merge test");
    expect(el).toHaveClass("my-custom-label");
    expect(el).toHaveClass("text-sm");
    expect(el).toHaveClass("font-medium");
  });

  it("custom className does not remove base token classes", () => {
    render(<Label className="extra-class">Token check</Label>);
    const el = screen.getByText("Token check");
    expect(el).toHaveClass("text-foreground");
    expect(el).toHaveClass("extra-class");
  });
});

// ---------------------------------------------------------------------------
// forwardRef
// ---------------------------------------------------------------------------

describe("Label — forwardRef", () => {
  it("ref.current is not null after render", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Ref test</Label>);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLLabelElement", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Type test</Label>);
    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
  });

  it("ref.current points at the correct DOM node", () => {
    const ref = React.createRef<HTMLLabelElement>();
    render(<Label ref={ref} data-testid="ref-label">Node test</Label>);
    expect(ref.current).toBe(screen.getByTestId("ref-label"));
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Label — displayName", () => {
  it('displayName is "Label"', () => {
    expect(Label.displayName).toBe("Label");
  });
});

// ---------------------------------------------------------------------------
// htmlFor — association with input
// ---------------------------------------------------------------------------

describe("Label — htmlFor", () => {
  it("passes htmlFor attribute through to the label element", () => {
    render(<Label htmlFor="email-input">Email</Label>);
    const el = screen.getByText("Email");
    expect(el).toHaveAttribute("for", "email-input");
  });

  it("clicking the label focuses an associated input via htmlFor", () => {
    render(
      <>
        <Label htmlFor="name-field">Name</Label>
        <input id="name-field" />
      </>
    );
    const label = screen.getByText("Name");
    expect(label).toHaveAttribute("for", "name-field");
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("id", "name-field");
  });

  it("works without htmlFor (standalone label)", () => {
    render(<Label>No association</Label>);
    expect(screen.getByText("No association")).toBeInTheDocument();
  });
});
