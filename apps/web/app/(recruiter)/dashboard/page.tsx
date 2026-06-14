import Link from "next/link";
import { Button } from "@repo/ui/primitives/button";
import { PageHeader } from "@/components/PageHeader";
import { InterviewListContainer } from "@/containers/InterviewListContainer";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Interviews"
        description="Every screening you've launched, every report waiting on your read."
        actions={
          <Button asChild variant="primary">
            <Link href="/interviews/new">+ New interview</Link>
          </Button>
        }
      />
      <main className="flex-1 px-8 py-6">
        <InterviewListContainer />
      </main>
    </>
  );
}
