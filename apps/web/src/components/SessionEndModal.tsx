"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/primitives/dialog";

export type SessionEndVariant = "completed" | "blocked";

const COPY: Record<SessionEndVariant, { title: string; description: string }> = {
  completed: {
    title: "Interview complete",
    description:
      "Thank you — your interview has finished. You can close this tab; there is nothing more to do.",
  },
  blocked: {
    title: "This interview is no longer available",
    description:
      "This interview is already in progress in another session, or has already finished. You can close this tab.",
  },
};

export function SessionEndModal({ variant }: { variant: SessionEndVariant }) {
  const copy = COPY[variant];

  return (
    <Dialog open>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
