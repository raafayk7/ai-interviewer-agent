"use client";

import { useState } from "react";
import { Button } from "@repo/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/primitives/card";

interface Props {
  url: string;
  expiresInSeconds: number;
  onReissue?: () => void;
  isReissuing?: boolean;
}

export function ShareLinkPanel({ url, expiresInSeconds, onReissue, isReissuing }: Props) {
  const [copied, setCopied] = useState(false);
  const days = Math.round(expiresInSeconds / 86400);

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Candidate link</CardTitle>
        <CardDescription>
          Share this link with the candidate. Expires in {days} day{days !== 1 ? "s" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <code className="break-all rounded-sm border border-border bg-input px-3 py-2 font-mono text-xs text-foreground">
          {url}
        </code>
        <div className="flex gap-2">
          <Button onClick={handleCopy} variant="secondary" size="sm">
            {copied ? "Copied" : "Copy link"}
          </Button>
          {onReissue && (
            <Button onClick={onReissue} variant="ghost" size="sm" disabled={isReissuing}>
              {isReissuing ? "Reissuing…" : "Re-issue link"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
