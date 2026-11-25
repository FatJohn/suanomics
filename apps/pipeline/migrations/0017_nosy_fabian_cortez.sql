CREATE TABLE "source_fetch_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"slug" text NOT NULL,
	"failed" boolean NOT NULL,
	"http_status" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_fetch_results_date_slug_unique" UNIQUE("run_date","slug")
);
--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD COLUMN "status" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD COLUMN "progress" jsonb;--> statement-breakpoint
CREATE INDEX "idx_source_fetch_results_run_date" ON "source_fetch_results" USING btree ("run_date" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_status_check" CHECK ("daily_briefs"."status" IN ('complete', 'incomplete'));