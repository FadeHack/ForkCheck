import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyResolutionEvent,
  currentResolution,
  everyoneConfirmed,
  initialResolutionState,
  type Actor,
  type ResolutionErrorCode,
  type ResolutionEvent,
  type ResolutionState,
} from "../src/index";

const people = ["p1", "p2", "p3"];
const fresh = (absent: string[] = []) =>
  initialResolutionState(
    "split-1",
    people.map((id) => ({ id, status: absent.includes(id) ? "absent" : "active" })),
  );

const as = (participantId: string): Actor => ({ kind: "participant", participantId });
const model: Actor = { kind: "model" };
const propose = (actor: Actor, resolutionId = "r1", text = "Ship on Friday"): ResolutionEvent => ({
  type: "propose",
  actor,
  resolutionId,
  text,
  draftedByModel: false,
});
const confirm = (actor: Actor): ResolutionEvent => ({ type: "confirm", actor, at: "2026-10-27" });

/** Applies events that must all succeed. */
function run(s: ResolutionState, events: ResolutionEvent[]): ResolutionState {
  for (const e of events) {
    const r = applyResolutionEvent(s, e);
    if (!r.ok) throw new Error(`${e.type}: ${r.error.code}`);
    s = r.state;
  }
  return s;
}

function errorOf(s: ResolutionState, e: ResolutionEvent): ResolutionErrorCode | null {
  const r = applyResolutionEvent(s, e);
  return r.ok ? null : r.error.code;
}

const confirmedState = () =>
  run(fresh(), [propose(as("p1")), ...people.map((p) => confirm(as(p)))]);

describe("happy paths", () => {
  it("open → resolving → confirmed once every active participant confirms", () => {
    let s = run(fresh(), [propose(as("p1"))]);
    expect(s.status).toBe("resolving");
    s = run(s, [confirm(as("p1")), confirm(as("p2"))]);
    expect(s.status).toBe("resolving");
    s = run(s, [confirm(as("p3"))]);
    expect(s.status).toBe("confirmed");
    expect(currentResolution(s)?.status).toBe("confirmed");
  });

  it("a new proposal supersedes the old one and clears its confirmations", () => {
    const s = run(fresh(), [
      propose(as("p1"), "r1"),
      confirm(as("p1")),
      propose(as("p2"), "r2", "Ship on Monday"),
    ]);
    expect(s.resolutions.map((r) => [r.id, r.status])).toEqual([
      ["r1", "superseded"],
      ["r2", "proposed"],
    ]);
    expect(s.confirmations).toEqual([]);
  });

  it("keeps who submitted a model-drafted text", () => {
    const s = run(fresh(), [{ ...propose(as("p2")), draftedByModel: true } as ResolutionEvent]);
    expect(currentResolution(s)).toMatchObject({ proposedBy: "p2", draftedByModel: true });
  });

  it("trims the text", () => {
    const s = run(fresh(), [propose(as("p1"), "r1", "  Ship on Friday \n")]);
    expect(currentResolution(s)?.text).toBe("Ship on Friday");
  });

  it("agree to disagree marks the split unresolved and supersedes the proposal", () => {
    const s = run(fresh(), [propose(as("p1")), { type: "agree_to_disagree", actor: as("p2") }]);
    expect(s.status).toBe("unresolved");
    expect(currentResolution(s)).toBeUndefined();
  });

  it.each([
    ["consistent", "rechecked", false],
    ["split", "reopened", false],
    ["insufficient", "confirmed", true],
  ] as const)("recheck %s → %s", (outcome, status, inconclusive) => {
    const s = run(confirmedState(), [{ type: "recheck", outcome }]);
    expect(s.status).toBe(status);
    expect(s.recheckInconclusive).toBe(inconclusive);
  });

  it("a reopened split takes a new proposal", () => {
    const s = run(confirmedState(), [
      { type: "recheck", outcome: "split" },
      propose(as("p3"), "r2", "Ship on Monday"),
    ]);
    expect(s.status).toBe("resolving");
    expect(s.resolutions.map((r) => r.status)).toEqual(["superseded", "proposed"]);
  });
});

describe("invalid transitions return a typed error", () => {
  const resolving = () => run(fresh(), [propose(as("p1"))]);
  const unresolved = () => run(fresh(), [{ type: "agree_to_disagree", actor: as("p1") }]);
  const rechecked = () => run(confirmedState(), [{ type: "recheck", outcome: "consistent" }]);

  it.each<[string, () => ResolutionState, ResolutionEvent, ResolutionErrorCode]>([
    ["confirm with nothing proposed", fresh, confirm(as("p1")), "invalid_transition"],
    ["recheck while open", fresh, { type: "recheck", outcome: "consistent" }, "invalid_transition"],
    [
      "recheck while resolving",
      resolving,
      { type: "recheck", outcome: "split" },
      "invalid_transition",
    ],
    ["propose once confirmed", confirmedState, propose(as("p1"), "r2"), "invalid_transition"],
    ["confirm once confirmed", confirmedState, confirm(as("p1")), "invalid_transition"],
    [
      "agree to disagree once confirmed",
      confirmedState,
      { type: "agree_to_disagree", actor: as("p1") },
      "invalid_transition",
    ],
    ["propose once unresolved", unresolved, propose(as("p1")), "invalid_transition"],
    ["propose once rechecked", rechecked, propose(as("p1"), "r2"), "invalid_transition"],
    ["recheck twice", rechecked, { type: "recheck", outcome: "split" }, "invalid_transition"],
    ["model proposes", fresh, propose(model), "model_cannot_act"],
    ["model confirms", resolving, confirm(model), "model_cannot_act"],
    ["model ends the talk", fresh, { type: "agree_to_disagree", actor: model }, "model_cannot_act"],
    ["stranger proposes", fresh, propose(as("p9")), "unknown_participant"],
    ["stranger confirms", resolving, confirm(as("p9")), "unknown_participant"],
    [
      "status of a stranger",
      fresh,
      { type: "set_participant_status", participantId: "p9", status: "absent" },
      "unknown_participant",
    ],
    ["blank text", fresh, propose(as("p1"), "r1", "   "), "empty_text"],
    ["reused resolution id", resolving, propose(as("p2"), "r1"), "duplicate_resolution_id"],
    [
      "confirm twice",
      () => run(resolving(), [confirm(as("p2"))]),
      confirm(as("p2")),
      "already_confirmed",
    ],
  ])("%s", (_, state, event, code) => {
    const s = state();
    expect(errorOf(s, event)).toBe(code);
  });
});

describe("absent participants", () => {
  it("an absent participant cannot propose or confirm", () => {
    const s = fresh(["p3"]);
    expect(errorOf(s, propose(as("p3")))).toBe("participant_absent");
    expect(errorOf(run(s, [propose(as("p1"))]), confirm(as("p3")))).toBe("participant_absent");
  });

  it("confirmation needs the active participants only", () => {
    const s = run(fresh(["p3"]), [propose(as("p1")), confirm(as("p1")), confirm(as("p2"))]);
    expect(s.status).toBe("confirmed");
  });

  it("marking the last holdout absent completes the confirmation", () => {
    let s = run(fresh(), [propose(as("p1")), confirm(as("p1")), confirm(as("p2"))]);
    expect(s.status).toBe("resolving");
    s = run(s, [{ type: "set_participant_status", participantId: "p3", status: "absent" }]);
    expect(s.status).toBe("confirmed");
  });

  it("marking an unconfirmed participant active after confirmation is refused", () => {
    const s = run(fresh(["p3"]), [propose(as("p1")), confirm(as("p1")), confirm(as("p2"))]);
    expect(
      errorOf(s, { type: "set_participant_status", participantId: "p3", status: "active" }),
    ).toBe("would_break_confirmation");
  });

  it("marking a participant who confirmed absent keeps the split confirmed", () => {
    const s = run(confirmedState(), [
      { type: "set_participant_status", participantId: "p2", status: "absent" },
    ]);
    expect(s.status).toBe("confirmed");
  });

  it("marking everyone absent never confirms", () => {
    const s = run(fresh(), [
      propose(as("p1")),
      ...people.map((p): ResolutionEvent => ({
        type: "set_participant_status",
        participantId: p,
        status: "absent",
      })),
    ]);
    expect(s.status).toBe("resolving");
    expect(everyoneConfirmed(s)).toBe(false);
  });
});

// Model-based: random event sequences, including invalid ones, from a small alphabet so
// that valid paths come up often.
const actorArb = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...people, "p9").map(as) },
  { weight: 1, arbitrary: fc.constant(model) },
);
const eventArb: fc.Arbitrary<ResolutionEvent> = fc.oneof(
  fc.record({
    type: fc.constant("propose" as const),
    actor: actorArb,
    resolutionId: fc.constantFrom("r1", "r2", "r3", "r4"),
    text: fc.constantFrom("Ship on Friday", "Ship on Monday", " "),
    draftedByModel: fc.boolean(),
  }),
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant("confirm" as const),
      actor: actorArb,
      at: fc.constant("t"),
    }),
  },
  fc.record({ type: fc.constant("agree_to_disagree" as const), actor: actorArb }),
  fc.record({
    type: fc.constant("recheck" as const),
    outcome: fc.constantFrom("split", "consistent", "insufficient" as const),
  }),
  fc.record({
    type: fc.constant("set_participant_status" as const),
    participantId: fc.constantFrom(...people),
    status: fc.constantFrom("active" as const, "absent" as const),
  }),
);

describe("properties", () => {
  it("confirmed never holds without every active participant's confirmation", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let s = fresh();
        for (const e of events) {
          const r = applyResolutionEvent(s, e);
          if (r.ok) s = r.state;
          if (s.status === "confirmed") expect(everyoneConfirmed(s)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a model actor never changes the state, and every resolution was proposed by a participant", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let s = fresh();
        for (const e of events) {
          const r = applyResolutionEvent(s, e);
          if ("actor" in e && e.actor.kind === "model") {
            expect(r.ok).toBe(false);
            continue;
          }
          if (r.ok) s = r.state;
        }
        for (const r of s.resolutions) expect(people).toContain(r.proposedBy);
      }),
      { numRuns: 500 },
    );
  });

  it("a failed event leaves the state as it was", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 30 }), (events) => {
        let s = fresh();
        for (const e of events) {
          const before = JSON.parse(JSON.stringify(s)) as ResolutionState;
          const r = applyResolutionEvent(s, e);
          if (r.ok) s = r.state;
          else expect(s).toEqual(before);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("at most one resolution is live, and it is the newest", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let s = fresh();
        for (const e of events) {
          const r = applyResolutionEvent(s, e);
          if (r.ok) s = r.state;
          const live = s.resolutions.filter((x) => x.status !== "superseded");
          expect(live.length).toBeLessThanOrEqual(1);
          if (live.length === 1) expect(live[0]).toBe(s.resolutions.at(-1));
        }
      }),
      { numRuns: 300 },
    );
  });
});
