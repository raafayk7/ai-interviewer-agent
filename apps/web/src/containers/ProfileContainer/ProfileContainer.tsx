"use client";

import { Button } from "@repo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/primitives/card";
import { useProfile } from "./useProfile";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

export function ProfileContainer() {
  const { isPending, user, onSignOut } = useProfile();

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!user) return <p className="text-sm text-muted-foreground">Not signed in.</p>;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg italic">Account</CardTitle>
          <CardDescription>Your sign-in details.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Field label="Display name" value={user.displayName} />
          <Field label="Email" value={user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg italic">Session</CardTitle>
          <CardDescription>Sign out of this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={onSignOut}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
