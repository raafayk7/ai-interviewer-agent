"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "bg-card text-card-foreground border-border rounded-md",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
