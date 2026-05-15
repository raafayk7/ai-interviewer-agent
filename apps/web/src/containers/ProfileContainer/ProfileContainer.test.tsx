import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: vi.fn(),
  },
  useSession: vi.fn(),
}));

import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";
import { ProfileContainer } from "./ProfileContainer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();

function renderProfileContainer() {
  return render(<ProfileContainer />);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({
    push: mockPush,
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  } as ReturnType<typeof useRouter>);
  mockPush.mockReset();
  mockRefresh.mockReset();
  vi.mocked(authClient.signOut).mockReset();
  vi.mocked(useSession).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ProfileContainer — loading state
// ---------------------------------------------------------------------------

describe("ProfileContainer — loading state", () => {
  it("shows loading indicator when session is pending", () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      isPending: true,
      error: null,
    });

    renderProfileContainer();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProfileContainer — not signed in
// ---------------------------------------------------------------------------

describe("ProfileContainer — not signed in", () => {
  it("shows 'Not signed in' message when session data is null", () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    });

    renderProfileContainer();
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProfileContainer — signed in
// ---------------------------------------------------------------------------

describe("ProfileContainer — signed in", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: {
          id: "user-1",
          email: "johndoe@example.com",
          name: "johndoe",
        },
      },
      isPending: false,
      error: null,
    });
  });

  it("renders the user email", () => {
    renderProfileContainer();
    expect(screen.getByText("johndoe@example.com")).toBeInTheDocument();
  });

  it("renders the display name derived from the email local-part", () => {
    renderProfileContainer();
    expect(screen.getByText("johndoe")).toBeInTheDocument();
  });

  it("renders a Sign out button", () => {
    renderProfileContainer();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("renders the 'Display name' label", () => {
    renderProfileContainer();
    expect(screen.getByText(/display name/i)).toBeInTheDocument();
  });

  it("renders the 'Email' label", () => {
    renderProfileContainer();
    expect(screen.getByText(/^email$/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProfileContainer — sign out interaction
// ---------------------------------------------------------------------------

describe("ProfileContainer — sign out", () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "user",
        },
      },
      isPending: false,
      error: null,
    });
    vi.mocked(authClient.signOut).mockResolvedValue(undefined);
  });

  it("calls authClient.signOut when the Sign out button is clicked", async () => {
    const user = userEvent.setup();
    renderProfileContainer();

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("navigates to /login after signing out", async () => {
    const user = userEvent.setup();
    renderProfileContainer();

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login");
    });
  });

  it("calls router.refresh() after signing out", async () => {
    const user = userEvent.setup();
    renderProfileContainer();

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
