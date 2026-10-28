CREATE TYPE "public"."answer_choice" AS ENUM('option', 'unsure', 'write_in');--> statement-breakpoint
CREATE TYPE "public"."close_reason" AS ENUM('all_answered', 'organizer_quorum');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('decision', 'commitment', 'assumption', 'open_item');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('explicit', 'ambiguous', 'unresolved', 'debated');--> statement-breakpoint
CREATE TYPE "public"."dimension" AS ENUM('owner', 'deadline', 'scope', 'criteria', 'dependency', 'outcome');--> statement-breakpoint
CREATE TYPE "public"."meeting_source" AS ENUM('paste', 'audio');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('draft', 'transcribing', 'review', 'analyzing', 'probing', 'revealed', 'resolving', 'recorded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('active', 'absent');--> statement-breakpoint
CREATE TYPE "public"."probe_status" AS ENUM('draft', 'published', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."probe_tier" AS ENUM('template', 'assisted', 'free');--> statement-breakpoint
CREATE TYPE "public"."recheck_result" AS ENUM('passed', 'failed', 'not_conclusive', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."record_category" AS ENUM('stated', 'confirmed', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('proposed', 'confirmed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."round_kind" AS ENUM('diagnostic', 'recheck');--> statement-breakpoint
CREATE TYPE "public"."segment_origin" AS ENUM('paste', 'asr');--> statement-breakpoint
CREATE TYPE "public"."split_outcome" AS ENUM('split', 'consistent', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."split_status" AS ENUM('open', 'resolving', 'confirmed', 'rechecked', 'reopened', 'unresolved');--> statement-breakpoint
CREATE TABLE "answer" (
	"id" text PRIMARY KEY NOT NULL,
	"probe_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"choice" "answer_choice" NOT NULL,
	"option_id" text,
	"write_in_text" text,
	"mapped_option_id" text,
	"mapped_by_model" boolean DEFAULT false NOT NULL,
	CONSTRAINT "answer_probe_participant_unique" UNIQUE("probe_id","participant_id"),
	CONSTRAINT "answer_choice_fields" CHECK (("answer"."choice" = 'option') = ("answer"."option_id" is not null) and ("answer"."choice" = 'write_in') = ("answer"."write_in_text" is not null))
);
--> statement-breakpoint
CREATE TABLE "audio_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"duration_ms" integer,
	"retain" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"dimension" "dimension" NOT NULL,
	"readings" jsonb NOT NULL,
	"impact" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation" (
	"resolution_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "confirmation_resolution_id_participant_id_pk" PRIMARY KEY("resolution_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" "decision_kind" NOT NULL,
	"statement" text NOT NULL,
	"owner_text" text,
	"deadline_text" text,
	"owner_inferred" boolean NOT NULL,
	"deadline_inferred" boolean NOT NULL,
	"status" "decision_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text,
	"resolution_id" text,
	"segment_id" text NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "evidence_one_target" CHECK (("evidence"."decision_id" is null) <> ("evidence"."resolution_id" is null))
);
--> statement-breakpoint
CREATE TABLE "meeting" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" "meeting_source" NOT NULL,
	"status" "meeting_status" NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"organizer_token_hash" text NOT NULL,
	"transcript_version" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"delete_after" timestamp with time zone,
	CONSTRAINT "meeting_organizer_token_hash_unique" UNIQUE("organizer_token_hash")
);
--> statement-breakpoint
CREATE TABLE "model_call" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text,
	"eval_run_id" text,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"cache_hit" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"reasoning_tokens" integer,
	"cost_usd" double precision NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"status" "participant_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "participant_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "probe" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"kind" "round_kind" NOT NULL,
	"candidate_id" text,
	"split_id" text,
	"round_id" text,
	"tier" "probe_tier" NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"lint" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "probe_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_item" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"idx" integer NOT NULL,
	"category" "record_category" NOT NULL,
	"text" text NOT NULL,
	"source_refs" jsonb NOT NULL,
	"confirmed_by" jsonb NOT NULL,
	"absent" jsonb NOT NULL,
	"recheck" "recheck_result" NOT NULL,
	"split_id" text,
	"deadline" jsonb
);
--> statement-breakpoint
CREATE TABLE "resolution" (
	"id" text PRIMARY KEY NOT NULL,
	"split_id" text NOT NULL,
	"text" text NOT NULL,
	"proposed_by" text NOT NULL,
	"drafted_by_model" boolean DEFAULT false NOT NULL,
	"status" "resolution_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"kind" "round_kind" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" "close_reason"
);
--> statement-breakpoint
CREATE TABLE "segment" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"idx" integer NOT NULL,
	"speaker_label" text,
	"participant_id" text,
	"start_ms" integer,
	"end_ms" integer,
	"text" text NOT NULL,
	"origin" "segment_origin" NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "segment_meeting_idx_unique" UNIQUE("meeting_id","idx")
);
--> statement-breakpoint
CREATE TABLE "segment_edit" (
	"id" text PRIMARY KEY NOT NULL,
	"segment_id" text NOT NULL,
	"field" text NOT NULL,
	"before" text,
	"after" text,
	"edited_by" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "split" (
	"id" text PRIMARY KEY NOT NULL,
	"probe_id" text NOT NULL,
	"outcome" "split_outcome" NOT NULL,
	"validity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "split_status" NOT NULL,
	CONSTRAINT "split_probe_id_unique" UNIQUE("probe_id")
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_probe_id_probe_id_fk" FOREIGN KEY ("probe_id") REFERENCES "public"."probe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_asset" ADD CONSTRAINT "audio_asset_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_decision_id_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation" ADD CONSTRAINT "confirmation_resolution_id_resolution_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."resolution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation" ADD CONSTRAINT "confirmation_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_decision_id_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_resolution_id_resolution_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."resolution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_segment_id_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_call" ADD CONSTRAINT "model_call_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe" ADD CONSTRAINT "probe_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe" ADD CONSTRAINT "probe_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe" ADD CONSTRAINT "probe_split_id_split_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."split"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe" ADD CONSTRAINT "probe_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_item" ADD CONSTRAINT "record_item_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_item" ADD CONSTRAINT "record_item_split_id_split_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."split"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_split_id_split_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."split"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution" ADD CONSTRAINT "resolution_proposed_by_participant_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round" ADD CONSTRAINT "round_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_edit" ADD CONSTRAINT "segment_edit_segment_id_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "split" ADD CONSTRAINT "split_probe_id_probe_id_fk" FOREIGN KEY ("probe_id") REFERENCES "public"."probe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_meeting_idx" ON "decision" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "model_call_meeting_idx" ON "model_call" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "participant_meeting_idx" ON "participant" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "probe_meeting_idx" ON "probe" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "probe_round_idx" ON "probe" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "round_meeting_idx" ON "round" USING btree ("meeting_id");