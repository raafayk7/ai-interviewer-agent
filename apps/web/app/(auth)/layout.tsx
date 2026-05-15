import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (session) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      {children}
    </main>
  );
}
