ALTER TABLE "answer" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "participant" ADD COLUMN "simulator_notes" text;