import { PageHeader } from "@/components/PageHeader";
import { InterviewDetailContainer } from "@/containers/InterviewDetailContainer";

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Interview" />
      <main className="flex-1 px-8 py-6">
        <InterviewDetailContainer interviewId={id} />
      </main>
    </>
  );
}
