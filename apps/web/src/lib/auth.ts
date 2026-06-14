import { headers } from "next/headers";
import { env } from "./env";

export interface ServerSession {
  readonly userId: string;
  readonly email: string;
}

export const auth = {
  api: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getSession(_: { headers: Headers }): Promise<{ user: ServerSession } | null> {
      const inboundHeaders = await headers();
      const cookie = inboundHeaders.get("cookie") ?? "";
      // Intentional carve-out from the "fetch only in services/" rule: this file is
      // server-only (imported exclusively from layouts and Server Components via next/headers)
      // and cannot import "use client" service files. The call proxies through the Next.js
      // rewrite at /api/auth/* → NEXT_PUBLIC_API_URL/api/auth/*.
      let res: Response;
      try {
        res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/get-session`, {
          headers: { cookie },
          cache: "no-store",
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      const data: unknown = await res.json().catch(() => null);
      if (!data || typeof data !== "object") return null;
      const d = data as Record<string, unknown>;
      if (!d.user || typeof d.user !== "object") return null;
      const u = d.user as Record<string, unknown>;
      if (typeof u.id !== "string" || typeof u.email !== "string") return null;
      return { user: { userId: u.id, email: u.email } };
    },
  },
};

export async function getServerSession(): Promise<ServerSession | null> {
  const session = await auth.api.getSession({ headers: new Headers() });
  return session?.user ?? null;
}
