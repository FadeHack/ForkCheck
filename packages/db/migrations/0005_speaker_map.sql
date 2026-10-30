CREATE TABLE "speaker_map" (
	"meeting_id" text NOT NULL,
	"label" text NOT NULL,
	"participant_id" text,
	CONSTRAINT "speaker_map_meeting_id_label_pk" PRIMARY KEY("meeting_id","label")
);
--> statement-breakpoint
ALTER TABLE "speaker_map" ADD CONSTRAINT "speaker_map_meeting_id_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_map" ADD CONSTRAINT "speaker_map_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE set null ON UPDATE no action;