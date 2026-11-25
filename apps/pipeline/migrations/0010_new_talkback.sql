CREATE TABLE "storylines" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"thesis" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_touched_brief_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storylines_status_check" CHECK ("storylines"."status" IN ('open', 'confirmed', 'refuted', 'dormant'))
);
--> statement-breakpoint
CREATE INDEX "idx_storylines_status" ON "storylines" USING btree ("status");