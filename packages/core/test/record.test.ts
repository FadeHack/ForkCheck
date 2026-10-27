import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyResolutionEvent,
  buildRecord,
  initialResolutionState,
  validateRecord,
  type DecisionRecord,
  type Participant,
  type RecordInput,
  type RecordItem,
  type RecordRule,
  type RecordSplit,
  type ResolutionEvent,
  type ResolutionState,
} from "../src/index";

const ids = ["p1", "p2", "p3"];
const people = (absent: string[] = []): Participant[] =>
  ids.map((id) => ({
    id,
    meetingId: "m1",
    displayName: id.toUpperCase(),
    isSimulated: true,
    status: absent.includes(id) ? "absent" : "active",
  }));

function run(state: ResolutionState, events: ResolutionEvent[]): ResolutionState {
  for (const e of events) {
    const r = applyResolutionEvent(state, e);
    if (!r.ok) throw new Error(`${e.type}: ${r.error.code}`);
    state = r.state;
  }
  return state;
}
const as = (participantId: string) => ({ kind: "participant" as const, participantId });
const propose = (text: string, resolutionId = "r1"): ResolutionEvent => ({
  type: "propose",
  actor: as("p1"),
  resolutionId,
  text,
  draftedByModel: false,
});
const confirmAll = (who = ids): ResolutionEvent[] =>
  who.map((p) => ({ type: "confirm", actor: as(p), at: "2026-10-27T16:00:00Z" }));

const PRECISE = "The questionnaire goes to Brightwater by Friday 2026-10-30, 17:00 CT.";

function input(
  splitStates: { state: ResolutionState; deadline?: RecordSplit["deadline"] }[],
  absent: string[] = [],
): RecordInput {
  return {
    meeting: { id: "m1", title: "Questionnaire", heldAt: "2026-10-26T15:00:00-05:00" },
    generatedAt: "2026-10-27T17:00:00Z",
    participants: people(absent),
    segments: [
      { id: "s0", text: "Kwame: I'll send it back next Friday.", origin: "paste" },
      { id: "s1", text: "Rosa: Lena, your sections first.", origin: "asr" },
    ],
    decisions: [
      {
        decision: { id: "d0", statement: "Kwame returns the questionnaire next Friday." },
        evidence: [
          { segmentId: "s0", quote: "I'll send it back next Friday." },
          // Not in the segment: never reaches the record.
          { segmentId: "s1", quote: "Lena sends hers on Monday." },
        ],
      },
      {
        decision: { id: "d1", statement: "Lena's sections go first." },
        evidence: [{ segmentId: "s1", quote: "Lena, your sections first." }],
      },
    ],
    splits: splitStates.map(({ state, deadline = null }) => ({
      decisionId: "d0",
      dimension: "deadline",
      state,
      deadline,
    })),
  };
}

const fresh = (absent: string[] = []) =>
  initialResolutionState(
    "split-1",
    people(absent).map(({ id, status }) => ({ id, status })),
  );
const confirmed = (text = PRECISE, absent: string[] = []) =>
  run(fresh(absent), [propose(text), ...confirmAll(ids.filter((p) => !absent.includes(p)))]);

const byCategory = (r: DecisionRecord, c: RecordItem["category"]) =>
  r.items.filter((i) => i.category === c);

describe("buildRecord", () => {
  it("stated items are verified quotes only, with their origin", () => {
    const r = buildRecord(input([]));
    expect(byCategory(r, "stated").map((i) => [i.text, i.sourceRefs[0]])).toEqual([
      [
        "I'll send it back next Friday.",
        {
          kind: "segment",
          segmentId: "s0",
          quote: "I'll send it back next Friday.",
          origin: "paste",
        },
      ],
      [
        "Lena, your sections first.",
        { kind: "segment", segmentId: "s1", quote: "Lena, your sections first.", origin: "asr" },
      ],
    ]);
    expect(r.items.map((i) => i.id)).toEqual(["m1:item:0", "m1:item:1"]);
    expect(r.proseDraft).toBeNull();
  });

  it("a resolution everyone confirmed is confirmed, sourced to its confirmations", () => {
    const deadline = { text: "Friday 2026-10-30", date: "2026-10-30", firmness: "firm" as const };
    const [item] = byCategory(buildRecord(input([{ state: confirmed(), deadline }])), "confirmed");
    expect(item).toMatchObject({
      text: PRECISE,
      confirmedBy: ids,
      absent: [],
      recheck: "not_run",
      splitId: "split-1",
      deadline,
    });
    expect(item!.sourceRefs[0]).toEqual({ kind: "confirmation", resolutionId: "r1" });
  });

  it("names absent participants on a confirmed item", () => {
    const r = buildRecord(input([{ state: confirmed(PRECISE, ["p3"]) }], ["p3"]));
    expect(byCategory(r, "confirmed")[0]).toMatchObject({
      confirmedBy: ["p1", "p2"],
      absent: ["p3"],
    });
  });

  it.each([
    ["rechecked", "passed"],
    ["insufficient", "not_conclusive"],
  ] as const)("recheck %s → %s", (outcome, recheck) => {
    const state = run(confirmed(), [
      { type: "recheck", outcome: outcome === "rechecked" ? "consistent" : "insufficient" },
    ]);
    expect(byCategory(buildRecord(input([{ state }])), "confirmed")[0]?.recheck).toBe(recheck);
  });

  it.each<[string, () => ResolutionState, string]>([
    ["open", () => fresh(), "Participants read the deadline differently: Kwame returns"],
    [
      "resolving",
      () => run(fresh(), [propose(PRECISE), ...confirmAll(["p1"])]),
      "Not confirmed by everyone: The questionnaire",
    ],
    [
      "agree to disagree",
      () => run(fresh(), [{ type: "agree_to_disagree", actor: as("p2") }]),
      "Left open by agreement (deadline): Kwame returns",
    ],
    [
      "failed recheck",
      () => run(confirmed(), [{ type: "recheck", outcome: "split" }]),
      "A recheck found different readings of: The questionnaire",
    ],
  ])("%s → unresolved", (_, state, text) => {
    const r = buildRecord(input([{ state: state() }]));
    expect(byCategory(r, "confirmed")).toEqual([]);
    const [item] = byCategory(r, "unresolved");
    expect(item!.text.startsWith(text)).toBe(true);
    expect(item!.sourceRefs.length).toBeGreaterThan(0);
  });

  it("a failed recheck is recorded as failed", () => {
    const state = run(confirmed(), [{ type: "recheck", outcome: "split" }]);
    expect(byCategory(buildRecord(input([{ state }])), "unresolved")[0]?.recheck).toBe("failed");
  });

  it("a vague term in a confirmed field forces unresolved", () => {
    const r = buildRecord(input([{ state: confirmed("Kwame sends it back soon.") }]));
    expect(byCategory(r, "confirmed")).toEqual([]);
    expect(byCategory(r, "unresolved")[0]?.text).toBe(
      'Confirmed, but "soon" is vague: Kwame sends it back soon.',
    );
  });

  it("a vague deadline text forces unresolved too", () => {
    const deadline = { text: "end of the week", date: "2026-10-30", firmness: "target" as const };
    const r = buildRecord(input([{ state: confirmed(), deadline }]));
    expect(byCategory(r, "unresolved")[0]?.text).toContain('"end of the week" is vague');
  });

  it("a deadline without a date or firmness forces unresolved", () => {
    const deadline = { text: "Friday the 30th", date: null, firmness: null };
    const r = buildRecord(input([{ state: confirmed(), deadline }]));
    expect(byCategory(r, "unresolved")[0]?.text).toContain(
      "the deadline has no date, the deadline is not marked firm or target",
    );
  });

  it("someone marked active after the split closed blocks confirmed", () => {
    // The split confirmed while p3 was absent; the meeting now lists p3 as active.
    const r = buildRecord(input([{ state: confirmed(PRECISE, ["p3"]) }]));
    expect(byCategory(r, "confirmed")).toEqual([]);
    expect(byCategory(r, "unresolved")[0]?.text).toContain("Not confirmed by everyone");
  });
});

describe("validateRecord", () => {
  const deadline = { text: "Friday 2026-10-30", date: "2026-10-30", firmness: "firm" as const };
  const valid = () => input([{ state: confirmed(PRECISE, ["p3"]), deadline }], ["p3"]);
  const confirmedIndex = (r: DecisionRecord) =>
    r.items.findIndex((i) => i.category === "confirmed");

  function failWith(
    edit: (item: RecordItem, record: DecisionRecord) => void,
    category: RecordItem["category"] = "confirmed",
  ): RecordRule[] {
    const i = valid();
    const record = structuredCloneRecord(buildRecord(i));
    const item = record.items.find((x) => x.category === category)!;
    edit(item, record);
    return validateRecord(record, i).findings.map((f) => f.rule as RecordRule);
  }

  it("passes the builder's output", () => {
    const i = valid();
    expect(validateRecord(buildRecord(i), i)).toEqual({ ok: true, findings: [] });
  });

  it.each<
    [RecordRule, (item: RecordItem, record: DecisionRecord) => void, RecordItem["category"]?]
  >([
    ["source_required", (item) => (item.sourceRefs = []), "stated"],
    ["stated_quote_verified", (item) => (item.text = "Kwame returns it next Friday."), "stated"],
    [
      "stated_quote_verified",
      (item) => {
        item.text = "Lena sends hers on Monday.";
        item.sourceRefs = [{ kind: "segment", segmentId: "s1", quote: item.text, origin: "paste" }];
      },
      "stated",
    ],
    [
      "confirmed_text_from_resolution",
      (item) => (item.text = "Kwame sends it by Friday 2026-10-30."),
    ],
    [
      "confirmed_text_from_resolution",
      (item) => (item.sourceRefs = item.sourceRefs.filter((r) => r.kind !== "confirmation")),
    ],
    ["confirmed_by_all_active", (item) => (item.confirmedBy = ["p1"])],
    ["confirmed_by_all_active", (item) => (item.confirmedBy = ["p1", "p2", "p3"])],
    ["absent_named", (item) => (item.absent = [])],
    ["confirmed_deadline_concrete", (item) => (item.deadline = { ...deadline, firmness: null })],
    ["confirmed_deadline_concrete", (item) => (item.deadline = { ...deadline, date: null })],
    ["confirmed_not_vague", (item) => (item.deadline = { ...deadline, text: "ASAP" })],
  ])("fails %s", (rule, edit, category) => {
    expect(failWith(edit, category)).toContain(rule);
  });

  it("fails an item that is both confirmed and attached to an open split", () => {
    const i = valid();
    const record = buildRecord(i);
    const reopened = run(i.splits[0]!.state, [{ type: "recheck", outcome: "split" }]);
    const after = { ...i, splits: [{ ...i.splits[0]!, state: reopened }] };
    expect(validateRecord(record, after).findings.map((f) => f.rule)).toContain(
      "confirmed_split_closed",
    );
    expect(confirmedIndex(record)).toBeGreaterThan(-1);
  });

  it("fails a vague term in a confirmed text", () => {
    const i = input([{ state: confirmed("Ship it ASAP.") }]);
    const record = buildRecord(input([{ state: confirmed() }]));
    const item = record.items[confirmedIndex(record)]!;
    item.text = "Ship it ASAP.";
    expect(validateRecord(record, i).findings.map((f) => f.rule)).toEqual(["confirmed_not_vague"]);
  });
});

function structuredCloneRecord(r: DecisionRecord): DecisionRecord {
  return JSON.parse(JSON.stringify(r)) as DecisionRecord;
}

// Random resolution histories and absence lists, weighted so that many histories reach a
// confirmed resolution; "agree to disagree" ends a history, so it is rare.
const actor = fc.constantFrom(...ids).map(as);
const event: fc.Arbitrary<ResolutionEvent> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("propose" as const),
      actor,
      resolutionId: fc.constantFrom("r1", "r2", "r3"),
      text: fc.constantFrom(PRECISE, "Kwame sends it back soon.", "Ship on Monday the 2nd."),
      draftedByModel: fc.boolean(),
    }),
  },
  {
    weight: 20,
    arbitrary: fc.record({
      type: fc.constant("confirm" as const),
      actor,
      at: fc.constant("2026-10-27T16:00:00Z"),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("agree_to_disagree" as const), actor }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("recheck" as const),
      outcome: fc.constantFrom("split" as const, "consistent" as const, "insufficient" as const),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("set_participant_status" as const),
      participantId: fc.constantFrom(...ids),
      status: fc.constantFrom("active" as const, "absent" as const),
    }),
  },
);
const scenario: fc.Arbitrary<History> = fc.record({
  events: fc.array(event, { maxLength: 15 }).map((rest) => [propose(PRECISE, "r0"), ...rest]),
  absent: fc.subarray(ids),
  deadline: fc.option(
    fc.record({
      text: fc.constantFrom("Friday 2026-10-30", "end of the week"),
      date: fc.option(fc.constant("2026-10-30"), { nil: null }),
      firmness: fc.option(fc.constantFrom("firm" as const, "target" as const), { nil: null }),
    }),
    { nil: null },
  ),
});

interface History {
  events: ResolutionEvent[];
  absent: string[];
  deadline: RecordSplit["deadline"];
}

function history({ events, absent, deadline }: History): RecordInput {
  let state = fresh();
  for (const e of events) {
    const r = applyResolutionEvent(state, e);
    if (r.ok) state = r.state;
  }
  // The organizer's final absence list, applied through the state machine where it allows.
  for (const p of ids) {
    const r = applyResolutionEvent(state, {
      type: "set_participant_status",
      participantId: p,
      status: absent.includes(p) ? "absent" : "active",
    });
    if (r.ok) state = r.state;
  }
  return input([{ state, deadline }], absent);
}

describe("properties", () => {
  it("a confirmed item lists every active participant and names the absent ones", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const i = history(x);
        const active = i.participants.filter((p) => p.status === "active").map((p) => p.id);
        for (const item of byCategory(buildRecord(i), "confirmed")) {
          expect([...item.confirmedBy].sort()).toEqual(expect.arrayContaining(active));
          expect([...item.absent].sort()).toEqual([...x.absent].sort());
        }
      }),
      { numRuns: 500 },
    );
  });

  it("the validator passes every record the builder produces", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const i = history(x);
        expect(validateRecord(buildRecord(i), i).findings).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it("model-inferred text never reaches stated or confirmed", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const i = history(x);
        const quotes = i.decisions.flatMap((d) => d.evidence.map((e) => e.quote));
        const submitted = i.splits.flatMap((s) => s.state.resolutions.map((r) => r.text));
        for (const item of buildRecord(i).items) {
          if (item.category === "stated") expect(quotes).toContain(item.text);
          if (item.category === "confirmed") expect(submitted).toContain(item.text);
          expect(item.text).not.toBe("Kwame returns the questionnaire next Friday.");
        }
      }),
      { numRuns: 300 },
    );
  });
});
