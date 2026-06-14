"use client";

import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

export interface ProfileUser {
  email: string;
  displayName: string;
}

export interface ProfileViewModel {
  isPending: boolean;
  user: ProfileUser | null;
  onSignOut: () => Promise<void>;
}

export function useProfile(): ProfileViewModel {
  const router = useRouter();
  const { data, isPending } = useSession();

  const user = data?.user
    ? { email: data.user.email, displayName: data.user.email.split("@")[0]! }
    : null;

  async function onSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return { isPending, user, onSignOut };
}
