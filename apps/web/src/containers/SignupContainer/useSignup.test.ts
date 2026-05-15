import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
    signUp: {
      email: vi.fn(),
    },
  },
}));

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useSignup } from "./useSignup";

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
  vi.mocked(authClient.signUp.email).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useSignup — initial state
// ---------------------------------------------------------------------------

describe("useSignup — initial state", () => {
  it("starts with submitError as null", () => {
    const { result } = renderHook(() => useSignup());
    expect(result.current.submitError).toBeNull();
  });

  it("starts with isSubmitting as false", () => {
    const { result } = renderHook(() => useSignup());
    expect(result.current.isSubmitting).toBe(false);
  });

  it("exposes a form object", () => {
    const { result } = renderHook(() => useSignup());
    expect(typeof result.current.form.handleSubmit).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// useSignup — successful signup
// ---------------------------------------------------------------------------

describe("useSignup — successful signup", () => {
  it("calls router.push('/dashboard') on successful signup", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "newuser@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("calls authClient.signUp.email with name derived from email local-part", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "johnsmith@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(authClient.signUp.email).toHaveBeenCalledWith(
        expect.objectContaining({ name: "johnsmith" }),
      );
    });
  });

  it("does not set submitError on successful signup", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "newuser@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
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
// useSignup — USER_ALREADY_EXISTS error
// ---------------------------------------------------------------------------

describe("useSignup — USER_ALREADY_EXISTS error", () => {
  it("sets submitError to the duplicate email message", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      data: null,
      error: { code: "USER_ALREADY_EXISTS", message: "User already exists" },
    });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "existing@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).toBe(
        "We couldn't create your account. If you already have one, sign in instead.",
      );
    });
  });

  it("does not navigate on USER_ALREADY_EXISTS error", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      data: null,
      error: { code: "USER_ALREADY_EXISTS", message: "User already exists" },
    });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "existing@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
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
// useSignup — generic auth error
// ---------------------------------------------------------------------------

describe("useSignup — generic auth error", () => {
  it("sets submitError to the generic message for unknown error codes", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Internal error" },
    });

    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submitError).toBe(
        "Something went wrong. Try again in a moment.",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useSignup — form validation
// ---------------------------------------------------------------------------

describe("useSignup — form validation", () => {
  it("does not call authClient.signUp.email when email is empty", async () => {
    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "securepass1");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("does not call authClient.signUp.email when passwords do not match", async () => {
    const { result } = renderHook(() => useSignup());

    act(() => {
      result.current.form.setValue("email", "user@example.com");
      result.current.form.setValue("password", "securepass1");
      result.current.form.setValue("confirmPassword", "differentpass");
    });

    await act(async () => {
      await result.current.onSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });

    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });
});
