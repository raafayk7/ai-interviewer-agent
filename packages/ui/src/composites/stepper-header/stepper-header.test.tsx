import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepperHeader } from "./stepper-header.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STEPS = ["Job description", "Candidate CV", "Instructions", "Review"] as const;

// ---------------------------------------------------------------------------
// StepperHeader — rendering step numbers
// ---------------------------------------------------------------------------

describe("StepperHeader — step numbers", () => {
  it("renders step number 1 for the first step", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders step number 4 for the last step", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders all four step numbers when there are four steps", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StepperHeader — step labels
// ---------------------------------------------------------------------------

describe("StepperHeader — step labels", () => {
  it("renders all step label texts", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    for (const label of STEPS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// StepperHeader — aria-current="step" on active step
// ---------------------------------------------------------------------------

describe("StepperHeader — aria-current on active step", () => {
  it("sets aria-current='step' on the first step when currentIndex is 0", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    const stepNumbers = screen.getAllByText(/^[1-4]$/);
    expect(stepNumbers[0]).toHaveAttribute("aria-current", "step");
  });

  it("sets aria-current='step' on the second step when currentIndex is 1", () => {
    render(<StepperHeader steps={STEPS} currentIndex={1} />);
    const stepNumbers = screen.getAllByText(/^[1-4]$/);
    expect(stepNumbers[1]).toHaveAttribute("aria-current", "step");
  });

  it("sets aria-current='step' on the third step when currentIndex is 2", () => {
    render(<StepperHeader steps={STEPS} currentIndex={2} />);
    const stepNumbers = screen.getAllByText(/^[1-4]$/);
    expect(stepNumbers[2]).toHaveAttribute("aria-current", "step");
  });

  it("sets aria-current='step' on the last step when currentIndex is 3", () => {
    render(<StepperHeader steps={STEPS} currentIndex={3} />);
    const stepNumbers = screen.getAllByText(/^[1-4]$/);
    expect(stepNumbers[3]).toHaveAttribute("aria-current", "step");
  });

  it("does not set aria-current on non-active steps", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    const stepNumbers = screen.getAllByText(/^[1-4]$/);
    expect(stepNumbers[1]).not.toHaveAttribute("aria-current");
    expect(stepNumbers[2]).not.toHaveAttribute("aria-current");
    expect(stepNumbers[3]).not.toHaveAttribute("aria-current");
  });
});

// ---------------------------------------------------------------------------
// StepperHeader — accessible list structure
// ---------------------------------------------------------------------------

describe("StepperHeader — accessible list", () => {
  it("renders an ordered list with aria-label 'Progress'", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    expect(screen.getByRole("list", { name: /progress/i })).toBeInTheDocument();
  });

  it("renders the correct number of list items", () => {
    render(<StepperHeader steps={STEPS} currentIndex={0} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(STEPS.length);
  });
});

// ---------------------------------------------------------------------------
// StepperHeader — single step edge case
// ---------------------------------------------------------------------------

describe("StepperHeader — single step", () => {
  it("renders correctly with a single step", () => {
    render(<StepperHeader steps={["Only step"]} currentIndex={0} />);
    expect(screen.getByText("Only step")).toBeInTheDocument();
    expect(screen.getByText("1")).toHaveAttribute("aria-current", "step");
  });
});
