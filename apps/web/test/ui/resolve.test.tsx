import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Resolution } from "@forkcheck/core";
import {
  confirmLines,
  currentProposal,
  MODEL_DRAFT_LABEL,
  proposedByText,
  ResolvePanel,
  UNRESOLVED_NOTE,
} from "../../src/ui/resolve";
import { participants, split } from "./fixtures";

const html = (node: React.ReactElement) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");

const resolution = (id: string, overrides: Partial<Resolution> = {}): Resolution => ({
  id,
  splitId: "s1",
  text: "SSO runs on staging on Friday; production follows the week after.",
  proposedBy: "p1",
  draftedByModel: false,
  status: "proposed",
  ...overrides,
});

const people = [
  participants[0]!,
  participants[1]!,
  { ...participants[2]!, status: "absent" as const },
];
const confirmed = [{ resolutionId: "r1", participantId: "p0", at: "2026-10-27T20:00:00.000Z" }];

describe("currentProposal", () => {
  it("is the latest proposal that hasn't been replaced", () => {
    expect(currentProposal([])).toBeUndefined();
    expect(
      currentProposal([resolution("r0", { status: "superseded" }), resolution("r1")])?.id,
    ).toBe("r1");
  });
});

describe("confirmLines", () => {
  it("lists everyone, counting only confirmations of this proposal", () => {
    const lines = confirmLines(
      resolution("r1"),
      [...confirmed, { resolutionId: "r0", participantId: "p1", at: "2026-10-27T19:00:00.000Z" }],
      people,
    );
    expect(lines.map((l) => [l.participant.displayName, l.state])).toEqual([
      ["Priya", "confirmed"],
      ["Marco", "not_yet"],
      ["Dana", "absent"],
    ]);
  });
});

describe("proposedByText", () => {
  it("says when the model drafted the words a participant sent", () => {
    expect(proposedByText(resolution("r1"), people)).toBe("Proposed by Marco");
    expect(proposedByText(resolution("r1", { draftedByModel: true }), people)).toBe(
      "Drafted by the model, then submitted by Marco",
    );
  });
});

describe("ResolvePanel", () => {
  const actor = (viewerId: string) => ({ token: "t", viewerId });

  it("opens straight on the proposal field when nobody has proposed, with no draft shown", () => {
    const out = html(
      <ResolvePanel
        split={split("s1", "q1")}
        resolutions={[]}
        confirmations={[]}
        people={people}
        actor={actor("p0")}
      />,
    );
    expect(out).toContain(">Your wording</label>");
    expect(out).toContain(">Propose wording</button>");
    expect(out).toContain(">Draft wording for me</button>");
    expect(out).toContain(">Agree to disagree</button>");
    expect(out).not.toContain(MODEL_DRAFT_LABEL);
    expect(out).not.toContain("Confirm this wording");
  });

  it("shows the organizer the same state with no controls", () => {
    const none = html(
      <ResolvePanel
        split={split("s1", "q1")}
        resolutions={[]}
        confirmations={[]}
        people={people}
      />,
    );
    expect(none).toContain("Nobody has proposed wording yet.");
    expect(none).not.toContain("<button");
    const some = html(
      <ResolvePanel
        split={split("s1", "q1", { status: "resolving" })}
        resolutions={[resolution("r1")]}
        confirmations={confirmed}
        people={people}
      />,
    );
    expect(some).toContain("production follows the week after.");
    expect(some).not.toContain("<button");
  });

  it("lists who has confirmed and offers confirm only to people who haven't", () => {
    const panel = (viewerId: string) =>
      html(
        <ResolvePanel
          split={split("s1", "q1", { status: "resolving" })}
          resolutions={[resolution("r1")]}
          confirmations={confirmed}
          people={people}
          actor={actor(viewerId)}
        />,
      );
    const marco = panel("p1");
    expect(marco).toContain("<figcaption>Proposed by Marco</figcaption>");
    expect(marco).toContain('data-glyph="check"');
    expect(marco).toContain("Confirmed</span>");
    expect(marco).toContain("Not yet</span>");
    expect(marco).toContain("Absent, not asked</span>");
    expect(marco).toContain(">Confirm this wording</button>");
    expect(marco).toContain(">Propose a change</button>");
    expect(marco).not.toContain(">Your wording</label>");
    expect(panel("p0")).not.toContain("Confirm this wording");
  });

  it("gives an absent participant no controls, and says why", () => {
    const out = html(
      <ResolvePanel
        split={split("s1", "q1")}
        resolutions={[]}
        confirmations={[]}
        people={people}
        actor={actor("p2")}
      />,
    );
    expect(out).toContain("marked you absent");
    expect(out).not.toContain("<button");
  });

  it("records agree to disagree in words, with no controls left", () => {
    const out = html(
      <ResolvePanel
        split={split("s1", "q1", { status: "unresolved" })}
        resolutions={[resolution("r1", { status: "superseded" })]}
        confirmations={[]}
        people={people}
        actor={actor("p0")}
      />,
    );
    expect(out).toContain(UNRESOLVED_NOTE);
    expect(out).not.toContain("<button");
  });
});
