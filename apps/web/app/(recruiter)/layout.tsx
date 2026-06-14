import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { SoftBlockScreen } from "@repo/ui/composites/soft-block-screen";

export default async function RecruiterLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <>
      <SoftBlockScreen audience="recruiter" />
      <div className="grid min-h-screen grid-cols-[240px_1fr]">
        <AppSidebar email={session.email} />
        <div className="flex min-h-screen flex-col">{children}</div>
      </div>
    </>
  );
}
