import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InterviewStatusBadge, type InterviewStatusValue } from "./interview-status-badge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: InterviewStatusValue[] = [
  "CREATED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "EVALUATED",
  "CANCELLED",
];

// ---------------------------------------------------------------------------
// InterviewStatusBadge — label per status
// ---------------------------------------------------------------------------

describe("InterviewStatusBadge — label rendering", () => {
  it("renders 'Draft' label for CREATED status", () => {
    render(<InterviewStatusBadge status="CREATED" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders 'Scheduled' label for SCHEDULED status", () => {
    render(<InterviewStatusBadge status="SCHEDULED" />);
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("renders 'In progress' label for IN_PROGRESS status", () => {
    render(<InterviewStatusBadge status="IN_PROGRESS" />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("renders 'Completed' label for COMPLETED status", () => {
    render(<InterviewStatusBadge status="COMPLETED" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders 'Report ready' label for EVALUATED status", () => {
    render(<InterviewStatusBadge status="EVALUATED" />);
    expect(screen.getByText("Report ready")).toBeInTheDocument();
  });

  it("renders 'Cancelled' label for CANCELLED status", () => {
    render(<InterviewStatusBadge status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InterviewStatusBadge — dot indicator only for IN_PROGRESS
// ---------------------------------------------------------------------------

describe("InterviewStatusBadge — dot indicator", () => {
  it("renders a dot indicator for IN_PROGRESS status", () => {
    const { container } = render(<InterviewStatusBadge status="IN_PROGRESS" />);
    // Badge renders a dot <span> when dot={true}
    const dot = container.querySelector("span > span");
    expect(dot).toBeInTheDocument();
  });

  it("does not render a dot indicator for CREATED status", () => {
    const { container } = render(<InterviewStatusBadge status="CREATED" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeInTheDocument();
  });

  it("does not render a dot indicator for SCHEDULED status", () => {
    const { container } = render(<InterviewStatusBadge status="SCHEDULED" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeInTheDocument();
  });

  it("does not render a dot indicator for COMPLETED status", () => {
    const { container } = render(<InterviewStatusBadge status="COMPLETED" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeInTheDocument();
  });

  it("does not render a dot indicator for EVALUATED status", () => {
    const { container } = render(<InterviewStatusBadge status="EVALUATED" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeInTheDocument();
  });

  it("does not render a dot indicator for CANCELLED status", () => {
    const { container } = render(<InterviewStatusBadge status="CANCELLED" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InterviewStatusBadge — all statuses render without error
// ---------------------------------------------------------------------------

describe("InterviewStatusBadge — no render errors for any status", () => {
  for (const status of ALL_STATUSES) {
    it(`renders without error for status: ${status}`, () => {
      expect(() => render(<InterviewStatusBadge status={status} />)).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// InterviewStatusBadge — className forwarding
// ---------------------------------------------------------------------------

describe("InterviewStatusBadge — className forwarding", () => {
  it("forwards className to the badge element", () => {
    const { container } = render(
      <InterviewStatusBadge status="CREATED" className="my-custom-class" />,
    );
    const badge = container.querySelector("span");
    expect(badge).toHaveClass("my-custom-class");
  });
});
