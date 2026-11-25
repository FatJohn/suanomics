CREATE TABLE "econ_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"region" text NOT NULL,
	"importance" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "econ_calendar_events_date_title_unique" UNIQUE("date","title")
);
--> statement-breakpoint
CREATE TABLE "material_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"market" text NOT NULL,
	"company_code" text NOT NULL,
	"company_name" text NOT NULL,
	"announced_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"clause" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_announcements_unique" UNIQUE("market","company_code","announced_at","title")
);
--> statement-breakpoint
CREATE INDEX "idx_econ_calendar_events_date" ON "econ_calendar_events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_material_announcements_announced_at" ON "material_announcements" USING btree ("announced_at" DESC NULLS LAST);