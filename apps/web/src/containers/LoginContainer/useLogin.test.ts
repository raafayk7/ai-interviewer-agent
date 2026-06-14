import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Environment setup — mock @/lib/env before anything else imports it
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_API_URL: "http://localhost:8080" },
}));

// ---------------------------------------------------------------------------
// Module mocks — must be before dynamic imports
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
    },
  },
}));

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useLogin } from "./useLogin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();

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
  vi.mocked(authClient.signIn.email).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useLogin — initial state
// ---------------------------------------------------------------------------

describe("useLogin — initial state", () => {
  it("starts with submitError as null", () => {
    const { result } = renderHook(() => useLogin());
    expect(result.current.submitError).toBeNull();
  });

  it("starts with isSubmitting as false", () => {
    const { result } = renderHook(() => useLogin());
    expect(result.current.isSubmitting).toBe(false);
  });

  it("exposes a form object with handleSubmit", () => {
    const { result } = renderHook(() => useLogin());
    expect(typeof result.current.form.handleSubmit).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// useLogin — successful sign-in
// ---------------------------------------------------------------------------

describe("useLogin — successful sign-in", () => {
  it("calls router.push('/dashboard') on successful sign-in", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "password123");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("calls router.refresh() after successful sign-in", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "password123");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("does not set submitError on successful sign-in", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "password123");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// useLogin — invalid credentials error
// ---------------------------------------------------------------------------

describe("useLogin — INVALID_EMAIL_OR_PASSWORD error", () => {
  it("sets submitError to the incorrect credentials message", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Bad credentials" },
    });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "wrongpass");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).toBe("Email or password is incorrect.");
    });
  });

  it("does not navigate on INVALID_EMAIL_OR_PASSWORD error", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Bad credentials" },
    });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "wrongpass");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).not.toBeNull();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useLogin — generic auth error
// ---------------------------------------------------------------------------

describe("useLogin — generic auth error", () => {
  it("sets submitError to the generic message for unknown error codes", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { code: "SOME_OTHER_ERROR", message: "Something failed" },
    });

    const { result } = renderHook(() => useLogin());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "password123");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).toBe("Something went wrong. Try again in a moment.");
    });
  });
});

// ---------------------------------------------------------------------------
// useLogin — form validation (RHF zodResolver)
// ---------------------------------------------------------------------------

describe("useLogin — form validation", () => {
  it("does not call authClient.signIn.email when email is empty", async () => {
    const { result } = renderHook(() => useLogin());

    // Leave email empty, only set password
    act(() => {
      result.current.form.setValue("password", "password123");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    expect(authClient.signIn.email).not.toHaveBeenCalled();
  });
});
