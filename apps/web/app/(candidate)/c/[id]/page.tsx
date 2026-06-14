import { loadCandidateView, viewLoadToErrorKind } from "@/lib/candidate-fetch";
import { CandidateErrorScreen } from "@/components/CandidateErrorScreen";
import { CandidateLandingContainer } from "@/containers/CandidateLandingContainer";

export default async function CandidateLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const load = await loadCandidateView(id, token);
  if (load.kind !== "ok") {
    return <CandidateErrorScreen kind={viewLoadToErrorKind(load)} />;
  }
  return <CandidateLandingContainer view={load.view} token={token!} />;
}
