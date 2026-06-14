import type { ReactNode } from "react";

export function EmptyDashboardState({ action }: { action: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-card p-8 text-center">
      <h2 className="font-heading">No interviews yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Create an interview to share a private link with your candidate. They join from a desktop;
        you&apos;ll see results here when the conversation wraps.
      </p>
      {action}
    </div>
  );
}
