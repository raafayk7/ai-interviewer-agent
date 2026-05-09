CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recruiter_id" text NOT NULL,
	"status" text NOT NULL,
	"job_description" jsonb NOT NULL,
	"candidate_info" jsonb NOT NULL,
	"client_instructions" text NOT NULL,
	"interview_plan" jsonb,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jd_file_ref" jsonb NOT NULL,
	"cv_file_ref" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"report_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"interview_id" uuid NOT NULL,
	"overall_recommendation" text NOT NULL,
	"topic_scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"communication_assessment" text NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_up_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;