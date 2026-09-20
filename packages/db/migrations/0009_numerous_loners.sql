CREATE TABLE "market_data_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_data_points_series_date_unique" UNIQUE("series_id","date")
);
--> statement-breakpoint
ALTER TABLE "background_jobs" DROP CONSTRAINT "background_jobs_kind_check";--> statement-breakpoint
CREATE INDEX "idx_market_data_series_date" ON "market_data_points" USING btree ("series_id","date" DESC NULLS LAST);--> statement-breakpoint
DELETE FROM "background_jobs" WHERE "job_kind" = 'curate';--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_kind_check" CHECK ("background_jobs"."job_kind" IN ('corpus-refresh', 'analyze', 'daily-brief', 'podcast-generate', 'podcast-tts', 'news-refresh', 'prompt-refresh', 'market-data-refresh'));