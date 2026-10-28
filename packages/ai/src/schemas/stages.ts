import { z } from "zod";
import { decisionKind, decisionStatus, dimension } from "@forkcheck/core";
import type { StageName } from "../port";
import { toStrictJsonSchema, type JsonSchema } from "./strict";

// What the model returns, before code assigns IDs and verifies quotes. No length or count
// constraints: strict decoding may not support them, so the engine and lint check those instead.
// Every optional value is nullable, never an optional key.

const text = z.string();
const level = z.enum(["low", "medium", "high"]);
const optionDraft = z.strictObject({ text });

export const extractOutput = z.strictObject({
  decisions: z.array(
    z.strictObject({
      kind: decisionKind,
      statement: text,
      ownerText: text.nullable(),
      deadlineText: text.nullable(),
      status: decisionStatus,
      evidence: z.array(z.strictObject({ segmentId: text, quote: text })),
    }),
  ),
});

export const candidatesOutput = z.strictObject({
  candidates: z.array(
    z.strictObject({
      decisionId: text,
      dimension,
      readings: z.array(z.strictObject({ text })),
      impact: z.strictObject({ reversibility: level, blastRadius: level, timeToImpact: level }),
    }),
  ),
});

/** "Not sure" is appended by code, never by the model. */
export const probesOutput = z.strictObject({
  probes: z.array(z.strictObject({ stem: text, options: z.array(optionDraft) })),
});

/** Tier T1: the stem is fixed in code, so the model returns only the options. */
export const assistedOptionsOutput = z.strictObject({ options: z.array(optionDraft) });

export const critiqueOutput = z.strictObject({
  /** Could two participants holding different readings pick different options? */
  canDiverge: z.boolean(),
  /** Index of an option that looks like the "right" answer, or null. */
  leadingOption: z.number().nullable(),
  reason: text,
});

export const writeInOutput = z.strictObject({
  /** One of the probe's option IDs, or null when the write-in fits none. */
  optionId: text.nullable(),
  reason: text,
});

export const resolutionDraftOutput = z.strictObject({ text });

export const recheckOutput = z.strictObject({
  consequence: text,
  stem: text,
  options: z.array(optionDraft),
});

export const recordProseOutput = z.strictObject({
  summary: text,
  items: z.array(z.strictObject({ itemId: text, prose: text })),
});

export const simulateOutput = z.strictObject({
  /** One of the probe's option IDs, or null for "not sure". */
  optionId: text.nullable(),
  reason: text,
});

export const stageSchemas = {
  extract: extractOutput,
  findCandidates: candidatesOutput,
  generateProbes: probesOutput,
  critique: critiqueOutput,
  mapWriteIn: writeInOutput,
  draftResolution: resolutionDraftOutput,
  generateRecheck: recheckOutput,
  draftRecordProse: recordProseOutput,
  simulateAnswer: simulateOutput,
} satisfies Record<StageName, z.ZodType>;

export type StageOutput<S extends StageName> = z.infer<(typeof stageSchemas)[S]>;

/** Name used in `response_format.json_schema.name`, e.g. `extract_output`. */
export const responseFormatName = (stage: StageName) =>
  `${stage.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_output`;

export const stageJsonSchema = (stage: StageName): JsonSchema =>
  toStrictJsonSchema(responseFormatName(stage), stageSchemas[stage]);
