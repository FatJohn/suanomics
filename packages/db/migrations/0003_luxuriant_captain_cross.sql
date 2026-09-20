ALTER TABLE "analyses" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "input_url" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "entities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_analyses_input_hash" ON "analyses" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "idx_analyses_entities_gin" ON "analyses" USING gin ("entities" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_analyses_created_at" ON "analyses" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_analyses_expires_at" ON "analyses" USING btree ("expires_at");