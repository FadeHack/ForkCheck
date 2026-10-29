import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Resolution } from "@forkcheck/core";
import { awaitingRecheck, RECHECK_SENT, RecheckView } from "../../src/ui/organizer/recheck";
import { RevealView } from "../../src/ui/organizer/views";
import { REOPENED_NOTE } from "../../src/ui/resolve";
import { answer, organizerState, probe, round, split } from "./fixtures";

const html = (node: React.ReactElement) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");

const closed = { closedAt: "2026-10-27T21:00:00.000Z", closeReason: "all_answered" as const };
const wording: Resolution = {
  id: "r1",
  splitId: "s1",
  text: "SSO is ready soon.",
  proposedBy: "p0",
  draftedByModel: false,
  status: "confirmed",
};
const recheckProbe = probe("rq", {
  kind: "recheck",
  splitId: "s1",
  stem: "On Monday, which system do the pilot admins sign in to?",
});

describe("RecheckView", () => {
  it("offers a recheck for confirmed wording, showing the wording", () => {
    const state = organizerState({
      probes: [probe("q1", { stem: "Where does SSO run?" })],
      rounds: [round("r1", closed)],
      splits: [split("s1", "q1", { status: "confirmed" })],
      resolutions: [wording],
    });
    expect(awaitingRecheck(state).map((s) => s.id)).toEqual(["s1"]);
    const out = html(<RecheckView state={state} />);
    expect(out).toContain("Where does SSO run?");
    expect(out).toContain("SSO is ready soon.");
    expect(out).toContain(">Send a recheck question</button>");
  });

  it("says when nothing is ready", () => {
    expect(html(<RecheckView state={organizerState()} />)).toContain(
      "A recheck starts once everyone has confirmed the wording for a difference.",
    );
  });

  it("shows the open recheck as a new question, with progress and no earlier answers", () => {
    const state = organizerState({
      probes: [probe("q1", { stem: "Where does SSO run?" }), recheckProbe],
      rounds: [round("r1", closed), round("r2", { kind: "recheck" })],
      splits: [split("s1", "q1", { status: "confirmed" })],
      resolutions: [wording],
      revealedAnswers: [answer("p0", "q1", "q1-a"), answer("p1", "q1", "q1-b")],
      answerCounts: [{ probeId: "rq", answered: 1, active: 3, answeredBy: ["p0"] }],
    });
    const out = html(<RecheckView state={state} />);
    expect(out).toContain(RECHECK_SENT);
    expect(out).toContain(recheckProbe.stem);
    expect(out).toContain("1 of 3 have answered.");
    expect(out).not.toContain("Where does SSO run?");
    expect(out).not.toContain("Chosen by");
    expect(out).not.toContain("Send a recheck question");
  });
});

describe("recheck results on the reveal", () => {
  const state = (outcome: "split" | "insufficient", status: "reopened" | "confirmed") =>
    organizerState({
      probes: [probe("q1", { stem: "Where does SSO run?" }), recheckProbe],
      rounds: [round("r1", closed), round("r2", { ...closed, kind: "recheck" })],
      splits: [split("s1", "q1", { status }), split("s2", "rq", { outcome, status })],
      resolutions: [wording],
      revealedAnswers: [
        answer("p0", "q1", "q1-a"),
        answer("p1", "q1", "q1-b"),
        answer("p0", "rq", "rq-a"),
        answer("p1", "rq", "rq-b"),
      ],
    });

  it("puts a reopening recheck, with its new answers, under the difference it followed up", () => {
    const out = html(<RevealView state={state("split", "reopened")} />);
    expect(out.match(/<article/g)).toHaveLength(2);
    expect(out.indexOf("Where does SSO run?")).toBeLessThan(out.indexOf(recheckProbe.stem));
    expect(out).toContain("Reopened</span>: answers differed, so the wording didn't settle it.");
    expect(out).toContain(REOPENED_NOTE);
  });

  it("says when a recheck didn't have enough answers", () => {
    expect(html(<RevealView state={state("insufficient", "confirmed")} />)).toContain(
      "Not conclusive</span>: not enough answers.",
    );
  });
});
