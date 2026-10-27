import { z } from "zod";
import { id, instant } from "./meeting";

/** "Not sure" is not an option: it is an answer choice of its own. */
export const probeOption = z.strictObject({ id, text: z.string().min(1) });
export type ProbeOption = z.infer<typeof probeOption>;

export const lintFinding = z.strictObject({ rule: z.string().min(1), detail: z.string() });
export type LintFinding = z.infer<typeof lintFinding>;

/** template = T0, assisted = T1, free = T2 (R§6.2). */
export const probeTier = z.enum(["template", "assisted", "free"]);
export type ProbeTier = z.infer<typeof probeTier>;

// Option count and length rules are lint findings, not schema errors, so a bad probe can be reported.
export const probe = z.strictObject({
  id,
  meetingId: id,
  kind: z.enum(["diagnostic", "recheck"]),
  /** Set for diagnostic probes. */
  candidateId: id.nullable(),
  /** Set for recheck probes: the split whose resolution is being rechecked. */
  splitId: id.nullable(),
  tier: probeTier,
  stem: z.string().min(1),
  options: z.array(probeOption),
  lint: z.array(lintFinding),
  promptVersion: z.string().min(1),
  status: z.enum(["draft", "published", "withdrawn"]),
});
export type Probe = z.infer<typeof probe>;

export const answerChoice = z.enum(["option", "unsure", "write_in"]);
export type AnswerChoice = z.infer<typeof answerChoice>;

/** Unique per (probeId, participantId). */
export const answer = z
  .strictObject({
    id,
    probeId: id,
    participantId: id,
    choice: answerChoice,
    optionId: id.nullable(),
    writeInText: z.string().nullable(),
    mappedOptionId: id.nullable(),
    mappedByModel: z.boolean(),
  })
  .superRefine((a, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if ((a.choice === "option") !== (a.optionId !== null)) {
      fail("optionId is set exactly when choice is option");
    }
    if ((a.choice === "write_in") !== (a.writeInText !== null)) {
      fail("writeInText is set exactly when choice is write_in");
    }
    if (a.mappedOptionId !== null && a.choice !== "write_in") {
      fail("only write-ins can be mapped");
    }
    if (a.mappedByModel && a.mappedOptionId === null) fail("mappedByModel needs mappedOptionId");
  });
export type Answer = z.infer<typeof answer>;

export const validityLabel = z.enum([
  "valid",
  "already_discussed",
  "options_dont_differ",
  "redundant",
  "doesnt_matter",
]);
export type ValidityLabel = z.infer<typeof validityLabel>;

export const splitStatus = z.enum([
  "open",
  "resolving",
  "confirmed",
  "rechecked",
  "reopened",
  "unresolved",
]);
export type SplitStatus = z.infer<typeof splitStatus>;

export const split = z.strictObject({
  id,
  probeId: id,
  outcome: z.enum(["split", "consistent", "insufficient"]),
  validity: z.array(z.strictObject({ participantId: id, label: validityLabel })),
  status: splitStatus,
});
export type Split = z.infer<typeof split>;

export const resolution = z.strictObject({
  id,
  splitId: id,
  text: z.string().min(1),
  proposedBy: id,
  draftedByModel: z.boolean(),
  status: z.enum(["proposed", "confirmed", "superseded"]),
});
export type Resolution = z.infer<typeof resolution>;

export const confirmation = z.strictObject({
  resolutionId: id,
  participantId: id,
  at: instant,
});
export type Confirmation = z.infer<typeof confirmation>;
