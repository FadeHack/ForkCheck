import { z } from "zod";

export const id = z.string().min(1);
/** ISO 8601 instant with an offset, e.g. `2026-10-27T15:00:00Z`. */
export const instant = z.iso.datetime({ offset: true });
/** IANA zone name, e.g. `America/New_York`. */
export const timezone = z.string().min(1);

export const meetingStatus = z.enum([
  "draft",
  "transcribing",
  "review",
  "analyzing",
  "probing",
  "revealed",
  "resolving",
  "recorded",
  "failed",
]);
export type MeetingStatus = z.infer<typeof meetingStatus>;

// Token hashes stay in the db package; the domain model never carries them.
export const meeting = z.strictObject({
  id,
  title: z.string().min(1),
  source: z.enum(["paste", "audio"]),
  status: meetingStatus,
  heldAt: instant,
  timezone,
  transcriptVersion: z.int().nonnegative(),
  error: z.string().nullable(),
  createdAt: instant,
  deleteAfter: instant.nullable(),
  /** Participant names are swapped for placeholders in every model request. */
  pseudonymizeNames: z.boolean(),
});
export type Meeting = z.infer<typeof meeting>;

export const participant = z.strictObject({
  id,
  meetingId: id,
  displayName: z.string().min(1),
  isSimulated: z.boolean(),
  /** `active` means not marked absent by the organizer. */
  status: z.enum(["active", "absent"]),
});
export type Participant = z.infer<typeof participant>;

export const segment = z.strictObject({
  id,
  meetingId: id,
  idx: z.int().nonnegative(),
  /** ASR speaker label (`A`, `B`, ...); null for pasted transcripts. */
  speakerLabel: z.string().nullable(),
  participantId: id.nullable(),
  startMs: z.int().nonnegative().nullable(),
  endMs: z.int().nonnegative().nullable(),
  text: z.string(),
  origin: z.enum(["paste", "asr"]),
  edited: z.boolean(),
});
export type Segment = z.infer<typeof segment>;

export const round = z.strictObject({
  id,
  meetingId: id,
  kind: z.enum(["diagnostic", "recheck"]),
  openedAt: instant,
  closedAt: instant.nullable(),
  closeReason: z.enum(["all_answered", "organizer_quorum"]).nullable(),
});
export type Round = z.infer<typeof round>;
