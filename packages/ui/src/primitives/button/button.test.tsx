import * as React from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Button, buttonVariants } from "./button.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(jsx: React.ReactElement) {
  return {
    user: userEvent.setup(),
    ...render(jsx),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Button — rendering", () => {
  it("renders a <button> element by default", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<Button>Save changes</Button>);
    expect(screen.getByText("Save changes")).toBeInTheDocument();
  });

  it("forwards extra HTML attributes", () => {
    render(<Button data-testid="my-btn" type="submit">Submit</Button>);
    const btn = screen.getByTestId("my-btn");
    expect(btn).toHaveAttribute("type", "submit");
  });
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

describe("Button — variants", () => {
  it("applies primary variant classes by default", () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("bg-primary");
    expect(btn).toHaveClass("text-primary-foreground");
  });

  it("applies secondary variant classes", () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("bg-secondary");
    expect(btn).toHaveClass("text-secondary-foreground");
  });

  it("applies ghost variant classes", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("bg-transparent");
    expect(btn).toHaveClass("border");
    expect(btn).toHaveClass("border-input");
    expect(btn).toHaveClass("text-foreground");
  });

  it("applies destructive variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("bg-destructive");
    expect(btn).toHaveClass("text-destructive-foreground");
  });

  it("applies link variant classes", () => {
    render(<Button variant="link">Learn more</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("bg-transparent");
    expect(btn).toHaveClass("text-primary");
    expect(btn).toHaveClass("underline-offset-4");
  });
});

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

describe("Button — sizes", () => {
  it("applies default size classes", () => {
    render(<Button size="default">Default</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("h-10");
    expect(btn).toHaveClass("px-5");
    expect(btn).toHaveClass("text-sm");
  });

  it("applies sm size classes", () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("h-8");
    expect(btn).toHaveClass("px-4");
    expect(btn).toHaveClass("text-xs");
  });

  it("applies lg size classes", () => {
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("h-11");
    expect(btn).toHaveClass("px-7");
    expect(btn).toHaveClass("text-base");
  });

  it("applies icon size classes", () => {
    render(<Button size="icon" aria-label="Open menu" />);
    const btn = screen.getByRole("button", { name: /open menu/i });
    expect(btn).toHaveClass("size-9");
    expect(btn).toHaveClass("p-0");
  });
});

// ---------------------------------------------------------------------------
// Pill radius (ADR-025 brand token)
// ---------------------------------------------------------------------------

describe("Button — brand token", () => {
  it("always applies rounded-pill regardless of variant", () => {
    const { rerender } = render(<Button variant="primary">Pill</Button>);
    expect(screen.getByRole("button")).toHaveClass("rounded-pill");

    rerender(<Button variant="ghost">Pill ghost</Button>);
    expect(screen.getByRole("button")).toHaveClass("rounded-pill");

    rerender(<Button variant="destructive">Pill destructive</Button>);
    expect(screen.getByRole("button")).toHaveClass("rounded-pill");
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Button — className prop", () => {
  it("merges custom className with variant classes", () => {
    render(<Button className="my-custom-class">Custom</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("my-custom-class");
    // Verify CVA base classes are still present
    expect(btn).toHaveClass("inline-flex");
    expect(btn).toHaveClass("items-center");
  });
});

// ---------------------------------------------------------------------------
// forwardRef
// ---------------------------------------------------------------------------

describe("Button — forwardRef", () => {
  it("forwards ref to the underlying <button> element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref test</Button>);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("ref points at the correct DOM node", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref} data-testid="ref-btn">Ref</Button>);
    expect(ref.current).toBe(screen.getByTestId("ref-btn"));
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Button — displayName", () => {
  it("has the correct displayName for DevTools", () => {
    expect(Button.displayName).toBe("Button");
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("Button — interactions", () => {
  it("fires onClick when clicked", async () => {
    const handleClick = vi.fn();
    const { user } = setup(<Button onClick={handleClick}>Click</Button>);
    await user.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const handleClick = vi.fn();
    const { user } = setup(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>
    );
    await user.click(screen.getByRole("button"));
    expect(handleClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe("Button — disabled state", () => {
  it("is disabled when the disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies disabled styling classes", () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("disabled:pointer-events-none");
    expect(btn).toHaveClass("disabled:opacity-50");
  });
});

// ---------------------------------------------------------------------------
// asChild — Radix Slot delegation
// ---------------------------------------------------------------------------

describe("Button — asChild", () => {
  it("renders the child element instead of a <button> when asChild is true", () => {
    render(
      <Button asChild variant="primary">
        <a href="/interviews/new">New interview</a>
      </Button>
    );
    // The DOM should contain an <a>, not a <button>
    expect(screen.getByRole("link", { name: /new interview/i })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies buttonVariants classes to the slotted element", () => {
    render(
      <Button asChild variant="ghost" size="sm">
        <a href="/back">Back</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: /back/i });
    expect(link).toHaveClass("bg-transparent");
    expect(link).toHaveClass("border");
    expect(link).toHaveClass("rounded-pill");
    expect(link).toHaveClass("h-8");
  });

  it("forwards ref to the slotted element when asChild is true", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Button asChild ref={ref}>
        <a href="/test">Slot ref</a>
      </Button>
    );
    // The ref should point at the <a> element (Slot merges the ref)
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName.toLowerCase()).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Focus ring (keyboard accessibility — "Lucid" brand adjective)
// ---------------------------------------------------------------------------

describe("Button — focus ring", () => {
  it("applies focus-visible ring classes for keyboard accessibility", () => {
    render(<Button>Focus me</Button>);
    const btn = screen.getByRole("button");
    // These classes are part of the compiled className regardless of focus state;
    // visual verification of the CSS rule activation requires a browser — here we
    // assert the classes are present so they can activate on keyboard focus.
    expect(btn).toHaveClass("focus-visible:ring-2");
    expect(btn).toHaveClass("focus-visible:ring-ring");
    expect(btn).toHaveClass("focus-visible:outline-none");
  });
});

// ---------------------------------------------------------------------------
// buttonVariants export (for composites that reuse the variant map)
// ---------------------------------------------------------------------------

describe("buttonVariants export", () => {
  it("is a function that returns a class string", () => {
    const result = buttonVariants({ variant: "primary", size: "default" });
    expect(typeof result).toBe("string");
    expect(result).toContain("bg-primary");
    expect(result).toContain("rounded-pill");
  });

  it("accepts all documented variants without throwing", () => {
    const variants = ["primary", "secondary", "ghost", "destructive", "link"] as const;
    for (const variant of variants) {
      expect(() => buttonVariants({ variant })).not.toThrow();
    }
  });

  it("accepts all documented sizes without throwing", () => {
    const sizes = ["default", "sm", "lg", "icon"] as const;
    for (const size of sizes) {
      expect(() => buttonVariants({ size })).not.toThrow();
    }
  });
});
