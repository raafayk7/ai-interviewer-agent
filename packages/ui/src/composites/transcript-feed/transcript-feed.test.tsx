import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptFeed } from "./transcript-feed.js";
import type { TranscriptFeedEntry } from "./transcript-feed.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseEntry = (
  overrides: Partial<TranscriptFeedEntry> = {},
): TranscriptFeedEntry => ({
  speaker: "agent",
  text: "Tell me about your background.",
  timestamp: new Date("2026-05-01T00:00:00.000Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// TranscriptFeed — ARIA structure
// ---------------------------------------------------------------------------

describe("TranscriptFeed — ARIA structure", () => {
  it("renders a list element with aria-live=polite", () => {
    render(<TranscriptFeed entries={[baseEntry()]} />);
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("aria-live", "polite");
  });
});

// ---------------------------------------------------------------------------
// TranscriptFeed — empty state
// ---------------------------------------------------------------------------

describe("TranscriptFeed — empty entries", () => {
  it("renders an empty list with no list items when entries is empty", () => {
    render(<TranscriptFeed entries={[]} />);
    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TranscriptFeed — agent speaker label
// ---------------------------------------------------------------------------

describe("TranscriptFeed — agent speaker label", () => {
  it('renders "Sift" as the speaker label for agent entries', () => {
    render(<TranscriptFeed entries={[baseEntry({ speaker: "agent" })]} />);
    // The label span renders "Sift ·" — match the exact label text node
    expect(screen.getByText(/^Sift\s/)).toBeInTheDocument();
  });

  it("applies text-transcript-ai class to the agent speaker label", () => {
    render(<TranscriptFeed entries={[baseEntry({ speaker: "agent" })]} />);
    const label = screen.getByText(/^Sift\s/);
    expect(label).toHaveClass("text-transcript-ai");
  });
});

// ---------------------------------------------------------------------------
// TranscriptFeed — candidate speaker label
// ---------------------------------------------------------------------------

describe("TranscriptFeed — candidate speaker label", () => {
  it('renders "Candidate" as the speaker label for candidate entries', () => {
    render(
      <TranscriptFeed
        entries={[baseEntry({ speaker: "candidate", text: "I have five years of experience." })]}
      />,
    );
    expect(screen.getByText(/Candidate/)).toBeInTheDocument();
  });

  it("applies text-transcript-candidate class to the candidate speaker label", () => {
    render(
      <TranscriptFeed
        entries={[baseEntry({ speaker: "candidate", text: "I have five years of experience." })]}
      />,
    );
    const label = screen.getByText(/Candidate/);
    expect(label).toHaveClass("text-transcript-candidate");
  });
});

// ---------------------------------------------------------------------------
// TranscriptFeed — entry text renders
// ---------------------------------------------------------------------------

describe("TranscriptFeed — entry text", () => {
  it("renders the text of an agent entry", () => {
    render(<TranscriptFeed entries={[baseEntry({ text: "Tell me about yourself." })]} />);
    expect(screen.getByText("Tell me about yourself.")).toBeInTheDocument();
  });

  it("renders the text of a candidate entry", () => {
    render(
      <TranscriptFeed
        entries={[baseEntry({ speaker: "candidate", text: "Sure, I'm a software engineer." })]}
      />,
    );
    expect(screen.getByText("Sure, I'm a software engineer.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TranscriptFeed — multiple entries
// ---------------------------------------------------------------------------

describe("TranscriptFeed — multiple entries", () => {
  it("renders the correct number of list items for multiple entries", () => {
    const entries: TranscriptFeedEntry[] = [
      baseEntry({ speaker: "agent", text: "First question." }),
      baseEntry({ speaker: "candidate", text: "My answer.", timestamp: new Date("2026-05-01T00:00:10.000Z") }),
      baseEntry({ speaker: "agent", text: "Follow-up.", timestamp: new Date("2026-05-01T00:00:20.000Z") }),
    ];
    render(<TranscriptFeed entries={entries} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders text for each entry in a multi-entry list", () => {
    const entries: TranscriptFeedEntry[] = [
      baseEntry({ speaker: "agent", text: "First question." }),
      baseEntry({ speaker: "candidate", text: "My answer.", timestamp: new Date("2026-05-01T00:00:10.000Z") }),
    ];
    render(<TranscriptFeed entries={entries} />);
    expect(screen.getByText("First question.")).toBeInTheDocument();
    expect(screen.getByText("My answer.")).toBeInTheDocument();
  });
});
