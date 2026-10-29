import { describe, expect, it } from "vitest";
import { organizerStage, participantStage } from "../../src/ui/stages";
import { viewedStage } from "../../src/ui/organizer/workspace";
import { answer, organizerState, participantState, probe, round, split } from "./fixtures";

const closed = { closedAt: "2026-10-27T21:00:00.000Z", closeReason: "all_answered" as const };

describe("organizerStage", () => {
  it("is questions before any round opens", () => {
    expect(organizerStage(organizerState())).toBe("questions");
  });

  it("is round while the diagnostic round is open", () => {
    expect(organizerStage(organizerState({ rounds: [round("r1")] }))).toBe("round");
  });

  it("is reveal once the round closes with an open split", () => {
    const state = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1")],
    });
    expect(organizerStage(state)).toBe("reveal");
  });

  it("is resolve once wording has been proposed", () => {
    const state = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { status: "resolving" })],
    });
    expect(organizerStage(state)).toBe("resolve");
  });

  it("is recheck once a split is confirmed or a recheck round is open", () => {
    const confirmed = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { status: "confirmed" })],
    });
    expect(organizerStage(confirmed)).toBe("recheck");
  });

  it("is record when every split is settled, or when nothing split", () => {
    const settled = organizerState({
      probes: [probe("q1"), probe("q2")],
      rounds: [round("r1", closed)],
      splits: [
        split("s1", "q1", { status: "rechecked" }),
        split("s2", "q2", { status: "unresolved" }),
      ],
    });
    expect(organizerStage(settled)).toBe("record");
    const agreed = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { outcome: "consistent" })],
    });
    expect(organizerStage(agreed)).toBe("record");
  });

  it("ignores splits from recheck questions", () => {
    const state = organizerState({
      probes: [probe("q1"), probe("rq", { kind: "recheck", splitId: "s1" })],
      rounds: [round("r1", closed), round("r2", { ...closed, kind: "recheck" })],
      splits: [split("s1", "q1", { status: "rechecked" }), split("s2", "rq")],
    });
    expect(organizerStage(state)).toBe("record");
  });
});

describe("viewedStage", () => {
  it("shows an earlier stage on request, never a later one or the source", () => {
    expect(viewedStage("reveal", "questions")).toBe("questions");
    expect(viewedStage("reveal", "record")).toBe("reveal");
    expect(viewedStage("reveal", "source")).toBe("reveal");
    expect(viewedStage("reveal", "nonsense")).toBe("reveal");
    expect(viewedStage("reveal", null)).toBe("reveal");
  });
});

describe("participantStage", () => {
  const open = { id: "q1", kind: "diagnostic" as const, stem: "Q", options: [] };

  it("is not_started before any question is sent", () => {
    expect(participantStage(participantState())).toBe("not_started");
  });

  it("is answer with an unanswered question, waiting once all are answered", () => {
    expect(participantStage(participantState({ openProbes: [open] }))).toBe("answer");
    const answered = participantState({
      openProbes: [open],
      ownAnswers: [answer("p0", "q1", null)],
    });
    expect(participantStage(answered)).toBe("waiting");
  });

  it("is recheck when the open question is a recheck", () => {
    const state = participantState({ openProbes: [{ ...open, kind: "recheck" }] });
    expect(participantStage(state)).toBe("recheck");
  });

  it("is reveal until every split is settled, then record", () => {
    const revealed = (status: "open" | "rechecked") => ({
      split: split("s1", "q1", { status }),
      probe: open,
      quote: null,
      answers: [],
      resolutions: [],
      confirmations: [],
    });
    expect(participantStage(participantState({ revealed: [revealed("open")] }))).toBe("reveal");
    expect(participantStage(participantState({ revealed: [revealed("rechecked")] }))).toBe(
      "record",
    );
  });
});
