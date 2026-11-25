CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_kind" text NOT NULL,
	"queue_name" text NOT NULL,
	"bullmq_job_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload_hash" text NOT NULL,
	"result_ref" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "background_jobs_kind_check" CHECK ("background_jobs"."job_kind" IN ('corpus-refresh', 'analyze', 'daily-brief')),
	CONSTRAINT "background_jobs_status_check" CHECK ("background_jobs"."status" IN ('queued', 'active', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "external_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_excerpt" text,
	"full_text" text,
	"content_hash" text,
	"content_summary" text,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_model" text,
	"llm_cost_usd" numeric(10, 6),
	CONSTRAINT "external_articles_source_url_unique" UNIQUE("source_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"tier" smallint NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_sources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "external_sources_kind_check" CHECK ("external_sources"."kind" IN ('rss', 'html-selector', 'official-feed')),
	CONSTRAINT "external_sources_tier_check" CHECK ("external_sources"."tier" IN (1, 2))
);
--> statement-breakpoint
ALTER TABLE "external_articles" ADD CONSTRAINT "external_articles_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_background_jobs_payload_hash" ON "background_jobs" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "idx_background_jobs_status_created" ON "background_jobs" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_background_jobs_kind_created" ON "background_jobs" USING btree ("job_kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_external_articles_url_hash" ON "external_articles" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "idx_external_articles_content_hash" ON "external_articles" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_external_articles_fetched_at" ON "external_articles" USING btree ("fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_external_articles_entities_gin ON external_articles USING gin (entities jsonb_path_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_external_articles_topic_tags_gin ON external_articles USING gin (topic_tags);