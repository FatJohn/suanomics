ALTER TABLE "news_items" ADD COLUMN "topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "tagged_at" timestamp with time zone;