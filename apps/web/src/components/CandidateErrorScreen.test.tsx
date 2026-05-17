import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateErrorScreen, type CandidateErrorKind } from "./CandidateErrorScreen";

// ---------------------------------------------------------------------------
// CandidateErrorScreen — render tests
// ---------------------------------------------------------------------------

const ALL_KINDS: CandidateErrorKind[] = [
  "invalid-link",
  "expired-link",
  "interview-not-ready",
  "mic-denied",
  "session-interrupted",
  "network",
];

const EXPECTED_TITLES: Record<CandidateErrorKind, RegExp> = {
  "invalid-link": /this link doesn't look right/i,
  "expired-link": /this link has expired/i,
  "interview-not-ready": /this interview isn't ready yet/i,
  "mic-denied": /we can't hear you/i,
  "session-interrupted": /your session was interrupted/i,
  network: /we can't reach sift right now/i,
};

describe("CandidateErrorScreen", () => {
  for (const kind of ALL_KINDS) {
    it(`renders the unique title for kind "${kind}"`, () => {
      render(<CandidateErrorScreen kind={kind} />);
      expect(screen.getByText(EXPECTED_TITLES[kind])).toBeInTheDocument();
    });
  }

  it("renders the title as an <h1> for kind 'invalid-link'", () => {
    render(<CandidateErrorScreen kind="invalid-link" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /this link doesn't look right/i }),
    ).toBeInTheDocument();
  });

  it("renders the title as an <h1> for kind 'expired-link'", () => {
    render(<CandidateErrorScreen kind="expired-link" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /this link has expired/i }),
    ).toBeInTheDocument();
  });

  it("renders the title as an <h1> for kind 'interview-not-ready'", () => {
    render(<CandidateErrorScreen kind="interview-not-ready" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /this interview isn't ready yet/i }),
    ).toBeInTheDocument();
  });

  it("renders the title as an <h1> for kind 'mic-denied'", () => {
    render(<CandidateErrorScreen kind="mic-denied" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /we can't hear you/i }),
    ).toBeInTheDocument();
  });

  it("renders the title as an <h1> for kind 'session-interrupted'", () => {
    render(<CandidateErrorScreen kind="session-interrupted" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /your session was interrupted/i }),
    ).toBeInTheDocument();
  });

  it("renders the title as an <h1> for kind 'network'", () => {
    render(<CandidateErrorScreen kind="network" />);
    expect(
      screen.getByRole("heading", { level: 1, name: /we can't reach sift right now/i }),
    ).toBeInTheDocument();
  });

  it("renders a hint paragraph for kind 'mic-denied'", () => {
    render(<CandidateErrorScreen kind="mic-denied" />);
    expect(
      screen.getByText(/click the lock icon in your browser's address bar/i),
    ).toBeInTheDocument();
  });

  it("renders a hint paragraph for kind 'session-interrupted'", () => {
    render(<CandidateErrorScreen kind="session-interrupted" />);
    expect(
      screen.getByText(/refresh this page to try again/i),
    ).toBeInTheDocument();
  });

  it("does NOT render a hint paragraph for kind 'invalid-link'", () => {
    render(<CandidateErrorScreen kind="invalid-link" />);
    expect(screen.queryByText(/click the lock icon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refresh this page to try again/i)).not.toBeInTheDocument();
  });

  it("does NOT render a hint paragraph for kind 'network'", () => {
    render(<CandidateErrorScreen kind="network" />);
    expect(screen.queryByText(/click the lock icon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refresh this page to try again/i)).not.toBeInTheDocument();
  });
});
