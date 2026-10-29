ALTER TABLE "meeting" ADD COLUMN "step_run_id" text;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "step_heartbeat_at" timestamp with time zone;