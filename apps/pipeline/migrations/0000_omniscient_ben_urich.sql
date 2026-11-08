CREATE TABLE "analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer,
	"schema_version" text DEFAULT 'v1' NOT NULL,
	"payload" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_date" date NOT NULL,
	"selected_news_ids" integer[] NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_briefs_brief_date_unique" UNIQUE("brief_date")
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_text" text,
	"content_source" text NOT NULL,
	CONSTRAINT "news_items_source_id_external_id_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"rss_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_source_id_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."news_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analyses_news_item" ON "analyses" USING btree ("news_item_id");--> statement-breakpoint
CREATE INDEX "idx_news_items_published" ON "news_items" USING btree ("published_at");