ALTER TABLE "interviews" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "internal_scores" jsonb DEFAULT '[]'::jsonb NOT NULL;