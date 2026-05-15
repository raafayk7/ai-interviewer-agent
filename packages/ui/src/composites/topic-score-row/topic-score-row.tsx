export interface TopicScoreRowProps {
  topicName: string;
  score: number;
  justification: string;
}

export function TopicScoreRow({ topicName, score, justification }: TopicScoreRowProps) {
  const pct = Math.round((score / 5) * 100);
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-sm font-semibold">{topicName}</span>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{score.toFixed(1)} / 5</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-muted">
        <div className="h-full bg-primary transition-[width] duration-[220ms] ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">{justification}</p>
    </div>
  );
}
