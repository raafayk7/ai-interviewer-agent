import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CandidateInterviewView } from "@/types";
import { PostInterviewContainer } from "./PostInterviewContainer";
import { usePostInterview } from "./usePostInterview";

// Factory mock (not auto-mock): avoids importing the real hook, whose service
// import chain loads `@/lib/env` and throws on the unset NEXT_PUBLIC_API_URL.
vi.mock("./usePostInterview", () => ({
  usePostInterview: vi.fn(),
}));
vi.mock("@/components/CandidatePageShell", () => ({
  CandidatePageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function view(status: CandidateInterviewView["status"]): CandidateInterviewView {
  return {
    interviewId: "11111111-1111-4111-8111-111111111111",
    candidateName: "Jane Doe",
    jobTitle: "Senior Frontend Engineer",
    company: "Acme Corp",
    scheduledAt: new Date("2026-06-01T10:00:00.000Z"),
    targetDurationMinutes: 30,
    status,
  };
}

describe("PostInterviewContainer", () => {
  it("shows a 'couldn't complete' message (not the done message) for a FAILED interview", () => {
    vi.mocked(usePostInterview).mockReturnValue({ view: view("FAILED"), isTerminal: true });
    render(<PostInterviewContainer view={view("FAILED")} token="t" />);
    expect(screen.getByText(/couldn't complete your interview/i)).toBeInTheDocument();
    expect(screen.queryByText(/thanks, you're done/i)).not.toBeInTheDocument();
  });

  it("shows the done message for a COMPLETED interview", () => {
    vi.mocked(usePostInterview).mockReturnValue({ view: view("COMPLETED"), isTerminal: true });
    render(<PostInterviewContainer view={view("COMPLETED")} token="t" />);
    expect(screen.getByText(/thanks, you're done/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't complete/i)).not.toBeInTheDocument();
  });
});
