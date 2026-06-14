import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useInterviewSessionStore } from "@/stores/useInterviewSessionStore";
import type { CandidateInterviewView } from "@/types";
import { InterviewSessionContainer } from "./InterviewSessionContainer";
import { useInterviewSession } from "./useInterviewSession";

vi.mock("./useInterviewSession", () => ({
  useInterviewSession: vi.fn(),
}));

vi.mock("@repo/ui/composites/voice-presence", () => ({
  VoicePresence: ({ state, tone }: { state: string; tone: string }) => (
    <div data-testid="voice-presence" data-state={state} data-tone={tone} />
  ),
}));

vi.mock("@repo/ui/composites/connection-loss-banner", () => ({
  ConnectionLossBanner: ({ state }: { state: string }) => (
    <div data-testid="connection-loss-banner" data-state={state} />
  ),
}));

vi.mock("@repo/ui/composites/transcript-feed", () => ({
  TranscriptFeed: () => <ol data-testid="transcript-feed" />,
}));

vi.mock("@/components/SessionEndModal", () => ({
  SessionEndModal: ({ variant }: { variant: string }) => (
    <div data-testid="session-end-modal" data-variant={variant} />
  ),
}));

const view = (
  overrides: Partial<CandidateInterviewView> = {},
): CandidateInterviewView => ({
  interviewId: "11111111-1111-4111-8111-111111111111",
  candidateName: "Jane Doe",
  jobTitle: "Frontend Engineer",
  company: "Sift",
  scheduledAt: new Date("2026-06-13T10:00:00.000Z"),
  targetDurationMinutes: 15,
  status: "SCHEDULED",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useInterviewSessionStore.getState().reset();
  useInterviewSessionStore.setState({ transcriptVisible: false });
});

describe("InterviewSessionContainer — session integrity states", () => {
  it("renders interrupted as the failed connection banner with an amber low-glow orb and no modal", () => {
    useInterviewSessionStore.setState({
      connectionState: "interrupted",
      speaker: "ai",
    });

    render(<InterviewSessionContainer view={view()} token="signed-token" />);

    expect(screen.getByTestId("connection-loss-banner")).toHaveAttribute(
      "data-state",
      "failed",
    );
    expect(screen.getByTestId("voice-presence")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.queryByTestId("session-end-modal")).not.toBeInTheDocument();
  });

  it("renders completed as the completed modal without a connection-loss banner", () => {
    useInterviewSessionStore.setState({ connectionState: "completed" });

    render(<InterviewSessionContainer view={view()} token="signed-token" />);

    expect(screen.getByTestId("session-end-modal")).toHaveAttribute(
      "data-variant",
      "completed",
    );
    expect(screen.queryByTestId("connection-loss-banner")).not.toBeInTheDocument();
  });

  it("gates terminal FAILED views before starting a session and renders the blocked modal", () => {
    render(
      <InterviewSessionContainer
        view={view({ status: "FAILED" })}
        token="signed-token"
      />,
    );

    expect(vi.mocked(useInterviewSession)).toHaveBeenCalledWith({
      interviewId: "11111111-1111-4111-8111-111111111111",
      token: "signed-token",
      enabled: false,
    });
    expect(screen.getByTestId("session-end-modal")).toHaveAttribute(
      "data-variant",
      "blocked",
    );
  });
});
