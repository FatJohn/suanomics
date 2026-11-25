CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"report_date" date NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"agent" text NOT NULL,
	"news_id" text,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"attempts" smallint NOT NULL,
	"status" text NOT NULL,
	"cost_usd" numeric(14, 10),
	"price_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_status_check" CHECK ("llm_calls"."status" IN ('ok', 'invalid_output', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "idx_llm_calls_created_at" ON "llm_calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_llm_calls_run_id" ON "llm_calls" USING btree ("run_id");