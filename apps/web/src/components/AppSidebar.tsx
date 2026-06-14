"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@repo/ui/primitives/avatar";
import { Button } from "@repo/ui/primitives/button";
import { authClient } from "@/lib/auth-client";

const NAV = [
  { href: "/dashboard", label: "Interviews" },
  { href: "/profile", label: "Profile" },
];

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = email.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 flex-col gap-6 border-r border-border bg-background p-5">
      <div className="group flex cursor-pointer items-center gap-2.5 px-2 py-1">
        <span
          aria-hidden
          className="size-6 rounded-pill bg-accent shadow-[0_0_14px_var(--orb-halo)] transition-shadow duration-200 ease-out group-hover:shadow-[0_0_24px_var(--orb-halo)]"
        />
        <span className="font-heading text-base italic tracking-tight">Sift</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-sm px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar className="size-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm">{email.split("@")[0]}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="w-full justify-start">
          Sign out
        </Button>
      </div>
    </aside>
  );
}
