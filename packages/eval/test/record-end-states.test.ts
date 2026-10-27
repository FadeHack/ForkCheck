import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyResolutionEvent,
  buildRecord,
  initialResolutionState,
  validateRecord,
  verifyQuote,
  type RecordInput,
  type ResolutionEvent,
  type ResolutionState,
} from "@forkcheck/core";
import { parseScenario, scenarioExtractInput, type Scenario } from "../src/index";

const dir = new URL("../../../scenarios/dev/", import.meta.url);
const dev: Scenario[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => parseScenario(readFileSync(new URL(f, dir), "utf8")));

type EndState =
  | "precise_rechecked"
  | "precise_one_absent"
  | "precise_recheck_inconclusive"
  | "vague_reopened"
  | "agree_to_disagree"
  | "missing_confirmation"
  | "open";
const END_STATES: EndState[] = [
  "precise_rechecked",
  "precise_one_absent",
  "precise_recheck_inconclusive",
  "vague_reopened",
  "agree_to_disagree",
  "missing_confirmation",
  "open",
];

function play(state: ResolutionState, events: ResolutionEvent[]): ResolutionState {
  for (const e of events) {
    const r = applyResolutionEvent(state, e);
    if (!r.ok) throw new Error(`${e.type}: ${r.error.code}`);
    state = r.state;
  }
  return state;
}

/** The scenario's answer-key decisions, with each planted mismatch's split in `end`. */
function scriptedInput(s: Scenario, end: EndState): RecordInput {
  const { meeting, participants: all, segments } = scenarioExtractInput(s);
  const absentOne = end === "precise_one_absent" ? all.at(-1)!.id : null;
  const participants = all.map((p) =>
    p.id === absentOne ? { ...p, status: "absent" as const } : p,
  );
  const active = participants.filter((p) => p.status === "active").map((p) => p.id);
  const as = (participantId: string) => ({ kind: "participant" as const, participantId });
  const confirm = (who: string[]): ResolutionEvent[] =>
    who.map((p) => ({ type: "confirm", actor: as(p), at: "2026-10-28T12:00:00Z" }));

  const splits = s.scriptedResolutions.map((scripted) => {
    const m = s.plantedMismatches.find((x) => x.id === scripted.mismatch)!;
    const start = initialResolutionState(
      `${s.id}:${m.id}`,
      participants.map(({ id, status }) => ({ id, status })),
    );
    const propose = (text: string): ResolutionEvent => ({
      type: "propose",
      actor: as(active[0]!),
      resolutionId: `${m.id}-res`,
      text,
      draftedByModel: false,
    });
    const precise = [propose(scripted.precise.text), ...confirm(active)];
    const events: Record<EndState, ResolutionEvent[]> = {
      precise_rechecked: [...precise, { type: "recheck", outcome: "consistent" }],
      precise_one_absent: precise,
      precise_recheck_inconclusive: [...precise, { type: "recheck", outcome: "insufficient" }],
      vague_reopened: [
        propose(scripted.vague.text),
        ...confirm(active),
        { type: "recheck", outcome: "split" },
      ],
      agree_to_disagree: [{ type: "agree_to_disagree", actor: as(active[1]!) }],
      missing_confirmation: [propose(scripted.precise.text), ...confirm(active.slice(1))],
      open: [],
    };
    return {
      decisionId: m.decision,
      dimension: m.dimension,
      state: play(start, events[end]),
      deadline: null,
    };
  });

  const decisions = s.expectedDecisions.map((d) => ({
    decision: { id: d.id, statement: d.statement },
    evidence: d.quotes.map((quote) => ({
      segmentId: segments.find((seg) => verifyQuote(seg, quote).ok)!.id,
      quote,
    })),
  }));
  return {
    meeting,
    generatedAt: "2026-10-28T12:00:00Z",
    participants,
    segments,
    decisions,
    splits,
  };
}

describe("record on scripted end states", () => {
  const cases = dev.flatMap((s) => END_STATES.map((end) => [s.id, end, s] as const));

  it.each(cases)("%s, %s: the validator passes", (_, end, s) => {
    const input = scriptedInput(s, end);
    const record = buildRecord(input);
    expect(validateRecord(record, input).findings).toEqual([]);

    const confirmed = record.items.filter((i) => i.category === "confirmed");
    const unresolved = record.items.filter((i) => i.category === "unresolved");
    const splits = s.scriptedResolutions.length;
    if (end.startsWith("precise")) {
      expect(confirmed).toHaveLength(splits);
      expect(confirmed.map((i) => i.text)).toEqual(
        s.scriptedResolutions.map((r) => r.precise.text),
      );
    } else {
      expect(confirmed).toEqual([]);
      expect(unresolved).toHaveLength(splits);
    }
    if (end === "precise_one_absent") {
      for (const i of confirmed) expect(i.absent).toEqual([s.participants.at(-1)]);
    }
  });

  it("every stated item is a quote from the answer key", () => {
    for (const s of dev) {
      const quotes = s.expectedDecisions.flatMap((d) => d.quotes);
      const record = buildRecord(scriptedInput(s, "precise_rechecked"));
      const stated = record.items.filter((i) => i.category === "stated").map((i) => i.text);
      expect(stated).toEqual(quotes);
    }
  });

  it("covers the scenarios with planted mismatches", () => {
    expect(dev.filter((s) => s.scriptedResolutions.length > 0)).toHaveLength(6);
  });
});
