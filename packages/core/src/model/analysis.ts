import { z } from "zod";
import { id } from "./meeting";

export const decisionKind = z.enum(["decision", "commitment", "assumption", "open_item"]);
export const decisionStatus = z.enum(["explicit", "ambiguous", "unresolved", "debated"]);

export const decision = z.strictObject({
  id,
  meetingId: id,
  /** Transcript order; the deterministic tie-break when ranking probes. */
  idx: z.int().nonnegative(),
  kind: decisionKind,
  statement: z.string().min(1),
  ownerText: z.string().nullable(),
  deadlineText: z.string().nullable(),
  /** True when the owner is not in any evidence quote. Inferred fields are never shown as stated. */
  ownerInferred: z.boolean(),
  deadlineInferred: z.boolean(),
  status: decisionStatus,
});
export type Decision = z.infer<typeof decision>;

/** `quote` must be an exact substring of the segment's text. Exactly one target is set. */
export const evidence = z
  .strictObject({
    id,
    decisionId: id.nullable(),
    resolutionId: id.nullable(),
    segmentId: id,
    quote: z.string().min(1),
  })
  .refine((e) => (e.decisionId === null) !== (e.resolutionId === null), {
    message: "evidence needs exactly one of decisionId or resolutionId",
  });
export type Evidence = z.infer<typeof evidence>;

export const dimension = z.enum([
  "owner",
  "deadline",
  "scope",
  "criteria",
  "dependency",
  "outcome",
]);
export type Dimension = z.infer<typeof dimension>;

const level = z.enum(["low", "medium", "high"]);

export const reading = z.strictObject({ id, text: z.string().min(1) });
export type Reading = z.infer<typeof reading>;

export const impact = z.strictObject({
  reversibility: level,
  blastRadius: level,
  timeToImpact: level,
});
export type Impact = z.infer<typeof impact>;

export const candidate = z.strictObject({
  id,
  decisionId: id,
  dimension,
  readings: z.array(reading).min(2),
  impact,
});
export type Candidate = z.infer<typeof candidate>;
