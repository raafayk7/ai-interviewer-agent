import type { ReactNode } from "react";
import { cn } from "@repo/ui/lib/cn";

export function CandidatePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12",
        className,
      )}
    >
      <div className="w-full max-w-[720px]">{children}</div>
    </main>
  );
}
