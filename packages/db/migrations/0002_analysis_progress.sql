CREATE TYPE "public"."analysis_step" AS ENUM('extract', 'candidates', 'probes');--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "analysis_version" integer;--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "analysis_step" "analysis_step";--> statement-breakpoint
ALTER TABLE "meeting" ADD COLUMN "failed_step" "analysis_step";--> statement-breakpoint
ALTER TABLE "probe" ADD COLUMN "rank" integer;