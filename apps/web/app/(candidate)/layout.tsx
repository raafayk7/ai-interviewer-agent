import type { ReactNode } from "react";
import { SoftBlockScreen } from "@repo/ui/composites/soft-block-screen";

// Server Component. Next 16's `LayoutProps` does not pass `searchParams` to
// layouts (only to pages), so token verification cannot happen here —
// instead, each candidate page calls `loadCandidateView` server-side and
// renders `<CandidateErrorScreen kind="invalid-link" />` on a failed lookup.
// This layout's only job is the desktop soft-block.
export default function CandidateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SoftBlockScreen audience="candidate" />
      {children}
    </>
  );
}
