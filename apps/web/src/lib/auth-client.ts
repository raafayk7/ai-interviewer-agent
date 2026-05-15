/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Wrapper around better-auth/react that works around TS2742 ("inferred type
 * cannot be named") caused by pnpm symlinking @better-auth/core through a
 * hashed internal path.  We cast to `any` at the module boundary; callers
 * still get useful structural inference because TypeScript looks at the
 * runtime value, not the declared export type.
 */
import { createAuthClient } from "better-auth/react";

const _raw: any = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? "http://localhost:3002"
      : window.location.origin,
});

export const authClient: {
  signIn: {
    email: (opts: { email: string; password: string }) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  signUp: {
    email: (opts: { email: string; password: string; name: string }) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  signOut: () => Promise<unknown>;
  useSession: () => {
    data: { user: { id: string; email: string; name: string } } | null;
    isPending: boolean;
    error: unknown;
  };
} = _raw;

export const { useSession, signIn, signUp, signOut } = authClient;
