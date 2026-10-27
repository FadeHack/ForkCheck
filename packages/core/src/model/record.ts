import { z } from "zod";
import { id, instant, participant } from "./meeting";

export const sourceRef = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("segment"),
    segmentId: id,
    quote: z.string().min(1),
    /** `asr` quotes carry a badge: the wording comes from transcription. */
    origin: z.enum(["paste", "asr"]),
  }),
  z.strictObject({ kind: z.literal("confirmation"), resolutionId: id }),
]);
export type SourceRef = z.infer<typeof sourceRef>;

export const recordDeadline = z.strictObject({
  text: z.string().min(1),
  /** Concrete calendar date, `YYYY-MM-DD`. */
  date: z.iso.date().nullable(),
  firmness: z.enum(["firm", "target"]).nullable(),
});
export type RecordDeadline = z.infer<typeof recordDeadline>;

export const recordItem = z.strictObject({
  id,
  meetingId: id,
  category: z.enum(["stated", "confirmed", "unresolved"]),
  text: z.string().min(1),
  sourceRefs: z.array(sourceRef),
  confirmedBy: z.array(id),
  absent: z.array(id),
  /** `not_run` for items that never reached a recheck. */
  recheck: z.enum(["passed", "failed", "not_conclusive", "not_run"]),
  splitId: id.nullable(),
  deadline: recordDeadline.nullable(),
});
export type RecordItem = z.infer<typeof recordItem>;

export const decisionRecord = z.strictObject({
  meetingId: id,
  title: z.string().min(1),
  heldAt: instant,
  generatedAt: instant,
  participants: z.array(participant),
  items: z.array(recordItem),
  /** Model-written summary, shown as a draft; null until requested. */
  proseDraft: z.string().nullable(),
});
export type DecisionRecord = z.infer<typeof decisionRecord>;

export const recordValidation = z.strictObject({
  ok: z.boolean(),
  findings: z.array(
    z.strictObject({ rule: z.string().min(1), itemId: id.nullable(), detail: z.string() }),
  ),
});
export type RecordValidation = z.infer<typeof recordValidation>;
