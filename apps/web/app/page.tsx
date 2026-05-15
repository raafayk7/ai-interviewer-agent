import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@repo/ui/primitives/button";
import { getServerSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await getServerSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <span aria-hidden className="size-16 rounded-pill bg-accent shadow-[0_0_28px_var(--orb-halo)]" />
        <h1 className="font-heading text-4xl font-bold tracking-tight">Sift</h1>
        <p className="max-w-md text-base text-muted-foreground">
          A composed voice interviewer that listens carefully and reports plainly.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button asChild variant="primary">
          <Link href="/signup">Create an account</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
