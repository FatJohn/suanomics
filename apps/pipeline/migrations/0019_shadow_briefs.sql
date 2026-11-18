CREATE TABLE "shadow_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_date" date NOT NULL,
	"variant" text NOT NULL,
	"selected_news_ids" integer[] NOT NULL,
	"brief_json" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shadow_briefs_date_variant" UNIQUE("brief_date","variant")
);
--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD COLUMN "run_inputs" jsonb;