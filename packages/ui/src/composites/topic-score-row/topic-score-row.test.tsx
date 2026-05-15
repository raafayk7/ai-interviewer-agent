import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopicScoreRow } from "./topic-score-row.js";

// ---------------------------------------------------------------------------
// TopicScoreRow — content rendering
// ---------------------------------------------------------------------------

describe("TopicScoreRow — topic name", () => {
  it("renders the topic name", () => {
    render(
      <TopicScoreRow
        topicName="Technical Knowledge"
        score={4}
        justification="Strong fundamentals."
      />,
    );
    expect(screen.getByText("Technical Knowledge")).toBeInTheDocument();
  });
});

describe("TopicScoreRow — score display", () => {
  it("renders the score as 'X.Y / 5'", () => {
    render(
      <TopicScoreRow topicName="Communication" score={3.5} justification="Good." />,
    );
    expect(screen.getByText("3.5 / 5")).toBeInTheDocument();
  });

  it("renders integer scores with one decimal place", () => {
    render(
      <TopicScoreRow topicName="Problem Solving" score={5} justification="Excellent." />,
    );
    expect(screen.getByText("5.0 / 5")).toBeInTheDocument();
  });

  it("renders score of 0 as '0.0 / 5'", () => {
    render(
      <TopicScoreRow topicName="Leadership" score={0} justification="N/A." />,
    );
    expect(screen.getByText("0.0 / 5")).toBeInTheDocument();
  });
});

describe("TopicScoreRow — justification", () => {
  it("renders the justification text", () => {
    render(
      <TopicScoreRow
        topicName="Communication"
        score={3}
        justification="Candidate demonstrated clear communication."
      />,
    );
    expect(
      screen.getByText("Candidate demonstrated clear communication."),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TopicScoreRow — progress bar width
// ---------------------------------------------------------------------------

describe("TopicScoreRow — progress bar", () => {
  it("sets the progress bar width to 100% when score is 5", () => {
    const { container } = render(
      <TopicScoreRow topicName="T" score={5} justification="Max." />,
    );
    const bar = container.querySelector("[style]") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("100%");
  });

  it("sets the progress bar width to 0% when score is 0", () => {
    const { container } = render(
      <TopicScoreRow topicName="T" score={0} justification="Zero." />,
    );
    const bar = container.querySelector("[style]") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("sets the progress bar width to 60% when score is 3 out of 5", () => {
    const { container } = render(
      <TopicScoreRow topicName="T" score={3} justification="Moderate." />,
    );
    const bar = container.querySelector("[style]") as HTMLElement;
    expect(bar.style.width).toBe("60%");
  });

  it("sets the progress bar width to 40% when score is 2 out of 5", () => {
    const { container } = render(
      <TopicScoreRow topicName="T" score={2} justification="Below average." />,
    );
    const bar = container.querySelector("[style]") as HTMLElement;
    expect(bar.style.width).toBe("40%");
  });
});
