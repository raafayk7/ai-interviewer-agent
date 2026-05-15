"use client";

import { cn } from "@repo/ui/lib/cn";

interface SoftBlockScreenProps {
  audience: "recruiter" | "candidate";
  className?: string;
}

const COPY: Record<
  SoftBlockScreenProps["audience"],
  { heading: string; body: string; why: string }
> = {
  recruiter: {
    heading: "Sift's recruiter workspace is desktop-only.",
    body: "Open this link from a laptop or desktop to manage interviews.",
    why: "Why? The dashboard is a wide table — squashing it into a phone viewport makes it unusable rather than degraded.",
  },
  candidate: {
    heading: "Sift works best on a laptop or desktop.",
    body: "Open this link from a computer to begin your interview. We'll keep your scheduled session ready — nothing expires when you switch devices.",
    why: "Why? The interview is a live voice conversation, and laptops give the most reliable mic and connection. Phones can drop the call when you switch apps or the screen locks.",
  },
};

export function SoftBlockScreen({ audience, className }: SoftBlockScreenProps) {
  const copy = COPY[audience];
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-6 bg-background px-6 text-center",
        "max-[767px]:flex",
        className,
      )}
      role="alert"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="size-10 rounded-pill bg-accent opacity-70 shadow-[0_0_20px_var(--orb-halo)]"
      />
      <h2 className="font-heading text-2xl">{copy.heading}</h2>
      <p className="max-w-md text-base text-muted-foreground">{copy.body}</p>
      <p className="max-w-md text-sm text-muted-foreground">{copy.why}</p>
    </div>
  );
}
