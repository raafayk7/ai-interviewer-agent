import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SoftBlockScreen } from "./soft-block-screen.js";

// ---------------------------------------------------------------------------
// SoftBlockScreen — recruiter audience
// ---------------------------------------------------------------------------

describe("SoftBlockScreen — recruiter audience", () => {
  it("renders the recruiter heading", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    expect(
      screen.getByText("Sift's recruiter workspace is desktop-only."),
    ).toBeInTheDocument();
  });

  it("renders the recruiter body copy", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    expect(
      screen.getByText("Open this link from a laptop or desktop to manage interviews."),
    ).toBeInTheDocument();
  });

  it("renders the recruiter 'why' copy", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    expect(
      screen.getByText(/The dashboard is a wide table/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SoftBlockScreen — candidate audience
// ---------------------------------------------------------------------------

describe("SoftBlockScreen — candidate audience", () => {
  it("renders the candidate heading", () => {
    render(<SoftBlockScreen audience="candidate" />);
    expect(
      screen.getByText("Sift works best on a laptop or desktop."),
    ).toBeInTheDocument();
  });

  it("renders the candidate body copy", () => {
    render(<SoftBlockScreen audience="candidate" />);
    expect(
      screen.getByText("Open this link from a computer to begin your interview. We'll keep your scheduled session ready — nothing expires when you switch devices."),
    ).toBeInTheDocument();
  });

  it("renders the candidate 'why' copy mentioning mic", () => {
    render(<SoftBlockScreen audience="candidate" />);
    expect(screen.getByText(/reliable mic and connection/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SoftBlockScreen — accessibility
// ---------------------------------------------------------------------------

describe("SoftBlockScreen — accessibility", () => {
  it("has role='alert' for screen reader announcement", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has aria-live='polite' for non-intrusive announcement", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
  });
});

// ---------------------------------------------------------------------------
// SoftBlockScreen — heading element
// ---------------------------------------------------------------------------

describe("SoftBlockScreen — heading element", () => {
  it("renders an h2 for the recruiter heading", () => {
    render(<SoftBlockScreen audience="recruiter" />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain("desktop-only");
  });

  it("renders an h2 for the candidate heading", () => {
    render(<SoftBlockScreen audience="candidate" />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain("laptop or desktop");
  });
});

// ---------------------------------------------------------------------------
// SoftBlockScreen — className forwarding
// ---------------------------------------------------------------------------

describe("SoftBlockScreen — className forwarding", () => {
  it("merges custom className onto the root element", () => {
    render(<SoftBlockScreen audience="recruiter" className="extra-class" />);
    const root = screen.getByRole("alert");
    expect(root).toHaveClass("extra-class");
  });
});
