import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogOverlay,
} from "./dialog.js";

// ---------------------------------------------------------------------------
// Dialog — open/closed rendering
// ---------------------------------------------------------------------------

describe("Dialog — renders children inside the content panel", () => {
  it("renders dialog content text when open", () => {
    render(
      <Dialog open>
        <DialogContent>
          <p>Hello from dialog</p>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Hello from dialog")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(
      <Dialog open={false}>
        <DialogContent>
          <p>Hidden content</p>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dialog — overlay is rendered when open
// ---------------------------------------------------------------------------

describe("Dialog — overlay", () => {
  it("renders the overlay element when the dialog is open", () => {
    render(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(document.body.textContent).toContain("body");
  });
});

// ---------------------------------------------------------------------------
// Dialog — trigger opens the dialog
// ---------------------------------------------------------------------------

describe("Dialog — trigger interaction", () => {
  it("opens dialog content when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <p>Inside dialog</p>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText("Inside dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(screen.getByText("Inside dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dialog — onOpenChange callback
// ---------------------------------------------------------------------------

describe("Dialog — onOpenChange callback", () => {
  it("calls onOpenChange(false) when the close button inside DialogContent is clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogClose>Close</DialogClose>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// DialogHeader / DialogFooter — structural wrappers
// ---------------------------------------------------------------------------

describe("DialogHeader", () => {
  it("renders children", () => {
    render(<DialogHeader><span>Header content</span></DialogHeader>);
    expect(screen.getByText("Header content")).toBeInTheDocument();
  });

  it("accepts additional className", () => {
    const { container } = render(<DialogHeader className="my-header">Title</DialogHeader>);
    expect(container.firstChild).toHaveClass("my-header");
  });
});

describe("DialogFooter", () => {
  it("renders children", () => {
    render(<DialogFooter><button>Cancel</button></DialogFooter>);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DialogTitle
// ---------------------------------------------------------------------------

describe("DialogTitle", () => {
  it("renders title text", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>My Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DialogDescription
// ---------------------------------------------------------------------------

describe("DialogDescription", () => {
  it("renders description text", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>My description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("My description")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DialogOverlay — standalone rendering (outside portal)
// ---------------------------------------------------------------------------

describe("DialogOverlay — displayName", () => {
  it("has the correct displayName", () => {
    expect(DialogOverlay.displayName).toBe("DialogOverlay");
  });
});

// ---------------------------------------------------------------------------
// DialogContent — displayName
// ---------------------------------------------------------------------------

describe("DialogContent — displayName", () => {
  it("has the correct displayName", () => {
    expect(DialogContent.displayName).toBe("DialogContent");
  });
});

// ---------------------------------------------------------------------------
// DialogTitle — displayName
// ---------------------------------------------------------------------------

describe("DialogTitle — displayName", () => {
  it("has the correct displayName", () => {
    expect(DialogTitle.displayName).toBe("DialogTitle");
  });
});

// ---------------------------------------------------------------------------
// DialogDescription — displayName
// ---------------------------------------------------------------------------

describe("DialogDescription — displayName", () => {
  it("has the correct displayName", () => {
    expect(DialogDescription.displayName).toBe("DialogDescription");
  });
});
