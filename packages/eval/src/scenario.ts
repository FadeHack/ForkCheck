import { z } from "zod";
import { decisionKind, dimension } from "@forkcheck/core";

/** R§7.1 scenario categories. */
export const scenarioCategory = z.enum([
  "deadline",
  "ownership",
  "scope",
  "criteria",
  "dependency_outcome",
  "same_reading",
  "partial_agreement",
  "debated",
  "aligned",
  "insufficient",
  "sarcasm",
]);

const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase id, digits and dashes");
const name = z.string().min(1);

const scriptedResolution = z.strictObject({
  /** Text a participant submits; must not be confirmed without everyone's confirmation. */
  text: z.string().min(1),
  /** What the recheck round should produce for this resolution. */
  expectedRecheck: z.enum(["consistent", "split", "insufficient"]),
});

export const scenario = z
  .strictObject({
    version: z.literal(1),
    id: key,
    title: z.string().min(1),
    set: z.enum(["dev", "heldout"]),
    category: scenarioCategory,
    heldAt: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1),
    participants: z.array(name).min(2).max(4),
    /** Paste format: one `Name: text` turn per line, optional `[mm:ss]` prefix. */
    transcript: z.string().min(1),
    expectedDecisions: z.array(
      z.strictObject({
        id: key,
        kind: decisionKind,
        statement: z.string().min(1),
        owner: name.nullable(),
        deadline: z.string().min(1).nullable(),
        /** Exact transcript substrings that support the decision. */
        quotes: z.array(z.string().min(1)).min(1),
      }),
    ),
    /** Each participant's private, true reading per decision and dimension. */
    briefs: z.array(
      z.strictObject({
        participant: name,
        readings: z.array(z.strictObject({ decision: key, dimension, reading: z.string().min(1) })),
      }),
    ),
    plantedMismatches: z.array(
      z.strictObject({ id: key, decision: key, dimension, note: z.string() }),
    ),
    expectedRecord: z.strictObject({
      stated: z.array(z.string().min(1)),
      confirmed: z.array(z.string().min(1)),
      unresolved: z.array(z.string().min(1)),
    }),
    /** One precise and one deliberately vague resolution per planted mismatch. */
    scriptedResolutions: z.array(
      z.strictObject({ mismatch: key, precise: scriptedResolution, vague: scriptedResolution }),
    ),
  })
  .superRefine((s, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const people = new Set(s.participants);
    const decisions = new Set(s.expectedDecisions.map((d) => d.id));
    const mismatches = new Set(s.plantedMismatches.map((m) => m.id));

    if (people.size !== s.participants.length) fail(["participants"], "duplicate participant");
    s.expectedDecisions.forEach((d, i) => {
      if (d.owner !== null && !people.has(d.owner)) {
        fail(["expectedDecisions", i, "owner"], `unknown participant ${d.owner}`);
      }
      d.quotes.forEach((q, j) => {
        if (!s.transcript.includes(q)) {
          fail(["expectedDecisions", i, "quotes", j], "quote is not in the transcript");
        }
      });
    });
    s.briefs.forEach((b, i) => {
      if (!people.has(b.participant)) fail(["briefs", i], `unknown participant ${b.participant}`);
      b.readings.forEach((r, j) => {
        if (!decisions.has(r.decision)) {
          fail(["briefs", i, "readings", j], `unknown decision ${r.decision}`);
        }
      });
    });
    // A planted mismatch must be real: at least two participants hold different readings.
    s.plantedMismatches.forEach((m, i) => {
      if (!decisions.has(m.decision)) fail(["plantedMismatches", i], `unknown decision`);
      const readings = s.briefs.flatMap((b) =>
        b.readings.filter((r) => r.decision === m.decision && r.dimension === m.dimension),
      );
      if (new Set(readings.map((r) => r.reading)).size < 2) {
        fail(["plantedMismatches", i], "briefs do not disagree on this decision and dimension");
      }
    });
    s.scriptedResolutions.forEach((r, i) => {
      if (!mismatches.has(r.mismatch)) fail(["scriptedResolutions", i], `unknown mismatch`);
    });
    const resolved = new Set(s.scriptedResolutions.map((r) => r.mismatch));
    for (const m of mismatches) {
      if (!resolved.has(m)) fail(["scriptedResolutions"], `no scripted resolution for ${m}`);
    }
  });
export type Scenario = z.infer<typeof scenario>;

export function parseScenario(json: string): Scenario {
  return scenario.parse(JSON.parse(json));
}

export function serializeScenario(s: Scenario): string {
  return JSON.stringify(s, null, 2) + "\n";
}
