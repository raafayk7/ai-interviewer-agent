"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/primitives/card";
import { RecommendationBadge } from "@repo/ui/composites/recommendation-badge";
import { TopicScoreRow } from "@repo/ui/composites/topic-score-row";
import type { Report } from "@/types";

function BulletCard({ title, items }: { title: string; items: ReadonlyArray<string> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportViewer({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="font-heading text-lg">Recommendation</CardTitle>
          <RecommendationBadge recommendation={report.overallRecommendation} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{report.communicationAssessment}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Topic scores</CardTitle>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <BulletCard title="Strengths" items={report.strengths} />
        <BulletCard title="Concerns" items={report.concerns} />
      </div>

      <BulletCard title="Suggested follow-up questions" items={report.followUpQuestions} />
    </div>
  );
}
