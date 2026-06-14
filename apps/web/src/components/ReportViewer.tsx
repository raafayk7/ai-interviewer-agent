"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/primitives/card";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import { TopicScoreRow } from "@repo/ui/composites/topic-score-row";
import type { Report } from "@/types";

function NumberedList({ items }: { items: ReadonlyArray<string> }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((x, i) => (
        <li key={i} className="grid grid-cols-[32px_1fr] items-baseline gap-3 text-sm leading-relaxed">
          <span className="font-mono text-xs tabular-nums tracking-wide text-muted-foreground">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

function ago(d: Date) {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ReportViewer({ report }: { report: Report }) {
  const avg =
    report.topicScores.reduce((s, t) => s + t.score, 0) /
    Math.max(report.topicScores.length, 1);

  return (
    <div className="flex flex-col gap-7">
      {/* Hero — the verdict owns the page */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-8">
          <div className="flex flex-wrap items-center gap-4">
            <RecommendationBadge recommendation={report.overallRecommendation} size="lg" />
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {avg.toFixed(1)} / 5 average · {report.topicScores.length} topics
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Generated {ago(report.generatedAt)}
            </span>
          </div>
          <p className="font-heading text-2xl leading-snug max-w-[64ch]">
            {report.communicationAssessment}
          </p>
        </CardContent>
      </Card>

      {/* Topic scores */}
      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between">
          <CardTitle className="font-heading text-xl italic">Topic scores</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">Avg · {avg.toFixed(1)}</span>
        </CardHeader>
        <CardContent>
          {report.topicScores.map((t) => (
            <TopicScoreRow
              key={t.topicName}
              topicName={t.topicName}
              score={t.score}
              justification={t.justification}
            />
          ))}
        </CardContent>
      </Card>

      {/* Strengths / concerns */}
      <div className="grid gap-7 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl italic">Strengths</CardTitle>
          </CardHeader>
          <CardContent>
            <NumberedList items={report.strengths} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl italic">Concerns</CardTitle>
          </CardHeader>
          <CardContent>
            <NumberedList items={report.concerns} />
          </CardContent>
        </Card>
      </div>

      {/* Follow-ups */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-xl italic">Suggested follow-up questions</CardTitle>
        </CardHeader>
        <CardContent>
          <NumberedList items={report.followUpQuestions} />
        </CardContent>
      </Card>
    </div>
  );
}
