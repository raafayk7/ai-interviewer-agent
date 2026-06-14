import * as React from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Input } from "./input.js";

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

describe("Input — rendering", () => {
  it("renders an input element with role textbox", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders without an explicit type attribute when none is provided", () => {
    const { container } = render(<Input />);
    expect(container.querySelector("input")).not.toHaveAttribute("type");
  });

  it("forwards extra HTML attributes", () => {
    render(<Input data-testid="my-input" name="email" />);
    const input = screen.getByTestId("my-input");
    expect(input).toHaveAttribute("name", "email");
  });
});

// ---------------------------------------------------------------------------
// Token classes
// ---------------------------------------------------------------------------

describe("Input — token classes", () => {
  it("applies rounded-sm class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("rounded-sm");
  });

  it("applies border-input class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("border-input");
  });

  it("applies bg-input class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("bg-input");
  });

  it("applies focus-visible:ring-2 class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("focus-visible:ring-2");
  });

  it("applies focus-visible:ring-ring class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("focus-visible:ring-ring");
  });

  it("applies w-full and h-10 classes", () => {
    render(<Input />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveClass("w-full");
    expect(input).toHaveClass("h-10");
  });

  it("applies text-foreground class", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toHaveClass("text-foreground");
  });
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------

describe("Input — className merging", () => {
  it("merges custom className with base classes", () => {
    render(<Input className="my-custom-input" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveClass("my-custom-input");
    expect(input).toHaveClass("flex");
    expect(input).toHaveClass("border-input");
  });
});

// ---------------------------------------------------------------------------
// forwardRef
// ---------------------------------------------------------------------------

describe("Input — forwardRef", () => {
  it("ref.current instanceof HTMLInputElement", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref points to the correct DOM node", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} data-testid="ref-input" />);
    expect(ref.current).toBe(screen.getByTestId("ref-input"));
  });
});

// ---------------------------------------------------------------------------
// displayName
// ---------------------------------------------------------------------------

describe("Input — displayName", () => {
  it("has the correct displayName", () => {
    expect(Input.displayName).toBe("Input");
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe("Input — interactions", () => {
  it("onChange fires with correct value", async () => {
    const handleChange = vi.fn();
    const { user } = setup(<Input onChange={handleChange} />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(handleChange).toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("onFocus fires when the input is focused", async () => {
    const handleFocus = vi.fn();
    const { user } = setup(<Input onFocus={handleFocus} />);
    await user.click(screen.getByRole("textbox"));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it("onBlur fires when the input loses focus", async () => {
    const handleBlur = vi.fn();
    const { user } = setup(
      <>
        <Input onBlur={handleBlur} data-testid="inp" />
        <button>Other</button>
      </>
    );
    await user.click(screen.getByTestId("inp"));
    await user.click(screen.getByRole("button", { name: "Other" }));
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe("Input — disabled state", () => {
  it("sets the disabled attribute", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("applies disabled:cursor-not-allowed class", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toHaveClass("disabled:cursor-not-allowed");
  });

  it("applies disabled:opacity-50 class", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toHaveClass("disabled:opacity-50");
  });
});

// ---------------------------------------------------------------------------
// Placeholder
// ---------------------------------------------------------------------------

describe("Input — placeholder", () => {
  it("accepts the placeholder prop as an attribute", () => {
    render(<Input placeholder="Enter your name" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Enter your name");
  });

  it("applies placeholder:text-muted-foreground class", () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByRole("textbox")).toHaveClass("placeholder:text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// Type attribute
// ---------------------------------------------------------------------------

describe("Input — type attribute", () => {
  it("passes type=password through to the DOM", () => {
    const { container } = render(<Input type="password" />);
    expect(container.querySelector("input")).toHaveAttribute("type", "password");
  });

  it("passes type=email through to the DOM", () => {
    const { container } = render(<Input type="email" />);
    expect(container.querySelector("input")).toHaveAttribute("type", "email");
  });

  it("passes type=number through to the DOM", () => {
    const { container } = render(<Input type="number" />);
    expect(container.querySelector("input")).toHaveAttribute("type", "number");
  });
});
